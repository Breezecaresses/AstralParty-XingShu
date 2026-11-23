use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use crate::{
    domain::error::{HubError, HubResult},
    security::hash::{compute_file_sha256, compute_sha256_bytes},
};

const MAX_RESOURCE_BYTES: u64 = 1024 * 1024 * 1024;

pub(crate) struct SwitchFile {
    pub target: PathBuf,
    pub baseline: PathBuf,
    pub payload: PathBuf,
    pub baseline_sha256: String,
    pub mod_sha256: String,
}

pub(crate) fn target_key(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn io_error(error: std::io::Error) -> HubError {
    HubError::storage_error(error.to_string())
}

fn read_verified(path: &Path, expected: &str) -> HubResult<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(io_error)?
        .take(MAX_RESOURCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > MAX_RESOURCE_BYTES || !compute_sha256_bytes(&bytes).eq_ignore_ascii_case(expected) {
        return Err(HubError::security_violation("资源文件大小或哈希校验失败。"));
    }
    Ok(bytes)
}

fn verify_file(path: &Path, expected: &str) -> HubResult<()> {
    if fs::metadata(path).map_err(io_error)?.len() > MAX_RESOURCE_BYTES
        || !compute_file_sha256(path)?.eq_ignore_ascii_case(expected)
    {
        return Err(HubError::security_violation("模组缓存或原版备份校验失败。"));
    }
    Ok(())
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> HubResult<()> {
    let parent = path.parent().ok_or_else(|| HubError::storage_error("无效的资源文件路径。"))?;
    fs::create_dir_all(parent).map_err(io_error)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
    temporary.write_all(bytes).map_err(io_error)?;
    temporary.as_file().sync_all().map_err(io_error)?;
    temporary.persist(path).map_err(|e| io_error(e.error))?;
    Ok(())
}

/// Check every target before writing. Record a legacy payload only from a verified active file.
pub(crate) fn set_enabled(files: &[SwitchFile], enabled: bool) -> HubResult<()> {
    if files.is_empty() {
        return Err(HubError::invalid_manifest("没有可切换的模组资源。"));
    }
    let mut seen = HashSet::new();
    let mut changes = Vec::new();
    for file in files {
        if !seen.insert(target_key(&file.target.to_string_lossy())) {
            return Err(HubError::invalid_manifest("模组收据包含重复的资源目标。"));
        }
        let absent_baseline = file.baseline_sha256.is_empty();
        let is_mod = if file.target.is_file() {
            let current = compute_file_sha256(&file.target)?;
            let matched_mod = current.eq_ignore_ascii_case(&file.mod_sha256);
            if !matched_mod && (absent_baseline || !current.eq_ignore_ascii_case(&file.baseline_sha256)) {
                return Err(HubError::security_violation("游戏资源已被更新或由其他模组修改，已停止切换。"));
            }
            matched_mod
        } else if absent_baseline {
            false
        } else {
            return Err(HubError::storage_error("目标游戏资源文件不存在，无法切换。"));
        };
        if !absent_baseline {
            verify_file(&file.baseline, &file.baseline_sha256)?;
        }
        if !file.payload.is_file() && is_mod {
            let bytes = read_verified(&file.target, &file.mod_sha256)?;
            atomic_write(&file.payload, &bytes)?;
        }
        verify_file(&file.payload, &file.mod_sha256)?;
        if is_mod != enabled {
            changes.push(file);
        }
    }

    let mut written: Vec<(&PathBuf, &PathBuf, &String, &String)> = Vec::new();
    for file in changes {
        let absent_baseline = file.baseline_sha256.is_empty();
        let (from, from_sha, to, to_sha) = if enabled {
            (&file.baseline, &file.baseline_sha256, &file.payload, &file.mod_sha256)
        } else {
            (&file.payload, &file.mod_sha256, &file.baseline, &file.baseline_sha256)
        };
        let result = (|| {
            if enabled {
                let bytes = read_verified(to, to_sha)?;
                if absent_baseline {
                    if file.target.exists() {
                        return Err(HubError::security_violation("目标位置已存在同名文件，已停止启用。"));
                    }
                } else {
                    verify_file(&file.target, from_sha)?;
                }
                atomic_write(&file.target, &bytes)?;
                written.push((&file.target, from, from_sha, to_sha));
                verify_file(&file.target, to_sha)
            } else {
                verify_file(&file.target, from_sha)?;
                if absent_baseline {
                    fs::remove_file(&file.target).map_err(io_error)?;
                    written.push((&file.target, from, from_sha, to_sha));
                    Ok(())
                } else {
                    let bytes = read_verified(to, to_sha)?;
                    atomic_write(&file.target, &bytes)?;
                    written.push((&file.target, from, from_sha, to_sha));
                    verify_file(&file.target, to_sha)
                }
            }
        })();
        if let Err(error) = result {
            let mut rollback_failed = false;
            for (target, previous, previous_sha, new_sha) in written.into_iter().rev() {
                let rollback = if previous_sha.is_empty() {
                    if target.is_file() {
                        fs::remove_file(target).map_err(io_error)
                    } else {
                        Ok(())
                    }
                } else {
                    read_verified(previous, previous_sha).and_then(|bytes| {
                        if !new_sha.is_empty() && target.is_file() {
                            verify_file(target, new_sha)?;
                        }
                        atomic_write(target, &bytes)
                    })
                };
                rollback_failed |= rollback.is_err();
            }
            return if rollback_failed {
                Err(HubError::storage_error(format!("{error}；部分资源待恢复，已保留收据和备份。")))
            } else {
                Err(error)
            };
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_all_targets_before_disabling_and_retains_payload() {
        let temp = tempfile::tempdir().unwrap();
        let file = |name: &str, live: &[u8]| {
            let target = temp.path().join(name);
            let baseline = target.with_extension("original");
            let payload = target.with_extension("mod");
            fs::write(&target, live).unwrap();
            fs::write(&baseline, b"original").unwrap();
            SwitchFile {
                target, baseline, payload,
                baseline_sha256: compute_sha256_bytes(b"original"),
                mod_sha256: compute_sha256_bytes(b"mod"),
            }
        };
        let files = [file("first.bundle", b"mod"), file("second.bundle", b"updated")];
        assert!(set_enabled(&files, false).is_err());
        assert_eq!(fs::read(&files[0].target).unwrap(), b"mod");
        assert_eq!(fs::read(&files[1].target).unwrap(), b"updated");
        fs::write(&files[1].target, b"mod").unwrap();
        set_enabled(&files, false).unwrap();
        assert_eq!(fs::read(&files[0].target).unwrap(), b"original");
        set_enabled(&files, true).unwrap();
        assert_eq!(fs::read(&files[0].target).unwrap(), b"mod");
    }
}
