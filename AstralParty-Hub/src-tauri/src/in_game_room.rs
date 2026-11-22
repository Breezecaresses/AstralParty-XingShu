//! In-game live room creation, modification, start, kick, and exit over the runtime Bridge.
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::{
    domain::error::{HubError, HubResult},
    extension_center::{self, ExtensionCenter},
    xing_shu::bridge::{
        protocol::{BridgeEnvelope, PROHIBITED_CREDENTIAL_KEYS},
        server::BridgeServer,
        session::RuntimeSession,
    },
};

fn room_error(message: impl Into<String>) -> HubError {
    HubError::new("IN_GAME_ROOM", message.into(), "LAUNCHER").with_recoverable(true)
}

fn clean_text(raw: &str, max_chars: usize) -> String {
    raw.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(max_chars)
        .collect()
}

fn valid_mode(mode: i32) -> bool {
    matches!(mode, 1 | 3 | 4 | 7 | 11 | 12)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRoomPlayer {
    pub player_id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub slot: i32,
    #[serde(default)]
    pub level: i32,
    #[serde(default)]
    pub ready: bool,
    #[serde(default)]
    pub is_bot: bool,
    #[serde(default)]
    pub is_host: bool,
    #[serde(default)]
    pub is_self: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRoomSnapshot {
    #[serde(default)]
    pub in_room: bool,
    #[serde(default)]
    pub room_id: i64,
    #[serde(default)]
    pub room_state: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub has_pwd: bool,
    #[serde(default)]
    pub room_pwd: String,
    #[serde(default)]
    pub mode: i32,
    #[serde(default)]
    pub map_id: i32,
    #[serde(default)]
    pub difficulty: i32,
    #[serde(default)]
    pub upgrade_plan: i32,
    #[serde(default)]
    pub time_plan: i32,
    #[serde(default)]
    pub master_id: i64,
    #[serde(default)]
    pub is_host: bool,
    #[serde(default)]
    pub max_players: i32,
    #[serde(default)]
    pub players: Vec<RuntimeRoomPlayer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomCommandResult {
    pub request_id: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub err_id: i32,
    #[serde(default)]
    pub room_id: i64,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InGameRoomCreateRequest {
    #[serde(default)]
    pub room_pwd: String,
    #[serde(default)]
    pub room_name: String,
    pub mode: i32,
    pub map_id: i32,
    #[serde(default = "default_diff")]
    pub difficulty: i32,
    #[serde(default = "default_one")]
    pub upgrade_plan: i32,
    #[serde(default = "default_two")]
    pub time_plan: i32,
    #[serde(default = "default_two")]
    pub speed_type: i32,
    #[serde(default)]
    pub skip_story: bool,
    #[serde(default)]
    pub room_label: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InGameRoomModifyRequest {
    #[serde(default)]
    pub room_pwd: String,
    pub map_id: i32,
    #[serde(default = "default_diff")]
    pub difficulty: i32,
    #[serde(default = "default_one")]
    pub upgrade_plan: i32,
    #[serde(default = "default_two")]
    pub time_plan: i32,
    #[serde(default = "default_two")]
    pub speed_type: i32,
    #[serde(default)]
    pub skip_story: bool,
    #[serde(default)]
    pub room_label: i32,
}

fn default_diff() -> i32 {
    2
}
fn default_one() -> i32 {
    1
}
fn default_two() -> i32 {
    2
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InGameRoomStateResponse {
    pub connected: bool,
    pub runtime_version: String,
    pub match_state: String,
    pub platform_id: String,
    pub player_id: Option<i64>,
    pub in_room: bool,
    pub snapshot: Option<RuntimeRoomSnapshot>,
    pub last_result: Option<RoomCommandResult>,
}

#[derive(Default)]
struct InGameRoomInner {
    snapshots: HashMap<String, (u64, RuntimeRoomSnapshot)>,
    last_result: Option<RoomCommandResult>,
}

#[derive(Default, Clone)]
pub struct InGameRoomStore(Arc<Mutex<InGameRoomInner>>);

impl InGameRoomStore {
    pub fn update_snapshot(&self, connection_id: &str, generation: u64, snap: RuntimeRoomSnapshot) {
        if let Ok(mut guard) = self.0.lock() {
            guard
                .snapshots
                .insert(connection_id.to_string(), (generation, snap));
        }
    }

    pub fn remove_connection(&self, connection_id: &str) {
        if let Ok(mut guard) = self.0.lock() {
            guard.snapshots.remove(connection_id);
        }
    }

    pub fn record_result(&self, mut result: RoomCommandResult) {
        result.message = clean_text(&result.message, 240);
        if let Ok(mut guard) = self.0.lock() {
            guard.last_result = Some(result);
        }
    }

    pub fn snapshot_for(&self, connection_id: &str, generation: u64) -> Option<RuntimeRoomSnapshot> {
        self.0
            .lock()
            .ok()?
            .snapshots
            .get(connection_id)
            .filter(|(g, _)| *g == generation)
            .map(|(_, s)| s.clone())
    }

    pub fn last_result(&self) -> Option<RoomCommandResult> {
        self.0.lock().ok().and_then(|g| g.last_result.clone())
    }
}

fn select_session(
    bridge: &BridgeServer,
    preferred_platform: Option<&str>,
) -> Option<RuntimeSession> {
    let mut candidates: Vec<RuntimeSession> = bridge
        .get_runtime_sessions()
        .into_iter()
        .filter(|s| {
            s.connection_state == "CONNECTED"
                && matches!(
                    s.platform_id.as_str(),
                    "STEAM_CN" | "STEAM_GLOBAL" | "TAPTAP" | "BILIBILI" | "WEGAME"
                )
        })
        .collect();

    if candidates.is_empty() {
        return None;
    }

    candidates.sort_by_key(|s| {
        let plat_score = if preferred_platform.is_some_and(|p| p == s.platform_id) {
            100
        } else {
            0
        };
        let role_score = if s.role == "MAIN" || s.bound_role == "MAIN" {
            20
        } else {
            0
        };
        let lobby_score = if s
            .match_context
            .as_ref()
            .is_some_and(|c| c.match_state == "LOBBY")
        {
            10
        } else {
            0
        };
        std::cmp::Reverse(plat_score + role_score + lobby_score)
    });
    candidates.into_iter().next()
}

fn preferred_platform(center: &ExtensionCenter, installation_id: Option<&str>) -> Option<String> {
    let id = installation_id?.trim();
    if id.is_empty() {
        return None;
    }
    extension_center::get_game(&center.db, id)
        .ok()
        .map(|g| g.platform)
}

fn dispatch_room_command(
    bridge: &BridgeServer,
    preferred_platform: Option<&str>,
    msg_type: &str,
    payload: serde_json::Value,
) -> HubResult<String> {
    let session = select_session(bridge, preferred_platform)
        .ok_or_else(|| room_error("尚未检测到运行中的游戏客户端（需安装「星枢官方插件 Mod」并进入大厅）。"))?;
    let match_state = session
        .match_context
        .as_ref()
        .map(|c| c.match_state.as_str())
        .unwrap_or("UNKNOWN");
    if match_state != "LOBBY" {
        return Err(room_error("请先在游戏内登录并进入主大厅或等待房间后再操作。"));
    }

    let request_id = payload
        .get("requestId")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let envelope = BridgeEnvelope::with_request_id(msg_type, &request_id, payload);
    let serialized = serde_json::to_string(&envelope)
        .map_err(|_| room_error("序列化游戏内房间指令失败。"))?;
    for bad in PROHIBITED_CREDENTIAL_KEYS {
        if serialized.contains(bad) {
            return Err(room_error("房间指令载荷包含受限字段。"));
        }
    }
    if !bridge.send_envelope_to(&session.connection_id, &envelope) {
        return Err(room_error("未能向游戏内运行时发送房间指令，请确认游戏未退出。"));
    }
    Ok(request_id)
}

#[tauri::command]
pub fn in_game_room_state(
    installation_id: Option<String>,
    center: State<'_, ExtensionCenter>,
    bridge: State<'_, Arc<BridgeServer>>,
    store: State<'_, InGameRoomStore>,
) -> InGameRoomStateResponse {
    let pref = preferred_platform(&center, installation_id.as_deref());
    let Some(session) = select_session(&bridge, pref.as_deref()) else {
        return InGameRoomStateResponse {
            connected: false,
            runtime_version: String::new(),
            match_state: "OFFLINE".to_string(),
            platform_id: String::new(),
            player_id: None,
            in_room: false,
            snapshot: None,
            last_result: store.last_result(),
        };
    };

    let match_state = session
        .match_context
        .as_ref()
        .map(|c| c.match_state.clone())
        .unwrap_or_else(|| "UNKNOWN".to_string());
    let snapshot = store.snapshot_for(&session.connection_id, session.generation);
    let in_room = snapshot.as_ref().is_some_and(|s| s.in_room && s.room_id > 0);
    InGameRoomStateResponse {
        connected: true,
        runtime_version: session.runtime_version.clone(),
        match_state,
        platform_id: session.platform_id.clone(),
        player_id: session.live_player_id.or(session.player_id),
        in_room,
        snapshot,
        last_result: store.last_result(),
    }
}

#[tauri::command]
pub fn in_game_room_create(
    installation_id: Option<String>,
    request: InGameRoomCreateRequest,
    center: State<'_, ExtensionCenter>,
    bridge: State<'_, Arc<BridgeServer>>,
) -> HubResult<String> {
    if !valid_mode(request.mode) || request.map_id <= 0 {
        return Err(room_error("无效的官方模式或地图 ID。"));
    }
    let req_id = uuid::Uuid::new_v4().to_string();
    let pref = preferred_platform(&center, installation_id.as_deref());
    let payload = serde_json::json!({
        "requestId": req_id,
        "roomPwd": clean_text(&request.room_pwd, 12),
        "roomName": clean_text(&request.room_name, 36),
        "mode": request.mode,
        "mapId": request.map_id,
        "difficulty": request.difficulty.clamp(0, 3),
        "upgradePlan": request.upgrade_plan.clamp(1, 6),
        "timePlan": request.time_plan.clamp(1, 3),
        "speedType": request.speed_type.clamp(1, 2),
        "skipStory": request.skip_story,
        "roomLabel": request.room_label.clamp(0, 99),
    });
    dispatch_room_command(&bridge, pref.as_deref(), "ROOM_IN_GAME_CREATE", payload)
}

#[tauri::command]
pub fn in_game_room_modify(
    installation_id: Option<String>,
    request: InGameRoomModifyRequest,
    center: State<'_, ExtensionCenter>,
    bridge: State<'_, Arc<BridgeServer>>,
) -> HubResult<String> {
    if request.map_id <= 0 {
        return Err(room_error("无效的地图参数。"));
    }
    let req_id = uuid::Uuid::new_v4().to_string();
    let pref = preferred_platform(&center, installation_id.as_deref());
    let payload = serde_json::json!({
        "requestId": req_id,
        "roomPwd": clean_text(&request.room_pwd, 12),
        "mapId": request.map_id,
        "difficulty": request.difficulty.clamp(0, 3),
        "upgradePlan": request.upgrade_plan.clamp(1, 6),
        "timePlan": request.time_plan.clamp(1, 3),
        "speedType": request.speed_type.clamp(1, 2),
        "skipStory": request.skip_story,
        "roomLabel": request.room_label.clamp(0, 99),
    });
    dispatch_room_command(&bridge, pref.as_deref(), "ROOM_IN_GAME_MODIFY", payload)
}

#[tauri::command]
pub fn in_game_room_start(
    installation_id: Option<String>,
    is_add_bot: bool,
    center: State<'_, ExtensionCenter>,
    bridge: State<'_, Arc<BridgeServer>>,
) -> HubResult<String> {
    let req_id = uuid::Uuid::new_v4().to_string();
    let pref = preferred_platform(&center, installation_id.as_deref());
    let payload = serde_json::json!({
        "requestId": req_id,
        "isAddBot": is_add_bot,
    });
    dispatch_room_command(&bridge, pref.as_deref(), "ROOM_IN_GAME_START", payload)
}

#[tauri::command]
pub fn in_game_room_kick(
    installation_id: Option<String>,
    target_player_id: i64,
    center: State<'_, ExtensionCenter>,
    bridge: State<'_, Arc<BridgeServer>>,
) -> HubResult<String> {
    if target_player_id <= 0 {
        return Err(room_error("无效的玩家 UID。"));
    }
    let req_id = uuid::Uuid::new_v4().to_string();
    let pref = preferred_platform(&center, installation_id.as_deref());
    let payload = serde_json::json!({
        "requestId": req_id,
        "targetPlayerId": target_player_id,
    });
    dispatch_room_command(&bridge, pref.as_deref(), "ROOM_IN_GAME_KICK", payload)
}

#[tauri::command]
pub fn in_game_room_exit(
    installation_id: Option<String>,
    center: State<'_, ExtensionCenter>,
    bridge: State<'_, Arc<BridgeServer>>,
) -> HubResult<String> {
    let req_id = uuid::Uuid::new_v4().to_string();
    let pref = preferred_platform(&center, installation_id.as_deref());
    let payload = serde_json::json!({
        "requestId": req_id,
    });
    dispatch_room_command(&bridge, pref.as_deref(), "ROOM_IN_GAME_EXIT", payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_and_result_track_connection_lifecycle() {
        let store = InGameRoomStore::default();
        let snap = RuntimeRoomSnapshot {
            in_room: true,
            room_id: 299792,
            room_state: "WAIT".to_string(),
            name: "测试房".to_string(),
            has_pwd: true,
            room_pwd: "558558".to_string(),
            mode: 4,
            map_id: 82017,
            difficulty: 3,
            upgrade_plan: 1,
            time_plan: 2,
            master_id: 1556514,
            is_host: true,
            max_players: 4,
            players: vec![RuntimeRoomPlayer {
                player_id: 1556514,
                name: "古明地猫耳".to_string(),
                slot: 0,
                level: 34,
                ready: false,
                is_bot: false,
                is_host: true,
                is_self: true,
            }],
        };

        store.update_snapshot("conn-1", 1, snap);
        assert!(store.snapshot_for("conn-1", 1).is_some());
        assert!(store.snapshot_for("conn-1", 2).is_none());

        store.record_result(RoomCommandResult {
            request_id: "r1".to_string(),
            action: "create".to_string(),
            ok: true,
            err_id: 0,
            room_id: 299792,
            message: "已创建房间 #299792".to_string(),
        });
        assert_eq!(store.last_result().unwrap().room_id, 299792);

        store.remove_connection("conn-1");
        assert!(store.snapshot_for("conn-1", 1).is_none());
    }
}
