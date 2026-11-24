//! Pure-Rust offline game encyclopedia mod inspector and UnityFS Texture2D preview decoder.
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::domain::error::{HubError, HubResult};
use crate::extension_center::{game_root, get_game, ExtensionCenter};
use crate::security::hash::compute_file_sha256;
use crate::security::path_guard::PathGuard;

const MAX_BUNDLE_SCAN_BYTES: u64 = 160 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES: usize = 192 * 1024 * 1024;
const MAX_PREVIEW_DIM: u32 = 512;
const META_CACHE_VERSION: u32 = 1;
const TEX_CACHE_VERSION: &str = "v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncyclopediaInstalledMod {
    pub mod_id: String,
    pub mod_name: String,
    pub source: String,
    pub enabled: bool,
    pub asset_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncyclopediaAssetOverride {
    pub kind: String,
    pub entity_id: String,
    pub slot: Option<String>,
    pub asset_name: String,
    pub mod_id: String,
    pub mod_name: String,
    pub source: String,
    pub enabled: bool,
    pub bundle_path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncyclopediaModOverridesReport {
    pub installation_id: String,
    pub installed_mods: Vec<EncyclopediaInstalledMod>,
    pub overrides: Vec<EncyclopediaAssetOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedBundleMeta {
    version: u32,
    assets: Vec<CachedAssetMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedAssetMeta {
    asset_name: String,
    kind: String,
    entity_id: String,
    slot: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkshopReceiptFileLite {
    index: usize,
    target: String,
    mod_sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkshopReceiptLite {
    mod_id: String,
    name: String,
    #[serde(default)]
    install_kind: String,
    phase: String,
    #[serde(default)]
    files: Vec<WorkshopReceiptFileLite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DroppedReceiptFileLite {
    index: usize,
    target: String,
    mod_sha256: String,
    #[serde(default)]
    is_catalog: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DroppedReceiptLite {
    mod_id: String,
    name: String,
    phase: String,
    #[serde(default)]
    files: Vec<DroppedReceiptFileLite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyReceiptLite {
    item_id: String,
    phase: String,
}

#[derive(Deserialize)]
struct LegacyCatalogLite {
    items: Vec<LegacyCatalogItemLite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyCatalogItemLite {
    id: String,
    name: String,
    #[serde(default)]
    files: Vec<LegacyCatalogFileLite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyCatalogFileLite {
    target: String,
    sha256: String,
    #[serde(default)]
    assets: Vec<String>,
}

fn cache_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("mod-preview-cache");
    let _ = fs::create_dir_all(&dir);
    Some(dir)
}

fn sanitize_cache_key(input: &str) -> String {
    let mut out = String::with_capacity(input.len().min(64));
    for c in input.chars().take(64) {
        if c.is_ascii_alphanumeric() || matches!(c, '_' | '-') {
            out.push(c);
        } else {
            out.push('_');
        }
    }
    out
}

fn to_rel_forward(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    Some(rel.to_string_lossy().replace('\\', "/"))
}

fn first_numeric_segment<'a>(parts: impl Iterator<Item = &'a str>) -> Option<String> {
    for part in parts {
        if part.len() >= 2 && part.bytes().all(|b| b.is_ascii_digit()) {
            return Some(part.to_string());
        }
    }
    None
}

pub fn classify_asset_name(raw_name: &str) -> Option<(String, String, String)> {
    let trimmed = raw_name.trim();
    if trimmed.is_empty() {
        return None;
    }
    let stem = ["png", "jpg", "jpeg", "webp", "bundle", "asset"]
        .iter()
        .find_map(|ext| {
            let suffix = format!(".{ext}");
            if trimmed.to_ascii_lowercase().ends_with(&suffix) {
                Some(&trimmed[..trimmed.len() - suffix.len()])
            } else {
                None
            }
        })
        .unwrap_or(trimmed);

    let lower = stem.to_ascii_lowercase();
    if let Some(tail) = lower.strip_prefix("ut_handcard_") {
        let entity = first_numeric_segment(tail.split('_')).unwrap_or_else(|| tail.to_string());
        return Some(("card".to_string(), entity, "card".to_string()));
    }
    if let Some(tail) = lower.strip_prefix("ut_ialtart_") {
        let entity = first_numeric_segment(tail.split('_')).unwrap_or_else(|| tail.to_string());
        return Some(("card".to_string(), entity, "alt_art".to_string()));
    }
    if let Some(tail) = lower.strip_prefix("ut_card_") {
        let entity = first_numeric_segment(tail.split('_')).unwrap_or_else(|| tail.to_string());
        return Some(("card".to_string(), entity, "card".to_string()));
    }
    if let Some(tail) = lower.strip_prefix("ut_hero_") {
        let mut parts = tail.split('_');
        let first = parts.next().unwrap_or("");
        let (slot, entity) = if first.bytes().all(|b| b.is_ascii_digit()) && !first.is_empty() {
            ("hero".to_string(), first.to_string())
        } else {
            let entity = first_numeric_segment(parts).unwrap_or_else(|| tail.to_string());
            (first.to_string(), entity)
        };
        return Some(("character".to_string(), entity, slot));
    }
    if let Some(tail) = lower.strip_prefix("ut_accountheadshot_") {
        let entity = first_numeric_segment(tail.split('_')).unwrap_or_else(|| tail.to_string());
        return Some(("character".to_string(), entity, "headshot".to_string()));
    }
    if let Some(tail) = lower.strip_prefix("ut_item_emoji_") {
        let entity = first_numeric_segment(tail.split('_')).unwrap_or_else(|| tail.to_string());
        return Some(("character".to_string(), entity, "emote".to_string()));
    }
    for prefix in ["ut_relic_", "ut_item_chip_", "ut_chip_"] {
        if lower.starts_with(prefix) {
            return Some(("chip".to_string(), stem[prefix.len()..].to_string(), "chip".to_string()));
        }
    }
    if let Some(tail) = lower.strip_prefix("ut_mappreview_") {
        return Some(("map".to_string(), tail.to_string(), "preview".to_string()));
    }
    if let Some(tail) = lower.strip_prefix("ut_mapscene_") {
        return Some(("map".to_string(), tail.to_string(), "scene".to_string()));
    }
    if let Some(tail) = lower.strip_prefix("ut_map_") {
        return Some(("map".to_string(), tail.to_string(), "map".to_string()));
    }
    if let Some(tail) = lower.strip_prefix("ut_mutator_") {
        return Some(("map".to_string(), tail.to_string(), "mutator".to_string()));
    }
    None
}

fn scan_bundle_assets_cached(bundle_abs: &Path, sha256: &str, cache_root: Option<&Path>) -> Vec<CachedAssetMeta> {
    if let Some(dir) = cache_root {
        if !sha256.is_empty() {
            let meta_path = dir.join(format!("meta-{}.json", sanitize_cache_key(sha256)));
            if let Ok(raw) = fs::read(&meta_path) {
                if let Ok(parsed) = serde_json::from_slice::<CachedBundleMeta>(&raw) {
                    if parsed.version == META_CACHE_VERSION {
                        return parsed.assets;
                    }
                }
            }
        }
    }

    let Ok(meta) = fs::metadata(bundle_abs) else {
        return Vec::new();
    };
    if meta.len() > MAX_BUNDLE_SCAN_BYTES {
        return Vec::new();
    }
    let Ok(raw) = fs::read(bundle_abs) else {
        return Vec::new();
    };
    let names = extract_texture_names_from_bundle(&raw).unwrap_or_default();
    let mut assets = Vec::new();
    let mut seen = HashSet::new();
    for asset_name in names {
        let Some((kind, entity_id, slot)) = classify_asset_name(&asset_name) else {
            continue;
        };
        let key = format!("{kind}:{asset_name}");
        if seen.insert(key) {
            assets.push(CachedAssetMeta {
                asset_name,
                kind,
                entity_id,
                slot,
            });
        }
    }

    if let Some(dir) = cache_root {
        if !sha256.is_empty() {
            let meta_path = dir.join(format!("meta-{}.json", sanitize_cache_key(sha256)));
            if let Ok(bytes) = serde_json::to_vec(&CachedBundleMeta {
                version: META_CACHE_VERSION,
                assets: assets.clone(),
            }) {
                let _ = fs::write(meta_path, bytes);
            }
        }
    }

    assets
}

fn collect_bundle_overrides(
    root: &Path,
    bundle_abs: &Path,
    mod_id: &str,
    mod_name: &str,
    source: &str,
    enabled: bool,
    sha_hint: &str,
    cache_root: Option<&Path>,
    out: &mut Vec<EncyclopediaAssetOverride>,
) -> usize {
    if !bundle_abs.is_file() {
        return 0;
    }
    let Some(bundle_rel) = to_rel_forward(root, bundle_abs) else {
        return 0;
    };
    let sha256 = if !sha_hint.is_empty() {
        sha_hint.to_string()
    } else {
        compute_file_sha256(bundle_abs).unwrap_or_default()
    };
    let assets = scan_bundle_assets_cached(bundle_abs, &sha256, cache_root);
    let mut count = 0usize;
    for asset in assets {
        count += 1;
        out.push(EncyclopediaAssetOverride {
            kind: asset.kind,
            entity_id: asset.entity_id,
            slot: Some(asset.slot),
            asset_name: asset.asset_name,
            mod_id: mod_id.to_string(),
            mod_name: mod_name.to_string(),
            source: source.to_string(),
            enabled,
            bundle_path: bundle_rel.clone(),
            sha256: sha256.clone(),
        });
    }
    count
}

#[tauri::command]
pub async fn get_encyclopedia_mod_overrides(
    installation_id: String,
    center: State<'_, ExtensionCenter>,
    app: AppHandle,
) -> HubResult<EncyclopediaModOverridesReport> {
    let game = get_game(&center.db, &installation_id)?;
    let root = game_root(&game)?;
    let cache_root = cache_dir(&app);

    let mut installed_mods: Vec<EncyclopediaInstalledMod> = Vec::new();
    let mut overrides: Vec<EncyclopediaAssetOverride> = Vec::new();

    // 1. Workshop receipts
    let workshop_dir = PathGuard::ensure_within_root(
        &root,
        &root.join(".xingshu-mods").join("workshop-receipts"),
    )?;
    if workshop_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&workshop_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                let Ok(raw) = fs::read(&path) else { continue };
                let Ok(rec) = serde_json::from_slice::<WorkshopReceiptLite>(&raw) else { continue };
                if !matches!(rec.phase.as_str(), "installed" | "disabled") {
                    continue;
                }
                let enabled = rec.phase == "installed";
                let mut asset_count = 0usize;
                for f in &rec.files {
                    if !f.target.to_ascii_lowercase().ends_with(".bundle") {
                        continue;
                    }
                    let candidate = if enabled {
                        PathGuard::sanitize_relative_path(&f.target)
                            .ok()
                            .and_then(|rel| PathGuard::ensure_within_root(&root, &root.join(rel)).ok())
                    } else {
                        crate::workshop::payload_file_path(&root, &rec.mod_id, f.index).ok()
                    };
                    if let Some(bundle_abs) = candidate {
                        let fallback_payload = crate::workshop::payload_file_path(&root, &rec.mod_id, f.index).ok();
                        let actual = if bundle_abs.is_file() {
                            bundle_abs
                        } else if let Some(fb) = fallback_payload {
                            fb
                        } else {
                            continue;
                        };
                        asset_count += collect_bundle_overrides(
                            &root,
                            &actual,
                            &rec.mod_id,
                            &rec.name,
                            "workshop",
                            enabled,
                            &f.mod_sha256,
                            cache_root.as_deref(),
                            &mut overrides,
                        );
                    }
                }
                if asset_count > 0 || !rec.files.is_empty() {
                    installed_mods.push(EncyclopediaInstalledMod {
                        mod_id: rec.mod_id,
                        mod_name: rec.name,
                        source: if rec.install_kind == "xspkg" { "official".to_string() } else { "workshop".to_string() },
                        enabled,
                        asset_count,
                    });
                }
            }
        }
    }

    // 2. Dropped/local imported mod receipts
    let dropped_dir = PathGuard::ensure_within_root(
        &root,
        &root.join(".xingshu-mods").join("dropped-receipts"),
    )?;
    if dropped_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&dropped_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                let Ok(raw) = fs::read(&path) else { continue };
                let Ok(rec) = serde_json::from_slice::<DroppedReceiptLite>(&raw) else { continue };
                if !matches!(rec.phase.as_str(), "installed" | "disabled") {
                    continue;
                }
                let enabled = rec.phase == "installed";
                let mut asset_count = 0usize;
                for f in &rec.files {
                    if f.is_catalog || !f.target.to_ascii_lowercase().ends_with(".bundle") {
                        continue;
                    }
                    let candidate = if enabled {
                        PathGuard::sanitize_relative_path(&f.target)
                            .ok()
                            .and_then(|rel| PathGuard::ensure_within_root(&root, &root.join(rel)).ok())
                    } else {
                        crate::dropped_mods::payload_file_path(&root, &rec.mod_id, f.index).ok()
                    };
                    if let Some(bundle_abs) = candidate {
                        let fallback_payload = crate::dropped_mods::payload_file_path(&root, &rec.mod_id, f.index).ok();
                        let actual = if bundle_abs.is_file() {
                            bundle_abs
                        } else if let Some(fb) = fallback_payload {
                            fb
                        } else {
                            continue;
                        };
                        asset_count += collect_bundle_overrides(
                            &root,
                            &actual,
                            &rec.mod_id,
                            &rec.name,
                            "dropped",
                            enabled,
                            &f.mod_sha256,
                            cache_root.as_deref(),
                            &mut overrides,
                        );
                    }
                }
                if asset_count > 0 || !rec.files.is_empty() {
                    installed_mods.push(EncyclopediaInstalledMod {
                        mod_id: rec.mod_id,
                        mod_name: rec.name,
                        source: "dropped".to_string(),
                        enabled,
                        asset_count,
                    });
                }
            }
        }
    }

    // 3. Legacy ModLibrary receipts
    let legacy_dir = PathGuard::ensure_within_root(
        &root,
        &root.join(".xingshu-mods").join("receipts"),
    )?;
    if legacy_dir.is_dir() {
        let catalog: Option<LegacyCatalogLite> =
            serde_json::from_str(include_str!("mod_library.generated.json")).ok();
        let catalog_items: HashMap<String, LegacyCatalogItemLite> = catalog
            .map(|c| c.items.into_iter().map(|it| (it.id.clone(), it)).collect())
            .unwrap_or_default();
        if let Ok(entries) = fs::read_dir(&legacy_dir) {
            for entry in entries.flatten() {
                let rec_path = entry.path().join("receipt.json");
                if !rec_path.is_file() {
                    continue;
                }
                let Ok(raw) = fs::read(&rec_path) else { continue };
                let Ok(rec) = serde_json::from_slice::<LegacyReceiptLite>(&raw) else { continue };
                if rec.phase != "installed" {
                    continue;
                }
                let Some(item) = catalog_items.get(&rec.item_id) else {
                    continue;
                };
                let mut asset_count = 0usize;
                for f in &item.files {
                    if let Ok(rel) = PathGuard::sanitize_relative_path(&f.target) {
                        if let Ok(abs) = PathGuard::ensure_within_root(&root, &root.join(rel)) {
                            let added = collect_bundle_overrides(
                                &root,
                                &abs,
                                &item.id,
                                &item.name,
                                "legacy",
                                true,
                                &f.sha256,
                                cache_root.as_deref(),
                                &mut overrides,
                            );
                            if added > 0 {
                                asset_count += added;
                            } else if abs.is_file() {
                                let bundle_rel = to_rel_forward(&root, &abs).unwrap_or_default();
                                for raw_asset in &f.assets {
                                    let Some((kind, entity_id, slot)) = classify_asset_name(raw_asset) else {
                                        continue;
                                    };
                                    asset_count += 1;
                                    overrides.push(EncyclopediaAssetOverride {
                                        kind,
                                        entity_id,
                                        slot: Some(slot),
                                        asset_name: raw_asset.clone(),
                                        mod_id: item.id.clone(),
                                        mod_name: item.name.clone(),
                                        source: "legacy".to_string(),
                                        enabled: true,
                                        bundle_path: bundle_rel.clone(),
                                        sha256: f.sha256.clone(),
                                    });
                                }
                            }
                        }
                    }
                }
                installed_mods.push(EncyclopediaInstalledMod {
                    mod_id: item.id.clone(),
                    mod_name: item.name.clone(),
                    source: "legacy".to_string(),
                    enabled: true,
                    asset_count,
                });
            }
        }
    }

    // 4. Loose image overrides inside <game_root>/modimg/ (e.g. Android/PE compatible art pack)
    let modimg_dir = PathGuard::ensure_within_root(&root, &root.join("modimg"))?;
    if modimg_dir.is_dir() {
        let mut count = 0usize;
        if let Ok(entries) = fs::read_dir(&modimg_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();
                if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp") {
                    continue;
                }
                let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                    continue;
                };
                let Some((kind, entity_id, slot)) = classify_asset_name(stem) else {
                    continue;
                };
                let Some(rel) = to_rel_forward(&root, &path) else {
                    continue;
                };
                let sha256 = compute_file_sha256(&path).unwrap_or_default();
                count += 1;
                overrides.push(EncyclopediaAssetOverride {
                    kind,
                    entity_id,
                    slot: Some(slot),
                    asset_name: stem.to_string(),
                    mod_id: "local.modimg".to_string(),
                    mod_name: "本地 modimg 图片包".to_string(),
                    source: "modimg".to_string(),
                    enabled: true,
                    bundle_path: rel,
                    sha256,
                });
            }
        }
        if count > 0 {
            installed_mods.push(EncyclopediaInstalledMod {
                mod_id: "local.modimg".to_string(),
                mod_name: "本地 modimg 图片包".to_string(),
                source: "modimg".to_string(),
                enabled: true,
                asset_count: count,
            });
        }
    }

    Ok(EncyclopediaModOverridesReport {
        installation_id,
        installed_mods,
        overrides,
    })
}

#[tauri::command]
pub async fn get_mod_texture_preview(
    installation_id: String,
    bundle_path: String,
    asset_name: String,
    sha256: Option<String>,
    center: State<'_, ExtensionCenter>,
    app: AppHandle,
) -> HubResult<String> {
    let game = get_game(&center.db, &installation_id)?;
    let root = game_root(&game)?;
    let clean_rel = PathGuard::sanitize_relative_path(&bundle_path)?;
    let abs_path = PathGuard::ensure_within_root(&root, &root.join(&clean_rel))?;
    if !abs_path.is_file() {
        return Err(HubError::storage_error("未找到对应的 Mod 资源文件。"));
    }

    let ext = abs_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        let bytes = fs::read(&abs_path).map_err(|e| HubError::storage_error(e.to_string()))?;
        let mime = match ext.as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            _ => "image/png",
        };
        return Ok(format!("data:{mime};base64,{}", B64.encode(&bytes)));
    }

    if ext != "bundle" {
        return Err(HubError::invalid_manifest("不支持的 Mod 预览资源格式。"));
    }

    let resolved_sha = sha256
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| compute_file_sha256(&abs_path).unwrap_or_default());

    let cache_root = cache_dir(&app);
    if let Some(dir) = &cache_root {
        if !resolved_sha.is_empty() {
            let tex_cache = dir.join(format!(
                "tex-{TEX_CACHE_VERSION}-{}-{}.png",
                sanitize_cache_key(&resolved_sha),
                sanitize_cache_key(&asset_name)
            ));
            if let Ok(cached_png) = fs::read(&tex_cache) {
                return Ok(format!("data:image/png;base64,{}", B64.encode(&cached_png)));
            }
        }
    }

    let meta = fs::metadata(&abs_path).map_err(|e| HubError::storage_error(e.to_string()))?;
    if meta.len() > MAX_BUNDLE_SCAN_BYTES {
        return Err(HubError::security_violation("Bundle 体积超出预览解析上限。"));
    }
    let raw = fs::read(&abs_path).map_err(|e| HubError::storage_error(e.to_string()))?;
    let png_bytes = extract_texture_png_from_bundle(&raw, &asset_name)
        .map_err(|msg| HubError::storage_error(format!("解析贴图失败：{msg}")))?;

    if let Some(dir) = &cache_root {
        if !resolved_sha.is_empty() {
            let tex_cache = dir.join(format!(
                "tex-{TEX_CACHE_VERSION}-{}-{}.png",
                sanitize_cache_key(&resolved_sha),
                sanitize_cache_key(&asset_name)
            ));
            let _ = fs::write(tex_cache, &png_bytes);
        }
    }

    Ok(format!("data:image/png;base64,{}", B64.encode(&png_bytes)))
}

// =========================================================================
// Pure-Rust LZ4 Block Decompressor
// =========================================================================

pub fn lz4_decompress_block(src: &[u8], expected_len: usize) -> Result<Vec<u8>, String> {
    if expected_len > MAX_DECOMPRESSED_BYTES {
        return Err("LZ4 预期解压体积超出限制".to_string());
    }
    let mut out = Vec::with_capacity(expected_len);
    let mut ip = 0usize;

    while ip < src.len() {
        let token = src[ip];
        ip += 1;

        let mut lit_len = (token >> 4) as usize;
        if lit_len == 15 {
            loop {
                if ip >= src.len() {
                    return Err("LZ4 literal 长度越界".to_string());
                }
                let b = src[ip];
                ip += 1;
                lit_len = lit_len.saturating_add(b as usize);
                if b != 255 {
                    break;
                }
            }
        }

        if ip.saturating_add(lit_len) > src.len() {
            return Err("LZ4 literal 数据截断".to_string());
        }
        if out.len().saturating_add(lit_len) > MAX_DECOMPRESSED_BYTES {
            return Err("LZ4 解压超出内存上限".to_string());
        }
        out.extend_from_slice(&src[ip..ip + lit_len]);
        ip += lit_len;

        if ip >= src.len() {
            break;
        }
        if ip + 2 > src.len() {
            return Err("LZ4 match offset 截断".to_string());
        }
        let offset = u16::from_le_bytes([src[ip], src[ip + 1]]) as usize;
        ip += 2;
        if offset == 0 || offset > out.len() {
            return Err("LZ4 match offset 无效".to_string());
        }

        let mut match_len = ((token & 0x0f) as usize) + 4;
        if (token & 0x0f) == 15 {
            loop {
                if ip >= src.len() {
                    return Err("LZ4 match 长度越界".to_string());
                }
                let b = src[ip];
                ip += 1;
                match_len = match_len.saturating_add(b as usize);
                if b != 255 {
                    break;
                }
            }
        }
        if out.len().saturating_add(match_len) > MAX_DECOMPRESSED_BYTES {
            return Err("LZ4 match 展开超出内存上限".to_string());
        }
        for _ in 0..match_len {
            let b = out[out.len() - offset];
            out.push(b);
        }
    }

    Ok(out)
}

// =========================================================================
// UnityFS Archive & SerializedFile v22+ Parser
// =========================================================================

struct BinReader<'a> {
    data: &'a [u8],
    pos: usize,
    big_endian: bool,
}

impl<'a> BinReader<'a> {
    fn new(data: &'a [u8], big_endian: bool) -> Self {
        Self { data, pos: 0, big_endian }
    }

    fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.pos)
    }

    fn align(&mut self, boundary: usize) {
        let rem = self.pos % boundary;
        if rem != 0 {
            self.pos = self.pos.saturating_add(boundary - rem).min(self.data.len());
        }
    }

    fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.pos.saturating_add(n) > self.data.len() {
            return Err("二进制流读取越界".to_string());
        }
        let slice = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(slice)
    }

    fn read_u8(&mut self) -> Result<u8, String> {
        Ok(self.read_bytes(1)?[0])
    }

    fn read_u16(&mut self) -> Result<u16, String> {
        let b = self.read_bytes(2)?;
        Ok(if self.big_endian {
            u16::from_be_bytes([b[0], b[1]])
        } else {
            u16::from_le_bytes([b[0], b[1]])
        })
    }

    fn read_i16(&mut self) -> Result<i16, String> {
        Ok(self.read_u16()? as i16)
    }

    fn read_u32(&mut self) -> Result<u32, String> {
        let b = self.read_bytes(4)?;
        Ok(if self.big_endian {
            u32::from_be_bytes([b[0], b[1], b[2], b[3]])
        } else {
            u32::from_le_bytes([b[0], b[1], b[2], b[3]])
        })
    }

    fn read_i32(&mut self) -> Result<i32, String> {
        Ok(self.read_u32()? as i32)
    }

    fn read_u64(&mut self) -> Result<u64, String> {
        let b = self.read_bytes(8)?;
        Ok(if self.big_endian {
            u64::from_be_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
        } else {
            u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
        })
    }

    fn read_i64(&mut self) -> Result<i64, String> {
        Ok(self.read_u64()? as i64)
    }

    fn read_cstring(&mut self) -> Result<String, String> {
        let start = self.pos;
        while self.pos < self.data.len() {
            if self.data[self.pos] == 0 {
                let s = String::from_utf8_lossy(&self.data[start..self.pos]).into_owned();
                self.pos += 1;
                return Ok(s);
            }
            self.pos += 1;
        }
        Err("CString 缺少终止符".to_string())
    }

    fn read_len_string_aligned(&mut self) -> Result<String, String> {
        let len = self.read_i32()?;
        if len < 0 || (len as usize) > self.remaining() {
            return Err("Unity String 长度无效".to_string());
        }
        let s = String::from_utf8_lossy(self.read_bytes(len as usize)?).into_owned();
        self.align(4);
        Ok(s)
    }
}

struct FsBlock {
    u_size: u32,
    c_size: u32,
    flags: u16,
}

struct FsNode {
    offset: usize,
    size: usize,
    nflags: u32,
    path: String,
}

struct UnityFsParsed {
    format_ver: u32,
    player_ver: String,
    engine_ver: String,
    stream: Vec<u8>,
    nodes: Vec<FsNode>,
}

fn decompress_block_by_flags(data: &[u8], u_size: usize, comp: u32) -> Result<Vec<u8>, String> {
    if u_size > MAX_DECOMPRESSED_BYTES {
        return Err("Bundle 解压大小超出上限".to_string());
    }
    match comp {
        0 if data.len() == u_size => Ok(data.to_vec()),
        0 => Err("Bundle 数据块大小不匹配".to_string()),
        1 => {
            let mut output = Vec::with_capacity(u_size);
            let options = lzma_rs::decompress::Options {
                unpacked_size: lzma_rs::decompress::UnpackedSize::UseProvided(Some(u_size as u64)),
                memlimit: Some(32 * 1024 * 1024),
                ..Default::default()
            };
            lzma_rs::lzma_decompress_with_options(&mut &data[..], &mut output, &options)
                .map_err(|e| format!("Unity LZMA 解压失败：{e}"))?;
            if output.len() != u_size {
                return Err("Bundle 数据块大小不匹配".to_string());
            }
            Ok(output)
        }
        2 | 3 => lz4_decompress_block(data, u_size),
        other => Err(format!("不支持的 UnityFS 压缩格式: {other}")),
    }
}

fn parse_unityfs_header_and_nodes(
    data: &[u8],
) -> Result<(u32, String, String, usize, Vec<FsBlock>, Vec<FsNode>, usize), String> {
    if !data.starts_with(b"UnityFS\0") {
        return Err("不是有效的 UnityFS Bundle 文件".to_string());
    }
    let mut r = BinReader::new(data, true);
    r.pos = 8;
    let format_ver = r.read_u32()?;
    let player_ver = r.read_cstring()?;
    let engine_ver = r.read_cstring()?;
    if format_ver < 6 {
        return Err("仅支持 UnityFS v6+ 格式".to_string());
    }
    let _bundle_size = r.read_i64()?;
    let c_blocks_info_size = r.read_u32()? as usize;
    let u_blocks_info_size = r.read_u32()? as usize;
    let flags = r.read_u32()?;
    if format_ver >= 7 {
        r.align(16);
    }

    let blocks_info_at_end = (flags & 0x80) != 0;
    let comp = flags & 0x3f;
    let (blocks_info_compressed, blocks_start) = if blocks_info_at_end {
        if c_blocks_info_size > data.len() {
            return Err("Bundle blocks_info 长度越界".to_string());
        }
        (&data[data.len() - c_blocks_info_size..], r.pos)
    } else {
        let info = r.read_bytes(c_blocks_info_size)?;
        if (flags & 0x200) != 0 {
            r.align(16);
        }
        (info, r.pos)
    };

    let blocks_info = decompress_block_by_flags(blocks_info_compressed, u_blocks_info_size, comp)?;
    let mut br = BinReader::new(&blocks_info, true);
    let _hash = br.read_bytes(16)?;
    let block_count = br.read_i32()?;
    if block_count < 0 || block_count > 65536 {
        return Err("Bundle 分块数量异常".to_string());
    }
    let mut blocks = Vec::with_capacity(block_count as usize);
    for _ in 0..block_count {
        blocks.push(FsBlock {
            u_size: br.read_u32()?,
            c_size: br.read_u32()?,
            flags: br.read_u16()?,
        });
    }
    let node_count = br.read_i32()?;
    if node_count < 0 || node_count > 8192 {
        return Err("Bundle 目录节点数量异常".to_string());
    }
    let mut nodes = Vec::with_capacity(node_count as usize);
    let mut max_cab_end = 0usize;
    for _ in 0..node_count {
        let offset = usize::try_from(br.read_i64()?).map_err(|_| "Bundle 节点偏移无效".to_string())?;
        let size = usize::try_from(br.read_i64()?).map_err(|_| "Bundle 节点大小无效".to_string())?;
        let nflags = br.read_u32()?;
        let path = br.read_cstring()?;
        if !path.ends_with(".resS") {
            max_cab_end = max_cab_end.max(offset.saturating_add(size));
        }
        nodes.push(FsNode { offset, size, nflags, path });
    }

    Ok((format_ver, player_ver, engine_ver, blocks_start, blocks, nodes, max_cab_end))
}

fn parse_unityfs(data: &[u8], stop_after_cab_only: bool) -> Result<UnityFsParsed, String> {
    let (format_ver, player_ver, engine_ver, blocks_start, blocks, nodes, max_cab_end) =
        parse_unityfs_header_and_nodes(data)?;

    let mut stream = Vec::new();
    let mut cursor = blocks_start;
    for blk in &blocks {
        if stop_after_cab_only && stream.len() >= max_cab_end && max_cab_end > 0 {
            break;
        }
        let c_end = cursor.saturating_add(blk.c_size as usize);
        if c_end > data.len() || stream.len().saturating_add(blk.u_size as usize) > MAX_DECOMPRESSED_BYTES {
            return Err("Bundle block 数据越界".to_string());
        }
        let dec = decompress_block_by_flags(
            &data[cursor..c_end],
            blk.u_size as usize,
            (blk.flags & 0x3f) as u32,
        )?;
        stream.extend_from_slice(&dec);
        cursor = c_end;
    }

    Ok(UnityFsParsed { format_ver, player_ver, engine_ver, stream, nodes })
}

pub(crate) fn extract_bundle_cab_names(raw: &[u8]) -> Result<Vec<String>, String> {
    let (_, _, _, _, _, nodes, _) = parse_unityfs_header_and_nodes(raw)?;
    Ok(nodes
        .into_iter()
        .filter(|n| !n.path.ends_with(".resS") && !n.path.is_empty())
        .map(|n| n.path)
        .collect())
}

pub(crate) fn extract_bundle_cab_names_from_file(path: &std::path::Path) -> Result<(Vec<String>, bool), String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).map_err(|e| format!("打开 Bundle 失败: {e}"))?;
    let file_len = f.metadata().map_err(|e| format!("读取元数据失败: {e}"))?.len() as usize;
    let head_len = file_len.min(512);
    let mut head = vec![0u8; head_len];
    f.read_exact(&mut head).map_err(|e| format!("读取 Bundle 头部失败: {e}"))?;
    if !head.starts_with(b"UnityFS\0") {
        return Err("不是有效的 UnityFS Bundle 文件".to_string());
    }
    let mut r = BinReader::new(&head, true);
    r.pos = 8;
    let format_ver = r.read_u32()?;
    let _player_ver = r.read_cstring()?;
    let _engine_ver = r.read_cstring()?;
    if format_ver < 6 {
        return Err("仅支持 UnityFS v6+ 格式".to_string());
    }
    let _bundle_size = r.read_i64()?;
    let c_blocks_info_size = r.read_u32()? as usize;
    let u_blocks_info_size = r.read_u32()? as usize;
    let flags = r.read_u32()?;
    if format_ver >= 7 {
        r.align(16);
    }
    if c_blocks_info_size > 4 * 1024 * 1024 || u_blocks_info_size > 16 * 1024 * 1024 {
        return Err("Bundle blocks_info 大小异常".to_string());
    }
    let blocks_info_at_end = (flags & 0x80) != 0;
    let comp = flags & 0x3f;
    let mut info_buf = vec![0u8; c_blocks_info_size];
    if blocks_info_at_end {
        if c_blocks_info_size > file_len {
            return Err("Bundle blocks_info 长度越界".to_string());
        }
        f.seek(SeekFrom::End(-(c_blocks_info_size as i64)))
            .map_err(|e| format!("定位 Bundle 索引失败: {e}"))?;
        f.read_exact(&mut info_buf).map_err(|e| format!("读取 Bundle 索引失败: {e}"))?;
    } else {
        if r.pos.saturating_add(c_blocks_info_size) > file_len {
            return Err("Bundle blocks_info 长度越界".to_string());
        }
        f.seek(SeekFrom::Start(r.pos as u64))
            .map_err(|e| format!("定位 Bundle 索引失败: {e}"))?;
        f.read_exact(&mut info_buf).map_err(|e| format!("读取 Bundle 索引失败: {e}"))?;
    }

    let blocks_info = decompress_block_by_flags(&info_buf, u_blocks_info_size, comp)?;
    let mut br = BinReader::new(&blocks_info, true);
    let _hash = br.read_bytes(16)?;
    let block_count = br.read_i32()?;
    if block_count < 0 || block_count > 65536 {
        return Err("Bundle 分块数量异常".to_string());
    }
    for _ in 0..block_count {
        let _ = br.read_u32()?;
        let _ = br.read_u32()?;
        let _ = br.read_u16()?;
    }
    let node_count = br.read_i32()?;
    if node_count < 0 || node_count > 8192 {
        return Err("Bundle 目录节点数量异常".to_string());
    }
    let mut cabs = Vec::new();
    let mut has_ress = false;
    for _ in 0..node_count {
        let _ = br.read_i64()?;
        let _ = br.read_i64()?;
        let _ = br.read_u32()?;
        let path = br.read_cstring()?;
        if path.ends_with(".resS") {
            has_ress = true;
        } else if !path.is_empty() && !cabs.contains(&path) {
            cabs.push(path);
        }
    }
    Ok((cabs, has_ress))
}

#[derive(Clone)]
struct TypeNode {
    type_name: String,
    name: String,
    byte_size: i32,
    is_array: bool,
    align_after: bool,
    children: Vec<TypeNode>,
}

struct SerializedTypeEntry {
    class_id: i32,
    nodes: Vec<TypeNode>,
}

struct SerializedObjEntry {
    #[allow(dead_code)]
    path_id: i64,
    byte_start: usize,
    byte_size: usize,
    type_id: usize,
}

struct ParsedSerializedFile {
    version: u32,
    little_endian: bool,
    data_offset: usize,
    object_table_offset: usize,
    types: Vec<SerializedTypeEntry>,
    objects: Vec<SerializedObjEntry>,
}

const COMMON_STRINGS_DATA: &[(u32, &str)] = &[
    (0, "AABB"),
    (5, "AnimationClip"),
    (19, "AnimationCurve"),
    (34, "AnimationState"),
    (49, "Array"),
    (55, "Base"),
    (60, "BitField"),
    (69, "bitset"),
    (76, "bool"),
    (81, "char"),
    (86, "ColorRGBA"),
    (96, "Component"),
    (106, "data"),
    (111, "deque"),
    (117, "double"),
    (124, "dynamic_array"),
    (138, "FastPropertyName"),
    (155, "first"),
    (161, "float"),
    (167, "Font"),
    (172, "GameObject"),
    (183, "Generic Mono"),
    (196, "GradientNEW"),
    (208, "GUID"),
    (213, "GUIStyle"),
    (222, "int"),
    (226, "list"),
    (231, "long long"),
    (241, "map"),
    (245, "Matrix4x4f"),
    (256, "MdFour"),
    (263, "MonoBehaviour"),
    (277, "MonoScript"),
    (288, "m_ByteSize"),
    (299, "m_Curve"),
    (307, "m_EditorClassIdentifier"),
    (331, "m_EditorHideFlags"),
    (349, "m_Enabled"),
    (359, "m_ExtensionPtr"),
    (374, "m_GameObject"),
    (387, "m_Index"),
    (395, "m_IsArray"),
    (405, "m_IsStatic"),
    (416, "m_MetaFlag"),
    (427, "m_Name"),
    (434, "m_ObjectHideFlags"),
    (452, "m_PrefabInternal"),
    (469, "m_PrefabParentObject"),
    (490, "m_Script"),
    (499, "m_StaticEditorFlags"),
    (519, "m_Type"),
    (526, "m_Version"),
    (536, "Object"),
    (543, "pair"),
    (548, "PPtr<Component>"),
    (564, "PPtr<GameObject>"),
    (581, "PPtr<Material>"),
    (596, "PPtr<MonoBehaviour>"),
    (616, "PPtr<MonoScript>"),
    (633, "PPtr<Object>"),
    (646, "PPtr<Prefab>"),
    (659, "PPtr<Sprite>"),
    (672, "PPtr<TextAsset>"),
    (688, "PPtr<Texture>"),
    (702, "PPtr<Texture2D>"),
    (718, "PPtr<Transform>"),
    (734, "Prefab"),
    (741, "Quaternionf"),
    (753, "Rectf"),
    (759, "RectInt"),
    (767, "RectOffset"),
    (778, "second"),
    (785, "set"),
    (789, "short"),
    (795, "size"),
    (800, "SInt16"),
    (807, "SInt32"),
    (814, "SInt64"),
    (821, "SInt8"),
    (827, "staticvector"),
    (840, "string"),
    (847, "TextAsset"),
    (857, "TextMesh"),
    (866, "Texture"),
    (874, "Texture2D"),
    (884, "Transform"),
    (894, "TypelessData"),
    (907, "UInt16"),
    (914, "UInt32"),
    (921, "UInt64"),
    (928, "UInt8"),
    (934, "unsigned int"),
    (947, "unsigned long long"),
    (966, "unsigned short"),
    (981, "vector"),
    (988, "Vector2f"),
    (997, "Vector3f"),
    (1006, "Vector4f"),
    (1015, "m_ScriptingClassIdentifier"),
    (1042, "Gradient"),
    (1051, "Type*"),
    (1057, "int2_storage"),
    (1070, "int3_storage"),
    (1083, "BoundsInt"),
    (1093, "m_CorrespondingSourceObject"),
    (1121, "m_PrefabInstance"),
    (1138, "m_PrefabAsset"),
    (1152, "FileSize"),
    (1161, "Hash128"),
    (1169, "RenderingLayerMask"),
    (1188, "fixed_array"),
    (1200, "EntityId"),
    (1209, "LoadableObjectId"),
    (1226, "LoadableSceneId"),
];

fn resolve_tt_string(offset: u32, str_buf: &[u8]) -> String {
    if (offset & 0x8000_0000) != 0 {
        let key = offset & 0x7fff_ffff;
        if let Ok(idx) = COMMON_STRINGS_DATA.binary_search_by_key(&key, |(k, _)| *k) {
            return COMMON_STRINGS_DATA[idx].1.to_string();
        }
        return format!("common_{key}");
    }
    let idx = offset as usize;
    if idx >= str_buf.len() {
        return String::new();
    }
    let end = str_buf[idx..].iter().position(|&b| b == 0).unwrap_or(str_buf.len() - idx);
    String::from_utf8_lossy(&str_buf[idx..idx + end]).into_owned()
}

fn parse_typetree_blob(r: &mut BinReader<'_>, ver: u32) -> Result<Vec<TypeNode>, String> {
    let n_nodes = r.read_i32()? as usize;
    let str_sz = r.read_i32()? as usize;
    if n_nodes > 4096 || str_sz > 1_048_576 {
        return Err("TypeTree 节点规模异常".to_string());
    }
    struct FlatNode {
        level: u8,
        type_flags: u8,
        type_off: u32,
        name_off: u32,
        byte_size: i32,
        meta_flag: i32,
    }
    let mut flat = Vec::with_capacity(n_nodes);
    for _ in 0..n_nodes {
        let _node_ver = r.read_u16()?;
        let level = r.read_u8()?;
        let type_flags = r.read_u8()?;
        let type_off = r.read_u32()?;
        let name_off = r.read_u32()?;
        let byte_size = r.read_i32()?;
        let _index = r.read_i32()?;
        let meta_flag = r.read_i32()?;
        if ver >= 19 {
            let _ref_hash = r.read_u64()?;
        }
        flat.push(FlatNode {
            level,
            type_flags,
            type_off,
            name_off,
            byte_size,
            meta_flag,
        });
    }
    let str_buf = r.read_bytes(str_sz)?;

    let mut stack: Vec<(u8, TypeNode)> = Vec::new();
    let mut roots: Vec<TypeNode> = Vec::new();
    for item in flat {
        let type_name = resolve_tt_string(item.type_off, str_buf);
        let node = TypeNode {
            is_array: (item.type_flags & 0x01) != 0 || type_name == "Array",
            type_name,
            name: resolve_tt_string(item.name_off, str_buf),
            byte_size: item.byte_size,
            align_after: (item.meta_flag & 0x4000) != 0,
            children: Vec::new(),
        };
        while let Some((top_lvl, _)) = stack.last() {
            if *top_lvl >= item.level {
                let (_, finished) = stack.pop().unwrap();
                if let Some((_, parent)) = stack.last_mut() {
                    parent.children.push(finished);
                } else {
                    roots.push(finished);
                }
            } else {
                break;
            }
        }
        stack.push((item.level, node));
    }
    while let Some((_, finished)) = stack.pop() {
        if let Some((_, parent)) = stack.last_mut() {
            parent.children.push(finished);
        } else {
            roots.push(finished);
        }
    }
    Ok(roots)
}

fn parse_serialized_file(raw: &[u8]) -> Result<ParsedSerializedFile, String> {
    if raw.len() < 48 {
        return Err("SerializedFile 数据过短".to_string());
    }
    let mut hr = BinReader::new(raw, true);
    let _meta_sz = hr.read_u32()?;
    let _file_sz = hr.read_u32()?;
    let ver = hr.read_u32()?;
    let data_off_v1 = hr.read_u32()? as usize;
    let endian = hr.read_u8()?;
    let _reserved = hr.read_bytes(3)?;
    let data_offset = if ver >= 22 {
        let _large_meta = hr.read_u32()?;
        let _large_file = hr.read_i64()?;
        let large_data_off = hr.read_i64()? as usize;
        let _unk = hr.read_i64()?;
        large_data_off
    } else {
        data_off_v1
    };

    let little_endian = endian == 0;
    let mut mr = BinReader::new(raw, !little_endian);
    mr.pos = hr.pos;

    let _unity_ver = mr.read_cstring()?;
    let _target_platform = mr.read_i32()?;
    let enable_type_tree = mr.read_u8()? != 0;
    let type_count = mr.read_i32()?;
    if type_count < 0 || type_count > 16384 {
        return Err("SerializedFile 类型表大小异常".to_string());
    }

    let mut types = Vec::with_capacity(type_count as usize);
    for _ in 0..type_count {
        let class_id = mr.read_i32()?;
        let _is_stripped = mr.read_u8()?;
        let _script_idx = mr.read_i16()?;
        if class_id < 0 || (ver >= 16 && class_id == 114) {
            let _script_id = mr.read_bytes(16)?;
        }
        let _old_type_hash = mr.read_bytes(16)?;
        let nodes = if enable_type_tree {
            let tree = parse_typetree_blob(&mut mr, ver)?;
            if ver >= 21 {
                let dep_cnt = mr.read_i32()?;
                if dep_cnt < 0 || dep_cnt > 4096 {
                    return Err("TypeTree 依赖长度异常".to_string());
                }
                let _ = mr.read_bytes(dep_cnt as usize * 4)?;
            }
            tree
        } else {
            Vec::new()
        };
        types.push(SerializedTypeEntry { class_id, nodes });
    }

    let obj_count = mr.read_i32()?;
    if obj_count < 0 || obj_count > 100_000 {
        return Err("SerializedFile 对象数量异常".to_string());
    }
    if ver >= 14 {
        mr.align(4);
    }
    let object_table_offset = mr.pos;

    let mut objects = Vec::with_capacity(obj_count as usize);
    for _ in 0..obj_count {
        let path_id = mr.read_i64()?;
        let byte_start = if ver >= 22 {
            mr.read_i64()? as usize
        } else {
            mr.read_u32()? as usize
        };
        let byte_size = mr.read_u32()? as usize;
        let type_id = mr.read_i32()? as usize;
        objects.push(SerializedObjEntry {
            path_id,
            byte_start,
            byte_size,
            type_id,
        });
    }

    Ok(ParsedSerializedFile {
        version: ver,
        little_endian,
        data_offset,
        object_table_offset,
        types,
        objects,
    })
}

fn extract_texture_names_from_bundle(raw: &[u8]) -> Result<Vec<String>, String> {
    let fs_parsed = parse_unityfs(raw, true)?;
    let mut names = Vec::new();
    for node in &fs_parsed.nodes {
        if node.path.ends_with(".resS") || node.offset.saturating_add(node.size) > fs_parsed.stream.len() {
            continue;
        }
        let cab_raw = &fs_parsed.stream[node.offset..node.offset + node.size];
        let Ok(sf) = parse_serialized_file(cab_raw) else { continue };
        for obj in &sf.objects {
            let Some(ty) = sf.types.get(obj.type_id) else { continue };
            if ty.class_id != 28 {
                continue;
            }
            let start = sf.data_offset.saturating_add(obj.byte_start);
            let end = start.saturating_add(obj.byte_size);
            if end > cab_raw.len() {
                continue;
            }
            let mut or = BinReader::new(&cab_raw[start..end], !sf.little_endian);
            if let Ok(name) = or.read_len_string_aligned() {
                if !name.is_empty() {
                    names.push(name);
                }
            }
        }
    }
    Ok(names)
}

#[derive(Default)]
struct ParsedTexture2D {
    name: String,
    width: i32,
    height: i32,
    texture_format: i32,
    image_data: Vec<u8>,
    stream_offset: u64,
    stream_size: u32,
    stream_path: String,
}

fn read_node_recursive(
    r: &mut BinReader<'_>,
    node: &TypeNode,
    parent_name: &str,
    out: &mut ParsedTexture2D,
) -> Result<(), String> {
    if node.type_name == "string" {
        let s = r.read_len_string_aligned()?;
        if node.name == "m_Name" {
            out.name = s;
        } else if node.name == "path" && parent_name == "m_StreamData" {
            out.stream_path = s;
        }
        if node.align_after {
            r.align(4);
        }
        return Ok(());
    }

    if node.type_name == "TypelessData" {
        let len = r.read_i32()?;
        if len < 0 || (len as usize) > r.remaining() {
            return Err("Texture2D image data 长度越界".to_string());
        }
        let slice = r.read_bytes(len as usize)?;
        if node.name == "image data" {
            out.image_data = slice.to_vec();
        }
        if node.align_after {
            r.align(4);
        }
        return Ok(());
    }

    if node.is_array && node.children.len() >= 2 {
        let count = r.read_i32()?;
        if count < 0 || (count as usize) > r.remaining() {
            return Err("TypeTree Array 长度越界".to_string());
        }
        let elem = &node.children[1];
        if elem.children.is_empty() && elem.byte_size > 0 {
            let skip = (count as usize).saturating_mul(elem.byte_size as usize);
            let _ = r.read_bytes(skip)?;
            if elem.align_after {
                r.align(4);
            }
        } else {
            for _ in 0..count {
                read_node_recursive(r, elem, &node.name, out)?;
            }
        }
        if node.align_after {
            r.align(4);
        }
        return Ok(());
    }

    if node.children.is_empty() {
        let sz = if node.byte_size > 0 { node.byte_size as usize } else { 0 };
        match node.name.as_str() {
            "m_Width" => out.width = r.read_i32()?,
            "m_Height" => out.height = r.read_i32()?,
            "m_TextureFormat" => out.texture_format = r.read_i32()?,
            "offset" if parent_name == "m_StreamData" => out.stream_offset = r.read_u64()?,
            "size" if parent_name == "m_StreamData" => out.stream_size = r.read_u32()?,
            _ => {
                if sz > 0 {
                    let _ = r.read_bytes(sz)?;
                }
            }
        }
        if node.align_after {
            r.align(4);
        }
        return Ok(());
    }

    for child in &node.children {
        read_node_recursive(r, child, &node.name, out)?;
    }
    if node.align_after {
        r.align(4);
    }
    Ok(())
}

fn parse_texture2d_fallback_2022(obj_raw: &[u8], little_endian: bool) -> Result<ParsedTexture2D, String> {
    let mut r = BinReader::new(obj_raw, !little_endian);
    let mut out = ParsedTexture2D::default();
    out.name = r.read_len_string_aligned()?;
    let _forced_fallback = r.read_i32()?;
    let _downscale = r.read_u8()?;
    let _alpha_opt = r.read_u8()?;
    r.align(4);
    out.width = r.read_i32()?;
    out.height = r.read_i32()?;
    let _complete_sz = r.read_u32()?;
    let _mips_stripped = r.read_i32()?;
    out.texture_format = r.read_i32()?;
    let _mip_cnt = r.read_i32()?;
    let _is_readable = r.read_u8()?;
    let _is_pre = r.read_u8()?;
    let _ignore_mip = r.read_u8()?;
    r.align(4);
    let _mip_group = r.read_len_string_aligned()?;
    let _streaming = r.read_u8()?;
    r.align(4);
    let _priority = r.read_i32()?;
    let _img_cnt = r.read_i32()?;
    let _dim = r.read_i32()?;
    let _gl_settings = r.read_bytes(24)?;
    let _lightmap = r.read_i32()?;
    let _colorspace = r.read_i32()?;
    let blob_len = r.read_i32()?.max(0) as usize;
    let _ = r.read_bytes(blob_len)?;
    r.align(4);
    let img_len = r.read_i32()?;
    if img_len < 0 || (img_len as usize) > r.remaining() {
        return Err("Fallback Texture2D image len 越界".to_string());
    }
    out.image_data = r.read_bytes(img_len as usize)?.to_vec();
    r.align(4);
    if r.remaining() >= 16 {
        out.stream_offset = r.read_u64()?;
        out.stream_size = r.read_u32()?;
        out.stream_path = r.read_len_string_aligned().unwrap_or_default();
    }
    Ok(out)
}

pub fn extract_texture_png_from_bundle(raw: &[u8], target_asset_name: &str) -> Result<Vec<u8>, String> {
    let (w, h, pixels) = extract_texture_rgba(raw, target_asset_name)?;
    let (w, h, pixels) = downscale_max_dim(w, h, &pixels, MAX_PREVIEW_DIM);
    encode_rgba_png(w, h, &pixels)
}

pub(crate) fn extract_texture_full_png_from_bundle(raw: &[u8], target_asset_name: &str) -> Result<Vec<u8>, String> {
    let (w, h, pixels) = extract_texture_rgba(raw, target_asset_name)?;
    encode_rgba_png(w, h, &pixels)
}

#[derive(Debug, Clone, Default)]
pub(crate) struct BundleContentSummary {
    pub texture_names: Vec<String>,
    pub monobehaviour_names: Vec<String>,
    pub cab_names: Vec<String>,
    pub asset_bundle_names: Vec<String>,
    pub other_object_count: usize,
    pub has_text_asset: bool,
    pub has_astral_runtime_dll: bool,
    pub has_apenc_drm: bool,
}

fn contains_apenc_magic(slice: &[u8]) -> bool {
    let head = &slice[..slice.len().min(4096)];
    head.windows(7).any(|w| w == b"APENC01")
}

fn extract_monobehaviour_name(obj_raw: &[u8], little_endian: bool) -> Result<String, String> {
    if obj_raw.len() < 28 {
        return Err("MonoBehaviour 数据长度不足 28 字节".to_string());
    }
    let mut r = BinReader::new(&obj_raw[28..], !little_endian);
    r.read_len_string_aligned()
}

pub(crate) fn inspect_bundle_contents(raw: &[u8]) -> Result<BundleContentSummary, String> {
    let fs_parsed = parse_unityfs(raw, true)?;
    let mut summary = BundleContentSummary::default();
    let mut parsed_cab_count = 0usize;

    for node in &fs_parsed.nodes {
        if !node.path.ends_with(".resS") && !node.path.is_empty() && !summary.cab_names.contains(&node.path) {
            summary.cab_names.push(node.path.clone());
        }
        if node.path.ends_with(".resS") || node.offset.saturating_add(node.size) > fs_parsed.stream.len() {
            continue;
        }
        let cab_raw = &fs_parsed.stream[node.offset..node.offset + node.size];
        let Ok(sf) = parse_serialized_file(cab_raw) else { continue };
        parsed_cab_count += 1;

        for obj in &sf.objects {
            let Some(ty) = sf.types.get(obj.type_id) else { continue };
            let start = sf.data_offset.saturating_add(obj.byte_start);
            let end = start.saturating_add(obj.byte_size);
            if end > cab_raw.len() {
                continue;
            }
            let obj_raw = &cab_raw[start..end];
            match ty.class_id {
                28 => {
                    let mut nr = BinReader::new(obj_raw, !sf.little_endian);
                    if let Ok(name) = nr.read_len_string_aligned() {
                        if !name.is_empty() && !summary.texture_names.contains(&name) {
                            summary.texture_names.push(name);
                        }
                    }
                }
                114 => {
                    if contains_apenc_magic(obj_raw) {
                        summary.has_apenc_drm = true;
                    }
                    if let Ok(name) = extract_monobehaviour_name(obj_raw, sf.little_endian) {
                        if !name.is_empty() && !summary.monobehaviour_names.contains(&name) {
                            summary.monobehaviour_names.push(name);
                        }
                    }
                }
                49 => {
                    summary.has_text_asset = true;
                    let mut nr = BinReader::new(obj_raw, !sf.little_endian);
                    if let Ok(name) = nr.read_len_string_aligned() {
                        if name.to_ascii_lowercase().contains("astralparty.runtime") {
                            summary.has_astral_runtime_dll = true;
                        }
                    }
                }
                142 => {
                    let mut nr = BinReader::new(obj_raw, !sf.little_endian);
                    if let Ok(ab_name) = nr.read_len_string_aligned() {
                        if !ab_name.is_empty() && !summary.asset_bundle_names.contains(&ab_name) {
                            summary.asset_bundle_names.push(ab_name);
                        }
                    }
                }
                _ => {
                    summary.other_object_count += 1;
                }
            }
        }
    }

    if parsed_cab_count == 0 {
        return Err("Bundle 中未包含可解析的 SerializedFile".to_string());
    }
    Ok(summary)
}

fn find_single_monobehaviour<'a>(
    fs_parsed: &'a UnityFsParsed,
    label: &str,
) -> Result<(usize, &'a [u8], ParsedSerializedFile, usize, &'a [u8], String), String> {
    let mut found: Option<(usize, &'a [u8], ParsedSerializedFile, usize, &'a [u8], String)> = None;
    let mut total_mb = 0usize;

    for (node_idx, node) in fs_parsed.nodes.iter().enumerate() {
        if node.path.ends_with(".resS") || node.offset.saturating_add(node.size) > fs_parsed.stream.len() {
            continue;
        }
        let cab_raw = &fs_parsed.stream[node.offset..node.offset + node.size];
        let Ok(sf) = parse_serialized_file(cab_raw) else { continue };
        for (obj_idx, obj) in sf.objects.iter().enumerate() {
            let Some(ty) = sf.types.get(obj.type_id) else { continue };
            if ty.class_id != 114 {
                continue;
            }
            total_mb += 1;
            let start = sf.data_offset.saturating_add(obj.byte_start);
            let end = start.saturating_add(obj.byte_size);
            if end > cab_raw.len() || obj.byte_size < 28 {
                return Err(format!("{label} MonoBehaviour 对象范围或头部无效"));
            }
            let obj_raw = &cab_raw[start..end];
            let name = extract_monobehaviour_name(obj_raw, sf.little_endian)?;
            if found.is_none() {
                found = Some((node_idx, cab_raw, sf, obj_idx, obj_raw, name));
                break;
            }
        }
    }

    if total_mb != 1 {
        return Err(format!("{label} 期望包含 1 个 MonoBehaviour，实际为 {total_mb} 个"));
    }
    found.ok_or_else(|| format!("{label} 未找到 MonoBehaviour"))
}

fn replace_object_in_unityfs(
    v_fs: &UnityFsParsed,
    v_node_idx: usize,
    v_cab: &[u8],
    v_sf: &ParsedSerializedFile,
    target_obj_idx: usize,
    new_obj_raw: &[u8],
) -> Result<Vec<u8>, String> {
    let stride = if v_sf.version >= 22 { 24usize } else { 20usize };
    let table_end = v_sf
        .object_table_offset
        .checked_add(v_sf.objects.len().saturating_mul(stride))
        .ok_or_else(|| "SerializedFile 对象表大小溢出".to_string())?;
    if table_end > v_sf.data_offset || v_sf.data_offset > v_cab.len() {
        return Err("原版 CAB SerializedFile 对象表越界".to_string());
    }

    let mut order: Vec<usize> = (0..v_sf.objects.len()).collect();
    order.sort_by_key(|&i| v_sf.objects[i].byte_start);

    let mut new_cab = v_cab[..v_sf.data_offset].to_vec();
    for &idx in &order {
        let obj = &v_sf.objects[idx];
        let old_abs_start = v_sf.data_offset.saturating_add(obj.byte_start);
        let old_abs_end = old_abs_start.saturating_add(obj.byte_size);
        if old_abs_end > v_cab.len() {
            return Err("原版 CAB 对象数据越界".to_string());
        }
        while (new_cab.len() - v_sf.data_offset) % 8 != 0 {
            new_cab.push(0);
        }
        let new_rel_start = new_cab.len() - v_sf.data_offset;
        let new_size = if idx == target_obj_idx {
            new_cab.extend_from_slice(new_obj_raw);
            new_obj_raw.len()
        } else {
            new_cab.extend_from_slice(&v_cab[old_abs_start..old_abs_end]);
            obj.byte_size
        };

        let entry_off = v_sf.object_table_offset + idx * stride;
        let write_u32 = |buf: &mut [u8], pos: usize, val: u32, le: bool| {
            buf[pos..pos + 4].copy_from_slice(&if le { val.to_le_bytes() } else { val.to_be_bytes() });
        };
        let write_i64 = |buf: &mut [u8], pos: usize, val: i64, le: bool| {
            buf[pos..pos + 8].copy_from_slice(&if le { val.to_le_bytes() } else { val.to_be_bytes() });
        };
        if v_sf.version >= 22 {
            write_i64(&mut new_cab, entry_off + 8, new_rel_start as i64, v_sf.little_endian);
            write_u32(&mut new_cab, entry_off + 16, u32::try_from(new_size).map_err(|_| "CAB 对象超过 4GB".to_string())?, v_sf.little_endian);
        } else {
            write_u32(&mut new_cab, entry_off + 8, u32::try_from(new_rel_start).map_err(|_| "CAB 偏移超过 4GB".to_string())?, v_sf.little_endian);
            write_u32(&mut new_cab, entry_off + 12, u32::try_from(new_size).map_err(|_| "CAB 对象超过 4GB".to_string())?, v_sf.little_endian);
        }
    }

    let new_cab_len = new_cab.len();
    if v_sf.version >= 22 {
        new_cab[24..32].copy_from_slice(&(new_cab_len as i64).to_be_bytes());
        if new_cab[4..8] != [0, 0, 0, 0] && new_cab_len <= u32::MAX as usize {
            new_cab[4..8].copy_from_slice(&(new_cab_len as u32).to_be_bytes());
        }
    } else {
        let len_u32 = u32::try_from(new_cab_len).map_err(|_| "CAB 文件超过 32 位大小上限".to_string())?;
        new_cab[4..8].copy_from_slice(&len_u32.to_be_bytes());
    }

    let mut new_stream = Vec::with_capacity(new_cab_len);
    let mut rebuilt_nodes = Vec::with_capacity(v_fs.nodes.len());
    for (idx, node) in v_fs.nodes.iter().enumerate() {
        let new_off = new_stream.len();
        let new_sz = if idx == v_node_idx {
            new_stream.extend_from_slice(&new_cab);
            new_cab.len()
        } else {
            let end = node.offset.saturating_add(node.size);
            if end > v_fs.stream.len() {
                return Err("原版 Bundle 节点数据越界".to_string());
            }
            new_stream.extend_from_slice(&v_fs.stream[node.offset..end]);
            node.size
        };
        rebuilt_nodes.push((new_off, new_sz, node.nflags, node.path.as_str()));
    }

    let stream_len_u32 = u32::try_from(new_stream.len()).map_err(|_| "重构 Bundle 数据流超出 4GB".to_string())?;
    let mut blocks_info = Vec::new();
    blocks_info.extend_from_slice(&[0u8; 16]);
    blocks_info.extend_from_slice(&1i32.to_be_bytes());
    blocks_info.extend_from_slice(&stream_len_u32.to_be_bytes());
    blocks_info.extend_from_slice(&stream_len_u32.to_be_bytes());
    blocks_info.extend_from_slice(&0x0040u16.to_be_bytes());
    blocks_info.extend_from_slice(&(rebuilt_nodes.len() as i32).to_be_bytes());
    for (no, ns, nf, npath) in rebuilt_nodes {
        blocks_info.extend_from_slice(&(no as i64).to_be_bytes());
        blocks_info.extend_from_slice(&(ns as i64).to_be_bytes());
        blocks_info.extend_from_slice(&nf.to_be_bytes());
        blocks_info.extend_from_slice(npath.as_bytes());
        blocks_info.push(0);
    }

    let blocks_info_u32 = u32::try_from(blocks_info.len()).map_err(|_| "blocks_info 过大".to_string())?;
    let mut out = Vec::with_capacity(128 + blocks_info.len() + new_stream.len());
    out.extend_from_slice(b"UnityFS\0");
    out.extend_from_slice(&v_fs.format_ver.to_be_bytes());
    out.extend_from_slice(v_fs.player_ver.as_bytes());
    out.push(0);
    out.extend_from_slice(v_fs.engine_ver.as_bytes());
    out.push(0);
    let sz_pos = out.len();
    out.extend_from_slice(&0i64.to_be_bytes());
    out.extend_from_slice(&blocks_info_u32.to_be_bytes());
    out.extend_from_slice(&blocks_info_u32.to_be_bytes());
    out.extend_from_slice(&0x0040u32.to_be_bytes());
    if v_fs.format_ver >= 7 {
        while out.len() % 16 != 0 {
            out.push(0);
        }
    }
    out.extend_from_slice(&blocks_info);
    out.extend_from_slice(&new_stream);
    let total_len = out.len() as i64;
    out[sz_pos..sz_pos + 8].copy_from_slice(&total_len.to_be_bytes());
    Ok(out)
}

pub(crate) fn migrate_single_monobehaviour_bundle(vanilla_raw: &[u8], mod_raw: &[u8]) -> Result<Vec<u8>, String> {
    let v_fs = parse_unityfs(vanilla_raw, false)?;
    let m_fs = parse_unityfs(mod_raw, false)?;

    let (v_node_idx, v_cab, v_sf, v_mb_idx, v_mb_raw, v_name) =
        find_single_monobehaviour(&v_fs, "原版容器")?;
    let (_, _, _, _, m_mb_raw, m_name) = find_single_monobehaviour(&m_fs, "模组容器")?;

    if contains_apenc_magic(m_mb_raw) {
        return Err("检测到 APENC01 加密视频载体（不支持绕过官方加密）".to_string());
    }
    if v_name.is_empty() || !v_name.eq_ignore_ascii_case(&m_name) {
        return Err(format!(
            "MonoBehaviour 资产名不匹配：原版 '{v_name}' != 模组 '{m_name}'"
        ));
    }

    let mut replaced = Vec::with_capacity(28 + m_mb_raw.len().saturating_sub(28));
    replaced.extend_from_slice(&v_mb_raw[..28]);
    replaced.extend_from_slice(&m_mb_raw[28..]);
    replace_object_in_unityfs(&v_fs, v_node_idx, v_cab, &v_sf, v_mb_idx, &replaced)
}

pub(crate) fn extract_ascii_hex32_tokens(data: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut run_start: Option<usize> = None;
    for (i, &b) in data.iter().enumerate() {
        if b.is_ascii_hexdigit() {
            if run_start.is_none() {
                run_start = Some(i);
            }
        } else if let Some(s) = run_start.take() {
            if i - s == 32 {
                let tok = String::from_utf8_lossy(&data[s..i]).to_ascii_lowercase();
                if !out.contains(&tok) {
                    out.push(tok);
                }
            }
        }
    }
    if let Some(s) = run_start {
        if data.len() - s == 32 {
            let tok = String::from_utf8_lossy(&data[s..]).to_ascii_lowercase();
            if !out.contains(&tok) {
                out.push(tok);
            }
        }
    }
    out
}

pub(crate) fn extract_hex32_tokens_from_bundle(raw: &[u8]) -> Vec<String> {
    parse_unityfs(raw, true)
        .map(|fs| extract_ascii_hex32_tokens(&fs.stream))
        .unwrap_or_default()
}

pub(crate) fn patch_text_asset_in_bundle(
    vanilla_raw: &[u8],
    target_name: &str,
    new_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let v_fs = parse_unityfs(vanilla_raw, false)?;
    for (node_idx, node) in v_fs.nodes.iter().enumerate() {
        if node.path.ends_with(".resS") || node.offset.saturating_add(node.size) > v_fs.stream.len() {
            continue;
        }
        let cab_raw = &v_fs.stream[node.offset..node.offset + node.size];
        let Ok(sf) = parse_serialized_file(cab_raw) else { continue };
        for (obj_idx, obj) in sf.objects.iter().enumerate() {
            if sf.types.get(obj.type_id).is_none_or(|ty| ty.class_id != 49) {
                continue;
            }
            let start = sf.data_offset.saturating_add(obj.byte_start);
            let Some(obj_raw) = cab_raw.get(start..start.saturating_add(obj.byte_size)) else { continue };
            let mut r = BinReader::new(obj_raw, !sf.little_endian);
            let Ok(obj_name) = r.read_len_string_aligned() else { continue };
            if !obj_name.eq_ignore_ascii_case(target_name) {
                continue;
            }
            let nb = obj_name.as_bytes();
            let nb_len = u32::try_from(nb.len()).map_err(|_| "TextAsset 名称过长".to_string())?;
            let script_len = u32::try_from(new_bytes.len()).map_err(|_| "TextAsset 数据过大".to_string())?;
            let mut packed = Vec::with_capacity(16 + nb.len() + new_bytes.len());
            packed.extend_from_slice(&if sf.little_endian { nb_len.to_le_bytes() } else { nb_len.to_be_bytes() });
            packed.extend_from_slice(nb);
            while packed.len() % 4 != 0 {
                packed.push(0);
            }
            packed.extend_from_slice(&if sf.little_endian { script_len.to_le_bytes() } else { script_len.to_be_bytes() });
            packed.extend_from_slice(new_bytes);
            while packed.len() % 4 != 0 {
                packed.push(0);
            }
            return replace_object_in_unityfs(&v_fs, node_idx, cab_raw, &sf, obj_idx, &packed);
        }
    }
    Err(format!("Bundle 中未找到 TextAsset '{target_name}'"))
}

pub(crate) fn patch_wwise_bnk_in_monobehaviour_bundle(
    vanilla_raw: &[u8],
    mb_name: &str,
    new_wem: &[u8],
) -> Result<Vec<u8>, String> {
    if new_wem.len() < 12 || &new_wem[..4] != b"RIFF" {
        return Err("补丁音频不是有效的 Wwise RIFF WEM 文件".to_string());
    }
    let v_fs = parse_unityfs(vanilla_raw, false)?;
    for (node_idx, node) in v_fs.nodes.iter().enumerate() {
        if node.path.ends_with(".resS") || node.offset.saturating_add(node.size) > v_fs.stream.len() {
            continue;
        }
        let cab_raw = &v_fs.stream[node.offset..node.offset + node.size];
        let Ok(sf) = parse_serialized_file(cab_raw) else { continue };
        for (obj_idx, obj) in sf.objects.iter().enumerate() {
            if sf.types.get(obj.type_id).is_none_or(|ty| ty.class_id != 114) {
                continue;
            }
            let start = sf.data_offset.saturating_add(obj.byte_start);
            let Some(obj_raw) = cab_raw.get(start..start.saturating_add(obj.byte_size)) else { continue };
            if obj_raw.len() < 36 {
                continue;
            }
            let Ok(name) = extract_monobehaviour_name(obj_raw, sf.little_endian) else { continue };
            if !name.eq_ignore_ascii_case(mb_name) {
                continue;
            }
            let mut nr = BinReader::new(&obj_raw[28..], !sf.little_endian);
            let _ = nr.read_len_string_aligned()?;
            let bnk_len_off = 28 + nr.pos;
            if bnk_len_off + 4 > obj_raw.len() {
                continue;
            }
            let old_bnk_len = if sf.little_endian {
                u32::from_le_bytes(obj_raw[bnk_len_off..bnk_len_off + 4].try_into().unwrap())
            } else {
                u32::from_be_bytes(obj_raw[bnk_len_off..bnk_len_off + 4].try_into().unwrap())
            } as usize;
            let bnk_start = bnk_len_off + 4;
            let bnk_end = bnk_start.saturating_add(old_bnk_len);
            if bnk_end > obj_raw.len() {
                continue;
            }
            let old_bnk = &obj_raw[bnk_start..bnk_end];
            if old_bnk.len() < 8 || &old_bnk[..4] != b"BKHD" {
                continue;
            }
            let tail_start = (bnk_end + 3) & !3;
            let tail = if tail_start <= obj_raw.len() { &obj_raw[tail_start..] } else { &[] };

            // Parse BNK chunks
            let mut pos = 0usize;
            let mut chunks: Vec<([u8; 4], &[u8])> = Vec::new();
            while pos + 8 <= old_bnk.len() {
                let tag: [u8; 4] = old_bnk[pos..pos + 4].try_into().unwrap();
                let sz = u32::from_le_bytes(old_bnk[pos + 4..pos + 8].try_into().unwrap()) as usize;
                let end = pos + 8 + sz;
                if end > old_bnk.len() {
                    return Err("原版 Wwise SoundBank 区块越界".to_string());
                }
                chunks.push((tag, &old_bnk[pos + 8..end]));
                pos = end;
            }
            if pos != old_bnk.len() {
                return Err("原版 Wwise SoundBank 区块未对齐".to_string());
            }

            let didx_body = chunks
                .iter()
                .find(|(t, _)| t == b"DIDX")
                .map(|(_, b)| *b)
                .ok_or_else(|| "Wwise SoundBank 缺少 DIDX 区块".to_string())?;
            if didx_body.len() != 12 {
                return Err(format!("仅支持单音轨 DIDX BNK 替换，当前 entry 字节数={}", didx_body.len()));
            }
            let wem_id = u32::from_le_bytes(didx_body[0..4].try_into().unwrap());
            let wem_off = u32::from_le_bytes(didx_body[4..8].try_into().unwrap());
            let old_wem_sz = u32::from_le_bytes(didx_body[8..12].try_into().unwrap());
            if wem_off != 0 {
                return Err("Wwise DIDX WEM 起始偏移不为 0".to_string());
            }

            let new_wem_sz = u32::try_from(new_wem.len()).map_err(|_| "WEM 音频过大".to_string())?;
            let mut new_bnk = Vec::with_capacity(old_bnk.len() + new_wem.len());
            for (tag, body) in chunks {
                match &tag {
                    b"DIDX" => {
                        new_bnk.extend_from_slice(&tag);
                        new_bnk.extend_from_slice(&12u32.to_le_bytes());
                        new_bnk.extend_from_slice(&wem_id.to_le_bytes());
                        new_bnk.extend_from_slice(&0u32.to_le_bytes());
                        new_bnk.extend_from_slice(&new_wem_sz.to_le_bytes());
                    }
                    b"DATA" => {
                        new_bnk.extend_from_slice(&tag);
                        new_bnk.extend_from_slice(&new_wem_sz.to_le_bytes());
                        new_bnk.extend_from_slice(new_wem);
                    }
                    b"HIRC" => {
                        let mut h_buf = body.to_vec();
                        if h_buf.len() >= 4 {
                            let cnt = u32::from_le_bytes(h_buf[0..4].try_into().unwrap()) as usize;
                            let mut hp = 4usize;
                            let mut needle = [0u8; 8];
                            needle[..4].copy_from_slice(&wem_id.to_le_bytes());
                            needle[4..8].copy_from_slice(&old_wem_sz.to_le_bytes());
                            for _ in 0..cnt {
                                if hp + 5 > h_buf.len() {
                                    break;
                                }
                                let osz = u32::from_le_bytes(h_buf[hp + 1..hp + 5].try_into().unwrap()) as usize;
                                let oend = hp + 5 + osz;
                                if oend > h_buf.len() {
                                    break;
                                }
                                let mut s = hp + 5;
                                while s + 8 <= oend {
                                    if &h_buf[s..s + 8] == &needle {
                                        h_buf[s + 4..s + 8].copy_from_slice(&new_wem_sz.to_le_bytes());
                                        s += 8;
                                    } else {
                                        s += 1;
                                    }
                                }
                                hp = oend;
                            }
                        }
                        new_bnk.extend_from_slice(&tag);
                        new_bnk.extend_from_slice(&(h_buf.len() as u32).to_le_bytes());
                        new_bnk.extend_from_slice(&h_buf);
                    }
                    _ => {
                        new_bnk.extend_from_slice(&tag);
                        new_bnk.extend_from_slice(&(body.len() as u32).to_le_bytes());
                        new_bnk.extend_from_slice(body);
                    }
                }
            }

            let new_bnk_u32 = u32::try_from(new_bnk.len()).map_err(|_| "SoundBank 过大".to_string())?;
            let mut new_obj = Vec::with_capacity(bnk_start + new_bnk.len() + 4 + tail.len());
            new_obj.extend_from_slice(&obj_raw[..bnk_len_off]);
            new_obj.extend_from_slice(&if sf.little_endian { new_bnk_u32.to_le_bytes() } else { new_bnk_u32.to_be_bytes() });
            new_obj.extend_from_slice(&new_bnk);
            while (new_obj.len() - bnk_start) % 4 != 0 {
                new_obj.push(0);
            }
            new_obj.extend_from_slice(tail);

            return replace_object_in_unityfs(&v_fs, node_idx, cab_raw, &sf, obj_idx, &new_obj);
        }
    }
    Err(format!("Bundle 中未找到 Wwise SoundBank '{mb_name}'"))
}

// ---- Minimal Protobuf Wire Patcher (RML .patch.proto) ----

enum ProtoVal {
    Varint(u64),
    Fixed64([u8; 8]),
    Bytes(Vec<u8>),
    Fixed32([u8; 4]),
}

fn read_proto_varint(buf: &[u8], pos: &mut usize) -> Result<u64, String> {
    let mut val: u64 = 0;
    let mut shift = 0u32;
    loop {
        if *pos >= buf.len() || shift >= 64 {
            return Err("Protobuf varint 截断或溢出".to_string());
        }
        let b = buf[*pos];
        *pos += 1;
        val |= u64::from(b & 0x7f) << shift;
        if (b & 0x80) == 0 {
            return Ok(val);
        }
        shift += 7;
    }
}

fn push_proto_varint(out: &mut Vec<u8>, mut val: u64) {
    loop {
        let byte = (val & 0x7f) as u8;
        val >>= 7;
        if val == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

fn decode_proto_fields(buf: &[u8]) -> Result<Vec<(u32, ProtoVal)>, String> {
    let mut pos = 0usize;
    let mut fields = Vec::new();
    while pos < buf.len() {
        let tag = read_proto_varint(buf, &mut pos)?;
        let fn_num = u32::try_from(tag >> 3).map_err(|_| "Protobuf 字段号无效".to_string())?;
        let wt = (tag & 7) as u8;
        let val = match wt {
            0 => ProtoVal::Varint(read_proto_varint(buf, &mut pos)?),
            1 => {
                let end = pos.checked_add(8).filter(|&e| e <= buf.len()).ok_or_else(|| "Protobuf fixed64 越界".to_string())?;
                let mut arr = [0u8; 8];
                arr.copy_from_slice(&buf[pos..end]);
                pos = end;
                ProtoVal::Fixed64(arr)
            }
            2 => {
                let len = usize::try_from(read_proto_varint(buf, &mut pos)?).map_err(|_| "Protobuf len 溢出".to_string())?;
                let end = pos.checked_add(len).filter(|&e| e <= buf.len()).ok_or_else(|| "Protobuf bytes 越界".to_string())?;
                let v = buf[pos..end].to_vec();
                pos = end;
                ProtoVal::Bytes(v)
            }
            5 => {
                let end = pos.checked_add(4).filter(|&e| e <= buf.len()).ok_or_else(|| "Protobuf fixed32 越界".to_string())?;
                let mut arr = [0u8; 4];
                arr.copy_from_slice(&buf[pos..end]);
                pos = end;
                ProtoVal::Fixed32(arr)
            }
            _ => return Err(format!("不支持的 Protobuf wire type: {wt}")),
        };
        fields.push((fn_num, val));
    }
    Ok(fields)
}

fn encode_proto_fields(fields: &[(u32, ProtoVal)]) -> Vec<u8> {
    let mut out = Vec::new();
    for (fn_num, val) in fields {
        let wt: u64 = match val {
            ProtoVal::Varint(_) => 0,
            ProtoVal::Fixed64(_) => 1,
            ProtoVal::Bytes(_) => 2,
            ProtoVal::Fixed32(_) => 5,
        };
        push_proto_varint(&mut out, (u64::from(*fn_num) << 3) | wt);
        match val {
            ProtoVal::Varint(v) => push_proto_varint(&mut out, *v),
            ProtoVal::Fixed64(b) => out.extend_from_slice(b),
            ProtoVal::Bytes(b) => {
                push_proto_varint(&mut out, b.len() as u64);
                out.extend_from_slice(b);
            }
            ProtoVal::Fixed32(b) => out.extend_from_slice(b),
        }
    }
    out
}

fn set_proto_varint_path(
    msg_bytes: &[u8],
    tokens: &[(u32, Option<usize>)],
    new_val: u64,
) -> Result<Vec<u8>, String> {
    if tokens.is_empty() {
        return Err("Protobuf 补丁路径为空".to_string());
    }
    let mut fields = decode_proto_fields(msg_bytes)?;
    let (target_fn, target_idx) = tokens[0];
    let mut seen_idx = 0usize;
    let mut found = false;
    for (fn_num, val) in &mut fields {
        if *fn_num != target_fn {
            continue;
        }
        if let Some(want_idx) = target_idx {
            if seen_idx != want_idx {
                seen_idx += 1;
                continue;
            }
        }
        found = true;
        if tokens.len() == 1 {
            match val {
                ProtoVal::Varint(_) => *val = ProtoVal::Varint(new_val),
                _ => return Err(format!("Protobuf 字段 {target_fn} 不是 varint 类型")),
            }
        } else {
            match val {
                ProtoVal::Bytes(inner) => {
                    *inner = set_proto_varint_path(inner, &tokens[1..], new_val)?;
                }
                _ => return Err(format!("Protobuf 嵌套字段 {target_fn} 不是 length-delimited 类型")),
            }
        }
        break;
    }
    if !found {
        if tokens.len() == 1 {
            fields.push((target_fn, ProtoVal::Varint(new_val)));
        } else {
            return Err(format!("未找到 Protobuf 补丁路径字段 {target_fn}"));
        }
    }
    Ok(encode_proto_fields(&fields))
}

pub(crate) fn apply_rml_proto_patch(proto_bytes: &[u8], patch_text: &str) -> Result<Vec<u8>, String> {
    let mut cur = proto_bytes.to_vec();
    let mut applied = 0usize;
    for raw_line in patch_text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (lhs, rhs) = line
            .split_once('=')
            .ok_or_else(|| format!("无效的 .patch.proto 规则行: {line}"))?;
        let mut tokens = Vec::new();
        for part in lhs.trim().split('.') {
            if let Some((fstr, rest)) = part.split_once('[') {
                let istr = rest
                    .strip_suffix(']')
                    .ok_or_else(|| format!("无效的索引表达式: {part}"))?;
                let fn_num = fstr.parse::<u32>().map_err(|_| format!("无效字段号: {fstr}"))?;
                let idx = istr.parse::<usize>().map_err(|_| format!("无效下标: {istr}"))?;
                tokens.push((fn_num, Some(idx)));
            } else {
                let fn_num = part.parse::<u32>().map_err(|_| format!("无效字段号: {part}"))?;
                tokens.push((fn_num, None));
            }
        }
        let rhs_trim = rhs.trim();
        let new_val = if let Some(hex_s) = rhs_trim.strip_prefix("0x").or_else(|| rhs_trim.strip_prefix("0X")) {
            u64::from_str_radix(hex_s, 16).map_err(|_| format!("无效十六进制值: {rhs_trim}"))?
        } else {
            rhs_trim.parse::<u64>().map_err(|_| format!("无效数值: {rhs_trim}"))?
        };
        cur = set_proto_varint_path(&cur, &tokens, new_val)?;
        applied += 1;
    }
    if applied == 0 {
        return Err(".patch.proto 中不包含任何有效补丁规则".to_string());
    }
    Ok(cur)
}

pub(crate) fn extract_atlas_png(raw: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let (w, h, pixels) = extract_texture_rgba(raw, name)?;
    encode_rgba_png(w, h, &pixels)
}

pub(crate) fn extract_game_emote(raw: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let (w, h, pixels) = extract_texture_rgba(raw, name)?;
    const FRAME: usize = 168;
    let (w, h) = (w as usize, h as usize);
    if w % FRAME != 0 || h % FRAME != 0 || (w / FRAME) * (h / FRAME) > 256 {
        return Err("无法识别表情图集帧尺寸".into());
    }
    let mut frames = Vec::new();
    for y in (0..h).step_by(FRAME) {
        for x in (0..w).step_by(FRAME) {
            let frame: Vec<u8> = (y..y + FRAME)
                .flat_map(|row| &pixels[(row * w + x) * 4..(row * w + x + FRAME) * 4])
                .copied()
                .collect();
            if frame.chunks_exact(4).any(|pixel| pixel[3] != 0) {
                frames.push(frame);
            }
        }
    }
    if frames.len() < 2 {
        return Err("表情图集缺少动画帧".into());
    }
    let mut output = Vec::new();
    let mut encoder = png::Encoder::new(&mut output, FRAME as u32, FRAME as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_animated(frames.len() as u32, 0).map_err(|e| e.to_string())?;
    encoder.set_frame_delay(33, 1000).map_err(|e| e.to_string())?;
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    for frame in frames {
        writer.write_image_data(&frame).map_err(|e| e.to_string())?;
    }
    writer.finish().map_err(|e| e.to_string())?;
    Ok(output)
}

/// Read the one Addressables JSON TextAsset from the game's packaged fallback catalogue.
pub(crate) fn extract_addressables_json(raw: &[u8]) -> Result<Vec<u8>, String> {
    extract_text_asset(raw, "catalog")
}

pub(crate) fn extract_text_asset(raw: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let bundle = parse_unityfs(raw, true)?;
    for node in &bundle.nodes {
        if node.path.ends_with(".resS") {
            continue;
        }
        let Some(cab) = bundle.stream.get(node.offset..node.offset.saturating_add(node.size)) else { continue };
        let Ok(serialized) = parse_serialized_file(cab) else { continue };
        for object in &serialized.objects {
            if serialized.types.get(object.type_id).is_none_or(|ty| ty.class_id != 49) {
                continue;
            }
            let start = serialized.data_offset.saturating_add(object.byte_start);
            let Some(bytes) = cab.get(start..start.saturating_add(object.byte_size)) else { continue };
            let mut reader = BinReader::new(bytes, !serialized.little_endian);
            let Ok(obj_name) = reader.read_len_string_aligned() else { continue };
            if !obj_name.eq_ignore_ascii_case(name) {
                continue;
            }
            let Ok(size) = reader.read_u32() else { continue };
            if let Ok(content) = reader.read_bytes(size as usize) {
                return Ok(content.to_vec());
            }
        }
    }
    Err(format!("Bundle 中未找到资源 {name}"))
}

fn extract_texture_rgba(raw: &[u8], target_asset_name: &str) -> Result<(u32, u32, Vec<u8>), String> {
    let fs_parsed = parse_unityfs(raw, false)?;
    let target_lower = target_asset_name.trim().to_ascii_lowercase();

    for node in &fs_parsed.nodes {
        if node.path.ends_with(".resS") || node.offset.saturating_add(node.size) > fs_parsed.stream.len() {
            continue;
        }
        let cab_raw = &fs_parsed.stream[node.offset..node.offset + node.size];
        let Ok(sf) = parse_serialized_file(cab_raw) else { continue };
        for obj in &sf.objects {
            let Some(ty) = sf.types.get(obj.type_id) else { continue };
            if ty.class_id != 28 {
                continue;
            }
            let start = sf.data_offset.saturating_add(obj.byte_start);
            let end = start.saturating_add(obj.byte_size);
            if end > cab_raw.len() {
                continue;
            }
            let obj_raw = &cab_raw[start..end];
            let mut nr = BinReader::new(obj_raw, !sf.little_endian);
            let Ok(obj_name) = nr.read_len_string_aligned() else { continue };
            if obj_name.to_ascii_lowercase() != target_lower {
                continue;
            }

            let mut tex = ParsedTexture2D::default();
            if let Some(root_node) = ty.nodes.first() {
                let mut tr = BinReader::new(obj_raw, !sf.little_endian);
                read_node_recursive(&mut tr, root_node, "", &mut tex)?;
            } else {
                tex = parse_texture2d_fallback_2022(obj_raw, sf.little_endian)?;
            }

            let mut pixel_bytes = tex.image_data;
            if pixel_bytes.is_empty() && tex.stream_size > 0 && !tex.stream_path.is_empty() {
                let stream_base = tex
                    .stream_path
                    .rsplit('/')
                    .next()
                    .unwrap_or(&tex.stream_path)
                    .to_ascii_lowercase();
                if let Some(res_node) = fs_parsed.nodes.iter().find(|n| {
                    n.path
                        .rsplit('/')
                        .next()
                        .unwrap_or(&n.path)
                        .to_ascii_lowercase()
                        == stream_base
                }) {
                    let s_start = res_node.offset.saturating_add(tex.stream_offset as usize);
                    let s_end = s_start.saturating_add(tex.stream_size as usize);
                    if s_end <= fs_parsed.stream.len() {
                        pixel_bytes = fs_parsed.stream[s_start..s_end].to_vec();
                    }
                }
            }

            if tex.width <= 0 || tex.height <= 0 || pixel_bytes.is_empty() {
                return Err("Texture2D 像素数据为空".to_string());
            }

            let w = tex.width as u32;
            let h = tex.height as u32;
            if u64::from(w) * u64::from(h) > 16 * 1024 * 1024 {
                return Err("贴图像素尺寸超出解析上限".to_string());
            }
            let rgba_bottom_up = decode_texture_pixels(w, h, tex.texture_format, &pixel_bytes)?;
            let rgba_top_down = flip_vertical(w, h, &rgba_bottom_up);
            return Ok((w, h, rgba_top_down));
        }
    }

    Err(format!("Bundle 中未找到贴图 {target_asset_name}"))
}

// =========================================================================
// Pure-Rust Texture2D Pixel Decoders (RGB24, RGBA32, ARGB32, BGRA32, BC1, BC3, BC7)
// =========================================================================

fn decode_texture_pixels(w: u32, h: u32, fmt: i32, data: &[u8]) -> Result<Vec<u8>, String> {
    let pixel_count = (w as usize).saturating_mul(h as usize);
    let mut out = vec![0u8; pixel_count.saturating_mul(4)];
    match fmt {
        3 => {
            // RGB24
            if data.len() < pixel_count * 3 {
                return Err("RGB24 像素缓冲区不足".to_string());
            }
            for i in 0..pixel_count {
                out[i * 4] = data[i * 3];
                out[i * 4 + 1] = data[i * 3 + 1];
                out[i * 4 + 2] = data[i * 3 + 2];
                out[i * 4 + 3] = 255;
            }
        }
        4 => {
            // RGBA32
            if data.len() < pixel_count * 4 {
                return Err("RGBA32 像素缓冲区不足".to_string());
            }
            out.copy_from_slice(&data[..pixel_count * 4]);
        }
        5 => {
            // ARGB32
            if data.len() < pixel_count * 4 {
                return Err("ARGB32 像素缓冲区不足".to_string());
            }
            for i in 0..pixel_count {
                out[i * 4] = data[i * 4 + 1];
                out[i * 4 + 1] = data[i * 4 + 2];
                out[i * 4 + 2] = data[i * 4 + 3];
                out[i * 4 + 3] = data[i * 4];
            }
        }
        14 => {
            // BGRA32
            if data.len() < pixel_count * 4 {
                return Err("BGRA32 像素缓冲区不足".to_string());
            }
            for i in 0..pixel_count {
                out[i * 4] = data[i * 4 + 2];
                out[i * 4 + 1] = data[i * 4 + 1];
                out[i * 4 + 2] = data[i * 4];
                out[i * 4 + 3] = data[i * 4 + 3];
            }
        }
        10 => decode_bc_image(w, h, data, 8, &mut out, decode_bc1_block)?,
        12 => decode_bc_image(w, h, data, 16, &mut out, decode_bc3_block)?,
        25 => decode_bc_image(w, h, data, 16, &mut out, decode_bc7_block)?,
        other => return Err(format!("不支持的 Unity TextureFormat: {other}")),
    }
    Ok(out)
}

fn decode_bc_image(
    w: u32,
    h: u32,
    data: &[u8],
    block_bytes: usize,
    out: &mut [u8],
    decoder: fn(&[u8]) -> [[u8; 4]; 16],
) -> Result<(), String> {
    let bw = w.div_ceil(4) as usize;
    let bh = h.div_ceil(4) as usize;
    let need = bw.saturating_mul(bh).saturating_mul(block_bytes);
    if data.len() < need {
        return Err("BCn 压缩纹理数据长度不足".to_string());
    }
    for by in 0..bh {
        for bx in 0..bw {
            let offset = (by * bw + bx) * block_bytes;
            let pixels = decoder(&data[offset..offset + block_bytes]);
            for py in 0..4usize {
                let iy = by * 4 + py;
                if iy >= h as usize {
                    break;
                }
                for px in 0..4usize {
                    let ix = bx * 4 + px;
                    if ix >= w as usize {
                        break;
                    }
                    let dst = (iy * w as usize + ix) * 4;
                    out[dst..dst + 4].copy_from_slice(&pixels[py * 4 + px]);
                }
            }
        }
    }
    Ok(())
}

fn rgb565_to_rgba(c: u16) -> [u8; 4] {
    let r = ((c >> 11) & 0x1f) as u8;
    let g = ((c >> 5) & 0x3f) as u8;
    let b = (c & 0x1f) as u8;
    [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255]
}

fn decode_bc1_block(blk: &[u8]) -> [[u8; 4]; 16] {
    let c0_raw = u16::from_le_bytes([blk[0], blk[1]]);
    let c1_raw = u16::from_le_bytes([blk[2], blk[3]]);
    let bits = u32::from_le_bytes([blk[4], blk[5], blk[6], blk[7]]);
    let c0 = rgb565_to_rgba(c0_raw);
    let c1 = rgb565_to_rgba(c1_raw);
    let mut pal = [[0u8; 4]; 4];
    pal[0] = c0;
    pal[1] = c1;
    if c0_raw > c1_raw {
        for ch in 0..3 {
            pal[2][ch] = ((2 * c0[ch] as u16 + c1[ch] as u16 + 1) / 3) as u8;
            pal[3][ch] = ((c0[ch] as u16 + 2 * c1[ch] as u16 + 1) / 3) as u8;
        }
        pal[2][3] = 255;
        pal[3][3] = 255;
    } else {
        for ch in 0..3 {
            pal[2][ch] = ((c0[ch] as u16 + c1[ch] as u16) / 2) as u8;
        }
        pal[2][3] = 255;
        pal[3] = [0, 0, 0, 0];
    }
    let mut out = [[0u8; 4]; 16];
    for i in 0..16 {
        let idx = ((bits >> (i * 2)) & 0x3) as usize;
        out[i] = pal[idx];
    }
    out
}

fn decode_bc3_block(blk: &[u8]) -> [[u8; 4]; 16] {
    let a0 = blk[0];
    let a1 = blk[1];
    let mut abits: u64 = 0;
    for i in 0..6 {
        abits |= (blk[2 + i] as u64) << (8 * i);
    }
    let mut apal = [0u8; 8];
    apal[0] = a0;
    apal[1] = a1;
    if a0 > a1 {
        for i in 1..=6 {
            apal[i + 1] = (((7 - i) as u16 * a0 as u16 + i as u16 * a1 as u16 + 3) / 7) as u8;
        }
    } else {
        for i in 1..=4 {
            apal[i + 1] = (((5 - i) as u16 * a0 as u16 + i as u16 * a1 as u16 + 2) / 5) as u8;
        }
        apal[6] = 0;
        apal[7] = 255;
    }

    let c0_raw = u16::from_le_bytes([blk[8], blk[9]]);
    let c1_raw = u16::from_le_bytes([blk[10], blk[11]]);
    let cbits = u32::from_le_bytes([blk[12], blk[13], blk[14], blk[15]]);
    let c0 = rgb565_to_rgba(c0_raw);
    let c1 = rgb565_to_rgba(c1_raw);
    let mut cpal = [[0u8; 3]; 4];
    cpal[0] = [c0[0], c0[1], c0[2]];
    cpal[1] = [c1[0], c1[1], c1[2]];
    for ch in 0..3 {
        cpal[2][ch] = ((2 * c0[ch] as u16 + c1[ch] as u16 + 1) / 3) as u8;
        cpal[3][ch] = ((c0[ch] as u16 + 2 * c1[ch] as u16 + 1) / 3) as u8;
    }

    let mut out = [[0u8; 4]; 16];
    for i in 0..16 {
        let cidx = ((cbits >> (i * 2)) & 0x3) as usize;
        let aidx = ((abits >> (i * 3)) & 0x7) as usize;
        out[i] = [cpal[cidx][0], cpal[cidx][1], cpal[cidx][2], apal[aidx]];
    }
    out
}

// Khronos ARB_texture_compression_bptc partition and anchor tables
#[rustfmt::skip]
const BC7_PART2: [[u8; 16]; 64] = [
    [0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1], [0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1], [0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1], [0,0,0,1,0,0,1,1,0,0,1,1,0,1,1,1],
    [0,0,0,0,0,0,0,1,0,0,0,1,0,0,1,1], [0,0,1,1,0,1,1,1,0,1,1,1,1,1,1,1], [0,0,0,1,0,0,1,1,0,1,1,1,1,1,1,1], [0,0,0,0,0,0,0,1,0,0,1,1,0,1,1,1],
    [0,0,0,0,0,0,0,0,0,0,0,1,0,0,1,1], [0,0,1,1,0,1,1,1,1,1,1,1,1,1,1,1], [0,0,0,0,0,0,0,1,0,1,1,1,1,1,1,1], [0,0,0,0,0,0,0,0,0,0,0,1,0,1,1,1],
    [0,0,0,1,0,1,1,1,1,1,1,1,1,1,1,1], [0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1], [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1], [0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1],
    [0,0,0,0,1,0,0,0,1,1,1,0,1,1,1,1], [0,1,1,1,0,0,0,1,0,0,0,0,0,0,0,0], [0,0,0,0,0,0,0,0,1,0,0,0,1,1,1,0], [0,1,1,1,0,0,1,1,0,0,0,1,0,0,0,0],
    [0,0,1,1,0,0,0,1,0,0,0,0,0,0,0,0], [0,0,0,0,1,0,0,0,1,1,0,0,1,1,1,0], [0,0,0,0,0,0,0,0,1,0,0,0,1,1,0,0], [0,1,1,1,0,0,1,1,0,0,1,1,0,0,0,1],
    [0,0,1,1,0,0,0,1,0,0,0,1,0,0,0,0], [0,0,0,0,1,0,0,0,1,0,0,0,1,1,0,0], [0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0], [0,0,1,1,0,1,1,0,0,1,1,0,1,1,0,0],
    [0,0,0,1,0,1,1,1,1,1,1,0,1,0,0,0], [0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0], [0,1,1,1,0,0,0,1,1,0,0,0,1,1,1,0], [0,0,1,1,1,0,0,1,1,0,0,1,1,1,0,0],
    [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1], [0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,1], [0,1,0,1,1,0,1,0,0,1,0,1,1,0,1,0], [0,0,1,1,0,0,1,1,1,1,0,0,1,1,0,0],
    [0,0,1,1,1,1,0,0,0,0,1,1,1,1,0,0], [0,1,0,1,0,1,0,1,1,0,1,0,1,0,1,0], [0,1,1,0,1,0,0,1,0,1,1,0,1,0,0,1], [0,1,0,1,1,0,1,0,1,0,1,0,0,1,0,1],
    [0,1,1,1,0,0,1,1,1,1,0,0,1,1,1,0], [0,0,0,1,0,0,1,1,1,1,0,0,1,0,0,0], [0,0,1,1,0,0,1,0,0,1,0,0,1,1,0,0], [0,0,1,1,1,0,1,1,1,1,0,1,1,1,0,0],
    [0,1,1,0,1,0,0,1,1,0,0,1,0,1,1,0], [0,0,1,1,1,1,0,0,1,1,0,0,0,0,1,1], [0,1,1,0,0,1,1,0,1,0,0,1,1,0,0,1], [0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0],
    [0,1,0,0,1,1,1,0,0,1,0,0,0,0,0,0], [0,0,1,0,0,1,1,1,0,0,1,0,0,0,0,0], [0,0,0,0,0,0,1,0,0,1,1,1,0,0,1,0], [0,0,0,0,0,1,0,0,1,1,1,0,0,1,0,0],
    [0,1,1,0,1,1,0,0,1,0,0,1,0,0,1,1], [0,0,1,1,0,1,1,0,1,1,0,0,1,0,0,1], [0,1,1,0,0,0,1,1,1,0,0,1,1,1,0,0], [0,0,1,1,1,0,0,1,1,1,0,0,0,1,1,0],
    [0,1,1,0,1,1,0,0,1,1,0,0,1,0,0,1], [0,1,1,0,0,0,1,1,0,0,1,1,1,0,0,1], [0,1,1,1,1,1,1,0,1,0,0,0,0,0,0,1], [0,0,0,1,1,0,0,0,1,1,1,0,0,1,1,1],
    [0,0,0,0,1,1,1,1,0,0,1,1,0,0,1,1], [0,0,1,1,0,0,1,1,1,1,1,1,0,0,0,0], [0,0,1,0,0,0,1,0,1,1,1,0,1,1,1,0], [0,1,0,0,0,1,0,0,0,1,1,1,0,1,1,1],
];

#[rustfmt::skip]
const BC7_PART3: [[u8; 16]; 64] = [
    [0,0,1,1,0,0,1,1,0,2,2,1,2,2,2,2], [0,0,0,1,0,0,1,1,2,2,1,1,2,2,2,1], [0,0,0,0,2,0,0,1,2,2,1,1,2,2,1,1], [0,2,2,2,0,0,2,2,0,0,1,1,0,1,1,1],
    [0,0,0,0,0,0,0,0,1,1,2,2,1,1,2,2], [0,0,1,1,0,0,1,1,0,0,2,2,0,0,2,2], [0,0,2,2,0,0,2,2,1,1,1,1,1,1,1,1], [0,0,1,1,0,0,1,1,2,2,1,1,2,2,1,1],
    [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2], [0,0,0,0,1,1,1,1,1,1,1,1,2,2,2,2], [0,0,0,0,1,1,1,1,2,2,2,2,2,2,2,2], [0,0,1,2,0,0,1,2,0,0,1,2,0,0,1,2],
    [0,1,1,2,0,1,1,2,0,1,1,2,0,1,1,2], [0,1,2,2,0,1,2,2,0,1,2,2,0,1,2,2], [0,0,1,1,0,1,1,2,1,1,2,2,1,2,2,2], [0,0,1,1,2,0,0,1,2,2,0,0,2,2,2,0],
    [0,0,0,1,0,0,1,1,0,1,1,2,1,1,2,2], [0,1,1,1,0,0,1,1,2,0,0,1,2,2,0,0], [0,0,0,0,1,1,2,2,1,1,2,2,1,1,2,2], [0,0,2,2,0,0,2,2,0,0,2,2,1,1,1,1],
    [0,1,1,1,0,1,1,1,0,2,2,2,0,2,2,2], [0,0,0,1,0,0,0,1,2,2,2,1,2,2,2,1], [0,0,0,0,0,0,1,1,0,1,2,2,0,1,2,2], [0,0,0,0,1,1,0,0,2,2,1,0,2,2,1,0],
    [0,1,2,2,0,1,2,2,0,0,1,1,0,0,0,0], [0,0,1,2,0,0,1,2,1,1,2,2,2,2,2,2], [0,1,1,0,1,2,2,1,1,2,2,1,0,1,1,0], [0,0,0,0,0,1,1,0,1,2,2,1,1,2,2,1],
    [0,0,2,2,1,1,0,2,1,1,0,2,0,0,2,2], [0,1,1,0,0,1,1,0,2,0,0,2,2,2,2,2], [0,0,1,1,0,1,2,2,0,1,2,2,0,0,1,1], [0,0,0,0,2,0,0,0,2,2,1,1,2,2,2,1],
    [0,0,0,0,0,0,0,2,1,1,2,2,1,2,2,2], [0,2,2,2,0,0,2,2,0,0,1,2,0,0,1,1], [0,0,1,1,0,0,1,2,0,0,2,2,0,2,2,2], [0,1,2,0,0,1,2,0,0,1,2,0,0,1,2,0],
    [0,0,0,0,1,1,1,1,2,2,2,2,0,0,0,0], [0,1,2,0,1,2,0,1,2,0,1,2,0,1,2,0], [0,1,2,0,2,0,1,2,1,2,0,1,0,1,2,0], [0,0,1,1,2,2,0,0,1,1,2,2,0,0,1,1],
    [0,0,1,1,1,1,2,2,2,2,0,0,0,0,1,1], [0,1,0,1,0,1,0,1,2,2,2,2,2,2,2,2], [0,0,0,0,0,0,0,0,2,1,2,1,2,1,2,1], [0,0,2,2,1,1,2,2,0,0,2,2,1,1,2,2],
    [0,0,2,2,0,0,1,1,0,0,2,2,0,0,1,1], [0,2,2,0,1,2,2,1,0,2,2,0,1,2,2,1], [0,1,0,1,2,2,2,2,2,2,2,2,0,1,0,1], [0,0,0,0,2,1,2,1,2,1,2,1,2,1,2,1],
    [0,1,0,1,0,1,0,1,0,1,0,1,2,2,2,2], [0,2,2,2,0,1,1,1,0,2,2,2,0,1,1,1], [0,0,0,2,1,1,1,2,0,0,0,2,1,1,1,2], [0,0,0,0,2,1,1,2,2,1,1,2,2,1,1,2],
    [0,2,2,2,0,1,1,1,0,1,1,1,0,2,2,2], [0,0,0,2,1,1,1,2,1,1,1,2,0,0,0,2], [0,1,1,0,0,1,1,0,0,1,1,0,2,2,2,2], [0,0,0,0,0,0,0,0,2,1,1,2,2,1,1,2],
    [0,1,1,0,0,1,1,0,2,2,2,2,2,2,2,2], [0,0,2,2,0,0,1,1,0,0,1,1,0,0,2,2], [0,0,2,2,1,1,2,2,1,1,2,2,0,0,2,2], [0,0,0,0,0,0,0,0,0,0,0,0,2,1,1,2],
    [0,0,0,2,0,0,0,1,0,0,0,2,0,0,0,1], [0,2,2,2,1,2,2,2,0,2,2,2,1,2,2,2], [0,1,0,1,2,2,2,2,2,2,2,2,2,2,2,2], [0,1,1,1,2,0,1,1,2,2,0,1,2,2,2,0],
];

#[rustfmt::skip]
const BC7_ANCHOR_2: [u8; 64] = [
    15,15,15,15,15,15,15,15, 15,15,15,15,15,15,15,15,
    15, 2, 8, 2, 2, 8, 8,15,  2, 8, 2, 2, 8, 8, 2, 2,
    15,15, 6, 8, 2, 8,15,15,  2, 8, 2, 2, 2,15,15, 6,
     6, 2, 6, 8,15,15, 2, 2, 15,15,15,15,15, 2, 2,15,
];

#[rustfmt::skip]
const BC7_ANCHOR_3_1: [u8; 64] = [
     3, 3,15,15, 8, 3,15,15,  8, 8, 6, 6, 6, 5, 3, 3,
     3, 3, 8,15, 3, 3, 6,10,  5, 8, 8, 6, 8, 5,15,15,
     8,15, 3, 5, 6,10, 8,15, 15, 3,15, 5,15,15,15,15,
     3,15, 5, 5, 5, 8, 5,10,  5,10, 8,13,15,12, 3, 3,
];

#[rustfmt::skip]
const BC7_ANCHOR_3_2: [u8; 64] = [
    15, 8, 8, 3,15,15, 3, 8, 15,15,15,15,15,15,15, 8,
    15, 8,15, 3,15, 8,15, 8,  3,15, 6,10,15,15,10, 8,
    15, 3,15,10,10, 8, 9,10,  6,15, 8,15, 3, 6, 6, 8,
    15, 3,15,15,15,15,15,15, 15,15,15,15, 3,15,15, 8,
];

struct BitCursor {
    raw: u128,
    pos: u32,
}

impl BitCursor {
    fn new(blk: &[u8]) -> Self {
        let mut arr = [0u8; 16];
        arr.copy_from_slice(&blk[..16]);
        Self {
            raw: u128::from_le_bytes(arr),
            pos: 0,
        }
    }

    fn read(&mut self, bits: u32) -> u8 {
        if bits == 0 {
            return 0;
        }
        let mask = (1u128 << bits) - 1;
        let val = ((self.raw >> self.pos) & mask) as u8;
        self.pos += bits;
        val
    }
}

fn unquantize_bc7(val: u8, bits: u32) -> u8 {
    let v = val as u32;
    if bits >= 8 {
        return val;
    }
    ((v << (8 - bits)) | (v >> (2 * bits - 8))) as u8
}

fn interp_bc7(e0: u8, e1: u8, w_bits: u32, idx: u8) -> u8 {
    const W2: [u16; 4] = [0, 21, 43, 64];
    const W3: [u16; 8] = [0, 9, 18, 27, 37, 46, 55, 64];
    const W4: [u16; 16] = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];
    let w = match w_bits {
        2 => W2[(idx as usize) & 3],
        3 => W3[(idx as usize) & 7],
        4 => W4[(idx as usize) & 15],
        _ => 0,
    };
    (((64 - w) * (e0 as u16) + w * (e1 as u16) + 32) >> 6) as u8
}

fn decode_bc7_block(blk: &[u8]) -> [[u8; 4]; 16] {
    struct ModeInfo {
        ns: usize,
        pb: u32,
        rb: u32,
        isb: u32,
        cb: u32,
        ab: u32,
        epb: bool,
        spb: bool,
        ib: u32,
        ib2: u32,
    }
    const MODES: [ModeInfo; 8] = [
        ModeInfo { ns: 3, pb: 4, rb: 0, isb: 0, cb: 4, ab: 0, epb: true,  spb: false, ib: 3, ib2: 0 },
        ModeInfo { ns: 2, pb: 6, rb: 0, isb: 0, cb: 6, ab: 0, epb: false, spb: true,  ib: 3, ib2: 0 },
        ModeInfo { ns: 3, pb: 6, rb: 0, isb: 0, cb: 5, ab: 0, epb: false, spb: false, ib: 2, ib2: 0 },
        ModeInfo { ns: 2, pb: 6, rb: 0, isb: 0, cb: 7, ab: 0, epb: true,  spb: false, ib: 2, ib2: 0 },
        ModeInfo { ns: 1, pb: 0, rb: 2, isb: 1, cb: 5, ab: 6, epb: false, spb: false, ib: 2, ib2: 3 },
        ModeInfo { ns: 1, pb: 0, rb: 2, isb: 0, cb: 7, ab: 8, epb: false, spb: false, ib: 2, ib2: 2 },
        ModeInfo { ns: 1, pb: 0, rb: 0, isb: 0, cb: 7, ab: 7, epb: true,  spb: false, ib: 4, ib2: 0 },
        ModeInfo { ns: 2, pb: 6, rb: 0, isb: 0, cb: 5, ab: 5, epb: true,  spb: false, ib: 2, ib2: 0 },
    ];

    let mut cur = BitCursor::new(blk);
    let low = (cur.raw & 0xff) as u8;
    if low == 0 {
        return [[0u8; 4]; 16];
    }
    let mode_idx = low.trailing_zeros() as usize;
    cur.pos = (mode_idx as u32) + 1;
    let m = &MODES[mode_idx];

    let part = cur.read(m.pb) as usize;
    let rot = cur.read(m.rb);
    let idx_sel = cur.read(m.isb);

    let ep_count = m.ns * 2;
    let mut eps = [[255u8; 4]; 6];
    for ch in 0..3 {
        for e in 0..ep_count {
            eps[e][ch] = cur.read(m.cb);
        }
    }
    if m.ab > 0 {
        for e in 0..ep_count {
            eps[e][3] = cur.read(m.ab);
        }
    }
    if m.epb {
        for e in 0..ep_count {
            let p = cur.read(1);
            for ch in 0..3 {
                eps[e][ch] = (eps[e][ch] << 1) | p;
            }
            if m.ab > 0 {
                eps[e][3] = (eps[e][3] << 1) | p;
            }
        }
    } else if m.spb {
        for s in 0..m.ns {
            let p = cur.read(1);
            for ch in 0..3 {
                eps[s * 2][ch] = (eps[s * 2][ch] << 1) | p;
                eps[s * 2 + 1][ch] = (eps[s * 2 + 1][ch] << 1) | p;
            }
        }
    }

    let c_bits = m.cb + u32::from(m.epb || m.spb);
    let a_bits = if m.ab > 0 { m.ab + u32::from(m.epb) } else { 0 };
    for e in 0..ep_count {
        for ch in 0..3 {
            eps[e][ch] = unquantize_bc7(eps[e][ch], c_bits);
        }
        if a_bits > 0 {
            eps[e][3] = unquantize_bc7(eps[e][3], a_bits);
        } else {
            eps[e][3] = 255;
        }
    }

    let is_anchor = |i: usize| -> bool {
        if i == 0 {
            return true;
        }
        if m.ns == 2 && i == BC7_ANCHOR_2[part] as usize {
            return true;
        }
        if m.ns == 3 && (i == BC7_ANCHOR_3_1[part] as usize || i == BC7_ANCHOR_3_2[part] as usize) {
            return true;
        }
        false
    };

    let mut idx1 = [0u8; 16];
    for i in 0..16 {
        let bits = if is_anchor(i) { m.ib - 1 } else { m.ib };
        idx1[i] = cur.read(bits);
    }

    let mut idx2 = [0u8; 16];
    if m.ib2 > 0 {
        for i in 0..16 {
            let bits = if i == 0 { m.ib2 - 1 } else { m.ib2 };
            idx2[i] = cur.read(bits);
        }
    }

    let mut out = [[0u8; 4]; 16];
    for i in 0..16 {
        let subset = match m.ns {
            2 => BC7_PART2[part][i] as usize,
            3 => BC7_PART3[part][i] as usize,
            _ => 0,
        };
        let e0 = eps[subset * 2];
        let e1 = eps[subset * 2 + 1];

        let (c_w_bits, c_idx, a_w_bits, a_idx) = if m.ib2 > 0 {
            if idx_sel == 0 {
                (m.ib, idx1[i], m.ib2, idx2[i])
            } else {
                (m.ib2, idx2[i], m.ib, idx1[i])
            }
        } else {
            (m.ib, idx1[i], m.ib, idx1[i])
        };

        let mut px = [
            interp_bc7(e0[0], e1[0], c_w_bits, c_idx),
            interp_bc7(e0[1], e1[1], c_w_bits, c_idx),
            interp_bc7(e0[2], e1[2], c_w_bits, c_idx),
            if a_bits > 0 { interp_bc7(e0[3], e1[3], a_w_bits, a_idx) } else { 255 },
        ];
        match rot {
            1 => px.swap(0, 3),
            2 => px.swap(1, 3),
            3 => px.swap(2, 3),
            _ => {}
        }
        out[i] = px;
    }
    out
}

fn flip_vertical(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
    let stride = (w as usize) * 4;
    let mut out = vec![0u8; rgba.len()];
    for y in 0..h as usize {
        let src_row = (h as usize - 1 - y) * stride;
        let dst_row = y * stride;
        out[dst_row..dst_row + stride].copy_from_slice(&rgba[src_row..src_row + stride]);
    }
    out
}

fn downscale_max_dim(w: u32, h: u32, rgba: &[u8], max_dim: u32) -> (u32, u32, Vec<u8>) {
    if w <= max_dim && h <= max_dim {
        return (w, h, rgba.to_vec());
    }
    let scale = (max_dim as f64) / (w.max(h) as f64);
    let nw = ((w as f64 * scale).round() as u32).max(1);
    let nh = ((h as f64 * scale).round() as u32).max(1);
    let mut out = vec![0u8; (nw as usize) * (nh as usize) * 4];
    for y in 0..nh {
        let sy = ((y as f64 + 0.5) * (h as f64) / (nh as f64) - 0.5).clamp(0.0, (h - 1) as f64);
        let y0 = sy.floor() as u32;
        let y1 = (y0 + 1).min(h - 1);
        let fy = sy - y0 as f64;
        for x in 0..nw {
            let sx = ((x as f64 + 0.5) * (w as f64) / (nw as f64) - 0.5).clamp(0.0, (w - 1) as f64);
            let x0 = sx.floor() as u32;
            let x1 = (x0 + 1).min(w - 1);
            let fx = sx - x0 as f64;
            let idx00 = ((y0 * w + x0) * 4) as usize;
            let idx10 = ((y0 * w + x1) * 4) as usize;
            let idx01 = ((y1 * w + x0) * 4) as usize;
            let idx11 = ((y1 * w + x1) * 4) as usize;
            let dst = ((y * nw + x) * 4) as usize;
            for ch in 0..4 {
                let v00 = rgba[idx00 + ch] as f64;
                let v10 = rgba[idx10 + ch] as f64;
                let v01 = rgba[idx01 + ch] as f64;
                let v11 = rgba[idx11 + ch] as f64;
                let top = v00 + (v10 - v00) * fx;
                let bot = v01 + (v11 - v01) * fx;
                out[dst + ch] = (top + (bot - top) * fy).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    (nw, nh, out)
}

fn encode_rgba_png(w: u32, h: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lz4_roundtrip_literals_and_overlap_match() {
        // literal "ab" (len 2 -> token 0x20), offset 2, match len 4 -> token = (2<<4)|0 = 0x20
        // sequence: token 0x20, literals 'a','b', offset 2,0 -> produces "ababab" (6 bytes)
        let compressed = [0x20u8, b'a', b'b', 0x02, 0x00, 0x10, b'!'];
        let out = lz4_decompress_block(&compressed, 7).unwrap();
        assert_eq!(out, b"ababab!");
    }

    #[test]
    fn classify_asset_names_for_all_sections() {
        assert_eq!(
            classify_asset_name("UT_HandCard_21022"),
            Some(("card".to_string(), "21022".to_string(), "card".to_string()))
        );
        assert_eq!(
            classify_asset_name("UT_IAltArt_13020001"),
            Some(("card".to_string(), "13020001".to_string(), "alt_art".to_string()))
        );
        assert_eq!(
            classify_asset_name("UT_Hero_Card_101_Max"),
            Some(("character".to_string(), "101".to_string(), "card".to_string()))
        );
        assert_eq!(
            classify_asset_name("UT_Relic_Attack"),
            Some(("chip".to_string(), "Attack".to_string(), "chip".to_string()))
        );
        assert_eq!(
            classify_asset_name("UT_MapPreview_003.png"),
            Some(("map".to_string(), "003".to_string(), "preview".to_string()))
        );
    }

    #[test]
    fn real_nunnan_bc7_bundle_extracts_and_decodes_png() {
        let bundle_path = Path::new(
            r"E:\工作流\星引擎插件\MOD包制作\卡面替换包\NunNan系列卡牌替换汉化modv1.3全端整合版\PC端(Steam直接覆盖)\StandaloneWindows64\01c0ca41a5341ad4ad41448ad387827f.bundle",
        );
        if !bundle_path.is_file() {
            return;
        }
        let raw = fs::read(bundle_path).unwrap();
        let names = extract_texture_names_from_bundle(&raw).unwrap();
        assert!(names.iter().any(|n| n == "UT_HandCard_21022"), "names={names:?}");
        let png_bytes = extract_texture_png_from_bundle(&raw, "UT_HandCard_21022").unwrap();
        assert!(png_bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(png_bytes.len() > 20_000, "png too small: {}", png_bytes.len());

        let scratch_out = Path::new(
            r"C:\Users\76501\.gemini\antigravity\brain\d820cbc6-bbd1-4357-b0f6-f960e4f988e4\scratch\rust_bc7_test_21022.png",
        );
        if let Some(parent) = scratch_out.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(scratch_out, &png_bytes);
    }

    #[test]
    fn extract_text_asset_skips_ress_and_matches_case_insensitively() {
        let mut obj_data = Vec::new();
        let add_str = |buf: &mut Vec<u8>, s: &[u8]| {
            buf.extend_from_slice(&(s.len() as i32).to_le_bytes());
            buf.extend_from_slice(s);
            while buf.len() % 4 != 0 {
                buf.push(0);
            }
        };
        let start1 = 0usize;
        add_str(&mut obj_data, b"Other");
        add_str(&mut obj_data, b"ignore");
        let sz1 = (obj_data.len() - start1) as u32;
        let start2 = obj_data.len();
        add_str(&mut obj_data, b"SpineHandCard_Test.ATLAS");
        add_str(&mut obj_data, b"atlas-payload");
        let sz2 = (obj_data.len() - start2) as u32;

        let mut meta = Vec::new();
        meta.extend_from_slice(b"2022.3.0f1\0");
        meta.extend_from_slice(&19i32.to_le_bytes());
        meta.push(0);
        meta.extend_from_slice(&1i32.to_le_bytes());
        meta.extend_from_slice(&49i32.to_le_bytes());
        meta.push(0);
        meta.extend_from_slice(&(-1i16).to_le_bytes());
        meta.extend_from_slice(&[0u8; 16]);
        meta.extend_from_slice(&2i32.to_le_bytes());
        while meta.len() % 4 != 0 {
            meta.push(0);
        }
        for (id, st, sz) in [(1i64, start1 as i64, sz1), (2i64, start2 as i64, sz2)] {
            meta.extend_from_slice(&id.to_le_bytes());
            meta.extend_from_slice(&st.to_le_bytes());
            meta.extend_from_slice(&sz.to_le_bytes());
            meta.extend_from_slice(&0i32.to_le_bytes());
        }
        let data_offset = (48 + meta.len()).next_multiple_of(16);
        let mut cab = vec![0u8; data_offset + obj_data.len()];
        let total = cab.len() as i64;
        cab[0..4].copy_from_slice(&(meta.len() as u32).to_be_bytes());
        cab[4..8].copy_from_slice(&(total as u32).to_be_bytes());
        cab[8..12].copy_from_slice(&22u32.to_be_bytes());
        cab[20..24].copy_from_slice(&(meta.len() as u32).to_be_bytes());
        cab[24..32].copy_from_slice(&total.to_be_bytes());
        cab[32..40].copy_from_slice(&(data_offset as i64).to_be_bytes());
        cab[48..48 + meta.len()].copy_from_slice(&meta);
        cab[data_offset..].copy_from_slice(&obj_data);

        let mut stream = b"RES_DATA".to_vec();
        let cab_offset = stream.len() as i64;
        stream.extend_from_slice(&cab);

        let mut blocks_info = Vec::new();
        blocks_info.extend_from_slice(&[0u8; 16]);
        blocks_info.extend_from_slice(&1i32.to_be_bytes());
        blocks_info.extend_from_slice(&(stream.len() as u32).to_be_bytes());
        blocks_info.extend_from_slice(&(stream.len() as u32).to_be_bytes());
        blocks_info.extend_from_slice(&0u16.to_be_bytes());
        blocks_info.extend_from_slice(&2i32.to_be_bytes());
        blocks_info.extend_from_slice(&0i64.to_be_bytes());
        blocks_info.extend_from_slice(&8i64.to_be_bytes());
        blocks_info.extend_from_slice(&0u32.to_be_bytes());
        blocks_info.extend_from_slice(b"CAB-test.resS\0");
        blocks_info.extend_from_slice(&cab_offset.to_be_bytes());
        blocks_info.extend_from_slice(&(cab.len() as i64).to_be_bytes());
        blocks_info.extend_from_slice(&4u32.to_be_bytes());
        blocks_info.extend_from_slice(b"CAB-test\0");

        let mut bundle = Vec::new();
        bundle.extend_from_slice(b"UnityFS\0");
        bundle.extend_from_slice(&6u32.to_be_bytes());
        bundle.extend_from_slice(b"5.x.x\02022.3.0f1\0");
        let sz_pos = bundle.len();
        bundle.extend_from_slice(&0i64.to_be_bytes());
        bundle.extend_from_slice(&(blocks_info.len() as u32).to_be_bytes());
        bundle.extend_from_slice(&(blocks_info.len() as u32).to_be_bytes());
        bundle.extend_from_slice(&0u32.to_be_bytes());
        bundle.extend_from_slice(&blocks_info);
        bundle.extend_from_slice(&stream);
        let bundle_len = bundle.len() as i64;
        bundle[sz_pos..sz_pos + 8].copy_from_slice(&bundle_len.to_be_bytes());

        assert_eq!(extract_text_asset(&bundle, "spinehandcard_test.atlas").unwrap(), b"atlas-payload");
        assert!(extract_text_asset(&bundle, "missing").is_err());
    }

    fn build_test_unityfs_bundle(cab_name: &str, types: Vec<(i32, usize)>, objects: Vec<(i64, usize, Vec<u8>)>) -> Vec<u8> {
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
        for (cid, _) in &types {
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

    fn make_mb_obj(header28: [u8; 28], name: &str, body: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&header28);
        out.extend_from_slice(&(name.len() as u32).to_le_bytes());
        out.extend_from_slice(name.as_bytes());
        while out.len() % 4 != 0 {
            out.push(0);
        }
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn inspects_bundle_contents_and_migrates_single_monobehaviour() {
        let van_hdr = [0xAAu8; 28];
        let mut mod_hdr = [0x11u8; 28];
        mod_hdr[0] = 0x22;
        let van = build_test_unityfs_bundle(
            "CAB-van",
            vec![(142, 0), (114, 1)],
            vec![
                (1, 0, vec![0x99u8; 24]),
                (100, 1, make_mb_obj(van_hdr, "VSkill_Test", b"VAN")),
            ],
        );
        let mod_b = build_test_unityfs_bundle(
            "CAB-mod",
            vec![(142, 0), (114, 1)],
            vec![
                (1, 0, vec![0x88u8; 16]),
                (200, 1, make_mb_obj(mod_hdr, "VSkill_Test", b"MOD_LONGER_PAYLOAD_123456")),
            ],
        );

        let sum = inspect_bundle_contents(&mod_b).unwrap();
        assert_eq!(sum.monobehaviour_names, vec!["VSkill_Test"]);
        assert!(sum.texture_names.is_empty());
        assert_eq!(sum.other_object_count, 0);
        assert!(!sum.has_astral_runtime_dll && !sum.has_apenc_drm);

        let migrated = migrate_single_monobehaviour_bundle(&van, &mod_b).unwrap();
        let fs = parse_unityfs(&migrated, false).unwrap();
        assert_eq!(fs.nodes[0].path, "CAB-van");
        let cab = &fs.stream[fs.nodes[0].offset..fs.nodes[0].offset + fs.nodes[0].size];
        let sf = parse_serialized_file(cab).unwrap();
        assert_eq!(sf.objects.len(), 2);
        let mb = &sf.objects[1];
        let mb_bytes = &cab[sf.data_offset + mb.byte_start..sf.data_offset + mb.byte_start + mb.byte_size];
        assert_eq!(&mb_bytes[..28], &van_hdr);
        assert!(mb_bytes.ends_with(b"MOD_LONGER_PAYLOAD_123456"));

        let apenc_mod = build_test_unityfs_bundle(
            "CAB-drm",
            vec![(114, 0)],
            vec![(1, 0, make_mb_obj(mod_hdr, "VUT_Hero_Card_114_01", b"\0\0APENC01_DRM"))],
        );
        let ap_sum = inspect_bundle_contents(&apenc_mod).unwrap();
        assert!(ap_sum.has_apenc_drm);
        assert!(migrate_single_monobehaviour_bundle(&van, &apenc_mod).is_err());

        let mut rt_payload = Vec::new();
        let rt_name = b"AstralParty.Runtime.dll";
        rt_payload.extend_from_slice(&(rt_name.len() as u32).to_le_bytes());
        rt_payload.extend_from_slice(rt_name);
        let rt_bundle = build_test_unityfs_bundle("CAB-rt", vec![(49, 0)], vec![(1, 0, rt_payload)]);
        let rt_sum = inspect_bundle_contents(&rt_bundle).unwrap();
        assert!(rt_sum.has_text_asset && rt_sum.has_astral_runtime_dll);
    }

    fn make_text_asset_obj(name: &str, script: &[u8]) -> Vec<u8> {
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
    fn extracts_cab_names_patches_text_asset_wwise_bnk_and_rml_proto() {
        // 1. CAB name extraction & TextAsset patching
        let orig_ta = make_text_asset_obj("Login_fui", b"OLD_FUI");
        let van_ta = build_test_unityfs_bundle(
            "CAB-5ff6202eb64c9d92f9bd46f7a0c0b22a",
            vec![(49, 0)],
            vec![(10, 0, orig_ta)],
        );
        let cabs = extract_bundle_cab_names(&van_ta).unwrap();
        assert_eq!(cabs, vec!["CAB-5ff6202eb64c9d92f9bd46f7a0c0b22a"]);
        let sum = inspect_bundle_contents(&van_ta).unwrap();
        assert_eq!(sum.cab_names, cabs);

        let patched_ta = patch_text_asset_in_bundle(&van_ta, "Login_fui", b"FGUI_NEW_LONGER_BYTES").unwrap();
        assert_eq!(extract_text_asset(&patched_ta, "Login_fui").unwrap(), b"FGUI_NEW_LONGER_BYTES");

        // 2. Wwise BNK patching inside MonoBehaviour with DIDX, DATA, HIRC & 4-byte aligned tail
        let wem_id: u32 = 970399165;
        let old_wem = b"RIFF_OLD_WEM";
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
        let mut hirc_obj = Vec::new();
        hirc_obj.extend_from_slice(&wem_id.to_le_bytes());
        hirc_obj.extend_from_slice(&(old_wem.len() as u32).to_le_bytes());
        bnk.extend_from_slice(b"HIRC");
        bnk.extend_from_slice(&((9 + hirc_obj.len()) as u32).to_le_bytes());
        bnk.extend_from_slice(&1u32.to_le_bytes());
        bnk.push(11u8);
        bnk.extend_from_slice(&(hirc_obj.len() as u32).to_le_bytes());
        bnk.extend_from_slice(&hirc_obj);

        let mut mb_body = Vec::new();
        mb_body.extend_from_slice(&(bnk.len() as u32).to_le_bytes());
        mb_body.extend_from_slice(&bnk);
        let pad_len = (4 - (bnk.len() % 4)) % 4;
        mb_body.extend(std::iter::repeat_n(0u8, pad_len));
        mb_body.extend_from_slice(b"TAIL_KEEP");

        let van_bnk = build_test_unityfs_bundle(
            "CAB-bnk",
            vec![(114, 0)],
            vec![(42, 0, make_mb_obj([0x77u8; 28], "BGM_Login", &mb_body))],
        );
        let new_wem = b"RIFF_NEW_WEM_AUDIO_12345";
        let patched_bnk_bundle = patch_wwise_bnk_in_monobehaviour_bundle(&van_bnk, "BGM_Login", new_wem).unwrap();
        let fs = parse_unityfs(&patched_bnk_bundle, false).unwrap();
        let cab = &fs.stream[fs.nodes[0].offset..fs.nodes[0].offset + fs.nodes[0].size];
        let sf = parse_serialized_file(cab).unwrap();
        let obj_raw = &cab[sf.data_offset + sf.objects[0].byte_start..sf.data_offset + sf.objects[0].byte_start + sf.objects[0].byte_size];
        assert!(obj_raw.windows(new_wem.len()).any(|w| w == new_wem));
        assert!(obj_raw.ends_with(b"TAIL_KEEP"));
        let didx_pos = obj_raw.windows(4).position(|w| w == b"DIDX").unwrap();
        let updated_sz = u32::from_le_bytes(obj_raw[didx_pos + 16..didx_pos + 20].try_into().unwrap());
        assert_eq!(updated_sz as usize, new_wem.len());
        let hirc_pos = obj_raw.windows(4).position(|w| w == b"HIRC").unwrap();
        assert_eq!(
            u32::from_le_bytes(obj_raw[hirc_pos + 21..hirc_pos + 25].try_into().unwrap()) as usize,
            new_wem.len()
        );

        // 3. Protobuf RML patch (`1[0].10=0x904e`, `2[0].2.10=0x904e`)
        let inner = encode_proto_fields(&[
            (3, ProtoVal::Bytes(b"Login".to_vec())),
            (10, ProtoVal::Varint(2)),
        ]);
        let f2_entry = encode_proto_fields(&[
            (1, ProtoVal::Fixed32(11u32.to_le_bytes())),
            (2, ProtoVal::Bytes(inner.clone())),
        ]);
        let proto = encode_proto_fields(&[
            (1, ProtoVal::Bytes(inner)),
            (2, ProtoVal::Bytes(f2_entry)),
        ]);
        let patched_proto = apply_rml_proto_patch(&proto, "1[0].10=0x904e\r\n2[0].2.10=0x904e\n").unwrap();
        let dec = decode_proto_fields(&patched_proto).unwrap();
        let f1_dec = match &dec[0].1 { ProtoVal::Bytes(b) => decode_proto_fields(b).unwrap(), _ => panic!() };
        assert!(matches!(f1_dec[1], (10, ProtoVal::Varint(0x904e))));
        let f2_outer = match &dec[1].1 { ProtoVal::Bytes(b) => decode_proto_fields(b).unwrap(), _ => panic!() };
        let f2_inner = match &f2_outer[1].1 { ProtoVal::Bytes(b) => decode_proto_fields(b).unwrap(), _ => panic!() };
        assert!(matches!(f2_inner[1], (10, ProtoVal::Varint(0x904e))));
    }

    #[test]
    #[ignore = "requires real bundle paths via XINGSHU_TEST_VANILLA_MB, XINGSHU_TEST_MOD_MB, XINGSHU_TEST_OUT_MB"]
    fn migrates_real_monobehaviour_bundle_from_env() {
        let van = fs::read(std::env::var_os("XINGSHU_TEST_VANILLA_MB").unwrap()).unwrap();
        let mod_b = fs::read(std::env::var_os("XINGSHU_TEST_MOD_MB").unwrap()).unwrap();
        let out_path = PathBuf::from(std::env::var_os("XINGSHU_TEST_OUT_MB").unwrap());
        let migrated = migrate_single_monobehaviour_bundle(&van, &mod_b).unwrap();
        fs::write(&out_path, &migrated).unwrap();
    }
}
