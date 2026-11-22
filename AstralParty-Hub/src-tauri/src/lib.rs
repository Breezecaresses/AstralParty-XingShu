pub mod application;
pub mod commands;
pub mod diagnostics;
pub mod domain;
pub mod game;
pub mod game_library;
pub mod game_replay;
pub mod room_auto_enter;
pub mod extension_center;
pub mod install;
pub mod packages;
pub mod platform;
pub mod providers;
pub mod security;
pub mod storage;
pub mod xing_shu;

pub mod desktop_host;
#[cfg(feature = "web-ui")]
pub mod android_installer;
#[cfg(feature = "web-ui")]
pub mod external_mods;
#[cfg(feature = "web-ui")]
pub mod dropped_mods;
#[cfg(feature = "web-ui")]
pub mod mod_inspector;
mod game_art;
#[cfg(feature = "web-ui")]
pub mod workshop;
#[cfg(feature = "web-ui")]
pub mod app_update;
#[cfg(feature = "web-ui")]
pub mod account_login;
#[cfg(feature = "web-ui")]
pub mod launcher;
#[cfg(feature = "web-ui")]
pub mod in_game_room;
#[cfg(feature = "web-ui")]
mod remote_content;
#[cfg(feature = "web-ui")]
mod mod_resources;
#[cfg(feature = "web-ui")]
mod module_panel;

#[cfg(feature = "web-ui")]
mod web_host {
use super::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tracing::info;

use application::{
    CatalogService, DiagnosticService, ExtensionService, GameService, InstallService, PlayerService,
};
use commands::*;
use diagnostics::logger::HubLogger;
use providers::imported_data::ImportedDataProvider;
use providers::orchestrator::ProviderOrchestrator;
use providers::registry::ProviderRegistry;
use providers::xing_shu_spectator::XingShuSpectatorProvider;
use storage::database::Database;
use xing_shu::bridge::server::BridgeServer;
use xing_shu::package_manager::service::XingShuPackageManager;
use xing_shu::spectator::service::SpectatorService;

struct SplashState {
    active: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
}

fn reveal_main_and_close_splash(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SplashState>() {
        state.active.store(false, Ordering::SeqCst);
    }
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.show();
        let _ = main_win.unminimize();
        let _ = main_win.set_focus();
        let _ = main_win.emit("xingshu:splash-finished", ());
    }
    if let Some(splash_win) = app.get_webview_window("splash") {
        let _ = splash_win.close();
    }
}

fn spawn_splash_watchdog(
    app: tauri::AppHandle,
    active: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    expected_gen: u64,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(5500)).await;
        if active.load(Ordering::SeqCst) && generation.load(Ordering::SeqCst) == expected_gen {
            reveal_main_and_close_splash(&app);
        }
    });
}

#[tauri::command]
fn finish_splash_and_show_main(app: tauri::AppHandle) {
    reveal_main_and_close_splash(&app);
}

#[tauri::command]
fn get_startup_splash_active(state: tauri::State<'_, SplashState>) -> bool {
    state.active.load(Ordering::SeqCst)
}

#[tauri::command]
fn replay_startup_splash(app: tauri::AppHandle, state: tauri::State<'_, SplashState>) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("splash") {
        if state.active.load(Ordering::SeqCst) {
            let _ = existing.set_focus();
            return Ok(());
        }
        let _ = existing.close();
    }

    let next_gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.active.store(true, Ordering::SeqCst);

    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.hide();
    }

    WebviewWindowBuilder::new(
        &app,
        "splash",
        WebviewUrl::App("index.html?window=splash&replay=1".into()),
    )
    .title("星枢启动器")
    .inner_size(260.0, 260.0)
    .center()
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(true)
    .build()
    .map_err(|e| e.to_string())?;

    spawn_splash_watchdog(app.clone(), state.active.clone(), state.generation.clone(), next_gen);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    HubLogger::init();
    info!("Starting XingShu Hub Core Backend...");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(game_art::GameArt::default())
        .register_asynchronous_uri_scheme_protocol("game-art", game_art::respond)
        .manage(module_panel::ModulePanelTarget::default())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(panel) = window.app_handle().get_webview_window(module_panel::LABEL) {
                    let _ = panel.close();
                }
            }
            if window.label() == "splash" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(state) = window.app_handle().try_state::<SplashState>() {
                    if state.active.load(Ordering::SeqCst) {
                        reveal_main_and_close_splash(window.app_handle());
                    }
                }
            }
        })
        .setup(|app| {
            let app_handle = app.handle();
            let app_data_dir = app_handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| dirs::data_dir().unwrap_or_default().join("xingshu-hub"));

            std::fs::create_dir_all(&app_data_dir).ok();

            // Seamless migration from legacy astral_party_hub.db if present
            let legacy_db = app_data_dir.join("astral_party_hub.db");
            let db_path = app_data_dir.join("xingshu_hub.db");
            if !db_path.exists() && legacy_db.exists() {
                info!("Migrating legacy database from {} to {}", legacy_db.display(), db_path.display());
                let _ = std::fs::copy(&legacy_db, &db_path);
            }

            let backup_dir = app_data_dir.join("backups");
            std::fs::create_dir_all(&backup_dir).ok();

            info!("Database file location: {}", db_path.display());
            info!("Backup storage location: {}", backup_dir.display());

            let db = Database::init(&db_path).expect("Failed to initialize XingShu Hub SQLite database");
            let game_library_store = game_library::GameLibraryStore::new(db.clone())?;
            let game_replay_store = game_replay::GameReplayStore::default();
            let room_auto_enter_store = room_auto_enter::RoomAutoEnterStore::default();
            let in_game_room_store = in_game_room::InGameRoomStore::default();

            let game_service = GameService::new(db.clone());
            let player_service = PlayerService::new(db.clone());
            let catalog_service = CatalogService::new(db.clone());
            let extension_service = ExtensionService::new(db.clone());
            let install_service = InstallService::new(db.clone(), backup_dir);
            let diagnostic_service = DiagnosticService::new(db.clone());

            // Startup Crash Recovery
            if let Ok(recovered) = install_service.recover_crashes() {
                if !recovered.is_empty() {
                    info!("Startup recovery: resolved {} interrupted transactions: {:?}", recovered.len(), recovered);
                }
            }

            // XingShu Core Subsystems: Bridge, Spectator, Package Manager
            let offline_replay = cfg!(debug_assertions) && (std::env::var("XINGSHU_OFFLINE_REPLAY").is_ok()
                || std::env::args().any(|arg| arg == "--offline-replay"));
            let bridge_server = if offline_replay {
                info!("XingShu Hub starting in OFFLINE REPLAY mode (test security policy enabled)");
                Arc::new(BridgeServer::new_test())
            } else {
                Arc::new(BridgeServer::new())
            };
            bridge_server.set_game_library_store(game_library_store.clone());
            bridge_server.set_game_replay_store(game_replay_store.clone());
            bridge_server.set_room_auto_enter_store(room_auto_enter_store.clone());
            bridge_server.set_in_game_room_store(in_game_room_store.clone());
            app.manage(game_replay_store);
            app.manage(room_auto_enter_store);
            bridge_server.set_app_handle(app_handle.clone());
            if let Err(error) = bridge_server.start() {
                tracing::warn!(%error, "Local bridge unavailable; continuing launcher startup");
            }
            let spectator_service = Arc::new(SpectatorService::new(bridge_server.clone()));
            spectator_service.set_app_handle(app_handle.clone());
            spectator_service.start_snapshot_listener();
            let package_manager = Arc::new(XingShuPackageManager::new());

            // Register default provider(s)
            let mut registry = ProviderRegistry::new();
            let imported_provider = Arc::new(ImportedDataProvider::new());
            let spectator_provider = Arc::new(XingShuSpectatorProvider::new(spectator_service.clone()));
            registry.register(imported_provider);
            registry.register(spectator_provider);

            let orchestrator = ProviderOrchestrator::new(db.clone(), registry);

            // Manage services in Tauri state
            app.manage(game_service);
            app.manage(extension_center::ExtensionCenter { db: db.clone() });
            app.manage(in_game_room_store);
            app.manage(android_installer::AndroidInstaller::default());
            app.manage(app_update::AppUpdater::default());
            app.manage(account_login::AccountLogin::default());
            app.manage(game_library_store);
            app.manage(player_service);
            app.manage(catalog_service);
            app.manage(extension_service);
            app.manage(install_service);
            app.manage(diagnostic_service);
            app.manage(orchestrator);
            app.manage(bridge_server);
            app.manage(spectator_service);
            app.manage(package_manager);
            app.manage(xing_shu::local_watcher::LocalWatcher::default());

            if !offline_replay {
                let handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = account_login::cloud_hand_sync::restore_on_startup(handle).await {
                        tracing::warn!(code = %err.code, "Unable to restore cloud hands on startup");
                    }
                });
            }

            // Parse optional startup CLI arguments e.g. --locale zh-CN or --locale=en-US
            let startup_locale = parse_locale_from_args(std::env::args());
            if let Some(ref loc) = startup_locale {
                info!("XingShu Hub received CLI startup locale override: {}", loc);
            }

            let startup_route = parse_route_from_args(std::env::args());
            if let Some(ref rt) = startup_route {
                info!("XingShu Hub received CLI startup route: {}", rt);
            }

            let startup_eval = cfg!(debug_assertions).then(|| parse_eval_from_args(std::env::args())).flatten();

            if let Some(main_win) = app.get_webview_window("main") {
                let title = match startup_locale.as_deref() {
                    Some("en-US") => "XingShu Launcher",
                    _ => "星枢启动器",
                };
                let _ = main_win.set_title(title);
                if offline_replay {
                    let _ = main_win.eval("window.__OFFLINE_REPLAY__ = true;");
                }
                if let Some(ref script) = startup_eval {
                    let _ = main_win.eval("sessionStorage.setItem('xingshu.launcher.splashPlayed', '1');");
                    let _ = main_win.eval(script);
                }
            }

            app.manage(StartupLocale::new(startup_locale));
            app.manage(StartupRoute::new(startup_route));

            let splash_active = Arc::new(AtomicBool::new(true));
            let splash_gen = Arc::new(AtomicU64::new(1));
            app.manage(SplashState {
                active: splash_active.clone(),
                generation: splash_gen.clone(),
            });

            if offline_replay || startup_eval.is_some() || app.get_webview_window("splash").is_none() {
                reveal_main_and_close_splash(&app_handle);
            } else {
                spawn_splash_watchdog(app_handle.clone(), splash_active, splash_gen, 1);
            }

            info!("XingShu Hub state and services successfully registered.");
            Ok(())
        })
        .invoke_handler({
        let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
            account_login::get_cloud_account,
            account_login::get_cloud_game_library,
            account_login::sync_cloud_game_library,
            account_login::get_cloud_match_detail,
            account_login::start_cloud_login,
            account_login::poll_cloud_login,
            account_login::detect_local_channel_tokens,
            account_login::start_channel_cloud_login,
            account_login::complete_qq_channel_login,
            account_login::logout_cloud_account,
            account_login::account_room_catalog,
            account_login::account_room_current,
            account_login::account_room_create,
            account_login::account_room_update,
            account_login::account_room_kick,
            account_login::account_room_exit,
            account_login::account_room_lobby,
            account_login::account_room_search,
            account_login::cloud_hand_sync::cloud_hand_sync_status,
            account_login::cloud_hand_sync::set_cloud_hand_sync,
            game_library::get_game_library,
            game_library::sync_game_library,
            game_replay::request_game_replay,
            game_replay::get_game_replay_status,
            room_auto_enter::arm_room_auto_enter,
            room_auto_enter::clear_room_auto_enter,
            room_auto_enter::get_room_auto_enter_status,
            game_library::get_game_match_detail,
            game_library::request_game_match_detail,
            // Game commands
            detect_game,
            set_manual_game_path,
            get_primary_game,
            extension_center::list_extension_targets,
            extension_center::register_extension_target,
            extension_center::get_extension_inventory,
            extension_center::get_extension_runtime_state,
            extension_center::open_group_installer,
            android_installer::get_android_installer_status,
            android_installer::android_installer_action,
            external_mods::get_external_mod_report,
            external_mods::external_mod_action,
            external_mods::archive_external_mod_report,
            dropped_mods::inspect_dropped_mod,
            dropped_mods::install_dropped_mod,
            dropped_mods::restore_dropped_mod,
            dropped_mods::toggle_dropped_mod,
            dropped_mods::list_dropped_mods,
            dropped_mods::stage_dropped_mod_bytes,
            dropped_mods::stage_dropped_mod_raw,
            workshop::workshop_list_local_state,
            workshop::workshop_download_and_install,
            workshop::workshop_restore_mod,
            workshop::workshop_toggle_mod,
            mod_inspector::get_encyclopedia_mod_overrides,
            mod_inspector::get_mod_texture_preview,
            app_update::get_app_build,
            app_update::check_app_update,
            app_update::prepare_app_update,
            app_update::apply_app_update,
            // Player commands
            get_player_profile,
            list_character_progress,
            list_card_inventory,
            // Catalog commands
            list_characters,
            list_cards,
            // Extension commands
            list_plugins,
            list_mods,
            inspect_package_archive,
            uninstall_extension,
            // Install commands
            install_package,
            rollback_transaction,
            list_install_transactions,
            list_backups,
            // Diagnostic commands
            get_diagnostic_report,
            list_providers,
            probe_providers,
            sync_provider_data,
            // XingShu Core commands
            get_bridge_status,
            get_runtime_sessions,
            configure_runtime_bindings,
            send_bridge_test_event,
            send_watch_target,
            managed_local_status,
            managed_local_allocate,
            managed_local_release,
            clear_bridge_logs,
            get_spectator_session,
            get_spectator_snapshot,
            get_spectator_hand_payload,
            login_spectator,
            start_spectating,
            stop_spectating,
            inspect_xspkg,
            verify_xspkg,
            get_startup_locale,
            get_startup_route,
            finish_splash_and_show_main,
            get_startup_splash_active,
            replay_startup_splash,
            check_game_process_status,
            launch_game_uri,
            launcher::launcher_check,
            launcher::launcher_session,
            launcher::launcher_install,
            launcher::launcher_inspect_conflicts,
            launcher::launcher_restore,
            launcher::launcher_start,
            launcher::launcher_mods,
            launcher::launcher_change_mod,
            launcher::launcher_toggle_mod,
            launcher::launcher_install_all_official_mods,
            launcher::launcher_uninstall_all_official_mods,
            launcher::launcher_open_mods_dir,
            in_game_room::in_game_room_state,
            in_game_room::in_game_room_create,
            in_game_room::in_game_room_modify,
            in_game_room::in_game_room_start,
            in_game_room::in_game_room_kick,
            in_game_room::in_game_room_exit,
            module_panel::open_module_panel,
            module_panel::module_panel_set_expanded,
            module_panel::module_panel_state,
            module_panel::module_panel_snapshot,
            module_panel::module_panel_toggle,
            module_panel::module_panel_open_main,
            module_panel::module_panel_manage,
        ];
        move |invoke| {
            let label = invoke.message.webview_ref().label();
            let panel_command = label == module_panel::LABEL && matches!(invoke.message.command(),
                "module_panel_set_expanded"
                    | "module_panel_state"
                    | "module_panel_snapshot"
                    | "module_panel_toggle"
                    | "module_panel_open_main"
                    | "module_panel_manage"
            );
            if label == "main" || (label == "splash" && invoke.message.command() == "finish_splash_and_show_main") || panel_command {
                handler(invoke)
            } else {
                invoke.resolver.reject("该窗口无权执行此操作。");
                true
            }
        }
        })
        .run(tauri::generate_context!())
        .expect("error while running XingShu Hub application");
}

}
#[cfg(feature = "web-ui")]
pub use web_host::run;
