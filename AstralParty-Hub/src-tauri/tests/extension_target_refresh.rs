use astralparty_hub_lib::{
    domain::installation::GameInstallation,
    extension_center::list_targets,
    storage::{database::Database, repositories::GameRepository},
};
use chrono::Utc;
use std::fs;

#[test]
fn refresh_hides_a_missing_game_and_shows_it_when_restored() {
    let folder = tempfile::tempdir().unwrap();
    let db = Database::in_memory().unwrap();
    let repo = GameRepository::new(db.clone());
    let exe = folder.path().join("AstralParty_CN.exe");
    let assembly = folder.path().join("GameAssembly.dll");
    let now = Utc::now();
    let target = GameInstallation {
        id: "saved-target".into(),
        platform: "STEAM_CN".into(),
        platform_app_id: None,
        install_path: folder.path().display().to_string(),
        executable_path: Some(exe.display().to_string()),
        detected_build_id: None,
        detected_version: None,
        detection_method: "CHANNEL_DIRECTORY".into(),
        is_valid: true,
        is_primary: false,
        last_verified_at: Some(now),
        created_at: now,
        updated_at: now,
    };
    repo.save(&target).unwrap();

    let contains_target = || list_targets(&db).unwrap().iter().any(|game| game.id == target.id);
    fs::write(&exe, []).unwrap();
    fs::write(&assembly, []).unwrap();
    assert!(contains_target());

    fs::remove_file(&assembly).unwrap();
    assert!(!contains_target());
    assert!(repo.list_all().unwrap().iter().any(|game| game.id == target.id));

    fs::write(&assembly, []).unwrap();
    assert!(contains_target());
}
