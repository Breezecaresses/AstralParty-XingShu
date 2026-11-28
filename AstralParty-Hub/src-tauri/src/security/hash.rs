use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use crate::domain::error::{HubError, HubResult};

type FileHashCacheEntry = (u64, u128, String);

fn file_hash_cache() -> &'static Mutex<HashMap<PathBuf, FileHashCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, FileHashCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn compute_sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn compute_file_sha256<P: AsRef<Path>>(path: P) -> HubResult<String> {
    let path = path.as_ref();
    let meta = std::fs::metadata(path).ok();
    let cache_sig = meta.and_then(|m| {
        let len = m.len();
        let ns = m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
        Some((len, ns))
    });
    if let Some((len, ns)) = cache_sig {
        let guard = file_hash_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some((cached_len, cached_ns, cached_hash)) = guard.get(path) {
            if *cached_len == len && *cached_ns == ns {
                return Ok(cached_hash.clone());
            }
        }
    }

    let file = File::open(path).map_err(|e| {
        HubError::new("FILE_READ_ERROR", format!("Failed to open file for SHA256 computation: {e}"), "SECURITY")
    })?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let count = reader.read(&mut buffer).map_err(|e| {
            HubError::new("FILE_READ_ERROR", format!("Failed to read stream for SHA256 computation: {e}"), "SECURITY")
        })?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    let digest = hex::encode(hasher.finalize());
    if let Some((len, ns)) = cache_sig {
        let mut guard = file_hash_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.len() >= 512 {
            guard.clear();
        }
        guard.insert(path.to_path_buf(), (len, ns, digest.clone()));
    }
    Ok(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_sha256_uses_size_mtime_cache_and_invalidates_on_change() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sample.bin");
        std::fs::write(&file, b"astral-first-payload").unwrap();

        let h1 = compute_file_sha256(&file).unwrap();
        assert_eq!(h1, compute_sha256_bytes(b"astral-first-payload"));

        let h2 = compute_file_sha256(&file).unwrap();
        assert_eq!(h2, h1);

        std::fs::write(&file, b"astral-updated-payload-v2").unwrap();
        let h3 = compute_file_sha256(&file).unwrap();
        assert_ne!(h3, h1);
        assert_eq!(h3, compute_sha256_bytes(b"astral-updated-payload-v2"));
    }
}
