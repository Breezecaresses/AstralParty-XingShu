import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Check,
  Film,
  FolderOpen,
  Home,
  Image as ImageIcon,
  Layers,
  PackageOpen,
  Paintbrush,
  Plus,
  RefreshCw,
  RotateCcw,
  Sliders,
  Trash2,
  Type as TypeIcon,
  Upload,
  UserRound,
  Volume2,
  Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import { api, type DroppedModRecord } from '../../shared/api/tauri';
import { isTauriRuntime } from '../../shared/runtime';
import { useExtensionTarget } from '../extensions/ExtensionWorkspace';
import { broadcastLauncherBgImage, useLauncherAppearance } from '../launcher/launcherTheme';
import { errorMessage } from '../launcher/launcherModel';
import './customize.css';

type CustomizeSection =
  | 'cards'
  | 'audio'
  | 'packs'
  | 'fonts'
  | 'lobbyBg'
  | 'characters'
  | 'homeUiDebug'
  | 'launcherBg';

interface LobbyBgMediaEntry {
  fileName: string;
  kind: 'image' | 'video' | 'usm' | 'bundle' | string;
  sizeBytes: number;
  modifiedAt: number;
  previewDataUrl?: string | null;
}

interface LobbyBgConfig {
  enabled: boolean;
  selectedFile: string;
  syncSubPanels: boolean;
  randomOnLobby: boolean;
  fillMode: 'cover' | 'contain' | 'stretch' | string;
  brightness: number;
  speed: number;
  muted: boolean;
  volume: number;
  muteVanillaBgm: boolean;
  updatedAt: number;
}

interface LobbyBgState {
  gameRoot: string;
  lobbyDir: string;
  sidecarPath: string;
  gameRunning: boolean;
  files: LobbyBgMediaEntry[];
  config: LobbyBgConfig;
}

interface CustomizeProfileItem {
  id: string;
  name: string;
  modIds: string[];
  updatedAt: number;
}

interface HomeUiDebugConfig {
  hideVanillaBgAnim: boolean;
  compactLobbyBadges: boolean;
  showDebugOutline: boolean;
  customHudOpacity: number;
  hideLobbyAds: boolean;
}

interface CustomizeTuningState {
  activeCardProfile: string | null;
  cardProfiles: CustomizeProfileItem[];
  activeAudioProfile: string | null;
  audioProfiles: CustomizeProfileItem[];
  activeCharacterProfile: string | null;
  characterProfiles: CustomizeProfileItem[];
  selectedFontFamily: string | null;
  selectedFontFile: string | null;
  fontCjkOnly: boolean;
  fontReplaceHeadings: boolean;
  homeUiDebug: HomeUiDebugConfig;
  updatedAt: number;
}

interface SystemFontEntry {
  family: string;
  displayName: string;
  filePath: string;
  styleLabel: string;
  likelyCjk: boolean;
}

const DEFAULT_TUNING: CustomizeTuningState = {
  activeCardProfile: null,
  cardProfiles: [],
  activeAudioProfile: null,
  audioProfiles: [],
  activeCharacterProfile: null,
  characterProfiles: [],
  selectedFontFamily: null,
  selectedFontFile: null,
  fontCjkOnly: true,
  fontReplaceHeadings: true,
  homeUiDebug: {
    hideVanillaBgAnim: false,
    compactLobbyBadges: false,
    showDebugOutline: false,
    customHudOpacity: 100,
    hideLobbyAds: false,
  },
  updatedAt: 0,
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CustomizePage() {
  const zh = useTranslation().locale === 'zh-CN';
  const tauri = isTauriRuntime();
  const target = useExtensionTarget();
  const installationId = target.selected?.id ?? '';

  const [section, setSection] = useState<CustomizeSection>('lobbyBg');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);

  const [lobbyState, setLobbyState] = useState<LobbyBgState | null>(null);
  const [tuning, setTuning] = useState<CustomizeTuningState>(DEFAULT_TUNING);
  const [droppedMods, setDroppedMods] = useState<DroppedModRecord[]>([]);
  const [fonts, setFonts] = useState<SystemFontEntry[]>([]);
  const [fontSearch, setFontSearch] = useState('');
  const [newProfileName, setNewProfileName] = useState('');

  const appearance = useLauncherAppearance();

  const reloadLobbyBg = useCallback(async () => {
    if (!tauri || !installationId) return;
    try {
      const next = await invoke<LobbyBgState>('customize_get_lobby_bg_state', { installationId });
      setLobbyState(next);
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    }
  }, [installationId, tauri]);

  const reloadTuning = useCallback(async () => {
    if (!tauri || !installationId) return;
    try {
      const next = await invoke<CustomizeTuningState>('customize_get_tuning_state', { installationId });
      setTuning(next);
    } catch {
      // Keep default state if unavailable.
    }
  }, [installationId, tauri]);

  const reloadDroppedMods = useCallback(async () => {
    if (!tauri || !installationId) return;
    try {
      const rows = await api.listDroppedMods(installationId);
      setDroppedMods(rows);
    } catch {
      // Ignore if installation lacks local mods yet.
    }
  }, [installationId, tauri]);

  useEffect(() => {
    void reloadLobbyBg();
    void reloadTuning();
    void reloadDroppedMods();
  }, [reloadDroppedMods, reloadLobbyBg, reloadTuning]);

  useEffect(() => {
    if (!tauri || section !== 'fonts' || fonts.length > 0) return;
    invoke<SystemFontEntry[]>('customize_list_system_fonts')
      .then((list) => setFonts(list))
      .catch(() => {});
  }, [fonts.length, section, tauri]);

  const saveLobbyConfig = async (patch: Partial<LobbyBgConfig>) => {
    if (!tauri || !installationId || !lobbyState) return;
    setBusy(true);
    try {
      const nextCfg: LobbyBgConfig = {
        ...lobbyState.config,
        ...patch,
        updatedAt: Date.now(),
      };
      const next = await invoke<LobbyBgState>('customize_save_lobby_bg_config', {
        installationId,
        config: nextCfg,
      });
      setLobbyState(next);
      setNotice({ kind: 'success', text: zh ? '已保存主页背景配置，游戏内将自动同步生效。' : 'Lobby background settings synced.' });
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      setBusy(false);
    }
  };

  const handleImportLobbyBg = async (mode: 'image' | 'video') => {
    if (!tauri || !installationId) return;
    setBusy(true);
    setNotice(null);
    try {
      const filter =
        mode === 'image'
          ? '图片素材 (*.png;*.jpg;*.jpeg;*.webp;*.bmp)|*.png;*.jpg;*.jpeg;*.webp;*.bmp'
          : '视频或动效包 (*.mp4;*.webm;*.mov;*.m4v;*.usm;*.bundle)|*.mp4;*.webm;*.mov;*.m4v;*.usm;*.bundle';
      const paths = await invoke<string[]>('customize_pick_files', {
        title: mode === 'image' ? '选择主页背景图片' : '选择主页背景视频或动效包',
        filter,
        multi: true,
      });
      if (!paths || paths.length === 0) return;
      const next = await invoke<LobbyBgState>('customize_import_lobby_bg_media', {
        installationId,
        sourcePaths: paths,
      });
      setLobbyState(next);
      setNotice({
        kind: 'success',
        text: zh
          ? `已导入并设为当前主页背景：${next.config.selectedFile}（游戏内大堂实时/下次返回即生效）。`
          : `Imported & activated ${next.config.selectedFile}.`,
      });
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteLobbyBg = async (fileName: string) => {
    if (!tauri || !installationId) return;
    setBusy(true);
    try {
      const next = await invoke<LobbyBgState>('customize_delete_lobby_bg_media', {
        installationId,
        fileName,
      });
      setLobbyState(next);
      setNotice({ kind: 'success', text: zh ? `已移除素材：${fileName}` : `Removed ${fileName}` });
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      setBusy(false);
    }
  };

  const handleImportResourcePack = async () => {
    if (!tauri || !installationId) return;
    setBusy(true);
    setNotice(null);
    try {
      const paths = await invoke<string[]>('customize_pick_files', {
        title: '导入模组资源包（ZIP / RML / .xspkg / RAR / 7Z）',
        filter: '模组或资源包 (*.zip;*.xspkg;*.rar;*.7z;*.bundle)|*.zip;*.xspkg;*.rar;*.7z;*.bundle|所有文件 (*.*)|*.*',
        multi: true,
      });
      if (!paths || paths.length === 0) return;
      let installed = 0;
      for (const path of paths) {
        await api.installDroppedMod(installationId, path, true);
        installed += 1;
      }
      await reloadDroppedMods();
      setNotice({
        kind: 'success',
        text: zh ? `已安装 ${installed} 个自定义资源包。` : `Installed ${installed} pack(s).`,
      });
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePack = async (record: DroppedModRecord, nextEnabled: boolean) => {
    if (!tauri || !installationId) return;
    setBusy(true);
    try {
      await api.toggleDroppedMod(installationId, record.modId, nextEnabled);
      await reloadDroppedMods();
      setNotice({
        kind: 'success',
        text: nextEnabled ? `已开启 ${record.name}` : `已关闭 ${record.name}`,
      });
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      setBusy(false);
    }
  };

  const handleRemovePack = async (record: DroppedModRecord) => {
    if (!tauri || !installationId) return;
    setBusy(true);
    try {
      await api.restoreDroppedMod(installationId, record.modId);
      await reloadDroppedMods();
      setNotice({ kind: 'success', text: `已还原并移除 ${record.name}` });
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      setBusy(false);
    }
  };

  const saveTuning = async (next: CustomizeTuningState, okText?: string) => {
    setTuning(next);
    if (!tauri || !installationId) return;
    setBusy(true);
    try {
      const saved = await invoke<CustomizeTuningState>('customize_save_tuning_state', {
        installationId,
        state: next,
      });
      setTuning(saved);
      if (okText) setNotice({ kind: 'success', text: okText });
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateProfile = async (kind: 'cards' | 'audio' | 'characters') => {
    const clean = newProfileName.trim();
    if (!clean) return;
    const item: CustomizeProfileItem = {
      id: `prof-${Date.now()}`,
      name: clean,
      modIds: [],
      updatedAt: Date.now(),
    };
    const next: CustomizeTuningState = {
      ...tuning,
      ...(kind === 'cards'
        ? { cardProfiles: [...tuning.cardProfiles, item], activeCardProfile: item.id }
        : kind === 'audio'
          ? { audioProfiles: [...tuning.audioProfiles, item], activeAudioProfile: item.id }
          : { characterProfiles: [...tuning.characterProfiles, item], activeCharacterProfile: item.id }),
    };
    setNewProfileName('');
    await saveTuning(next, `已创建方案「${clean}」`);
  };

  const handlePickLauncherWallpaper = async () => {
    if (!tauri) return;
    setBusy(true);
    setNotice(null);
    try {
      const paths = await invoke<string[]>('customize_pick_files', {
        title: '选择星枢启动器背景图片',
        filter: '图片文件 (*.png;*.jpg;*.jpeg;*.webp;*.bmp)|*.png;*.jpg;*.jpeg;*.webp;*.bmp',
        multi: false,
      });
      if (!paths || paths.length === 0) return;
      const info = await invoke<{ hasImage: boolean; fileName: string | null; dataUrl: string | null }>(
        'customize_save_launcher_bg',
        { sourcePath: paths[0] },
      );
      broadcastLauncherBgImage(info.dataUrl, info.fileName);
      setNotice({ kind: 'success', text: '已更新星枢启动器外观背景。' });
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      setBusy(false);
    }
  };

  const handleClearLauncherWallpaper = async () => {
    if (!tauri) return;
    setBusy(true);
    try {
      await invoke('customize_clear_launcher_bg');
      broadcastLauncherBgImage(null, null);
      setNotice({ kind: 'success', text: '已恢复星枢默认外观背景。' });
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      setBusy(false);
    }
  };

  const selectedMedia = useMemo(() => {
    if (!lobbyState?.config.selectedFile) return lobbyState?.files[0] ?? null;
    return (
      lobbyState.files.find(
        (f) => f.fileName.toLowerCase() === lobbyState.config.selectedFile.toLowerCase(),
      ) ?? null
    );
  }, [lobbyState]);

  const filteredFonts = useMemo(() => {
    const q = fontSearch.trim().toLowerCase();
    return fonts
      .filter((f) => {
        if (tuning.fontCjkOnly && !f.likelyCjk) return false;
        if (!q) return true;
        return (
          f.family.toLowerCase().includes(q) ||
          f.displayName.toLowerCase().includes(q) ||
          f.filePath.toLowerCase().includes(q)
        );
      })
      .slice(0, 72);
  }, [fontSearch, fonts, tuning.fontCjkOnly]);

  const gameNavItems: Array<{ id: CustomizeSection; Icon: typeof Home; zh: string; badge?: string }> = [
    { id: 'cards', Icon: Layers, zh: '卡牌' },
    { id: 'audio', Icon: Volume2, zh: '音效' },
    { id: 'packs', Icon: PackageOpen, zh: '资源包' },
    { id: 'fonts', Icon: TypeIcon, zh: '字体', badge: '调试' },
    { id: 'lobbyBg', Icon: Home, zh: '主页背景', badge: '已内置' },
    { id: 'characters', Icon: UserRound, zh: '角色' },
    { id: 'homeUiDebug', Icon: Wrench, zh: '主界面调试', badge: '调试' },
  ];

  const renderGameBar = () => (
    <section className="pcl-card xs-cust-game-bar">
      <strong style={{ fontSize: 13 }}>{zh ? '当前游戏' : 'Active Game'}</strong>
      <select
        value={installationId}
        onChange={(e) => {
          const picked = target.targets.find((g) => g.id === e.target.value);
          if (picked && picked.platform !== target.channel) {
            target.setChannel(picked.platform);
          }
          target.select(e.target.value);
        }}
        disabled={target.targets.length === 0}
      >
        {target.targets.length === 0 ? (
          <option value="">{zh ? '尚未扫描到游戏目录' : 'No game folder'}</option>
        ) : (
          target.targets.map((g) => (
            <option key={g.id} value={g.id}>
              {g.platform} · {g.install_path}
            </option>
          ))
        )}
      </select>
      <span className="xs-cust-game-path" title={target.selected?.install_path ?? ''}>
        {target.selected?.install_path || (zh ? '请先在诊断或首页选择游戏目录' : 'Select a game folder first')}
      </span>
      <Link className="xs-cust-btn" to="/diagnostics">
        {zh ? '管理游戏目录…' : 'Manage Folders…'}
      </Link>
    </section>
  );

  const renderLobbyBgSection = () => {
    const cfg = lobbyState?.config;
    const isEnabled = Boolean(cfg?.enabled);
    return (
      <>
        <div className="xs-cust-head">
          <div>
            <h1>{zh ? '自定义 · 主页背景（已内置）' : 'Customize · Lobby Background'}</h1>
            <p className="xs-cust-head-sub">
              {zh
                ? '原本独立的「自定义大厅背景」已彻底内置到星枢核心，修改后自动与游戏内 `F1 -> 大厅背景` 双向实时同步。'
                : 'Built directly into XingShu core and live-synced with the game.'}
            </p>
          </div>
          <div className="xs-cust-actions">
            <button type="button" className="xs-cust-btn" disabled={busy || !installationId} onClick={() => void handleImportLobbyBg('video')}>
              <Film size={14} />
              <span>{zh ? '选择视频 / USM…' : 'Pick Video…'}</span>
            </button>
            <button type="button" className="xs-cust-btn is-primary" disabled={busy || !installationId} onClick={() => void handleImportLobbyBg('image')}>
              <Upload size={14} />
              <span>{zh ? '选择图片…' : 'Pick Image…'}</span>
            </button>
          </div>
        </div>

        {renderGameBar()}

        <section className="pcl-card">
          <div className="xs-cust-preview-box">
            {isEnabled && selectedMedia?.previewDataUrl ? (
              <img src={selectedMedia.previewDataUrl} alt={selectedMedia.fileName} />
            ) : (
              <div className="xs-cust-preview-placeholder">
                <Home size={28} />
                <strong>
                  {isEnabled && selectedMedia
                    ? `${selectedMedia.fileName}（${selectedMedia.kind.toUpperCase()}）`
                    : zh
                      ? '游戏默认背景'
                      : 'Game Default Background'}
                </strong>
                <span>
                  {isEnabled && selectedMedia
                    ? `${formatBytes(selectedMedia.sizeBytes)} · 点击下方开关与素材即可即时切换`
                    : zh
                      ? '选择图片或视频后自动复制到游戏 lobbybg 目录并在游戏内生效'
                      : 'Import image or video media to override the game lobby'}
                </span>
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ fontSize: 12.5, color: 'var(--pcl-muted)' }}>
              {zh ? '当前状态：' : 'Active: '}
              <strong style={{ color: 'var(--pcl-ink)' }}>
                {isEnabled && (cfg?.selectedFile || selectedMedia?.fileName)
                  ? `已启用 · ${cfg?.selectedFile || selectedMedia?.fileName}`
                  : zh
                    ? '游戏默认'
                    : 'Game Default'}
              </strong>
            </div>
            <div className="xs-cust-actions">
              <button
                type="button"
                className="xs-cust-btn"
                disabled={busy || !lobbyState}
                onClick={() => void saveLobbyConfig({ enabled: !isEnabled })}
              >
                {isEnabled ? '暂停自定义背景' : '启用自定义背景'}
              </button>
              <button
                type="button"
                className="xs-cust-btn"
                disabled={busy || !lobbyState}
                onClick={() => void saveLobbyConfig({ enabled: false, selectedFile: '' })}
              >
                <RotateCcw size={13} />
                <span>恢复游戏默认</span>
              </button>
              <button
                type="button"
                className="xs-cust-btn"
                disabled={!installationId}
                onClick={() => void invoke('customize_open_lobby_bg_dir', { installationId }).catch(() => {})}
              >
                <FolderOpen size={13} />
                <span>打开 lobbybg 目录</span>
              </button>
            </div>
          </div>

          {lobbyState && cfg && (
            <div style={{ marginTop: 14 }}>
              <div className="xs-cust-control-row">
                <span>画面缩放模式</span>
                <div className="xs-cust-seg">
                  {[
                    { id: 'cover', label: '等比填满' },
                    { id: 'contain', label: '完整显示' },
                    { id: 'stretch', label: '拉伸填充' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={cfg.fillMode === opt.id ? 'is-active' : ''}
                      onClick={() => void saveLobbyConfig({ fillMode: opt.id })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="xs-cust-control-row">
                <span>同步替换二级界面背景（选角 / 房间 / 商店）</span>
                <button
                  type="button"
                  className={`xs-cust-btn${cfg.syncSubPanels ? ' is-primary' : ''}`}
                  onClick={() => void saveLobbyConfig({ syncSubPanels: !cfg.syncSubPanels })}
                >
                  {cfg.syncSubPanels ? '已开启' : '已关闭'}
                </button>
              </div>
              <div className="xs-cust-control-row">
                <span>关闭原版大厅背景音乐（进对局自动恢复）</span>
                <button
                  type="button"
                  className={`xs-cust-btn${cfg.muteVanillaBgm ? ' is-primary' : ''}`}
                  onClick={() => void saveLobbyConfig({ muteVanillaBgm: !cfg.muteVanillaBgm })}
                >
                  {cfg.muteVanillaBgm ? '已开启' : '已关闭'}
                </button>
              </div>
              <div className="xs-cust-control-row">
                <span>自定义视频声音（关闭静音即播放背景音乐）</span>
                <button
                  type="button"
                  className={`xs-cust-btn${!cfg.muted ? ' is-primary' : ''}`}
                  onClick={() => void saveLobbyConfig({ muted: !cfg.muted })}
                >
                  {cfg.muted ? '已静音' : '播放视频原声'}
                </button>
              </div>
              <div className="xs-cust-control-row">
                <span>视频音量</span>
                <div className="xs-cust-slider-wrap">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(cfg.volume * 100)}
                    onChange={(e) => void saveLobbyConfig({ volume: Number(e.target.value) / 100 })}
                  />
                  <span className="xs-cust-slider-val">{Math.round(cfg.volume * 100)}%</span>
                </div>
              </div>
              <div className="xs-cust-control-row">
                <span>画面亮度</span>
                <div className="xs-cust-slider-wrap">
                  <input
                    type="range"
                    min={30}
                    max={100}
                    value={Math.round(cfg.brightness * 100)}
                    onChange={(e) => void saveLobbyConfig({ brightness: Number(e.target.value) / 100 })}
                  />
                  <span className="xs-cust-slider-val">{Math.round(cfg.brightness * 100)}%</span>
                </div>
              </div>
            </div>
          )}

          {lobbyState && lobbyState.files.length > 0 && (
            <div className="xs-cust-media-list">
              <strong style={{ fontSize: 12.5, marginTop: 4 }}>lobbybg 目录可用素材（{lobbyState.files.length} 个）</strong>
              {lobbyState.files.map((file) => {
                const isActive = cfg?.selectedFile.toLowerCase() === file.fileName.toLowerCase();
                return (
                  <div key={file.fileName} className={`xs-cust-media-row${isActive ? ' is-selected' : ''}`}>
                    <span className="xs-cust-badge">{file.kind.toUpperCase()}</span>
                    <span className="xs-cust-media-name">{file.fileName}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--pcl-muted)' }}>{formatBytes(file.sizeBytes)}</span>
                    <button
                      type="button"
                      className={`xs-cust-btn${isActive && isEnabled ? ' is-primary' : ''}`}
                      onClick={() => void saveLobbyConfig({ enabled: true, selectedFile: file.fileName })}
                    >
                      {isActive && isEnabled ? '使用中' : '应用'}
                    </button>
                    <button
                      type="button"
                      className="xs-cust-btn"
                      title="删除素材"
                      onClick={() => void handleDeleteLobbyBg(file.fileName)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <ul className="xs-cust-note-list">
            <li>图片（PNG / JPG / WebP / BMP）：支持游戏运行中热切换，进入或回到主大厅即刻生效。</li>
            <li>视频与动效包（MP4 / WebM / MOV / .usm / 3.3.0 VKVLoop .bundle）：已全面内置星枢核心并支持伴音控制。</li>
          </ul>
        </section>
      </>
    );
  };

  const renderProfileSection = (
    kind: 'cards' | 'audio' | 'characters',
    title: string,
    subtitle: string,
    defaultSubtitle: string,
  ) => {
    const profiles =
      kind === 'cards' ? tuning.cardProfiles : kind === 'audio' ? tuning.audioProfiles : tuning.characterProfiles;
    const activeId =
      kind === 'cards'
        ? tuning.activeCardProfile
        : kind === 'audio'
          ? tuning.activeAudioProfile
          : tuning.activeCharacterProfile;
    const setActive = (id: string | null) =>
      saveTuning(
        {
          ...tuning,
          ...(kind === 'cards'
            ? { activeCardProfile: id }
            : kind === 'audio'
              ? { activeAudioProfile: id }
              : { activeCharacterProfile: id }),
        },
        id ? '已切换启用方案。' : '已切换为游戏默认方案。',
      );
    const deleteProfile = (id: string) =>
      saveTuning(
        {
          ...tuning,
          ...(kind === 'cards'
            ? {
                cardProfiles: tuning.cardProfiles.filter((p) => p.id !== id),
                activeCardProfile: tuning.activeCardProfile === id ? null : tuning.activeCardProfile,
              }
            : kind === 'audio'
              ? {
                  audioProfiles: tuning.audioProfiles.filter((p) => p.id !== id),
                  activeAudioProfile: tuning.activeAudioProfile === id ? null : tuning.activeAudioProfile,
                }
              : {
                  characterProfiles: tuning.characterProfiles.filter((p) => p.id !== id),
                  activeCharacterProfile: tuning.activeCharacterProfile === id ? null : tuning.activeCharacterProfile,
                }),
        },
        '已删除方案。',
      );

    return (
      <>
        <div className="xs-cust-head">
          <div>
            <h1>自定义 · {title}</h1>
            <p className="xs-cust-head-sub">{subtitle}</p>
          </div>
          <div className="xs-cust-actions">
            <input
              type="text"
              className="xs-cust-search-input"
              style={{ width: 170, minWidth: 140 }}
              placeholder="输入新方案名称…"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
            />
            <button
              type="button"
              className="xs-cust-btn is-primary"
              disabled={!newProfileName.trim() || busy}
              onClick={() => void handleCreateProfile(kind)}
            >
              <Plus size={14} />
              <span>新建方案</span>
            </button>
          </div>
        </div>

        {renderGameBar()}

        <section className="pcl-card">
          <div className="xs-cust-profile-grid">
            <button
              type="button"
              className={`xs-cust-profile-card${!activeId ? ' is-active' : ''}`}
              onClick={() => void setActive(null)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 14 }}>游戏默认</strong>
                {!activeId && <Check size={14} color="var(--pcl-3)" />}
              </div>
              <span style={{ fontSize: 12, color: 'var(--pcl-muted)' }}>{defaultSubtitle}</span>
            </button>
            {profiles.map((prof) => {
              const active = activeId === prof.id;
              return (
                <div
                  key={prof.id}
                  className={`xs-cust-profile-card${active ? ' is-active' : ''}`}
                  onClick={() => void setActive(prof.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <strong style={{ fontSize: 14 }}>{prof.name}</strong>
                    <button
                      type="button"
                      className="xs-cust-btn"
                      style={{ height: 24, padding: '0 6px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteProfile(prof.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--pcl-muted)' }}>
                    关联已安装 Mod 包后可一键切换组合
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="pcl-card">
          <div className="pcl-card-head">
            <div>
              <strong>已导入本地资源与替换包（{droppedMods.length} 项）</strong>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--pcl-muted)' }}>
                可直接在此一键启用、关闭或管理「模组工坊」与「本地导入」的卡面 / 语音 / 皮肤替换包。
              </p>
            </div>
            <div className="xs-cust-actions">
              <button type="button" className="xs-cust-btn" onClick={() => void handleImportResourcePack()} disabled={!installationId || busy}>
                <Upload size={13} />
                <span>导入替换包…</span>
              </button>
              <Link className="xs-cust-btn" to="/extensions/launcher">
                <span>前往模组页</span>
              </Link>
            </div>
          </div>
          {droppedMods.length > 0 && (
            <div className="xs-cust-media-list">
              {droppedMods.map((mod) => {
                const isEnabled = mod.phase !== 'disabled';
                return (
                  <div key={mod.modId} className="xs-cust-media-row">
                    <span className="xs-cust-badge">{isEnabled ? '已启用' : '已关闭'}</span>
                    <span className="xs-cust-media-name">{mod.name}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--pcl-muted)' }}>{mod.fileCount} 个目标资产</span>
                    <button
                      type="button"
                      className={`xs-cust-btn${isEnabled ? '' : ' is-primary'}`}
                      onClick={() => void handleTogglePack(mod, !isEnabled)}
                      disabled={busy}
                    >
                      {isEnabled ? '关闭' : '启用'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </>
    );
  };

  const renderPacksSection = () => (
    <>
      <div className="xs-cust-head">
        <div>
          <h1>自定义 · 资源包</h1>
          <p className="xs-cust-head-sub">直接管理本地 ZIP / RML / .xspkg 资源包，支持无损备份与一键还原。</p>
        </div>
        <div className="xs-cust-actions">
          <button type="button" className="xs-cust-btn" onClick={() => void reloadDroppedMods()}>
            <RefreshCw size={14} />
            <span>刷新</span>
          </button>
          <button type="button" className="xs-cust-btn is-primary" disabled={busy || !installationId} onClick={() => void handleImportResourcePack()}>
            <Upload size={14} />
            <span>导入资源包</span>
          </button>
        </div>
      </div>

      {renderGameBar()}

      {lobbyState?.gameRunning && (
        <div className="launcher-banner is-warning">
          检测到游戏正在运行：请先关闭游戏再应用或还原资源包，避免 Unity 资源包文件被占用。
        </div>
      )}

      <section className="pcl-card">
        {droppedMods.length === 0 ? (
          <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--pcl-muted)', fontSize: 13 }}>
            还没有导入的本地资源包，点击右上角「导入资源包」或将 ZIP / .xspkg 直接拖入星枢窗口即可安装。
          </div>
        ) : (
          <div className="xs-cust-media-list">
            {droppedMods.map((mod) => {
              const isEnabled = mod.phase !== 'disabled';
              return (
                <div key={mod.modId} className="xs-cust-media-row">
                  <span className="xs-cust-badge">{mod.sourceKind.toUpperCase()}</span>
                  <span className="xs-cust-media-name">{mod.name}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--pcl-muted)' }}>{mod.fileCount} 个资产</span>
                  <button
                    type="button"
                    className={`xs-cust-btn${isEnabled ? '' : ' is-primary'}`}
                    onClick={() => void handleTogglePack(mod, !isEnabled)}
                    disabled={busy}
                  >
                    {isEnabled ? '关闭' : '开启'}
                  </button>
                  <button
                    type="button"
                    className="xs-cust-btn"
                    onClick={() => void handleRemovePack(mod)}
                    disabled={busy}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );

  const renderFontsSection = () => (
    <>
      <div className="xs-cust-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1>自定义 · 字体</h1>
            <span className="xs-cust-badge is-debug">调试框架</span>
          </div>
          <p className="xs-cust-head-sub">
            枚举本机已安装字体并配置游戏字体调试方案（运行时字体热替换 Hook 待后续版本启用，当前保存为调试参数）。
          </p>
        </div>
        <button
          type="button"
          className="xs-cust-btn"
          onClick={() =>
            void saveTuning({ ...tuning, selectedFontFamily: null, selectedFontFile: null }, '已恢复游戏默认字体调试配置。')
          }
        >
          <RotateCcw size={13} />
          <span>恢复游戏默认</span>
        </button>
      </div>

      {renderGameBar()}

      <section className="pcl-card">
        <div className="xs-cust-search-bar">
          <input
            type="text"
            className="xs-cust-search-input"
            placeholder="搜索字体（中文名 / 英文名 / 文件名）…"
            value={fontSearch}
            onChange={(e) => setFontSearch(e.target.value)}
          />
          <button
            type="button"
            className={`xs-cust-btn${tuning.fontCjkOnly ? ' is-primary' : ''}`}
            onClick={() => void saveTuning({ ...tuning, fontCjkOnly: !tuning.fontCjkOnly })}
          >
            只看支持中文
          </button>
          <button
            type="button"
            className={`xs-cust-btn${tuning.fontReplaceHeadings ? ' is-primary' : ''}`}
            onClick={() => void saveTuning({ ...tuning, fontReplaceHeadings: !tuning.fontReplaceHeadings })}
          >
            同时替换标题 / 数字
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--pcl-muted)' }}>
          当前调试选择：<strong style={{ color: 'var(--pcl-ink)' }}>{tuning.selectedFontFamily || '游戏默认字体'}</strong> · 共 {fonts.length} 个系统字体，展示 {filteredFonts.length} 个
        </div>

        <div className="xs-cust-font-grid">
          {filteredFonts.map((f) => {
            const active = tuning.selectedFontFamily === f.family && tuning.selectedFontFile === f.filePath;
            return (
              <button
                key={`${f.family}:${f.filePath}`}
                type="button"
                className={`xs-cust-font-card${active ? ' is-active' : ''}`}
                onClick={() =>
                  void saveTuning(
                    { ...tuning, selectedFontFamily: f.family, selectedFontFile: f.filePath },
                    `已选中字体调试目标：${f.family}`,
                  )
                }
              >
                <div className="xs-cust-font-specimen" style={{ fontFamily: `"${f.family}", sans-serif` }}>
                  <strong>星引擎Party</strong>
                  <span>星币 × 3 · Lv.12</span>
                </div>
                <div className="xs-cust-font-meta">
                  <strong>{f.displayName}</strong>
                  <small>
                    {f.family} · {f.styleLabel}
                  </small>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );

  const renderHomeUiDebugSection = () => {
    const dbg = tuning.homeUiDebug;
    const updateDbg = (patch: Partial<HomeUiDebugConfig>, msg?: string) =>
      void saveTuning({ ...tuning, homeUiDebug: { ...dbg, ...patch } }, msg);

    return (
      <>
        <div className="xs-cust-head">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1>自定义 · 主界面元素调试</h1>
              <span className="xs-cust-badge is-debug">调试框架</span>
            </div>
            <p className="xs-cust-head-sub">
              统一收纳未来对游戏主界面元素的显示微调、按钮隐藏与 HUD 透明度调试参数，已落盘至游戏目录调试配置。
            </p>
          </div>
          <button
            type="button"
            className="xs-cust-btn"
            onClick={() =>
              void updateDbg(
                {
                  hideVanillaBgAnim: false,
                  compactLobbyBadges: false,
                  showDebugOutline: false,
                  customHudOpacity: 100,
                  hideLobbyAds: false,
                },
                '已恢复主界面默认调试参数。',
              )
            }
          >
            <RotateCcw size={13} />
            <span>恢复默认调试</span>
          </button>
        </div>

        {renderGameBar()}

        <section className="pcl-card">
          <div className="xs-cust-control-row">
            <span>隐藏主题背景额外动态角标 / 广告横幅（调试）</span>
            <button
              type="button"
              className={`xs-cust-btn${dbg.hideLobbyAds ? ' is-primary' : ''}`}
              onClick={() => updateDbg({ hideLobbyAds: !dbg.hideLobbyAds }, '已更新调试开关。')}
            >
              {dbg.hideLobbyAds ? '已开启' : '未开启'}
            </button>
          </div>
          <div className="xs-cust-control-row">
            <span>精简主界面右下角入口角标</span>
            <button
              type="button"
              className={`xs-cust-btn${dbg.compactLobbyBadges ? ' is-primary' : ''}`}
              onClick={() => updateDbg({ compactLobbyBadges: !dbg.compactLobbyBadges }, '已更新调试开关。')}
            >
              {dbg.compactLobbyBadges ? '已开启' : '未开启'}
            </button>
          </div>
          <div className="xs-cust-control-row">
            <span>显示功能中心与主界面元素调试边界</span>
            <button
              type="button"
              className={`xs-cust-btn${dbg.showDebugOutline ? ' is-primary' : ''}`}
              onClick={() => updateDbg({ showDebugOutline: !dbg.showDebugOutline }, '已更新调试开关。')}
            >
              {dbg.showDebugOutline ? '已开启' : '未开启'}
            </button>
          </div>
          <div className="xs-cust-control-row">
            <span>游戏内星枢自定义悬浮组件不透明度</span>
            <div className="xs-cust-slider-wrap">
              <input
                type="range"
                min={30}
                max={100}
                value={dbg.customHudOpacity}
                onChange={(e) => updateDbg({ customHudOpacity: Number(e.target.value) })}
              />
              <span className="xs-cust-slider-val">{dbg.customHudOpacity}%</span>
            </div>
          </div>
        </section>
      </>
    );
  };

  const renderLauncherBgSection = () => (
    <>
      <div className="xs-cust-head">
        <div>
          <h1>星枢自定义 · 外观背景</h1>
          <p className="xs-cust-head-sub">只改变星枢启动器本身的外观与通透质感，不影响游戏内画面。</p>
        </div>
        <div className="xs-cust-actions">
          <button type="button" className="xs-cust-btn" onClick={() => void handleClearLauncherWallpaper()} disabled={busy}>
            <RotateCcw size={13} />
            <span>无背景 / 恢复默认</span>
          </button>
          <button type="button" className="xs-cust-btn is-primary" onClick={() => void handlePickLauncherWallpaper()} disabled={busy}>
            <ImageIcon size={14} />
            <span>导入图片…</span>
          </button>
        </div>
      </div>

      <section className="pcl-card">
        <div className="xs-cust-preview-box">
          {appearance.imageUrl ? (
            <img
              src={appearance.imageUrl}
              alt={appearance.fileName || 'Launcher Background'}
              style={{ filter: appearance.blur > 0 ? `blur(${Math.round(appearance.blur * 0.24)}px)` : undefined }}
            />
          ) : (
            <div className="xs-cust-preview-placeholder">
              <Paintbrush size={28} />
              <strong>默认外观（无自定义图片背景）</strong>
              <span>支持 PNG / JPG / WebP / BMP；导入后全启动器自动呈现毛玻璃通透质感</span>
            </div>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="xs-cust-control-row">
            <span>
              <Sliders size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              背景模糊度
            </span>
            <div className="xs-cust-slider-wrap">
              <input
                type="range"
                min={0}
                max={100}
                value={appearance.blur}
                onChange={(e) => appearance.setBlur(Number(e.target.value))}
              />
              <span className="xs-cust-slider-val">{appearance.blur}</span>
            </div>
          </div>
          <div className="xs-cust-control-row">
            <span>界面卡片不透明度</span>
            <div className="xs-cust-slider-wrap">
              <input
                type="range"
                min={40}
                max={100}
                value={appearance.opacity}
                onChange={(e) => appearance.setOpacity(Number(e.target.value))}
              />
              <span className="xs-cust-slider-val">{appearance.opacity}%</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );

  return (
    <div className="xs-cust-page">
      {notice && <div className={`launcher-banner is-${notice.kind}`}>{notice.text}</div>}
      <div className="xs-cust-layout">
        <aside className="pcl-card xs-cust-rail">
          <div className="xs-cust-rail-group">
            <span className="xs-cust-rail-title">{zh ? '游戏自定义' : 'Game Customize'}</span>
            {gameNavItems.map(({ id, Icon, zh: label, badge }) => (
              <button
                key={id}
                type="button"
                className={`xs-cust-rail-item${section === id ? ' is-active' : ''}`}
                onClick={() => {
                  setNotice(null);
                  setSection(id);
                }}
              >
                <Icon size={15} />
                <span>{label}</span>
                {badge && <span className="xs-cust-rail-tag">{badge}</span>}
              </button>
            ))}
          </div>

          <div className="xs-cust-rail-group">
            <span className="xs-cust-rail-title">{zh ? '星枢自定义' : 'XingShu Style'}</span>
            <button
              type="button"
              className={`xs-cust-rail-item${section === 'launcherBg' ? ' is-active' : ''}`}
              onClick={() => {
                setNotice(null);
                setSection('launcherBg');
              }}
            >
              <ImageIcon size={15} />
              <span>背景</span>
            </button>
          </div>
        </aside>

        <div className="xs-cust-main">
          {section === 'lobbyBg' && renderLobbyBgSection()}
          {section === 'cards' &&
            renderProfileSection(
              'cards',
              '卡牌',
              '组合并管理卡牌替换方案与本地替换包（点击方案可切换，默认使用游戏内置卡面）。',
              '使用游戏内置卡面',
            )}
          {section === 'audio' &&
            renderProfileSection(
              'audio',
              '音效',
              '管理语音与背景音替换方案，并可联动本地音效资源包。',
              '使用官方原版音效',
            )}
          {section === 'characters' &&
            renderProfileSection(
              'characters',
              '角色',
              '新建多个角色皮肤搭配方案并一键切换（同一时间仅启用一个方案）。',
              '使用游戏默认角色装扮',
            )}
          {section === 'packs' && renderPacksSection()}
          {section === 'fonts' && renderFontsSection()}
          {section === 'homeUiDebug' && renderHomeUiDebugSection()}
          {section === 'launcherBg' && renderLauncherBgSection()}
        </div>
      </div>
    </div>
  );
}
