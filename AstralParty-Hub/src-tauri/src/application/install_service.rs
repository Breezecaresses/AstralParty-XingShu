use std::path::{Path, PathBuf};
use crate::domain::error::{HubError, HubResult};
use crate::domain::installation::{Backup, GameInstallation, InstallTransaction};
use crate::install::engine::InstallEngine;
use crate::install::rollback::RollbackEngine;
use crate::storage::database::Database;
use crate::storage::repositories::{BackupRepository, ExtensionRepository, GameRepository, TransactionRepository};

pub struct InstallService {
    engine: InstallEngine,
    game_repo: GameRepository,
    backup_repo: BackupRepository,
    tx_repo: TransactionRepository,
    extension_repo: ExtensionRepository,
}

impl InstallService {
    pub fn new(db: Database, backup_storage_root: PathBuf) -> Self {
        Self {
            engine: InstallEngine::new(db.clone(), backup_storage_root),
            game_repo: GameRepository::new(db.clone()),
            backup_repo: BackupRepository::new(db.clone()),
            tx_repo: TransactionRepository::new(db.clone()),
            extension_repo: ExtensionRepository::new(db),
        }
    }

    pub fn install_package_from_zip<P: AsRef<Path>>(&self, zip_path: P, installation_id: &str) -> HubResult<InstallTransaction> {
        let game = self.game_repo.list_all()?.into_iter().find(|g| g.id == installation_id)
            .ok_or_else(|| HubError::game_not_found("请选择具体渠道和安装位置。"))?;
        #[cfg(feature = "web-ui")]
        let _lock = crate::workshop::operation_lock(&crate::extension_center::game_root(&game)?)?;
        self.engine.install_package(zip_path, &game)
    }

    #[cfg(feature = "web-ui")]
    pub(crate) fn install_mod_package_in_locked_root(&self, archive: &Path, game: &GameInstallation) -> HubResult<InstallTransaction> {
        self.engine.install_package(archive, game)
    }

    pub fn rollback_transaction(&self, transaction_id: &str) -> HubResult<()> {
        self.rollback_verified(transaction_id, None)
    }

    #[cfg(feature = "web-ui")]
    pub(crate) fn rollback_mod_transaction(&self, transaction_id: &str, installation_id: &str) -> HubResult<()> {
        self.rollback_verified(transaction_id, Some(installation_id))
    }

    fn rollback_verified(&self, transaction_id: &str, selected: Option<&str>) -> HubResult<()> {
        let (owner, phase, replaced) = self.tx_repo.rollback_scope(transaction_id)?
            .ok_or_else(|| HubError::transaction_error("安装事务缺少有效的游戏目录关联。"))?;
        if selected.is_some_and(|id| id != owner) || replaced {
            return Err(HubError::security_violation("安装事务所属目录或当前状态已变化。"));
        }
        if phase == "ROLLED_BACK" {
            return Ok(());
        }
        let game = self.game_repo.list_all()?.into_iter().find(|g| g.id == owner)
            .ok_or_else(|| HubError::game_not_found("未找到安装事务对应的游戏目录。"))?;
        let root = crate::extension_center::game_root(&game)?;
        #[cfg(feature = "web-ui")]
        let _lock = if selected.is_none() { Some(crate::workshop::operation_lock(&root)?) } else { None };
        crate::install::gates::ProcessGate::check_target(Path::new(game.executable_path.as_deref().unwrap_or_default()))?;
        let backup = self.backup_repo.get_by_id(transaction_id)?.ok_or_else(|| {
            HubError::transaction_error(format!("No backup found matching transaction ID '{transaction_id}'"))
        })?;

        self.check_rollback_files(&game, &root, &backup)?;
        RollbackEngine::execute_rollback(&backup, &self.extension_repo)?;
        self.tx_repo.update_state(
            transaction_id,
            "ROLLED_BACK",
            Some(chrono::Utc::now()),
            Some("USER_ROLLBACK"),
            Some("User manually requested transaction rollback."),
        )?;
        Ok(())
    }

    fn check_rollback_files(&self, game: &GameInstallation, root: &Path, backup: &Backup) -> HubResult<()> {
        use crate::security::{hash::compute_file_sha256, path_guard::PathGuard};
        let manifest: crate::install::backup::BackupManifestData = serde_json::from_value(backup.manifest_json.clone())
            .map_err(|_| HubError::transaction_error("无法解析安装前备份清单。"))?;
        let installed = self.extension_repo.get_installed_files_by_package(&manifest.package_id)?;
        for file in &manifest.files {
            let target = InstallEngine::resolve_logical_target(root, &file.logical_target)?;
            let saved_target = PathGuard::ensure_within_root(root, Path::new(&file.original_path))?;
            if target != saved_target {
                return Err(HubError::security_violation("备份目标与所选游戏目录不一致。"));
            }
            let current = if target.is_file() { Some(compute_file_sha256(&target)?) } else { None };
            let same_as_baseline = !target.exists() && !file.existed_before
                || current.as_ref().zip(file.original_sha256.as_ref())
                    .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b));
            let same_as_installed = installed.iter().any(|entry| {
                Path::new(&entry.target_path) == target
                    && current.as_ref().is_some_and(|sha| sha.eq_ignore_ascii_case(&entry.installed_sha256))
            });
            if !same_as_baseline && !same_as_installed {
                return Err(HubError::security_violation("游戏文件已更新或被其他模组修改，已停止还原。"));
            }
            if file.existed_before {
                let source = file.backup_path.as_deref()
                    .ok_or_else(|| HubError::transaction_error("原版文件备份缺失。"))?;
                let source = PathGuard::ensure_within_root(Path::new(&backup.storage_path), Path::new(source))?;
                let sha = compute_file_sha256(source)?;
                if !file.original_sha256.as_ref().is_some_and(|expected| expected.eq_ignore_ascii_case(&sha)) {
                    return Err(HubError::security_violation("原版文件备份校验失败。"));
                }
            }
        }
        crate::install::gates::ProcessGate::check_target(Path::new(game.executable_path.as_deref().unwrap_or_default()))
    }

    pub fn list_transactions(&self, limit: usize) -> HubResult<Vec<InstallTransaction>> {
        self.tx_repo.list_recent(limit)
    }

    pub fn list_backups(&self) -> HubResult<Vec<Backup>> {
        self.backup_repo.list_all()
    }

    pub fn recover_crashes(&self) -> HubResult<Vec<String>> {
        self.engine.recover_interrupted_transactions()
    }
}
