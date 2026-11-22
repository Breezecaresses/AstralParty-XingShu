use std::path::{Component, Path, PathBuf};
use crate::domain::error::{HubError, HubResult};

pub struct PathGuard;

impl PathGuard {
    /// Validates an archive relative path or logical target path against Zip Slip and traversal attempts.
    pub fn sanitize_relative_path(path_str: &str) -> HubResult<PathBuf> {
        let clean_str = path_str.replace('\\', "/");

        // Reject UNC paths
        if clean_str.starts_with("//") || clean_str.starts_with("\\\\") {
            return Err(HubError::security_violation("UNC paths are strictly prohibited in packages."));
        }

        // Reject Windows drive letters
        if clean_str.len() >= 2 && clean_str.chars().nth(1) == Some(':') {
            return Err(HubError::security_violation("Absolute drive paths are strictly prohibited in packages."));
        }

        let path = Path::new(&clean_str);

        // Disallow absolute paths
        if path.is_absolute() {
            return Err(HubError::security_violation("Absolute target paths are strictly prohibited."));
        }

        // Inspect components for directory traversal
        let mut normalized = PathBuf::new();
        for component in path.components() {
            match component {
                Component::Normal(part) => {
                    let s = part.to_string_lossy();
                    let stem = s.split('.').next().unwrap_or_default().trim_end().to_ascii_uppercase();
                    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
                        || ["COM", "LPT"].iter().any(|prefix| {
                            matches!(stem.strip_prefix(*prefix), Some("1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"))
                        });
                    if s.ends_with(['.', ' ']) || device
                        || s.chars().any(|c| c.is_control() || matches!(c, ':' | '<' | '>' | '"' | '|' | '?' | '*'))
                    {
                        return Err(HubError::security_violation("路径包含 Windows 不支持的文件名。"));
                    }
                    normalized.push(part);
                }
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err(HubError::security_violation("Path escape components are strictly prohibited."));
                }
                Component::CurDir => {}
            }
        }

        if normalized.as_os_str().is_empty() {
            return Err(HubError::security_violation("Empty path after sanitization."));
        }

        Ok(normalized)
    }

    /// Confines a resolved path strictly within a base directory.
    pub fn ensure_within_root(base: &Path, candidate: &Path) -> HubResult<PathBuf> {
        let canonical_base = Self::resolve_existing_prefix(base)?;
        
        let candidate_full = if candidate.is_relative() {
            canonical_base.join(candidate)
        } else {
            candidate.to_path_buf()
        };

        let canonical_candidate = Self::resolve_existing_prefix(&candidate_full)?;
        if !canonical_candidate.starts_with(&canonical_base) {
            return Err(HubError::security_violation(format!(
                "Path boundary escape detected: '{}' is outside base '{}'",
                canonical_candidate.display(),
                canonical_base.display()
            )));
        }
        Ok(canonical_candidate)
    }

    fn resolve_existing_prefix(path: &Path) -> HubResult<PathBuf> {
        let absolute = std::path::absolute(path)
            .map_err(|_| HubError::security_violation("无法读取目标路径。"))?;
        let mut ancestor = absolute.as_path();
        let mut missing = Vec::new();
        loop {
            match std::fs::symlink_metadata(ancestor) {
                Ok(_) => break,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    if let Some(name) = ancestor.file_name() {
                        missing.push(name.to_os_string());
                    }
                    ancestor = ancestor.parent().ok_or_else(|| HubError::security_violation("无法验证目标目录。"))?;
                }
                Err(_) => return Err(HubError::security_violation("无法读取目标路径。")),
            }
        }
        let mut canonical_candidate = dunce::canonicalize(ancestor)
            .map_err(|_| HubError::security_violation("无法解析目标路径。"))?;
        for name in missing.into_iter().rev() {
            canonical_candidate.push(name);
        }

        Ok(canonical_candidate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rejects_zip_slip() {
        assert!(PathGuard::sanitize_relative_path("../escape.dll").is_err());
        assert!(PathGuard::sanitize_relative_path("foo/../../bar.dll").is_err());
        assert!(PathGuard::sanitize_relative_path(r"..\windows\system32").is_err());
    }

    #[test]
    fn test_rejects_absolute_and_unc() {
        assert!(PathGuard::sanitize_relative_path("C:\\Windows\\notepad.exe").is_err());
        assert!(PathGuard::sanitize_relative_path("/etc/passwd").is_err());
        assert!(PathGuard::sanitize_relative_path("\\\\server\\share\\mod.dll").is_err());
    }

    #[test]
    fn test_accepts_clean_relative() {
        let res = PathGuard::sanitize_relative_path("xingshu/plugins/my_plugin.dll");
        assert!(res.is_ok());
        let res = PathGuard::sanitize_relative_path("game/mods/texture.png");
        assert!(res.is_ok());
    }

    #[test]
    fn rejects_windows_special_names_and_streams() {
        for path in ["data/art.bytes:metadata", "data/art.wav.", "data/NUL.txt", "data/COM1.webp", "data/image.webp "] {
            assert!(PathGuard::sanitize_relative_path(path).is_err());
        }
    }
}
