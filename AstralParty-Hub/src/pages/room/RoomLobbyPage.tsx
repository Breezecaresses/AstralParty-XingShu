import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Blocks,
  Check,
  Copy,
  Crown,
  DoorOpen,
  Gamepad2,
  Lock,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UserX,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import type { GameLaunchResult } from '../../shared/types';
import { useExtensionTarget } from '../extensions/ExtensionWorkspace';
import {
  DIFFICULTY_OPTIONS,
  OFFICIAL_MODES,
  SPEED_OPTIONS,
  THINK_TIME_OPTIONS,
  UPGRADE_PLAN_OPTIONS,
  applyModeSelection,
  buildInviteCopyText,
  createDefaultOfficialDraft,
  getMapForMode,
  getMapsForMode,
  getModeSpec,
  type ActiveOfficialRoom,
  type LobbyRoomSummary,
  type OfficialRoomDraft,
} from './roomTemplateData';

type AccountInfo = { uid: string; nick?: string };

interface RuntimeRoomPlayer {
  playerId: number;
  name: string;
  slot: number;
  level: number;
  ready: boolean;
  isBot: boolean;
  isHost: boolean;
  isSelf: boolean;
}

interface RuntimeRoomSnapshot {
  inRoom: boolean;
  roomId: number;
  roomState: string;
  name: string;
  hasPwd: boolean;
  roomPwd: string;
  mode: number;
  mapId: number;
  difficulty: number;
  upgradePlan: number;
  timePlan: number;
  masterId: number;
  isHost: boolean;
  maxPlayers: number;
  players: RuntimeRoomPlayer[];
}

interface RoomCommandResult {
  requestId: string;
  action: string;
  ok: boolean;
  errId: number;
  roomId: number;
  message: string;
}

interface InGameRoomStateResponse {
  connected: boolean;
  runtimeVersion: string;
  matchState: string;
  platformId: string;
  playerId?: number | null;
  inRoom: boolean;
  snapshot?: RuntimeRoomSnapshot | null;
  lastResult?: RoomCommandResult | null;
}

function formatError(err: unknown): string {
  if (!err) return '操作未完成，请稍后重试。';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const rec = err as { message?: string; error?: string };
    if (rec.message) return rec.message;
    if (rec.error) return rec.error;
  }
  return String(err);
}

function isNotOpenError(err: unknown, message: string): boolean {
  const code = err && typeof err === 'object' ? (err as { code?: string }).code : '';
  return code === 'OFFICIAL_MODE_NOT_OPEN' || message.includes('10015') || message.includes('NotOpen');
}

export const RoomLobbyPage: React.FC = () => {
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const target = useExtensionTarget();
  const installationId = target.selected?.id ?? '';

  const [inGameState, setInGameState] = useState<InGameRoomStateResponse | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);

  const [draft, setDraft] = useState<OfficialRoomDraft>(() => createDefaultOfficialDraft());
  const [addBotsOnStart, setAddBotsOnStart] = useState(false);

  const [lobbyModeId, setLobbyModeId] = useState<number>(4);
  const [lobbyRooms, setLobbyRooms] = useState<LobbyRoomSummary[]>([]);
  const [lobbyLoading, setLobbyLoading] = useState(false);

  const [searchRoomId, setSearchRoomId] = useState('');
  const [searchResult, setSearchResult] = useState<{ found: boolean; roomId: string; isPwd?: boolean; error?: string } | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [launchingGame, setLaunchingGame] = useState(false);
  const [modeOpenMap, setModeOpenMap] = useState<Record<number, boolean>>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err' | 'info'; text: string; recoverableMode?: boolean } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const lastSeenResultIdRef = useRef<string>('');
  const lastSyncedRoomIdRef = useRef<number>(0);

  const snapshot = inGameState?.snapshot ?? null;
  const inLobbyReady = Boolean(inGameState?.connected && inGameState?.matchState === 'LOBBY');
  const inRoom = Boolean(inLobbyReady && inGameState?.inRoom && snapshot && snapshot.roomId > 0);
  const isRoomHost = Boolean(inRoom && snapshot?.isHost);

  const currentMode = useMemo(() => getModeSpec(draft.modeId), [draft.modeId]);
  const modeMaps = useMemo(() => getMapsForMode(draft.modeId), [draft.modeId]);
  const currentMap = useMemo(() => getMapForMode(draft.modeId, draft.mapId), [draft.modeId, draft.mapId]);

  const showBanner = useCallback((kind: 'ok' | 'err' | 'info', text: string, recoverableMode = false) => {
    setBanner({ kind, text, recoverableMode });
  }, []);

  const refreshCatalog = useCallback(async () => {
    try {
      const cat = await invoke<{ modes?: Array<{ id?: number; officialOpen?: boolean }> }>('account_room_catalog');
      if (Array.isArray(cat?.modes)) {
        const next: Record<number, boolean> = {};
        for (const item of cat.modes) {
          if (typeof item.id === 'number') {
            next[item.id] = item.officialOpen !== false;
          }
        }
        setModeOpenMap(next);
      }
    } catch {
      // Optional server status overlay; static catalog remains usable.
    }
  }, []);

  const syncDraftFromSnapshot = useCallback((room: RuntimeRoomSnapshot) => {
    setDraft((prev) => ({
      ...prev,
      modeId: room.mode > 0 ? room.mode : prev.modeId,
      mapId: room.mapId > 0 ? room.mapId : prev.mapId,
      difficulty: Math.max(0, Math.min(3, room.difficulty ?? prev.difficulty)),
      upgradePlan: room.upgradePlan > 0 ? room.upgradePlan : prev.upgradePlan,
      timePlan: room.timePlan > 0 ? room.timePlan : prev.timePlan,
      roomName: room.name || prev.roomName,
      password: room.roomPwd ?? prev.password,
    }));
  }, []);

  const refreshInGameState = useCallback(async () => {
    try {
      const st = await invoke<InGameRoomStateResponse>('in_game_room_state', {
        installationId: installationId || null,
      });
      setInGameState(st);

      const snap = st.snapshot;
      if (snap?.inRoom && snap.roomId > 0) {
        if (lastSyncedRoomIdRef.current !== snap.roomId) {
          lastSyncedRoomIdRef.current = snap.roomId;
          syncDraftFromSnapshot(snap);
        }
      } else {
        lastSyncedRoomIdRef.current = 0;
      }

      if (st.lastResult && st.lastResult.requestId && st.lastResult.requestId !== lastSeenResultIdRef.current) {
        lastSeenResultIdRef.current = st.lastResult.requestId;
        if (st.lastResult.ok) {
          showBanner('ok', st.lastResult.message || (zh ? '操作已执行' : 'Done'));
        } else {
          const msg = st.lastResult.message || (zh ? `操作未成功（错误码 ${st.lastResult.errId}）` : `Failed (${st.lastResult.errId})`);
          showBanner('err', msg, st.lastResult.errId === 10015 || msg.includes('10015'));
        }
      }
    } catch {
      // Keep last known view cleanly.
    }
  }, [installationId, showBanner, syncDraftFromSnapshot, zh]);

  const refreshLobby = useCallback(async (modeOverride?: number, userTriggered = false) => {
    const mode = modeOverride ?? lobbyModeId;
    setLobbyLoading(true);
    try {
      const resp = await invoke<{ rooms?: LobbyRoomSummary[]; mode?: number }>('account_room_lobby', { mode });
      setLobbyRooms(Array.isArray(resp?.rooms) ? resp.rooms : []);
      if (userTriggered) {
        showBanner('info', zh ? `已刷新「${getModeSpec(mode).name}」官方大厅列表` : 'Official lobby refreshed');
      }
    } catch (err) {
      if (userTriggered) showBanner('err', formatError(err));
    } finally {
      setLobbyLoading(false);
    }
  }, [lobbyModeId, showBanner, zh]);

  useEffect(() => {
    let active = true;
    void (async () => {
      void refreshCatalog();
      void refreshInGameState();
      try {
        const res = await invoke<{ status?: string; account?: AccountInfo | null }>('get_cloud_account');
        if (!active) return;
        const acct = res?.status === 'signed_in' && res.account?.uid ? res.account : null;
        setAccount(acct);
        if (acct) {
          void refreshLobby(lobbyModeId, false);
        }
      } catch {
        if (active) setAccount(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []); // initial mount load

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshInGameState();
    }, 1200);
    return () => window.clearInterval(timer);
  }, [refreshInGameState]);

  const copyText = async (key: string, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      showBanner('ok', zh ? `已复制${label}` : `Copied ${label}`);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      showBanner('err', zh ? '剪贴板不可用，请手动复制' : 'Clipboard unavailable');
    }
  };

  const handleLaunchGame = async () => {
    if (launchingGame || !installationId) return;
    setLaunchingGame(true);
    try {
      const start = await invoke<GameLaunchResult>('launcher_start', { installationId });
      if (!start.success && !start.alreadyRunning) {
        showBanner('err', start.message || (zh ? '未能启动游戏客户端' : 'Failed to start game'));
      } else {
        showBanner(
          'info',
          zh
            ? '已启动游戏，请在游戏内登录并进入主大厅后直接在此创建/修改房间。'
            : 'Game started. Log in and reach the lobby to create or manage a room here.',
        );
      }
    } catch (err) {
      showBanner('err', formatError(err));
    } finally {
      setLaunchingGame(false);
    }
  };

  const handleCreateOrModifyInGame = async () => {
    if (busyAction || !inLobbyReady) return;
    const modifying = inRoom;
    setBusyAction(modifying ? 'modify' : 'create');
    try {
      if (modifying) {
        await invoke<string>('in_game_room_modify', {
          installationId: installationId || null,
          request: {
            roomPwd: draft.password.trim().slice(0, 12),
            mapId: currentMap.id,
            difficulty: currentMode.hasDifficulty ? Math.max(0, Math.min(3, Math.trunc(draft.difficulty))) : 0,
            upgradePlan: currentMode.hasUpgrade ? draft.upgradePlan : currentMode.defaultUpgrade,
            timePlan: draft.timePlan,
            speedType: draft.speedType,
            skipStory: Boolean(currentMap.hasStory && draft.skipStory),
            roomLabel: draft.roomLabel,
          },
        });
        showBanner('info', zh ? '已向游戏客户端发送修改房间指令，等待游戏回包…' : 'Room update dispatched to game client…');
      } else {
        await invoke<string>('in_game_room_create', {
          installationId: installationId || null,
          request: {
            roomPwd: draft.password.trim().slice(0, 12),
            roomName: draft.roomName.trim().slice(0, 36),
            mode: currentMode.id,
            mapId: currentMap.id,
            difficulty: currentMode.hasDifficulty ? Math.max(0, Math.min(3, Math.trunc(draft.difficulty))) : 0,
            upgradePlan: currentMode.hasUpgrade ? draft.upgradePlan : currentMode.defaultUpgrade,
            timePlan: draft.timePlan,
            speedType: draft.speedType,
            skipStory: Boolean(currentMap.hasStory && draft.skipStory),
            roomLabel: draft.roomLabel,
          },
        });
        showBanner('info', zh ? '已向游戏内发送创建房间指令，请留意游戏窗口或此处状态…' : 'Create room command dispatched…');
      }
      window.setTimeout(() => void refreshInGameState(), 350);
    } catch (err) {
      const msg = formatError(err);
      showBanner('err', msg, isNotOpenError(err, msg));
    } finally {
      setBusyAction(null);
    }
  };

  const handleStartMatchInGame = async () => {
    if (busyAction || !inRoom || !isRoomHost) return;
    setBusyAction('start');
    try {
      await invoke<string>('in_game_room_start', {
        installationId: installationId || null,
        isAddBot: addBotsOnStart,
      });
      showBanner('info', zh ? '已发送游戏内开始对局指令…' : 'Start match command sent…');
      window.setTimeout(() => void refreshInGameState(), 350);
    } catch (err) {
      showBanner('err', formatError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleKickInGame = async (playerId: number, name: string) => {
    if (busyAction || !inRoom || !isRoomHost || playerId <= 0) return;
    setBusyAction(`kick:${playerId}`);
    try {
      await invoke<string>('in_game_room_kick', {
        installationId: installationId || null,
        targetPlayerId: playerId,
      });
      showBanner('info', zh ? `已发送移出 ${name || playerId} 指令…` : `Kick dispatched for ${name || playerId}`);
      window.setTimeout(() => void refreshInGameState(), 350);
    } catch (err) {
      showBanner('err', formatError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleExitInGame = async () => {
    if (busyAction || !inRoom) return;
    setBusyAction('exit');
    try {
      await invoke<string>('in_game_room_exit', {
        installationId: installationId || null,
      });
      lastSyncedRoomIdRef.current = 0;
      showBanner('info', zh ? '已发送退出当前房间指令…' : 'Exit room command sent…');
      window.setTimeout(() => void refreshInGameState(), 350);
    } catch (err) {
      showBanner('err', formatError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSearchRoom = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = searchRoomId.replace(/\D+/g, '').trim();
    if (!clean) {
      showBanner('err', zh ? '请输入要查询的数字房间号' : 'Enter a numeric room ID');
      return;
    }
    setBusyAction('search');
    try {
      const resp = await invoke<{ found?: boolean; roomId?: string; isPwd?: boolean; error?: string }>(
        'account_room_search',
        { roomId: clean },
      );
      setSearchResult({
        found: Boolean(resp?.found),
        roomId: resp?.roomId || clean,
        isPwd: Boolean(resp?.isPwd),
        error: resp?.error,
      });
    } catch (err) {
      showBanner('err', formatError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const snapshotInviteModel = useMemo<ActiveOfficialRoom | null>(() => {
    if (!snapshot || !inRoom) return null;
    const modeSpec = getModeSpec(snapshot.mode || draft.modeId);
    const mapSpec = getMapForMode(modeSpec.id, snapshot.mapId || draft.mapId);
    const diffSpec = DIFFICULTY_OPTIONS.find((d) => d.id === snapshot.difficulty);
    const upgSpec = UPGRADE_PLAN_OPTIONS.find((u) => u.id === snapshot.upgradePlan);
    const timeSpec = THINK_TIME_OPTIONS.find((t) => t.id === snapshot.timePlan);
    const spdSpec = SPEED_OPTIONS.find((s) => s.id === draft.speedType);
    return {
      roomId: String(snapshot.roomId),
      name: snapshot.name || `房间 #${snapshot.roomId}`,
      mode: modeSpec.id,
      modeName: modeSpec.name,
      mapId: mapSpec.id,
      mapName: mapSpec.name,
      difficulty: snapshot.difficulty,
      difficultyName: modeSpec.hasDifficulty && diffSpec ? diffSpec.label : '',
      timePlan: snapshot.timePlan,
      timePlanName: timeSpec ? timeSpec.label : '',
      speedType: draft.speedType,
      speedName: spdSpec ? spdSpec.label : '',
      upgradePlan: snapshot.upgradePlan,
      upgradeName: modeSpec.hasUpgrade && upgSpec ? upgSpec.label : '',
      roomLabel: draft.roomLabel,
      roomLabelName: '',
      skipStory: draft.skipStory,
      hasPwd: snapshot.hasPwd,
      pwd: snapshot.roomPwd,
      masterId: String(snapshot.masterId),
      playerCount: snapshot.players.length,
      maxPlayers: snapshot.maxPlayers || 4,
      status: snapshot.roomState || 'WAIT',
      handedOff: true,
      message: '',
      ttlSecondsRemaining: 0,
      canUpdate: snapshot.isHost,
      canKick: snapshot.isHost,
      players: [],
    };
  }, [draft.modeId, draft.mapId, draft.roomLabel, draft.skipStory, draft.speedType, inRoom, snapshot]);

  return (
    <div style={{ maxWidth: 1220, margin: '0 auto', paddingBottom: 40 }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              {zh ? '游戏内联机开房 · 实时控制' : 'In-Game Room Control'}
            </h1>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: 999,
                background: inLobbyReady ? 'var(--success-bg)' : 'var(--accent-soft)',
                color: inLobbyReady ? 'var(--success)' : 'var(--accent-text)',
                border: inLobbyReady ? '1px solid rgba(21, 128, 61, 0.25)' : '1px solid var(--accent-border)',
              }}
            >
              <ShieldCheck size={12} />
              {inLobbyReady
                ? (zh ? '已连接游戏客户端大厅 · 可直接开房/改房' : 'Connected to In-Game Lobby')
                : inGameState?.connected
                  ? (zh ? `已连接（当前状态：${inGameState.matchState}）` : `Connected (${inGameState.matchState})`)
                  : (zh ? '需在游戏内登录并进入大厅后使用' : 'Requires Running Game Lobby')}
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 6, marginBottom: 0 }}>
            {zh
              ? '为避免云端预建房被官方服务器回收，现改为在游戏运行并进入主大厅后直接发起建房、修改房规、踢人与开始对局。'
              : 'Create, modify, kick, and start rooms directly through the live running game client once signed in at the lobby.'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {inGameState?.playerId && inGameState.playerId > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 650,
                padding: '6px 12px',
                borderRadius: 999,
                background: 'var(--success-bg)',
                color: 'var(--success)',
                border: '1px solid rgba(21, 128, 61, 0.25)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <UserRound size={13} />
              {zh ? `局内 UID ${inGameState.playerId}` : `In-Game UID ${inGameState.playerId}`}
            </span>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '7px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => void refreshInGameState()}
          >
            <RefreshCw size={14} />
            {zh ? '刷新游戏连接' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {banner && (
        <div
          className="card"
          style={{
            padding: '10px 14px',
            marginBottom: 14,
            fontSize: 12.5,
            fontWeight: 600,
            background:
              banner.kind === 'err'
                ? 'var(--danger-bg, rgba(220, 38, 38, 0.08))'
                : banner.kind === 'ok'
                  ? 'var(--success-bg)'
                  : 'var(--accent-soft)',
            color:
              banner.kind === 'err'
                ? 'var(--danger, #b91c1c)'
                : banner.kind === 'ok'
                  ? 'var(--success)'
                  : 'var(--accent-text)',
            borderColor:
              banner.kind === 'err'
                ? 'rgba(220, 38, 38, 0.28)'
                : banner.kind === 'ok'
                  ? 'rgba(21, 128, 61, 0.28)'
                  : 'var(--accent-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <span>{banner.text}</span>
          {banner.recoverableMode && draft.modeId !== 4 && !inRoom && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '5px 12px', flexShrink: 0 }}
              onClick={() => {
                setDraft((prev) => applyModeSelection(prev, 4));
                setBanner(null);
              }}
            >
              {zh ? '切回合作挑战' : 'Switch to Co-op'}
            </button>
          )}
        </div>
      )}

      {/* In-Game Lobby Gate */}
      {!inLobbyReady && (
        <div
          className="card"
          style={{
            padding: 18,
            marginBottom: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            borderColor: 'var(--accent-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 360px' }}>
            <Gamepad2 size={22} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {inGameState?.connected
                  ? (zh ? `已连接游戏客户端（当前处于 ${inGameState.matchState}），请返回主大厅或等待房间后操作` : `Client connected (${inGameState.matchState}); return to Lobby to control room`)
                  : (zh ? '请先在安装「星枢官方插件 Mod」后启动游戏并进入大厅' : 'Launch the game with XingShu Official Plugin Mod and enter the lobby')}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                {zh
                  ? '游戏内打开后会自动与本页建立本地直连网桥；你可以直接在左侧选好地图、难度与密码，进入大厅后一点即建房并修改开局。'
                  : 'Once the running client reaches the lobby, room creation, edits, kicks, and game start activate automatically.'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {installationId && !inGameState?.connected && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={launchingGame}
                style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={() => void handleLaunchGame()}
              >
                <Play size={14} />
                {launchingGame ? (zh ? '正在启动…' : 'Launching…') : (zh ? '启动游戏' : 'Launch Game')}
              </button>
            )}
            <Link
              to="/extensions/launcher"
              className="btn btn-secondary"
              style={{ textDecoration: 'none', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Blocks size={14} />
              {zh ? '检查/安装官方插件 Mod' : 'Manage Plugin Mod'}
            </Link>
          </div>
        </div>
      )}

      {/* Two-Column Live Workspace */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: 18,
          alignItems: 'start',
        }}
      >
        {/* Left Panel: In-Game Room Create / Modify Form */}
        <section className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SlidersHorizontal size={17} style={{ color: 'var(--accent-text)' }} />
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                {inRoom ? (zh ? '修改游戏内房间参数' : 'Modify Active Room') : (zh ? '游戏内创建房间配置' : 'Create In-Game Room')}
              </h2>
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              {zh ? '6 种官方现役玩法 · 19 张地图' : '6 Modes · 19 Maps'}
            </span>
          </div>

          {/* 1. Mode */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                {zh ? '1. 对局模式（官方实装入口）' : '1. Game Mode'}
              </span>
              {inRoom && (
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {zh ? '退出当前房间后可切换模式' : 'Exit room to switch mode'}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              {OFFICIAL_MODES.map((m) => {
                const selected = draft.modeId === m.id;
                const open = modeOpenMap[m.id] !== false;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={inRoom}
                    onClick={() => setDraft((prev) => applyModeSelection(prev, m.id))}
                    style={{
                      textAlign: 'left',
                      padding: '9px 10px',
                      borderRadius: 10,
                      border: selected ? '1.5px solid var(--accent-border)' : '1px solid var(--border-color)',
                      background: selected ? 'var(--accent-soft)' : 'var(--bg-primary)',
                      color: selected ? 'var(--accent-text)' : 'var(--text-primary)',
                      cursor: inRoom ? 'not-allowed' : 'pointer',
                      opacity: inRoom && !selected ? 0.58 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{zh ? m.name : m.enName}</span>
                      {!open ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: 'rgba(100,116,139,0.16)', color: 'var(--text-secondary)' }}>
                          {zh ? '未开放' : 'Closed'}
                        </span>
                      ) : m.seasonal ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: 'rgba(217,119,6,0.14)', color: '#b45309' }}>
                          {zh ? '限时' : 'Event'}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {m.kind === 'pve' ? 'PVE 合作' : 'PVP 对战'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Maps */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 7 }}>
              {zh ? `2. 游玩地图（${modeMaps.length} 张可用）` : `2. Map (${modeMaps.length})`}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {modeMaps.map((map) => {
                const selected = map.id === currentMap.id;
                return (
                  <button
                    key={`${map.modeId}-${map.id}`}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        mapId: map.id,
                        skipStory: map.hasStory ? prev.skipStory : false,
                      }))
                    }
                    style={{
                      fontSize: 12.5,
                      fontWeight: selected ? 700 : 500,
                      padding: '6px 11px',
                      borderRadius: 9,
                      border: selected ? '1.5px solid var(--accent-border)' : '1px solid var(--border-color)',
                      background: selected ? 'var(--accent-soft)' : 'var(--bg-primary)',
                      color: selected ? 'var(--accent-text)' : 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    {zh ? map.name : map.enName}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Conditional Difficulty OR Upgrade Plan */}
          {currentMode.hasDifficulty && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 7 }}>
                {zh ? '3. 合作难度' : '3. Difficulty'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {DIFFICULTY_OPTIONS.map((d) => {
                  const selected = Math.min(3, draft.difficulty) === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, difficulty: d.id }))}
                      style={{
                        fontSize: 12.5,
                        fontWeight: selected ? 700 : 500,
                        padding: '6px 12px',
                        borderRadius: 9,
                        border: selected ? '1.5px solid var(--accent-border)' : '1px solid var(--border-color)',
                        background: selected ? 'var(--accent-soft)' : 'var(--bg-primary)',
                        color: selected ? 'var(--accent-text)' : 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      {zh ? d.label : d.enLabel}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 6 }}>
                {zh ? '极限难度仅官方限时开放（非活动期由官方返回 10015 / NotOpen）' : 'Extreme difficulty is only open during limited official events.'}
              </div>
            </div>
          )}

          {currentMode.hasUpgrade && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 7 }}>
                {zh ? '3. 升级星币方案' : '3. Star Coin Plan'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {UPGRADE_PLAN_OPTIONS.map((u) => {
                  const selected = draft.upgradePlan === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, upgradePlan: u.id }))}
                      style={{
                        fontSize: 12.5,
                        fontWeight: selected ? 700 : 500,
                        padding: '6px 11px',
                        borderRadius: 9,
                        border: selected ? '1.5px solid var(--accent-border)' : '1px solid var(--border-color)',
                        background: selected ? 'var(--accent-soft)' : 'var(--bg-primary)',
                        color: selected ? 'var(--accent-text)' : 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      {zh ? u.label : u.enLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Thinking Time & Game Speed */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
                {zh ? '思考时间' : 'Think Time'}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {THINK_TIME_OPTIONS.map((t) => {
                  const selected = draft.timePlan === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, timePlan: t.id }))}
                      style={{
                        flex: 1,
                        fontSize: 12.5,
                        fontWeight: selected ? 700 : 500,
                        padding: '6px 8px',
                        borderRadius: 9,
                        border: selected ? '1.5px solid var(--accent-border)' : '1px solid var(--border-color)',
                        background: selected ? 'var(--accent-soft)' : 'var(--bg-primary)',
                        color: selected ? 'var(--accent-text)' : 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      {zh ? t.label : t.enLabel}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
                {zh ? '对局速度' : 'Speed'}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {SPEED_OPTIONS.map((s) => {
                  const selected = draft.speedType === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, speedType: s.id }))}
                      style={{
                        flex: 1,
                        fontSize: 12.5,
                        fontWeight: selected ? 700 : 500,
                        padding: '6px 8px',
                        borderRadius: 9,
                        border: selected ? '1.5px solid var(--accent-border)' : '1px solid var(--border-color)',
                        background: selected ? 'var(--accent-soft)' : 'var(--bg-primary)',
                        color: selected ? 'var(--accent-text)' : 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      {zh ? s.label : s.enLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 5. Official Room Labels */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {zh ? '房间标签' : 'Room Tag'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {currentMode.labels.map((lbl) => {
                const selected = draft.roomLabel === lbl.id;
                return (
                  <button
                    key={lbl.id}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, roomLabel: lbl.id }))}
                    style={{
                      fontSize: 12,
                      fontWeight: selected ? 700 : 500,
                      padding: '5px 10px',
                      borderRadius: 999,
                      border: selected ? '1.5px solid var(--accent-border)' : '1px solid var(--border-color)',
                      background: selected ? 'var(--accent-soft)' : 'var(--bg-primary)',
                      color: selected ? 'var(--accent-text)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    {zh ? lbl.label : lbl.enLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 6. Optional Skip Story */}
          {currentMap.hasStory && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12.5,
                fontWeight: 600,
                marginBottom: 14,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={draft.skipStory}
                onChange={(e) => setDraft((prev) => ({ ...prev, skipStory: e.target.checked }))}
              />
              {zh ? `跳过「${currentMap.name}」开场剧情` : `Skip story intro on ${currentMap.enName}`}
            </label>
          )}

          {/* 7. Room Name + Password */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 }}>
                {zh ? '房间名称（创建时有效）' : 'Room Name'}
              </label>
              <input
                type="text"
                maxLength={36}
                disabled={inRoom}
                placeholder={zh ? '留空自动使用昵称默认房名…' : 'Default room name'}
                value={draft.roomName}
                onChange={(e) => setDraft((prev) => ({ ...prev, roomName: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 9,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: 12.5,
                  opacity: inRoom ? 0.65 : 1,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 }}>
                {zh ? '房间密码（选填，留空公开）' : 'Password (optional)'}
              </label>
              <input
                type="text"
                maxLength={12}
                placeholder={zh ? '公开无密码' : 'Public'}
                value={draft.password}
                onChange={(e) => setDraft((prev) => ({ ...prev, password: e.target.value.slice(0, 12) }))}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 9,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: 12.5,
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
            </div>
          </div>

          {/* Primary Action */}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!inLobbyReady || busyAction !== null || (inRoom && !isRoomHost)}
            style={{ width: '100%', padding: '11px 16px', fontSize: 14, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={() => void handleCreateOrModifyInGame()}
          >
            <Gamepad2 size={16} />
            {!inLobbyReady
              ? (zh ? '请先进入游戏大厅后开房' : 'Enter In-Game Lobby First')
              : inRoom
                ? isRoomHost
                  ? busyAction === 'modify'
                    ? (zh ? '正在向游戏发送改房…' : 'Updating Room…')
                    : (zh ? `立即同步修改房间 #${snapshot?.roomId}` : `Apply Changes to #${snapshot?.roomId}`)
                  : (zh ? '当前非房主，不可修改房规' : 'Host Only')
                : busyAction === 'create'
                  ? (zh ? '正在游戏内建房…' : 'Creating Room…')
                  : (zh ? '一键游戏内直连建房' : 'Create Room In-Game')}
          </button>
        </section>

        {/* Right Panel: Live In-Game Room Status + Optional Official Lobby Lookup */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={17} style={{ color: 'var(--accent-text)' }} />
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                  {zh ? '当前游戏内房间状态' : 'Live In-Game Room'}
                </h2>
              </div>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: inRoom ? 'var(--success-bg)' : 'rgba(120, 117, 110, 0.12)',
                  color: inRoom ? 'var(--success)' : 'var(--text-secondary)',
                  border: inRoom ? '1px solid rgba(21, 128, 61, 0.25)' : '1px solid rgba(120, 117, 110, 0.24)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {inRoom && snapshot
                  ? (zh ? `等待房 · ${snapshot.players.length}/${snapshot.maxPlayers || 4} 人` : `Waiting · ${snapshot.players.length}/${snapshot.maxPlayers || 4}`)
                  : inLobbyReady
                    ? (zh ? '大厅待建房' : 'In Lobby')
                    : (zh ? '未连接游戏' : 'Offline')}
              </span>
            </div>

            {!inRoom || !snapshot ? (
              <div
                style={{
                  padding: '18px 14px',
                  borderRadius: 12,
                  background: 'var(--bg-primary)',
                  border: '1px dashed var(--border-color)',
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {inLobbyReady
                  ? (zh
                      ? '已检测到你正在游戏大厅！在左侧选好模式、地图与密码后点击「一键游戏内直连建房」，游戏将立即打开真实官方等待房。'
                      : 'In-game lobby detected! Pick mode and map on the left and click Create Room In-Game.')
                  : (zh
                      ? '尚未检测到游戏进入大厅状态。使用「星枢官方插件 Mod」启动游戏并登录后，此处会自动显示当前实时房间席位、房规修改与直接开局按钮。'
                      : 'Waiting for the game client with XingShu Official Plugin Mod to reach the lobby.')}
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div
                      style={{
                        fontSize: 28,
                        fontWeight: 800,
                        letterSpacing: 1,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--text-primary)',
                      }}
                    >
                      #{snapshot.roomId}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{snapshot.name}</div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {isRoomHost ? (zh ? '你是房主' : 'You are Host') : (zh ? `房主 UID ${snapshot.masterId}` : `Host ${snapshot.masterId}`)}
                  </span>
                </div>

                {snapshotInviteModel && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.55 }}>
                    {[
                      snapshotInviteModel.modeName,
                      snapshotInviteModel.mapName,
                      snapshotInviteModel.difficultyName,
                      snapshotInviteModel.upgradeName,
                      snapshotInviteModel.timePlanName ? `思考:${snapshotInviteModel.timePlanName}` : '',
                      snapshot.hasPwd ? (snapshot.roomPwd ? `密码:${snapshot.roomPwd}` : '私密房间') : '公开',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}

                {isRoomHost && (
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      fontSize: 12.5,
                      fontWeight: 600,
                      marginTop: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={addBotsOnStart}
                      onChange={(e) => setAddBotsOnStart(e.target.checked)}
                    />
                    {zh ? '开局时自动补足人机队友' : 'Fill empty seats with bots on start'}
                  </label>
                )}

                {/* Live Room Actions */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    onClick={() => void copyText('roomId', String(snapshot.roomId), '房间号')}
                  >
                    {copiedKey === 'roomId' ? <Check size={13} /> : <Copy size={13} />}
                    {zh ? '复制房号' : 'Copy ID'}
                  </button>
                  {snapshotInviteModel && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      onClick={() => void copyText('invite', buildInviteCopyText(snapshotInviteModel, zh), '组队邀请')}
                    >
                      {copiedKey === 'invite' ? <Check size={13} /> : <Copy size={13} />}
                      {zh ? '复制组队邀请' : 'Copy Invite'}
                    </button>
                  )}
                  {isRoomHost && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busyAction !== null}
                      style={{ fontSize: 12, padding: '6px 14px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      onClick={() => void handleStartMatchInGame()}
                    >
                      <Play size={13} />
                      {busyAction === 'start' ? (zh ? '正在启动…' : 'Starting…') : (zh ? '开始对局' : 'Start Match')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busyAction !== null}
                    style={{ fontSize: 12, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--danger, #b91c1c)' }}
                    onClick={() => void handleExitInGame()}
                  >
                    <DoorOpen size={13} />
                    {busyAction === 'exit' ? (zh ? '正在退出…' : 'Exiting…') : (zh ? '退出房间' : 'Exit Room')}
                  </button>
                </div>

                {/* Live P1-P4 Seats */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                  {[0, 1, 2, 3].map((slotIdx) => {
                    const player = snapshot.players.find((p) => p.slot === slotIdx);
                    if (!player) {
                      return (
                        <div
                          key={slotIdx}
                          style={{
                            padding: '9px 12px',
                            borderRadius: 10,
                            border: '1px dashed var(--border-color)',
                            color: 'var(--text-secondary)',
                            fontSize: 12,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span>P{slotIdx + 1} · {zh ? '等待队友加入空位…' : 'Open slot'}</span>
                          <span>{snapshot.hasPwd ? (zh ? '凭密码加入' : 'Password') : (zh ? '公开可进' : 'Open')}</span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={`${slotIdx}-${player.playerId}`}
                        style={{
                          padding: '9px 12px',
                          borderRadius: 10,
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 13 }}>P{slotIdx + 1} {player.name || `玩家 ${player.playerId}`}</strong>
                            {player.isHost && (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  padding: '2px 7px',
                                  borderRadius: 999,
                                  background: 'var(--accent-soft)',
                                  color: 'var(--accent-text)',
                                }}
                              >
                                <Crown size={11} />
                                {zh ? '房主' : 'Host'}
                              </span>
                            )}
                            {player.isBot && (
                              <span
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  padding: '2px 7px',
                                  borderRadius: 999,
                                  background: 'rgba(100,116,139,0.14)',
                                  color: 'var(--text-secondary)',
                                }}
                              >
                                {zh ? '人机' : 'Bot'}
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: 11,
                                color: player.ready ? 'var(--success)' : 'var(--text-secondary)',
                                fontWeight: 600,
                              }}
                            >
                              {player.isHost ? (zh ? '房主就绪' : 'Host') : player.ready ? (zh ? '已准备' : 'Ready') : (zh ? '未准备' : 'Not Ready')}
                            </span>
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                            UID {player.playerId}{player.level > 0 ? ` · Lv.${player.level}` : ''}
                          </div>
                        </div>

                        {isRoomHost && !player.isSelf && !player.isHost && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={busyAction !== null}
                            style={{ fontSize: 11.5, padding: '4px 9px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            onClick={() => void handleKickInGame(player.playerId, player.name)}
                          >
                            <UserX size={12} />
                            {zh ? '移出' : 'Kick'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Optional Read-Only Official Lobby Browser */}
          <section className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                {zh ? '官方实时大厅与房号核查（只读）' : 'Official Lobby Browser (Read-Only)'}
              </h2>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!account || lobbyLoading}
                style={{ fontSize: 12, padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                onClick={() => void refreshLobby(lobbyModeId, true)}
              >
                <RefreshCw size={13} />
                {lobbyLoading ? (zh ? '拉取中…' : 'Loading…') : (zh ? '刷新列表' : 'Refresh')}
              </button>
            </div>

            <form onSubmit={(e) => void handleSearchRoom(e)} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                type="text"
                inputMode="numeric"
                placeholder={zh ? '输入官方数字房间号查询…' : 'Enter numeric Room ID…'}
                value={searchRoomId}
                onChange={(e) => setSearchRoomId(e.target.value)}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: 9,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: 12.5,
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!account || busyAction !== null}
                style={{ fontSize: 12.5, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <Search size={14} />
                {zh ? '查房' : 'Search'}
              </button>
            </form>

            {searchResult && (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 10,
                  marginBottom: 10,
                  fontSize: 12.5,
                  background: searchResult.found ? 'var(--success-bg)' : 'var(--bg-primary)',
                  color: searchResult.found ? 'var(--success)' : 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span>
                  {searchResult.found
                    ? `房间 #${searchResult.roomId} 在官方等待大厅中（${searchResult.isPwd ? '设有密码' : '公开无需密码'}）`
                    : searchResult.error || `未找到房间 #${searchResult.roomId}`}
                </span>
                {searchResult.found && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 11.5, padding: '3px 9px' }}
                    onClick={() => void copyText(`search-${searchResult.roomId}`, searchResult.roomId, '房间号')}
                  >
                    {zh ? '复制房号' : 'Copy'}
                  </button>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {OFFICIAL_MODES.map((m) => {
                const selected = m.id === lobbyModeId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!account}
                    onClick={() => {
                      setLobbyModeId(m.id);
                      void refreshLobby(m.id, false);
                    }}
                    style={{
                      fontSize: 12,
                      fontWeight: selected ? 700 : 500,
                      padding: '5px 10px',
                      borderRadius: 999,
                      border: selected ? '1.5px solid var(--accent-border)' : '1px solid var(--border-color)',
                      background: selected ? 'var(--accent-soft)' : 'var(--bg-primary)',
                      color: selected ? 'var(--accent-text)' : 'var(--text-secondary)',
                      cursor: account ? 'pointer' : 'default',
                    }}
                  >
                    {zh ? m.name : m.enName}
                  </button>
                );
              })}
            </div>

            {!account ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                {zh ? '如需查看官方大厅列表，可先在「游戏账号」中绑定账号（不影响游戏内直接建房）。' : 'Optional: bind a game account to browse official waiting rooms.'}
              </div>
            ) : lobbyRooms.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', padding: '12px 0' }}>
                {lobbyLoading
                  ? (zh ? '正在向官方服务器查询大厅列表…' : 'Querying official lobby…')
                  : (zh ? '该模式当前暂无正在等待开局的公开房间。' : 'No waiting rooms found in this mode.')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                {lobbyRooms.map((item) => (
                  <div
                    key={item.roomId}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 13 }}>{item.name || `房间 ${item.roomId}`}</strong>
                        {item.hasPwd && <Lock size={12} style={{ color: 'var(--text-secondary)' }} />}
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '1px 7px',
                            borderRadius: 999,
                            background: 'var(--accent-soft)',
                            color: 'var(--accent-text)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {item.playerCount}/{item.maxPlayers}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                        #{item.roomId} · {item.mapName}
                        {item.difficultyName ? ` · ${item.difficultyName}` : ''}
                        {item.speedName ? ` · ${item.speedName}局` : ''}
                        {item.roomLabelName && item.roomLabelName !== '无标签' ? ` · [${item.roomLabelName}]` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 11.5, padding: '5px 10px', flexShrink: 0 }}
                      onClick={() => void copyText(`lobby-${item.roomId}`, item.roomId, '房间号')}
                    >
                      {copiedKey === `lobby-${item.roomId}` ? (zh ? '已复制' : 'Copied') : (zh ? '复制房号' : 'Copy')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
