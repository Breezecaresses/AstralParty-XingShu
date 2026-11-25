use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, UriSchemeContext, UriSchemeResponder, Wry, http};

use crate::{
    domain::error::{HubError, HubResult},
    extension_center::{self, ExtensionCenter},
    install::gates::ProcessGate,
};

const LOBBY_BG_DIR_NAME: &str = "lobbybg";
const LOBBY_BG_SIDECAR_NAME: &str = "xingshu_lobby_bg.json";
const CUSTOMIZE_DEBUG_FILENAME: &str = "xingshu_customize_debug.json";
const MAX_MEDIA_BYTES: u64 = 512 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_LAUNCHER_BG_BYTES: u64 = 32 * 1024 * 1024;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn err(code: &str, message: impl Into<String>) -> HubError {
    HubError::new(code, message, "CUSTOMIZE").with_recoverable(true)
}

fn unix_ms_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_single_safe_filename(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 200 || trimmed == "." || trimmed == ".." {
        return false;
    }
    if trimmed.starts_with('.') || trimmed.starts_with('~') {
        return false;
    }
    !trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'])
}

fn classify_lobby_bg_ext(path_or_name: &str) -> Option<&'static str> {
    let ext = Path::new(path_or_name)
        .extension()
        .and_then(|e| e.to_str())?
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" => Some("image"),
        "mp4" | "webm" | "mov" | "m4v" | "wmv" => Some("video"),
        "usm" => Some("usm"),
        "bundle" => Some("bundle"),
        _ => None,
    }
}

fn image_mime_for_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

fn is_game_running_at(root: &Path) -> bool {
    let candidates = [
        root.join("AstralParty_CN.exe"),
        root.join("AstralParty.exe"),
        root.join("吉星派对.exe"),
    ];
    candidates
        .iter()
        .any(|exe| exe.is_file() && ProcessGate::check_target(exe).is_err())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LobbyBgSidecarConfig {
    pub enabled: bool,
    pub selected_file: String,
    pub sync_sub_panels: bool,
    pub random_on_lobby: bool,
    pub fill_mode: String, // "cover" | "contain" | "stretch"
    pub brightness: f32,   // 0.30..=1.00
    pub speed: f32,        // 0.50..=2.00
    pub muted: bool,
    pub volume: f32,       // 0.00..=1.00
    pub mute_vanilla_bgm: bool,
    pub updated_at: u64,
}

impl Default for LobbyBgSidecarConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            selected_file: String::new(),
            sync_sub_panels: true,
            random_on_lobby: false,
            fill_mode: "cover".to_string(),
            brightness: 1.0,
            speed: 1.0,
            muted: true,
            volume: 0.4,
            mute_vanilla_bgm: false,
            updated_at: 0,
        }
    }
}

impl LobbyBgSidecarConfig {
    fn sanitized(mut self) -> Self {
        self.selected_file = if is_single_safe_filename(&self.selected_file) {
            self.selected_file.trim().to_string()
        } else {
            String::new()
        };
        self.fill_mode = match self.fill_mode.trim().to_ascii_lowercase().as_str() {
            "contain" | "stretch" => self.fill_mode.trim().to_ascii_lowercase(),
            _ => "cover".to_string(),
        };
        self.brightness = if self.brightness.is_finite() {
            self.brightness.clamp(0.30, 1.00)
        } else {
            1.0
        };
        self.speed = if self.speed.is_finite() {
            self.speed.clamp(0.50, 2.00)
        } else {
            1.0
        };
        self.volume = if self.volume.is_finite() {
            self.volume.clamp(0.00, 1.00)
        } else {
            0.40
        };
        if self.updated_at == 0 {
            self.updated_at = unix_ms_now();
        }
        self
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyBgMediaEntry {
    pub file_name: String,
    pub kind: String,
    pub size_bytes: u64,
    pub modified_at: u64,
    pub preview_data_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyBgState {
    pub game_root: String,
    pub lobby_dir: String,
    pub sidecar_path: String,
    pub game_running: bool,
    pub files: Vec<LobbyBgMediaEntry>,
    pub config: LobbyBgSidecarConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomizeProfileItem {
    pub id: String,
    pub name: String,
    pub mod_ids: Vec<String>,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeUiDebugConfig {
    pub hide_vanilla_bg_anim: bool,
    pub compact_lobby_badges: bool,
    pub show_debug_outline: bool,
    pub custom_hud_opacity: u8,
    pub hide_lobby_ads: bool,
}

impl Default for HomeUiDebugConfig {
    fn default() -> Self {
        Self {
            hide_vanilla_bg_anim: false,
            compact_lobby_badges: false,
            show_debug_outline: false,
            custom_hud_opacity: 100,
            hide_lobby_ads: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomizeTuningState {
    pub active_card_profile: Option<String>,
    pub card_profiles: Vec<CustomizeProfileItem>,
    pub active_audio_profile: Option<String>,
    pub audio_profiles: Vec<CustomizeProfileItem>,
    pub active_character_profile: Option<String>,
    pub character_profiles: Vec<CustomizeProfileItem>,
    pub selected_font_family: Option<String>,
    pub selected_font_file: Option<String>,
    pub font_cjk_only: bool,
    pub font_replace_headings: bool,
    pub home_ui_debug: HomeUiDebugConfig,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFontEntry {
    pub family: String,
    pub display_name: String,
    pub file_path: String,
    pub style_label: String,
    pub likely_cjk: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherBgInfo {
    pub has_image: bool,
    pub file_name: Option<String>,
    pub data_url: Option<String>,
}

fn read_sidecar_config(sidecar_path: &Path) -> LobbyBgSidecarConfig {
    let Ok(raw) = fs::read_to_string(sidecar_path) else {
        return LobbyBgSidecarConfig::default();
    };
    serde_json::from_str::<LobbyBgSidecarConfig>(&raw)
        .map(LobbyBgSidecarConfig::sanitized)
        .unwrap_or_default()
}

fn write_atomic_json(path: &Path, bytes: &[u8]) -> HubResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| err("IO_FAILED", e.to_string()))?;
    }
    let tmp = path.with_extension(format!("tmp.{}", unix_ms_now()));
    fs::write(&tmp, bytes).map_err(|e| err("IO_FAILED", e.to_string()))?;
    fs::rename(&tmp, path).map_err(|e| err("IO_FAILED", e.to_string()))?;
    Ok(())
}

fn build_image_data_url(path: &Path, size_bytes: u64) -> Option<String> {
    if size_bytes == 0 || size_bytes > MAX_PREVIEW_IMAGE_BYTES {
        return None;
    }
    let ext = path.extension()?.to_str()?;
    let mime = image_mime_for_ext(ext);
    if mime == "application/octet-stream" {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    Some(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
}

fn scan_lobby_bg_state(root: &Path) -> HubResult<LobbyBgState> {
    let canon_root = dunce::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let lobby_dir = canon_root.join(LOBBY_BG_DIR_NAME);
    let sidecar_path = lobby_dir.join(LOBBY_BG_SIDECAR_NAME);
    let config = read_sidecar_config(&sidecar_path);
    let mut files = Vec::new();

    if lobby_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&lobby_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if !is_single_safe_filename(file_name) {
                    continue;
                }
                let Some(kind) = classify_lobby_bg_ext(file_name) else {
                    continue;
                };
                let Ok(meta) = entry.metadata() else {
                    continue;
                };
                let size_bytes = meta.len();
                let modified_at = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let preview_data_url = if kind == "image" {
                    build_image_data_url(&path, size_bytes)
                } else {
                    None
                };
                files.push(LobbyBgMediaEntry {
                    file_name: file_name.to_string(),
                    kind: kind.to_string(),
                    size_bytes,
                    modified_at,
                    preview_data_url,
                });
            }
        }
    }

    files.sort_by(|a, b| a.file_name.to_ascii_lowercase().cmp(&b.file_name.to_ascii_lowercase()));

    Ok(LobbyBgState {
        game_root: canon_root.to_string_lossy().replace('\\', "/"),
        lobby_dir: lobby_dir.to_string_lossy().replace('\\', "/"),
        sidecar_path: sidecar_path.to_string_lossy().replace('\\', "/"),
        game_running: is_game_running_at(&canon_root),
        files,
        config,
    })
}

#[tauri::command]
pub async fn customize_pick_files(
    title: Option<String>,
    filter: Option<String>,
    multi: Option<bool>,
) -> HubResult<Vec<String>> {
    #[cfg(not(windows))]
    {
        let _ = (title, filter, multi);
        return Err(err("UNSUPPORTED", "当前平台暂不支持原生文件选择器。"));
    }
    #[cfg(windows)]
    {
        let title_clean = title
            .unwrap_or_else(|| "选择文件".to_string())
            .replace('\'', " ");
        let filter_clean = filter
            .unwrap_or_else(|| "所有文件|*.*".to_string())
            .replace('\'', " ");
        let multi_flag = multi.unwrap_or(false);

        tauri::async_runtime::spawn_blocking(move || {
            let ps_script = format!(
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
                Add-Type -AssemblyName System.Windows.Forms; \
                $dlg = New-Object System.Windows.Forms.OpenFileDialog; \
                $dlg.Title = '{title_clean}'; \
                $dlg.Filter = '{filter_clean}'; \
                $dlg.Multiselect = ${}; \
                $dlg.RestoreDirectory = $true; \
                if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ \
                    $dlg.FileNames | ForEach-Object {{ Write-Output $_ }} \
                }}",
                if multi_flag { "true" } else { "false" }
            );
            let mut cmd = Command::new("powershell.exe");
            cmd.args(["-NoProfile", "-STA", "-Command", &ps_script]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            let output = cmd
                .output()
                .map_err(|e| err("PICK_FILE", format!("无法唤起文件选择框: {e}")))?;
            if !output.status.success() {
                return Err(err(
                    "PICK_FILE",
                    String::from_utf8_lossy(&output.stderr).trim().to_string(),
                ));
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            let picked = stdout
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            Ok(picked)
        })
        .await
        .map_err(|_| err("PICK_FILE", "文件选择操作未完成。"))?
    }
}

#[tauri::command]
pub async fn customize_get_lobby_bg_state(
    installation_id: String,
    center: State<'_, ExtensionCenter>,
) -> HubResult<LobbyBgState> {
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let root = extension_center::game_root(&game)?;
    tauri::async_runtime::spawn_blocking(move || scan_lobby_bg_state(&root))
        .await
        .map_err(|_| err("LOBBY_BG", "读取主页背景状态失败。"))?
}

#[tauri::command]
pub async fn customize_save_lobby_bg_config(
    installation_id: String,
    config: LobbyBgSidecarConfig,
    center: State<'_, ExtensionCenter>,
) -> HubResult<LobbyBgState> {
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let root = extension_center::game_root(&game)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut clean = config.sanitized();
        clean.updated_at = unix_ms_now();
        let lobby_dir = root.join(LOBBY_BG_DIR_NAME);
        fs::create_dir_all(&lobby_dir).map_err(|e| err("LOBBY_BG", e.to_string()))?;
        let sidecar = lobby_dir.join(LOBBY_BG_SIDECAR_NAME);
        let bytes = serde_json::to_vec_pretty(&clean).map_err(|e| err("LOBBY_BG", e.to_string()))?;
        write_atomic_json(&sidecar, &bytes)?;
        scan_lobby_bg_state(&root)
    })
    .await
    .map_err(|_| err("LOBBY_BG", "保存主页背景设置失败。"))?
}

#[tauri::command]
pub async fn customize_import_lobby_bg_media(
    installation_id: String,
    source_paths: Vec<String>,
    center: State<'_, ExtensionCenter>,
) -> HubResult<LobbyBgState> {
    if source_paths.is_empty() {
        return Err(err("INVALID_INPUT", "未选择任何背景文件。"));
    }
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let root = extension_center::game_root(&game)?;
    tauri::async_runtime::spawn_blocking(move || {
        let lobby_dir = root.join(LOBBY_BG_DIR_NAME);
        fs::create_dir_all(&lobby_dir).map_err(|e| err("LOBBY_BG", e.to_string()))?;

        let mut last_imported = String::new();
        for raw in source_paths {
            let src = PathBuf::from(raw.trim());
            if !src.is_file() {
                continue;
            }
            let meta = fs::metadata(&src).map_err(|e| err("LOBBY_BG", e.to_string()))?;
            if meta.len() == 0 || meta.len() > MAX_MEDIA_BYTES {
                return Err(err("FILE_TOO_LARGE", "单个主页背景文件不能超过 512 MB。"));
            }
            let Some(file_name) = src.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !is_single_safe_filename(file_name) || classify_lobby_bg_ext(file_name).is_none() {
                return Err(err(
                    "UNSUPPORTED_FORMAT",
                    format!("不支持的主页背景格式：{file_name}（仅支持 PNG/JPG/WebP/BMP、MP4/WebM/MOV/M4V、USM、.bundle）。"),
                ));
            }
            let dest = lobby_dir.join(file_name);
            fs::copy(&src, &dest).map_err(|e| err("LOBBY_BG", format!("复制背景失败: {e}")))?;
            last_imported = file_name.to_string();
        }

        if last_imported.is_empty() {
            return Err(err("INVALID_INPUT", "所选文件均不存在或格式不支持。"));
        }

        let sidecar = lobby_dir.join(LOBBY_BG_SIDECAR_NAME);
        let mut cfg = read_sidecar_config(&sidecar);
        cfg.enabled = true;
        cfg.selected_file = last_imported;
        cfg.updated_at = unix_ms_now();
        let bytes = serde_json::to_vec_pretty(&cfg).map_err(|e| err("LOBBY_BG", e.to_string()))?;
        write_atomic_json(&sidecar, &bytes)?;

        scan_lobby_bg_state(&root)
    })
    .await
    .map_err(|_| err("LOBBY_BG", "导入主页背景失败。"))?
}

#[tauri::command]
pub async fn customize_delete_lobby_bg_media(
    installation_id: String,
    file_name: String,
    center: State<'_, ExtensionCenter>,
) -> HubResult<LobbyBgState> {
    if !is_single_safe_filename(&file_name) || classify_lobby_bg_ext(&file_name).is_none() {
        return Err(err("INVALID_INPUT", "无效的背景文件名。"));
    }
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let root = extension_center::game_root(&game)?;
    tauri::async_runtime::spawn_blocking(move || {
        let lobby_dir = root.join(LOBBY_BG_DIR_NAME);
        let target = lobby_dir.join(file_name.trim());
        if target.is_file() {
            fs::remove_file(&target).map_err(|e| err("LOBBY_BG", e.to_string()))?;
        }
        let sidecar = lobby_dir.join(LOBBY_BG_SIDECAR_NAME);
        if sidecar.is_file() {
            let mut cfg = read_sidecar_config(&sidecar);
            if cfg.selected_file.eq_ignore_ascii_case(file_name.trim()) {
                cfg.selected_file.clear();
                cfg.updated_at = unix_ms_now();
                if let Ok(bytes) = serde_json::to_vec_pretty(&cfg) {
                    let _ = write_atomic_json(&sidecar, &bytes);
                }
            }
        }
        scan_lobby_bg_state(&root)
    })
    .await
    .map_err(|_| err("LOBBY_BG", "删除主页背景失败。"))?
}

#[tauri::command]
pub async fn customize_open_lobby_bg_dir(
    installation_id: String,
    center: State<'_, ExtensionCenter>,
) -> HubResult<()> {
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let root = extension_center::game_root(&game)?;
    let lobby_dir = root.join(LOBBY_BG_DIR_NAME);
    fs::create_dir_all(&lobby_dir).map_err(|e| err("LOBBY_BG", e.to_string()))?;
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg(&lobby_dir)
            .spawn()
            .map_err(|e| err("OPEN_DIR", e.to_string()))?;
    }
    Ok(())
}

fn parse_registry_font_name(raw_key: &str) -> (String, String, String) {
    let cleaned = raw_key
        .replace("(TrueType)", "")
        .replace("(OpenType)", "")
        .replace("(All res)", "")
        .trim()
        .to_string();
    let lower = cleaned.to_ascii_lowercase();
    let style = if lower.contains("bold") {
        "粗体"
    } else if lower.contains("light") || lower.contains("thin") {
        "细体"
    } else if lower.contains("medium") {
        "中等"
    } else {
        "常规"
    };
    let family = cleaned
        .split('&')
        .next()
        .unwrap_or(&cleaned)
        .trim()
        .to_string();
    (family, cleaned, style.to_string())
}

fn is_likely_cjk_font(name: &str, file_path: &str) -> bool {
    if name.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c)) {
        return true;
    }
    let combined = format!("{} {}", name.to_ascii_lowercase(), file_path.to_ascii_lowercase());
    const CJK_HINTS: &[&str] = &[
        "yahei", "simsun", "simhei", "kaiti", "fangsong", "dengxian", "noto sans sc",
        "noto serif sc", "source han", "alibaba", "puhuiti", "harmonyos", "pingfang",
        "hiragino", "meiryo", "yu gothic", "malgun", "msyh", "msjh", "sarasa", "lxgw",
        "wenquanyi", "fz", "founder", "si yuan", "思源", "黑体", "宋体", "楷体", "仿宋",
        "雅黑", "等线", "苹方", "霞鹜", "鸿蒙", "普惠",
    ];
    CJK_HINTS.iter().any(|h| combined.contains(h))
}

#[cfg(windows)]
fn collect_windows_fonts() -> Vec<SystemFontEntry> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let subkey = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";
    let mut map: BTreeMap<String, SystemFontEntry> = BTreeMap::new();
    let roots = [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER];

    for hive in roots {
        let Ok(key) = RegKey::predef(hive).open_subkey(subkey) else {
            continue;
        };
        for (name, value) in key.enum_values().flatten() {
            let file_path = value.to_string().trim().to_string();
            let lower_file = file_path.to_ascii_lowercase();
            if !(lower_file.ends_with(".ttf")
                || lower_file.ends_with(".otf")
                || lower_file.ends_with(".ttc"))
            {
                continue;
            }
            let (family, display_name, style_label) = parse_registry_font_name(&name);
            if family.is_empty() || family.starts_with('@') {
                continue;
            }
            let likely_cjk = is_likely_cjk_font(&display_name, &file_path);
            let dedupe_key = format!("{}::{}", family.to_ascii_lowercase(), style_label);
            map.entry(dedupe_key).or_insert(SystemFontEntry {
                family,
                display_name,
                file_path,
                style_label,
                likely_cjk,
            });
        }
    }

    let mut list: Vec<SystemFontEntry> = map.into_values().collect();
    list.sort_by(|a, b| {
        b.likely_cjk
            .cmp(&a.likely_cjk)
            .then_with(|| a.display_name.to_ascii_lowercase().cmp(&b.display_name.to_ascii_lowercase()))
    });
    list
}

#[cfg(not(windows))]
fn collect_windows_fonts() -> Vec<SystemFontEntry> {
    Vec::new()
}

#[tauri::command]
pub async fn customize_list_system_fonts() -> HubResult<Vec<SystemFontEntry>> {
    tauri::async_runtime::spawn_blocking(collect_windows_fonts)
        .await
        .map_err(|_| err("FONTS", "枚举系统字体失败。"))
}

fn tuning_state_path(app: &AppHandle, installation_id: &str) -> HubResult<PathBuf> {
    let safe_id: String = installation_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '_' })
        .collect();
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| err("DATA_DIR", "无法定位应用数据目录。"))?
        .join("customize");
    Ok(dir.join(format!("tuning_{safe_id}.json")))
}

#[tauri::command]
pub async fn customize_get_tuning_state(
    app: AppHandle,
    installation_id: String,
    center: State<'_, ExtensionCenter>,
) -> HubResult<CustomizeTuningState> {
    let _ = extension_center::get_game(&center.db, &installation_id)?;
    let path = tuning_state_path(&app, &installation_id)?;
    let state = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<CustomizeTuningState>(&raw).ok())
        .unwrap_or_default();
    Ok(state)
}

#[tauri::command]
pub async fn customize_save_tuning_state(
    app: AppHandle,
    installation_id: String,
    mut state: CustomizeTuningState,
    center: State<'_, ExtensionCenter>,
) -> HubResult<CustomizeTuningState> {
    let game = extension_center::get_game(&center.db, &installation_id)?;
    let root = extension_center::game_root(&game)?;
    state.home_ui_debug.custom_hud_opacity = state.home_ui_debug.custom_hud_opacity.clamp(30, 100);
    state.updated_at = unix_ms_now();
    let app_path = tuning_state_path(&app, &installation_id)?;
    let bytes = serde_json::to_vec_pretty(&state).map_err(|e| err("TUNING", e.to_string()))?;
    write_atomic_json(&app_path, &bytes)?;

    let game_debug_path = root.join(CUSTOMIZE_DEBUG_FILENAME);
    let _ = write_atomic_json(&game_debug_path, &bytes);
    Ok(state)
}

fn launcher_bg_dir(app: &AppHandle) -> HubResult<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| err("DATA_DIR", "无法定位应用数据目录。"))?
        .join("customize")
        .join("launcher_bg"))
}

fn read_launcher_bg_info(dir: &Path) -> LauncherBgInfo {
    let Ok(entries) = fs::read_dir(dir) else {
        return LauncherBgInfo {
            has_image: false,
            file_name: None,
            data_url: None,
        };
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        let mime = image_mime_for_ext(ext);
        if mime == "application/octet-stream" {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        if bytes.len() as u64 > MAX_LAUNCHER_BG_BYTES {
            continue;
        }
        return LauncherBgInfo {
            has_image: true,
            file_name: path.file_name().and_then(|n| n.to_str()).map(ToString::to_string),
            data_url: Some(format!("data:{mime};base64,{}", BASE64.encode(bytes))),
        };
    }
    LauncherBgInfo {
        has_image: false,
        file_name: None,
        data_url: None,
    }
}

#[tauri::command]
pub async fn customize_get_launcher_bg(app: AppHandle) -> HubResult<LauncherBgInfo> {
    let dir = launcher_bg_dir(&app)?;
    Ok(read_launcher_bg_info(&dir))
}

#[tauri::command]
pub async fn customize_save_launcher_bg(
    app: AppHandle,
    source_path: String,
) -> HubResult<LauncherBgInfo> {
    let src = PathBuf::from(source_path.trim());
    if !src.is_file() {
        return Err(err("INVALID_INPUT", "所选背景图片不存在。"));
    }
    let meta = fs::metadata(&src).map_err(|e| err("LAUNCHER_BG", e.to_string()))?;
    if meta.len() == 0 || meta.len() > MAX_LAUNCHER_BG_BYTES {
        return Err(err("FILE_TOO_LARGE", "启动器背景图片不能超过 32 MB。"));
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if image_mime_for_ext(&ext) == "application/octet-stream" {
        return Err(err("UNSUPPORTED_FORMAT", "仅支持 PNG / JPG / WebP / BMP 图片作为启动器背景。"));
    }
    let dir = launcher_bg_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| err("LAUNCHER_BG", e.to_string()))?;
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let _ = fs::remove_file(p);
            }
        }
    }
    let dest = dir.join(format!("background.{ext}"));
    fs::copy(&src, &dest).map_err(|e| err("LAUNCHER_BG", e.to_string()))?;
    Ok(read_launcher_bg_info(&dir))
}

#[tauri::command]
pub async fn customize_clear_launcher_bg(app: AppHandle) -> HubResult<LauncherBgInfo> {
    let dir = launcher_bg_dir(&app)?;
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let _ = fs::remove_file(p);
            }
        }
    }
    Ok(LauncherBgInfo {
        has_image: false,
        file_name: None,
        data_url: None,
    })
}

fn decode_uri_component(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            let val = u8::from_str_radix(hex, 16).ok()?;
            out.push(val);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn media_mime_for_filename(name: &str) -> Option<&'static str> {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())?
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"),
        "m4v" => Some("video/x-m4v"),
        "wmv" => Some("video/x-ms-wmv"),
        _ => None,
    }
}

fn parse_lobby_media_route(uri_path: &str) -> Option<(String, String, &'static str)> {
    let trimmed = uri_path.strip_prefix('/')?;
    let (raw_id, raw_file) = trimmed.split_once('/')?;
    if raw_id.is_empty()
        || raw_id.len() > 100
        || !raw_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return None;
    }
    let decoded_file = decode_uri_component(raw_file)?;
    if !is_single_safe_filename(&decoded_file) {
        return None;
    }
    let mime = media_mime_for_filename(&decoded_file)?;
    Some((raw_id.to_string(), decoded_file, mime))
}

fn parse_http_range(header: &str, total_len: u64) -> Option<(u64, u64)> {
    if total_len == 0 {
        return None;
    }
    let spec = header.trim().strip_prefix("bytes=")?;
    let first = spec.split(',').next()?.trim();
    let (start_s, end_s) = first.split_once('-')?;
    if start_s.is_empty() {
        let suffix: u64 = end_s.trim().parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = total_len.saturating_sub(suffix);
        Some((start, total_len - 1))
    } else {
        let start: u64 = start_s.trim().parse().ok()?;
        if start >= total_len {
            return None;
        }
        let end = if end_s.trim().is_empty() {
            (start + (4 * 1024 * 1024 - 1)).min(total_len - 1)
        } else {
            end_s.trim().parse::<u64>().ok()?.min(total_len - 1)
        };
        if end < start {
            return None;
        }
        Some((start, end))
    }
}

pub(crate) fn respond_lobby_media(
    ctx: UriSchemeContext<'_, Wry>,
    request: http::Request<Vec<u8>>,
    response: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let method = request.method().clone();
        if method != http::Method::GET && method != http::Method::HEAD {
            if let Ok(resp) = http::Response::builder()
                .status(http::StatusCode::METHOD_NOT_ALLOWED)
                .body(Vec::new())
            {
                response.respond(resp);
            }
            return;
        }
        let range_header = request
            .headers()
            .get(http::header::RANGE)
            .and_then(|v| v.to_str().ok())
            .map(ToString::to_string);
        let parsed = parse_lobby_media_route(request.uri().path());
        let resp_res = match parsed {
            None => http::Response::builder()
                .status(http::StatusCode::NOT_FOUND)
                .body(Vec::new()),
            Some((id, file_name, mime)) => {
                let target_path = {
                    let center = app.state::<ExtensionCenter>();
                    extension_center::get_game(&center.db, &id)
                        .and_then(|game| extension_center::game_root(&game))
                        .map(|root| root.join(LOBBY_BG_DIR_NAME).join(&file_name))
                        .ok()
                };
                match target_path {
                    Some(path) if path.is_file() => {
                        let read_res = tauri::async_runtime::spawn_blocking(move || -> std::io::Result<(u64, Option<(u64, u64)>, Vec<u8>)> {
                            let mut file = fs::File::open(&path)?;
                            let total = file.metadata()?.len();
                            if total > MAX_MEDIA_BYTES {
                                return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "too large"));
                            }
                            if let Some(rh) = range_header.as_deref() {
                                if let Some((start, end)) = parse_http_range(rh, total) {
                                    let len = (end - start + 1).min(8 * 1024 * 1024) as usize;
                                    let clamped_end = start + len as u64 - 1;
                                    let mut buf = vec![0u8; len];
                                    if method != http::Method::HEAD {
                                        file.seek(SeekFrom::Start(start))?;
                                        file.read_exact(&mut buf)?;
                                    } else {
                                        buf.clear();
                                    }
                                    return Ok((total, Some((start, clamped_end)), buf));
                                }
                            }
                            if method == http::Method::HEAD {
                                return Ok((total, None, Vec::new()));
                            }
                            let mut buf = Vec::with_capacity(total.min(32 * 1024 * 1024) as usize);
                            file.read_to_end(&mut buf)?;
                            Ok((total, None, buf))
                        })
                        .await
                        .ok()
                        .and_then(|r| r.ok());

                        match read_res {
                            Some((total, Some((start, end)), bytes)) => http::Response::builder()
                                .status(http::StatusCode::PARTIAL_CONTENT)
                                .header("Content-Type", mime)
                                .header("Accept-Ranges", "bytes")
                                .header("Content-Range", format!("bytes {start}-{end}/{total}"))
                                .header("Content-Length", (end - start + 1).to_string())
                                .header("Cache-Control", "no-cache")
                                .header("X-Content-Type-Options", "nosniff")
                                .header("Access-Control-Allow-Origin", "http://tauri.localhost")
                                .body(bytes),
                            Some((total, None, bytes)) => http::Response::builder()
                                .status(http::StatusCode::OK)
                                .header("Content-Type", mime)
                                .header("Accept-Ranges", "bytes")
                                .header("Content-Length", total.to_string())
                                .header("Cache-Control", "no-cache")
                                .header("X-Content-Type-Options", "nosniff")
                                .header("Access-Control-Allow-Origin", "http://tauri.localhost")
                                .body(bytes),
                            None => http::Response::builder()
                                .status(http::StatusCode::NOT_FOUND)
                                .body(Vec::new()),
                        }
                    }
                    _ => http::Response::builder()
                        .status(http::StatusCode::NOT_FOUND)
                        .body(Vec::new()),
                }
            }
        };
        if let Ok(resp) = resp_res {
            response.respond(resp);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_guard_blocks_traversal_and_hidden_files() {
        assert!(is_single_safe_filename("lobby_video.mp4"));
        assert!(is_single_safe_filename("碧蓝航线.usm"));
        assert!(!is_single_safe_filename("../secret.png"));
        assert!(!is_single_safe_filename("sub/file.png"));
        assert!(!is_single_safe_filename("..\\file.png"));
        assert!(!is_single_safe_filename(".hidden.png"));
        assert!(!is_single_safe_filename("~temp.mp4"));
        assert!(!is_single_safe_filename("bad:name.png"));
    }

    #[test]
    fn sidecar_config_sanitizes_bounds_and_roundtrips() {
        let raw = LobbyBgSidecarConfig {
            enabled: true,
            selected_file: "demo.mp4".to_string(),
            sync_sub_panels: true,
            random_on_lobby: false,
            fill_mode: "INVALID".to_string(),
            brightness: 4.5,
            speed: 0.1,
            muted: false,
            volume: 2.0,
            mute_vanilla_bgm: true,
            updated_at: 42,
        };
        let clean = raw.sanitized();
        assert_eq!(clean.fill_mode, "cover");
        assert!((clean.brightness - 1.0).abs() < 1e-5);
        assert!((clean.speed - 0.5).abs() < 1e-5);
        assert!((clean.volume - 1.0).abs() < 1e-5);

        let json = serde_json::to_string(&clean).unwrap();
        let decoded: LobbyBgSidecarConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.selected_file, "demo.mp4");
        assert!(decoded.mute_vanilla_bgm);
    }

    #[test]
    fn registry_font_parser_extracts_family_and_cjk_hint() {
        let (fam, disp, style) = parse_registry_font_name("Microsoft YaHei Bold & Microsoft YaHei UI Bold (TrueType)");
        assert_eq!(fam, "Microsoft YaHei Bold");
        assert!(disp.contains("Microsoft YaHei"));
        assert_eq!(style, "粗体");
        assert!(is_likely_cjk_font(&disp, "msyhbd.ttc"));
        assert!(!is_likely_cjk_font("Consolas", "consola.ttf"));
    }

    #[test]
    fn lobby_media_route_and_http_range_validation() {
        let ok = parse_lobby_media_route("/steam_cn/demo%20bg.mp4").unwrap();
        assert_eq!(ok.0, "steam_cn");
        assert_eq!(ok.1, "demo bg.mp4");
        assert_eq!(ok.2, "video/mp4");

        assert!(parse_lobby_media_route("/steam_cn/..%2Fsecret.png").is_none());
        assert!(parse_lobby_media_route("/steam_cn/evil.exe").is_none());
        assert!(parse_lobby_media_route("/bad:id/test.png").is_none());

        assert_eq!(parse_http_range("bytes=0-1023", 5000), Some((0, 1023)));
        assert_eq!(parse_http_range("bytes=1000-", 2000), Some((1000, 1999)));
        assert_eq!(parse_http_range("bytes=-500", 2000), Some((1500, 1999)));
        assert_eq!(parse_http_range("bytes=3000-4000", 2000), None);
    }
}
