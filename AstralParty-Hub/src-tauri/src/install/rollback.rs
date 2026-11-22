use std::fs;
use std::path::Path;
use tracing::info;
use crate::domain::error::{HubError, HubResult};
use crate::domain::installation::Backup;
use crate::install::backup::BackupManifestData;
use crate::security::hash::compute_file_sha256;
use crate::storage::repositories::ExtensionRepository;

pub struct RollbackEngine;

impl RollbackEngine {
    pub fn execute_rollback(
        backup: &Backup,
        extension_repo: &ExtensionRepository,
    ) -> HubResult<()> {
        info!("Initiating rollback for transaction: {}", backup.id);

        let manifest_data: BackupManifestData = serde_json::from_value(backup.manifest_json.clone()).map_err(|e| {
            HubError::transaction_error(format!("Failed to parse backup manifest for rollback: {e}"))
        })?;

        for record in &manifest_data.files {
            let target_path = Path::new(&record.original_path);

            if record.existed_before {
                let backup_file = record.backup_path.as_deref().ok_or_else(|| {
                    HubError::transaction_error("未找到安装前备份。")
                })?;
                let parent = target_path.parent().ok_or_else(|| HubError::transaction_error("还原目标路径无效。"))?;
                let io_error = |error: std::io::Error| HubError::transaction_error(error.to_string());
                fs::create_dir_all(parent).map_err(io_error)?;
                let mut source = fs::File::open(backup_file).map_err(io_error)?;
                let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
                std::io::copy(&mut source, &mut staged).map_err(io_error)?;
                let digest = compute_file_sha256(staged.path())?;
                if !record.original_sha256.as_ref().is_some_and(|expected| expected.eq_ignore_ascii_case(&digest)) {
                    return Err(HubError::security_violation("还原使用的备份校验失败。"));
                }
                staged.as_file().sync_all().map_err(io_error)?;
                staged.persist(target_path).map_err(|error| io_error(error.error))?;
            } else if target_path.exists() {
                match fs::remove_file(target_path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(HubError::transaction_error(error.to_string())),
                }
            }
        }

        // Clean up installed_files entries for this package
        extension_repo.delete_installed_files_by_package(&manifest_data.package_id)?;

        info!("Rollback successfully completed for transaction: {}", backup.id);
        Ok(())
    }
}
