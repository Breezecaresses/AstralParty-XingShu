//! Safe local cache inspection and cleanup for XingShu Hub.
//! Never deletes user accounts/sessions, SQLite database, launcher config, or mod backups/receipts.

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use crate::domain::error::HubResult;
use crate::extension_center::ExtensionCenter;
use crate::game::detector::GameDetector;
use crate::storage::repositories::GameRepository;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheCategorySummary {
    pub key: String,
    pub label: String,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSummary {
    pub total_bytes: u64,
    pub total_files: u64,
    pub categories: Vec<CacheCategorySummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheCleanupResult {
    pub freed_bytes: u64,
    pub removed_files: u64,
    pub skipped_locked_files: u64,
    pub remaining_bytes: u64,
    pub remaining_files: u64,
    pub categories: Vec<CacheCategorySummary>,
}

enum CacheTargetKind {
    Dir(PathBuf),
    File(PathBuf),
}

struct CacheSpec {
    key: &'static str,
    label: &'static str,
    targets: Vec<CacheTargetKind>,
}

fn measure_path(path: &Path) -> (u64, u64) {
    if path.is_file() {
        let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        return (size, 1);
    }
    if !path.is_dir() {
        return (0, 0);
    }
    let mut bytes = 0u64;
    let mut files = 0u64;
    let Ok(entries) = fs::read_dir(path) else {
        return (0, 0);
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            let (sub_b, sub_f) = measure_path(&p);
            bytes += sub_b;
            files += sub_f;
        } else if p.is_file() {
            bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
            files += 1;
        }
    }
    (bytes, files)
}

fn remove_dir_contents(dir: &Path, remove_self: bool) -> (u64, u64, u64) {
    if !dir.is_dir() {
        return (0, 0, 0);
    }
    let mut freed = 0u64;
    let mut removed = 0u64;
    let mut skipped = 0u64;
    let Ok(entries) = fs::read_dir(dir) else {
        return (0, 0, 0);
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            let (f, r, s) = remove_dir_contents(&p, true);
            freed += f;
            removed += r;
            skipped += s;
        } else if p.is_file() {
            let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if fs::remove_file(&p).is_ok() {
                freed += len;
                removed += 1;
            } else {
                skipped += 1;
            }
        }
    }
    if remove_self {
        let _ = fs::remove_dir(dir);
    }
    (freed, removed, skipped)
}

fn remove_target(target: &CacheTargetKind) -> (u64, u64, u64) {
    match target {
        CacheTargetKind::File(path) => {
            if !path.is_file() {
                return (0, 0, 0);
            }
            let len = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            if fs::remove_file(path).is_ok() {
                (len, 1, 0)
            } else {
                (0, 0, 1)
            }
        }
        CacheTargetKind::Dir(dir) => remove_dir_contents(dir, false),
    }
}

fn collect_game_payload_caches(center: &ExtensionCenter) -> Vec<CacheTargetKind> {
    let mut seen = HashSet::<String>::new();
    let mut dirs = Vec::new();
    let mut push_root = |root: PathBuf| {
        let cache = root.join(".xingshu-mods").join("payload-cache");
        let norm = cache.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
        if seen.insert(norm) {
            dirs.push(CacheTargetKind::Dir(cache));
        }
    };

    if let Ok(list) = GameRepository::new(center.db.clone()).list_all() {
        for game in list {
            if let Some(exe) = game.executable_path.as_deref() {
                if let Some(parent) = Path::new(exe).parent() {
                    push_root(parent.to_path_buf());
                    continue;
                }
            }
            if !game.install_path.is_empty() {
                push_root(PathBuf::from(&game.install_path));
            }
        }
    }
    if let Some(detected) = GameDetector::detect_game() {
        push_root(PathBuf::from(detected.install_path));
    }
    dirs
}

fn collect_specs(app: &AppHandle, center: &ExtensionCenter) -> Vec<CacheSpec> {
    let mut specs = Vec::new();

    if let Ok(app_data) = app.path().app_data_dir() {
        specs.push(CacheSpec {
            key: "mod_preview_cache",
            label: "模组图片与立绘预览缓存",
            targets: vec![CacheTargetKind::Dir(app_data.join("mod-preview-cache"))],
        });
        specs.push(CacheSpec {
            key: "staged_drops",
            label: "本地导入暂存文件",
            targets: vec![CacheTargetKind::Dir(app_data.join("staged-drops"))],
        });
    }

    if let Some(local_data) = dirs::data_local_dir() {
        specs.push(CacheSpec {
            key: "manifest_cache",
            label: "核心更新清单与安卓安装日志",
            targets: vec![
                CacheTargetKind::File(local_data.join("XingShu-Hub").join("core-manifest-cache.json")),
                CacheTargetKind::Dir(local_data.join("XingShu").join("Logs")),
            ],
        });
    }

    if let Ok(app_cache) = app.path().app_cache_dir() {
        specs.push(CacheSpec {
            key: "webview_cache",
            label: "桌面端界面与页面缓存",
            targets: vec![CacheTargetKind::Dir(app_cache)],
        });
    }

    specs.push(CacheSpec {
        key: "workshop_payload_cache",
        label: "游戏目录工坊下载包缓存",
        targets: collect_game_payload_caches(center),
    });

    specs
}

fn summarize_specs(specs: &[CacheSpec]) -> CacheSummary {
    let mut total_bytes = 0u64;
    let mut total_files = 0u64;
    let mut categories = Vec::with_capacity(specs.len());
    for spec in specs {
        let mut cat_bytes = 0u64;
        let mut cat_files = 0u64;
        for target in &spec.targets {
            let (b, f) = match target {
                CacheTargetKind::File(p) => measure_path(p),
                CacheTargetKind::Dir(p) => measure_path(p),
            };
            cat_bytes += b;
            cat_files += f;
        }
        total_bytes += cat_bytes;
        total_files += cat_files;
        categories.push(CacheCategorySummary {
            key: spec.key.to_string(),
            label: spec.label.to_string(),
            bytes: cat_bytes,
            files: cat_files,
        });
    }
    CacheSummary {
        total_bytes,
        total_files,
        categories,
    }
}

#[tauri::command]
pub async fn get_hub_cache_summary(
    app: AppHandle,
    center: State<'_, ExtensionCenter>,
) -> HubResult<CacheSummary> {
    Ok(summarize_specs(&collect_specs(&app, &center)))
}

#[tauri::command]
pub async fn clear_hub_caches(
    app: AppHandle,
    center: State<'_, ExtensionCenter>,
) -> HubResult<CacheCleanupResult> {
    let specs = collect_specs(&app, &center);
    let mut freed_bytes = 0u64;
    let mut removed_files = 0u64;
    let mut skipped_locked_files = 0u64;
    for spec in &specs {
        for target in &spec.targets {
            let (f, r, s) = remove_target(target);
            freed_bytes += f;
            removed_files += r;
            skipped_locked_files += s;
        }
    }
    let after = summarize_specs(&specs);
    Ok(CacheCleanupResult {
        freed_bytes,
        removed_files,
        skipped_locked_files,
        remaining_bytes: after.total_bytes,
        remaining_files: after.total_files,
        categories: after.categories,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_cache_targets_removes_cached_files_and_preserves_siblings() {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("app-data");
        let preview = data_dir.join("mod-preview-cache");
        let backups = data_dir.join("backups");
        fs::create_dir_all(preview.join("sub")).unwrap();
        fs::create_dir_all(&backups).unwrap();
        fs::write(data_dir.join("xingshu_hub.db"), b"keep-db").unwrap();
        fs::write(backups.join("vanilla.bak"), b"keep-backup").unwrap();
        fs::write(preview.join("a.png"), vec![1u8; 128]).unwrap();
        fs::write(preview.join("sub").join("b.png"), vec![2u8; 256]).unwrap();

        let game_dir = root.path().join("game");
        let payload_cache = game_dir.join(".xingshu-mods").join("payload-cache");
        let workshop_backups = game_dir.join(".xingshu-mods").join("workshop-backups");
        fs::create_dir_all(&payload_cache).unwrap();
        fs::create_dir_all(&workshop_backups).unwrap();
        fs::write(payload_cache.join("abc.bundle"), vec![3u8; 512]).unwrap();
        fs::write(workshop_backups.join("keep.bundle"), b"keep-vanilla").unwrap();

        let specs = vec![
            CacheSpec {
                key: "mod_preview_cache",
                label: "preview",
                targets: vec![CacheTargetKind::Dir(preview.clone())],
            },
            CacheSpec {
                key: "workshop_payload_cache",
                label: "payload",
                targets: vec![CacheTargetKind::Dir(payload_cache.clone())],
            },
        ];

        let before = summarize_specs(&specs);
        assert_eq!(before.total_bytes, 128 + 256 + 512);
        assert_eq!(before.total_files, 3);

        let mut freed = 0u64;
        let mut removed = 0u64;
        for s in &specs {
            for t in &s.targets {
                let (f, r, _) = remove_target(t);
                freed += f;
                removed += r;
            }
        }
        assert_eq!(freed, 896);
        assert_eq!(removed, 3);

        let after = summarize_specs(&specs);
        assert_eq!(after.total_bytes, 0);
        assert_eq!(after.total_files, 0);
        assert!(data_dir.join("xingshu_hub.db").is_file());
        assert!(backups.join("vanilla.bak").is_file());
        assert!(workshop_backups.join("keep.bundle").is_file());
    }
}
