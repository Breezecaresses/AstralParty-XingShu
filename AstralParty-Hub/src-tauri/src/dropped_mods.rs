//! Drag-and-drop mod archive / bundle / folder inspector, atomic installer, and restorer.
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Manager, State};
use walkdir::WalkDir;

use crate::application::install_service::InstallService;
use crate::domain::error::{HubError, HubResult};
use crate::domain::installation::{Backup, GameInstallation};
use crate::extension_center::{game_root, get_game, ExtensionCenter};
use crate::install::gates::ProcessGate;
use crate::packages::manifest::HubPackageManifestV1;
use crate::packages::parser::PackageParser;
use crate::security::archive_guard::{decode_zip_entry_name, ArchiveGuard, ArchiveLimits};
use crate::security::hash::compute_file_sha256;
use crate::security::path_guard::PathGuard;
use crate::mod_resources::{self, SwitchFile, target_key};
use crate::workshop::operation_lock;
use crate::storage::repositories::BackupRepository;

const MAX_DROP_ARCHIVE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_DROP_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_DROP_PAYLOAD_BYTES: usize = 512 * 1024 * 1024;
const MAX_DROP_ENTRIES: usize = 4000;

const FORBIDDEN_EXTS: &[&str] = &[
    ".exe", ".dll", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jse", ".wsf", ".msi", ".msp",
    ".sh", ".scr", ".com", ".pif", ".lnk",
];

const PREVIEW_EXTS: &[&str] = &[".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".webm"];
const MODIMG_EXTS: &[&str] = &[".png", ".jpg", ".jpeg", ".webp"];
const DYNAMIC_CARDS_DIR: &str = "xingshu_dynamic_cards";
const DYNAMIC_CARD_EXTS: &[&str] = &[".mp4", ".webm", ".mov", ".usm", ".bundle"];
const SKIP_BACKUP_DIRS: &[&str] = &["原", "原版", "backup", "backups", "original", "originals"];
const DOC_EXTS: &[&str] = &[".txt", ".md", ".pdf"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedModTargetMatch {
    pub source_entry: String,
    pub target_rel: String,
    pub bundle_id: String,
    pub target_kind: String,
    pub size: u64,
    pub sha256: String,
    pub current_sha256: String,
    pub already_same: bool,
    pub is_catalog: bool,
    pub risk_level: String,
    pub conflict_with: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedModUnmatchedFile {
    pub source_entry: String,
    pub reason: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedModInspectResult {
    pub mod_id: String,
    pub display_name: String,
    pub source_path: String,
    pub source_kind: String,
    pub installation_id: String,
    pub game_platform: String,
    pub game_root: String,
    pub compatible: bool,
    pub can_install: bool,
    pub already_installed: bool,
    pub has_catalog_bundle: bool,
    #[serde(default)]
    pub android_exportable_count: usize,
    pub warnings: Vec<String>,
    pub matched_files: Vec<DroppedModTargetMatch>,
    pub unmatched_files: Vec<DroppedModUnmatchedFile>,
    pub conflicts: Vec<String>,
    pub preview_files: Vec<String>,
    pub doc_files: Vec<String>,
    pub xspkg_manifest: Option<HubPackageManifestV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedModInstallResult {
    pub mod_id: String,
    pub display_name: String,
    pub phase: String,
    pub message: String,
    pub installed_count: usize,
    pub backup_id: Option<String>,
    pub transaction_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedModRecord {
    pub mod_id: String,
    pub name: String,
    pub source_kind: String,
    pub phase: String,
    pub installed_at: String,
    pub file_count: usize,
    pub targets: Vec<String>,
    pub has_catalog: bool,
    pub can_restore: bool,
    pub transaction_id: Option<String>,
    pub backup_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DroppedModReceiptFile {
    index: usize,
    target: String,
    mod_sha256: String,
    baseline_sha256: String,
    #[serde(default)]
    is_catalog: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DroppedModReceipt {
    mod_id: String,
    name: String,
    source_kind: String,
    phase: String,
    installed_at: String,
    transaction_id: Option<String>,
    backup_id: Option<String>,
    files: Vec<DroppedModReceiptFile>,
    #[serde(default)]
    archive_sha256: Option<String>,
}

struct DiscoveredTargets {
    /// Lowercase 32-hex bundle id -> list of `(relative_path_under_root, target_kind)`
    by_hex: HashMap<String, Vec<(String, String)>>,
    /// Lowercase 32-hex Addressables group folder -> list of `(relative_path_under_root, target_kind)`
    by_addr_group: HashMap<String, Vec<(String, String)>>,
    /// Relative path under `StreamingAssets/aa/` (lowercased) -> `(relative_path_under_root, target_kind)`
    by_aa_rel: HashMap<String, (String, String)>,
    /// Exact `<DataDir>/StreamingAssets/aa/catalog.bundle` targets
    catalog_targets: Vec<String>,
    /// Protected XingShu runtime bundle ID for the selected channel
    protected_runtime_bundle_id: Option<String>,
}

#[derive(Debug)]
struct StagedCandidate {
    target_rel: String,
    is_catalog: bool,
    bytes: Vec<u8>,
    sha256: String,
}

fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

fn is_hex32(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn sanitize_mod_id(mod_id: &str) -> HubResult<String> {
    let trimmed = mod_id.trim();
    let bytes = trimmed.as_bytes();
    if !(3..=64).contains(&trimmed.len())
        || !bytes[0].is_ascii_alphanumeric()
        || !bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        || trimmed.contains("..")
    {
        return Err(HubError::security_violation("无效的模组标识。"));
    }
    Ok(trimmed.to_string())
}

fn confined(root: &Path, relative: &str) -> HubResult<PathBuf> {
    let clean = PathGuard::sanitize_relative_path(relative)?;
    PathGuard::ensure_within_root(root, &root.join(clean))
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

fn game_closed(game: &GameInstallation) -> HubResult<()> {
    ProcessGate::check_target(Path::new(
        game.executable_path.as_deref().unwrap_or_default(),
    ))
}

fn receipt_path(root: &Path, mod_id: &str) -> HubResult<PathBuf> {
    let clean_id = sanitize_mod_id(mod_id)?;
    confined(root, &format!(".xingshu-mods/dropped-receipts/{clean_id}.json"))
}

fn backup_file_path(root: &Path, mod_id: &str, index: usize) -> HubResult<PathBuf> {
    let clean_id = sanitize_mod_id(mod_id)?;
    confined(
        root,
        &format!(".xingshu-mods/dropped-backups/{clean_id}/baseline/{index}.bundle"),
    )
}

pub(crate) fn payload_file_path(root: &Path, mod_id: &str, index: usize) -> HubResult<PathBuf> {
    let clean_id = sanitize_mod_id(mod_id)?;
    confined(
        root,
        &format!(".xingshu-mods/dropped-payloads/{clean_id}/{index}.bundle"),
    )
}

fn xspkg_payload_path(root: &Path, mod_id: &str) -> HubResult<PathBuf> {
    let clean_id = sanitize_mod_id(mod_id)?;
    confined(
        root,
        &format!(".xingshu-mods/dropped-payloads/{clean_id}/package.xspkg"),
    )
}

fn read_receipt(root: &Path, mod_id: &str) -> HubResult<Option<DroppedModReceipt>> {
    let path = receipt_path(root, mod_id)?;
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read(&path).map_err(|e| HubError::storage_error(e.to_string()))?;
    let receipt: DroppedModReceipt =
        serde_json::from_slice(&raw).map_err(|e| HubError::storage_error(e.to_string()))?;
    if receipt.mod_id != mod_id
        || !matches!(receipt.phase.as_str(), "prepared" | "installed" | "restored" | "disabled")
    {
        return Err(HubError::security_violation("本地模组收据校验无效。"));
    }
    Ok(Some(receipt))
}

fn save_receipt(root: &Path, receipt: &DroppedModReceipt) -> HubResult<()> {
    let path = receipt_path(root, &receipt.mod_id)?;
    let bytes = serde_json::to_vec_pretty(receipt).map_err(|e| HubError::storage_error(e.to_string()))?;
    atomic_write(&path, &bytes)
}

fn modimg_target_name(clean_rel: &str) -> Option<String> {
    let norm = clean_rel.trim().replace('\\', "/");
    let parts: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
    for (idx, part) in parts.iter().enumerate() {
        if part.eq_ignore_ascii_case("modimg") && idx + 2 == parts.len() {
            let fname = parts[idx + 1];
            let lower = fname.to_ascii_lowercase();
            if MODIMG_EXTS.iter().any(|ext| lower.ends_with(ext)) && !fname.contains("..") {
                return Some(fname.to_string());
            }
        }
    }
    None
}

fn is_valid_dynamic_card_filename(fname: &str, allow_extensionless: bool) -> bool {
    if fname.is_empty() || fname.contains("..") || fname.contains('/') || fname.contains('\\') || fname.contains(':') {
        return false;
    }
    let lower = fname.to_ascii_lowercase();
    if DYNAMIC_CARD_EXTS.iter().any(|ext| lower.ends_with(ext)) {
        return true;
    }
    allow_extensionless && !fname.contains('.')
}

fn dynamic_card_target_name(clean_rel: &str, bytes: &[u8]) -> Option<String> {
    let norm = clean_rel.trim().replace('\\', "/");
    let parts: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
    let leaf = (*parts.last()?).to_string();
    let in_dynamic_dir = parts.len() >= 2 && parts[parts.len() - 2].eq_ignore_ascii_case(DYNAMIC_CARDS_DIR);
    let leaf_lower = leaf.to_ascii_lowercase();
    if in_dynamic_dir && is_valid_dynamic_card_filename(&leaf, false) {
        return Some(leaf);
    }
    if leaf_lower.starts_with("vut_") {
        if DYNAMIC_CARD_EXTS.iter().any(|ext| leaf_lower.ends_with(ext)) && !leaf.contains("..") {
            return Some(leaf);
        }
        if !leaf.contains('.') && bytes.starts_with(b"UnityFS") && !leaf.contains("..") {
            return Some(format!("{leaf}.bundle"));
        }
    }
    None
}

fn is_addon_target_rel(target_rel: &str) -> bool {
    target_rel.starts_with("modimg/") || target_rel.starts_with("xingshu_dynamic_cards/")
}

fn validate_dropped_target_rel(root: &Path, target_rel: &str) -> HubResult<(String, PathBuf)> {
    let clean = target_rel.trim().replace('\\', "/");
    let parts: Vec<&str> = clean.split('/').collect();
    let valid_modimg = parts.len() == 2
        && parts[0] == "modimg"
        && MODIMG_EXTS.iter().any(|ext| parts[1].to_ascii_lowercase().ends_with(ext));
    let valid_dynamic_card = parts.len() == 2
        && parts[0] == DYNAMIC_CARDS_DIR
        && is_valid_dynamic_card_filename(parts[1], false);
    let valid_shape = valid_modimg
        || valid_dynamic_card
        || (parts.len() >= 4
            && parts[0].ends_with("_Data")
            && ((parts[1] == "StreamingAssets"
                && parts[2] == "aa"
                && parts.last().is_some_and(|f| f.ends_with(".bundle")))
                || (parts[1] == "com.unity.addressables"
                    && parts[2] == "AssetBundles"
                    && parts.last() == Some(&"__data"))));
    if !valid_shape {
        return Err(HubError::security_violation(format!(
            "安全策略拒绝：目标路径 '{clean}' 不在游戏 Addressables / StreamingAssets / modimg / xingshu_dynamic_cards 资源目录内。"
        )));
    }
    let resolved = confined(root, &clean)?;
    Ok((clean, resolved))
}

fn find_data_dirs(game: &GameInstallation, root: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();

    if let Some(exe) = game.executable_path.as_deref() {
        if let Some(stem) = Path::new(exe).file_stem().and_then(|s| s.to_str()) {
            let preferred = root.join(format!("{stem}_Data"));
            if preferred.is_dir() && seen.insert(preferred.clone()) {
                dirs.push(preferred);
            }
        }
    }

    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir()
                && p.file_name().is_some_and(|n| n.to_string_lossy().ends_with("_Data"))
                && (p.join("StreamingAssets").is_dir() || p.join("com.unity.addressables").is_dir())
                && seen.insert(p.clone())
            {
                dirs.push(p);
            }
        }
    }

    dirs
}

fn runtime_bundle_id_for_platform(platform: &str) -> Option<String> {
    let runtimes: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("runtime_inventory.generated.json")).unwrap_or_default();
    runtimes
        .iter()
        .find(|r| r["platform"].as_str() == Some(platform))
        .and_then(|r| {
            r["bundleId"]
                .as_str()
                .map(|s| s.to_ascii_lowercase())
                .or_else(|| {
                    r["bundleRelativePath"].as_str().and_then(|rel| {
                        Path::new(rel)
                            .parent()
                            .and_then(|p| p.file_name())
                            .and_then(|n| n.to_str())
                            .filter(|s| is_hex32(s))
                            .map(|s| s.to_ascii_lowercase())
                    })
                })
        })
}

fn discover_game_targets(game: &GameInstallation, root: &Path) -> HubResult<DiscoveredTargets> {
    let mut by_hex: HashMap<String, Vec<(String, String)>> = HashMap::new();
    let mut by_addr_group: HashMap<String, Vec<(String, String)>> = HashMap::new();
    let mut by_aa_rel: HashMap<String, (String, String)> = HashMap::new();
    let mut catalog_targets = Vec::new();

    let canonical_root = dunce::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let to_rel = |abs: &Path| -> Option<String> {
        let canonical = dunce::canonicalize(abs).ok()?;
        canonical
            .strip_prefix(&canonical_root)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
    };

    for data_dir in find_data_dirs(game, root) {
        let aa_dir = data_dir.join("StreamingAssets").join("aa");
        if aa_dir.is_dir() {
            let catalog_file = aa_dir.join("catalog.bundle");
            if catalog_file.is_file() {
                if let Some(rel) = to_rel(&catalog_file) {
                    catalog_targets.push(rel);
                }
            }

            for entry in WalkDir::new(&aa_dir)
                .follow_links(false)
                .max_depth(4)
                .into_iter()
                .flatten()
            {
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("bundle")) {
                    let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    if fname.eq_ignore_ascii_case("catalog.bundle") {
                        continue;
                    }
                    if let Some(rel) = to_rel(path) {
                        if let Ok(aa_sub) = path.strip_prefix(&aa_dir) {
                            by_aa_rel.insert(
                                aa_sub.to_string_lossy().replace('\\', "/").to_ascii_lowercase(),
                                (rel.clone(), "streaming_assets".into()),
                            );
                        }
                        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                            if is_hex32(stem) {
                                by_hex
                                    .entry(stem.to_ascii_lowercase())
                                    .or_default()
                                    .push((rel, "streaming_assets".into()));
                            }
                        }
                    }
                }
            }
        }

        let addr_dir = data_dir.join("com.unity.addressables").join("AssetBundles");
        if addr_dir.is_dir() {
            for entry in WalkDir::new(&addr_dir)
                .follow_links(false)
                .max_depth(5)
                .into_iter()
                .flatten()
            {
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
                if path.file_name().and_then(|s| s.to_str()) == Some("__data") {
                    if let Some(parent_hex) = path
                        .parent()
                        .and_then(|p| p.file_name())
                        .and_then(|s| s.to_str())
                        .filter(|s| is_hex32(s))
                    {
                        if let Some(rel) = to_rel(path) {
                            by_hex
                                .entry(parent_hex.to_ascii_lowercase())
                                .or_default()
                                .push((rel.clone(), "addressables".into()));
                            if let Some(group_hex) = path
                                .parent()
                                .and_then(Path::parent)
                                .and_then(|p| p.file_name())
                                .and_then(|s| s.to_str())
                                .filter(|s| is_hex32(s))
                            {
                                by_addr_group
                                    .entry(group_hex.to_ascii_lowercase())
                                    .or_default()
                                    .push((rel, "addressables".into()));
                            }
                        }
                    }
                }
            }
        }
    }

    for targets in by_hex.values_mut() {
        targets.sort();
        targets.dedup();
    }
    for targets in by_addr_group.values_mut() {
        targets.sort();
        targets.dedup();
    }

    Ok(DiscoveredTargets {
        by_hex,
        by_addr_group,
        by_aa_rel,
        catalog_targets,
        protected_runtime_bundle_id: runtime_bundle_id_for_platform(&game.platform),
    })
}

pub(crate) fn collect_active_target_owners(root: &Path, current_mod_id: &str) -> HubResult<HashMap<String, String>> {
    let mut owners: HashMap<String, String> = HashMap::new();

    // 1. Dropped mod receipts
    let drop_dir = confined(root, ".xingshu-mods/dropped-receipts")?;
    if drop_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&drop_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(raw) = fs::read(&p) {
                    if let Ok(r) = serde_json::from_slice::<DroppedModReceipt>(&raw) {
                        if r.mod_id != current_mod_id && matches!(r.phase.as_str(), "installed" | "prepared") {
                            for f in r.files {
                                owners.insert(target_key(&f.target), format!("已安装拖入模组「{}」", r.name));
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Workshop receipts
    let ws_dir = confined(root, ".xingshu-mods/workshop-receipts")?;
    if ws_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&ws_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(raw) = fs::read(&p) {
                    if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&raw) {
                        let phase = val["phase"].as_str().unwrap_or("");
                        let name = val["name"].as_str().unwrap_or("工坊模组");
                        if matches!(phase, "installed" | "prepared") {
                            if let Some(files) = val["files"].as_array() {
                                for f in files {
                                    if let Some(target) = f["target"].as_str() {
                                        owners.insert(target_key(target), format!("工坊模组「{name}」"));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Built-in ModLibrary receipts
    let legacy_dir = confined(root, ".xingshu-mods/receipts")?;
    if legacy_dir.is_dir() {
        if let Ok(catalog) = serde_json::from_str::<serde_json::Value>(include_str!("mod_library.generated.json")) {
            if let Ok(entries) = fs::read_dir(&legacy_dir) {
                for entry in entries.flatten() {
                    let rpath = entry.path().join("receipt.json");
                    if !rpath.is_file() {
                        continue;
                    }
                    if let Ok(raw) = fs::read(&rpath) {
                        if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&raw) {
                            let phase = val["phase"].as_str().unwrap_or("");
                            let item_id = val["itemId"].as_str().or_else(|| val["item_id"].as_str()).unwrap_or("");
                            if matches!(phase, "installed" | "prepared") && !item_id.is_empty() {
                                if let Some(item) = catalog["items"].as_array().and_then(|arr| arr.iter().find(|i| i["id"].as_str() == Some(item_id))) {
                                    let name = item["name"].as_str().unwrap_or(item_id);
                                    if let Some(files) = item["files"].as_array() {
                                        for f in files {
                                            if let Some(target) = f["target"].as_str() {
                                                owners.insert(target_key(target), format!("内置模组库「{name}」"));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(owners)
}

fn check_forbidden_extension(lower_name: &str) -> HubResult<()> {
    if FORBIDDEN_EXTS.iter().any(|ext| lower_name.ends_with(ext)) {
        return Err(HubError::security_violation(format!(
            "安全限制：拒绝包含可执行程序或脚本的文件（{lower_name}）。"
        )));
    }
    Ok(())
}

pub(crate) fn derive_mod_id(source_path: &Path) -> String {
    let canonical = dunce::canonicalize(source_path).unwrap_or_else(|_| source_path.to_path_buf());
    let name_key = canonical
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("dropped-mod")
        .to_lowercase();
    let digest = sha256_hex(name_key.as_bytes());
    format!("drop.{}", &digest[..16])
}

struct RawPayloadEntry {
    source_entry: String,
    bytes: Vec<u8>,
}

fn read_source_entries(source_path: &Path) -> HubResult<(String, String, Vec<RawPayloadEntry>, Vec<String>, Vec<String>)> {
    read_source_entries_with_password(source_path, None)
}

fn is_noise_entry(lower_clean: &str) -> bool {
    let fname = Path::new(lower_clean).file_name().and_then(|s| s.to_str()).unwrap_or("");
    lower_clean.ends_with(".bak")
        || lower_clean.ends_with(".before-uv.bak")
        || lower_clean.ends_with(".orig")
        || lower_clean.ends_with(".tmp")
        || fname == "__info"
}

fn is_rml_manifest_json(bytes: &[u8]) -> bool {
    let stripped = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
    let Ok(val) = serde_json::from_slice::<serde_json::Value>(stripped) else {
        return false;
    };
    val.is_object()
        && (val["Patch"].is_array()
            || val["Redirect"].is_array()
            || val["Add"].is_array()
            || val["Bundle"].is_array())
}

fn is_allowed_rml_launcher_exe(has_rml_manifest: bool, lower_clean: &str) -> bool {
    if !has_rml_manifest {
        return false;
    }
    Path::new(lower_clean)
        .file_name()
        .and_then(|s| s.to_str())
        == Some("resourcemodloader.exe")
}

fn should_collect_rml_payload(lower_clean: &str) -> bool {
    let fname = Path::new(lower_clean).file_name().and_then(|s| s.to_str()).unwrap_or("");
    fname == "mod.json"
        || lower_clean.ends_with(".bytes")
        || lower_clean.ends_with(".patch.bnk")
        || lower_clean.ends_with(".patch.proto")
        || MODIMG_EXTS.iter().any(|ext| lower_clean.ends_with(ext))
}

fn should_collect_payload_path(clean: &str, lower: &str) -> bool {
    if is_noise_entry(lower) {
        return false;
    }
    let fname = Path::new(lower).file_name().and_then(|s| s.to_str()).unwrap_or("");
    if lower.ends_with(".bundle") || fname == "__data" || modimg_target_name(clean).is_some() {
        return true;
    }
    let parts: Vec<&str> = clean.split('/').filter(|s| !s.is_empty()).collect();
    let in_dynamic_dir = parts.len() >= 2 && parts[parts.len() - 2].eq_ignore_ascii_case(DYNAMIC_CARDS_DIR);
    if in_dynamic_dir && is_valid_dynamic_card_filename(fname, false) {
        return true;
    }
    fname.starts_with("vut_")
        && (DYNAMIC_CARD_EXTS.iter().any(|ext| fname.ends_with(ext)) || !fname.contains('.'))
}

fn find_7z_executable() -> Option<PathBuf> {
    for fixed in [
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ] {
        let p = Path::new(fixed);
        if p.is_file() {
            return Some(p.to_path_buf());
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for bin in ["7z.exe", "7za.exe", "7z"] {
                let candidate = dir.join(bin);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn looks_like_password_error(msg_lower: &str) -> bool {
    msg_lower.contains("wrong password")
        || msg_lower.contains("incorrect password")
        || msg_lower.contains("can not open encrypted")
        || msg_lower.contains("cannot open encrypted")
        || msg_lower.contains("data error in encrypted")
        || msg_lower.contains("enter password")
        || msg_lower.contains("passphrase")
        || msg_lower.contains("encrypted")
        || msg_lower.contains("password required")
}

fn spawn_hidden_command(program: &Path) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn extract_archive_with_tools(
    source_path: &Path,
    password: Option<&str>,
    is_rar: bool,
) -> HubResult<tempfile::TempDir> {
    let temp = tempfile::Builder::new()
        .prefix("xingshu-drop-")
        .tempdir()
        .map_err(|e| HubError::storage_error(format!("创建临时解压目录失败：{e}")))?;
    let clean_pw = password.map(str::trim).filter(|s| !s.is_empty());

    if let Some(exe) = find_7z_executable() {
        let mut cmd = spawn_hidden_command(&exe);
        cmd.arg("x").arg("-y").arg("-bd");
        if let Some(pw) = clean_pw {
            cmd.arg(format!("-p{pw}"));
        } else {
            cmd.arg("-p");
        }
        cmd.arg(format!("-o{}", temp.path().display()))
            .arg("--")
            .arg(source_path);
        let output = cmd
            .output()
            .map_err(|e| HubError::storage_error(format!("调用 7-Zip 解压失败：{e}")))?;
        if output.status.success() {
            return Ok(temp);
        }
        let detail = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let lower = detail.to_ascii_lowercase();
        if looks_like_password_error(&lower) {
            return Err(if clean_pw.is_some() {
                HubError::new(
                    "ARCHIVE_PASSWORD_INVALID",
                    "压缩包解压密码错误，请核对后重试。",
                    "SECURITY",
                )
                .with_recoverable(true)
            } else {
                HubError::new(
                    "ARCHIVE_PASSWORD_REQUIRED",
                    "检测到加密压缩包，请输入解压密码后重试。",
                    "SECURITY",
                )
                .with_recoverable(true)
            });
        }
        let trimmed = detail.lines().rfind(|l| !l.trim().is_empty()).unwrap_or("解压失败").trim();
        return Err(HubError::invalid_manifest(format!("压缩包解压失败：{trimmed}")));
    }

    if is_rar && clean_pw.is_none() {
        let mut cmd = spawn_hidden_command(Path::new("tar"));
        cmd.arg("-xf")
            .arg(source_path)
            .arg("-C")
            .arg(temp.path());
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                return Ok(temp);
            }
            let detail = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
            if looks_like_password_error(&detail) {
                return Err(HubError::new(
                    "ARCHIVE_PASSWORD_REQUIRED",
                    "检测到加密 RAR 压缩包（需要 7-Zip 支持），请安装 7-Zip 后输入密码或手动解压拖入文件夹。",
                    "SECURITY",
                )
                .with_recoverable(true));
            }
        }
        return Err(HubError::invalid_manifest(
            "当前系统无法解压该 .rar 文件；请安装 7-Zip，或手动解压后直接拖入模组文件夹。",
        ));
    }

    Err(HubError::invalid_manifest(
        "本机未找到 7-Zip（7z.exe），无法解压加密压缩包；请安装 7-Zip 或手动解压后拖入模组文件夹。",
    ))
}

fn read_from_directory(
    dir_path: &Path,
    source_kind: &str,
    mut display_name: String,
) -> HubResult<(String, String, Vec<RawPayloadEntry>, Vec<String>, Vec<String>)> {
    let canonical_src = dunce::canonicalize(dir_path).map_err(|e| HubError::storage_error(e.to_string()))?;
    let modinfo_path = canonical_src.join("modinfo.json");
    if modinfo_path.is_file() {
        if let Ok(raw) = fs::read_to_string(&modinfo_path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(n) = val["name"].as_str().filter(|s| !s.trim().is_empty()) {
                    display_name = n.trim().to_string();
                }
            }
        }
    }

    let mut has_rml_manifest = false;
    for entry in WalkDir::new(&canonical_src).follow_links(false).max_depth(3).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        if entry
            .path()
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case("mod.json"))
        {
            if let Ok(meta) = entry.metadata() {
                if meta.len() > 0 && meta.len() <= 1024 * 1024 {
                    if let Ok(bytes) = fs::read(entry.path()) {
                        if is_rml_manifest_json(&bytes) {
                            has_rml_manifest = true;
                            break;
                        }
                    }
                }
            }
        }
    }

    let mut payloads = Vec::new();
    let mut preview_files = Vec::new();
    let mut doc_files = Vec::new();
    let mut total_bytes: u64 = 0;
    let mut entry_count: usize = 0;

    for entry in WalkDir::new(&canonical_src).follow_links(false).into_iter() {
        let entry = entry.map_err(|e| HubError::storage_error(e.to_string()))?;
        if entry.file_type().is_symlink() {
            return Err(HubError::security_violation("安全限制：模组目录中禁止包含符号链接。"));
        }
        if !entry.file_type().is_file() {
            continue;
        }
        entry_count += 1;
        if entry_count > MAX_DROP_ENTRIES {
            return Err(HubError::security_violation("模组包含文件数量超过安全上限（4000）。"));
        }
        let rel = entry
            .path()
            .strip_prefix(&canonical_src)
            .map_err(|e| HubError::security_violation(e.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        let clean = PathGuard::sanitize_relative_path(&rel)?
            .to_string_lossy()
            .replace('\\', "/");
        let lower = clean.to_ascii_lowercase();
        if is_allowed_rml_launcher_exe(has_rml_manifest, &lower) {
            continue;
        }
        check_forbidden_extension(&lower)?;

        let meta = entry.metadata().map_err(|e| HubError::storage_error(e.to_string()))?;
        total_bytes = total_bytes.saturating_add(meta.len());
        if total_bytes > MAX_DROP_UNCOMPRESSED_BYTES {
            return Err(HubError::security_violation("模组解压总体积超过 2GB 安全上限。"));
        }

        let collect = should_collect_payload_path(&clean, &lower)
            || (has_rml_manifest && !is_noise_entry(&lower) && should_collect_rml_payload(&lower));
        if collect {
            if meta.len() == 0 || meta.len() > MAX_DROP_PAYLOAD_BYTES as u64 {
                return Err(HubError::security_violation(format!(
                    "模组资源文件体积异常（{clean}）。"
                )));
            }
            let data = fs::read(entry.path()).map_err(|e| HubError::storage_error(e.to_string()))?;
            payloads.push(RawPayloadEntry { source_entry: clean, bytes: data });
        } else if !is_noise_entry(&lower) && PREVIEW_EXTS.iter().any(|ext| lower.ends_with(ext)) {
            preview_files.push(clean);
        } else if DOC_EXTS.iter().any(|ext| lower.ends_with(ext)) {
            doc_files.push(clean);
        }
    }
    Ok((source_kind.into(), display_name, payloads, preview_files, doc_files))
}

fn read_source_entries_with_password(
    source_path: &Path,
    password: Option<&str>,
) -> HubResult<(String, String, Vec<RawPayloadEntry>, Vec<String>, Vec<String>)> {
    if !source_path.exists() {
        return Err(HubError::invalid_manifest("拖入的文件或文件夹不存在。"));
    }
    if fs::symlink_metadata(source_path)
        .map_err(|e| HubError::storage_error(e.to_string()))?
        .file_type()
        .is_symlink()
    {
        return Err(HubError::security_violation("安全限制：不支持符号链接文件或目录。"));
    }

    let default_name = source_path
        .file_stem()
        .or_else(|| source_path.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("本地模组")
        .to_string();

    if source_path.is_dir() {
        return read_from_directory(source_path, "folder", default_name);
    }

    let file_name = source_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let lower_name = file_name.to_ascii_lowercase();
    check_forbidden_extension(&lower_name)?;

    let meta = fs::metadata(source_path).map_err(|e| HubError::storage_error(e.to_string()))?;
    if meta.len() == 0 || meta.len() > MAX_DROP_ARCHIVE_BYTES {
        return Err(HubError::security_violation("拖入文件为空或超过 1GB 安全上限。"));
    }

    if lower_name.ends_with(".bundle") {
        let data = fs::read(source_path).map_err(|e| HubError::storage_error(e.to_string()))?;
        return Ok((
            "single_bundle".into(),
            default_name,
            vec![RawPayloadEntry { source_entry: file_name, bytes: data }],
            Vec::new(),
            Vec::new(),
        ));
    }

    if lower_name.ends_with(".rar") {
        let extracted = extract_archive_with_tools(source_path, password, true)?;
        return read_from_directory(extracted.path(), "community_rar", default_name);
    }

    if !(lower_name.ends_with(".zip") || lower_name.ends_with(".xspkg") || lower_name.ends_with(".apmm")) {
        return Err(HubError::invalid_manifest(
            "不支持的文件格式；请拖入 .zip、.rar、.xspkg、.apmm、.bundle 或解压后的模组文件夹。",
        ));
    }

    let source_kind = if lower_name.ends_with(".apmm") {
        "apmm"
    } else {
        "community_zip"
    };

    let has_encrypted = ArchiveGuard::inspect_zip_encryption(
        source_path,
        &ArchiveLimits {
            max_file_count: MAX_DROP_ENTRIES,
            max_total_uncompressed_bytes: MAX_DROP_UNCOMPRESSED_BYTES,
            max_single_file_uncompressed_bytes: MAX_DROP_PAYLOAD_BYTES as u64,
            max_compression_ratio: 50.0,
        },
    )?;

    if has_encrypted {
        if password.map(str::trim).filter(|s| !s.is_empty()).is_none() {
            return Err(HubError::new(
                "ARCHIVE_PASSWORD_REQUIRED",
                "检测到加密压缩包，请输入解压密码后重试。",
                "SECURITY",
            )
            .with_recoverable(true));
        }
        let extracted = extract_archive_with_tools(source_path, password, false)?;
        return read_from_directory(extracted.path(), source_kind, default_name);
    }

    let file = fs::File::open(source_path).map_err(|e| HubError::storage_error(e.to_string()))?;
    let mut zf = zip::ZipArchive::new(file)
        .map_err(|_| HubError::invalid_manifest("压缩包格式无效或已损坏（若为 RAR/7z，请确认扩展名为 .rar 或重新打包为 ZIP）。"))?;
    if zf.is_empty() || zf.len() > MAX_DROP_ENTRIES {
        return Err(HubError::security_violation("压缩包条目数量异常。"));
    }

    let mut payloads = Vec::new();
    let mut preview_files = Vec::new();
    let mut doc_files = Vec::new();
    let mut display_name = default_name.clone();
    if let Ok(mut modinfo) = zf.by_name("modinfo.json") {
        let mut s = String::new();
        if modinfo.read_to_string(&mut s).is_ok() {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&s) {
                if let Some(n) = val["name"].as_str().filter(|s| !s.trim().is_empty()) {
                    display_name = n.trim().to_string();
                }
            }
        }
    }

    let mut total_uncompressed: u64 = 0;
    let zf_len = zf.len();
    let mut has_rml_manifest = false;
    for idx in 0..zf_len {
        if let Ok(mut entry) = zf.by_index(idx) {
            if entry.is_dir() || entry.size() == 0 || entry.size() > 1024 * 1024 {
                continue;
            }
            let raw_name = decode_zip_entry_name(entry.name_raw()).replace('\\', "/");
            if Path::new(&raw_name)
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|n| n.eq_ignore_ascii_case("mod.json"))
            {
                let mut mbytes = Vec::new();
                if entry.by_ref().take(1024 * 1024 + 1).read_to_end(&mut mbytes).is_ok()
                    && is_rml_manifest_json(&mbytes)
                {
                    has_rml_manifest = true;
                    break;
                }
            }
        }
    }

    let mut retry_encrypted_via_7z = false;
    for idx in 0..zf_len {
        let loop_err = match zf.by_index(idx) {
            Ok(mut entry) => {
                if entry.is_symlink() {
                    Some(HubError::security_violation("安全限制：压缩包内禁止包含符号链接。"))
                } else {
                    let raw_name = decode_zip_entry_name(entry.name_raw()).replace('\\', "/");
                    if entry.is_dir() {
                        let trimmed = raw_name.trim_matches('/');
                        if !trimmed.is_empty() {
                            PathGuard::sanitize_relative_path(trimmed)?;
                        }
                        None
                    } else {
                        total_uncompressed = total_uncompressed.saturating_add(entry.size());
                        if total_uncompressed > MAX_DROP_UNCOMPRESSED_BYTES {
                            Some(HubError::security_violation("压缩包解压总体积超过 2GB 安全上限。"))
                        } else {
                            let clean = PathGuard::sanitize_relative_path(&raw_name)?
                                .to_string_lossy()
                                .replace('\\', "/");
                            let lower = clean.to_ascii_lowercase();
                            if is_allowed_rml_launcher_exe(has_rml_manifest, &lower) {
                                None
                            } else {
                                check_forbidden_extension(&lower)?;

                                let collect = should_collect_payload_path(&clean, &lower)
                                    || (has_rml_manifest && !is_noise_entry(&lower) && should_collect_rml_payload(&lower));
                                if collect {
                                    let mut data = Vec::new();
                                    entry
                                        .by_ref()
                                        .take((MAX_DROP_PAYLOAD_BYTES + 1) as u64)
                                        .read_to_end(&mut data)
                                        .map_err(|e| HubError::storage_error(e.to_string()))?;
                                    if data.is_empty() || data.len() > MAX_DROP_PAYLOAD_BYTES {
                                        Some(HubError::security_violation(format!(
                                            "压缩包内资源文件体积异常（{clean}）。"
                                        )))
                                    } else {
                                        payloads.push(RawPayloadEntry { source_entry: clean, bytes: data });
                                        None
                                    }
                                } else if !is_noise_entry(&lower) && PREVIEW_EXTS.iter().any(|ext| lower.ends_with(ext)) {
                                    preview_files.push(clean);
                                    None
                                } else if DOC_EXTS.iter().any(|ext| lower.ends_with(ext)) {
                                    doc_files.push(clean);
                                    None
                                } else {
                                    None
                                }
                            }
                        }
                    }
                }
            }
            Err(zip::result::ZipError::UnsupportedArchive(msg))
                if {
                    let m = msg.to_ascii_lowercase();
                    m.contains("password") || m.contains("encrypt") || m.contains("aes")
                } =>
            {
                if password.map(str::trim).filter(|s| !s.is_empty()).is_none() {
                    Some(
                        HubError::new(
                            "ARCHIVE_PASSWORD_REQUIRED",
                            "检测到加密压缩包，请输入解压密码后重试。",
                            "SECURITY",
                        )
                        .with_recoverable(true),
                    )
                } else {
                    retry_encrypted_via_7z = true;
                    break;
                }
            }
            Err(zip::result::ZipError::InvalidPassword) => Some(
                HubError::new(
                    "ARCHIVE_PASSWORD_INVALID",
                    "压缩包解压密码错误，请核对后重试。",
                    "SECURITY",
                )
                .with_recoverable(true),
            ),
            Err(e) => Some(HubError::invalid_manifest(format!("读取压缩包条目失败：{e}"))),
        };
        if let Some(err) = loop_err {
            return Err(err);
        }
    }
    if retry_encrypted_via_7z {
        drop(zf);
        let extracted = extract_archive_with_tools(source_path, password, false)?;
        return read_from_directory(extracted.path(), source_kind, default_name);
    }

    Ok((source_kind.into(), display_name, payloads, preview_files, doc_files))
}

pub(crate) fn is_xspkg_archive(source_path: &Path) -> HubResult<bool> {
    if !source_path.is_file() {
        return Ok(false);
    }
    let lower = source_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !(lower.ends_with(".xspkg") || lower.ends_with(".zip")) {
        return Ok(false);
    }
    let file = fs::File::open(source_path).map_err(|e| HubError::storage_error(e.to_string()))?;
    let mut zf = match zip::ZipArchive::new(file) {
        Ok(z) => z,
        Err(_) => return Ok(false),
    };
    let has_manifest = match zf.by_name("manifest.json") {
        Ok(entry) => !entry.encrypted(),
        Err(_) => false,
    };
    Ok(has_manifest)
}

fn extract_trailing_hex32(stem: &str) -> Option<String> {
    if stem.len() <= 32 {
        return None;
    }
    let split_idx = stem.len() - 32;
    if !stem.is_char_boundary(split_idx) {
        return None;
    }
    let prefix = &stem[..split_idx];
    let suffix = &stem[split_idx..];
    if !is_hex32(suffix) {
        return None;
    }
    if prefix.chars().last().is_some_and(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }
    Some(suffix.to_ascii_lowercase())
}

fn extract_embedded_unityfs_bundle_id(bytes: &[u8]) -> Option<String> {
    if !bytes.starts_with(b"UnityFS") {
        return None;
    }
    let scan = &bytes[..bytes.len().min(128 * 1024)];
    const SUFFIX: &[u8] = b".bundle";
    if scan.len() < 32 + SUFFIX.len() {
        return None;
    }
    for idx in 32..=scan.len() - SUFFIX.len() {
        if !scan[idx..idx + SUFFIX.len()].eq_ignore_ascii_case(SUFFIX) {
            continue;
        }
        let hex_slice = &scan[idx - 32..idx];
        if !hex_slice.iter().all(|b| b.is_ascii_hexdigit()) {
            continue;
        }
        if idx > 32 && scan[idx - 33].is_ascii_hexdigit() {
            continue;
        }
        if let Some(&after) = scan.get(idx + SUFFIX.len()) {
            if after.is_ascii_alphanumeric() || after == b'_' {
                continue;
            }
        }
        return Some(String::from_utf8_lossy(hex_slice).to_ascii_lowercase());
    }
    None
}

fn lookup_hex_targets<'a>(
    discovered: &'a DiscoveredTargets,
    hex_id: &str,
) -> Option<&'a Vec<(String, String)>> {
    discovered
        .by_hex
        .get(hex_id)
        .or_else(|| discovered.by_addr_group.get(hex_id))
}

fn is_valid_asset_basename(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 160
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
}

fn read_vanilla_bundle_baseline(root: &Path, target_rel: &str) -> HubResult<Vec<u8>> {
    let want_key = target_key(target_rel);

    for (receipt_dir_rel, backups_base_rel) in [
        (".xingshu-mods/dropped-receipts", ".xingshu-mods/dropped-backups"),
        (".xingshu-mods/workshop-receipts", ".xingshu-mods/workshop-backups"),
    ] {
        let dir = confined(root, receipt_dir_rel)?;
        if !dir.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Ok(raw) = fs::read(&p) else { continue };
            let Ok(val) = serde_json::from_slice::<serde_json::Value>(&raw) else { continue };
            let phase = val["phase"].as_str().unwrap_or("");
            let id = val["modId"]
                .as_str()
                .or_else(|| val["mod_id"].as_str())
                .unwrap_or("");
            if !matches!(phase, "installed" | "prepared") || id.is_empty() {
                continue;
            }
            let Some(files) = val["files"].as_array() else { continue };
            for f in files {
                let Some(t) = f["target"].as_str() else { continue };
                if target_key(t) != want_key {
                    continue;
                }
                let baseline_sha = f["baselineSha256"]
                    .as_str()
                    .or_else(|| f["baseline_sha256"].as_str())
                    .unwrap_or("");
                let idx = f["index"].as_u64().map(|n| n as usize);
                if let (false, Some(index), Ok(clean_id)) =
                    (baseline_sha.is_empty(), idx, sanitize_mod_id(id))
                {
                    let backup_rel = format!("{backups_base_rel}/{clean_id}/baseline/{index}.bundle");
                    if let Ok(backup_abs) = confined(root, &backup_rel) {
                        if backup_abs.is_file() {
                            if let Ok(bytes) = fs::read(&backup_abs) {
                                if sha256_hex(&bytes).eq_ignore_ascii_case(baseline_sha) {
                                    return Ok(bytes);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let (_, target_abs) = validate_dropped_target_rel(root, target_rel)?;
    fs::read(&target_abs).map_err(|e| HubError::storage_error(format!("读取原版容器失败（{target_rel}）：{e}")))
}

#[allow(clippy::too_many_arguments)]
fn push_resolved_target_entry(
    root: &Path,
    discovered: &DiscoveredTargets,
    active_owners: &HashMap<String, String>,
    seen_targets: &mut HashSet<String>,
    warnings: &mut Vec<String>,
    conflicts: &mut Vec<String>,
    matched_files: &mut Vec<DroppedModTargetMatch>,
    staged_candidates: &mut Vec<StagedCandidate>,
    source_entry: &str,
    raw_bytes: &[u8],
    bundle_id: String,
    target_rel: String,
    target_kind: String,
    is_catalog: bool,
    custom_bytes: Option<Vec<u8>>,
) -> HubResult<()> {
    if !seen_targets.insert(target_rel.clone()) {
        warnings.push(format!(
            "检测到多差分或重复指向 {target_rel} 的文件，已优先保留首个并跳过：{source_entry}"
        ));
        return Ok(());
    }
    let (norm_target, target_abs) = validate_dropped_target_rel(root, &target_rel)?;
    let final_bytes = custom_bytes.unwrap_or_else(|| raw_bytes.to_vec());
    let payload_sha256 = sha256_hex(&final_bytes);
    let payload_size = final_bytes.len() as u64;
    let current_sha256 = if target_abs.is_file() {
        compute_file_sha256(&target_abs)?
    } else {
        String::new()
    };
    let already_same =
        !current_sha256.is_empty() && current_sha256.eq_ignore_ascii_case(&payload_sha256);

    let mut conflict_with = None;
    if discovered
        .protected_runtime_bundle_id
        .as_deref()
        .is_some_and(|rt_id| rt_id.eq_ignore_ascii_case(&bundle_id))
    {
        let msg = "星枢运行时核心容器（受保护，禁止第三方模组覆盖）".to_string();
        conflicts.push(format!("{norm_target}：{msg}"));
        conflict_with = Some(msg);
    } else if let Some(owner) = active_owners.get(&target_key(&norm_target)) {
        conflicts.push(format!("{norm_target} 已被 {owner} 占用，请先还原冲突模组"));
        conflict_with = Some(owner.clone());
    }

    let risk_level = if is_catalog { "high" } else { "safe" };
    matched_files.push(DroppedModTargetMatch {
        source_entry: source_entry.to_string(),
        target_rel: norm_target.clone(),
        bundle_id,
        target_kind,
        size: payload_size,
        sha256: payload_sha256.clone(),
        current_sha256,
        already_same,
        is_catalog,
        risk_level: risk_level.into(),
        conflict_with,
    });
    staged_candidates.push(StagedCandidate {
        target_rel: norm_target,
        is_catalog,
        bytes: final_bytes,
        sha256: payload_sha256,
    });
    Ok(())
}

#[cfg_attr(not(test), allow(dead_code))]
fn inspect_against_game(
    game: &GameInstallation,
    installation_id: &str,
    root: &Path,
    source_path: &Path,
) -> HubResult<(DroppedModInspectResult, Vec<StagedCandidate>)> {
    inspect_against_game_with_password(game, installation_id, root, source_path, None)
}

fn inspect_against_game_with_password(
    game: &GameInstallation,
    installation_id: &str,
    root: &Path,
    source_path: &Path,
    password: Option<&str>,
) -> HubResult<(DroppedModInspectResult, Vec<StagedCandidate>)> {
    let mod_id = derive_mod_id(source_path);
    let existing_receipt = read_receipt(root, &mod_id)?;
    let already_installed = existing_receipt
        .as_ref()
        .is_some_and(|r| matches!(r.phase.as_str(), "installed" | "prepared" | "disabled"));

    if is_xspkg_archive(source_path)? {
        let manifest = PackageParser::parse_archive(source_path)?;
        let compat_res = crate::install::engine::InstallEngine::check_compatibility(&manifest, game);
        let compatible = compat_res.is_ok();
        let mut warnings = Vec::new();
        if let Err(err) = compat_res {
            warnings.push(err.message);
        }
        let matched_files: Vec<DroppedModTargetMatch> = manifest
            .files
            .iter()
            .map(|f| DroppedModTargetMatch {
                source_entry: f.source.clone(),
                target_rel: f.target.clone(),
                bundle_id: "xspkg".into(),
                target_kind: "xspkg".into(),
                size: f.size,
                sha256: f.sha256.clone(),
                current_sha256: String::new(),
                already_same: false,
                is_catalog: false,
                risk_level: "safe".into(),
                conflict_with: None,
            })
            .collect();
        let display_name = manifest.package.name.clone();
        let res = DroppedModInspectResult {
            mod_id,
            display_name,
            source_path: source_path.display().to_string(),
            source_kind: "xspkg".into(),
            installation_id: installation_id.to_string(),
            game_platform: game.platform.clone(),
            game_root: root.display().to_string(),
            compatible,
            can_install: compatible && !matched_files.is_empty() && !already_installed,
            already_installed,
            has_catalog_bundle: false,
            android_exportable_count: 0,
            warnings,
            matched_files,
            unmatched_files: Vec::new(),
            conflicts: Vec::new(),
            preview_files: Vec::new(),
            doc_files: Vec::new(),
            xspkg_manifest: Some(manifest),
        };
        return Ok((res, Vec::new()));
    }

    let (source_kind, display_name, raw_payloads, preview_files, doc_files) =
        read_source_entries_with_password(source_path, password)?;
    let discovered = discover_game_targets(game, root)?;
    let active_owners = collect_active_target_owners(root, &mod_id)?;

    let has_backup_dir = |entry: &str| {
        let parts: Vec<&str> = entry.split('/').collect();
        parts.len() >= 2
            && parts[..parts.len() - 1]
                .iter()
                .any(|seg| SKIP_BACKUP_DIRS.iter().any(|b| seg.eq_ignore_ascii_case(b)))
    };
    let non_backup_leafs: HashSet<String> = raw_payloads
        .iter()
        .filter(|raw| !has_backup_dir(&raw.source_entry))
        .filter_map(|raw| {
            Path::new(&raw.source_entry)
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase())
        })
        .collect();

    let mut matched_files = Vec::new();
    let mut unmatched_files = Vec::new();
    let mut staged_candidates = Vec::new();
    let mut conflicts = Vec::new();
    let mut warnings = Vec::new();
    let mut seen_targets = HashSet::new();
    let mut has_catalog_bundle = false;
    let mut addr_group_fallback_count = 0usize;
    let mut adapted_modimg_count = 0usize;
    let mut migrated_bundle_count = 0usize;
    let mut cab_matched_count = 0usize;
    let mut rml_patched_count = 0usize;
    let mut dynamic_card_count = 0usize;
    let mut apenc_skipped_count = 0usize;
    let mut backup_skipped_count = 0usize;
    let mut lazy_catalogs: Option<Vec<std::sync::Arc<crate::game_art::Catalog>>> = None;
    let mut lazy_cab_index: Option<HashMap<String, Vec<(String, String)>>> = None;

    // Process RML (`mod.json`) manifests first if present, keeping any non-RML payloads for normal inspection.
    let mut rml_consumed_indices = HashSet::new();
    if let Some((manifest_idx, manifest_entry)) = raw_payloads.iter().enumerate().find(|(_, p)| {
        Path::new(&p.source_entry)
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case("mod.json"))
            && is_rml_manifest_json(&p.bytes)
    }) {
        rml_consumed_indices.insert(manifest_idx);
        let stripped = manifest_entry
            .bytes
            .strip_prefix(b"\xef\xbb\xbf")
            .unwrap_or(&manifest_entry.bytes);
        if let Ok(manifest_json) = serde_json::from_slice::<serde_json::Value>(stripped) {
            warnings.push(
                "检测到 ResourceModLoader (mod.json) 模组，已安全跳过 ResourceModLoader.exe 并使用星枢原生补丁引擎解析。".into(),
            );
            let manifest_dir = manifest_entry
                .source_entry
                .rsplit_once('/')
                .map(|(d, _)| d.trim_matches('/').to_string())
                .unwrap_or_default();
            let base_dir = manifest_json["BaseDir"]
                .as_str()
                .unwrap_or("")
                .trim_matches('/')
                .to_string();

            let mut by_rel_lower: HashMap<String, usize> = HashMap::new();
            for (i, p) in raw_payloads.iter().enumerate() {
                by_rel_lower.insert(p.source_entry.replace('\\', "/").to_ascii_lowercase(), i);
            }
            let find_rml_entry = |rel: &str| -> Option<usize> {
                let clean_rel = rel.trim().replace('\\', "/").trim_start_matches('/').to_string();
                let mut candidates = Vec::new();
                if !manifest_dir.is_empty() && !base_dir.is_empty() {
                    candidates.push(format!("{manifest_dir}/{base_dir}/{clean_rel}"));
                }
                if !manifest_dir.is_empty() {
                    candidates.push(format!("{manifest_dir}/{clean_rel}"));
                }
                if !base_dir.is_empty() {
                    candidates.push(format!("{base_dir}/{clean_rel}"));
                }
                candidates.push(clean_rel.clone());
                for cand in candidates {
                    if let Some(&idx) = by_rel_lower.get(&cand.to_ascii_lowercase()) {
                        return Some(idx);
                    }
                }
                raw_payloads.iter().position(|p| {
                    p.source_entry.eq_ignore_ascii_case(&clean_rel)
                        || p.source_entry
                            .to_ascii_lowercase()
                            .ends_with(&format!("/{}", clean_rel.to_ascii_lowercase()))
                })
            };

            let resolve_hex_targets_for_name =
                |catalogs: &[std::sync::Arc<crate::game_art::Catalog>], asset_name: &str| -> Vec<(String, String)> {
                    let mut resolved = Vec::new();
                    let mut seen_rel = HashSet::new();
                    for b_name in crate::game_art::resolve_asset_bundles(catalogs, asset_name) {
                        let Some(stem) = Path::new(&b_name).file_stem().and_then(|s| s.to_str()) else {
                            continue;
                        };
                        let hex_id = stem.to_ascii_lowercase();
                        if let Some(targets) = lookup_hex_targets(&discovered, &hex_id) {
                            for (t_rel, _) in targets {
                                if seen_rel.insert(t_rel.clone()) {
                                    resolved.push((hex_id.clone(), t_rel.clone()));
                                }
                            }
                        }
                    }
                    resolved
                };

            // 1. Handle RML `Redirect` items (`image` -> modimg, `text` -> patched TextAsset bundle)
            if let Some(redirects) = manifest_json["Redirect"].as_array() {
                for item in redirects {
                    let asset_name = item["Name"].as_str().unwrap_or("").trim();
                    let file_rel = item["File"].as_str().unwrap_or("").trim();
                    let wrap_type = item["WrapType"].as_str().unwrap_or("").trim().to_ascii_lowercase();
                    if asset_name.is_empty() || file_rel.is_empty() {
                        continue;
                    }
                    let Some(p_idx) = find_rml_entry(file_rel) else {
                        unmatched_files.push(DroppedModUnmatchedFile {
                            source_entry: file_rel.to_string(),
                            reason: format!("mod.json 引用的重定向文件不存在：{file_rel}"),
                            size: 0,
                        });
                        continue;
                    };
                    rml_consumed_indices.insert(p_idx);
                    let p_entry = &raw_payloads[p_idx];
                    let file_low = file_rel.to_ascii_lowercase();
                    if wrap_type == "image" || MODIMG_EXTS.iter().any(|ext| file_low.ends_with(ext)) {
                        let ext = Path::new(&file_low)
                            .extension()
                            .and_then(|s| s.to_str())
                            .filter(|s| matches!(*s, "png" | "jpg" | "jpeg" | "webp"))
                            .unwrap_or("png");
                        if !is_valid_asset_basename(asset_name) {
                            unmatched_files.push(DroppedModUnmatchedFile {
                                source_entry: p_entry.source_entry.clone(),
                                reason: format!("非法的 Redirect 图片资源名：{asset_name}"),
                                size: p_entry.bytes.len() as u64,
                            });
                            continue;
                        }
                        let bid = format!("rml.img.{}", &sha256_hex(asset_name.as_bytes())[..12]);
                        rml_patched_count += 1;
                        push_resolved_target_entry(
                            root, &discovered, &active_owners, &mut seen_targets,
                            &mut warnings, &mut conflicts, &mut matched_files, &mut staged_candidates,
                            &p_entry.source_entry,
                            &p_entry.bytes,
                            bid,
                            format!("modimg/{asset_name}.{ext}"),
                            "rml_modimg".into(),
                            false,
                            Some(p_entry.bytes.clone()),
                        )?;
                    } else if wrap_type == "text" || file_low.ends_with(".bytes") {
                        let catalogs = lazy_catalogs
                            .get_or_insert_with(|| crate::game_art::load_game_catalogs(game, root));
                        let targets = resolve_hex_targets_for_name(catalogs, asset_name);
                        let mut matched_any = false;
                        let mut last_err: Option<String> = None;
                        for (hex_id, t_rel) in targets {
                            match read_vanilla_bundle_baseline(root, &t_rel)
                                .map_err(|e| e.message)
                                .and_then(|van| {
                                    crate::mod_inspector::patch_text_asset_in_bundle(
                                        &van,
                                        asset_name,
                                        &p_entry.bytes,
                                    )
                                }) {
                                Ok(patched) => {
                                    matched_any = true;
                                    rml_patched_count += 1;
                                    push_resolved_target_entry(
                                        root, &discovered, &active_owners, &mut seen_targets,
                                        &mut warnings, &mut conflicts, &mut matched_files, &mut staged_candidates,
                                        &p_entry.source_entry,
                                        &p_entry.bytes,
                                        hex_id,
                                        t_rel,
                                        "rml_patched_bundle".into(),
                                        false,
                                        Some(patched),
                                    )?;
                                    break;
                                }
                                Err(e) => last_err = Some(e),
                            }
                        }
                        if !matched_any {
                            unmatched_files.push(DroppedModUnmatchedFile {
                                source_entry: p_entry.source_entry.clone(),
                                reason: last_err.unwrap_or_else(|| {
                                    format!("未能在当前游戏目录找到 Redirect TextAsset '{asset_name}'")
                                }),
                                size: p_entry.bytes.len() as u64,
                            });
                        }
                    }
                }
            }

            // 2. Handle RML `Patch` items (`.patch.bnk` & `.patch.proto`)
            if let Some(patches) = manifest_json["Patch"].as_array() {
                for item in patches {
                    let Some(patch_rel) = item.as_str().map(str::trim).filter(|s| !s.is_empty()) else {
                        continue;
                    };
                    let Some(p_idx) = find_rml_entry(patch_rel) else {
                        unmatched_files.push(DroppedModUnmatchedFile {
                            source_entry: patch_rel.to_string(),
                            reason: format!("mod.json 引用的补丁文件不存在：{patch_rel}"),
                            size: 0,
                        });
                        continue;
                    };
                    rml_consumed_indices.insert(p_idx);
                    let p_entry = &raw_payloads[p_idx];
                    let patch_leaf = Path::new(patch_rel)
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or(patch_rel);
                    let leaf_lower = patch_leaf.to_ascii_lowercase();

                    if leaf_lower.ends_with(".patch.bnk") {
                        let stem = &patch_leaf[..patch_leaf.len() - ".patch.bnk".len()];
                        let bank_name = stem.rsplit('@').next().unwrap_or(stem).trim();
                        let catalogs = lazy_catalogs
                            .get_or_insert_with(|| crate::game_art::load_game_catalogs(game, root));
                        let mut cand_targets = Vec::new();
                        let mut seen_rel = HashSet::new();

                        // Resolve Wwise bank descriptor (`Assets/WwiseData/Banks/{bank}.asset`) -> bank GUIDs -> bundles
                        let bank_asset_key = format!("Assets/WwiseData/Banks/{bank_name}.asset");
                        for (_, desc_rel) in resolve_hex_targets_for_name(catalogs, &bank_asset_key) {
                            if let Ok(desc_bytes) = read_vanilla_bundle_baseline(root, &desc_rel) {
                                for tok in crate::mod_inspector::extract_hex32_tokens_from_bundle(&desc_bytes) {
                                    for (hx, rel) in resolve_hex_targets_for_name(catalogs, &tok) {
                                        if seen_rel.insert(rel.clone()) {
                                            cand_targets.push((hx, rel));
                                        }
                                    }
                                }
                            }
                        }

                        // Fallback for descriptor-less / test fixtures: skip .resS asset bundles cleanly, scan compact MonoBehaviour candidates
                        if cand_targets.is_empty() {
                            for (hx, vec) in &discovered.by_hex {
                                if discovered
                                    .protected_runtime_bundle_id
                                    .as_deref()
                                    .is_some_and(|rt| rt.eq_ignore_ascii_case(hx))
                                {
                                    continue;
                                }
                                for (rel, _) in vec {
                                    let Ok(abs) = confined(root, rel) else { continue };
                                    if !abs.metadata().is_ok_and(|m| m.len() <= 24 * 1024 * 1024) {
                                        continue;
                                    }
                                    if crate::mod_inspector::extract_bundle_cab_names_from_file(&abs)
                                        .is_ok_and(|(_, has_ress)| has_ress)
                                    {
                                        continue;
                                    }
                                    let Ok(raw_b) = fs::read(&abs) else { continue };
                                    if crate::mod_inspector::inspect_bundle_contents(&raw_b)
                                        .is_ok_and(|s| s.monobehaviour_names.iter().any(|n| n.eq_ignore_ascii_case(bank_name)))
                                        && seen_rel.insert(rel.clone())
                                    {
                                        cand_targets.push((hx.clone(), rel.clone()));
                                    }
                                }
                            }
                        }

                        let mut patched_any = false;
                        let mut last_err: Option<String> = None;
                        for (hx, t_rel) in cand_targets {
                            match read_vanilla_bundle_baseline(root, &t_rel)
                                .map_err(|e| e.message)
                                .and_then(|van| {
                                    crate::mod_inspector::patch_wwise_bnk_in_monobehaviour_bundle(
                                        &van,
                                        bank_name,
                                        &p_entry.bytes,
                                    )
                                }) {
                                Ok(patched) => {
                                    patched_any = true;
                                    rml_patched_count += 1;
                                    push_resolved_target_entry(
                                        root, &discovered, &active_owners, &mut seen_targets,
                                        &mut warnings, &mut conflicts, &mut matched_files, &mut staged_candidates,
                                        &p_entry.source_entry,
                                        &p_entry.bytes,
                                        hx,
                                        t_rel,
                                        "rml_patched_bundle".into(),
                                        false,
                                        Some(patched),
                                    )?;
                                }
                                Err(e) => last_err = Some(e),
                            }
                        }
                        if !patched_any {
                            unmatched_files.push(DroppedModUnmatchedFile {
                                source_entry: p_entry.source_entry.clone(),
                                reason: last_err.unwrap_or_else(|| {
                                    format!("未找到 Wwise SoundBank '{bank_name}' 对应的 3.3.0 原版容器")
                                }),
                                size: p_entry.bytes.len() as u64,
                            });
                        }
                    } else if leaf_lower.ends_with(".patch.proto") {
                        let stem = &patch_leaf[..patch_leaf.len() - ".patch.proto".len()];
                        let asset_name = stem.split('@').next().unwrap_or(stem).trim();
                        let Ok(patch_text) = std::str::from_utf8(&p_entry.bytes) else {
                            unmatched_files.push(DroppedModUnmatchedFile {
                                source_entry: p_entry.source_entry.clone(),
                                reason: ".patch.proto 文件不是有效的 UTF-8 文本".into(),
                                size: p_entry.bytes.len() as u64,
                            });
                            continue;
                        };

                        let catalogs = lazy_catalogs
                            .get_or_insert_with(|| crate::game_art::load_game_catalogs(game, root));
                        let mut cand_targets = resolve_hex_targets_for_name(catalogs, asset_name);
                        let mut seen_rel: HashSet<String> =
                            cand_targets.iter().map(|(_, r)| r.clone()).collect();
                        for (grp, vec) in &discovered.by_addr_group {
                            if discovered
                                .protected_runtime_bundle_id
                                .as_deref()
                                .is_some_and(|rt| rt.eq_ignore_ascii_case(grp))
                            {
                                continue;
                            }
                            for (t_rel, _) in vec {
                                if seen_rel.insert(t_rel.clone()) {
                                    cand_targets.push((grp.clone(), t_rel.clone()));
                                }
                            }
                        }

                        let mut patched_any = false;
                        let mut last_err: Option<String> = None;
                        for (hx, t_rel) in cand_targets {
                            let res = read_vanilla_bundle_baseline(root, &t_rel)
                                .map_err(|e| e.message)
                                .and_then(|van| {
                                    let orig = crate::mod_inspector::extract_text_asset(&van, asset_name)?;
                                    let next = crate::mod_inspector::apply_rml_proto_patch(&orig, patch_text)?;
                                    crate::mod_inspector::patch_text_asset_in_bundle(&van, asset_name, &next)
                                });
                            match res {
                                Ok(patched) => {
                                    patched_any = true;
                                    rml_patched_count += 1;
                                    push_resolved_target_entry(
                                        root, &discovered, &active_owners, &mut seen_targets,
                                        &mut warnings, &mut conflicts, &mut matched_files, &mut staged_candidates,
                                        &p_entry.source_entry,
                                        &p_entry.bytes,
                                        hx,
                                        t_rel,
                                        "rml_patched_bundle".into(),
                                        false,
                                        Some(patched),
                                    )?;
                                    break;
                                }
                                Err(e) => {
                                    if !e.contains("未找到") {
                                        last_err = Some(e);
                                    }
                                }
                            }
                        }
                        if !patched_any {
                            unmatched_files.push(DroppedModUnmatchedFile {
                                source_entry: p_entry.source_entry.clone(),
                                reason: last_err.unwrap_or_else(|| {
                                    format!("未找到 Protobuf 配置 TextAsset '{asset_name}'")
                                }),
                                size: p_entry.bytes.len() as u64,
                            });
                        }
                    }
                }
            }
        }
    }

    for (raw_idx, raw) in raw_payloads.into_iter().enumerate() {
        if rml_consumed_indices.contains(&raw_idx) {
            continue;
        }
        let entry_lower = raw.source_entry.to_ascii_lowercase();
        let path_obj = Path::new(&raw.source_entry);
        let file_name = path_obj.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let file_lower = file_name.to_ascii_lowercase();

        if has_backup_dir(&raw.source_entry) && non_backup_leafs.contains(&file_lower) {
            backup_skipped_count += 1;
            continue;
        }

        let bundle_summary = if raw.bytes.starts_with(b"UnityFS") {
            crate::mod_inspector::inspect_bundle_contents(&raw.bytes).ok()
        } else {
            None
        };

        if bundle_summary.as_ref().is_some_and(|s| s.has_astral_runtime_dll) {
            conflicts.push(format!(
                "{} 包含第三方篡改版 AstralParty.Runtime.dll，已自动拦截以防破坏 3.3.0 运行时。",
                raw.source_entry
            ));
            continue;
        }

        let raw_apenc = raw
            .bytes
            .get(..raw.bytes.len().min(4096))
            .is_some_and(|head| head.windows(7).any(|w| w == b"APENC01"));
        if raw_apenc || bundle_summary.as_ref().is_some_and(|s| s.has_apenc_drm) {
            apenc_skipped_count += 1;
            unmatched_files.push(DroppedModUnmatchedFile {
                source_entry: raw.source_entry,
                reason: "检测到 APENC01 加密动态立绘；星枢原生动态立绘不支持也不绕过官方 DRM 加密，请改用无加密 .mp4/.webm/.mov/.usm/.bundle。".into(),
                size: raw.bytes.len() as u64,
            });
            continue;
        }

        let source_bundle_id = if file_lower == "__data" {
            path_obj.parent().and_then(Path::file_name).and_then(|name| name.to_str())
        } else {
            path_obj.file_stem().and_then(|name| name.to_str())
        };
        if source_bundle_id
            .zip(discovered.protected_runtime_bundle_id.as_deref())
            .is_some_and(|(source, protected)| source.eq_ignore_ascii_case(protected))
        {
            conflicts.push(format!("{file_name} 属于星枢运行时核心容器，第三方模组无法覆盖。"));
            continue;
        }

        // Tuple: `(bundle_id, target_rel, target_kind, is_catalog, custom_bytes)`
        let mut candidate_targets: Vec<(String, String, String, bool, Option<Vec<u8>>)> = Vec::new();
        let mut direct_unmatched_reason: Option<String> = None;

        if file_lower == "catalog.bundle" {
            has_catalog_bundle = true;
            if discovered.catalog_targets.is_empty() {
                direct_unmatched_reason = Some("当前游戏目录未发现 StreamingAssets/aa/catalog.bundle".into());
            } else {
                for target_rel in &discovered.catalog_targets {
                    candidate_targets.push(("catalog".into(), target_rel.clone(), "catalog".into(), true, None));
                }
            }
        } else if let Some(dyn_name) = dynamic_card_target_name(&raw.source_entry, &raw.bytes) {
            dynamic_card_count += 1;
            candidate_targets.push((
                "dynamic_card".into(),
                format!("{DYNAMIC_CARDS_DIR}/{dyn_name}"),
                "dynamic_card".into(),
                false,
                None,
            ));
        } else if file_lower == "__data" {
            let parent_hex = path_obj
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|s| s.to_str())
                .filter(|s| is_hex32(s))
                .map(|s| s.to_ascii_lowercase());
            let grandparent_hex = path_obj
                .parent()
                .and_then(Path::parent)
                .and_then(|p| p.file_name())
                .and_then(|s| s.to_str())
                .filter(|s| is_hex32(s))
                .map(|s| s.to_ascii_lowercase());
            if let Some(hex_id) = parent_hex {
                if let Some(targets) = discovered.by_hex.get(&hex_id) {
                    for (t_rel, t_kind) in targets {
                        if t_kind == "addressables" || targets.len() == 1 {
                            candidate_targets.push((hex_id.clone(), t_rel.clone(), t_kind.clone(), false, None));
                        }
                    }
                } else if let Some((group_id, targets)) = grandparent_hex
                    .as_deref()
                    .and_then(|gid| discovered.by_addr_group.get(gid).map(|t| (gid.to_string(), t)))
                {
                    addr_group_fallback_count += 1;
                    for (t_rel, t_kind) in targets {
                        candidate_targets.push((group_id.clone(), t_rel.clone(), t_kind.clone(), false, None));
                    }
                } else {
                    direct_unmatched_reason = Some(format!("当前游戏目录中未找到 Addressables 容器 {hex_id}"));
                }
            } else {
                direct_unmatched_reason = Some("无法识别 __data 上级 32 位 Bundle Hash 目录名".into());
            }
        } else if let Some(stem) = path_obj.file_stem().and_then(|s| s.to_str()).filter(|s| is_hex32(s)) {
            let hex_id = stem.to_ascii_lowercase();
            if let Some(targets) = lookup_hex_targets(&discovered, &hex_id) {
                for (t_rel, t_kind) in targets {
                    candidate_targets.push((hex_id.clone(), t_rel.clone(), t_kind.clone(), false, None));
                }
            } else {
                direct_unmatched_reason = Some(format!(
                    "当前游戏目录未找到对应 Bundle（{hex_id}.bundle），可能版本或渠道不一致"
                ));
            }
        } else if let Some(hex_id) = path_obj
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(extract_trailing_hex32)
        {
            if discovered
                .protected_runtime_bundle_id
                .as_deref()
                .is_some_and(|rt_id| rt_id.eq_ignore_ascii_case(&hex_id))
            {
                conflicts.push(format!("{file_name} 属于星枢运行时核心容器，第三方模组无法覆盖。"));
                continue;
            }
            if let Some(targets) = lookup_hex_targets(&discovered, &hex_id) {
                for (t_rel, t_kind) in targets {
                    candidate_targets.push((hex_id.clone(), t_rel.clone(), t_kind.clone(), false, None));
                }
            } else {
                direct_unmatched_reason = Some(format!(
                    "检测到带前缀 Bundle ID（{hex_id}），但当前游戏目录未找到该版本资源"
                ));
            }
        } else if let Some((_, aa_rel)) = entry_lower.split_once("streamingassets/aa/") {
            if let Some((t_rel, t_kind)) = discovered.by_aa_rel.get(aa_rel) {
                candidate_targets.push((file_name.into(), t_rel.clone(), t_kind.clone(), false, None));
            } else {
                direct_unmatched_reason = Some("StreamingAssets/aa 下不存在该名称的原始资源".into());
            }
        } else if let Some(modimg_name) = modimg_target_name(&raw.source_entry) {
            candidate_targets.push((
                modimg_name.clone(),
                format!("modimg/{modimg_name}"),
                "modimg".into(),
                false,
                None,
            ));
        } else if let Some(embedded_id) = file_lower
            .ends_with(".bundle")
            .then(|| extract_embedded_unityfs_bundle_id(&raw.bytes))
            .flatten()
        {
            if discovered
                .protected_runtime_bundle_id
                .as_deref()
                .is_some_and(|rt_id| rt_id.eq_ignore_ascii_case(&embedded_id))
            {
                conflicts.push(format!("{file_name} 属于星枢运行时核心容器，第三方模组无法覆盖。"));
                continue;
            }
            if let Some(targets) = lookup_hex_targets(&discovered, &embedded_id) {
                for (t_rel, t_kind) in targets {
                    candidate_targets.push((embedded_id.clone(), t_rel.clone(), t_kind.clone(), false, None));
                }
            } else {
                direct_unmatched_reason = Some(format!(
                    "重命名 Bundle 文件（内置容器 ID {embedded_id}）与当前游戏版本不匹配，需重新适配 3.3.0"
                ));
            }
        } else {
            direct_unmatched_reason = Some("非 32 位 Hash Bundle 文件，且未指定 StreamingAssets/aa 或 modimg/ 路径".into());
        }

        // Cross-version Catalog auto-adapt fallback for old/renamed UnityFS containers
        let mut fallback_note: Option<String> = None;
        if candidate_targets.is_empty() && !has_catalog_bundle {
            if let Some(ref summary) = bundle_summary {
                if !summary.texture_names.is_empty()
                    && summary.monobehaviour_names.is_empty()
                    && summary.other_object_count == 0
                {
                    let catalogs = lazy_catalogs
                        .get_or_insert_with(|| crate::game_art::load_game_catalogs(game, root));
                    let mut extract_err: Option<String> = None;
                    for tex_name in &summary.texture_names {
                        if !is_valid_asset_basename(tex_name) {
                            continue;
                        }
                        if crate::game_art::resolve_asset_bundles(catalogs, tex_name).is_empty() {
                            continue;
                        }
                        match crate::mod_inspector::extract_texture_full_png_from_bundle(&raw.bytes, tex_name) {
                            Ok(png_bytes) => {
                                adapted_modimg_count += 1;
                                let bid = format!("tex.{}", &sha256_hex(tex_name.as_bytes())[..12]);
                                candidate_targets.push((
                                    bid,
                                    format!("modimg/{tex_name}.png"),
                                    "modimg_adapted".into(),
                                    false,
                                    Some(png_bytes),
                                ));
                            }
                            Err(e) => {
                                extract_err = Some(format!("贴图 '{tex_name}' 解码失败：{e}"));
                            }
                        }
                    }
                    if candidate_targets.is_empty() {
                        fallback_note = extract_err.or_else(|| {
                            Some(format!(
                                "容器内贴图 [{}] 未在当前版本游戏 Addressables Catalog 中匹配到目标",
                                summary.texture_names.join(", ")
                            ))
                        });
                    }
                } else if summary.monobehaviour_names.len() == 1
                    && summary.texture_names.is_empty()
                    && summary.other_object_count == 0
                {
                    let mb_name = &summary.monobehaviour_names[0];
                    if mb_name.to_ascii_lowercase().starts_with("vut_") && is_valid_asset_basename(mb_name) {
                        dynamic_card_count += 1;
                        candidate_targets.push((
                            "dynamic_card".into(),
                            format!("{DYNAMIC_CARDS_DIR}/{mb_name}.bundle"),
                            "dynamic_card".into(),
                            false,
                            None,
                        ));
                    } else {
                        let catalogs = lazy_catalogs
                            .get_or_insert_with(|| crate::game_art::load_game_catalogs(game, root));
                        let bundles = crate::game_art::resolve_asset_bundles(catalogs, mb_name);
                        let mut last_err: Option<String> = None;
                        'mb_search: for b_name in &bundles {
                            let Some(stem) = Path::new(b_name).file_stem().and_then(|s| s.to_str()) else {
                                continue;
                            };
                            let hex_id = stem.to_ascii_lowercase();
                            let Some(targets) = lookup_hex_targets(&discovered, &hex_id) else {
                                continue;
                            };
                            for (t_rel, _) in targets {
                                match read_vanilla_bundle_baseline(root, t_rel)
                                    .map_err(|e| e.message)
                                    .and_then(|van| {
                                        crate::mod_inspector::migrate_single_monobehaviour_bundle(&van, &raw.bytes)
                                    }) {
                                    Ok(migrated) => {
                                        migrated_bundle_count += 1;
                                        candidate_targets.push((
                                            hex_id.clone(),
                                            t_rel.clone(),
                                            "migrated_bundle".into(),
                                            false,
                                            Some(migrated),
                                        ));
                                        break 'mb_search;
                                    }
                                    Err(e) => {
                                        last_err = Some(e);
                                    }
                                }
                            }
                        }
                        if candidate_targets.is_empty() {
                            fallback_note = Some(if bundles.is_empty() {
                                format!("MonoBehaviour '{mb_name}' 未在当前版本 Addressables Catalog 中找到")
                            } else {
                                format!(
                                    "MonoBehaviour '{mb_name}' 自动迁移失败：{}",
                                    last_err.unwrap_or_else(|| "当前游戏目录未下载对应 3.3.0 原版容器".into())
                                )
                            });
                        }
                    }
                } else if file_lower.ends_with(".bundle") && !summary.cab_names.is_empty() {
                    let cab_index = lazy_cab_index.get_or_insert_with(|| {
                        let mut idx: HashMap<String, Vec<(String, String)>> = HashMap::new();
                        for (hx, vec) in &discovered.by_hex {
                            if discovered
                                .protected_runtime_bundle_id
                                .as_deref()
                                .is_some_and(|rt| rt.eq_ignore_ascii_case(hx))
                            {
                                continue;
                            }
                            for (t_rel, _) in vec {
                                if let Ok(abs) = confined(root, t_rel) {
                                    if let Ok((cabs, _)) = crate::mod_inspector::extract_bundle_cab_names_from_file(&abs) {
                                        for cab in cabs {
                                            idx.entry(cab.to_ascii_lowercase())
                                                .or_default()
                                                .push((hx.clone(), t_rel.clone()));
                                        }
                                    }
                                }
                            }
                        }
                        idx
                    });
                    for cab in &summary.cab_names {
                        if let Some(matches) = cab_index.get(&cab.to_ascii_lowercase()) {
                            for (hx, t_rel) in matches {
                                cab_matched_count += 1;
                                candidate_targets.push((
                                    hx.clone(),
                                    t_rel.clone(),
                                    "cab_matched_bundle".into(),
                                    false,
                                    None,
                                ));
                            }
                            if !candidate_targets.is_empty() {
                                break;
                            }
                        }
                    }
                }
            }
        }

        if candidate_targets.is_empty() {
            unmatched_files.push(DroppedModUnmatchedFile {
                source_entry: raw.source_entry,
                reason: fallback_note
                    .or(direct_unmatched_reason)
                    .unwrap_or_else(|| "未能在当前游戏目录匹配到可替换目标。".into()),
                size: raw.bytes.len() as u64,
            });
            continue;
        }

        for (bundle_id, target_rel, target_kind, is_catalog, custom_bytes) in candidate_targets {
            push_resolved_target_entry(
                root, &discovered, &active_owners, &mut seen_targets,
                &mut warnings, &mut conflicts, &mut matched_files, &mut staged_candidates,
                &raw.source_entry,
                &raw.bytes,
                bundle_id,
                target_rel,
                target_kind,
                is_catalog,
                custom_bytes,
            )?;
        }
    }

    if cab_matched_count > 0 {
        warnings.push(format!(
            "已通过 UnityFS CAB 指纹为 {cab_matched_count} 个重命名模型/动作 Bundle 自动匹配目标容器。"
        ));
    }
    if rml_patched_count > 0 {
        warnings.push(format!(
            "已成功解析并应用 {rml_patched_count} 项 RML (mod.json) 原生容器补丁。"
        ));
    }

    if adapted_modimg_count > 0 {
        warnings.push(format!(
            "已自动将 {adapted_modimg_count} 个旧版贴图容器无损提取为 modimg/*.png（PC 与安卓手机通用，游戏升级不失效）。"
        ));
    }
    if migrated_bundle_count > 0 {
        warnings.push(format!(
            "已自动将 {migrated_bundle_count} 个旧版技能/大厅视频容器迁移重构至当前 3.3.0 原版容器。"
        ));
    }
    if dynamic_card_count > 0 {
        warnings.push(format!(
            "已识别 {dynamic_card_count} 个无加密动态立绘资源，将安装至 xingshu_dynamic_cards/ 目录。"
        ));
    }
    if apenc_skipped_count > 0 {
        warnings.push(format!(
            "已自动跳过 {apenc_skipped_count} 个 APENC01 加密动态立绘文件（星枢原生动态立绘不支持也不绕过官方加密，其余立绘/技能资源可正常使用）。"
        ));
    }
    if backup_skipped_count > 0 {
        warnings.push(format!(
            "检测到 {backup_skipped_count} 个原版对照/备份子目录文件（如 原/），已自动忽略避免误覆盖。"
        ));
    }
    if addr_group_fallback_count > 0 {
        warnings.push(format!(
            "已通过 Addressables 分组自动对齐 {addr_group_fallback_count} 个热更缓存目标（目录 Hash 已随游戏更新）。"
        ));
    }
    if has_catalog_bundle {
        warnings.push(
            "检测到 catalog.bundle（高风险 · 游戏版本敏感）：仅与作者同版本游戏兼容，跨版本覆盖可能导致游戏白屏或闪退。建议优先仅安装非 catalog 的 Bundle，或确认版本一致后再勾选包含 catalog.bundle。"
                .into(),
        );
    }
    if !unmatched_files.is_empty() && matched_files.is_empty() {
        warnings.push("未能在当前所选游戏目录匹配到任何可替换的资源文件，请确认游戏渠道或版本是否一致。".into());
    } else if !unmatched_files.is_empty() {
        warnings.push(format!(
            "有 {} 个资源未在当前游戏目录匹配到目标（安装时将自动跳过）。",
            unmatched_files.len()
        ));
    }
    if already_installed {
        warnings.push("此模组当前已处于安装状态；如需重新安装请先还原。".into());
    }

    conflicts.sort();
    conflicts.dedup();
    let android_exportable_count = matched_files
        .iter()
        .filter(|f| {
            !f.is_catalog
                && f.conflict_with.is_none()
                && matches!(f.target_kind.as_str(), "modimg" | "modimg_adapted" | "rml_modimg")
                && f.target_rel.starts_with("modimg/")
                && f.target_rel.to_ascii_lowercase().ends_with(".png")
        })
        .count();
    let has_non_catalog_or_any = !matched_files.is_empty();
    let compatible = has_non_catalog_or_any && conflicts.is_empty();
    let can_install = compatible && !already_installed;

    let result = DroppedModInspectResult {
        mod_id,
        display_name,
        source_path: source_path.display().to_string(),
        source_kind,
        installation_id: installation_id.to_string(),
        game_platform: game.platform.clone(),
        game_root: root.display().to_string(),
        compatible,
        can_install,
        already_installed,
        has_catalog_bundle,
        android_exportable_count,
        warnings,
        matched_files,
        unmatched_files,
        conflicts,
        preview_files,
        doc_files,
        xspkg_manifest: None,
    };
    Ok((result, staged_candidates))
}

fn restore_bundle_receipt(root: &Path, receipt: &DroppedModReceipt) -> HubResult<()> {
    if receipt.phase == "restored" {
        return Ok(());
    }
    if receipt.files.is_empty() {
        return Err(HubError::storage_error("没有可还原的模组文件记录。"));
    }

    for f in &receipt.files {
        let (_, target_abs) = validate_dropped_target_rel(root, &f.target)?;
        let current_hash = if target_abs.is_file() {
            compute_file_sha256(&target_abs)?
        } else {
            String::new()
        };
        if f.baseline_sha256.is_empty() {
            if !is_addon_target_rel(&f.target) {
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
        let (_, target_abs) = validate_dropped_target_rel(root, &f.target)?;
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
    save_receipt(root, &updated)
}

pub(crate) fn install_dropped_from_path(
    game: &GameInstallation,
    root: &Path,
    source_path: &Path,
    include_catalog: bool,
    install_service: Option<&InstallService>,
    backup_repo: Option<&BackupRepository>,
) -> HubResult<DroppedModInstallResult> {
    install_dropped_from_path_with_password(
        game,
        root,
        source_path,
        include_catalog,
        None,
        install_service,
        backup_repo,
    )
}

fn install_dropped_from_path_with_password(
    game: &GameInstallation,
    root: &Path,
    source_path: &Path,
    include_catalog: bool,
    password: Option<&str>,
    install_service: Option<&InstallService>,
    backup_repo: Option<&BackupRepository>,
) -> HubResult<DroppedModInstallResult> {
    let _lock = operation_lock(root)?;
    install_dropped_in_locked_root_with_password(
        game,
        root,
        source_path,
        include_catalog,
        password,
        install_service,
        backup_repo,
    )
}

pub(crate) fn install_dropped_in_locked_root(
    game: &GameInstallation,
    root: &Path,
    source_path: &Path,
    include_catalog: bool,
    install_service: Option<&InstallService>,
    backup_repo: Option<&BackupRepository>,
) -> HubResult<DroppedModInstallResult> {
    install_dropped_in_locked_root_with_password(
        game,
        root,
        source_path,
        include_catalog,
        None,
        install_service,
        backup_repo,
    )
}

fn install_dropped_in_locked_root_with_password(
    game: &GameInstallation,
    root: &Path,
    source_path: &Path,
    include_catalog: bool,
    password: Option<&str>,
    install_service: Option<&InstallService>,
    backup_repo: Option<&BackupRepository>,
) -> HubResult<DroppedModInstallResult> {
    game_closed(game)?;
    let (inspect, candidates) =
        inspect_against_game_with_password(game, &game.id, root, source_path, password)?;

    if let Some(existing) = read_receipt(root, &inspect.mod_id)? {
        if existing.phase != "restored" {
            return Err(HubError::invalid_manifest("该模组当前已安装或处于未完成状态，请先还原。"));
        }
    }

    if inspect.source_kind == "xspkg" {
        let svc = install_service.ok_or_else(|| HubError::storage_error("安装服务未就绪。"))?;
        let cache = xspkg_payload_path(root, &inspect.mod_id)?;
        let raw = crate::workshop::read_local_archive(source_path, MAX_DROP_ARCHIVE_BYTES)?;
        atomic_write(&cache, &raw)?;
        let tx = svc.install_mod_package_in_locked_root(&cache, game)?;
        if tx.state != "COMPLETED" {
            return Err(HubError::transaction_error("模组安装事务未完成。"));
        }
        let receipt_files: Vec<DroppedModReceiptFile> = inspect
            .matched_files
            .iter()
            .enumerate()
            .map(|(index, m)| DroppedModReceiptFile {
                index,
                target: m.target_rel.clone(),
                mod_sha256: m.sha256.clone(),
                baseline_sha256: m.current_sha256.clone(),
                is_catalog: m.is_catalog,
            })
            .collect();
        let receipt = DroppedModReceipt {
            mod_id: inspect.mod_id.clone(),
            name: inspect.display_name.clone(),
            source_kind: "xspkg".into(),
            phase: "installed".into(),
            installed_at: Utc::now().to_rfc3339(),
            transaction_id: Some(tx.id.clone()),
            backup_id: tx.backup_id.clone(),
            files: receipt_files,
            archive_sha256: Some(sha256_hex(&raw)),
        };
        save_receipt(root, &receipt)?;
        return Ok(DroppedModInstallResult {
            mod_id: receipt.mod_id,
            display_name: receipt.name,
            phase: receipt.phase,
            message: "已完成 .xspkg 扩展包安全校验与事务安装。".into(),
            installed_count: inspect.matched_files.len(),
            backup_id: tx.backup_id,
            transaction_id: Some(tx.id),
        });
    }

    let selected: Vec<StagedCandidate> = candidates
        .into_iter()
        .filter(|c| include_catalog || !c.is_catalog)
        .collect();

    if selected.is_empty() {
        return Err(HubError::invalid_manifest(if inspect.has_catalog_bundle && !include_catalog {
            "仅包含 catalog.bundle；如确认与当前游戏版本一致，请勾选「包含 catalog.bundle」后再安装。"
        } else {
            "未匹配到可替换的游戏资源文件，无法安装。"
        }));
    }

    // Re-check conflicts strictly for the selected targets.
    for entry in &inspect.matched_files {
        if !include_catalog && entry.is_catalog {
            continue;
        }
        if let Some(ref conflict) = entry.conflict_with {
            return Err(HubError::security_violation(format!(
                "目标 {} 存在冲突：{conflict}",
                entry.target_rel
            )));
        }
    }

    game_closed(game)?;

    let mut targets_and_baselines = Vec::with_capacity(selected.len());
    for c in &selected {
        let (_, target_abs) = validate_dropped_target_rel(root, &c.target_rel)?;
        let baseline_hash = if target_abs.is_file() {
            compute_file_sha256(&target_abs)?
        } else if is_addon_target_rel(&c.target_rel) {
            String::new()
        } else {
            return Err(HubError::invalid_manifest(format!(
                "目标资产 {} 不存在，无法安全替换。",
                c.target_rel
            )));
        };
        targets_and_baselines.push((target_abs, baseline_hash));
    }

    let mut receipt_files = Vec::with_capacity(selected.len());
    for (idx, ((target_abs, baseline_hash), entry)) in
        targets_and_baselines.iter().zip(selected.iter()).enumerate()
    {
        if !baseline_hash.is_empty() {
            let backup_dest = backup_file_path(root, &inspect.mod_id, idx)?;
            let baseline_bytes = fs::read(target_abs).map_err(|e| HubError::storage_error(e.to_string()))?;
            if sha256_hex(&baseline_bytes) != *baseline_hash {
                return Err(HubError::security_violation("备份期间原游戏文件发生变化，已终止。"));
            }
            atomic_write(&backup_dest, &baseline_bytes)?;
            if compute_file_sha256(&backup_dest)? != *baseline_hash {
                return Err(HubError::security_violation("安装前备份校验失败。"));
            }
        }
        receipt_files.push(DroppedModReceiptFile {
            index: idx,
            target: entry.target_rel.clone(),
            mod_sha256: entry.sha256.clone(),
            baseline_sha256: baseline_hash.clone(),
            is_catalog: entry.is_catalog,
        });
    }

    let backup_id = uuid::Uuid::new_v4().to_string();
    let backup_storage = confined(root, &format!(".xingshu-mods/dropped-backups/{}/baseline", inspect.mod_id))?;
    let mut receipt = DroppedModReceipt {
        mod_id: inspect.mod_id.clone(),
        name: inspect.display_name.clone(),
        source_kind: inspect.source_kind.clone(),
        phase: "prepared".into(),
        installed_at: Utc::now().to_rfc3339(),
        transaction_id: None,
        backup_id: Some(backup_id.clone()),
        files: receipt_files,
        archive_sha256: None,
    };

    save_receipt(root, &receipt)?;

    let commit = (|| -> HubResult<()> {
        for (idx, ((target_abs, _), entry)) in
            targets_and_baselines.iter().zip(selected.iter()).enumerate()
        {
            if let Ok(payload_dest) = payload_file_path(root, &receipt.mod_id, idx) {
                let _ = atomic_write(&payload_dest, &entry.bytes);
            }
            atomic_write(target_abs, &entry.bytes)?;
            let post_hash = compute_file_sha256(target_abs)?;
            if !post_hash.eq_ignore_ascii_case(&receipt.files[idx].mod_sha256) {
                return Err(HubError::security_violation("写入后的模组文件哈希校验失败。"));
            }
        }
        receipt.phase = "installed".into();
        save_receipt(root, &receipt)
    })();

    if let Err(err) = commit {
        return match restore_bundle_receipt(root, &receipt) {
            Ok(()) => Err(err),
            Err(rollback_err) => Err(HubError::storage_error(format!(
                "{err}；自动回滚未完成：{rollback_err}。已保留备份，请重试还原。"
            ))),
        };
    }

    if let Some(repo) = backup_repo {
        let now = Utc::now();
        let backup_record = Backup {
            id: backup_id.clone(),
            backup_type: "DROPPED_MOD_PRE_INSTALL".into(),
            target_id: Some(game.id.clone()),
            storage_path: backup_storage.display().to_string(),
            manifest_json: serde_json::json!({
                "modId": receipt.mod_id,
                "name": receipt.name,
                "sourceKind": receipt.source_kind,
                "files": receipt.files.iter().map(|f| serde_json::json!({
                    "target": f.target,
                    "baselineSha256": f.baseline_sha256,
                    "modSha256": f.mod_sha256,
                })).collect::<Vec<_>>()
            }),
            created_at: now,
            verified_at: Some(now),
            status: "VERIFIED".into(),
        };
        let _ = repo.save(&backup_record);
    }

    Ok(DroppedModInstallResult {
        mod_id: receipt.mod_id,
        display_name: receipt.name.clone(),
        phase: receipt.phase,
        message: format!(
            "已自动备份原版文件并成功安装「{}」（共替换 {} 个资源）。",
            receipt.name,
            receipt.files.len()
        ),
        installed_count: receipt.files.len(),
        backup_id: receipt.backup_id,
        transaction_id: None,
    })
}

pub(crate) fn restore_dropped_by_id(
    game: &GameInstallation,
    root: &Path,
    mod_id: &str,
    install_service: Option<&InstallService>,
) -> HubResult<String> {
    let _lock = operation_lock(root)?;
    restore_dropped_in_locked_root(game, root, mod_id, install_service)
}

pub(crate) fn restore_dropped_in_locked_root(
    game: &GameInstallation, root: &Path, mod_id: &str, install_service: Option<&InstallService>,
) -> HubResult<String> {
    let clean_id = sanitize_mod_id(mod_id)?;
    game_closed(game)?;
    let receipt = read_receipt(root, &clean_id)?
        .ok_or_else(|| HubError::storage_error("未找到该拖入模组的安装备份记录。"))?;

    if receipt.phase == "disabled" {
        let mut updated = receipt;
        updated.phase = "restored".into();
        save_receipt(root, &updated)?;
        return Ok("已移除停用的模组记录，备份与缓存会保留。".into());
    }
    if receipt.source_kind == "xspkg" {
        let tx_id = receipt
            .transaction_id
            .clone()
            .ok_or_else(|| HubError::storage_error("缺少 .xspkg 事务标识，请前往安装事务页回滚。"))?;
        let svc = install_service.ok_or_else(|| HubError::storage_error("安装服务未就绪。"))?;
        svc.rollback_mod_transaction(&tx_id, &game.id)?;
        let mut updated = receipt;
        updated.phase = "restored".into();
        save_receipt(root, &updated)?;
        return Ok("已通过安装事务回滚 .xspkg 模组，原文件已恢复。".into());
    }

    restore_bundle_receipt(root, &receipt)?;
    Ok(format!("已还原「{}」安装前的原版文件，备份保留。", receipt.name))
}

fn export_android_pack_from_path(
    game: &GameInstallation,
    root: &Path,
    source_path: &Path,
    password: Option<&str>,
    output_path: Option<&Path>,
) -> HubResult<String> {
    let (inspect, candidates) =
        inspect_against_game_with_password(game, &game.id, root, source_path, password)?;

    let export_entries: Vec<&StagedCandidate> = candidates
        .iter()
        .filter(|c| !c.is_catalog && is_addon_target_rel(&c.target_rel))
        .collect();
    let modimg_png_count = export_entries
        .iter()
        .filter(|c| c.target_rel.starts_with("modimg/") && c.target_rel.to_ascii_lowercase().ends_with(".png"))
        .count();
    if modimg_png_count == 0 {
        return Err(HubError::invalid_manifest(
            "该模组包未包含可导出为安卓 modimg/*.png 的贴图资源。",
        ));
    }

    let safe_base: String = inspect
        .display_name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .take(80)
        .collect();
    let default_file_name = format!("{}_Android_modimg.zip", safe_base.trim().trim_matches('.'));

    let dest_path = if let Some(explicit) = output_path {
        if explicit.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err(HubError::security_violation("导出目标路径不允许包含上级目录跳转。"));
        }
        explicit.to_path_buf()
    } else {
        let is_staged = source_path.to_string_lossy().contains("staged-drops");
        let base_dir = if is_staged {
            dirs::download_dir()
                .or_else(|| source_path.parent().map(Path::to_path_buf))
                .unwrap_or_else(std::env::temp_dir)
        } else {
            source_path
                .parent()
                .map(Path::to_path_buf)
                .or_else(dirs::download_dir)
                .unwrap_or_else(std::env::temp_dir)
        };
        base_dir.join(default_file_name)
    };

    let parent = dest_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| HubError::storage_error("无效的导出路径。"))?;
    fs::create_dir_all(parent).map_err(|e| HubError::storage_error(e.to_string()))?;

    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| HubError::storage_error(format!("创建临时导出文件失败：{e}")))?;
    {
        let mut zf = zip::ZipWriter::new(tmp.as_file_mut());
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for item in &export_entries {
            zf.start_file(&item.target_rel, opts)
                .map_err(|e| HubError::storage_error(format!("写入压缩条目失败：{e}")))?;
            zf.write_all(&item.bytes)
                .map_err(|e| HubError::storage_error(format!("写入贴图数据失败：{e}")))?;
        }
        zf.finish()
            .map_err(|e| HubError::storage_error(format!("完成安卓模组包封装失败：{e}")))?;
    }
    tmp.as_file()
        .sync_all()
        .map_err(|e| HubError::storage_error(e.to_string()))?;
    tmp.persist(&dest_path)
        .map_err(|e| HubError::storage_error(format!("保存安卓模组包失败：{e}")))?;

    Ok(dest_path.display().to_string())
}

#[tauri::command]
pub async fn inspect_dropped_mod(
    installation_id: String,
    source_path: String,
    password: Option<String>,
    center: State<'_, ExtensionCenter>,
) -> HubResult<DroppedModInspectResult> {
    let game = get_game(&center.db, &installation_id)?;
    let root = game_root(&game)?;
    let trimmed = source_path.trim().trim_matches('"').to_string();
    if trimmed.is_empty() {
        return Err(HubError::invalid_manifest("请提供有效的模组文件或文件夹路径。"));
    }
    tokio::task::spawn_blocking(move || {
        let (res, _) = inspect_against_game_with_password(
            &game,
            &installation_id,
            &root,
            Path::new(&trimmed),
            password.as_deref(),
        )?;
        Ok(res)
    })
    .await
    .map_err(|e| HubError::storage_error(e.to_string()))?
}

#[tauri::command]
pub async fn install_dropped_mod(
    installation_id: String,
    source_path: String,
    include_catalog: bool,
    password: Option<String>,
    center: State<'_, ExtensionCenter>,
    install_service: State<'_, InstallService>,
) -> HubResult<DroppedModInstallResult> {
    let game = get_game(&center.db, &installation_id)?;
    let root = game_root(&game)?;
    let trimmed = source_path.trim().trim_matches('"').to_string();
    if trimmed.is_empty() {
        return Err(HubError::invalid_manifest("请提供有效的模组文件或文件夹路径。"));
    }
    let svc = install_service.inner();
    let backup_repo = BackupRepository::new(center.db.clone());
    tokio::task::block_in_place(|| {
        install_dropped_from_path_with_password(
            &game,
            &root,
            Path::new(&trimmed),
            include_catalog,
            password.as_deref(),
            Some(svc),
            Some(&backup_repo),
        )
    })
}

#[tauri::command]
pub async fn export_dropped_mod_android_pack(
    installation_id: String,
    source_path: String,
    password: Option<String>,
    output_path: Option<String>,
    center: State<'_, ExtensionCenter>,
) -> HubResult<String> {
    let game = get_game(&center.db, &installation_id)?;
    let root = game_root(&game)?;
    let trimmed = source_path.trim().trim_matches('"').to_string();
    if trimmed.is_empty() {
        return Err(HubError::invalid_manifest("请提供有效的模组文件或文件夹路径。"));
    }
    let out_trimmed = output_path
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty());
    tokio::task::spawn_blocking(move || {
        export_android_pack_from_path(
            &game,
            &root,
            Path::new(&trimmed),
            password.as_deref(),
            out_trimmed.as_deref().map(Path::new),
        )
    })
    .await
    .map_err(|e| HubError::storage_error(e.to_string()))?
}

#[tauri::command]
pub async fn restore_dropped_mod(
    installation_id: String,
    mod_id: String,
    center: State<'_, ExtensionCenter>,
    install_service: State<'_, InstallService>,
) -> HubResult<String> {
    let game = get_game(&center.db, &installation_id)?;
    let root = game_root(&game)?;
    let svc = install_service.inner();
    tokio::task::block_in_place(|| restore_dropped_by_id(&game, &root, &mod_id, Some(svc)))
}

#[tauri::command]
pub async fn toggle_dropped_mod(
    installation_id: String,
    mod_id: String,
    enabled: bool,
    center: State<'_, ExtensionCenter>,
    install_service: State<'_, InstallService>,
) -> HubResult<DroppedModRecord> {
    let game = get_game(&center.db, &installation_id)?;
    let root = game_root(&game)?;
    let service = install_service.inner();
    tokio::task::block_in_place(|| {
        let _lock = operation_lock(&root)?;
        toggle_dropped_in_locked_root(&game, &root, &mod_id, enabled, service)
    })
}

impl From<DroppedModReceipt> for DroppedModRecord {
    fn from(receipt: DroppedModReceipt) -> Self {
        let has_catalog = receipt.files.iter().any(|f| f.is_catalog);
        let targets: Vec<_> = receipt.files.into_iter().map(|f| f.target).collect();
        Self {
            mod_id: receipt.mod_id,
            name: receipt.name,
            source_kind: receipt.source_kind,
            can_restore: matches!(receipt.phase.as_str(), "installed" | "prepared" | "disabled"),
            phase: receipt.phase,
            installed_at: receipt.installed_at,
            file_count: targets.len(),
            targets,
            has_catalog,
            transaction_id: receipt.transaction_id,
            backup_id: receipt.backup_id,
        }
    }
}

pub(crate) fn managed_drop(root: &Path, id: &str) -> HubResult<Option<DroppedModRecord>> {
    Ok(read_receipt(root, id)?.map(DroppedModRecord::from).filter(|record| record.can_restore))
}

pub(crate) fn toggle_dropped_in_locked_root(
    game: &GameInstallation, root: &Path, id: &str, enabled: bool, service: &InstallService,
) -> HubResult<DroppedModRecord> {
    game_closed(game)?;
    let clean_id = sanitize_mod_id(id)?;
    let mut receipt = read_receipt(root, &clean_id)?
        .ok_or_else(|| HubError::storage_error("未找到该本地模组的安装收据。"))?;
    let phase = if enabled { "installed" } else { "disabled" };
    if receipt.phase == phase {
        return Ok(receipt.into());
    }
    if !matches!(receipt.phase.as_str(), "installed" | "disabled") {
        return Err(HubError::invalid_manifest("请先还原上次未完成的模组操作。"));
    }

    if receipt.source_kind == "xspkg" {
        let cache = xspkg_payload_path(root, &clean_id)?;
        crate::workshop::validate_cached_package(&cache, receipt.archive_sha256.as_deref(), MAX_DROP_ARCHIVE_BYTES)?;
        if enabled {
            let tx = service.install_mod_package_in_locked_root(&cache, game)?;
            if tx.state != "COMPLETED" {
                return Err(HubError::transaction_error("模组启用事务未完成。"));
            }
            receipt.transaction_id = Some(tx.id);
            receipt.backup_id = tx.backup_id;
        } else {
            let tx = receipt.transaction_id.as_deref()
                .ok_or_else(|| HubError::storage_error("缺少模组安装事务标识。"))?;
            service.rollback_mod_transaction(tx, &game.id)?;
        }
    } else {
        let mut files = Vec::with_capacity(receipt.files.len());
        for file in &receipt.files {
            let (_, target) = validate_dropped_target_rel(root, &file.target)?;
            files.push(SwitchFile {
                target,
                baseline: backup_file_path(root, &clean_id, file.index)?,
                payload: payload_file_path(root, &clean_id, file.index)?,
                baseline_sha256: file.baseline_sha256.clone(),
                mod_sha256: file.mod_sha256.clone(),
            });
        }
        if enabled {
            let owners = collect_active_target_owners(root, &clean_id)?;
            if receipt.files.iter().any(|file| owners.contains_key(&target_key(&file.target))) {
                return Err(HubError::security_violation("该资源正在由其他模组使用，请先停用冲突项。"));
            }
        }
        mod_resources::set_enabled(&files, enabled)?;
    }
    receipt.phase = phase.into();
    save_receipt(root, &receipt)?;
    Ok(receipt.into())
}

#[tauri::command]
pub async fn list_dropped_mods(
    installation_id: String,
    center: State<'_, ExtensionCenter>,
) -> HubResult<Vec<DroppedModRecord>> {
    if installation_id.trim().is_empty() {
        return Ok(Vec::new());
    }
    let game = get_game(&center.db, &installation_id)?;
    let root = game_root(&game)?;
    tokio::task::spawn_blocking(move || {
        let dir = confined(&root, ".xingshu-mods/dropped-receipts")?;
        if !dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut records = Vec::new();
        for entry in fs::read_dir(&dir).map_err(|e| HubError::storage_error(e.to_string()))?.flatten() {
            let p = entry.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            if let Some(id) = p.file_stem().and_then(|stem| stem.to_str()) {
                if let Ok(Some(receipt)) = read_receipt(&root, id) {
                    records.push(DroppedModRecord::from(receipt));
                }
            }
        }
        records.sort_by(|a, b| b.installed_at.cmp(&a.installed_at));
        Ok(records)
    })
    .await
    .map_err(|e| HubError::storage_error(e.to_string()))?
}

fn percent_decode_utf8(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn save_staged_drop_file(app: &tauri::AppHandle, file_name: &str, bytes: &[u8]) -> HubResult<String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_DROP_ARCHIVE_BYTES {
        return Err(HubError::security_violation("选择的文件为空或超过 1GB 安全上限。"));
    }
    let raw_name = Path::new(file_name)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| HubError::security_violation("文件名无效。"))?;
    let clean_name = raw_name
        .chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect::<String>();
    let lower = clean_name.to_ascii_lowercase();
    check_forbidden_extension(&lower)?;
    if !(lower.ends_with(".zip")
        || lower.ends_with(".rar")
        || lower.ends_with(".xspkg")
        || lower.ends_with(".apmm")
        || lower.ends_with(".bundle"))
    {
        return Err(HubError::invalid_manifest("仅支持选择 .zip、.rar、.xspkg、.apmm 或 .bundle 文件。"));
    }
    let base_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("xingshu-hub"));
    let stage_dir = base_dir.join("staged-drops");
    fs::create_dir_all(&stage_dir).map_err(|e| HubError::storage_error(e.to_string()))?;
    let dest = stage_dir.join(format!("{}-{clean_name}", uuid::Uuid::new_v4()));
    atomic_write(&dest, bytes)?;
    Ok(dest.display().to_string())
}

/// Fallback staging endpoint for HTML `<input type="file">` selection when a full path is unavailable.
#[tauri::command]
pub async fn stage_dropped_mod_bytes(
    file_name: String,
    bytes: Vec<u8>,
    app: tauri::AppHandle,
) -> HubResult<String> {
    save_staged_drop_file(&app, &file_name, &bytes)
}

/// Fast binary IPC staging endpoint for HTML `<input type="file">` without JSON array overhead.
#[tauri::command]
pub async fn stage_dropped_mod_raw(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
) -> HubResult<String> {
    let raw_header = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| HubError::invalid_manifest("缺少上传文件名请求头。"))?;
    let file_name = percent_decode_utf8(raw_header);
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(HubError::invalid_manifest("仅支持二进制原始数据流上传。"));
    };
    save_staged_drop_file(&app, &file_name, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_HEX_A: &str = "0123456789abcdef0123456789abcdef";
    const TEST_HEX_B: &str = "fedcba9876543210fedcba9876543210";

    fn fixture_game(root: &Path) -> GameInstallation {
        fs::create_dir_all(root).unwrap();
        let exe = root.join("AstralParty_CN.exe");
        fs::write(&exe, b"exe").unwrap();
        fs::write(root.join("GameAssembly.dll"), b"dll").unwrap();

        let aa = root.join("AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64");
        fs::create_dir_all(&aa).unwrap();
        fs::write(aa.join(format!("{TEST_HEX_A}.bundle")), b"orig-streaming-a").unwrap();
        fs::write(root.join("AstralParty_CN_Data/StreamingAssets/aa/catalog.bundle"), b"orig-catalog").unwrap();

        let addr = root.join(format!("AstralParty_CN_Data/com.unity.addressables/AssetBundles/abc/{TEST_HEX_B}"));
        fs::create_dir_all(&addr).unwrap();
        fs::write(addr.join("__data"), b"orig-addr-b").unwrap();

        GameInstallation {
            id: "inst-drop-test".into(),
            platform: "STEAM_CN".into(),
            platform_app_id: Some("2622000".into()),
            install_path: root.display().to_string(),
            executable_path: Some(exe.display().to_string()),
            detected_build_id: None,
            detected_version: None,
            detection_method: "TEST".into(),
            is_valid: true,
            is_primary: true,
            last_verified_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let f = fs::File::create(path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default();
        for (name, data) in entries {
            z.start_file(*name, opts).unwrap();
            z.write_all(data).unwrap();
        }
        z.finish().unwrap();
    }

    #[test]
    fn inspects_community_zip_with_nested_folders_catalog_previews_and_unmatched() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("game");
        fs::create_dir_all(&game_dir).unwrap();
        let game = fixture_game(&game_dir);

        let zip_path = tmp.path().join("哈基米doro替换泳装哈基米移动.zip");
        let unknown_hex = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        write_zip(
            &zip_path,
            &[
                (&format!("游戏根目录/AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64/{TEST_HEX_A}.bundle"), b"mod-a"),
                (&format!("Mod本体/{TEST_HEX_B}.bundle"), b"mod-b"),
                ("游戏根目录/AstralParty_CN_Data/StreamingAssets/aa/catalog.bundle", b"mod-catalog"),
                (&format!("Mod本体/{unknown_hex}.bundle"), b"unmatched"),
                ("预览图.png", b"png-bytes"),
                ("安装说明.txt", b"readme"),
            ],
        );

        let (result, _) = inspect_against_game(&game, &game.id, &game_dir, &zip_path).unwrap();
        assert_eq!(result.source_kind, "community_zip");
        assert!(result.has_catalog_bundle);
        assert!(result.compatible);
        assert!(result.can_install);
        assert_eq!(result.matched_files.len(), 3);
        assert_eq!(result.unmatched_files.len(), 1);
        assert_eq!(result.preview_files, vec!["预览图.png"]);
        assert_eq!(result.doc_files, vec!["安装说明.txt"]);
        assert!(result.warnings.iter().any(|w| w.contains("catalog.bundle")));

        let a_match = result.matched_files.iter().find(|m| m.bundle_id == TEST_HEX_A).unwrap();
        assert_eq!(a_match.target_kind, "streaming_assets");
        let b_match = result.matched_files.iter().find(|m| m.bundle_id == TEST_HEX_B).unwrap();
        assert_eq!(b_match.target_kind, "addressables");
        assert!(b_match.target_rel.ends_with("__data"));
        let cat_match = result.matched_files.iter().find(|m| m.is_catalog).unwrap();
        assert_eq!(cat_match.risk_level, "high");
    }

    #[test]
    fn rejects_zip_slip_traversal_and_forbidden_executables() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("game");
        fs::create_dir_all(&game_dir).unwrap();
        let game = fixture_game(&game_dir);

        let slip_zip = tmp.path().join("slip.zip");
        write_zip(&slip_zip, &[("../evil.bundle", b"evil")]);
        assert!(inspect_against_game(&game, &game.id, &game_dir, &slip_zip).is_err());

        let exe_zip = tmp.path().join("payload.zip");
        write_zip(&exe_zip, &[("helper.dll", b"mz")]);
        assert!(inspect_against_game(&game, &game.id, &game_dir, &exe_zip).is_err());
    }

    #[test]
    fn installs_respecting_catalog_toggle_and_restores_cleanly() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("game");
        fs::create_dir_all(&game_dir).unwrap();
        let game = fixture_game(&game_dir);

        let zip_path = tmp.path().join("魔审汉娜 替换 凛 原皮.zip");
        write_zip(
            &zip_path,
            &[
                (&format!("Mod/{TEST_HEX_A}.bundle"), b"mod-a-v1"),
                ("Mod/catalog.bundle", b"mod-catalog-v1"),
            ],
        );

        // Install excluding catalog.bundle
        let installed = install_dropped_from_path(&game, &game_dir, &zip_path, false, None, None).unwrap();
        assert_eq!(installed.installed_count, 1);
        assert_eq!(
            fs::read(game_dir.join(format!("AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64/{TEST_HEX_A}.bundle"))).unwrap(),
            b"mod-a-v1"
        );
        assert_eq!(
            fs::read(game_dir.join("AstralParty_CN_Data/StreamingAssets/aa/catalog.bundle")).unwrap(),
            b"orig-catalog"
        );

        // Duplicate install while active is rejected
        assert!(install_dropped_from_path(&game, &game_dir, &zip_path, false, None, None).is_err());

        // Conflicting second mod targeting same bundle is detected and blocked
        let conflict_zip = tmp.path().join("conflict.zip");
        write_zip(&conflict_zip, &[(&format!("{TEST_HEX_A}.bundle"), b"mod-a-v2")]);
        let (conflict_inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &conflict_zip).unwrap();
        assert!(!conflict_inspect.can_install);
        assert!(!conflict_inspect.conflicts.is_empty());
        assert!(install_dropped_from_path(&game, &game_dir, &conflict_zip, false, None, None).is_err());

        let service = InstallService::new(
            crate::storage::database::Database::in_memory().unwrap(),
            tmp.path().join("backups"),
        );
        let target = game_dir.join(format!("AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64/{TEST_HEX_A}.bundle"));
        {
            let _lock = operation_lock(&game_dir).unwrap();
            let disabled = toggle_dropped_in_locked_root(&game, &game_dir, &installed.mod_id, false, &service).unwrap();
            assert_eq!(disabled.phase, "disabled");
            assert_eq!(fs::read(&target).unwrap(), b"orig-streaming-a");
            fs::remove_file(&zip_path).unwrap();
            let enabled = toggle_dropped_in_locked_root(&game, &game_dir, &installed.mod_id, true, &service).unwrap();
            assert_eq!(enabled.phase, "installed");
            assert_eq!(fs::read(&target).unwrap(), b"mod-a-v1");
        }

        // Restore restores original bytes
        restore_dropped_by_id(&game, &game_dir, &installed.mod_id, None).unwrap();
        assert_eq!(
            fs::read(game_dir.join(format!("AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64/{TEST_HEX_A}.bundle"))).unwrap(),
            b"orig-streaming-a"
        );
    }

    #[test]
    fn inspects_and_installs_extracted_folder_and_blocks_running_game() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("game");
        fs::create_dir_all(&game_dir).unwrap();
        let mut game = fixture_game(&game_dir);

        let mod_folder = tmp.path().join("extracted-mod");
        fs::create_dir_all(mod_folder.join("游戏根目录")).unwrap();
        fs::write(mod_folder.join(format!("游戏根目录/{TEST_HEX_B}.bundle")), b"folder-mod-b").unwrap();

        let (inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &mod_folder).unwrap();
        assert_eq!(inspect.source_kind, "folder");
        assert_eq!(inspect.matched_files.len(), 1);
        assert!(inspect.can_install);

        // Running process blocks install
        game.executable_path = Some(std::env::current_exe().unwrap().display().to_string());
        assert!(install_dropped_from_path(&game, &game_dir, &mod_folder, false, None, None).is_err());

        // Restore valid exe and install
        game.executable_path = Some(game_dir.join("AstralParty_CN.exe").display().to_string());
        let res = install_dropped_from_path(&game, &game_dir, &mod_folder, false, None, None).unwrap();
        assert_eq!(
            fs::read(game_dir.join(format!("AstralParty_CN_Data/com.unity.addressables/AssetBundles/abc/{TEST_HEX_B}/__data"))).unwrap(),
            b"folder-mod-b"
        );
        restore_dropped_by_id(&game, &game_dir, &res.mod_id, None).unwrap();
        assert_eq!(
            fs::read(game_dir.join(format!("AstralParty_CN_Data/com.unity.addressables/AssetBundles/abc/{TEST_HEX_B}/__data"))).unwrap(),
            b"orig-addr-b"
        );
    }

    #[test]
    fn protects_xingshu_runtime_bundle_from_overwrite() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("game");
        fs::create_dir_all(&game_dir).unwrap();
        let game = fixture_game(&game_dir);

        let rt_id = runtime_bundle_id_for_platform("STEAM_CN").unwrap();
        let rt_dir = game_dir.join(format!("AstralParty_CN_Data/com.unity.addressables/AssetBundles/57a198703b66364d5420d39c0d251747/{rt_id}"));
        fs::create_dir_all(&rt_dir).unwrap();
        fs::write(rt_dir.join("__data"), b"xingshu-runtime").unwrap();

        let bad_zip = tmp.path().join("overwrite-rt.zip");
        write_zip(&bad_zip, &[(&format!("{rt_id}.bundle"), b"tampered")]);

        let (inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &bad_zip).unwrap();
        assert!(!inspect.can_install);
        assert!(!inspect.conflicts.is_empty());
        assert!(install_dropped_from_path(&game, &game_dir, &bad_zip, false, None, None).is_err());
    }

    #[test]
    fn inspects_standalone_windows64_addressables_and_gbk_zips() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("game");
        fs::create_dir_all(&game_dir).unwrap();
        let game = fixture_game(&game_dir);

        let zip_path = tmp.path().join("StandaloneWindows64.zip");
        {
            let f = fs::File::create(&zip_path).unwrap();
            let mut z = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default();
            z.add_directory("StandaloneWindows64/", opts).unwrap();
            z.start_file(format!("StandaloneWindows64/{TEST_HEX_A}.bundle"), opts).unwrap();
            z.write_all(b"mod-a").unwrap();
            z.start_file(format!("com.unity.addressables/AssetBundles/052b/{TEST_HEX_B}/__data"), opts).unwrap();
            z.write_all(b"mod-b").unwrap();
            z.finish().unwrap();
        }
        let (inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &zip_path).unwrap();
        assert!(inspect.compatible);
        assert!(inspect.can_install);
        assert_eq!(inspect.matched_files.len(), 2);

        // Zip with raw GBK bytes in readme filename (non-UTF-8) plus valid bundle
        let gbk_zip = tmp.path().join("gbk_named.zip");
        {
            use zip::write::SimpleFileOptions;
            let f = fs::File::create(&gbk_zip).unwrap();
            let mut z = zip::ZipWriter::new(f);
            let opts = SimpleFileOptions::default();
            z.start_file(format!("StandaloneWindows64/{TEST_HEX_A}.bundle"), opts).unwrap();
            z.write_all(b"gbk-mod-a").unwrap();
            // Simulate raw non-UTF-8 GBK bytes in entry name (e.g. 卡牌.txt -> 0xBF 0xA8 0xC5 0xC6 .txt)
            let raw_entry = unsafe {
                String::from_utf8_unchecked(vec![0xBF, 0xA8, b'/', b'r', b'e', b'a', b'd', b'm', b'e', b'.', b't', b'x', b't'])
            };
            let _ = z.start_file(&raw_entry, opts);
            let _ = z.write_all(b"notes");
            z.finish().unwrap();
        }
        let (gbk_inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &gbk_zip).unwrap();
        assert!(gbk_inspect.compatible);
        assert_eq!(gbk_inspect.matched_files.len(), 1);
    }

    #[test]
    fn inspects_installs_toggles_and_restores_modimg_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("game");
        fs::create_dir_all(&game_dir).unwrap();
        let game = fixture_game(&game_dir);

        let pe_zip = tmp.path().join("PE手机端(星枢).zip");
        write_zip(&pe_zip, &[
            ("PE手机端(星枢)/modimg/UT_HandCard_21022.png", b"png-mod-card"),
            ("PE手机端(星枢)/手机端安装说明.txt", b"readme"),
        ]);

        let (inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &pe_zip).unwrap();
        assert!(inspect.compatible);
        assert!(inspect.can_install);
        assert_eq!(inspect.matched_files.len(), 1);
        assert_eq!(inspect.matched_files[0].target_rel, "modimg/UT_HandCard_21022.png");
        assert_eq!(inspect.matched_files[0].target_kind, "modimg");

        let installed = install_dropped_from_path(&game, &game_dir, &pe_zip, false, None, None).unwrap();
        assert_eq!(installed.installed_count, 1);
        let modimg_target = game_dir.join("modimg/UT_HandCard_21022.png");
        assert_eq!(fs::read(&modimg_target).unwrap(), b"png-mod-card");

        let service = InstallService::new(
            crate::storage::database::Database::in_memory().unwrap(),
            tmp.path().join("backups"),
        );
        {
            let _lock = operation_lock(&game_dir).unwrap();
            let off = toggle_dropped_in_locked_root(&game, &game_dir, &installed.mod_id, false, &service).unwrap();
            assert_eq!(off.phase, "disabled");
            assert!(!modimg_target.exists());
            let on = toggle_dropped_in_locked_root(&game, &game_dir, &installed.mod_id, true, &service).unwrap();
            assert_eq!(on.phase, "installed");
            assert_eq!(fs::read(&modimg_target).unwrap(), b"png-mod-card");
        }

        restore_dropped_by_id(&game, &game_dir, &installed.mod_id, None).unwrap();
        assert!(!modimg_target.exists());
    }

    #[test]
    fn raises_drop_and_payload_safety_limits_to_one_gb() {
        assert_eq!(MAX_DROP_ARCHIVE_BYTES, 1024 * 1024 * 1024);
        assert_eq!(MAX_DROP_UNCOMPRESSED_BYTES, 2 * 1024 * 1024 * 1024);
        assert_eq!(MAX_DROP_PAYLOAD_BYTES, 512 * 1024 * 1024);
        assert_eq!(MAX_DROP_ENTRIES, 4000);
        let default_limits = ArchiveLimits::default();
        assert_eq!(default_limits.max_total_uncompressed_bytes, 2 * 1024 * 1024 * 1024);
        assert_eq!(default_limits.max_single_file_uncompressed_bytes, 512 * 1024 * 1024);
    }

    #[test]
    fn matches_addr_group_fallback_prefixed_hex_and_renamed_unityfs() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("game");
        fs::create_dir_all(&game_dir).unwrap();
        let game = fixture_game(&game_dir);

        // Add an Addressables group <group_hex>/<active_hash>/__data and a target StreamingAssets bundle TEST_HEX_C
        let group_hex = "22103a2740055e170c9a3ab8ab7726e0";
        let active_hash = "0cd1009cf6e68f76bcdd73c29baa9f8d";
        let stale_hash = "6a05659c8dc249397ef9ce7778695662";
        let addr_active = game_dir.join(format!("AstralParty_CN_Data/com.unity.addressables/AssetBundles/{group_hex}/{active_hash}/__data"));
        fs::create_dir_all(addr_active.parent().unwrap()).unwrap();
        fs::write(&addr_active, b"orig-bgm").unwrap();

        let hex_c = "ce45386e584499fd057d72a70920c2c5";
        let aa_c = game_dir.join(format!("AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64/{hex_c}.bundle"));
        fs::write(&aa_c, b"orig-walk").unwrap();

        let hex_d = "454ded72450418a1eb5f4ae2d5059aed";
        let aa_d = game_dir.join(format!("AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64/{hex_d}.bundle"));
        fs::write(&aa_d, b"orig-kv").unwrap();

        let mut renamed_unityfs = b"UnityFS\x00\x00\x00\x00\x07\x00\x00CAB-123\x00".to_vec();
        renamed_unityfs.extend_from_slice(format!("{hex_d}.bundle\x00").as_bytes());
        let old_id = "4a6b48e0b60886e0248edf829d1651aa";
        let mut stale_unityfs = b"UnityFS\x00\x00\x00\x00\x07\x00\x00CAB-999\x00".to_vec();
        stale_unityfs.extend_from_slice(format!("{old_id}.bundle\x00").as_bytes());

        let zip_path = tmp.path().join("smart_match.zip");
        write_zip(&zip_path, &[
            (&format!("缓存/{group_hex}/{stale_hash}/__data"), b"mod-bgm"),
            (&format!("Mod/WALK原皮{hex_c}.bundle"), b"mod-walk"),
            ("Mod/WALK原皮ce45386e584499fd057d72a70920c2c5.bundle.bak", b"bak-should-ignore"),
            ("__data_renamed.bundle", &renamed_unityfs),
            ("__data (2).bundle", &stale_unityfs),
        ]);

        let (inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &zip_path).unwrap();
        assert_eq!(inspect.matched_files.len(), 3, "matched: {:?}", inspect.matched_files);
        assert!(inspect.matched_files.iter().any(|m| m.target_rel.ends_with(&format!("{group_hex}/{active_hash}/__data"))));
        assert!(inspect.matched_files.iter().any(|m| m.target_rel.ends_with(&format!("{hex_c}.bundle"))));
        assert!(inspect.matched_files.iter().any(|m| m.target_rel.ends_with(&format!("{hex_d}.bundle"))));
        assert_eq!(inspect.unmatched_files.len(), 1);
        assert!(inspect.unmatched_files[0].reason.contains(old_id));
        // Prefix guard: a 64-hex string must NOT be sliced to trailing 32-hex
        assert_eq!(extract_trailing_hex32(&"a".repeat(64)), None);
        assert_eq!(extract_trailing_hex32(&format!("WALK原皮{hex_c}")), Some(hex_c.to_string()));
    }

    #[test]
    #[ignore = "requires local large archive via XINGSHU_TEST_LARGE_MOD"]
    fn inspects_real_large_archive_from_env() {
        let path = PathBuf::from(std::env::var_os("XINGSHU_TEST_LARGE_MOD").unwrap());
        let (kind, name, payloads, _, _) = read_source_entries(&path).unwrap();
        assert_eq!(kind, "community_zip");
        assert!(!name.is_empty());
        assert!(!payloads.is_empty());
        println!("VERIFIED LARGE ARCHIVE: kind={kind} name={name} payloads={}", payloads.len());
        if let Some(game_dir) = std::env::var_os("XINGSHU_TEST_GAME_ROOT").map(PathBuf::from) {
            let game = GameInstallation {
                id: "inst-real".into(),
                platform: "STEAM_CN".into(),
                platform_app_id: Some("2622000".into()),
                install_path: game_dir.display().to_string(),
                executable_path: Some(game_dir.join("AstralParty_CN.exe").display().to_string()),
                detected_build_id: None,
                detected_version: None,
                detection_method: "TEST".into(),
                is_valid: true,
                is_primary: true,
                last_verified_at: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            };
            let (inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &path).unwrap();
            println!(
                "REAL INSPECT: matched={} unmatched={} conflicts={}",
                inspect.matched_files.len(),
                inspect.unmatched_files.len(),
                inspect.conflicts.len()
            );
            assert!(inspect.unmatched_files.is_empty(), "unmatched: {:?}", inspect.unmatched_files);
            assert!(!inspect.matched_files.is_empty());
            if let Some(expected) = std::env::var_os("XINGSHU_TEST_EXPECT_MATCHED")
                .and_then(|s| s.to_string_lossy().parse::<usize>().ok())
            {
                assert_eq!(inspect.matched_files.len(), expected);
            }
        }
    }

    fn build_min_catalog_json(mappings: &[(&str, &str)]) -> Vec<u8> {
        use base64::{Engine, engine::general_purpose::STANDARD};
        let mut internal_ids = Vec::new();
        let mut key_bytes = Vec::new();
        let mut bucket_bytes = Vec::new();
        let mut entry_bytes = Vec::new();

        entry_bytes.extend_from_slice(&(mappings.len() as u32).to_le_bytes());
        bucket_bytes.extend_from_slice(&(mappings.len() as u32).to_le_bytes());
        for (idx, (asset, bundle_name)) in mappings.iter().enumerate() {
            internal_ids.push(format!("StandaloneWindows64/{bundle_name}"));
            let kpos = key_bytes.len() as u32;
            key_bytes.push(0u8);
            key_bytes.extend_from_slice(&(asset.len() as u32).to_le_bytes());
            key_bytes.extend_from_slice(asset.as_bytes());

            bucket_bytes.extend_from_slice(&kpos.to_le_bytes());
            bucket_bytes.extend_from_slice(&1u32.to_le_bytes());
            bucket_bytes.extend_from_slice(&(idx as u32).to_le_bytes());

            entry_bytes.extend_from_slice(&(idx as u32).to_le_bytes());
            entry_bytes.extend_from_slice(&0u32.to_le_bytes());
            entry_bytes.extend_from_slice(&(-1i32).to_le_bytes());
            entry_bytes.extend_from_slice(&[0u8; 16]);
        }

        serde_json::to_vec(&serde_json::json!({
            "m_InternalIds": internal_ids,
            "m_KeyDataString": STANDARD.encode(key_bytes),
            "m_BucketDataString": STANDARD.encode(bucket_bytes),
            "m_EntryDataString": STANDARD.encode(entry_bytes),
        }))
        .unwrap()
    }

    fn build_min_unityfs_bundle(cab_name: &str, types: Vec<i32>, objects: Vec<(i64, usize, Vec<u8>)>) -> Vec<u8> {
        let mut obj_data = Vec::new();
        let mut entries = Vec::with_capacity(objects.len());
        for (pid, tid, payload) in &objects {
            while obj_data.len() % 8 != 0 {
                obj_data.push(0);
            }
            let st = obj_data.len();
            obj_data.extend_from_slice(payload);
            entries.push((*pid, st as i64, payload.len() as u32, *tid as i32));
        }

        let mut meta = Vec::new();
        meta.extend_from_slice(b"2022.3.62f3\0");
        meta.extend_from_slice(&19i32.to_le_bytes());
        meta.push(0);
        meta.extend_from_slice(&(types.len() as i32).to_le_bytes());
        for cid in &types {
            meta.extend_from_slice(&cid.to_le_bytes());
            meta.push(0);
            meta.extend_from_slice(&(-1i16).to_le_bytes());
            if *cid == 114 || *cid < 0 {
                meta.extend_from_slice(&[0u8; 16]);
            }
            meta.extend_from_slice(&[0u8; 16]);
        }
        meta.extend_from_slice(&(entries.len() as i32).to_le_bytes());
        while meta.len() % 4 != 0 {
            meta.push(0);
        }
        for (pid, st, sz, tid) in entries {
            meta.extend_from_slice(&pid.to_le_bytes());
            meta.extend_from_slice(&st.to_le_bytes());
            meta.extend_from_slice(&sz.to_le_bytes());
            meta.extend_from_slice(&tid.to_le_bytes());
        }
        let data_offset = (48 + meta.len()).next_multiple_of(16);
        let mut cab = vec![0u8; data_offset + obj_data.len()];
        let total = cab.len() as i64;
        cab[0..4].copy_from_slice(&(meta.len() as u32).to_be_bytes());
        cab[8..12].copy_from_slice(&22u32.to_be_bytes());
        cab[20..24].copy_from_slice(&(meta.len() as u32).to_be_bytes());
        cab[24..32].copy_from_slice(&total.to_be_bytes());
        cab[32..40].copy_from_slice(&(data_offset as i64).to_be_bytes());
        cab[48..48 + meta.len()].copy_from_slice(&meta);
        cab[data_offset..].copy_from_slice(&obj_data);

        let mut blocks_info = Vec::new();
        blocks_info.extend_from_slice(&[0u8; 16]);
        blocks_info.extend_from_slice(&1i32.to_be_bytes());
        blocks_info.extend_from_slice(&(cab.len() as u32).to_be_bytes());
        blocks_info.extend_from_slice(&(cab.len() as u32).to_be_bytes());
        blocks_info.extend_from_slice(&0x0040u16.to_be_bytes());
        blocks_info.extend_from_slice(&1i32.to_be_bytes());
        blocks_info.extend_from_slice(&0i64.to_be_bytes());
        blocks_info.extend_from_slice(&(cab.len() as i64).to_be_bytes());
        blocks_info.extend_from_slice(&4u32.to_be_bytes());
        blocks_info.extend_from_slice(cab_name.as_bytes());
        blocks_info.push(0);

        let mut bundle = Vec::new();
        bundle.extend_from_slice(b"UnityFS\0");
        bundle.extend_from_slice(&8u32.to_be_bytes());
        bundle.extend_from_slice(b"5.x.x\02022.3.62f3\0");
        let sz_pos = bundle.len();
        bundle.extend_from_slice(&0i64.to_be_bytes());
        bundle.extend_from_slice(&(blocks_info.len() as u32).to_be_bytes());
        bundle.extend_from_slice(&(blocks_info.len() as u32).to_be_bytes());
        bundle.extend_from_slice(&0x0040u32.to_be_bytes());
        while bundle.len() % 16 != 0 {
            bundle.push(0);
        }
        bundle.extend_from_slice(&blocks_info);
        bundle.extend_from_slice(&cab);
        let blen = bundle.len() as i64;
        bundle[sz_pos..sz_pos + 8].copy_from_slice(&blen.to_be_bytes());
        bundle
    }

    fn make_texture2d_obj_rgba32(name: &str, w: i32, h: i32, rgba: &[u8]) -> Vec<u8> {
        let mut o = Vec::new();
        o.extend_from_slice(&(name.len() as u32).to_le_bytes());
        o.extend_from_slice(name.as_bytes());
        while o.len() % 4 != 0 {
            o.push(0);
        }
        o.extend_from_slice(&0i32.to_le_bytes()); // forcedFallbackFormat
        o.push(0); // downscaleFallback
        o.push(0); // isAlphaChannelOptional
        while o.len() % 4 != 0 {
            o.push(0);
        }
        o.extend_from_slice(&w.to_le_bytes());
        o.extend_from_slice(&h.to_le_bytes());
        o.extend_from_slice(&(rgba.len() as u32).to_le_bytes());
        o.extend_from_slice(&0i32.to_le_bytes()); // mips stripped
        o.extend_from_slice(&4i32.to_le_bytes()); // TextureFormat::RGBA32
        o.extend_from_slice(&1i32.to_le_bytes()); // mipCount
        o.extend_from_slice(&[0u8, 0, 0, 0]); // flags + align
        o.extend_from_slice(&0u32.to_le_bytes()); // mipmap group empty
        o.extend_from_slice(&[0u8; 4]); // streaming + align
        o.extend_from_slice(&0i32.to_le_bytes()); // streaming priority
        o.extend_from_slice(&1i32.to_le_bytes()); // image count
        o.extend_from_slice(&2i32.to_le_bytes()); // dimension
        o.extend_from_slice(&[0u8; 24]); // gl settings
        o.extend_from_slice(&0i32.to_le_bytes()); // lightmap
        o.extend_from_slice(&1i32.to_le_bytes()); // colorspace
        o.extend_from_slice(&0i32.to_le_bytes()); // platform blob len
        while o.len() % 4 != 0 {
            o.push(0);
        }
        o.extend_from_slice(&(rgba.len() as u32).to_le_bytes());
        o.extend_from_slice(rgba);
        while o.len() % 4 != 0 {
            o.push(0);
        }
        o
    }

    fn make_monobehaviour_obj(hdr28: [u8; 28], name: &str, body: &[u8]) -> Vec<u8> {
        let mut o = Vec::new();
        o.extend_from_slice(&hdr28);
        o.extend_from_slice(&(name.len() as u32).to_le_bytes());
        o.extend_from_slice(name.as_bytes());
        while o.len() % 4 != 0 {
            o.push(0);
        }
        o.extend_from_slice(body);
        o
    }

    #[test]
    fn adapts_old_texture_and_monobehaviour_bundles_via_catalog_and_exports_android_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("Game");
        let game = fixture_game(&game_dir);

        // Prepare vanilla 3.3.0 MonoBehaviour bundle & local catalog
        let van_mb_hdr = [0xCCu8; 28];
        let van_mb_bundle = build_min_unityfs_bundle(
            "CAB-van-skill",
            vec![114],
            vec![(1, 0, make_monobehaviour_obj(van_mb_hdr, "VSkill_Hero129", b"VANILLA_BYTES"))],
        );
        let aa_dir = game_dir.join("AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64");
        fs::write(aa_dir.join(format!("{TEST_HEX_A}.bundle")), &van_mb_bundle).unwrap();

        let tex_hex = "11111111222222223333333344444444";
        fs::write(aa_dir.join(format!("{tex_hex}.bundle")), b"orig-tex-placeholder").unwrap();

        let local_cat_dir = game_dir.join("AstralParty_CN_Data/com.unity.addressables");
        fs::create_dir_all(&local_cat_dir).unwrap();
        fs::write(
            local_cat_dir.join("catalog_3.3.0.json"),
            build_min_catalog_json(&[
                ("UT_Hero_Card_129", &format!("{tex_hex}.bundle")),
                ("VSkill_Hero129", &format!("{TEST_HEX_A}.bundle")),
            ]),
        )
        .unwrap();

        let old_tex_bundle = build_min_unityfs_bundle(
            "CAB-old-tex",
            vec![28],
            vec![(1, 0, make_texture2d_obj_rgba32("UT_Hero_Card_129", 2, 2, &[255u8; 16]))],
        );
        let old_mb_bundle = build_min_unityfs_bundle(
            "CAB-old-skill",
            vec![114],
            vec![(1, 0, make_monobehaviour_obj([0x12u8; 28], "VSkill_Hero129", b"CUSTOM_SKILL_NEW"))],
        );

        let mod_zip = tmp.path().join("legacy_skin.zip");
        write_zip(&mod_zip, &[
            ("MOD/__data (1057).bundle", &old_tex_bundle),
            ("MOD/原/__data (1057).bundle", b"backup-must-be-skipped"),
            ("MOD/技能.bundle", &old_mb_bundle),
            ("MOD/variant_dup/技能_variant.bundle", &old_mb_bundle),
        ]);

        let (inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &mod_zip).unwrap();
        assert!(inspect.compatible, "conflicts: {:?}", inspect.conflicts);
        assert_eq!(inspect.android_exportable_count, 1);
        assert_eq!(inspect.matched_files.len(), 2, "matched: {:?}", inspect.matched_files);
        assert!(inspect.matched_files.iter().any(|m| {
            m.target_kind == "modimg_adapted" && m.target_rel == "modimg/UT_Hero_Card_129.png"
        }));
        assert!(inspect.matched_files.iter().any(|m| {
            m.target_kind == "migrated_bundle"
                && m.target_rel.ends_with(&format!("{TEST_HEX_A}.bundle"))
        }));

        // Install, verify PNG + migrated MonoBehaviour, export Android ZIP, then restore cleanly
        let inst = install_dropped_from_path(&game, &game_dir, &mod_zip, false, None, None).unwrap();
        assert_eq!(inst.installed_count, 2);
        let installed_png = fs::read(game_dir.join("modimg/UT_Hero_Card_129.png")).unwrap();
        assert!(installed_png.starts_with(b"\x89PNG"));

        let android_zip = tmp.path().join("out_android_modimg.zip");
        let saved = export_android_pack_from_path(&game, &game_dir, &mod_zip, None, Some(&android_zip)).unwrap();
        assert_eq!(PathBuf::from(&saved), android_zip);
        let zf = zip::ZipArchive::new(fs::File::open(&android_zip).unwrap()).unwrap();
        assert_eq!(zf.len(), 1);

        restore_dropped_by_id(&game, &game_dir, &inst.mod_id, None).unwrap();
        assert!(!game_dir.join("modimg/UT_Hero_Card_129.png").exists());
        assert_eq!(fs::read(aa_dir.join(format!("{TEST_HEX_A}.bundle"))).unwrap(), van_mb_bundle);
    }

    #[test]
    fn blocks_astral_runtime_dll_skips_apenc_and_supports_drm_free_dynamic_cards() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("Game");
        let game = fixture_game(&game_dir);

        let mut rt_name = Vec::new();
        let n = b"AstralParty.Runtime.dll";
        rt_name.extend_from_slice(&(n.len() as u32).to_le_bytes());
        rt_name.extend_from_slice(n);
        let rt_bundle = build_min_unityfs_bundle("CAB-rt", vec![49], vec![(1, 0, rt_name)]);

        let apenc_bundle = build_min_unityfs_bundle(
            "CAB-drm",
            vec![114],
            vec![(1, 0, make_monobehaviour_obj([0u8; 28], "VUT_Hero_Card_114_01", b"\0APENC01_ENC"))],
        );

        let malicious_zip = tmp.path().join("skin_video_bad.zip");
        write_zip(&malicious_zip, &[
            ("123/data/VUT_Hero_Card_114_01", &apenc_bundle),
            ("CN_STEAM/game_assembly/69021db4cc5c5dddeac2e02519be31f7.bundle", &rt_bundle),
        ]);

        let (bad_inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &malicious_zip).unwrap();
        assert!(!bad_inspect.compatible);
        assert!(bad_inspect.conflicts.iter().any(|c| c.contains("AstralParty.Runtime.dll")));
        assert_eq!(bad_inspect.unmatched_files.len(), 1);
        assert!(bad_inspect.unmatched_files[0].reason.contains("APENC01"));
        assert!(install_dropped_from_path(&game, &game_dir, &malicious_zip, false, None, None).is_err());

        // DRM-free VUT_ video + modimg card installs, toggles, and restores cleanly
        let good_zip = tmp.path().join("drm_free_dynamic.zip");
        write_zip(&good_zip, &[
            ("xingshu_dynamic_cards/VUT_Hero_Card_306.mp4", b"ftypisom_fake_mp4"),
            ("modimg/UT_Hero_Card_306.png", b"\x89PNG\r\n\x1a\nfake"),
        ]);
        let (good_inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &good_zip).unwrap();
        assert!(good_inspect.compatible);
        assert_eq!(good_inspect.matched_files.len(), 2);
        assert_eq!(good_inspect.android_exportable_count, 1);

        let inst = install_dropped_from_path(&game, &game_dir, &good_zip, false, None, None).unwrap();
        assert!(game_dir.join("xingshu_dynamic_cards/VUT_Hero_Card_306.mp4").is_file());
        let install_svc = InstallService::new(
            crate::storage::database::Database::in_memory().unwrap(),
            tmp.path().join("backups"),
        );
        toggle_dropped_in_locked_root(&game, &game_dir, &inst.mod_id, false, &install_svc).unwrap();
        assert!(!game_dir.join("xingshu_dynamic_cards/VUT_Hero_Card_306.mp4").exists());
        toggle_dropped_in_locked_root(&game, &game_dir, &inst.mod_id, true, &install_svc).unwrap();
        assert!(game_dir.join("xingshu_dynamic_cards/VUT_Hero_Card_306.mp4").is_file());
        restore_dropped_by_id(&game, &game_dir, &inst.mod_id, None).unwrap();
        assert!(!game_dir.join("xingshu_dynamic_cards/VUT_Hero_Card_306.mp4").exists());
    }

    #[test]
    fn handles_encrypted_zip_and_rar_archives_with_7z_when_available() {
        let Some(seven_z) = find_7z_executable() else {
            return;
        };
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("Game");
        let game = fixture_game(&game_dir);

        let payload_src = tmp.path().join("payload_src");
        fs::create_dir_all(payload_src.join("modimg")).unwrap();
        fs::write(payload_src.join("modimg/UT_Test.png"), b"\x89PNG\r\n\x1a\ntest").unwrap();

        let enc_zip = tmp.path().join("encrypted.zip");
        let status = spawn_hidden_command(&seven_z)
            .args(["a", "-tzip", "-psecret123", "-y"])
            .arg(&enc_zip)
            .arg(payload_src.join("modimg"))
            .output()
            .unwrap();
        assert!(status.status.success());

        let err_missing = inspect_against_game_with_password(&game, &game.id, &game_dir, &enc_zip, None).unwrap_err();
        assert_eq!(err_missing.code, "ARCHIVE_PASSWORD_REQUIRED");

        let err_wrong = inspect_against_game_with_password(&game, &game.id, &game_dir, &enc_zip, Some("wrongpw")).unwrap_err();
        assert_eq!(err_wrong.code, "ARCHIVE_PASSWORD_INVALID");

        let (ok_inspect, _) = inspect_against_game_with_password(&game, &game.id, &game_dir, &enc_zip, Some("secret123")).unwrap();
        assert!(ok_inspect.compatible);
        assert_eq!(ok_inspect.matched_files.len(), 1);
        assert_eq!(ok_inspect.matched_files[0].target_rel, "modimg/UT_Test.png");
    }

    fn make_test_text_asset(name: &str, script: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&(name.len() as u32).to_le_bytes());
        out.extend_from_slice(name.as_bytes());
        while out.len() % 4 != 0 {
            out.push(0);
        }
        out.extend_from_slice(&(script.len() as u32).to_le_bytes());
        out.extend_from_slice(script);
        while out.len() % 4 != 0 {
            out.push(0);
        }
        out
    }

    #[test]
    fn supports_cab_matched_renamed_bundles_and_rml_mod_json_security_and_patching() {
        let tmp = tempfile::tempdir().unwrap();
        let game_dir = tmp.path().join("Game");
        let game = fixture_game(&game_dir);
        let aa_dir = game_dir.join("AstralParty_CN_Data/StreamingAssets/aa/StandaloneWindows64");
        let ab_ui_dir = game_dir.join(
            "AstralParty_CN_Data/com.unity.addressables/AssetBundles/be8a6f7fa87357b26096b5a0ada25e0b/20015cbffae16dbc93e8c960492cf4a6",
        );
        fs::create_dir_all(&ab_ui_dir).unwrap();

        // 1. Renamed multi-object bundle matched by CAB fingerprint
        let van_model = build_min_unityfs_bundle(
            "CAB-63e4dfc3bbacfa80283687580645fa43",
            vec![142, 213],
            vec![(1, 0, vec![0xAAu8; 16]), (2, 1, vec![0xBBu8; 20])],
        );
        fs::write(aa_dir.join(format!("{TEST_HEX_A}.bundle")), &van_model).unwrap();

        let renamed_zip = tmp.path().join("renamed_cab_mod.zip");
        let mod_model = build_min_unityfs_bundle(
            "CAB-63e4dfc3bbacfa80283687580645fa43",
            vec![142, 213],
            vec![(1, 0, vec![0xCCu8; 16]), (2, 1, vec![0xDDu8; 24])],
        );
        write_zip(&renamed_zip, &[("Mod/奔跑吧绝地潜兵.bundle", &mod_model)]);
        let (cab_res, _) = inspect_against_game(&game, &game.id, &game_dir, &renamed_zip).unwrap();
        assert!(cab_res.compatible, "conflicts={:?} unmatched={:?}", cab_res.conflicts, cab_res.unmatched_files);
        assert_eq!(cab_res.matched_files.len(), 1);
        assert_eq!(cab_res.matched_files[0].target_kind, "cab_matched_bundle");
        assert!(cab_res.matched_files[0].target_rel.ends_with(&format!("{TEST_HEX_A}.bundle")));

        // 2. RML mod.json security boundary: allows ResourceModLoader.exe skip, rejects unknown evil.exe
        let bad_rml_zip = tmp.path().join("bad_rml.zip");
        let rml_manifest = br#"{"BaseDir":"data","Patch":[],"Redirect":[{"Name":"Login_atlas0","File":"Login_atlas0.png","WrapType":"image"}]}"#;
        write_zip(&bad_rml_zip, &[
            ("mod.json", rml_manifest),
            ("ResourceModLoader.exe", b"MZ_RML"),
            ("evil.exe", b"MZ_EVIL"),
            ("data/Login_atlas0.png", b"\x89PNG\r\n\x1a\nimg"),
        ]);
        assert!(inspect_against_game(&game, &game.id, &game_dir, &bad_rml_zip).is_err());

        // 3. Valid RML mod.json with ResourceModLoader.exe + Redirect image + Redirect TextAsset + .patch.bnk + .patch.proto
        let cat_json_bytes = build_min_catalog_json(&[("Login_fui", &format!("{TEST_HEX_A}.bundle"))]);
        let local_cat_dir = game_dir.join("AstralParty_CN_Data/com.unity.addressables");
        fs::create_dir_all(&local_cat_dir).unwrap();
        fs::write(local_cat_dir.join("catalog_3.3.0.json"), &cat_json_bytes).unwrap();
        let cat_bundle = build_min_unityfs_bundle(
            "CAB-cat",
            vec![49],
            vec![(1, 0, make_test_text_asset("catalog", &cat_json_bytes))],
        );
        fs::write(aa_dir.parent().unwrap().join("catalog.bundle"), &cat_bundle).unwrap();

        let van_fui = build_min_unityfs_bundle(
            "CAB-fui",
            vec![49],
            vec![(1, 0, make_test_text_asset("Login_fui", b"OLD_FUI"))],
        );
        fs::write(aa_dir.join(format!("{TEST_HEX_A}.bundle")), &van_fui).unwrap();

        // Vanilla Wwise bank in TEST_HEX_B
        let wem_id: u32 = 970399165;
        let old_wem = b"RIFF_OLD";
        let mut bnk = Vec::new();
        bnk.extend_from_slice(b"BKHD");
        bnk.extend_from_slice(&4u32.to_le_bytes());
        bnk.extend_from_slice(&[1, 0, 0, 0]);
        bnk.extend_from_slice(b"DIDX");
        bnk.extend_from_slice(&12u32.to_le_bytes());
        bnk.extend_from_slice(&wem_id.to_le_bytes());
        bnk.extend_from_slice(&0u32.to_le_bytes());
        bnk.extend_from_slice(&(old_wem.len() as u32).to_le_bytes());
        bnk.extend_from_slice(b"DATA");
        bnk.extend_from_slice(&(old_wem.len() as u32).to_le_bytes());
        bnk.extend_from_slice(old_wem);
        let mut mb_body = Vec::new();
        mb_body.extend_from_slice(&(bnk.len() as u32).to_le_bytes());
        mb_body.extend_from_slice(&bnk);
        while mb_body.len() % 4 != 0 {
            mb_body.push(0);
        }
        mb_body.extend_from_slice(b"END");
        let van_bgm = build_min_unityfs_bundle(
            "CAB-bgm",
            vec![114],
            vec![(1, 0, make_monobehaviour_obj([0x44u8; 28], "BGM_Login", &mb_body))],
        );
        fs::write(aa_dir.join(format!("{TEST_HEX_B}.bundle")), &van_bgm).unwrap();

        // Minimal protobuf UI config in addressables __data: tag (1<<3)|2 = 0x0a, len=2, tag (10<<3)|0 = 0x50, val=2
        let ui_proto_orig = [0x0a, 0x02, 0x50, 0x02];
        let van_ui = build_min_unityfs_bundle(
            "CAB-ui",
            vec![49],
            vec![(1, 0, make_test_text_asset("UI", &ui_proto_orig))],
        );
        fs::write(ab_ui_dir.join("__data"), &van_ui).unwrap();

        let ok_rml_zip = tmp.path().join("qianxing_rml.zip");
        let rml_full = br#"{
            "BaseDir": "data",
            "Patch": ["LOGIN@463eb12cd6182d7fcf280af86f86675a.bundle@d@BGM_Login.patch.bnk", "UI@f1ba114203375614da2f270862b49985.bundle@43.patch.proto"],
            "Redirect": [
                {"Name": "Login_fui", "File": "Login_fui.bytes", "WrapType": "text"},
                {"Name": "Login_atlas0", "File": "Login_atlas0.png", "WrapType": "image"}
            ]
        }"#;
        write_zip(&ok_rml_zip, &[
            ("mod.json", rml_full),
            ("ResourceModLoader.exe", b"MZ_SAFE_SKIP"),
            ("data/Login_fui.bytes", b"FGUI_PATCHED"),
            ("data/Login_atlas0.png", b"\x89PNG\r\n\x1a\npatched"),
            ("data/LOGIN@463eb12cd6182d7fcf280af86f86675a.bundle@d@BGM_Login.patch.bnk", b"RIFF_NEW_WEM_999"),
            ("data/UI@f1ba114203375614da2f270862b49985.bundle@43.patch.proto", b"1[0].10=0x904e\n"),
        ]);

        let (rml_inspect, _) = inspect_against_game(&game, &game.id, &game_dir, &ok_rml_zip).unwrap();
        assert!(rml_inspect.compatible, "conflicts={:?} unmatched={:?}", rml_inspect.conflicts, rml_inspect.unmatched_files);
        assert_eq!(rml_inspect.matched_files.len(), 4, "matched={:?} unmatched={:?} warnings={:?}", rml_inspect.matched_files, rml_inspect.unmatched_files, rml_inspect.warnings);
        assert_eq!(rml_inspect.android_exportable_count, 1);

        let inst = install_dropped_from_path(&game, &game_dir, &ok_rml_zip, false, None, None).unwrap();
        assert_eq!(
            crate::mod_inspector::extract_text_asset(
                &fs::read(aa_dir.join(format!("{TEST_HEX_A}.bundle"))).unwrap(),
                "Login_fui",
            )
            .unwrap(),
            b"FGUI_PATCHED"
        );
        let ui_after = crate::mod_inspector::extract_text_asset(
            &fs::read(ab_ui_dir.join("__data")).unwrap(),
            "UI",
        )
        .unwrap();
        assert_ne!(ui_after, ui_proto_orig);
        assert!(ui_after.ends_with(&[0x50, 0xce, 0xa0, 0x02])); // 0x904e varint!
        assert!(game_dir.join("modimg/Login_atlas0.png").is_file());

        restore_dropped_by_id(&game, &game_dir, &inst.mod_id, None).unwrap();
        assert_eq!(
            fs::read(ab_ui_dir.join("__data")).unwrap(),
            van_ui
        );
    }

    #[test]
    #[ignore = "requires local real archives and Steam 8vJXn6CN read-only verification"]
    fn inspects_real_mod_packs_read_only_against_330() {
        let game_dir = PathBuf::from(r"E:\Steam\steamapps\common\Astral Party\8vJXn6CN");
        let game = GameInstallation {
            id: "inst-real-330".into(),
            platform: "STEAM_CN".into(),
            platform_app_id: Some("2622000".into()),
            install_path: game_dir.display().to_string(),
            executable_path: Some(game_dir.join("AstralParty_CN.exe").display().to_string()),
            detected_build_id: None,
            detected_version: None,
            detection_method: "TEST".into(),
            is_valid: true,
            is_primary: true,
            last_verified_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let mod_root = PathBuf::from(r"E:\工作流\星引擎插件\星引擎MOD包制作\星引擎mod");
        let out_pc_root = PathBuf::from(r"E:\工作流\星引擎插件\星引擎MOD包制作\星引擎mod_3.3.0适配版\PC_3.3.0");

        let p1 = mod_root.join("透明睡衣赛克斯（静态）.zip");
        let (r1, _) = inspect_against_game(&game, &game.id, &game_dir, &p1).unwrap();
        assert!(r1.compatible, "r1 conflicts: {:?} unmatched: {:?}", r1.conflicts, r1.unmatched_files);
        assert_eq!(r1.matched_files.len(), 7, "透明睡衣赛克斯 should match 7/7: {:?}", r1.matched_files);
        assert_eq!(r1.android_exportable_count, 6);

        let p2 = mod_root.join("卖春哈基米（网球装皮肤）.zip");
        let (r2, _) = inspect_against_game(&game, &game.id, &game_dir, &p2).unwrap();
        assert!(r2.compatible, "r2 conflicts: {:?} unmatched: {:?}", r2.conflicts, r2.unmatched_files);
        assert_eq!(r2.matched_files.len(), 8, "卖春哈基米 should match 8/8: {:?}", r2.matched_files);
        assert_eq!(r2.android_exportable_count, 7);

        let p3 = mod_root.join("僵尸海晴动态立绘.zip");
        let (r3, _) = inspect_against_game(&game, &game.id, &game_dir, &p3).unwrap();
        assert!(!r3.compatible);
        assert!(r3.conflicts.iter().any(|c| c.contains("AstralParty.Runtime.dll")));
        assert!(r3.unmatched_files.iter().any(|u| u.reason.contains("APENC01")));

        // Raw Helldivers zip: all 12 assets matched (9 adapted modimg + 1 video + 2 CAB-matched models)
        let p4 = mod_root.join("绝地潜兵 替换 摩西原皮.zip");
        let (r4, _) = inspect_against_game(&game, &game.id, &game_dir, &p4).unwrap();
        assert!(r4.compatible, "r4 conflicts={:?} unmatched={:?}", r4.conflicts, r4.unmatched_files);
        assert_eq!(r4.matched_files.len(), 12, "raw Helldivers should match 12/12: {:?}", r4.matched_files);

        // Raw Qianxing Login RML zip: safely skips ResourceModLoader.exe & matches 5/5 RML targets (Login_fui, Login_atlas0, both BGM_Login banks, UI proto)
        let p5 = mod_root.join("千星万趴（登录页替换）.zip");
        let (r5, _) = inspect_against_game(&game, &game.id, &game_dir, &p5).unwrap();
        assert!(r5.compatible, "r5 conflicts={:?} unmatched={:?}", r5.conflicts, r5.unmatched_files);
        assert_eq!(r5.matched_files.len(), 5, "raw Qianxing RML should match 5/5: {:?}", r5.matched_files);

        // Converted 3.3.0 native PC ZIPs: 12/12 & 5/5 cleanly matched
        let c1 = out_pc_root.join("绝地潜兵_替换_摩西原皮_3.3.0.zip");
        let (rc1, _) = inspect_against_game(&game, &game.id, &game_dir, &c1).unwrap();
        assert!(rc1.compatible && rc1.matched_files.len() == 12);

        let c2 = out_pc_root.join("千星万趴_登录页替换_3.3.0.zip");
        let (rc2, _) = inspect_against_game(&game, &game.id, &game_dir, &c2).unwrap();
        assert!(rc2.compatible && rc2.matched_files.len() == 5);
    }
}
