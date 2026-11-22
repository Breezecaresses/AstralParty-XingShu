//! Read-only artwork from a registered Astral Party installation.
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Manager, UriSchemeContext, UriSchemeResponder, Wry, http};
use tokio::sync::Semaphore;

use crate::{
    extension_center::{ExtensionCenter, game_root},
    mod_inspector::{extract_addressables_json, extract_atlas_png, extract_game_emote, extract_text_asset, extract_texture_png_from_bundle},
    security::path_guard::PathGuard,
    storage::repositories::GameRepository,
};

const CATALOG_LIMIT: u64 = 32 * 1024 * 1024;
const BUNDLE_LIMIT: u64 = 80 * 1024 * 1024;
const MAX_ENTRIES: usize = 200_000;
const MAX_CACHE_GROUPS: usize = 65_536;
const BUNDLE_INDEX_TTL: Duration = Duration::from_secs(30);

type CachedCatalog = (SystemTime, u64, Arc<Catalog>);
type CachedBundleIndex = (Instant, SystemTime, HashMap<String, Vec<PathBuf>>);

#[derive(Clone)]
pub(crate) struct GameArt {
    catalogs: Arc<Mutex<HashMap<PathBuf, CachedCatalog>>>,
    bundle_indexes: Arc<Mutex<HashMap<PathBuf, CachedBundleIndex>>>,
    workers: Arc<Semaphore>,
}

impl Default for GameArt {
    fn default() -> Self {
        Self {
            catalogs: Default::default(),
            bundle_indexes: Default::default(),
            workers: Arc::new(Semaphore::new(2)),
        }
    }
}

#[derive(Deserialize)]
struct CatalogDocument {
    #[serde(rename = "m_InternalIds")]
    internal_ids: Vec<String>,
    #[serde(rename = "m_KeyDataString")]
    keys: String,
    #[serde(rename = "m_BucketDataString")]
    buckets: String,
    #[serde(rename = "m_EntryDataString")]
    entries: String,
}

struct Catalog {
    keys: HashMap<String, usize>,
    buckets: Vec<Vec<usize>>,
    entries: Vec<(usize, i32)>,
    internal_ids: Vec<String>,
}

fn u32_at(bytes: &[u8], pos: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(pos..pos.checked_add(4)?)?.try_into().ok()?))
}

impl Catalog {
    fn parse(raw: &[u8]) -> Option<Self> {
        let doc: CatalogDocument = serde_json::from_slice(raw.strip_prefix(b"\xef\xbb\xbf").unwrap_or(raw)).ok()?;
        let keys = STANDARD.decode(doc.keys).ok()?;
        let buckets = STANDARD.decode(doc.buckets).ok()?;
        let entries = STANDARD.decode(doc.entries).ok()?;
        let count = u32_at(&entries, 0)? as usize;
        let bucket_count = u32_at(&buckets, 0)? as usize;
        if count > MAX_ENTRIES || bucket_count > MAX_ENTRIES || entries.len() != 4 + count * 28 {
            return None;
        }
        let mut parsed = Self {
            keys: HashMap::new(),
            buckets: Vec::with_capacity(bucket_count),
            entries: Vec::with_capacity(count),
            internal_ids: doc.internal_ids,
        };
        for pos in (4..entries.len()).step_by(28) {
            let internal = u32_at(&entries, pos)? as usize;
            let dependency = u32_at(&entries, pos + 8)? as i32;
            if internal >= parsed.internal_ids.len() || (dependency >= 0 && dependency as usize >= bucket_count) {
                return None;
            }
            parsed.entries.push((internal, dependency));
        }
        let mut pos = 4;
        for bucket in 0..bucket_count {
            let key_pos = u32_at(&buckets, pos)? as usize;
            let len = u32_at(&buckets, pos + 4)? as usize;
            pos += 8;
            if len > count || pos + len * 4 > buckets.len() {
                return None;
            }
            let mut list = Vec::with_capacity(len);
            for entry in (pos..pos + len * 4).step_by(4) {
                let index = u32_at(&buckets, entry)? as usize;
                if index >= count { return None; }
                list.push(index);
            }
            pos += len * 4;
            parsed.buckets.push(list);
            let tag = *keys.get(key_pos)?;
            if matches!(tag, 0 | 1) {
                let length = u32_at(&keys, key_pos + 1)? as usize;
                let max_bytes = if tag == 1 { 320 } else { 160 };
                if length > max_bytes { continue; }
                let text_start = key_pos.checked_add(5)?;
                let text_end = text_start.checked_add(length)?;
                let text = keys.get(text_start..text_end)?;
                let name = if tag == 0 {
                    String::from_utf8(text.to_vec()).ok()
                } else if length % 2 == 0 {
                    let chars: Vec<u16> = text.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
                    String::from_utf16(&chars).ok()
                } else {
                    None
                };
                if let Some(name) = name.filter(|name| valid_asset_name(name)) {
                    parsed.keys.insert(name, bucket);
                }
            }
        }
        Some(parsed)
    }

    fn bundles(&self, asset: &str) -> Option<Vec<&str>> {
        let mut pending = self.buckets[*self.keys.get(asset)?].clone();
        let mut seen = HashSet::new();
        let mut output = Vec::new();
        while let Some(index) = pending.pop() {
            if !seen.insert(index) { continue; }
            let (internal, dependency) = self.entries[index];
            let name = self.internal_ids[internal].rsplit(['/', '\\']).next().unwrap_or_default();
            if name.ends_with(".bundle") && name.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
                && !output.contains(&name) {
                output.push(name);
            }
            if dependency >= 0 {
                pending.extend(&self.buckets[dependency as usize]);
            }
        }
        Some(output)
    }
}

fn valid_asset_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 160
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
}

fn read_limited(root: &Path, file: &Path, limit: u64) -> Option<Vec<u8>> {
    let path = PathGuard::ensure_within_root(root, file).ok()?;
    let file = File::open(path).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > limit { return None; }
    let mut raw = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1).read_to_end(&mut raw).ok()?;
    (raw.len() as u64 <= limit).then_some(raw)
}

fn emoji_sheet_candidates(asset: &str) -> Vec<(String, bool)> {
    let mut names = Vec::with_capacity(3);
    if let Some(suffix) = asset.strip_prefix("UT_Item_Emoji_") {
        names.push((format!("VEmoji_{suffix}"), true));
        if let Some((head, tail)) = suffix.split_once('_') {
            if tail.starts_with('0') && tail.len() > 1 {
                let trimmed = tail.trim_start_matches('0');
                if !trimmed.is_empty() {
                    names.push((format!("VEmoji_{head}_{trimmed}"), true));
                }
            }
        }
    }
    names.push((asset.to_owned(), false));
    names
}

impl GameArt {
    fn cached_bundle_paths(&self, boundary: &Path, cache: &Path, id: &str) -> Vec<PathBuf> {
        let Ok(ab_root) = PathGuard::ensure_within_root(boundary, &cache.join("AssetBundles")) else {
            return Vec::new();
        };
        let Ok(meta) = fs::metadata(&ab_root) else {
            return Vec::new();
        };
        if !meta.is_dir() {
            return Vec::new();
        }
        let dir_mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if let Ok(indexes) = self.bundle_indexes.lock() {
            if let Some((indexed_at, cached_mtime, map)) = indexes.get(&ab_root) {
                if *cached_mtime == dir_mtime {
                    if let Some(paths) = map.get(id) {
                        if paths.iter().any(|p| p.is_file()) {
                            return paths.clone();
                        }
                    } else if indexed_at.elapsed() < BUNDLE_INDEX_TTL {
                        return Vec::new();
                    }
                }
            }
        }

        let mut map: HashMap<String, Vec<PathBuf>> = HashMap::new();
        if let Ok(groups) = fs::read_dir(&ab_root) {
            for group in groups.flatten().take(MAX_CACHE_GROUPS) {
                if !group.file_type().is_ok_and(|t| t.is_dir()) {
                    continue;
                }
                let Ok(subs) = fs::read_dir(group.path()) else { continue };
                for sub in subs.flatten().take(64) {
                    if !sub.file_type().is_ok_and(|t| t.is_dir()) {
                        continue;
                    }
                    let name = sub.file_name();
                    let Some(bundle_id) = name.to_str() else { continue };
                    if bundle_id.len() != 32 || !bundle_id.bytes().all(|b| b.is_ascii_hexdigit()) {
                        continue;
                    }
                    let data_file = sub.path().join("__data");
                    if data_file.is_file() {
                        map.entry(bundle_id.to_owned()).or_default().push(data_file);
                    }
                }
            }
        }
        let result = map.get(id).cloned().unwrap_or_default();
        if let Ok(mut indexes) = self.bundle_indexes.lock() {
            if indexes.len() > 16 {
                indexes.clear();
            }
            indexes.insert(ab_root, (Instant::now(), dir_mtime, map));
        }
        result
    }

    fn catalog(&self, root: &Path, path: &Path) -> Option<Arc<Catalog>> {
        let path = PathGuard::ensure_within_root(root, path).ok()?;
        let meta = fs::metadata(&path).ok()?;
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let mut cache = self.catalogs.lock().ok()?;
        if let Some((time, size, catalog)) = cache.get(&path) {
            if *time == modified && *size == meta.len() {
                return Some(catalog.clone());
            }
        }
        let mut raw = read_limited(root, &path, CATALOG_LIMIT)?;
        if path.extension()?.eq_ignore_ascii_case("bundle") {
            raw = extract_addressables_json(&raw).ok()?;
        }
        let catalog = Arc::new(Catalog::parse(&raw)?);
        if cache.len() > 12 { cache.clear(); }
        cache.insert(path, (modified, meta.len(), catalog.clone()));
        Some(catalog)
    }

    fn artwork(&self, app: &AppHandle, installation: &str, asset: &str, spine_part: Option<&str>) -> Option<Vec<u8>> {
        let center = app.try_state::<ExtensionCenter>()?;
        let repo = GameRepository::new(center.db.clone());
        let games = repo.list_all().ok()?;
        let game = games.iter().find(|game| game.id == installation && game.is_valid)
            .or_else(|| games.iter().find(|game| game.platform == installation && game.is_valid))
            .or_else(|| games.iter().find(|game| game.is_primary && game.is_valid))
            .or_else(|| games.iter().find(|game| game.is_valid))?;
        let root = dunce::canonicalize(game_root(game).ok()?).ok()?;
        let executable = Path::new(game.executable_path.as_deref()?).file_stem()?.to_str()?;
        let data = PathGuard::ensure_within_root(&root, &root.join(format!("{executable}_Data"))).ok()?;
        let user_cache = dirs::data_local_dir().and_then(|path| {
            Some(path.parent()?.join("LocalLow/feimo").join(executable).join("com.unity.addressables"))
        });
        self.artwork_from_game(&data, user_cache.as_deref(), asset, spine_part)
    }

    fn artwork_from_game(&self, data: &Path, user_cache: Option<&Path>, asset: &str, spine_part: Option<&str>) -> Option<Vec<u8>> {
        let aa = data.join("StreamingAssets/aa");
        let local_cache = data.join("com.unity.addressables");
        let catalog_name = read_limited(data, &aa.join("settings.json"), 1024 * 1024)
            .and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
            .and_then(|settings| {
                settings.get("m_CatalogLocations")?.as_array()?.iter().find_map(|entry| {
                    let file = entry.get("m_InternalId")?.as_str()?.rsplit(['/', '\\']).next()?;
                    let version = file.strip_prefix("catalog_")?.strip_suffix(".hash")?;
                    (!version.is_empty() && version.bytes().all(|c| c.is_ascii_digit() || c == b'.'))
                        .then(|| format!("catalog_{version}.json"))
                })
            });
        let mut catalogs = Vec::new();
        if let Some(name) = catalog_name {
            for location in user_cache.into_iter().chain([local_cache.as_path()]) {
                let boundary = if location == local_cache { data } else { location };
                if let Some(catalog) = self.catalog(boundary, &location.join(&name)) {
                    catalogs.push(catalog);
                }
            }
        }
        if let Some(catalog) = self.catalog(data, &aa.join("catalog.bundle")) {
            catalogs.push(catalog);
        }
        let roots = user_cache.map(|path| (path, path)).into_iter().chain([(data, local_cache.as_path())]);
        let candidate_names = if spine_part.is_some() {
            vec![(asset.to_owned(), false)]
        } else {
            emoji_sheet_candidates(asset)
        };
        for (name, animated) in candidate_names {
            for cat in &catalogs {
                let Some(bundles) = cat.bundles(&name) else { continue };
                for bundle in bundles {
                    let local = aa.join("StandaloneWindows64").join(bundle);
                    let id = bundle.trim_end_matches(".bundle");
                    let mut candidates = Vec::new();
                    let is_cache_id = id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit());
                    if is_cache_id {
                        for (boundary, cache) in roots.clone() {
                            for file in self.cached_bundle_paths(boundary, cache, id) {
                                candidates.push((boundary, file));
                            }
                        }
                    }
                    candidates.push((data, local));
                    for (boundary, path) in candidates {
                        let Some(bytes) = read_limited(boundary, &path, BUNDLE_LIMIT) else { continue };
                        let decoded = match spine_part {
                            Some("skeleton.skel") => extract_text_asset(&bytes, &format!("{name}.skel")),
                            Some("atlas.atlas") => extract_text_asset(&bytes, &format!("{name}.atlas")),
                            Some(part) => extract_atlas_png(&bytes, part.strip_suffix(".png")?),
                            None if animated => extract_game_emote(&bytes, &name),
                            None => extract_texture_png_from_bundle(&bytes, &name),
                        };
                        if let Ok(png) = decoded { return Some(png); }
                    }
                }
            }
        }
        None
    }
}

fn artwork_request(path: &str) -> Option<(&str, &str, Option<&str>, &'static str)> {
    let mut path = path.strip_prefix('/')?.splitn(3, '/');
    let id = path.next()?;
    let asset = path.next()?;
    let part = path.next();
    if !valid_asset_name(asset) || id.len() > 100
        || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') {
        return None;
    }
    let mime = match part {
        Some(_) if !asset.starts_with("SpineHandCard_") => return None,
        Some("skeleton.skel") => "application/octet-stream",
        Some("atlas.atlas") => "text/plain; charset=utf-8",
        Some(page) if page.strip_suffix(".png").is_some_and(valid_asset_name) => "image/png",
        Some(_) => return None,
        None => "image/png",
    };
    Some((id, asset, part, mime))
}

pub(crate) fn respond(ctx: UriSchemeContext<'_, Wry>, request: http::Request<Vec<u8>>, response: UriSchemeResponder) {
    let app = ctx.app_handle().clone();
    let artwork = app.state::<GameArt>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let mut content = None;
        if request.method() == http::Method::GET {
            if let Some((id, asset, part, mime)) = artwork_request(request.uri().path()) {
                let (id, asset, part) = (id.to_owned(), asset.to_owned(), part.map(str::to_owned));
                let _permit = artwork.workers.clone().acquire_owned().await;
                content = tauri::async_runtime::spawn_blocking(move || {
                    artwork.artwork(&app, &id, &asset, part.as_deref()).map(|data| (data, mime))
                }).await.ok().flatten();
            }
        }
        let result = match content {
            Some((bytes, mime)) => http::Response::builder()
                .header("Content-Type", mime)
                .header("Cache-Control", "no-cache")
                .header("X-Content-Type-Options", "nosniff")
                .header("Access-Control-Allow-Origin", "http://tauri.localhost")
                .body(bytes),
            None => http::Response::builder().status(http::StatusCode::NOT_FOUND).body(Vec::new()),
        };
        if let Ok(result) = result { response.respond(result); }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_be_u32(buf: &mut Vec<u8>, v: u32) {
        buf.extend_from_slice(&v.to_be_bytes());
    }
    fn push_be_i32(buf: &mut Vec<u8>, v: i32) {
        buf.extend_from_slice(&v.to_be_bytes());
    }
    fn push_be_i64(buf: &mut Vec<u8>, v: i64) {
        buf.extend_from_slice(&v.to_be_bytes());
    }
    fn push_le_i32(buf: &mut Vec<u8>, v: i32) {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    fn push_le_u32(buf: &mut Vec<u8>, v: u32) {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    fn push_le_i64(buf: &mut Vec<u8>, v: i64) {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    fn align4(buf: &mut Vec<u8>) {
        while buf.len() % 4 != 0 {
            buf.push(0);
        }
    }

    fn build_text_asset_bundle(assets: &[(&str, &[u8])]) -> Vec<u8> {
        let mut obj_data = Vec::new();
        let mut obj_meta = Vec::new();
        for (idx, (name, script)) in assets.iter().enumerate() {
            let start = obj_data.len();
            push_le_i32(&mut obj_data, name.len() as i32);
            obj_data.extend_from_slice(name.as_bytes());
            align4(&mut obj_data);
            push_le_u32(&mut obj_data, script.len() as u32);
            obj_data.extend_from_slice(script);
            align4(&mut obj_data);
            let size = (obj_data.len() - start) as u32;
            obj_meta.push((idx as i64 + 1, start as i64, size));
        }

        let mut meta = Vec::new();
        meta.extend_from_slice(b"2022.3.0f1\0");
        push_le_i32(&mut meta, 19);
        meta.push(0); // enable_type_tree = false
        push_le_i32(&mut meta, 1); // type_count
        push_le_i32(&mut meta, 49); // TextAsset class_id
        meta.push(0); // is_stripped
        meta.extend_from_slice(&(-1i16).to_le_bytes()); // script_idx
        meta.extend_from_slice(&[0u8; 16]); // old_type_hash
        push_le_i32(&mut meta, obj_meta.len() as i32);
        align4(&mut meta);
        for (path_id, byte_start, byte_size) in obj_meta {
            push_le_i64(&mut meta, path_id);
            push_le_i64(&mut meta, byte_start);
            push_le_u32(&mut meta, byte_size);
            push_le_i32(&mut meta, 0);
        }

        let header_size = 48usize;
        let data_offset = (header_size + meta.len()).next_multiple_of(16);
        let mut cab = vec![0u8; data_offset + obj_data.len()];
        let total_file_sz = cab.len() as i64;
        let meta_sz = meta.len() as u32;
        cab[0..4].copy_from_slice(&meta_sz.to_be_bytes());
        cab[4..8].copy_from_slice(&(total_file_sz as u32).to_be_bytes());
        cab[8..12].copy_from_slice(&22u32.to_be_bytes());
        cab[12..16].copy_from_slice(&0u32.to_be_bytes());
        cab[16] = 0; // little endian
        cab[20..24].copy_from_slice(&meta_sz.to_be_bytes());
        cab[24..32].copy_from_slice(&total_file_sz.to_be_bytes());
        cab[32..40].copy_from_slice(&(data_offset as i64).to_be_bytes());
        cab[48..48 + meta.len()].copy_from_slice(&meta);
        cab[data_offset..].copy_from_slice(&obj_data);

        let mut blocks_info = Vec::new();
        blocks_info.extend_from_slice(&[0u8; 16]); // hash
        push_be_i32(&mut blocks_info, 1); // 1 block
        push_be_u32(&mut blocks_info, cab.len() as u32);
        push_be_u32(&mut blocks_info, cab.len() as u32);
        blocks_info.extend_from_slice(&0u16.to_be_bytes()); // uncompressed
        push_be_i32(&mut blocks_info, 1); // 1 node
        push_be_i64(&mut blocks_info, 0);
        push_be_i64(&mut blocks_info, cab.len() as i64);
        push_be_u32(&mut blocks_info, 4);
        blocks_info.extend_from_slice(b"CAB-test\0");

        let mut out = Vec::new();
        out.extend_from_slice(b"UnityFS\0");
        push_be_u32(&mut out, 6);
        out.extend_from_slice(b"5.x.x\0");
        out.extend_from_slice(b"2022.3.0f1\0");
        let size_pos = out.len();
        push_be_i64(&mut out, 0);
        push_be_u32(&mut out, blocks_info.len() as u32);
        push_be_u32(&mut out, blocks_info.len() as u32);
        push_be_u32(&mut out, 0);
        out.extend_from_slice(&blocks_info);
        out.extend_from_slice(&cab);
        let total = out.len() as i64;
        out[size_pos..size_pos + 8].copy_from_slice(&total.to_be_bytes());
        out
    }

    fn build_catalog_json(pairs: &[(&str, bool, &[&str])]) -> Vec<u8> {
        let mut internal_ids = Vec::<String>::new();
        let mut key_bytes = Vec::<u8>::new();
        let mut bucket_entries = Vec::<(u32, Vec<usize>)>::new();
        let mut entries_bytes = Vec::<u8>::new();
        let mut entry_count = 0u32;
        let mut entry_records = Vec::<(u32, i32)>::new();

        for (name, utf16, bundles) in pairs {
            let key_pos = key_bytes.len() as u32;
            if *utf16 {
                key_bytes.push(1);
                let units: Vec<u16> = name.encode_utf16().collect();
                key_bytes.extend_from_slice(&((units.len() * 2) as u32).to_le_bytes());
                for u in units {
                    key_bytes.extend_from_slice(&u.to_le_bytes());
                }
            } else {
                key_bytes.push(0);
                key_bytes.extend_from_slice(&(name.len() as u32).to_le_bytes());
                key_bytes.extend_from_slice(name.as_bytes());
            }
            let mut idxs = Vec::new();
            for b in *bundles {
                let internal_idx = internal_ids
                    .iter()
                    .position(|id| id == b)
                    .unwrap_or_else(|| {
                        internal_ids.push((*b).to_string());
                        internal_ids.len() - 1
                    }) as u32;
                idxs.push(entry_count as usize);
                entry_records.push((internal_idx, -1));
                entry_count += 1;
            }
            bucket_entries.push((key_pos, idxs));
        }

        entries_bytes.extend_from_slice(&entry_count.to_le_bytes());
        for (internal, dep) in entry_records {
            entries_bytes.extend_from_slice(&internal.to_le_bytes());
            entries_bytes.extend_from_slice(&0u32.to_le_bytes());
            entries_bytes.extend_from_slice(&dep.to_le_bytes());
            entries_bytes.extend_from_slice(&[0u8; 16]);
        }

        let mut bucket_bytes = Vec::<u8>::new();
        bucket_bytes.extend_from_slice(&(bucket_entries.len() as u32).to_le_bytes());
        for (key_pos, idxs) in bucket_entries {
            bucket_bytes.extend_from_slice(&key_pos.to_le_bytes());
            bucket_bytes.extend_from_slice(&(idxs.len() as u32).to_le_bytes());
            for idx in idxs {
                bucket_bytes.extend_from_slice(&(idx as u32).to_le_bytes());
            }
        }

        serde_json::to_vec(&serde_json::json!({
            "m_InternalIds": internal_ids,
            "m_KeyDataString": STANDARD.encode(&key_bytes),
            "m_BucketDataString": STANDARD.encode(&bucket_bytes),
            "m_EntryDataString": STANDARD.encode(&entries_bytes),
        }))
        .unwrap()
    }

    #[test]
    fn parses_catalog_with_utf8_and_utf16_keys() {
        let long_utf16_name = format!("UT_HandCard_{}", "a".repeat(90));
        let raw = build_catalog_json(&[
            ("UT_HandCard_10001", false, &["aa/a0000000000000000000000000000001.bundle"]),
            (&long_utf16_name, true, &[r"aa\b0000000000000000000000000000002.bundle"]),
        ]);
        let catalog = Catalog::parse(&raw).unwrap();
        assert_eq!(catalog.bundles("UT_HandCard_10001"), Some(vec!["a0000000000000000000000000000001.bundle"]));
        assert_eq!(catalog.bundles(&long_utf16_name), Some(vec!["b0000000000000000000000000000002.bundle"]));
    }

    #[test]
    fn validates_artwork_request_routes_and_rejects_invalid_paths() {
        assert_eq!(
            artwork_request("/primary/UT_HandCard_10001"),
            Some(("primary", "UT_HandCard_10001", None, "image/png"))
        );
        assert_eq!(
            artwork_request("/STEAM_CN/SpineHandCard_13020001/skeleton.skel"),
            Some(("STEAM_CN", "SpineHandCard_13020001", Some("skeleton.skel"), "application/octet-stream"))
        );
        assert_eq!(
            artwork_request("/STEAM_CN/SpineHandCard_13020001/atlas.atlas"),
            Some(("STEAM_CN", "SpineHandCard_13020001", Some("atlas.atlas"), "text/plain; charset=utf-8"))
        );
        assert_eq!(
            artwork_request("/STEAM_CN/SpineHandCard_13020001/SpineHandCard_13020001.png"),
            Some(("STEAM_CN", "SpineHandCard_13020001", Some("SpineHandCard_13020001.png"), "image/png"))
        );
        assert!(artwork_request("/primary/UT_HandCard_10001/atlas.atlas").is_none());
        assert!(artwork_request("/../UT_HandCard_10001").is_none());
        assert!(artwork_request("/primary/SpineHandCard_13020001/../../secret.png").is_none());
    }

    #[test]
    fn emoji_candidates_expand_unpadded_slot_and_fallback() {
        assert_eq!(
            emoji_sheet_candidates("UT_Item_Emoji_114_09"),
            vec![
                ("VEmoji_114_09".to_string(), true),
                ("VEmoji_114_9".to_string(), true),
                ("UT_Item_Emoji_114_09".to_string(), false),
            ]
        );
        assert_eq!(
            emoji_sheet_candidates("UT_Item_Emoji_101_10"),
            vec![
                ("VEmoji_101_10".to_string(), true),
                ("UT_Item_Emoji_101_10".to_string(), false),
            ]
        );
    }

    #[test]
    fn resolves_over_512_cache_groups_and_falls_back_to_builtin_catalog() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("Game_Data");
        let aa = data.join("StreamingAssets/aa");
        let standalone = aa.join("StandaloneWindows64");
        let user_cache = dir.path().join("UserCache");
        fs::create_dir_all(&standalone).unwrap();
        fs::create_dir_all(&user_cache).unwrap();

        fs::write(
            aa.join("settings.json"),
            r#"{"m_CatalogLocations":[{"m_InternalId":"{App.WebServerConfig.Path}\\catalog_1.0.hash"}]}"#,
        )
        .unwrap();

        let cached_bundle_id = "0123456789abcdef0123456789abcdef";
        let fallback_bundle_id = "fedcba9876543210fedcba9876543210";

        let hot_catalog = build_catalog_json(&[
            ("SpineHandCard_13029999", false, &[&format!("{cached_bundle_id}.bundle")]),
            ("SpineHandCard_13028888", false, &["deadbeefdeadbeefdeadbeefdeadbeef.bundle"]),
        ]);
        fs::write(user_cache.join("catalog_1.0.json"), hot_catalog).unwrap();

        let builtin_catalog = build_catalog_json(&[
            ("SpineHandCard_13028888", false, &[&format!("{fallback_bundle_id}.bundle")]),
        ]);
        let builtin_catalog_bundle = build_text_asset_bundle(&[("catalog", &builtin_catalog)]);
        fs::write(aa.join("catalog.bundle"), builtin_catalog_bundle).unwrap();

        // Populate 600 cache groups so the target sits well past the old 512 cutoff.
        let ab_root = user_cache.join("AssetBundles");
        for i in 0..600 {
            let group_dir = ab_root.join(format!("group_{i:04}"));
            if i == 580 {
                let target_dir = group_dir.join(cached_bundle_id);
                fs::create_dir_all(&target_dir).unwrap();
                let bundle = build_text_asset_bundle(&[("SpineHandCard_13029999.atlas", b"cached-atlas")]);
                fs::write(target_dir.join("__data"), bundle).unwrap();
            } else {
                fs::create_dir_all(&group_dir).unwrap();
            }
        }

        let builtin_asset = build_text_asset_bundle(&[("SpineHandCard_13028888.atlas", b"builtin-fallback-atlas")]);
        fs::write(standalone.join(format!("{fallback_bundle_id}.bundle")), builtin_asset).unwrap();

        let reader = GameArt::default();
        assert_eq!(
            reader.artwork_from_game(&data, Some(&user_cache), "SpineHandCard_13029999", Some("atlas.atlas")),
            Some(b"cached-atlas".to_vec()),
            "should find bundle beyond 512 cache groups"
        );
        assert_eq!(
            reader.artwork_from_game(&data, Some(&user_cache), "SpineHandCard_13028888", Some("atlas.atlas")),
            Some(b"builtin-fallback-atlas".to_vec()),
            "should fall back to built-in catalog.bundle when hot-update bundle is missing locally"
        );
    }

    #[test]
    #[ignore = "requires real Steam data and its current Unity catalog"]
    fn reads_local_steam_artwork() {
        let data = PathBuf::from(std::env::var_os("XINGSHU_ART_TEST_STEAM_DATA").unwrap());
        let cache = PathBuf::from(std::env::var_os("XINGSHU_ART_TEST_STEAM_CACHE").unwrap());
        let reader = GameArt::default();

        // 1. Built-in LZMA catalog.bundle decompression & standalone fallback
        let base = data.join("StreamingAssets/aa/catalog.bundle");
        let base_catalog = reader.catalog(&data, &base).expect("bundled LZMA catalog.bundle");
        println!("catalog.bundle parsed: keys={}, ids={}", base_catalog.keys.len(), base_catalog.internal_ids.len());
        assert!(base_catalog.keys.len() > 5000);

        let isolated = tempfile::tempdir().unwrap();
        let iso_data = isolated.path().join("AstralParty_CN_Data");
        let iso_aa = iso_data.join("StreamingAssets/aa");
        let iso_sw = iso_aa.join("StandaloneWindows64");
        fs::create_dir_all(&iso_sw).unwrap();
        fs::copy(data.join("StreamingAssets/aa/settings.json"), iso_aa.join("settings.json")).unwrap();
        fs::copy(&base, iso_aa.join("catalog.bundle")).unwrap();
        for asset in ["UT_HandCard_10001", "UT_Relic_Attack", "UT_MapPreview_003", "UT_AccountHeadShot_70901", "SpineHandCard_13020001"] {
            for b in base_catalog.bundles(asset).unwrap() {
                let src = data.join("StreamingAssets/aa/StandaloneWindows64").join(b);
                if src.is_file() {
                    fs::copy(src, iso_sw.join(b)).unwrap();
                }
            }
        }
        let iso_card = reader.artwork_from_game(&iso_data, None, "UT_HandCard_10001", None).expect("builtin standalone card");
        assert!(iso_card.starts_with(b"\x89PNG\r\n\x1a\n"));
        let iso_skel = reader.artwork_from_game(&iso_data, None, "SpineHandCard_13020001", Some("skeleton.skel")).expect("builtin standalone spine");
        assert!(!iso_skel.is_empty());
        println!("builtin catalog standalone verified (card={}B, spine_skel={}B)", iso_card.len(), iso_skel.len());

        // 2. Full installation (hot-update cache + built-in): cards, characters, busts (>512 group idx), chips, maps, static & animated emotes
        for name in [
            "UT_HandCard_10001",
            "UT_IAltArt_13020001",
            "UT_AccountHeadShot_70901",
            "UT_Hero_Card_101_Max",
            "UT_Hero_Bust_104_03_0",
            "UT_Hero_Bust_130_0",
            "UT_Relic_Attack",
            "UT_Relic_50010",
            "UT_Buff_Dodge",
            "UT_MapPreview_003",
            "UT_MapScene_003",
            "UT_Mutator_60001",
            "UT_Platform_Card",
            "UT_Item_Emoji_130_05",
        ] {
            let image = reader.artwork_from_game(&data, Some(&cache), name, None).unwrap_or_else(|| panic!("missing {name}"));
            assert!(image.starts_with(b"\x89PNG\r\n\x1a\n"), "{name}");
            println!("PNG {name}: {} bytes", image.len());
        }

        // 3. Animated heart emotes (including cache group > 512 and unpadded VEmoji_114_9)
        for emote in ["UT_Item_Emoji_101_09", "UT_Item_Emoji_105_09", "UT_Item_Emoji_114_09", "UT_Item_Emoji_120_09"] {
            let animated = reader.artwork_from_game(&data, Some(&cache), emote, None).unwrap_or_else(|| panic!("missing {emote}"));
            assert!(animated.starts_with(b"\x89PNG\r\n\x1a\n"), "{emote} png");
            assert!(animated.windows(4).any(|tag| tag == b"acTL"), "{emote} animated sheet missing acTL");
            println!("APNG {emote}: {} bytes", animated.len());
        }

        // 4. Spine cards: skeleton, atlas, and every referenced PNG page
        for spine in ["SpineHandCard_13020001", "SpineHandCard_13020013", "SpineHandCard_13021003"] {
            let skel = reader.artwork_from_game(&data, Some(&cache), spine, Some("skeleton.skel")).unwrap_or_else(|| panic!("missing {spine} skel"));
            let atlas = reader.artwork_from_game(&data, Some(&cache), spine, Some("atlas.atlas")).unwrap_or_else(|| panic!("missing {spine} atlas"));
            assert!(!skel.is_empty(), "{spine} skel empty");
            let atlas_text = String::from_utf8_lossy(&atlas);
            let pages: Vec<&str> = atlas_text.lines().map(str::trim).filter(|l| l.ends_with(".png")).collect();
            assert!(!pages.is_empty(), "{spine} atlas missing png page");
            for p in &pages {
                assert!(artwork_request(&format!("/primary/{spine}/{p}")).is_some(), "invalid route for {spine}/{p}");
                let page = reader.artwork_from_game(&data, Some(&cache), spine, Some(p)).unwrap_or_else(|| panic!("missing {spine}/{p}"));
                assert!(page.starts_with(b"\x89PNG\r\n\x1a\n"), "{spine}/{p}");
            }
            println!("Spine {spine}: skel={}B, atlas={}B, pages={pages:?}", skel.len(), atlas.len());
        }
    }
}
