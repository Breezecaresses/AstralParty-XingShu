//! Desktop launcher operations over explicitly registered game installations.
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use crate::{domain::{error::{HubError, HubResult}, installation::GameInstallation},
    extension_center::{self, ExtensionCenter}, install::gates::ProcessGate,
    security::hash::compute_file_sha256, xing_shu::bridge::server::BridgeServer};

const COMPONENT_RELEASE: &[u8] = include_bytes!("launcher_component_release.json");
const COMPONENT_INSTALLER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/XingShuComponentInstaller.exe"));
const CORE_MANIFEST_PATH: &str = "/xingshu-hub/assets/launcher-runtime/core-manifest.json";
const CORE_MANIFEST_MAX_BYTES: usize = 2 * 1024 * 1024;
const CORE_MANIFEST_TTL: Duration = Duration::from_secs(60);
const CORE_MANIFEST_OFFLINE_BACKOFF: Duration = Duration::from_secs(15);
const MAX_CORE_PAYLOAD_BYTES: u64 = 64 * 1024 * 1024;
static INSTALLATION_CHANGE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CORE_MANIFEST_CACHE: OnceLock<Mutex<Option<(Instant, Duration, CoreManifestBundle)>>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherDiskState {
    state: &'static str,
    version: Option<String>,
    available_version: Option<String>,
    game_version: Option<String>,
    resource_version: Option<String>,
    installer_available: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Release {
    runtime_version: String,
    platforms: Vec<ReleasePlatform>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ReleasePlatform {
    id: String,
    game_version: Option<String>,
    resource_version: Option<String>,
    bundle_relative_path: String,
    payload: String,
    payload_sha256: String,
    #[serde(default)]
    vanilla_sha256: Option<String>,
    game_assembly_sha256: String,
    accepted_hashes: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInspectItem {
    plugin_name: String,
    category: String,
    relative_path: String,
    sha256: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInspectReport {
    ok: bool,
    platform: String,
    platform_label: String,
    game_root: String,
    target_sha256: String,
    target_state: String,
    has_conflicts: bool,
    target_is_conflict: bool,
    plugin_names: Vec<String>,
    items: Vec<ConflictInspectItem>,
    has_backup: bool,
    backup_is_vanilla: bool,
    summary: String,
    conflict_prompt: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnownRuntime {
    platform: String,
    version: String,
    sha256: String,
    bundle_relative_path: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreManifestWire {
    format_version: u32,
    runtime_version: String,
    path_prefix: String,
    payload_sizes: HashMap<String, u64>,
    release: serde_json::Value,
    #[serde(default)]
    inventory: Vec<KnownRuntime>,
}

#[derive(Clone)]
struct CoreManifestBundle {
    release: Release,
    release_raw_json: Vec<u8>,
    release_sha256: String,
    path_prefix: String,
    payload_sizes: HashMap<String, u64>,
    inventory: Vec<KnownRuntime>,
    source: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Media {
    path_prefix: String,
    payload_sizes: HashMap<String, u64>,
}

fn error(code: &str, message: impl Into<String>) -> HubError {
    HubError::new(code, message, "LAUNCHER").with_recoverable(true)
}

fn core_manifest_cache() -> &'static Mutex<Option<(Instant, Duration, CoreManifestBundle)>> {
    CORE_MANIFEST_CACHE.get_or_init(|| Mutex::new(None))
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_32_hex(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn validate_bundle_relative_path(platform_id: &str, rel: &str) -> HubResult<()> {
    let expected_data_dir = match platform_id {
        "STEAM_CN" => "AstralParty_CN_Data/",
        "TAPTAP" | "BILIBILI" | "WEGAME" => "吉星派对_Data/",
        _ => return Err(error("PACKAGE_INVALID", "核心组件清单包含未授权的渠道。")),
    };
    let norm = rel.replace('\\', "/");
    if norm.starts_with('/')
        || norm.contains(':')
        || norm.split('/').any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(error("PACKAGE_INVALID", "核心组件目标路径包含非法字符或越权片段。"));
    }
    let after_aa = norm
        .strip_prefix(expected_data_dir)
        .and_then(|rest| rest.strip_prefix("com.unity.addressables/AssetBundles/"))
        .ok_or_else(|| error("PACKAGE_INVALID", "核心组件目标路径不在 Addressables 资源目录内。"))?;
    let mut parts = after_aa.split('/');
    let group = parts.next().unwrap_or("");
    let bundle = parts.next().unwrap_or("");
    let leaf = parts.next().unwrap_or("");
    if !is_32_hex(group) || !is_32_hex(bundle) || leaf != "__data" || parts.next().is_some() {
        return Err(error("PACKAGE_INVALID", "核心组件目标资产路径格式无效。"));
    }
    Ok(())
}

fn validate_platform_entry(platform: &ReleasePlatform, size: u64) -> HubResult<()> {
    if !matches!(platform.id.as_str(), "STEAM_CN" | "TAPTAP" | "BILIBILI" | "WEGAME") {
        return Err(error("PACKAGE_INVALID", "核心组件清单包含未识别渠道。"));
    }
    let expected_payload = format!("Runtime/{}/__data", platform.id);
    if platform.payload != expected_payload {
        return Err(error("PACKAGE_INVALID", "核心组件载荷相对路径无效。"));
    }
    validate_bundle_relative_path(&platform.id, &platform.bundle_relative_path)?;
    if !is_sha256_hex(&platform.payload_sha256) || !is_sha256_hex(&platform.game_assembly_sha256) {
        return Err(error("PACKAGE_INVALID", "核心组件清单缺少有效 SHA-256。"));
    }
    if let Some(vanilla) = &platform.vanilla_sha256 {
        if !is_sha256_hex(vanilla) {
            return Err(error("PACKAGE_INVALID", "核心组件原版哈希格式无效。"));
        }
    }
    if platform.accepted_hashes.is_empty() || !platform.accepted_hashes.iter().all(|h| is_sha256_hex(h)) {
        return Err(error("PACKAGE_INVALID", "核心组件兼容哈希表无效。"));
    }
    if !(1..=MAX_CORE_PAYLOAD_BYTES).contains(&size) {
        return Err(error("PACKAGE_INVALID", "核心组件下载体积超出安全范围。"));
    }
    Ok(())
}

fn parse_and_validate_core_manifest(raw: &[u8], source: &'static str) -> HubResult<CoreManifestBundle> {
    let mut wire: CoreManifestWire = serde_json::from_slice(raw)
        .map_err(|_| error("PACKAGE_INVALID", "核心组件远端清单 JSON 无法识别。"))?;
    if wire.format_version != 1 {
        return Err(error("PACKAGE_INVALID", "核心组件清单版本不受支持。"));
    }
    let rt_ver = wire.runtime_version.trim();
    if rt_ver.is_empty()
        || rt_ver.len() > 64
        || !rt_ver.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
    {
        return Err(error("PACKAGE_INVALID", "核心组件版本号格式无效。"));
    }
    let path_prefix = wire.path_prefix.trim_end_matches('/').to_string();
    if !path_prefix.starts_with("/xingshu-hub/assets/launcher-runtime/")
        || path_prefix.contains("..")
        || path_prefix.contains("//")
        || !path_prefix.bytes().all(|b| b.is_ascii_alphanumeric() || b"/._-".contains(&b))
    {
        return Err(error("PACKAGE_INVALID", "核心组件下载前缀不在允许路径中。"));
    }
    let release: Release = serde_json::from_value(wire.release.clone())
        .map_err(|_| error("PACKAGE_INVALID", "核心组件发布清单字段缺失。"))?;
    if release.runtime_version != rt_ver {
        return Err(error("PACKAGE_INVALID", "核心组件清单版本号前后不一致。"));
    }
    if release.platforms.is_empty() || release.platforms.len() > 4 {
        return Err(error("PACKAGE_INVALID", "核心组件清单渠道数量异常。"));
    }
    let mut seen = HashSet::new();
    for platform in &release.platforms {
        if !seen.insert(platform.id.clone()) {
            return Err(error("PACKAGE_INVALID", "核心组件清单包含重复渠道。"));
        }
        let size = wire.payload_sizes.get(&platform.id).copied().unwrap_or(0);
        validate_platform_entry(platform, size)?;
    }
    for entry in &wire.inventory {
        if !is_sha256_hex(&entry.sha256)
            || !matches!(entry.platform.as_str(), "STEAM_CN" | "TAPTAP" | "BILIBILI" | "WEGAME")
        {
            return Err(error("PACKAGE_INVALID", "核心组件历史版本索引包含无效条目。"));
        }
        validate_bundle_relative_path(&entry.platform, &entry.bundle_relative_path)?;
    }
    let release_raw_json = serde_json::to_vec(&wire.release)
        .map_err(|e| error("PACKAGE_INVALID", e.to_string()))?;
    let release_sha256 = crate::security::hash::compute_sha256_bytes(&release_raw_json);
    wire.path_prefix = path_prefix.clone();
    Ok(CoreManifestBundle {
        release,
        release_raw_json,
        release_sha256,
        path_prefix,
        payload_sizes: wire.payload_sizes,
        inventory: wire.inventory,
        source,
    })
}

fn embedded_core_manifest() -> HubResult<CoreManifestBundle> {
    let release_val: serde_json::Value = serde_json::from_slice(COMPONENT_RELEASE)
        .map_err(|_| error("PACKAGE_INVALID", "内置组件清单无法识别。"))?;
    let runtime_version = release_val
        .get("RuntimeVersion")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let media: Media = serde_json::from_str(include_str!("launcher_media.json"))
        .map_err(|_| error("PACKAGE_INVALID", "内置组件下载清单无法识别。"))?;
    let inventory: Vec<KnownRuntime> = serde_json::from_str(include_str!("runtime_inventory.generated.json"))
        .map_err(|_| error("PACKAGE_INVALID", "内置历史版本索引无法识别。"))?;
    let raw = serde_json::to_vec(&serde_json::json!({
        "formatVersion": 1,
        "runtimeVersion": runtime_version,
        "pathPrefix": media.path_prefix,
        "payloadSizes": media.payload_sizes,
        "release": release_val,
        "inventory": inventory,
    }))
    .map_err(|e| error("PACKAGE_INVALID", e.to_string()))?;
    parse_and_validate_core_manifest(&raw, "embedded")
}

fn core_manifest_cache_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("XingShu-Hub").join("core-manifest-cache.json"))
}

fn read_disk_cached_core_manifest() -> Option<CoreManifestBundle> {
    let path = core_manifest_cache_path()?;
    let bytes = std::fs::read(&path).ok()?;
    parse_and_validate_core_manifest(&bytes, "disk_cache").ok()
}

fn write_disk_cached_core_manifest(raw: &[u8]) {
    let Some(path) = core_manifest_cache_path() else { return };
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_ok() {
        if let Ok(mut tmp) = tempfile::NamedTempFile::new_in(parent) {
            use std::io::Write;
            if tmp.write_all(raw).and_then(|_| tmp.as_file().sync_all()).is_ok() {
                let _ = tmp.persist(&path);
            }
        }
    }
}

fn cached_or_embedded_core_manifest() -> HubResult<CoreManifestBundle> {
    {
        let guard = core_manifest_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some((_, _, bundle)) = guard.as_ref() {
            return Ok(bundle.clone());
        }
    }
    if let Some(disk_bundle) = read_disk_cached_core_manifest() {
        return Ok(disk_bundle);
    }
    embedded_core_manifest()
}

async fn resolve_core_manifest(force_refresh: bool) -> HubResult<CoreManifestBundle> {
    if !force_refresh {
        let guard = core_manifest_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some((fetched_at, ttl, bundle)) = guard.as_ref() {
            if fetched_at.elapsed() < *ttl {
                return Ok(bundle.clone());
            }
        }
    }

    let fetched = async {
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .read_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| error("NETWORK", "无法初始化核心清单网络请求。"))?;
        let raw = crate::remote_content::read(&client, CORE_MANIFEST_PATH, CORE_MANIFEST_MAX_BYTES).await?;
        let bundle = parse_and_validate_core_manifest(&raw, "remote")?;
        write_disk_cached_core_manifest(&raw);
        Ok::<CoreManifestBundle, HubError>(bundle)
    }
    .await;

    match fetched {
        Ok(bundle) => {
            let mut guard = core_manifest_cache()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *guard = Some((Instant::now(), CORE_MANIFEST_TTL, bundle.clone()));
            Ok(bundle)
        }
        Err(_) => {
            let fallback = cached_or_embedded_core_manifest()?;
            let mut guard = core_manifest_cache()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *guard = Some((Instant::now(), CORE_MANIFEST_OFFLINE_BACKOFF, fallback.clone()));
            Ok(fallback)
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComponentInstallProgress {
    channel: String,
    stage: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    percent: u8,
    detail: String,
}

fn emit_component_progress(
    app: &tauri::AppHandle,
    channel: &str,
    stage: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
    percent: u8,
    detail: impl Into<String>,
) {
    let _ = app.emit(
        "xingshu:component-install-progress",
        ComponentInstallProgress {
            channel: channel.to_string(),
            stage: stage.to_string(),
            downloaded_bytes,
            total_bytes,
            percent,
            detail: detail.into(),
        },
    );
}

#[allow(dead_code)]
async fn stage_component(bundle: &CoreManifestBundle, channel: &str) -> HubResult<tempfile::TempDir> {
    stage_component_with_progress(bundle, channel, |_, _| {}).await
}

async fn stage_component_with_progress<F>(
    bundle: &CoreManifestBundle,
    channel: &str,
    on_progress: F,
) -> HubResult<tempfile::TempDir>
where
    F: FnMut(u64, u64),
{
    let platform = bundle.release.platforms.iter().find(|p| p.id == channel)
        .ok_or_else(|| error("PLATFORM_UNSUPPORTED", "该渠道暂无启动组件。"))?;
    let size = bundle.payload_sizes.get(channel).copied()
        .ok_or_else(|| error("PACKAGE_INVALID", "组件下载清单缺少所选渠道。"))?;
    let client = crate::remote_content::client()?;
    let payload_url = format!("{}/{}", bundle.path_prefix, platform.payload);
    let payload = crate::remote_content::verified_with_progress(
        &client, &payload_url, &platform.payload_sha256, size, MAX_CORE_PAYLOAD_BYTES as usize, on_progress,
    ).await?;
    let stage = tempfile::Builder::new().prefix("xingshu-component-").tempdir()
        .map_err(|e| error("INSTALL_FAILED", e.to_string()))?;
    let target = stage.path().join(&platform.payload);
    let release_bytes = &bundle.release_raw_json;
    let write_files = || -> std::io::Result<()> {
        std::fs::create_dir_all(target.parent().expect("component directory"))?;
        std::fs::write(target, payload)?;
        std::fs::write(stage.path().join("星枢安装助手.exe"), COMPONENT_INSTALLER)?;
        std::fs::write(stage.path().join("release.json"), release_bytes)
    };
    write_files().map_err(|e| error("INSTALL_FAILED", e.to_string()))?;
    Ok(stage)
}

fn stage_helper_only(bundle: &CoreManifestBundle) -> HubResult<tempfile::TempDir> {
    let stage = tempfile::Builder::new().prefix("xingshu-helper-").tempdir()
        .map_err(|e| error("RESTORE_FAILED", e.to_string()))?;
    let write_files = || -> std::io::Result<()> {
        std::fs::write(stage.path().join("星枢安装助手.exe"), COMPONENT_INSTALLER)?;
        std::fs::write(stage.path().join("release.json"), &bundle.release_raw_json)
    };
    write_files().map_err(|e| error("RESTORE_FAILED", e.to_string()))?;
    Ok(stage)
}

fn canonical_game(game: &GameInstallation) -> HubResult<(PathBuf, PathBuf)> {
    let root = extension_center::game_root(game)?;
    let executable = dunce::canonicalize(game.executable_path.as_deref().unwrap_or_default())
        .map_err(|_| error("GAME_MISSING", "游戏程序已移动，请重新选择目录。"))?;
    let root = dunce::canonicalize(root).map_err(|_| error("GAME_MISSING", "游戏目录已移动。"))?;
    if executable.parent() != Some(root.as_path()) {
        return Err(error("GAME_PATH", "游戏程序与所选目录不一致。"));
    }
    Ok((root, executable))
}

fn component_fingerprint(
    platform: &ReleasePlatform,
    latest: &str,
    inventory: &[KnownRuntime],
    hash: &str,
) -> (&'static str, Option<String>) {
    if hash.eq_ignore_ascii_case(&platform.payload_sha256) {
        return ("installed", Some(latest.to_owned()));
    }
    if !platform.accepted_hashes.iter().any(|known| known.eq_ignore_ascii_case(hash)) {
        return ("incompatible", None);
    }
    let vanilla = platform
        .vanilla_sha256
        .as_deref()
        .or_else(|| platform.accepted_hashes.first().map(|s| s.as_str()));
    if vanilla.is_some_and(|v| hash.eq_ignore_ascii_case(v)) {
        return ("installable", None);
    }
    let prior = inventory.iter().find(|entry| {
        entry.platform == platform.id
            && entry.bundle_relative_path == platform.bundle_relative_path
            && entry.sha256.eq_ignore_ascii_case(hash)
    });
    match prior {
        Some(entry) => ("updateAvailable", Some(entry.version.clone())),
        None => ("updateAvailable", Some("旧版星枢".to_owned())),
    }
}

fn can_install_component(status: &LauncherDiskState) -> bool {
    matches!(status.state, "installable" | "updateAvailable")
}

fn disk_state(game: &GameInstallation, bundle: &CoreManifestBundle) -> HubResult<LauncherDiskState> {
    let (root, _) = canonical_game(game)?;
    let mut state = LauncherDiskState { state: "packageMissing", version: None, available_version: None,
        game_version: None, resource_version: None, installer_available: false };
    {
        let release = &bundle.release;
        let Some(platform) = release.platforms.iter().find(|p| p.id == game.platform) else {
            state.state = "unsupported";
            return Ok(state);
        };
        let assembly = compute_file_sha256(root.join("GameAssembly.dll"))?;
        if !assembly.eq_ignore_ascii_case(&platform.game_assembly_sha256) {
            state.state = "incompatible";
            return Ok(state);
        }
        state.installer_available = true;
        state.game_version = platform.game_version.clone();
        state.available_version = Some(release.runtime_version.clone());
        let target = root.join(&platform.bundle_relative_path);
        if !target.is_file() {
            state.state = "resourceMissing";
            return Ok(state);
        }
        let actual = compute_file_sha256(target)?;
        (state.state, state.version) =
            component_fingerprint(platform, &release.runtime_version, &bundle.inventory, &actual);
        if state.state != "incompatible" {
            state.resource_version = platform.resource_version.clone();
        }
    }
    Ok(state)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSession {
    running: bool,
    runtime_version: Option<String>,
    player_id: Option<String>,
}

#[tauri::command]
pub async fn launcher_check(
    installation_id: String,
    force_refresh: Option<bool>,
    center: State<'_, ExtensionCenter>,
) -> HubResult<LauncherDiskState> {
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let bundle = resolve_core_manifest(force_refresh.unwrap_or(false)).await?;
    tauri::async_runtime::spawn_blocking(move || disk_state(&game, &bundle)).await
        .map_err(|_| error("CHECK_FAILED", "游戏组件检查未完成。"))?
}

#[tauri::command]
pub async fn launcher_session(installation_id: String, center: State<'_, ExtensionCenter>, bridge: State<'_, Arc<BridgeServer>>) -> HubResult<LauncherSession> {
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let (_, executable) = canonical_game(&game)?;
    let sessions = bridge.get_runtime_sessions();
    tauri::async_runtime::spawn_blocking(move || {
        use sysinfo::{ProcessRefreshKind, RefreshKind, System, UpdateKind};
        let system = System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing().with_exe(UpdateKind::Always)));
        let pids: Vec<_> = system.processes().iter().filter_map(|(pid, process)| {
            let path = process.exe().and_then(|p| dunce::canonicalize(p).ok())?;
            same_executable(&path, &executable).then_some(pid.as_u32())
        }).collect();
        let connected = sessions.iter().find(|s| s.platform_id == game.platform && s.connection_state == "CONNECTED"
            && pids.contains(&s.pid) && dunce::canonicalize(&s.executable_path).is_ok_and(|p| same_executable(&p, &executable)));
        LauncherSession { running: !pids.is_empty(), runtime_version: connected.map(|s| s.runtime_version.clone()).filter(|v| !v.is_empty()),
            player_id: connected.and_then(|s| s.live_player_id).map(|id| id.to_string()) }
    }).await.map_err(|_| error("CHECK_FAILED", "读取游戏进程失败。"))
}

fn same_executable(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().replace('\\', "/").eq_ignore_ascii_case(&b.to_string_lossy().replace('\\', "/"))
}

async fn install_core_component_for_game(
    game: &GameInstallation,
    app: &tauri::AppHandle,
    replace_conflicts: bool,
) -> HubResult<LauncherDiskState> {
    let bundle = resolve_core_manifest(true).await?;
    let probe = game.clone();
    let bundle_probe = bundle.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        let (_, exe) = canonical_game(&probe)?;
        let status = disk_state(&probe, &bundle_probe)?;
        if can_install_component(&status) || (replace_conflicts && status.state == "incompatible") {
            ProcessGate::check_target(&exe)?;
        }
        Ok::<_, HubError>(status)
    }).await.map_err(|_| error("INSTALL_FAILED", "组件检查未完成。"))??;
    if status.state == "installed" && !replace_conflicts { return Ok(status); }
    if !can_install_component(&status) && !(replace_conflicts && status.state == "incompatible") {
        return Err(error("INCOMPATIBLE", "所选渠道的版本需要检查。"));
    }
    let channel = game.platform.clone();
    emit_component_progress(app, &channel, "downloading", 0, 0, 5, "正在下载星枢官方插件 Mod…");
    let stage = match stage_component_with_progress(&bundle, &channel, |dl, total| {
        let pct = crate::workshop::scaled_download_percent(dl, total);
        emit_component_progress(app, &channel, "downloading", dl, total, pct, "正在下载并校验官方插件 Mod…");
    }).await {
        Ok(s) => s,
        Err(err) => {
            emit_component_progress(app, &channel, "error", 0, 0, 0, err.message.clone());
            return Err(err);
        }
    };
    emit_component_progress(app, &channel, "installing", 1, 1, 94, "正在备份原版文件并安装官方插件 Mod…");
    let game_owned = game.clone();
    let bundle_install = bundle.clone();
    let res = tauri::async_runtime::spawn_blocking(move || install_component(&game_owned, stage.path(), &bundle_install, replace_conflicts)).await
        .map_err(|_| error("INSTALL_FAILED", "组件安装未完成。"))?;
    match &res {
        Ok(_) => emit_component_progress(app, &channel, "done", 1, 1, 100, "星枢官方插件 Mod 安装完成"),
        Err(err) => emit_component_progress(app, &channel, "error", 0, 0, 0, err.message.clone()),
    }
    res
}

#[tauri::command]
pub async fn launcher_install(
    installation_id: String,
    replace_conflicts: Option<bool>,
    center: State<'_, ExtensionCenter>,
    app: tauri::AppHandle,
) -> HubResult<LauncherDiskState> {
    let _guard = INSTALLATION_CHANGE.lock().await;
    let game = extension_center::get_game(&center.db, &installation_id)?;
    install_core_component_for_game(&game, &app, replace_conflicts.unwrap_or(false)).await
}

fn install_component(game: &GameInstallation, stage: &Path, bundle: &CoreManifestBundle, replace_conflicts: bool) -> HubResult<LauncherDiskState> {
    let (root, executable) = canonical_game(game)?;
    let status = disk_state(game, bundle)?;
    if status.state == "installed" && !replace_conflicts { return Ok(status); }
    if !can_install_component(&status) && !(replace_conflicts && status.state == "incompatible") {
        return Err(error("INCOMPATIBLE", "所选渠道的版本需要检查。"));
    }
    ProcessGate::check_target(&executable)?;
    let mut command = Command::new(stage.join("星枢安装助手.exe"));
    command.current_dir(stage);
    command.arg("--manifest-sha256").arg(&bundle.release_sha256);
    if replace_conflicts {
        command.arg("--replace-conflicts");
    }
    command.arg("--install").arg(&game.platform).arg(&root);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let result = command.output().map_err(|_| error("INSTALL_FAILED", "无法执行内置安装校验。"))?;
    if !result.status.success() {
        let message = String::from_utf8_lossy(&result.stderr);
        let code = if message.contains("CONFLICT_CONFIRM_REQUIRED") { "CONFLICT_CONFIRM_REQUIRED" } else { "INSTALL_FAILED" };
        return Err(error(code, message.lines().take(6).collect::<Vec<_>>().join("\n")));
    }
    let installed = disk_state(game, bundle)?;
    if installed.state != "installed" { return Err(error("INSTALL_FAILED", "安装后组件指纹核验失败。")); }
    Ok(installed)
}

#[tauri::command]
pub async fn launcher_inspect_conflicts(
    installation_id: String,
    center: State<'_, ExtensionCenter>,
) -> HubResult<ConflictInspectReport> {
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let bundle = resolve_core_manifest(true).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let (root, _) = canonical_game(&game)?;
        let stage = stage_helper_only(&bundle)?;
        let mut command = Command::new(stage.path().join("星枢安装助手.exe"));
        command
            .current_dir(stage.path())
            .arg("--manifest-sha256")
            .arg(&bundle.release_sha256)
            .arg("--inspect-json")
            .arg(&game.platform)
            .arg(&root);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let result = command.output().map_err(|_| error("CHECK_FAILED", "无法启动内置冲突扫描模块。"))?;
        if !result.status.success() {
            let message = String::from_utf8_lossy(&result.stderr);
            let trimmed = message.lines().take(4).collect::<Vec<_>>().join("\n");
            return Err(error(
                "CHECK_FAILED",
                if trimmed.is_empty() { "冲突扫描未完成。".to_string() } else { trimmed },
            ));
        }
        let stdout = String::from_utf8_lossy(&result.stdout);
        let report: ConflictInspectReport = serde_json::from_str(stdout.trim())
            .map_err(|_| error("CHECK_FAILED", "无法解析冲突扫描结果。"))?;
        Ok(report)
    })
    .await
    .map_err(|_| error("CHECK_FAILED", "冲突扫描未完成。"))?
}

#[tauri::command]
pub async fn launcher_restore(
    installation_id: String,
    center: State<'_, ExtensionCenter>,
    app: tauri::AppHandle,
) -> HubResult<LauncherDiskState> {
    let _guard = INSTALLATION_CHANGE.lock().await;
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let bundle = resolve_core_manifest(false).await?;
    let channel = game.platform.clone();
    emit_component_progress(&app, &channel, "installing", 1, 1, 35, "正在校验原版备份并卸载官方插件 Mod…");
    let res = tauri::async_runtime::spawn_blocking(move || {
        let (root, executable) = canonical_game(&game)?;
        ProcessGate::check_target(&executable)?;
        let stage = stage_helper_only(&bundle)?;
        let mut command = Command::new(stage.path().join("星枢安装助手.exe"));
        command
            .current_dir(stage.path())
            .arg("--manifest-sha256")
            .arg(&bundle.release_sha256)
            .arg("--restore")
            .arg(&game.platform)
            .arg(&root);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let result = command.output().map_err(|_| error("RESTORE_FAILED", "无法启动安装助手执行还原。"))?;
        if !result.status.success() {
            let message = String::from_utf8_lossy(&result.stderr);
            let trimmed = message.lines().take(4).collect::<Vec<_>>().join("\n");
            return Err(error(
                "RESTORE_FAILED",
                if trimmed.is_empty() { "还原官方原版未成功，请通过「检查冲突」核对备份。".to_string() } else { trimmed },
            ));
        }
        disk_state(&game, &bundle)
    })
    .await
    .map_err(|_| error("RESTORE_FAILED", "卸载并还原任务未完成。"))?;

    match &res {
        Ok(_) => emit_component_progress(&app, &channel, "done", 1, 1, 100, "已卸载官方插件 Mod 并还原为官方原版"),
        Err(err) => emit_component_progress(&app, &channel, "error", 0, 0, 0, err.message.clone()),
    }
    res
}

#[tauri::command]
pub async fn launcher_start(installation_id: String, center: State<'_, ExtensionCenter>) -> HubResult<crate::commands::xingshu_commands::GameLaunchResult> {
    let _guard = INSTALLATION_CHANGE.lock().await;
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let (root, exe) = canonical_game(&game)?;
    let bundle = resolve_core_manifest(false).await?;
    // Non-Steam launch is limited to a recognized game binary's install root.
    if !game.platform.starts_with("STEAM_") {
        let hash = tauri::async_runtime::spawn_blocking(move || compute_file_sha256(root.join("GameAssembly.dll")))
            .await.map_err(|_| error("CHECK_FAILED", "无法核对渠道。"))??;
        let verified = bundle.release.platforms.iter().any(|p| p.id == game.platform && p.game_assembly_sha256.eq_ignore_ascii_case(&hash))
            || extension_center::profiles().into_iter().any(|p| p["platformId"] == game.platform
                && p["gameRuntimeDllSha256"].as_str().is_some_and(|h| h.eq_ignore_ascii_case(&hash)));
        if !verified { return Err(error("INCOMPATIBLE", "请从官方渠道启动新版游戏，核对安装位置后重试。")); }
    }
    crate::commands::xingshu_commands::launch_game_uri(None, Some(game.platform), Some(exe.to_string_lossy().into_owned())).await
        .map_err(|message| error("START_FAILED", message))
}

#[derive(Clone, Serialize, Deserialize)]
struct ModuleDefinition { id: String, name: String, description: String }

impl ModuleDefinition {
    fn package_id(&self) -> String { format!("xingshu.launcher.{}", self.id) }
    fn module_path(&self) -> String { format!("xingshu/plugins/{}.module", self.package_id()) }
    fn disabled_module_path(&self) -> String { format!(".xingshu-mods/disabled-modules/{}.module", self.package_id()) }
    fn payload(&self) -> String { format!("xingshu-module-v1:{}\n", self.id) }

    fn paths(&self, root: &Path) -> HubResult<(PathBuf, PathBuf)> {
        let active = crate::install::engine::InstallEngine::resolve_logical_target(root, &self.module_path())?;
        let disabled = crate::security::path_guard::PathGuard::ensure_within_root(
            root, &root.join(self.disabled_module_path()),
        )?;
        if same_executable(&active, &disabled) {
            return Err(error("MOD_PATH", "模块文件与停用缓存指向同一个位置。"));
        }
        Ok((active, disabled))
    }

    fn matches_file(&self, path: &Path) -> bool {
        let expected = self.payload();
        std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() == expected.len() as u64)
            && std::fs::read_to_string(path).is_ok_and(|text| text == expected)
    }

    fn verify_marker_if_present(&self, path: &Path) -> HubResult<()> {
        if path.exists() && !self.matches_file(path) {
            return Err(error("MOD_VERIFY", "模块文件与官方清单不一致，已停止操作。"));
        }
        Ok(())
    }
}

fn modules() -> HubResult<Vec<ModuleDefinition>> {
    serde_json::from_str(include_str!("../../src/shared/launcherModules.json"))
        .map_err(|_| error("MOD_CATALOG", "模组清单无法读取。"))
}

pub(crate) fn is_known_module(id: &str) -> bool {
    modules().is_ok_and(|items| items.iter().any(|item| item.id == id))
}

pub(crate) fn installed_module_state(game: &GameInstallation, id: &str) -> HubResult<&'static str> {
    let module = modules()?.into_iter().find(|module| module.id == id)
        .ok_or_else(|| error("MOD_UNKNOWN", "没有这个模组。"))?;
    let (root, _) = canonical_game(game)?;
    let (active, disabled) = module.paths(&root)?;
    if module.matches_file(&active) {
        Ok("enabled")
    } else if module.matches_file(&disabled) {
        Ok("disabled")
    } else {
        Ok("not_installed")
    }
}

pub(crate) fn snapshot_modules_for_game(
    game: &GameInstallation,
) -> HubResult<(bool, std::collections::BTreeMap<String, &'static str>)> {
    let (root, _) = canonical_game(game)?;
    let ready = cached_or_embedded_core_manifest()
        .and_then(|bundle| disk_state(game, &bundle))
        .is_ok_and(|s| modular_core_ready(&s));
    let mut states = std::collections::BTreeMap::new();
    for module in modules()? {
        let (active, disabled) = module.paths(&root)?;
        let st = if module.matches_file(&active) {
            "enabled"
        } else if module.matches_file(&disabled) {
            "disabled"
        } else {
            "not_installed"
        };
        states.insert(module.id, st);
    }
    Ok((ready, states))
}

fn modular_core_ready(state: &LauncherDiskState) -> bool {
    state.state == "installed" && state.version.is_some()
}

#[derive(Serialize)]
struct LauncherModRow {
    #[serde(flatten)]
    definition: ModuleDefinition,
    installed: bool,
    disabled: bool,
    managed: bool,
    available: bool,
}

#[derive(Serialize)]
pub struct LauncherMods { modules: Vec<LauncherModRow>, ready: bool }

#[tauri::command]
pub async fn launcher_mods(installation_id: Option<String>, center: State<'_, ExtensionCenter>) -> HubResult<LauncherMods> {
    let db = center.db.clone();
    let game = installation_id.map(|id| extension_center::get_game(&db, &id)).transpose()?;
    let bundle = resolve_core_manifest(false).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let location = game.as_ref().map(canonical_game).transpose()?;
        let ready = game.as_ref().and_then(|g| disk_state(g, &bundle).ok()).is_some_and(|s| modular_core_ready(&s));
        let available = game.as_ref().is_some_and(|game| {
            bundle.release.platforms.iter().any(|platform| platform.id == game.platform)
        });
        let repo = crate::storage::repositories::ExtensionRepository::new(db);
        let rows = modules()?.into_iter().map(|definition| {
            let (active, is_disabled) = location.as_ref()
                .and_then(|(root, _)| definition.paths(root).ok())
                .map(|(active, disabled)| (definition.matches_file(&active), definition.matches_file(&disabled)))
                .unwrap_or_default();
            let managed = if let Some(game) = &game {
                let id = extension_center::scoped_package_id(&definition.package_id(), game);
                !repo.get_installed_files_by_package(&id)?.is_empty()
            } else { false };
            Ok(LauncherModRow {
                definition,
                installed: active || is_disabled,
                disabled: !active && is_disabled,
                managed,
                available,
            })
        }).collect::<HubResult<Vec<_>>>()?;
        Ok(LauncherMods { modules: rows, ready })
    }).await.map_err(|_| error("MOD_CATALOG", "模组状态读取未完成。"))?
}

fn build_official_module_xspkg(module: &ModuleDefinition) -> HubResult<Vec<u8>> {
    use std::io::Write;
    use crate::packages::manifest::{
        CompatibilityMeta, GameCompatibility, HubPackageManifestV1, InstallPolicy,
        PackageFileEntry, PackageMeta, XingShuCompatibility,
    };

    let pkg_id = module.package_id();
    let payload = module.payload();
    let digest = crate::security::hash::compute_sha256_bytes(payload.as_bytes());
    let source_rel = format!("payload/{pkg_id}.module");
    let manifest = HubPackageManifestV1 {
        schema_version: 1,
        package: PackageMeta {
            id: pkg_id,
            package_type: "mod".to_string(),
            name: module.name.clone(),
            version: "1.0.0".to_string(),
            publisher: "XingShu Official".to_string(),
            description: Some(module.description.clone()),
        },
        compatibility: CompatibilityMeta {
            game: GameCompatibility {
                app_id: "astralparty".to_string(),
                platforms: vec![
                    "STEAM_CN".to_string(),
                    "STEAM_GLOBAL".to_string(),
                    "TAPTAP".to_string(),
                    "BILIBILI".to_string(),
                    "WEGAME".to_string(),
                ],
                min_version: None,
                max_version: None,
            },
            xingshu: Some(XingShuCompatibility {
                min_version: Some("1.0.0".to_string()),
                max_version: None,
            }),
        },
        install: InstallPolicy {
            requires_game_closed: true,
            requires_xingshu_closed: false,
            backup: true,
        },
        files: vec![PackageFileEntry {
            source: source_rel.clone(),
            target: module.module_path(),
            sha256: digest,
            size: payload.len() as u64,
        }],
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| error("MOD_PACKAGE", e.to_string()))?;

    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut cursor);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        writer
            .start_file("manifest.json", opts)
            .map_err(|e| error("MOD_PACKAGE", e.to_string()))?;
        writer
            .write_all(&manifest_bytes)
            .map_err(|e| error("MOD_PACKAGE", e.to_string()))?;
        writer
            .start_file(&source_rel, opts)
            .map_err(|e| error("MOD_PACKAGE", e.to_string()))?;
        writer
            .write_all(payload.as_bytes())
            .map_err(|e| error("MOD_PACKAGE", e.to_string()))?;
        writer
            .finish()
            .map_err(|e| error("MOD_PACKAGE", e.to_string()))?;
    }
    Ok(cursor.into_inner())
}

async fn fetch_official_module_archive_with_fallback<F>(
    module: &ModuleDefinition,
    mut on_progress: F,
) -> HubResult<Vec<u8>>
where
    F: FnMut(u64, u64),
{
    let pkg_id = module.package_id();
    for _attempt in 0..2 {
        if let Ok(bytes) = crate::workshop::official_module_archive_with_progress(&pkg_id, &mut on_progress).await {
            return Ok(bytes);
        }
    }
    build_official_module_xspkg(module)
}

fn install_official_module_sync(
    db: &crate::storage::database::Database,
    backup_root: &Path,
    game: &GameInstallation,
    module: &ModuleDefinition,
    archive: Vec<u8>,
    allow_reenable: bool,
) -> HubResult<&'static str> {
    let (root, exe) = canonical_game(game)?;
    let _lock = crate::workshop::operation_lock(&root)?;
    ProcessGate::check_target(&exe)?;
    let id = module.package_id();
    let scoped = extension_center::scoped_package_id(&id, game);
    let (target, disabled_target) = module.paths(&root)?;
    let records = crate::storage::repositories::ExtensionRepository::new(db.clone())
        .get_installed_files_by_package(&scoped)?;
    module.verify_marker_if_present(&target)?;
    module.verify_marker_if_present(&disabled_target)?;

    if disabled_target.is_file() {
        if !allow_reenable {
            return Err(error("MOD_DISABLED", "该模块已停用，可直接使用开关恢复。"));
        }
        if target.is_file() {
            let _ = std::fs::remove_file(&disabled_target);
            return Ok("skipped");
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| error("MOD_TOGGLE", e.to_string()))?;
        }
        std::fs::rename(&disabled_target, &target).map_err(|e| error("MOD_TOGGLE", e.to_string()))?;
        return Ok("enabled");
    }

    if target.is_file() && !records.is_empty() {
        return Ok("skipped");
    }
    if target.exists() && records.is_empty() {
        return Err(error("MOD_CONFLICT", "发现手动安装的同名文件，请检查后再继续。"));
    }

    let file = tempfile::NamedTempFile::new().map_err(|e| error("MOD_INSTALL", e.to_string()))?;
    std::fs::write(file.path(), archive).map_err(|e| error("MOD_INSTALL", e.to_string()))?;
    let manifest = crate::packages::parser::PackageParser::parse_archive(file.path())?;
    let payload = module.payload();
    let digest = crate::security::hash::compute_sha256_bytes(payload.as_bytes());
    let matches = manifest.package.id == id
        && manifest.package.package_type == "mod"
        && manifest.files.len() == 1
        && manifest.install.backup
        && manifest.install.requires_game_closed
        && manifest.files[0].target == module.module_path()
        && manifest.files[0].sha256 == digest
        && manifest.files[0].size == payload.len() as u64;
    if !matches {
        return Err(error("MOD_PACKAGE", "模组包的内容与清单不一致。"));
    }
    let transaction = crate::application::InstallService::new(db.clone(), backup_root.to_path_buf())
        .install_mod_package_in_locked_root(file.path(), game)?;
    if transaction.state != "COMPLETED" {
        return Err(error("MOD_INSTALL", "模组安装未完成。"));
    }
    Ok("installed")
}

fn uninstall_official_module_sync(
    db: &crate::storage::database::Database,
    game: &GameInstallation,
    module: &ModuleDefinition,
    allow_unmanaged_verified: bool,
) -> HubResult<bool> {
    let (root, exe) = canonical_game(game)?;
    let _lock = crate::workshop::operation_lock(&root)?;
    ProcessGate::check_target(&exe)?;
    let id = module.package_id();
    let scoped = extension_center::scoped_package_id(&id, game);
    let (target, disabled_target) = module.paths(&root)?;
    let records = crate::storage::repositories::ExtensionRepository::new(db.clone())
        .get_installed_files_by_package(&scoped)?;
    module.verify_marker_if_present(&target)?;
    module.verify_marker_if_present(&disabled_target)?;

    if records.is_empty() && !target.exists() && !disabled_target.exists() {
        return Ok(false);
    }

    let expected = crate::security::hash::compute_sha256_bytes(module.payload().as_bytes());
    let record_valid = records.len() == 1
        && same_executable(Path::new(&records[0].target_path), &target)
        && records[0].installed_sha256 == expected;
    if !record_valid {
        if allow_unmanaged_verified && records.is_empty() {
            if target.is_file() {
                std::fs::remove_file(&target).map_err(|e| error("MOD_INSTALL", e.to_string()))?;
            }
            if disabled_target.is_file() {
                std::fs::remove_file(&disabled_target).map_err(|e| error("MOD_INSTALL", e.to_string()))?;
            }
            return Ok(true);
        }
        return Err(error("MOD_RECORD", "此模组没有匹配的安装记录。"));
    }

    crate::application::ExtensionService::new(db.clone()).uninstall_extension(&scoped, false, &exe)?;
    if disabled_target.is_file() {
        std::fs::remove_file(&disabled_target).map_err(|e| error("MOD_INSTALL", e.to_string()))?;
    }
    Ok(true)
}

#[tauri::command]
pub async fn launcher_change_mod(installation_id: String, mod_id: String, install: bool,
    center: State<'_, ExtensionCenter>, app: tauri::AppHandle) -> HubResult<()> {
    use tauri::Manager;
    let _guard = INSTALLATION_CHANGE.lock().await;
    let db = center.db.clone();
    let game = extension_center::get_game(&db, &installation_id)?;
    let module = modules()?.into_iter().find(|m| m.id == mod_id).ok_or_else(|| error("MOD_UNKNOWN", "没有这个模组。"))?;
    let pkg_id = module.package_id();
    let archive = if install {
        crate::workshop::emit_mod_progress(&app, &pkg_id, "downloading", 0, 0, 10, "正在下载官方功能模块…");
        match fetch_official_module_archive_with_fallback(&module, |dl, total| {
            let pct = crate::workshop::scaled_download_percent(dl, total);
            crate::workshop::emit_mod_progress(&app, &pkg_id, "downloading", dl, total, pct, "正在下载官方功能模块…");
        }).await {
            Ok(bytes) => Some(bytes),
            Err(err) => {
                crate::workshop::emit_mod_progress(&app, &pkg_id, "error", 0, 0, 0, err.message.clone());
                return Err(err);
            }
        }
    } else {
        None
    };
    if install {
        crate::workshop::emit_mod_progress(&app, &pkg_id, "installing", 1, 1, 95, "正在校验并写入模块…");
    }
    let backup_root = app.path().app_data_dir().map_err(|_| error("MOD_PATH", "无法定位模组备份目录。"))?.join("backups");
    let app_for_end = app.clone();
    let pkg_id_for_end = pkg_id.clone();
    let res = tauri::async_runtime::spawn_blocking(move || -> HubResult<()> {
        if !install {
            let _ = uninstall_official_module_sync(&db, &game, &module, false)?;
            return Ok(());
        }
        let archive = archive.ok_or_else(|| error("MOD_INSTALL", "官方模块未下载。"))?;
        let _ = install_official_module_sync(&db, &backup_root, &game, &module, archive, false)?;
        Ok(())
    }).await.map_err(|_| error("MOD_INSTALL", "模组操作未完成。"))?;
    if install {
        match &res {
            Ok(()) => crate::workshop::emit_mod_progress(&app_for_end, &pkg_id_for_end, "done", 1, 1, 100, "模块已安装并启用"),
            Err(err) => crate::workshop::emit_mod_progress(&app_for_end, &pkg_id_for_end, "error", 0, 0, 0, err.message.clone()),
        }
    }
    res
}

fn toggle_module_sync(
    game: &GameInstallation,
    module: &ModuleDefinition,
    enabled: bool,
) -> HubResult<&'static str> {
    let (root, exe) = canonical_game(game)?;
    let _lock = crate::workshop::operation_lock(&root)?;
    ProcessGate::check_target(&exe)?;
    let (active, disabled) = module.paths(&root)?;
    module.verify_marker_if_present(&active)?;
    module.verify_marker_if_present(&disabled)?;
    let (source, target) = if enabled { (disabled, active) } else { (active, disabled) };
    let next_state = if enabled { "enabled" } else { "disabled" };
    if target.is_file() {
        if source.is_file() {
            std::fs::remove_file(source).map_err(|e| error("MOD_TOGGLE", e.to_string()))?;
        }
        return Ok(next_state);
    }
    if !source.is_file() {
        return Err(error("MOD_NOT_INSTALLED", "未找到此模块的本地文件，请先安装。"));
    }
    let parent = target.parent().ok_or_else(|| error("MOD_PATH", "无效的模块路径。"))?;
    std::fs::create_dir_all(parent).map_err(|e| error("MOD_TOGGLE", e.to_string()))?;
    std::fs::rename(source, target).map_err(|e| error("MOD_TOGGLE", e.to_string()))?;
    Ok(next_state)
}

pub(crate) async fn toggle_module_for_game(
    game: GameInstallation,
    mod_id: String,
    enabled: bool,
) -> HubResult<&'static str> {
    let _guard = INSTALLATION_CHANGE.lock().await;
    let module = modules()?
        .into_iter()
        .find(|m| m.id == mod_id)
        .ok_or_else(|| error("MOD_UNKNOWN", "没有这个模组。"))?;
    tauri::async_runtime::spawn_blocking(move || toggle_module_sync(&game, &module, enabled))
        .await
        .map_err(|_| error("MOD_TOGGLE", "模组开关切换未完成。"))?
}

#[tauri::command]
pub async fn launcher_toggle_mod(
    installation_id: String,
    mod_id: String,
    enabled: bool,
    center: State<'_, ExtensionCenter>,
) -> HubResult<()> {
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let _ = toggle_module_for_game(game, mod_id, enabled).await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherBatchModsResult {
    pub core_installed: bool,
    pub core_already_installed: bool,
    pub installed_count: usize,
    pub enabled_count: usize,
    pub skipped_count: usize,
    pub removed_count: usize,
    pub total_count: usize,
}

#[tauri::command]
pub async fn launcher_install_all_official_mods(
    installation_id: String,
    include_core: bool,
    center: State<'_, ExtensionCenter>,
    app: tauri::AppHandle,
) -> HubResult<LauncherBatchModsResult> {
    use tauri::Manager;
    let _guard = INSTALLATION_CHANGE.lock().await;
    let db = center.db.clone();
    let game = extension_center::get_game(&db, &installation_id)?;
    let backup_root = app
        .path()
        .app_data_dir()
        .map_err(|_| error("MOD_PATH", "无法定位模组备份目录。"))?
        .join("backups");

    let bundle = resolve_core_manifest(include_core).await?;
    let game_check = game.clone();
    let initial_disk = tauri::async_runtime::spawn_blocking(move || {
        let (_, exe) = canonical_game(&game_check)?;
        ProcessGate::check_target(&exe)?;
        disk_state(&game_check, &bundle)
    })
    .await
    .map_err(|_| error("MOD_INSTALL", "安装环境核验未完成。"))??;

    let core_already_installed = initial_disk.state == "installed";
    let mut core_installed = false;
    if include_core && !core_already_installed {
        let _ = install_core_component_for_game(&game, &app, false).await?;
        core_installed = true;
    }

    let all_modules = modules()?;
    let total_count = all_modules.len();
    let mut installed_count = 0usize;
    let mut enabled_count = 0usize;
    let mut skipped_count = 0usize;
    let batch_key = "xingshu.official.batch";

    for (idx, module) in all_modules.into_iter().enumerate() {
        let ordinal = idx + 1;
        let pct = ((ordinal * 95) / total_count.max(1)).min(95) as u8;
        let detail = format!("正在处理 ({ordinal}/{total_count})：{}", module.name);
        crate::workshop::emit_mod_progress(&app, batch_key, "installing", ordinal as u64, total_count as u64, pct, &detail);

        let game_probe = game.clone();
        let mod_probe = module.clone();
        let pre = tauri::async_runtime::spawn_blocking(move || -> HubResult<&'static str> {
            let (root, _) = canonical_game(&game_probe)?;
            let (active, disabled) = mod_probe.paths(&root)?;
            mod_probe.verify_marker_if_present(&active)?;
            mod_probe.verify_marker_if_present(&disabled)?;
            if active.is_file() {
                return Ok("already_active");
            }
            if disabled.is_file() {
                return Ok("disabled");
            }
            Ok("needs_install")
        })
        .await
        .map_err(|_| error("MOD_INSTALL", "模组状态读取未完成。"))??;

        match pre {
            "already_active" => {
                skipped_count += 1;
            }
            "disabled" => {
                let game_owned = game.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || toggle_module_sync(&game_owned, &module, true))
                    .await
                    .map_err(|_| error("MOD_TOGGLE", "启用模块未完成。"))??;
                enabled_count += 1;
            }
            _ => {
                let archive = fetch_official_module_archive_with_fallback(&module, |_, _| {}).await?;
                let game_owned = game.clone();
                let db_owned = db.clone();
                let backup_owned = backup_root.clone();
                let outcome = tauri::async_runtime::spawn_blocking(move || {
                    install_official_module_sync(&db_owned, &backup_owned, &game_owned, &module, archive, true)
                })
                .await
                .map_err(|_| error("MOD_INSTALL", "模块写入未完成。"))??;
                match outcome {
                    "installed" => installed_count += 1,
                    "enabled" => enabled_count += 1,
                    _ => skipped_count += 1,
                }
            }
        }
    }

    crate::workshop::emit_mod_progress(
        &app,
        batch_key,
        "done",
        total_count as u64,
        total_count as u64,
        100,
        format!("已完成官方插件与 {total_count} 项功能模组部署"),
    );

    Ok(LauncherBatchModsResult {
        core_installed,
        core_already_installed,
        installed_count,
        enabled_count,
        skipped_count,
        removed_count: 0,
        total_count,
    })
}

#[tauri::command]
pub async fn launcher_uninstall_all_official_mods(
    installation_id: String,
    center: State<'_, ExtensionCenter>,
    app: tauri::AppHandle,
) -> HubResult<LauncherBatchModsResult> {
    let _guard = INSTALLATION_CHANGE.lock().await;
    let db = center.db.clone();
    let game = extension_center::get_game(&db, &installation_id)?;
    let all_modules = modules()?;
    let total_count = all_modules.len();

    let (removed_count, skipped_count) = tauri::async_runtime::spawn_blocking(move || -> HubResult<(usize, usize)> {
        let (_, exe) = canonical_game(&game)?;
        ProcessGate::check_target(&exe)?;
        let mut removed = 0usize;
        let mut skipped = 0usize;
        for (idx, module) in all_modules.into_iter().enumerate() {
            let ordinal = idx + 1;
            let pct = ((ordinal * 95) / total_count.max(1)).min(95) as u8;
            crate::workshop::emit_mod_progress(
                &app,
                "xingshu.official.batch",
                "installing",
                ordinal as u64,
                total_count as u64,
                pct,
                format!("正在卸载 ({ordinal}/{total_count})：{}", module.name),
            );
            if uninstall_official_module_sync(&db, &game, &module, true)? {
                removed += 1;
            } else {
                skipped += 1;
            }
        }
        crate::workshop::emit_mod_progress(
            &app,
            "xingshu.official.batch",
            "done",
            total_count as u64,
            total_count as u64,
            100,
            "已卸载全部星枢功能模组",
        );
        Ok((removed, skipped))
    })
    .await
    .map_err(|_| error("MOD_INSTALL", "批量卸载任务未完成。"))??;

    Ok(LauncherBatchModsResult {
        core_installed: false,
        core_already_installed: false,
        installed_count: 0,
        enabled_count: 0,
        skipped_count,
        removed_count,
        total_count,
    })
}

#[tauri::command]
pub async fn launcher_open_mods_dir(installation_id: String, center: State<'_, ExtensionCenter>) -> HubResult<()> {
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let (root, _) = canonical_game(&game)?;
    let plugins_dir = root.join("xingshu").join("plugins");
    let xingshu_dir = root.join("xingshu");
    let target = if plugins_dir.is_dir() {
        plugins_dir
    } else if xingshu_dir.is_dir() {
        xingshu_dir
    } else {
        root
    };
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(&target)
            .spawn()
            .map_err(|_| error("OPEN_DIR_FAILED", "无法打开模组目录。"))?;
    }
    #[cfg(not(windows))]
    let _ = target;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verified_previous_components_are_updatable_on_their_own_channels() {
        let bundle = embedded_core_manifest().unwrap();
        let release = &bundle.release;
        for platform in &release.platforms {
            let vanilla = platform
                .vanilla_sha256
                .as_deref()
                .unwrap_or(&platform.accepted_hashes[0]);
            assert_eq!(
                component_fingerprint(platform, &release.runtime_version, &bundle.inventory, vanilla),
                ("installable", None),
            );
            for prior in bundle.inventory.iter().filter(|entry| entry.platform == platform.id) {
                assert_eq!(
                    component_fingerprint(platform, &release.runtime_version, &bundle.inventory, &prior.sha256),
                    ("updateAvailable", Some(prior.version.clone())),
                );
            }
            for old_hash in platform.accepted_hashes.iter().skip(1) {
                let (state, version) =
                    component_fingerprint(platform, &release.runtime_version, &bundle.inventory, old_hash);
                assert_eq!(state, "updateAvailable");
                assert!(version.is_some());
            }
            assert_eq!(
                component_fingerprint(platform, &release.runtime_version, &bundle.inventory, &platform.payload_sha256),
                ("installed", Some(release.runtime_version.clone())),
            );
            assert_eq!(
                component_fingerprint(platform, &release.runtime_version, &bundle.inventory, &"0".repeat(64)),
                ("incompatible", None),
            );
        }
    }

    #[test]
    fn remote_core_manifest_hot_update_and_validation() {
        let r841 = "1".repeat(64);
        let r842 = "2".repeat(64);
        let vanilla = "3".repeat(64);
        let new_game_ga = "4".repeat(64);
        let new_bundle_rel = format!(
            "AstralParty_CN_Data\\com.unity.addressables\\AssetBundles\\{}\\{}\\__data",
            "a".repeat(32),
            "b".repeat(32)
        );
        let remote_raw = serde_json::to_vec(&serde_json::json!({
            "formatVersion": 1,
            "runtimeVersion": "1.0.0-game-ui-r8.42",
            "pathPrefix": "/xingshu-hub/assets/launcher-runtime/r8.42",
            "payloadSizes": { "STEAM_CN": 9100000 },
            "release": {
                "FormatVersion": 1,
                "Version": "0.1.7",
                "HubSha256": "5".repeat(64),
                "RuntimeVersion": "1.0.0-game-ui-r8.42",
                "Platforms": [{
                    "Id": "STEAM_CN",
                    "Label": "Steam 国服",
                    "ExeName": "AstralParty_CN.exe",
                    "GameAssemblySha256": new_game_ga,
                    "GameVersion": "3.4.0",
                    "ResourceVersion": "165",
                    "BundleRelativePath": new_bundle_rel,
                    "Payload": "Runtime/STEAM_CN/__data",
                    "PayloadSha256": r842,
                    "VanillaSha256": vanilla,
                    "AcceptedHashes": [vanilla, r841]
                }]
            },
            "inventory": [{
                "platform": "STEAM_CN",
                "version": "1.0.0-game-ui-r8.41",
                "sha256": r841,
                "bundleRelativePath": new_bundle_rel
            }]
        }))
        .unwrap();

        let bundle = parse_and_validate_core_manifest(&remote_raw, "remote").unwrap();
        assert_eq!(bundle.release.runtime_version, "1.0.0-game-ui-r8.42");
        assert_eq!(bundle.path_prefix, "/xingshu-hub/assets/launcher-runtime/r8.42");
        let steam = &bundle.release.platforms[0];
        assert_eq!(
            component_fingerprint(steam, &bundle.release.runtime_version, &bundle.inventory, &r841),
            ("updateAvailable", Some("1.0.0-game-ui-r8.41".to_string())),
        );
        assert_eq!(
            component_fingerprint(steam, &bundle.release.runtime_version, &bundle.inventory, &r842),
            ("installed", Some("1.0.0-game-ui-r8.42".to_string())),
        );

        // Tampered pathPrefix must be rejected.
        let bad_prefix = serde_json::to_vec(&serde_json::json!({
            "formatVersion": 1,
            "runtimeVersion": "1.0.0-game-ui-r8.42",
            "pathPrefix": "https://evil.example/payload",
            "payloadSizes": { "STEAM_CN": 9100000 },
            "release": serde_json::from_slice::<serde_json::Value>(&bundle.release_raw_json).unwrap(),
            "inventory": []
        }))
        .unwrap();
        assert!(parse_and_validate_core_manifest(&bad_prefix, "remote").is_err());

        // Path traversal in BundleRelativePath must be rejected.
        let bad_rel = serde_json::to_vec(&serde_json::json!({
            "formatVersion": 1,
            "runtimeVersion": "1.0.0-game-ui-r8.42",
            "pathPrefix": "/xingshu-hub/assets/launcher-runtime/r8.42",
            "payloadSizes": { "STEAM_CN": 9100000 },
            "release": {
                "RuntimeVersion": "1.0.0-game-ui-r8.42",
                "Platforms": [{
                    "Id": "STEAM_CN",
                    "GameAssemblySha256": new_game_ga,
                    "BundleRelativePath": "AstralParty_CN_Data\\..\\..\\evil\\__data",
                    "Payload": "Runtime/STEAM_CN/__data",
                    "PayloadSha256": r842,
                    "VanillaSha256": vanilla,
                    "AcceptedHashes": [vanilla]
                }]
            },
            "inventory": []
        }))
        .unwrap();
        assert!(parse_and_validate_core_manifest(&bad_rel, "remote").is_err());

        // Malformed SHA-256 must be rejected.
        let bad_sha = serde_json::to_vec(&serde_json::json!({
            "formatVersion": 1,
            "runtimeVersion": "1.0.0-game-ui-r8.42",
            "pathPrefix": "/xingshu-hub/assets/launcher-runtime/r8.42",
            "payloadSizes": { "STEAM_CN": 9100000 },
            "release": {
                "RuntimeVersion": "1.0.0-game-ui-r8.42",
                "Platforms": [{
                    "Id": "STEAM_CN",
                    "GameAssemblySha256": "not-a-sha256",
                    "BundleRelativePath": new_bundle_rel,
                    "Payload": "Runtime/STEAM_CN/__data",
                    "PayloadSha256": r842,
                    "AcceptedHashes": [vanilla]
                }]
            },
            "inventory": []
        }))
        .unwrap();
        assert!(parse_and_validate_core_manifest(&bad_sha, "remote").is_err());
    }

    #[test]
    fn built_official_module_xspkg_passes_package_parser_for_all_22_modules() {
        let all = modules().unwrap();
        assert_eq!(all.len(), 22, "Expected 22 official launcher modules");
        for module in all {
            let bytes = build_official_module_xspkg(&module).unwrap();
            let tmp = tempfile::NamedTempFile::new().unwrap();
            std::fs::write(tmp.path(), bytes).unwrap();
            let manifest = crate::packages::parser::PackageParser::parse_archive(tmp.path()).unwrap();
            let payload = module.payload();
            let digest = crate::security::hash::compute_sha256_bytes(payload.as_bytes());
            assert_eq!(manifest.package.id, module.package_id());
            assert_eq!(manifest.package.package_type, "mod");
            assert!(manifest.install.backup);
            assert!(manifest.install.requires_game_closed);
            assert_eq!(manifest.files.len(), 1);
            assert_eq!(manifest.files[0].target, module.module_path());
            assert_eq!(manifest.files[0].sha256, digest);
            assert_eq!(manifest.files[0].size, payload.len() as u64);
        }
    }
}
