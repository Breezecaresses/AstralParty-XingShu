use std::collections::BTreeMap;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

use crate::{extension_center::ExtensionCenter, launcher};

pub(crate) const LABEL: &str = "module-ball";
const PANEL_PAGE: &str = "index.html?window=module-ball";
const BALL_SIZE: u32 = 74;
const PANEL_WIDTH: u32 = 396;
const PANEL_HEIGHT: u32 = 584;

#[derive(Default)]
pub(crate) struct ModulePanelTarget(tokio::sync::Mutex<Option<String>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModulePanelSnapshot {
    ready: bool,
    game_platform: Option<String>,
    game_root: Option<String>,
    #[serde(default)]
    modules: Vec<launcher::ModuleDefinition>,
    states: BTreeMap<String, &'static str>,
}

fn reposition(
    window: &WebviewWindow,
    monitor: &Monitor,
    expanded: bool,
    initial: bool,
) -> tauri::Result<()> {
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let px = |size: u32| (f64::from(size) * scale).round() as u32;
    let width = px(if expanded { PANEL_WIDTH } else { BALL_SIZE }).min(area.size.width);
    let height = px(if expanded { PANEL_HEIGHT } else { BALL_SIZE }).min(area.size.height);
    let left = area.position.x;
    let top = area.position.y;
    let right = left + area.size.width as i32;
    let bottom = top + area.size.height as i32;

    let (right_anchor, middle) = if initial {
        (right - px(16) as i32, top + area.size.height as i32 / 2)
    } else {
        let position = window.outer_position()?;
        let size = window.outer_size()?;
        (position.x + size.width as i32, position.y + size.height as i32 / 2)
    };
    let x = (right_anchor - width as i32).clamp(left, right - width as i32);
    let y = (middle - height as i32 / 2).clamp(top, bottom - height as i32);
    window.set_size(PhysicalSize::new(width, height))?;
    window.set_position(PhysicalPosition::new(x, y))
}

#[tauri::command]
pub(crate) async fn open_module_panel(
    app: AppHandle,
    installation_id: Option<String>,
    center: State<'_, ExtensionCenter>,
    selected: State<'_, ModulePanelTarget>,
) -> Result<(), String> {
    if let Some(id) = &installation_id {
        crate::extension_center::get_game(&center.db, id).map_err(|error| error.to_string())?;
    }
    let mut target = selected.0.lock().await;
    *target = installation_id;
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = app.emit_to(LABEL, "xingshu:panel-target-changed", ());
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    let main = app.get_webview_window("main").ok_or("启动器窗口不可用。")?;
    let origin = main.url().map_err(|error| error.to_string())?.origin();
    let monitor = main.current_monitor().ok().flatten();
    let window = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App(PANEL_PAGE.into()))
        .title("星枢悬浮球")
        .inner_size(f64::from(BALL_SIZE), f64::from(BALL_SIZE))
        .visible(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            url.origin() == origin
                && matches!(url.path(), "/" | "/index.html")
                && url.query() == Some("window=module-ball")
        })
        .build().map_err(|error| error.to_string())?;

    if let Some(monitor) = monitor {
        if let Err(error) = reposition(&window, &monitor, false, true) {
            let _ = window.close();
            return Err(error.to_string());
        }
    }
    if let Err(error) = window.show() {
        let _ = window.close();
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn module_panel_set_expanded(window: WebviewWindow, expanded: bool) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("窗口不支持此操作。".into());
    }
    let monitor = window.current_monitor().map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or("未找到悬浮球所在的屏幕。")?;
    reposition(&window, &monitor, expanded, false).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn module_panel_state(
    mod_id: String,
    center: State<'_, ExtensionCenter>,
    selected: State<'_, ModulePanelTarget>,
) -> Result<&'static str, String> {
    if !launcher::is_known_module(&mod_id) {
        return Err("没有这个模块。".into());
    }
    let Some(id) = selected.0.lock().await.clone() else {
        return Ok("not_selected");
    };
    let game = crate::extension_center::get_game(&center.db, &id).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || launcher::installed_module_state(&game, &mod_id))
        .await.map_err(|error| error.to_string())?.map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn module_panel_snapshot(
    center: State<'_, ExtensionCenter>,
    selected: State<'_, ModulePanelTarget>,
) -> Result<ModulePanelSnapshot, String> {
    let definitions = launcher::current_modules().unwrap_or_default();
    let Some(id) = selected.0.lock().await.clone() else {
        return Ok(ModulePanelSnapshot {
            ready: false,
            game_platform: None,
            game_root: None,
            modules: definitions,
            states: BTreeMap::new(),
        });
    };
    let game = crate::extension_center::get_game(&center.db, &id).map_err(|error| error.to_string())?;
    let game_platform = Some(game.platform.clone());
    let game_root = Some(game.install_path.clone());
    let (ready, states) = tauri::async_runtime::spawn_blocking(move || launcher::snapshot_modules_for_game(&game))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(ModulePanelSnapshot {
        ready,
        game_platform,
        game_root,
        modules: definitions,
        states,
    })
}

#[tauri::command]
pub(crate) async fn module_panel_toggle(
    app: AppHandle,
    mod_id: String,
    enabled: bool,
    center: State<'_, ExtensionCenter>,
    selected: State<'_, ModulePanelTarget>,
) -> Result<&'static str, String> {
    if !launcher::is_known_module(&mod_id) {
        return Err("没有这个模块。".into());
    }
    let Some(id) = selected.0.lock().await.clone() else {
        return Err("请先在主界面选择游戏目录。".into());
    };
    let game = crate::extension_center::get_game(&center.db, &id).map_err(|error| error.to_string())?;
    let next_state = launcher::toggle_module_for_game(game, mod_id, enabled)
        .await
        .map_err(|error| error.to_string())?;
    let _ = app.emit_to("main", "xingshu:modules-changed", ());
    Ok(next_state)
}

fn show_main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let main = app.get_webview_window("main").ok_or("启动器窗口不可用。")?;
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    Ok(main)
}

#[tauri::command]
pub(crate) fn module_panel_open_main(app: AppHandle) -> Result<(), String> {
    let _ = show_main_window(&app)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn module_panel_manage(app: AppHandle, mod_id: String) -> Result<(), String> {
    if !launcher::is_known_module(&mod_id) {
        return Err("没有这个模块。".into());
    }
    let _ = show_main_window(&app)?;
    app.emit_to("main", "xingshu:manage-module", mod_id).map_err(|error| error.to_string())
}
