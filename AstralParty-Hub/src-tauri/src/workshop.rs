//! Mod / Card / Skin Workshop downloader, SHA-256 verifier, atomic installer, and restorer.
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::application::install_service::InstallService;
use crate::domain::error::{HubError, HubResult};
use crate::domain::installation::GameInstallation;
use crate::extension_center::{game_root, get_game, ExtensionCenter};
use crate::install::gates::ProcessGate;
use crate::mod_resources::{self, SwitchFile, target_key};
use crate::remote_content;
use crate::security::hash::compute_file_sha256;
use crate::security::path_guard::PathGuard;

const MAX_PAYLOAD_BYTES: usize = 512 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: usize = 1024 * 1024 * 1024;
const MAX_ZIP_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 4000;
const MAX_CONCURRENT_DOWNLOADS: usize = 4;
const VALID_DATA_DIRS: &[&str] = &[
    "AstralParty_CN_Data",
    "吉星派对_Data",
    "AstralParty_INT_Data",
    "AstralParty_Data",
];
const BUNDLE_REL_SUFFIX: &str = "StreamingAssets/aa/StandaloneWindows64/";
const ADDRESSABLES_REL_PREFIX: &str = "com.unity.addressables/AssetBundles/";
const FORBIDDEN_ARCHIVE_EXTS: &[&str] = &[
    ".exe", ".dll", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jse", ".wsf", ".msi", ".msp",
    ".sh", ".scr", ".com", ".pif", ".lnk",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopDownloadFile {
    pub target: String,
    pub sha256: String,
    #[serde(default)]
    pub original_sha256: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub payload_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopInstallRequest {
    pub installation_id: String,
    pub mod_id: String,
    #[serde(default)]
    pub skip_conflicts: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishedMod {
    id: String,
    pub name: String,
    pub install_kind: String,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub download_url: Option<String>,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub files: Vec<WorkshopDownloadFile>,
    #[serde(default)]
    downloadable: bool,
}

#[derive(Deserialize)]
struct PublishedDetail {
    item: PublishedMod,
}

async fn published_mod(client: &reqwest::Client, id: &str) -> HubResult<PublishedMod> {
    let path = format!("/api/workshop/mods/{id}");
    let data = remote_content::read(client, &path, 2 * 1024 * 1024).await?;
    let published: PublishedDetail = serde_json::from_slice(&data)
        .map_err(|_| net_error("星枢工坊发布清单无法识别。"))?;
    if published.item.id != id || !published.item.downloadable {
        return Err(HubError::invalid_manifest("该条目尚未在星枢服务器发布可下载文件。"));
    }
    Ok(published.item)
}

pub(crate) async fn official_module_archive_with_progress<F>(
    id: &str,
    on_progress: F,
) -> HubResult<Vec<u8>>
where
    F: FnMut(u64, u64),
{
    let client = remote_content::client()?;
    let published = published_mod(&client, id).await?;
    let path = format!("/api/workshop/mods/{id}/download");
    if published.install_kind != "xspkg" || published.download_url.as_deref() != Some(&path) {
        return Err(HubError::invalid_manifest("该官方模块的服务器发布清单不完整。"));
    }
    remote_content::verified_with_progress(
        &client,
        &path,
        &published.sha256,
        published.size_bytes,
        64 * 1024,
        on_progress,
    )
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInstallProgress {
    pub mod_id: String,
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u8,
    pub detail: String,
}

pub(crate) fn emit_mod_progress(
    app: &AppHandle,
    mod_id: &str,
    stage: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
    percent: u8,
    detail: impl Into<String>,
) {
    let _ = app.emit(
        "xingshu:mod-install-progress",
        ModInstallProgress {
            mod_id: mod_id.to_string(),
            stage: stage.to_string(),
            downloaded_bytes,
            total_bytes,
            percent,
            detail: detail.into(),
        },
    );
}

pub(crate) fn scaled_download_percent(downloaded: u64, total: u64) -> u8 {
    if total == 0 {
        return 10;
    }
    let ratio = ((downloaded.saturating_mul(86)) / total).min(86) as u8;
    4 + ratio
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveModInstallProgress {
    pub installation_id: String,
    pub mod_id: String,
    pub task_id: u64,
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u8,
    pub detail: String,
}

static ACTIVE_INSTALLS: OnceLock<Mutex<HashMap<String, ActiveModInstallProgress>>> = OnceLock::new();
static NEXT_TASK_ID: AtomicU64 = AtomicU64::new(1);

fn active_installs() -> &'static Mutex<HashMap<String, ActiveModInstallProgress>> {
    ACTIVE_INSTALLS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct ActiveInstallGuard {
    installation_id: String,
    task_id: u64,
}

impl ActiveInstallGuard {
    fn try_acquire(installation_id: &str, mod_id: &str) -> HubResult<Self> {
        let trimmed = installation_id.trim();
        let key = if trimmed.is_empty() {
            installation_id.to_string()
        } else {
            trimmed.to_string()
        };
        let mut guard = active_installs()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(existing) = guard.get(&key) {
            return Err(HubError::new(
                "MOD_INSTALL_IN_PROGRESS",
                format!("当前目录正在处理「{}」，请等待完成后再操作。", existing.mod_id),
                "WORKSHOP",
            )
            .with_recoverable(true));
        }
        let task_id = NEXT_TASK_ID.fetch_add(1, Ordering::Relaxed);
        guard.insert(
            key.clone(),
            ActiveModInstallProgress {
                installation_id: key.clone(),
                mod_id: mod_id.to_string(),
                task_id,
                stage: "fetching_meta".into(),
                downloaded_bytes: 0,
                total_bytes: 0,
                percent: 2,
                detail: "正在获取模组清单…".into(),
            },
        );
        Ok(Self {
            installation_id: key,
            task_id,
        })
    }
}

impl Drop for ActiveInstallGuard {
    fn drop(&mut self) {
        let mut guard = active_installs()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.get(&self.installation_id).is_some_and(|e| e.task_id == self.task_id) {
            guard.remove(&self.installation_id);
        }
    }
}

fn emit_tracked_mod_progress(
    app: &AppHandle,
    installation_id: &str,
    task_id: u64,
    mod_id: &str,
    stage: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
    percent: u8,
    detail: impl Into<String>,
) {
    let detail_str = detail.into();
    let (clamped_dl, clamped_pct) = {
        let mut guard = active_installs()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(entry) = guard.get_mut(installation_id) {
            if entry.task_id == task_id {
                let next_dl = if stage == "downloading" && entry.stage == "downloading" {
                    entry.downloaded_bytes.max(downloaded_bytes)
                } else {
                    downloaded_bytes
                };
                let next_pct = if stage == "downloading" && entry.stage == "downloading" {
                    entry.percent.max(percent)
                } else {
                    percent
                };
                entry.mod_id = mod_id.to_string();
                entry.stage = stage.to_string();
                entry.downloaded_bytes = next_dl;
                entry.total_bytes = total_bytes;
                entry.percent = next_pct;
                entry.detail = detail_str.clone();
                (next_dl, next_pct)
            } else {
                (downloaded_bytes, percent)
            }
        } else {
            (downloaded_bytes, percent)
        }
    };
    emit_mod_progress(app, mod_id, stage, clamped_dl, total_bytes, clamped_pct, detail_str);
}

#[tauri::command]
pub fn workshop_active_install_progress(installation_id: String) -> Option<ActiveModInstallProgress> {
    let trimmed = installation_id.trim();
    let lookup = if trimmed.is_empty() { installation_id.as_str() } else { trimmed };
    let guard = active_installs()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    guard.get(lookup).cloned()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopLocalItemState {
    pub mod_id: String,
    pub name: String,
    pub phase: String,
    pub install_kind: String,
    pub source: String,
    pub linked_drop_id: Option<String>,
    pub transaction_id: Option<String>,
    pub downloaded_path: Option<String>,
    pub can_restore: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopInstallResult {
    pub mod_id: String,
    pub phase: String,
    pub message: String,
    pub downloaded_path: Option<String>,
    pub transaction_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkshopReceiptFile {
    index: usize,
    target: String,
    mod_sha256: String,
    baseline_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkshopReceipt {
    mod_id: String,
    name: String,
    install_kind: String,
    phase: String,
    transaction_id: Option<String>,
    downloaded_path: Option<String>,
    files: Vec<WorkshopReceiptFile>,
    #[serde(default)]
    archive_sha256: Option<String>,
}

pub(crate) struct StagedBundle {
    target_rel: String,
    expected_sha256: String,
    expected_original_sha256: String,
    bytes: Vec<u8>,
}

fn net_error(msg: impl Into<String>) -> HubError {
    HubError::new("WORKSHOP_NETWORK", msg, "WORKSHOP").with_recoverable(true)
}

pub(crate) fn sanitize_mod_id(mod_id: &str) -> HubResult<String> {
    let trimmed = mod_id.trim();
    let len = trimmed.len();
    let bytes = trimmed.as_bytes();
    if !(3..=65).contains(&len)
        || !bytes[0].is_ascii_alphanumeric()
        || !bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        || trimmed.contains("..")
    {
        return Err(HubError::security_violation("无效的工坊模组标识。"));
    }
    Ok(trimmed.to_string())
}

pub(crate) fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

/// Validates download URLs: enforces `https://` for remote origins and allows `http://` only for loopback dev servers.
fn confined(root: &Path, relative: &str) -> HubResult<PathBuf> {
    let clean = PathGuard::sanitize_relative_path(relative)?;
    PathGuard::ensure_within_root(root, &root.join(clean))
}

fn is_protected_runtime_bundle(bundle_id: &str) -> bool {
    crate::extension_center::profiles()
        .into_iter()
        .any(|p| p["bundleId"].as_str().is_some_and(|id| id.eq_ignore_ascii_case(bundle_id)))
}

fn active_game_data_dir(root: &Path) -> &'static str {
    VALID_DATA_DIRS
        .iter()
        .copied()
        .find(|dir| root.join(dir).is_dir())
        .unwrap_or("AstralParty_CN_Data")
}

pub(crate) fn validate_bundle_target(root: &Path, target_rel: &str) -> HubResult<(String, PathBuf)> {
    let clean = target_rel.trim().replace('\\', "/");
    let Some((data_dir, sub_rel)) = clean.split_once('/') else {
        return Err(HubError::security_violation("模组目标不在已核验的游戏资源目录中。"));
    };
    if !VALID_DATA_DIRS.contains(&data_dir) {
        return Err(HubError::security_violation("模组目标不在已核验的游戏资源目录中。"));
    }
    let bundle_id = if let Some(file_name) = sub_rel.strip_prefix(BUNDLE_REL_SUFFIX) {
        let stem = file_name.strip_suffix(".bundle").unwrap_or("");
        if stem.len() != 32 || !stem.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(HubError::security_violation("模组目标 Bundle 文件名格式无效。"));
        }
        stem
    } else if let Some(rest) = sub_rel.strip_prefix(ADDRESSABLES_REL_PREFIX) {
        let mut parts = rest.split('/');
        let group = parts.next().unwrap_or("");
        let hash = parts.next().unwrap_or("");
        let leaf = parts.next().unwrap_or("");
        let valid_group = !group.is_empty()
            && group != "."
            && group != ".."
            && group
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.'));
        let valid_hash = hash.len() == 32 && hash.bytes().all(|c| c.is_ascii_hexdigit());
        if !valid_group || !valid_hash || leaf != "__data" || parts.next().is_some() {
            return Err(HubError::security_violation("模组目标 Addressables 资产路径格式无效。"));
        }
        hash
    } else {
        return Err(HubError::security_violation("模组目标不在已核验的游戏资源目录中。"));
    };
    if is_protected_runtime_bundle(bundle_id) {
        return Err(HubError::security_violation("该资源属于星枢运行时核心容器，第三方模组禁止覆盖。"));
    }
    let resolved = confined(root, &clean)?;
    Ok((clean, resolved))
}

fn atomic_write(path: &Path, data: &[u8]) -> HubResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| HubError::storage_error("缺少写入目标父目录。"))?;
    fs::create_dir_all(parent).map_err(|e| HubError::storage_error(e.to_string()))?;
    let mut temp =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| HubError::storage_error(e.to_string()))?;
    temp.write_all(data)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| HubError::storage_error(e.to_string()))?;
    temp.persist(path)
        .map_err(|e| HubError::storage_error(e.to_string()))?;
    Ok(())
}

fn receipt_path(root: &Path, mod_id: &str) -> HubResult<PathBuf> {
    let clean_id = sanitize_mod_id(mod_id)?;
    confined(root, &format!(".xingshu-mods/workshop-receipts/{clean_id}.json"))
}

fn backup_file_path(root: &Path, mod_id: &str, index: usize) -> HubResult<PathBuf> {
    let clean_id = sanitize_mod_id(mod_id)?;
    confined(
        root,
        &format!(".xingshu-mods/workshop-backups/{clean_id}/baseline/{index}.bundle"),
    )
}

pub(crate) fn payload_file_path(root: &Path, mod_id: &str, index: usize) -> HubResult<PathBuf> {
    let clean_id = sanitize_mod_id(mod_id)?;
    confined(
        root,
        &format!(".xingshu-mods/workshop-payloads/{clean_id}/{index}.bundle"),
    )
}

fn xspkg_payload_path(root: &Path, mod_id: &str) -> HubResult<PathBuf> {
    let clean_id = sanitize_mod_id(mod_id)?;
    confined(
        root,
        &format!(".xingshu-mods/workshop-payloads/{clean_id}/package.xspkg"),
    )
}

fn payload_cache_dir(root: &Path) -> HubResult<PathBuf> {
    confined(root, ".xingshu-mods/payload-cache")
}

fn cached_payload_file(cache_dir: &Path, expected_sha256: &str) -> Option<PathBuf> {
    if expected_sha256.len() != 64 || !expected_sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some(cache_dir.join(format!("{}.bundle", expected_sha256.to_ascii_lowercase())))
}

fn read_verified_cached_payload(
    cache_dir: &Path,
    expected_sha256: &str,
    expected_size: u64,
) -> Option<Vec<u8>> {
    let path = cached_payload_file(cache_dir, expected_sha256)?;
    if !path.is_file() {
        return None;
    }
    let Ok(bytes) = fs::read(&path) else {
        return None;
    };
    let size_ok = expected_size == 0 || bytes.len() as u64 == expected_size;
    let hash_ok = sha256_hex(&bytes).eq_ignore_ascii_case(expected_sha256);
    if size_ok && hash_ok {
        return Some(bytes);
    }
    let _ = fs::remove_file(&path);
    None
}

fn write_cached_payload(cache_dir: &Path, expected_sha256: &str, bytes: &[u8]) {
    let Some(path) = cached_payload_file(cache_dir, expected_sha256) else {
        return;
    };
    if fs::create_dir_all(cache_dir).is_ok() {
        let _ = atomic_write(&path, bytes);
    }
}

fn read_workshop_receipt(root: &Path, mod_id: &str) -> HubResult<Option<WorkshopReceipt>> {
    let path = receipt_path(root, mod_id)?;
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read(&path).map_err(|e| HubError::storage_error(e.to_string()))?;
    let receipt: WorkshopReceipt =
        serde_json::from_slice(&raw).map_err(|e| HubError::storage_error(e.to_string()))?;
    if receipt.mod_id != mod_id
        || !matches!(
            receipt.phase.as_str(),
            "prepared" | "installed" | "restored" | "downloaded" | "disabled"
        )
    {
        return Err(HubError::security_violation("工坊安装收据校验无效。"));
    }
    Ok(Some(receipt))
}

fn save_workshop_receipt(root: &Path, receipt: &WorkshopReceipt) -> HubResult<()> {
    let path = receipt_path(root, &receipt.mod_id)?;
    let bytes = serde_json::to_vec_pretty(receipt).map_err(|e| HubError::storage_error(e.to_string()))?;
    atomic_write(&path, &bytes)
}

pub(crate) fn operation_lock(root: &Path) -> HubResult<fs::File> {
    let path = confined(root, ".xingshu-mods/operation.lock")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| HubError::storage_error(e.to_string()))?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    options
        .open(path)
        .map_err(|_| HubError::storage_error("另一个模组或扩展安装任务正在进行中，请稍后重试。"))
}

fn game_closed(game: &GameInstallation) -> HubResult<()> {
    ProcessGate::check_target(Path::new(
        game.executable_path.as_deref().unwrap_or_default(),
    ))
}

fn addressables_candidate_target(data_dir: &str, clean_entry: &str) -> Option<String> {
    const NEEDLE: &[u8] = b"com.unity.addressables/assetbundles/";
    let bytes = clean_entry.as_bytes();
    if bytes.len() < NEEDLE.len() {
        return None;
    }
    let pos = bytes.windows(NEEDLE.len()).position(|w| w.eq_ignore_ascii_case(NEEDLE))?;
    let rest = &clean_entry[pos + NEEDLE.len()..];
    Some(format!("{data_dir}/{ADDRESSABLES_REL_PREFIX}{rest}"))
}

fn bundle_candidate_target(data_dir: &str, clean_entry: &str) -> String {
    if let Some((prefix_dir, sub_rel)) = clean_entry.split_once('/') {
        if VALID_DATA_DIRS.contains(&prefix_dir) && sub_rel.starts_with(BUNDLE_REL_SUFFIX) {
            return clean_entry.to_string();
        }
    }
    let base_name = Path::new(clean_entry)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    format!("{data_dir}/{BUNDLE_REL_SUFFIX}{base_name}")
}

fn extract_bundle_entries_from_zip(
    root: &Path,
    archive_bytes: &[u8],
) -> HubResult<Vec<StagedBundle>> {
    let cursor = std::io::Cursor::new(archive_bytes);
    let mut zf = zip::ZipArchive::new(cursor)
        .map_err(|_| HubError::invalid_manifest("下载的模组压缩包已损坏，无法读取。"))?;
    if zf.is_empty() || zf.len() > MAX_ZIP_ENTRIES {
        return Err(HubError::security_violation("压缩包文件条目数量异常。"));
    }

    let data_dir = active_game_data_dir(root);
    let mut staged = Vec::new();
    let mut total_uncompressed: u64 = 0;
    let mut seen_targets = HashSet::new();

    for idx in 0..zf.len() {
        let mut entry = zf
            .by_index(idx)
            .map_err(|e| HubError::invalid_manifest(format!("读取压缩包条目失败：{e}")))?;
        if entry.is_symlink() {
            return Err(HubError::security_violation("出于安全限制，压缩包禁止包含符号链接。"));
        }
        let raw_name = crate::security::archive_guard::decode_zip_entry_name(entry.name_raw())
            .replace('\\', "/");
        if entry.is_dir() {
            if !raw_name.trim_matches('/').is_empty() {
                let _ = PathGuard::sanitize_relative_path(&raw_name)?;
            }
            continue;
        }
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_ZIP_UNCOMPRESSED_BYTES {
            return Err(HubError::security_violation("压缩包解压体积超过 2GB 安全上限。"));
        }
        let clean_entry = PathGuard::sanitize_relative_path(&raw_name)?
            .to_string_lossy()
            .replace('\\', "/");
        let lower = clean_entry.to_ascii_lowercase();
        if FORBIDDEN_ARCHIVE_EXTS.iter().any(|ext| lower.ends_with(ext)) {
            return Err(HubError::security_violation("压缩包禁止包含可执行脚本或二进制文件。"));
        }
        let candidate_target = if lower.ends_with(".bundle") {
            bundle_candidate_target(data_dir, &clean_entry)
        } else if let Some(addr) = addressables_candidate_target(data_dir, &clean_entry) {
            addr
        } else {
            continue;
        };
        let (target_rel, target_abs) = validate_bundle_target(root, &candidate_target)?;
        if !target_abs.is_file() {
            return Err(HubError::invalid_manifest(format!(
                "游戏目录中不存在对应的原始资产 {}，版本可能不匹配。",
                Path::new(&target_rel)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&target_rel)
            )));
        }
        if !seen_targets.insert(target_rel.clone()) {
            return Err(HubError::invalid_manifest("压缩包内包含重复的 Bundle 替换目标。"));
        }
        let mut data = Vec::new();
        entry
            .by_ref()
            .take((MAX_PAYLOAD_BYTES + 1) as u64)
            .read_to_end(&mut data)
            .map_err(|e| HubError::storage_error(e.to_string()))?;
        if data.is_empty() || data.len() > MAX_PAYLOAD_BYTES {
            return Err(HubError::security_violation("单个 Bundle 文件体积异常。"));
        }
        let digest = sha256_hex(&data);
        staged.push(StagedBundle {
            target_rel,
            expected_sha256: digest,
            expected_original_sha256: String::new(),
            bytes: data,
        });
    }
    if staged.is_empty() {
        return Err(HubError::invalid_manifest(
            "压缩包中未发现合法的 StandaloneWindows64 Bundle 或 Addressables 资源。",
        ));
    }
    Ok(staged)
}

pub(crate) fn read_local_archive(path: &Path, limit: u64) -> HubResult<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|e| HubError::storage_error(e.to_string()))?
        .take(limit + 1).read_to_end(&mut bytes).map_err(|e| HubError::storage_error(e.to_string()))?;
    if bytes.len() as u64 > limit {
        return Err(HubError::invalid_manifest("本地模组包大小超过限制。"));
    }
    Ok(bytes)
}

pub(crate) fn validate_cached_package(path: &Path, expected: Option<&str>, limit: u64) -> HubResult<()> {
    if !path.is_file() {
        return Err(HubError::storage_error("此模组缺少离线包。可先还原安装，再重新下载或导入以使用开关。"));
    }
    let data = read_local_archive(path, limit)?;
    if let Some(expected) = expected {
        if !sha256_hex(&data).eq_ignore_ascii_case(expected) {
            return Err(HubError::security_violation("离线模组包校验失败。"));
        }
        Ok(())
    } else {
        validate_community_package(path)
    }
}

pub(crate) fn validate_community_package(archive: &Path) -> HubResult<()> {
    let manifest = crate::packages::parser::PackageParser::parse_archive(archive)?;
    const RESOURCE_EXTENSIONS: &[&str] = &[
        "bundle", "png", "webp", "jpg", "jpeg", "ogg", "wav", "mp3", "webm", "mp4",
        "json", "ini", "txt", "atlas", "bytes", "mat", "asset",
    ];
    if !matches!(manifest.package.package_type.as_str(), "mod" | "resource-pack")
        || manifest.package.id.to_ascii_lowercase().starts_with("xingshu.launcher.")
        || manifest.files.iter().any(|file| {
            let target = file.target.replace('\\', "/");
            !(target.starts_with("game/mods/") || target.starts_with("game/resources/"))
                || !Path::new(&target).extension().and_then(|ext| ext.to_str())
                    .is_some_and(|ext| RESOURCE_EXTENSIONS.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)))
        })
    {
        return Err(HubError::security_violation("工坊资源包只能安装到游戏模组和资源目录。"));
    }
    Ok(())
}

fn is_addressables_target(target_rel: &str) -> bool {
    let clean = target_rel.trim().replace('\\', "/");
    clean
        .split_once('/')
        .is_some_and(|(_, sub)| sub.starts_with(ADDRESSABLES_REL_PREFIX))
}

fn format_conflict_error(conflicts: &[(String, String)], action: &str) -> HubError {
    let mut distinct_owners: Vec<String> = Vec::new();
    for (_, owner) in conflicts {
        if !distinct_owners.iter().any(|existing| existing == owner) {
            distinct_owners.push(owner.clone());
        }
    }
    let owners_str = if distinct_owners.is_empty() {
        "其他已启用模组".to_string()
    } else {
        distinct_owners.join("、")
    };
    let sample_files: Vec<String> = conflicts
        .iter()
        .take(3)
        .map(|(target, _)| {
            Path::new(target)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(target)
                .to_string()
        })
        .collect();
    let suffix = if conflicts.len() > 3 { " 等" } else { "" };
    let msg = if action == "启用" {
        format!(
            "目标资源与已启用模组冲突（共 {} 个文件）：已由 {} 占用（如 {}{}）。请先停用冲突项。",
            conflicts.len(),
            owners_str,
            sample_files.join("、"),
            suffix
        )
    } else {
        format!(
            "目标资源与已启用模组冲突（共 {} 个文件）：已由 {} 管理（如 {}{}）。请先停用冲突模组，或选择「跳过冲突文件继续安装」。",
            conflicts.len(),
            owners_str,
            sample_files.join("、"),
            suffix
        )
    };
    HubError::new("MOD_TARGET_CONFLICT", msg, "WORKSHOP").with_recoverable(true)
}

pub(crate) fn install_bundle_entries(
    game: &GameInstallation,
    root: &Path,
    mod_id: &str,
    mod_name: &str,
    staged: &[StagedBundle],
    skip_conflicts: bool,
) -> HubResult<(WorkshopReceipt, usize)> {
    let clean_id = sanitize_mod_id(mod_id)?;
    if staged.is_empty() {
        return Err(HubError::invalid_manifest("模组不含任何可安装的文件。"));
    }
    game_closed(game)?;

    if let Some(existing) = read_workshop_receipt(root, &clean_id)? {
        if existing.phase != "restored" {
            return Err(HubError::invalid_manifest("该模组当前已安装或处于未完成状态，请先执行还原。"));
        }
    }

    // Check legacy ModLibrary receipts too so we never double-install over an active ModLibrary entry.
    if clean_id.starts_with("local.") {
        let legacy_receipt = confined(root, &format!(".xingshu-mods/receipts/{clean_id}/receipt.json"))?;
        if legacy_receipt.is_file() {
            let text = fs::read_to_string(&legacy_receipt).unwrap_or_default();
            if text.contains("\"installed\"") || text.contains("\"prepared\"") {
                return Err(HubError::invalid_manifest("此模组已通过内置模组库启用，请勿重复安装。"));
            }
        }
    }

    let mut unique = HashSet::new();
    let owners = crate::dropped_mods::collect_active_target_owners(root, "")?;
    let mut conflicts: Vec<(String, String)> = Vec::new();
    let mut normalized_entries: Vec<(&StagedBundle, String, PathBuf, bool)> = Vec::with_capacity(staged.len());

    for entry in staged {
        let (norm_target, target_abs) = validate_bundle_target(root, &entry.target_rel)?;
        let target_id = target_key(&norm_target);
        if !unique.insert(target_id.clone()) {
            return Err(HubError::invalid_manifest("模组内包含重复的目标路径。"));
        }
        if let Some(owner) = owners.get(&target_id) {
            conflicts.push((norm_target, owner.clone()));
            continue;
        }
        let is_addr = is_addressables_target(&norm_target);
        normalized_entries.push((entry, norm_target, target_abs, is_addr));
    }

    if !conflicts.is_empty() && !skip_conflicts {
        return Err(format_conflict_error(&conflicts, "安装"));
    }
    if normalized_entries.is_empty() {
        return Err(HubError::invalid_manifest("所有目标资源均与其他已启用模组冲突，无剩余可安装文件。"));
    }
    let skipped_count = conflicts.len();

    let mut targets_and_baselines: Vec<(PathBuf, String, bool)> = Vec::with_capacity(normalized_entries.len());

    // Preflight every remaining file and verify checksums before mutating any game file.
    for (entry, _norm_target, target_abs, is_addr) in &normalized_entries {
        if sha256_hex(&entry.bytes) != entry.expected_sha256 {
            return Err(HubError::security_violation("暂存的模组字节校验失败。"));
        }
        let baseline_hash = if target_abs.is_file() {
            let current_hash = compute_file_sha256(target_abs)?;
            if !entry.expected_original_sha256.is_empty()
                && !current_hash.eq_ignore_ascii_case(&entry.expected_original_sha256)
            {
                return Err(HubError::security_violation(
                    "游戏原始资产哈希与适配基线不一致（可能版本不匹配或已被其他模组修改），已停止安装。",
                ));
            }
            if current_hash.eq_ignore_ascii_case(&entry.expected_sha256) {
                return Err(HubError::invalid_manifest(
                    "检测到游戏目录已存在相同外部模组文件且缺少备份，请先还原原版文件后再用星枢安装。",
                ));
            }
            current_hash
        } else if *is_addr {
            // Uncached Addressables container (__data) can be safely created and cleaned up on restore.
            String::new()
        } else {
            return Err(HubError::invalid_manifest(
                "游戏目标资产文件不存在，当前游戏版本或渠道可能尚未适配。",
            ));
        };
        targets_and_baselines.push((target_abs.clone(), baseline_hash, *is_addr));
    }

    let mut receipt_files = Vec::with_capacity(normalized_entries.len());
    for (idx, ((target_abs, baseline_hash, _is_addr), (entry, norm_target, _, _))) in
        targets_and_baselines.iter().zip(normalized_entries.iter()).enumerate()
    {
        if !baseline_hash.is_empty() {
            let backup_dest = backup_file_path(root, &clean_id, idx)?;
            let baseline_bytes = fs::read(target_abs).map_err(|e| HubError::storage_error(e.to_string()))?;
            if sha256_hex(&baseline_bytes) != *baseline_hash {
                return Err(HubError::security_violation("备份期间原游戏文件发生变化，已终止。"));
            }
            atomic_write(&backup_dest, &baseline_bytes)?;
            if compute_file_sha256(&backup_dest)? != *baseline_hash {
                return Err(HubError::security_violation("安装前备份校验失败。"));
            }
        }
        receipt_files.push(WorkshopReceiptFile {
            index: idx,
            target: norm_target.clone(),
            mod_sha256: entry.expected_sha256.clone(),
            baseline_sha256: baseline_hash.clone(),
        });
    }

    let mut receipt = WorkshopReceipt {
        mod_id: clean_id,
        name: mod_name.to_string(),
        install_kind: "bundle_mod".into(),
        phase: "prepared".into(),
        transaction_id: None,
        downloaded_path: None,
        files: receipt_files,
        archive_sha256: None,
    };

    game_closed(game)?;
    save_workshop_receipt(root, &receipt)?;

    let commit = (|| -> HubResult<()> {
        for (idx, ((target_abs, baseline_hash, is_addr), (entry, _, _, _))) in
            targets_and_baselines.iter().zip(normalized_entries.iter()).enumerate()
        {
            if let Ok(payload_dest) = payload_file_path(root, &receipt.mod_id, idx) {
                let _ = atomic_write(&payload_dest, &entry.bytes);
            }
            if *is_addr && baseline_hash.is_empty() {
                if let Some(parent_dir) = target_abs.parent() {
                    let info_path = parent_dir.join("__info");
                    if !info_path.exists() {
                        let ts = chrono::Utc::now().timestamp().max(0);
                        let _ = atomic_write(&info_path, format!("{ts}\n1\n{ts}\n").as_bytes());
                    }
                }
            }
            atomic_write(target_abs, &entry.bytes)?;
            let post_hash = compute_file_sha256(target_abs)?;
            if !post_hash.eq_ignore_ascii_case(&receipt.files[idx].mod_sha256) {
                return Err(HubError::security_violation("写入后的模组文件哈希校验失败。"));
            }
        }
        receipt.phase = "installed".into();
        save_workshop_receipt(root, &receipt)
    })();

    if let Err(err) = commit {
        return match restore_bundle_receipt(root, &receipt) {
            Ok(()) => Err(err),
            Err(rollback_err) => Err(HubError::storage_error(format!(
                "{err}；自动回滚未完成：{rollback_err}。已保留备份，请重试还原。"
            ))),
        };
    }

    Ok((receipt, skipped_count))
}

pub(crate) fn restore_bundle_receipt(root: &Path, receipt: &WorkshopReceipt) -> HubResult<()> {
    if receipt.phase == "restored" {
        return Ok(());
    }
    if receipt.files.is_empty() {
        return Err(HubError::storage_error("没有可还原的文件记录。"));
    }

    // Verify all backups and current target states before restoring any file.
    for f in &receipt.files {
        let (norm_target, target_abs) = validate_bundle_target(root, &f.target)?;
        let current_hash = if target_abs.is_file() {
            compute_file_sha256(&target_abs)?
        } else {
            String::new()
        };
        if f.baseline_sha256.is_empty() {
            if !is_addressables_target(&norm_target) {
                return Err(HubError::storage_error("安装前备份校验标识缺失，无法还原。"));
            }
            if !current_hash.is_empty() && !current_hash.eq_ignore_ascii_case(&f.mod_sha256) {
                return Err(HubError::security_violation(
                    "目标文件已被外部修改或游戏已更新，已停止还原以防覆盖。",
                ));
            }
            continue;
        }
        let backup_abs = backup_file_path(root, &receipt.mod_id, f.index)?;
        if !backup_abs.is_file() {
            return Err(HubError::storage_error("安装前备份文件缺失，无法还原。"));
        }
        if !compute_file_sha256(&backup_abs)?.eq_ignore_ascii_case(&f.baseline_sha256) {
            return Err(HubError::security_violation("安装前备份文件校验失败，停止还原。"));
        }
        if !current_hash.eq_ignore_ascii_case(&f.mod_sha256)
            && !current_hash.eq_ignore_ascii_case(&f.baseline_sha256)
        {
            return Err(HubError::security_violation(
                "目标文件已被外部修改或游戏已更新，已停止还原以防覆盖。",
            ));
        }
    }

    for f in &receipt.files {
        let (_, target_abs) = validate_bundle_target(root, &f.target)?;
        if f.baseline_sha256.is_empty() {
            if target_abs.is_file() {
                fs::remove_file(&target_abs).map_err(|e| HubError::storage_error(e.to_string()))?;
            }
            continue;
        }
        let backup_abs = backup_file_path(root, &receipt.mod_id, f.index)?;
        let baseline_bytes = fs::read(&backup_abs).map_err(|e| HubError::storage_error(e.to_string()))?;
        if !sha256_hex(&baseline_bytes).eq_ignore_ascii_case(&f.baseline_sha256) {
            return Err(HubError::security_violation("读取备份时校验不一致，停止还原。"));
        }
        atomic_write(&target_abs, &baseline_bytes)?;
        if !compute_file_sha256(&target_abs)?.eq_ignore_ascii_case(&f.baseline_sha256) {
            return Err(HubError::security_violation("还原后的文件校验失败，保留收据以便重试。"));
        }
    }

    let mut updated = receipt.clone();
    updated.phase = "restored".into();
    save_workshop_receipt(root, &updated)
}

#[tauri::command]
pub async fn workshop_list_local_state(
    installation_id: String,
    center: State<'_, ExtensionCenter>,
) -> HubResult<Vec<WorkshopLocalItemState>> {
    if installation_id.trim().is_empty() {
        return Ok(Vec::new());
    }
    let game = get_game(&center.db, &installation_id)?;
    tokio::task::spawn_blocking(move || {
        let root = game_root(&game)?;
        let mut states = Vec::new();
        let receipts = confined(&root, ".xingshu-mods/workshop-receipts")?;
        if receipts.is_dir() {
            for entry in fs::read_dir(&receipts).map_err(|e| HubError::storage_error(e.to_string()))?.flatten() {
                let path = entry.path();
                if path.extension().and_then(|ext| ext.to_str()) != Some("json") { continue; }
                if let Some(id) = path.file_stem().and_then(|stem| stem.to_str()) {
                    if let Ok(Some(receipt)) = read_workshop_receipt(&root, id) {
                        if let Ok(state) = local_state(&root, receipt) {
                            states.push(state);
                        }
                    }
                }
            }
        }
        states.extend(crate::external_mods::list_managed_library(&root)?);
        Ok(states)
    }).await.map_err(|e| HubError::storage_error(e.to_string()))?
}

fn downloaded_archive_path(root: &Path, id: &str) -> HubResult<PathBuf> {
    let id = sanitize_mod_id(id)?;
    confined(root, &format!(".xingshu-mods/downloads/{id}/{id}.zip"))
}

fn local_state(root: &Path, receipt: WorkshopReceipt) -> HubResult<WorkshopLocalItemState> {
    let mut phase = receipt.phase;
    let mut linked_drop_id = None;
    let mut downloaded_path = None;
    if receipt.install_kind == "external_archive" && phase == "downloaded" {
        let path = downloaded_archive_path(root, &receipt.mod_id)?;
        let id = crate::dropped_mods::derive_mod_id(&path);
        if let Some(drop) = crate::dropped_mods::managed_drop(root, &id)? {
            phase = drop.phase;
            linked_drop_id = Some(id);
        }
        if path.is_file() {
            downloaded_path = Some(path.display().to_string());
        }
    }
    Ok(WorkshopLocalItemState {
        mod_id: receipt.mod_id,
        name: receipt.name,
        install_kind: receipt.install_kind,
        source: "workshop".into(),
        linked_drop_id,
        can_restore: matches!(phase.as_str(), "installed" | "prepared" | "disabled" | "downloaded"),
        phase,
        transaction_id: receipt.transaction_id,
        downloaded_path,
    })
}

#[tauri::command]
pub async fn workshop_download_and_install(
    request: WorkshopInstallRequest,
    center: State<'_, ExtensionCenter>,
    install_service: State<'_, InstallService>,
    app: AppHandle,
) -> HubResult<WorkshopInstallResult> {
    let mod_id = sanitize_mod_id(&request.mod_id)?;
    let guard = ActiveInstallGuard::try_acquire(&request.installation_id, &mod_id)?;
    let track_id = guard.installation_id.clone();
    let task_id = guard.task_id;
    match run_workshop_download_and_install(&app, &track_id, task_id, &mod_id, request, &center, &install_service).await {
        Ok(result) => {
            emit_tracked_mod_progress(&app, &track_id, task_id, &mod_id, "done", 1, 1, 100, result.message.clone());
            Ok(result)
        }
        Err(err) => {
            emit_tracked_mod_progress(&app, &track_id, task_id, &mod_id, "error", 0, 0, 0, err.message.clone());
            Err(err)
        }
    }
}

async fn run_workshop_download_and_install(
    app: &AppHandle,
    installation_id: &str,
    task_id: u64,
    mod_id: &str,
    request: WorkshopInstallRequest,
    center: &ExtensionCenter,
    install_service: &InstallService,
) -> HubResult<WorkshopInstallResult> {
    let game = get_game(&center.db, &request.installation_id)?;
    let root = game_root(&game)?;
    game_closed(&game)?;
    emit_tracked_mod_progress(app, installation_id, task_id, mod_id, "fetching_meta", 0, 0, 2, "正在获取模组清单…");
    let client = remote_content::client()?;
    let published = published_mod(&client, mod_id).await?;
    if !published.platforms.iter().any(|p| p == &game.platform) {
        return Err(HubError::invalid_manifest(format!(
            "此模组适配 {}，与当前所选渠道 {} 不符。",
            published.platforms.join(" / "),
            game.platform
        )));
    }

    // Path 1: Explicit verified bundle file mapping (Seed items & curated bundle manifests).
    if published.install_kind == "bundle_mod" && !published.files.is_empty() {
        let total_declared = published.files.iter().try_fold(0_u64, |sum, f| sum.checked_add(f.size));
        if published.files.len() > MAX_ZIP_ENTRIES || total_declared.is_none_or(|n| n > MAX_ZIP_UNCOMPRESSED_BYTES) {
            return Err(HubError::security_violation("工坊资源数量或总大小超过限制。"));
        }

        // Preflight active target owners before downloading large payloads.
        let owners = crate::dropped_mods::collect_active_target_owners(&root, mod_id)?;
        let mut preflight_conflicts: Vec<(String, String)> = Vec::new();
        let mut downloadable: Vec<(&WorkshopDownloadFile, String)> = Vec::with_capacity(published.files.len());
        let mut unique_targets = HashSet::new();
        for f in &published.files {
            let (norm_target, _) = validate_bundle_target(&root, &f.target)?;
            let key = target_key(&norm_target);
            if !unique_targets.insert(key.clone()) {
                return Err(HubError::invalid_manifest("工坊模组清单包含重复的目标路径。"));
            }
            if let Some(owner) = owners.get(&key) {
                preflight_conflicts.push((norm_target, owner.clone()));
                continue;
            }
            downloadable.push((f, norm_target));
        }

        if !preflight_conflicts.is_empty() && !request.skip_conflicts {
            return Err(format_conflict_error(&preflight_conflicts, "安装"));
        }
        if downloadable.is_empty() {
            return Err(HubError::invalid_manifest("所有目标资源均与其他已启用模组冲突，无剩余可安装文件。"));
        }

        let total_bytes = downloadable.iter().fold(0_u64, |sum, (f, _)| sum.saturating_add(f.size));
        let file_count = downloadable.len();
        let skipped_before_download = preflight_conflicts.len();
        let cache_dir = payload_cache_dir(&root)?;

        struct DownloadPlanItem {
            idx: usize,
            norm_target: String,
            expected_sha256: String,
            expected_original_sha256: String,
            expected_size: u64,
            path: String,
        }

        let mut plan_items = Vec::with_capacity(file_count);
        for (idx, (f, norm_target)) in downloadable.iter().enumerate() {
            let path = format!("/api/workshop/mods/{mod_id}/payload/{}", f.sha256);
            if f.payload_url.as_deref() != Some(&path) {
                return Err(HubError::invalid_manifest("该资源没有星枢服务器下载地址。"));
            }
            plan_items.push(DownloadPlanItem {
                idx,
                norm_target: norm_target.clone(),
                expected_sha256: f.sha256.to_ascii_lowercase(),
                expected_original_sha256: f.original_sha256.to_ascii_lowercase(),
                expected_size: f.size,
                path,
            });
        }

        let mut results: Vec<Option<StagedBundle>> = (0..file_count).map(|_| None).collect();
        let mut pending = Vec::new();
        let mut cached_bytes = 0_u64;
        let mut done_files = 0_usize;

        for item in plan_items {
            if let Some(bytes) = read_verified_cached_payload(&cache_dir, &item.expected_sha256, item.expected_size) {
                cached_bytes = cached_bytes.saturating_add(item.expected_size);
                done_files += 1;
                results[item.idx] = Some(StagedBundle {
                    target_rel: item.norm_target,
                    expected_sha256: item.expected_sha256,
                    expected_original_sha256: item.expected_original_sha256,
                    bytes,
                });
            } else {
                pending.push(item);
            }
        }

        if cached_bytes > 0 {
            let pct = scaled_download_percent(cached_bytes, total_bytes);
            let msg = if pending.is_empty() {
                format!("已全部命中本地缓存 ({done_files}/{file_count})，准备安装…")
            } else {
                format!("已命中本地缓存 ({done_files}/{file_count})，正在并发下载剩余资源…")
            };
            emit_tracked_mod_progress(
                app,
                installation_id,
                task_id,
                mod_id,
                "downloading",
                cached_bytes,
                total_bytes,
                pct,
                msg,
            );
        }

        if !pending.is_empty() {
            let sem = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
            let aggregate_bytes = Arc::new(AtomicU64::new(cached_bytes));
            let completed_files = Arc::new(AtomicUsize::new(done_files));
            let last_emit = Arc::new(Mutex::new(
                Instant::now()
                    .checked_sub(Duration::from_millis(200))
                    .unwrap_or_else(Instant::now),
            ));
            let mut join_set: JoinSet<HubResult<(usize, StagedBundle)>> = JoinSet::new();

            for item in pending {
                let sem = Arc::clone(&sem);
                let client = client.clone();
                let cache_dir = cache_dir.clone();
                let app_handle = app.clone();
                let inst_id = installation_id.to_string();
                let mod_id_owned = mod_id.to_string();
                let agg_bytes = Arc::clone(&aggregate_bytes);
                let comp_files = Arc::clone(&completed_files);
                let last_emit = Arc::clone(&last_emit);

                join_set.spawn(async move {
                    let _permit = sem
                        .acquire_owned()
                        .await
                        .map_err(|_| HubError::storage_error("下载调度信号量已关闭。"))?;
                    let mut last_dl = 0_u64;
                    let bytes = remote_content::verified_with_progress(
                        &client,
                        &item.path,
                        &item.expected_sha256,
                        item.expected_size,
                        MAX_PAYLOAD_BYTES,
                        |dl, _| {
                            let delta = dl.saturating_sub(last_dl);
                            last_dl = dl;
                            let cur = agg_bytes
                                .fetch_add(delta, Ordering::Relaxed)
                                .saturating_add(delta);
                            let now = Instant::now();
                            let should_emit = if let Ok(mut guard) = last_emit.lock() {
                                if now.duration_since(*guard).as_millis() >= 80 || cur >= total_bytes {
                                    *guard = now;
                                    true
                                } else {
                                    false
                                }
                            } else {
                                false
                            };
                            if should_emit {
                                let done = comp_files.load(Ordering::Relaxed);
                                let pct = scaled_download_percent(cur, total_bytes);
                                emit_tracked_mod_progress(
                                    &app_handle,
                                    &inst_id,
                                    task_id,
                                    &mod_id_owned,
                                    "downloading",
                                    cur,
                                    total_bytes,
                                    pct,
                                    format!("正在并发下载资源 ({done}/{file_count})"),
                                );
                            }
                        },
                    )
                    .await?;

                    write_cached_payload(&cache_dir, &item.expected_sha256, &bytes);
                    let done_now = comp_files.fetch_add(1, Ordering::Relaxed) + 1;
                    let cur_now = agg_bytes.load(Ordering::Relaxed);
                    let pct_now = scaled_download_percent(cur_now, total_bytes);
                    emit_tracked_mod_progress(
                        &app_handle,
                        &inst_id,
                        task_id,
                        &mod_id_owned,
                        "downloading",
                        cur_now,
                        total_bytes,
                        pct_now,
                        format!("正在并发下载资源 ({done_now}/{file_count})"),
                    );
                    Ok((
                        item.idx,
                        StagedBundle {
                            target_rel: item.norm_target,
                            expected_sha256: item.expected_sha256,
                            expected_original_sha256: item.expected_original_sha256,
                            bytes,
                        },
                    ))
                });
            }

            while let Some(joined) = join_set.join_next().await {
                match joined {
                    Ok(Ok((idx, staged_item))) => {
                        results[idx] = Some(staged_item);
                    }
                    Ok(Err(err)) => {
                        join_set.abort_all();
                        return Err(err);
                    }
                    Err(join_err) => {
                        join_set.abort_all();
                        return Err(net_error(format!("模组下载任务异常中止：{join_err}")));
                    }
                }
            }
        }

        let staged: Vec<StagedBundle> = results
            .into_iter()
            .map(|entry| entry.ok_or_else(|| HubError::storage_error("模组下载结果不完整。")))
            .collect::<HubResult<Vec<_>>>()?;

        emit_tracked_mod_progress(app, installation_id, task_id, mod_id, "installing", total_bytes, total_bytes, 95, "正在备份原版文件并写入模组…");
        let name = published.name;
        let mod_id_owned = mod_id.to_string();
        let skip_conflicts = request.skip_conflicts;
        let (receipt, skipped_in_install) = tokio::task::spawn_blocking(move || {
            let _lock = operation_lock(&root)?;
            install_bundle_entries(&game, &root, &mod_id_owned, &name, &staged, skip_conflicts)
        })
        .await
        .map_err(|e| HubError::storage_error(e.to_string()))??;
        let total_skipped = skipped_before_download + skipped_in_install;
        let installed_count = receipt.files.len();

        return Ok(WorkshopInstallResult {
            mod_id: receipt.mod_id,
            phase: receipt.phase,
            message: if total_skipped > 0 {
                format!("已跳过 {total_skipped} 个冲突文件，完成剩余 {installed_count} 个资源的 SHA-256 核验与安装。")
            } else {
                "已下载并通过 SHA-256 核验、原子备份原版资产后完成安装。".into()
            },
            downloaded_path: None,
            transaction_id: None,
        });
    }

    // Path 2: Single downloadable package archive (.xspkg or .zip).
    let path = format!("/api/workshop/mods/{mod_id}/download");
    if published.download_url.as_deref() != Some(&path) {
        return Err(HubError::invalid_manifest("该条目没有星枢服务器托管包。"));
    }
    let total_bytes = published.size_bytes;
    emit_tracked_mod_progress(app, installation_id, task_id, mod_id, "downloading", 0, total_bytes, 4, "正在连接星枢工坊下载模组包…");
    let archive_bytes = remote_content::verified_with_progress(
        &client,
        &path,
        &published.sha256,
        published.size_bytes,
        MAX_ARCHIVE_BYTES,
        |dl, total| {
            let pct = scaled_download_percent(dl, total);
            emit_tracked_mod_progress(app, installation_id, task_id, mod_id, "downloading", dl, total, pct, "正在下载模组包…");
        },
    )
    .await?;

    emit_tracked_mod_progress(app, installation_id, task_id, mod_id, "verifying", total_bytes, total_bytes, 93, "正在校验 SHA-256 与资源清单…");

    if published.install_kind == "xspkg" {
        if mod_id.starts_with("xingshu.launcher.") {
            return Err(HubError::invalid_manifest("官方模块请使用启动器自带的模块安装入口。"));
        }

        let svc = install_service;
        let mod_name = published.name;
        let mod_id_owned = mod_id.to_string();
        emit_tracked_mod_progress(app, installation_id, task_id, mod_id, "installing", total_bytes, total_bytes, 97, "正在备份原版文件并写入模组…");
        let receipt = tokio::task::block_in_place(|| -> HubResult<WorkshopReceipt> {
            let work = tempfile::NamedTempFile::new().map_err(|e| HubError::storage_error(e.to_string()))?;
            fs::write(work.path(), &archive_bytes).map_err(|e| HubError::storage_error(e.to_string()))?;
            validate_community_package(work.path())?;
            let _lock = operation_lock(&root)?;
            game_closed(&game)?;
            if read_workshop_receipt(&root, &mod_id_owned)?.is_some_and(|receipt| receipt.phase != "restored") {
                return Err(HubError::invalid_manifest("此模组已有安装记录，请使用开关。"));
            }
            let pkg_cache = xspkg_payload_path(&root, &mod_id_owned)?;
            atomic_write(&pkg_cache, &archive_bytes)?;
            let tx = svc.install_mod_package_in_locked_root(work.path(), &game)?;
            if tx.state != "COMPLETED" {
                return Err(HubError::transaction_error("模组安装事务未完成。"));
            }
            let receipt = WorkshopReceipt {
                mod_id: mod_id_owned.clone(),
                name: mod_name,
                install_kind: "xspkg".into(),
                phase: "installed".into(),
                transaction_id: Some(tx.id.clone()),
                downloaded_path: None,
                files: Vec::new(),
                archive_sha256: Some(sha256_hex(&archive_bytes)),
            };
            save_workshop_receipt(&root, &receipt)?;
            Ok(receipt)
        })?;

        return Ok(WorkshopInstallResult {
            mod_id: receipt.mod_id,
            phase: receipt.phase,
            message: "已完成 .xspkg 安全验证并安装，可在模组页面或安装事务中一键回滚。".into(),
            downloaded_path: receipt.downloaded_path,
            transaction_id: receipt.transaction_id,
        });
    }

    if published.install_kind == "bundle_mod" {
        emit_tracked_mod_progress(app, installation_id, task_id, mod_id, "installing", total_bytes, total_bytes, 96, "正在解析压缩包、备份原版并写入…");
        let root_for_zip = root.clone();
        let name = published.name;
        let mod_id_owned = mod_id.to_string();
        let skip_conflicts = request.skip_conflicts;
        let (receipt, skipped_count) = tokio::task::spawn_blocking(move || {
            let _lock = operation_lock(&root_for_zip)?;
            let staged = extract_bundle_entries_from_zip(&root_for_zip, &archive_bytes)?;
            install_bundle_entries(&game, &root_for_zip, &mod_id_owned, &name, &staged, skip_conflicts)
        })
        .await
        .map_err(|e| HubError::storage_error(e.to_string()))??;
        let installed_count = receipt.files.len();

        return Ok(WorkshopInstallResult {
            mod_id: receipt.mod_id,
            phase: receipt.phase,
            message: if skipped_count > 0 {
                format!("已跳过 {skipped_count} 个冲突文件，备份原版并安装其余 {installed_count} 个资源。")
            } else {
                "已解析 Bundle 资源包、备份原版文件并完成安装。".into()
            },
            downloaded_path: None,
            transaction_id: None,
        });
    }

    if published.install_kind != "external_archive" {
        return Err(HubError::invalid_manifest("服务器提供了无法识别的模组类型。"));
    }
    // Generic archives are downloaded as data only.
    emit_mod_progress(app, mod_id, "installing", total_bytes, total_bytes, 97, "正在写入缓存压缩包…");
    let _lock = operation_lock(&root)?;
    let zip_path = downloaded_archive_path(&root, mod_id)?;
    if read_workshop_receipt(&root, mod_id)?.is_some_and(|receipt| receipt.phase != "restored") {
        return Err(HubError::invalid_manifest("模组已缓存，请从已安装 Mod 管理。"));
    }
    atomic_write(&zip_path, &archive_bytes)?;
    let receipt = WorkshopReceipt {
        mod_id: mod_id.to_string(),
        name: published.name,
        install_kind: "external_archive".into(),
        phase: "downloaded".into(),
        transaction_id: None,
        downloaded_path: Some(zip_path.display().to_string()),
        files: Vec::new(),
        archive_sha256: Some(sha256_hex(&archive_bytes)),
    };
    save_workshop_receipt(&root, &receipt)?;

    Ok(WorkshopInstallResult {
        mod_id: receipt.mod_id,
        phase: receipt.phase,
        message: format!(
            "已下载并校验压缩包至 {}（该包为通用压缩包格式，请按作者说明对照使用）。",
            zip_path.display()
        ),
        downloaded_path: receipt.downloaded_path,
        transaction_id: None,
    })
}

#[tauri::command]
pub async fn workshop_restore_mod(
    installation_id: String,
    mod_id: String,
    center: State<'_, ExtensionCenter>,
    install_service: State<'_, InstallService>,
) -> HubResult<String> {
    let clean_id = sanitize_mod_id(&mod_id)?;
    let game = get_game(&center.db, &installation_id)?;
    let root = game_root(&game)?;
    let service = install_service.inner();

    tokio::task::block_in_place(|| {
        let _lock = operation_lock(&root)?;
        game_closed(&game)?;
        let receipt = read_workshop_receipt(&root, &clean_id)?;
        if clean_id.starts_with("local.") && receipt.as_ref().is_none_or(|receipt| receipt.phase == "restored") {
            crate::external_mods::restore_item_by_id(&root, &clean_id)?;
            return Ok("已还原本地模组库条目。".into());
        }
        let mut receipt = receipt.ok_or_else(|| HubError::storage_error("未找到此模组的安装记录。"))?;
        match (receipt.install_kind.as_str(), receipt.phase.as_str()) {
            (_, "restored") => return Ok("模组已移除。".into()),
            (_, "disabled") => {},
            ("external_archive", "downloaded") => {
                let path = downloaded_archive_path(&root, &clean_id)?;
                let drop_id = crate::dropped_mods::derive_mod_id(&path);
                if crate::dropped_mods::managed_drop(&root, &drop_id)?.is_some() {
                    crate::dropped_mods::restore_dropped_in_locked_root(&game, &root, &drop_id, Some(service))?;
                }
                match fs::remove_file(path) {
                    Ok(()) => {},
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
                    Err(e) => return Err(HubError::storage_error(e.to_string())),
                }
            },
            ("xspkg", "installed" | "prepared") => {
                let tx = receipt.transaction_id.as_deref()
                    .ok_or_else(|| HubError::storage_error("缺少模组安装事务标识。"))?;
                service.rollback_mod_transaction(tx, &game.id)?;
            },
            ("bundle_mod", "installed" | "prepared") => {
                restore_bundle_receipt(&root, &receipt)?;
                return Ok("已还原安装前备份文件。".into());
            },
            _ => return Err(HubError::invalid_manifest("此模组没有可移除的安装记录。")),
        }
        receipt.phase = "restored".into();
        save_workshop_receipt(&root, &receipt)?;
        Ok("已移除模组。".into())
    })
}

#[tauri::command]
pub async fn workshop_toggle_mod(
    installation_id: String,
    mod_id: String,
    enabled: bool,
    center: State<'_, ExtensionCenter>,
    install_service: State<'_, InstallService>,
) -> HubResult<WorkshopLocalItemState> {
    let clean_id = sanitize_mod_id(&mod_id)?;
    let game = get_game(&center.db, &installation_id)?;
    let root = game_root(&game)?;
    let service = install_service.inner();

    tokio::task::block_in_place(|| {
        let _lock = operation_lock(&root)?;
        game_closed(&game)?;
        let receipt = read_workshop_receipt(&root, &clean_id)?;
        if clean_id.starts_with("local.") && receipt.as_ref().is_none_or(|receipt| receipt.phase == "restored") {
            return crate::external_mods::toggle_managed_library(&game, &root, &clean_id, enabled);
        }
        let mut receipt = receipt.ok_or_else(|| HubError::storage_error("未找到此模组的安装记录。"))?;

        if receipt.install_kind == "external_archive" && receipt.phase == "downloaded" {
            let path = downloaded_archive_path(&root, &clean_id)?;
            let drop_id = crate::dropped_mods::derive_mod_id(&path);
            if crate::dropped_mods::managed_drop(&root, &drop_id)?.is_some() {
                crate::dropped_mods::toggle_dropped_in_locked_root(&game, &root, &drop_id, enabled, service)?;
            } else if enabled {
                let bytes = read_local_archive(&path, MAX_ARCHIVE_BYTES as u64)?;
                if receipt.archive_sha256.as_ref().is_some_and(|expected| {
                    !sha256_hex(&bytes).eq_ignore_ascii_case(expected)
                }) {
                    return Err(HubError::security_violation("下载模组包校验失败，请移除后重新下载。"));
                }
                if crate::dropped_mods::is_xspkg_archive(&path)? {
                    validate_community_package(&path)?;
                }
                let backups = crate::storage::repositories::backup_repository::BackupRepository::new(center.db.clone());
                crate::dropped_mods::install_dropped_in_locked_root(
                    &game, &root, &path, false, Some(service), Some(&backups),
                )?;
            }
            return local_state(&root, receipt);
        }

        let phase = if enabled { "installed" } else { "disabled" };
        if receipt.phase == phase {
            return local_state(&root, receipt);
        }
        if !matches!(receipt.phase.as_str(), "installed" | "disabled") {
            return Err(HubError::invalid_manifest("请先还原上次未完成的模组操作。"));
        }

        match receipt.install_kind.as_str() {
            "xspkg" => {
                let cache = xspkg_payload_path(&root, &clean_id)?;
                validate_cached_package(&cache, receipt.archive_sha256.as_deref(), MAX_ARCHIVE_BYTES as u64)?;
                if enabled {
                    validate_community_package(&cache)?;
                    let tx = service.install_mod_package_in_locked_root(&cache, &game)?;
                    if tx.state != "COMPLETED" {
                        return Err(HubError::transaction_error("模组启用事务未完成。"));
                    }
                    receipt.transaction_id = Some(tx.id);
                } else {
                    let tx = receipt.transaction_id.as_deref()
                        .ok_or_else(|| HubError::storage_error("缺少模组安装事务标识。"))?;
                    service.rollback_mod_transaction(tx, &game.id)?;
                }
            },
            "bundle_mod" => {
                if enabled {
                    let owners = crate::dropped_mods::collect_active_target_owners(&root, &clean_id)?;
                    let conflicts: Vec<(String, String)> = receipt
                        .files
                        .iter()
                        .filter_map(|file| {
                            owners
                                .get(&target_key(&file.target))
                                .map(|owner| (file.target.clone(), owner.clone()))
                        })
                        .collect();
                    if !conflicts.is_empty() {
                        return Err(format_conflict_error(&conflicts, "启用"));
                    }
                }
                let files = receipt.files.iter().map(|file| {
                    let (_, target) = validate_bundle_target(&root, &file.target)?;
                    Ok(SwitchFile {
                        target,
                        baseline: backup_file_path(&root, &clean_id, file.index)?,
                        payload: payload_file_path(&root, &clean_id, file.index)?,
                        baseline_sha256: file.baseline_sha256.clone(),
                        mod_sha256: file.mod_sha256.clone(),
                    })
                }).collect::<HubResult<Vec<_>>>()?;
                mod_resources::set_enabled(&files, enabled)?;
            },
            _ => return Err(HubError::invalid_manifest("此模组类型不支持启停。")),
        }
        receipt.phase = phase.into();
        save_workshop_receipt(&root, &receipt)?;
        local_state(&root, receipt)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_mod_ids_and_confines_bundle_targets() {
        assert_eq!(sanitize_mod_id("local.658bfbc2cf723c8b").unwrap(), "local.658bfbc2cf723c8b");
        assert!(sanitize_mod_id("../escape").is_err());
        assert!(sanitize_mod_id("sub.1234/evil").is_err());
        let dir = tempfile::tempdir().unwrap();
        let valid_target = "AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64/0123456789abcdef0123456789abcdef.bundle";
        assert!(validate_bundle_target(dir.path(), valid_target).is_ok());
        assert!(validate_bundle_target(dir.path(), "AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64/bad.bundle").is_err());
        assert!(validate_bundle_target(dir.path(), "../../etc/passwd").is_err());
    }

    fn fixture_game(root: &Path) -> (GameInstallation, String, Vec<u8>, Vec<u8>) {
        let exe = root.join("AstralParty_CN.exe");
        fs::write(&exe, b"exe").unwrap();
        fs::write(root.join("GameAssembly.dll"), b"dll").unwrap();
        let rel = "AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64/0123456789abcdef0123456789abcdef.bundle";
        let abs = root.join(rel);
        fs::create_dir_all(abs.parent().unwrap()).unwrap();
        let orig = b"original-bundle-content".to_vec();
        let modded = b"workshop-skin-content".to_vec();
        fs::write(&abs, &orig).unwrap();
        let game = GameInstallation {
            id: "inst-1".into(),
            platform: "STEAM_CN".into(),
            platform_app_id: None,
            install_path: root.display().to_string(),
            executable_path: Some(exe.display().to_string()),
            detected_build_id: None,
            detected_version: None,
            detection_method: "TEST".into(),
            is_valid: true,
            is_primary: true,
            last_verified_at: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        (game, rel.into(), orig, modded)
    }

    #[test]
    fn bundle_install_and_restore_roundtrip_with_backup_verification() {
        let tmp = tempfile::tempdir().unwrap();
        let (game, rel, orig, modded) = fixture_game(tmp.path());
        let staged = vec![StagedBundle {
            target_rel: rel.clone(),
            expected_sha256: sha256_hex(&modded),
            expected_original_sha256: sha256_hex(&orig),
            bytes: modded.clone(),
        }];

        let (receipt, skipped) = install_bundle_entries(&game, tmp.path(), "sub.test001", "Test Skin", &staged, false).unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(receipt.phase, "installed");
        assert_eq!(fs::read(tmp.path().join(&rel)).unwrap(), modded);

        // Duplicate install before restore is rejected.
        assert!(install_bundle_entries(&game, tmp.path(), "sub.test001", "Test Skin", &staged, false).is_err());

        restore_bundle_receipt(tmp.path(), &receipt).unwrap();
        assert_eq!(fs::read(tmp.path().join(&rel)).unwrap(), orig);
        let stored = read_workshop_receipt(tmp.path(), "sub.test001").unwrap().unwrap();
        assert_eq!(stored.phase, "restored");
    }

    #[test]
    fn baseline_mismatch_aborts_before_creating_backups() {
        let tmp = tempfile::tempdir().unwrap();
        let (game, rel, _orig, modded) = fixture_game(tmp.path());
        let staged = vec![StagedBundle {
            target_rel: rel.clone(),
            expected_sha256: sha256_hex(&modded),
            expected_original_sha256: "f".repeat(64),
            bytes: modded,
        }];
        assert!(install_bundle_entries(&game, tmp.path(), "sub.test002", "Bad Baseline", &staged, false).is_err());
        assert!(!tmp.path().join(".xingshu-mods/workshop-backups").exists());
    }

    #[test]
    fn running_game_process_blocks_install() {
        let tmp = tempfile::tempdir().unwrap();
        let (mut game, rel, orig, modded) = fixture_game(tmp.path());
        game.executable_path = Some(std::env::current_exe().unwrap().display().to_string());
        let staged = vec![StagedBundle {
            target_rel: rel,
            expected_sha256: sha256_hex(&modded),
            expected_original_sha256: sha256_hex(&orig),
            bytes: modded,
        }];
        assert!(install_bundle_entries(&game, tmp.path(), "sub.test003", "Running Game", &staged, false).is_err());
    }

    #[test]
    fn extracts_only_safe_bundle_entries_from_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let (_game, rel, _orig, modded) = fixture_game(tmp.path());
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default();
            z.start_file("0123456789abcdef0123456789abcdef.bundle", opts).unwrap();
            z.write_all(&modded).unwrap();
            z.finish().unwrap();
        }
        let staged = extract_bundle_entries_from_zip(tmp.path(), buf.get_ref()).unwrap();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].target_rel, rel);

        let mut bad_buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut bad_buf);
            let opts = zip::write::SimpleFileOptions::default();
            z.start_file("evil.dll", opts).unwrap();
            z.write_all(b"mz").unwrap();
            z.finish().unwrap();
        }
        assert!(extract_bundle_entries_from_zip(tmp.path(), bad_buf.get_ref()).is_err());
    }

    #[test]
    fn validates_and_extracts_addressables_and_gbk_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let (game, bundle_rel, orig, modded) = fixture_game(tmp.path());
        let addr_rel = "AstralParty_CN_Data/com.unity.addressables/AssetBundles/cards_all/fedcba9876543210fedcba9876543210/__data";
        let addr_abs = tmp.path().join(addr_rel);
        fs::create_dir_all(addr_abs.parent().unwrap()).unwrap();
        fs::write(&addr_abs, b"orig-addr").unwrap();

        assert!(validate_bundle_target(tmp.path(), addr_rel).is_ok());
        assert!(validate_bundle_target(
            tmp.path(),
            "AstralParty_CN_Data/com.unity.addressables/AssetBundles/../evil/fedcba9876543210fedcba9876543210/__data",
        ).is_err());
        // Protected runtime bundle container cannot be overwritten by a community mod.
        assert!(validate_bundle_target(
            tmp.path(),
            "AstralParty_CN_Data/com.unity.addressables/AssetBundles/core/21b07f52b18434b20781372324ee459f/__data",
        ).is_err());

        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default();
            z.start_file("0123456789abcdef0123456789abcdef.bundle", opts).unwrap();
            z.write_all(&modded).unwrap();
            z.start_file("com.unity.addressables/AssetBundles/cards_all/fedcba9876543210fedcba9876543210/__data", opts).unwrap();
            z.write_all(b"mod-addr").unwrap();
            z.finish().unwrap();
        }
        assert!(!crate::security::archive_guard::decode_zip_entry_name(b"\xBF\xA8\xC3\xE6.txt").is_empty());
        let staged = extract_bundle_entries_from_zip(tmp.path(), buf.get_ref()).unwrap();
        assert_eq!(staged.len(), 2);
        assert!(staged.iter().any(|s| s.target_rel == bundle_rel));
        assert!(staged.iter().any(|s| s.target_rel == addr_rel));

        // Full install -> toggle disabled/enabled -> restore roundtrip on mixed .bundle + Addressables __data
        let (receipt, _) = install_bundle_entries(&game, tmp.path(), "sub.mixed01", "NunNan Mixed", &staged, false).unwrap();
        assert_eq!(fs::read(tmp.path().join(&bundle_rel)).unwrap(), modded);
        assert_eq!(fs::read(&addr_abs).unwrap(), b"mod-addr");
        restore_bundle_receipt(tmp.path(), &receipt).unwrap();
        assert_eq!(fs::read(tmp.path().join(&bundle_rel)).unwrap(), orig);
        assert_eq!(fs::read(&addr_abs).unwrap(), b"orig-addr");
    }

    #[test]
    fn reports_conflicting_owner_and_supports_skip_conflicts() {
        let tmp = tempfile::tempdir().unwrap();
        let (game, rel_a, orig_a, mod_a) = fixture_game(tmp.path());
        let rel_b = "AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64/fedcba9876543210fedcba9876543210.bundle";
        let abs_b = tmp.path().join(rel_b);
        let orig_b = b"orig-bundle-b".to_vec();
        let mod_b = b"skin-bundle-b".to_vec();
        fs::write(&abs_b, &orig_b).unwrap();

        let staged_first = vec![StagedBundle {
            target_rel: rel_a.clone(),
            expected_sha256: sha256_hex(&mod_a),
            expected_original_sha256: sha256_hex(&orig_a),
            bytes: mod_a.clone(),
        }];
        let (receipt_first, _) = install_bundle_entries(&game, tmp.path(), "sub.cards01", "NunNan Card Pack", &staged_first, false).unwrap();

        let alt_a = b"hannah-card-override".to_vec();
        let staged_second = vec![
            StagedBundle {
                target_rel: rel_a.clone(),
                expected_sha256: sha256_hex(&alt_a),
                expected_original_sha256: sha256_hex(&orig_a),
                bytes: alt_a,
            },
            StagedBundle {
                target_rel: rel_b.to_string(),
                expected_sha256: sha256_hex(&mod_b),
                expected_original_sha256: sha256_hex(&orig_b),
                bytes: mod_b.clone(),
            },
        ];

        let err = install_bundle_entries(&game, tmp.path(), "sub.skin01", "Hannah Skin", &staged_second, false).unwrap_err();
        assert_eq!(err.code, "MOD_TARGET_CONFLICT");
        assert!(err.message.contains("NunNan Card Pack"), "msg: {}", err.message);
        assert!(err.message.contains("0123456789abcdef0123456789abcdef.bundle"), "msg: {}", err.message);

        // Retry with skip_conflicts = true -> keeps NunNan's file, installs rel_b cleanly.
        let (receipt_second, skipped) = install_bundle_entries(&game, tmp.path(), "sub.skin01", "Hannah Skin", &staged_second, true).unwrap();
        assert_eq!(skipped, 1);
        assert_eq!(receipt_second.files.len(), 1);
        assert_eq!(fs::read(tmp.path().join(&rel_a)).unwrap(), mod_a);
        assert_eq!(fs::read(&abs_b).unwrap(), mod_b);

        // Both restore independently without interfering with each other.
        restore_bundle_receipt(tmp.path(), &receipt_second).unwrap();
        assert_eq!(fs::read(&abs_b).unwrap(), orig_b);
        assert_eq!(fs::read(tmp.path().join(&rel_a)).unwrap(), mod_a);
        restore_bundle_receipt(tmp.path(), &receipt_first).unwrap();
        assert_eq!(fs::read(tmp.path().join(&rel_a)).unwrap(), orig_a);
    }

    #[test]
    fn installs_and_restores_uncached_addressables_target() {
        let tmp = tempfile::tempdir().unwrap();
        let (game, _, _, _) = fixture_game(tmp.path());
        let addr_rel = "AstralParty_CN_Data/com.unity.addressables/AssetBundles/432565258568be7410c7dea80140f95c/9648aae2b918d4ab199afe74fa2a55b7/__data";
        let addr_abs = tmp.path().join(addr_rel);
        let mod_voice = b"custom-wwise-bank-payload".to_vec();

        let staged = vec![StagedBundle {
            target_rel: addr_rel.to_string(),
            expected_sha256: sha256_hex(&mod_voice),
            expected_original_sha256: "deadbeef".repeat(8),
            bytes: mod_voice.clone(),
        }];

        let (receipt, skipped) = install_bundle_entries(&game, tmp.path(), "sub.voice01", "Hannah Voice", &staged, false).unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(receipt.files[0].baseline_sha256, "");
        assert_eq!(fs::read(&addr_abs).unwrap(), mod_voice);
        assert!(addr_abs.parent().unwrap().join("__info").is_file());

        // Toggling off/on via mod_resources::set_enabled works cleanly for empty baseline_sha256.
        let (_, target) = validate_bundle_target(tmp.path(), addr_rel).unwrap();
        let switch = [SwitchFile {
            target,
            baseline: backup_file_path(tmp.path(), "sub.voice01", 0).unwrap(),
            payload: payload_file_path(tmp.path(), "sub.voice01", 0).unwrap(),
            baseline_sha256: receipt.files[0].baseline_sha256.clone(),
            mod_sha256: receipt.files[0].mod_sha256.clone(),
        }];
        mod_resources::set_enabled(&switch, false).unwrap();
        assert!(!addr_abs.exists());
        mod_resources::set_enabled(&switch, true).unwrap();
        assert_eq!(fs::read(&addr_abs).unwrap(), mod_voice);

        restore_bundle_receipt(tmp.path(), &receipt).unwrap();
        assert!(!addr_abs.exists());
    }

    #[test]
    fn rejects_duplicate_in_flight_install_and_releases_on_drop() {
        let inst_id = "__test_single_flight_inst__";
        {
            let guard = ActiveInstallGuard::try_acquire(inst_id, "local.mod_a").unwrap();
            let err = match ActiveInstallGuard::try_acquire(inst_id, "local.mod_b") {
                Ok(_) => panic!("expected duplicate acquire to fail"),
                Err(err) => err,
            };
            assert_eq!(err.code, "MOD_INSTALL_IN_PROGRESS");
            assert!(err.message.contains("local.mod_a"));
            let snapshot = workshop_active_install_progress(inst_id.to_string()).unwrap();
            assert_eq!(snapshot.mod_id, "local.mod_a");
            assert_eq!(snapshot.task_id, guard.task_id);
        }
        assert!(workshop_active_install_progress(inst_id.to_string()).is_none());
        let reacquired = ActiveInstallGuard::try_acquire(inst_id, "local.mod_b").unwrap();
        drop(reacquired);
    }

    #[test]
    fn payload_cache_reuses_valid_bundle_and_purges_corrupt_file() {
        let tmp = tempfile::tempdir().unwrap();
        let cache_dir = payload_cache_dir(tmp.path()).unwrap();
        let payload = b"valid unity asset bundle payload bytes".to_vec();
        let digest = sha256_hex(&payload);

        write_cached_payload(&cache_dir, &digest, &payload);
        let hit = read_verified_cached_payload(&cache_dir, &digest, payload.len() as u64).unwrap();
        assert_eq!(hit, payload);

        // Corrupt file in cache -> must fail verification and purge stale file.
        let cached_file = cached_payload_file(&cache_dir, &digest).unwrap();
        fs::write(&cached_file, b"tampered-bytes").unwrap();
        assert!(read_verified_cached_payload(&cache_dir, &digest, payload.len() as u64).is_none());
        assert!(!cached_file.exists());
    }
}
