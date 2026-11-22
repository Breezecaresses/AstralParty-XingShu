//! Dispatches automatic in-game room entry (join existing waiting room or recreate transparently)
//! once the launched client connects and enters the online Home lobby.
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use serde::{Deserialize, Serialize};
use crate::{
    desktop_host,
    domain::error::{HubError, HubResult},
    xing_shu::bridge::{
        connection::ConnectionManager,
        protocol::{BridgeEnvelope, PROHIBITED_CREDENTIAL_KEYS},
        server::BridgeServer,
        session::RuntimeSession,
    },
};

const ARMED_TTL: Duration = Duration::from_secs(600);

fn error(message: &str) -> HubError {
    HubError::new("ROOM_AUTO_ENTER", message, "LAUNCHER").with_recoverable(true)
}

fn default_action() -> String {
    "join_or_create".to_string()
}
fn default_difficulty() -> i32 {
    2
}
fn default_upgrade_plan() -> i32 {
    1
}
fn default_time_plan() -> i32 {
    2
}
fn default_speed_type() -> i32 {
    2
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoomAutoEnterRequest {
    pub expected_player_id: i64,
    #[serde(default = "default_action")]
    pub action: String,
    #[serde(default)]
    pub room_id: String,
    #[serde(default)]
    pub room_pwd: String,
    #[serde(default)]
    pub room_name: String,
    pub mode: i32,
    pub map_id: i32,
    #[serde(default = "default_difficulty")]
    pub difficulty: i32,
    #[serde(default = "default_upgrade_plan")]
    pub upgrade_plan: i32,
    #[serde(default = "default_time_plan")]
    pub time_plan: i32,
    #[serde(default = "default_speed_type")]
    pub speed_type: i32,
    #[serde(default)]
    pub skip_story: bool,
    #[serde(default)]
    pub room_label: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomAutoEnterStatus {
    pub armed: bool,
    pub request_id: String,
    pub expected_player_id: i64,
    pub target_room_id: String,
    pub status: String,
    pub result_room_id: Option<i64>,
    pub message: String,
}

impl Default for RoomAutoEnterStatus {
    fn default() -> Self {
        Self {
            armed: false,
            request_id: String::new(),
            expected_player_id: 0,
            target_room_id: String::new(),
            status: "idle".to_string(),
            result_room_id: None,
            message: String::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomAutoEnterResult {
    pub request_id: String,
    pub status: String,
    #[serde(default)]
    pub room_id: i64,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Clone)]
struct PendingEntry {
    request_id: String,
    request: RoomAutoEnterRequest,
    armed_at: Instant,
    status: String,
    result_room_id: Option<i64>,
    message: String,
    dispatched_target: Option<(String, u64)>,
}

#[derive(Default, Clone)]
pub struct RoomAutoEnterStore(Arc<Mutex<Option<PendingEntry>>>);

fn valid_mode(mode: i32) -> bool {
    matches!(mode, 1 | 3 | 4 | 7 | 11 | 12)
}

fn clean_text(raw: &str, max_chars: usize) -> String {
    raw.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(max_chars)
        .collect()
}

pub(crate) fn build_bridge_payload(
    request_id: &str,
    req: &RoomAutoEnterRequest,
    resolved_action: &str,
    room_server_id: i32,
) -> serde_json::Value {
    let room_id_num = req.room_id.trim().parse::<i64>().unwrap_or(0);
    serde_json::json!({
        "requestId": request_id,
        "expectedPlayerId": req.expected_player_id,
        "action": resolved_action,
        "roomId": room_id_num,
        "roomServerId": room_server_id,
        "roomPwd": clean_text(&req.room_pwd, 16),
        "roomName": clean_text(&req.room_name, 36),
        "mode": req.mode,
        "mapId": req.map_id,
        "difficulty": req.difficulty.clamp(0, 3),
        "upgradePlan": req.upgrade_plan.clamp(1, 6),
        "timePlan": req.time_plan.clamp(1, 3),
        "speedType": req.speed_type.clamp(1, 2),
        "skipStory": req.skip_story,
        "roomLabel": req.room_label.clamp(0, 99),
    })
}

fn snapshot_status(guard: &Option<PendingEntry>) -> RoomAutoEnterStatus {
    match guard {
        Some(entry) if entry.armed_at.elapsed() < ARMED_TTL => RoomAutoEnterStatus {
            armed: true,
            request_id: entry.request_id.clone(),
            expected_player_id: entry.request.expected_player_id,
            target_room_id: entry.request.room_id.clone(),
            status: entry.status.clone(),
            result_room_id: entry.result_room_id,
            message: entry.message.clone(),
        },
        _ => RoomAutoEnterStatus::default(),
    }
}

impl RoomAutoEnterStore {
    pub fn arm(&self, mut req: RoomAutoEnterRequest) -> HubResult<RoomAutoEnterStatus> {
        if req.expected_player_id <= 0 {
            return Err(error("请先绑定并登录当前游戏账号后再启用自动进房。"));
        }
        if !valid_mode(req.mode) || req.map_id <= 0 {
            return Err(error("房间模式或地图参数无效，无法启用自动进房。"));
        }
        let room_id_clean = req.room_id.trim().to_string();
        if !room_id_clean.is_empty()
            && (room_id_clean.len() > 20 || !room_id_clean.bytes().all(|b| b.is_ascii_digit()))
        {
            return Err(error("目标房间号格式无效。"));
        }
        req.room_id = room_id_clean;
        req.action = match req.action.trim() {
            "create" => "create".to_string(),
            "join" => "join".to_string(),
            _ => "join_or_create".to_string(),
        };
        req.room_pwd = clean_text(&req.room_pwd, 16);
        req.room_name = clean_text(&req.room_name, 36);

        let entry = PendingEntry {
            request_id: uuid::Uuid::new_v4().to_string(),
            request: req,
            armed_at: Instant::now(),
            status: "armed".to_string(),
            result_room_id: None,
            message: "已预约进游戏后自动进入房间".to_string(),
            dispatched_target: None,
        };
        let mut guard = self.0.lock().map_err(|_| error("自动进房状态暂不可用。"))?;
        *guard = Some(entry);
        Ok(snapshot_status(&guard))
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = None;
        }
    }

    pub fn status(&self) -> RoomAutoEnterStatus {
        match self.0.lock() {
            Ok(mut guard) => {
                if guard
                    .as_ref()
                    .is_some_and(|e| e.armed_at.elapsed() >= ARMED_TTL)
                {
                    *guard = None;
                }
                snapshot_status(&guard)
            }
            Err(_) => RoomAutoEnterStatus::default(),
        }
    }

    pub fn accept(&self, session: &RuntimeSession, result: RoomAutoEnterResult) {
        let Ok(mut guard) = self.0.lock() else {
            return;
        };
        let Some(entry) = guard.as_mut() else {
            return;
        };
        if entry.request_id != result.request_id || entry.armed_at.elapsed() >= ARMED_TTL {
            return;
        }
        if entry
            .dispatched_target
            .as_ref()
            .is_some_and(|(conn, gen_id)| {
                conn != &session.connection_id || *gen_id != session.generation
            })
        {
            return;
        }
        if !matches!(
            result.status.as_str(),
            "joined" | "created" | "already_in_room" | "skipped" | "error"
        ) {
            return;
        }
        entry.status = result.status;
        entry.result_room_id = if result.room_id > 0 {
            Some(result.room_id)
        } else {
            None
        };
        entry.message = clean_text(&result.message, 240);
    }

    fn try_claim_dispatch(&self, session: &RuntimeSession) -> Option<(String, RoomAutoEnterRequest)> {
        if session.connection_state != "CONNECTED" || session.in_match {
            return None;
        }
        if session
            .match_context
            .as_ref()
            .is_none_or(|c| c.match_state != "LOBBY")
        {
            return None;
        }

        let mut guard = self.0.lock().ok()?;
        let entry = guard.as_mut()?;
        if entry.armed_at.elapsed() >= ARMED_TTL {
            *guard = None;
            return None;
        }
        if matches!(
            entry.status.as_str(),
            "joined" | "created" | "already_in_room"
        ) {
            return None;
        }
        if session.live_player_id != Some(entry.request.expected_player_id) {
            return None;
        }
        let target = (session.connection_id.clone(), session.generation);
        if entry.dispatched_target.as_ref() == Some(&target) {
            return None;
        }
        entry.dispatched_target = Some(target);
        entry.status = "dispatching".to_string();
        entry.message = "正在核对官方房间状态并通知游戏客户端进房…".to_string();
        Some((entry.request_id.clone(), entry.request.clone()))
    }

    fn mark_dispatched(&self, request_id: &str, conn_id: &str, gen_id: u64, ok: bool) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(entry) = guard.as_mut() {
                if entry.request_id == request_id
                    && entry.dispatched_target.as_ref() == Some(&(conn_id.to_string(), gen_id))
                    && entry.status == "dispatching"
                {
                    if ok {
                        entry.status = "dispatched".to_string();
                        entry.message = "已向游戏客户端发送自动进房指令，等待进入等待房…".to_string();
                    } else {
                        entry.status = "error".to_string();
                        entry.message = "游戏网桥连接暂未就绪，请进入大厅后重试。".to_string();
                    }
                }
            }
        }
    }
}

pub(crate) fn maybe_dispatch_for_session(
    app: Option<desktop_host::AppHandle>,
    conn_mgr: ConnectionManager,
    store: &RoomAutoEnterStore,
    session: &RuntimeSession,
) {
    let Some((request_id, req)) = store.try_claim_dispatch(session) else {
        return;
    };
    let store_cloned = store.clone();
    let connection_id = session.connection_id.clone();
    let generation = session.generation;

    desktop_host::spawn(async move {
        tokio::time::sleep(Duration::from_millis(800)).await;

        let mut resolved_action = req.action.as_str();
        let mut room_server_id = 0_i32;

        if req.action != "create" && !req.room_id.is_empty() {
            #[cfg(feature = "web-ui")]
            if let Some(ref handle) = app {
                if let Some((found, srv_id)) =
                    crate::account_login::search_room_internal(handle, &req.room_id).await
                {
                    if found {
                        resolved_action = "join_or_create";
                        room_server_id = srv_id;
                    } else if req.action == "join_or_create" {
                        resolved_action = "create";
                        room_server_id = 0;
                    }
                }
            }
        }

        let payload = build_bridge_payload(&request_id, &req, resolved_action, room_server_id);
        let envelope = BridgeEnvelope::new("ROOM_AUTO_ENTER", payload);

        let sent = send_to_runtime(app.as_ref(), &conn_mgr, &connection_id, &envelope);
        store_cloned.mark_dispatched(&request_id, &connection_id, generation, sent);
    });
}

fn send_to_runtime(
    #[allow(unused_variables)] app: Option<&desktop_host::AppHandle>,
    conn_mgr: &ConnectionManager,
    connection_id: &str,
    envelope: &BridgeEnvelope<serde_json::Value>,
) -> bool {
    #[cfg(feature = "web-ui")]
    if let Some(handle) = app {
        use tauri::Manager;
        if let Some(bridge) = handle.try_state::<Arc<BridgeServer>>() {
            return bridge.send_envelope_to(connection_id, envelope);
        }
    }
    match serde_json::to_string(envelope) {
        Ok(json_str) => conn_mgr.send_to(connection_id, &json_str),
        Err(_) => false,
    }
}

#[cfg_attr(feature = "web-ui", tauri::command)]
pub fn arm_room_auto_enter(
    app: desktop_host::AppHandle,
    store: desktop_host::State<'_, RoomAutoEnterStore>,
    bridge: desktop_host::State<'_, Arc<BridgeServer>>,
    request: RoomAutoEnterRequest,
) -> HubResult<RoomAutoEnterStatus> {
    let _ = store.arm(request)?;
    for session in bridge.session_manager().list() {
        maybe_dispatch_for_session(
            Some(app.clone()),
            bridge.connection_manager().clone(),
            &store,
            &session,
        );
    }
    Ok(store.status())
}

#[cfg_attr(feature = "web-ui", tauri::command)]
pub fn clear_room_auto_enter(store: desktop_host::State<'_, RoomAutoEnterStore>) {
    store.clear();
}

#[cfg_attr(feature = "web-ui", tauri::command)]
pub fn get_room_auto_enter_status(
    store: desktop_host::State<'_, RoomAutoEnterStore>,
) -> RoomAutoEnterStatus {
    store.status()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xing_shu::bridge::protocol::RuntimeMatchContext;

    fn sample_req() -> RoomAutoEnterRequest {
        RoomAutoEnterRequest {
            expected_player_id: 1556514,
            action: "join_or_create".to_string(),
            room_id: "299792".to_string(),
            room_pwd: "7451548545".to_string(),
            room_name: "古明地猫耳".to_string(),
            mode: 4,
            map_id: 82017,
            difficulty: 3,
            upgrade_plan: 4,
            time_plan: 2,
            speed_type: 2,
            skip_story: false,
            room_label: 0,
        }
    }

    fn lobby_session(conn: &str, gen_id: u64, pid: i64) -> RuntimeSession {
        let mut sess = RuntimeSession::new(conn, "STEAM_CN", 44240, "AstralParty_CN.exe", Some(pid), "r8.38", gen_id, "MAIN");
        sess.match_context = Some(RuntimeMatchContext {
            connection_id: conn.to_string(),
            platform_id: "STEAM_CN".to_string(),
            local_player_id: Some(pid),
            match_state: "LOBBY".to_string(),
            internal_room_id: Some(0),
            ..Default::default()
        });
        sess
    }

    #[test]
    fn arm_dedup_accept_and_clear_lifecycle() {
        let store = RoomAutoEnterStore::default();
        let armed = store.arm(sample_req()).expect("arm succeeds");
        assert!(armed.armed);
        assert_eq!(armed.status, "armed");

        let s1 = lobby_session("conn-1", 1, 1556514);
        let wrong_pid = lobby_session("conn-2", 1, 9999999);

        // Wrong player ID must never claim dispatch.
        assert!(store.try_claim_dispatch(&wrong_pid).is_none());

        // Matching lobby session claims dispatch once per (conn, generation).
        let (req_id, _) = store.try_claim_dispatch(&s1).expect("first claim succeeds");
        assert!(store.try_claim_dispatch(&s1).is_none());

        store.mark_dispatched(&req_id, "conn-1", 1, true);
        assert_eq!(store.status().status, "dispatched");

        // Another connection/generation can claim if user restarted game before result arrived.
        let s2 = lobby_session("conn-1", 2, 1556514);
        assert!(store.try_claim_dispatch(&s2).is_some());

        store.accept(
            &s2,
            RoomAutoEnterResult {
                request_id: req_id.clone(),
                status: "created".to_string(),
                room_id: 301245,
                message: "已在游戏内自动创建并进入房间 #301245".to_string(),
            },
        );
        let after = store.status();
        assert_eq!(after.status, "created");
        assert_eq!(after.result_room_id, Some(301245));

        // Once completed, no further dispatches fire until re-armed.
        let s3 = lobby_session("conn-3", 1, 1556514);
        assert!(store.try_claim_dispatch(&s3).is_none());

        store.clear();
        assert!(!store.status().armed);
        assert_eq!(store.status().status, "idle");
    }

    #[test]
    fn bridge_payload_never_contains_prohibited_credential_keys() {
        let payload = build_bridge_payload("req-1", &sample_req(), "create", 0);
        let serialized = serde_json::to_string(&payload).unwrap();
        let obj = payload.as_object().unwrap();
        for key in PROHIBITED_CREDENTIAL_KEYS {
            assert!(!obj.contains_key(*key), "payload must never include key {key}");
        }
        assert!(serialized.contains("\"roomPwd\":\"7451548545\""));
        assert_eq!(obj.get("roomId").and_then(|v| v.as_i64()), Some(299792));
    }
}
