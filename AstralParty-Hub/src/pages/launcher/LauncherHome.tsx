import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Check,
  ChevronDown,
  CircleAlert,
  EyeOff,
  FolderOpen,
  Gamepad2,
  Orbit,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PlatformUserAvatar } from '../../components/platform/PlatformUserAvatar';
import { useTranslation } from '../../i18n';
import { openPlatformAuthModal, usePlatformAccount } from '../../shared/platformAccountClient';
import { assetUrl, isTauriRuntime } from '../../shared/runtime';
import type { GameLaunchResult } from '../../shared/types';
import { extensionChannels, useExtensionTarget } from '../extensions/ExtensionWorkspace';
import {
  LAUNCH_TIPS_EN,
  LAUNCH_TIPS_ZH,
  type LaunchPhase,
  type LauncherDiskState,
  type LauncherSession,
  errorMessage,
  launchPhaseProgress,
  launcherAction,
  shortFolderName,
} from './launcherModel';
import './launcher.css';

type Account = { uid: string; nick?: string };
type NodeState = 'ok' | 'info' | 'warn' | 'idle';

const channelShortNames: Record<string, string> = {
  STEAM_CN: 'Steam CN',
  STEAM_GLOBAL: 'Steam Global',
  TAPTAP: 'TapTap',
  BILIBILI: 'Bilibili',
  WEGAME: 'WeGame',
};

export function LauncherHome() {
  const zh = useTranslation().locale === 'zh-CN';
  const navigate = useNavigate();
  const target = useExtensionTarget();
  const installationId = target.selected?.id ?? '';
  const platform = usePlatformAccount();
  const [diskRead, setDiskRead] = useState<{ id: string; value: LauncherDiskState }>();
  const [sessionRead, setSessionRead] = useState<{ id: string; value: LauncherSession }>();
  const disk = diskRead?.id === installationId ? diskRead.value : undefined;
  const session = sessionRead?.id === installationId ? sessionRead.value : undefined;
  const [account, setAccount] = useState<Account | null>();
  const [accountError, setAccountError] = useState(false);
  const [phase, setPhase] = useState<LaunchPhase>('idle');
  const [componentProgress, setComponentProgress] = useState<{
    channel: string;
    stage: string;
    downloadedBytes: number;
    totalBytes: number;
    percent: number;
    detail: string;
  } | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const [hideProgress, setHideProgress] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [problem, setProblem] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshes, setRefreshes] = useState(0);
  const launching = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    invoke<{ account?: Account }>('get_cloud_account')
      .then((result) => {
        if (active) {
          setAccount(result.account ?? null);
          setAccountError(false);
        }
      })
      .catch(() => {
        if (active) {
          setAccount(null);
          setAccountError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [refreshes]);

  useEffect(() => {
    setProblem('');
    setConflict(false);
    setPhase('idle');
    if (!installationId) return;
    let active = true;
    invoke<LauncherDiskState>('launcher_check', { installationId })
      .then((value) => {
        if (active) setDiskRead({ id: installationId, value });
      })
      .catch((error) => {
        if (active) {
          setDiskRead(undefined);
          setProblem(errorMessage(error));
        }
      });
    return () => {
      active = false;
    };
  }, [installationId, refreshes]);

  useEffect(() => {
    if (!installationId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const result = await invoke<LauncherSession>('launcher_session', { installationId }).catch(() => undefined);
      if (!active) return;
      setSessionRead(result ? { id: installationId, value: result } : undefined);
      if (result?.runtimeVersion) setPhase((previous) => (previous === 'waiting' ? 'connected' : previous));
      timer = setTimeout(poll, 2400);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [installationId, refreshes]);

  useEffect(() => {
    if (!busy) {
      setHideProgress(false);
      setComponentProgress(null);
    }
  }, [busy]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<{
      channel: string;
      stage: string;
      downloadedBytes: number;
      totalBytes: number;
      percent: number;
      detail: string;
    }>('xingshu:component-install-progress', ({ payload }) => {
      if (!active || !payload) return;
      setComponentProgress(payload);
    }).then((fn) => {
      if (!active) fn();
      else unlisten = fn;
    });
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  const tips = zh ? LAUNCH_TIPS_ZH : LAUNCH_TIPS_EN;
  const showLaunchingPanel = busy && !hideProgress;

  useEffect(() => {
    if (!showLaunchingPanel) return;
    const timer = setInterval(() => {
      setTipIndex((index) => (index + 1) % tips.length);
    }, 6500);
    return () => clearInterval(timer);
  }, [showLaunchingPanel, tips.length]);

  const launch = async (behavior: 'install' | 'start' | 'both') => {
    if (!installationId || launching.current) return;
    launching.current = true;
    setHideProgress(false);
    setTipIndex((index) => (index + 1) % tips.length);
    setBusy(true);
    setConflict(false);
    setProblem('');
    setPhase('checking');
    try {
      const current = await invoke<LauncherDiskState>('launcher_check', { installationId });
      if (!mounted.current) return;
      setDiskRead({ id: installationId, value: current });
      if (behavior !== 'start' && current.state !== 'installed') {
        setPhase('installing');
        const installed = await invoke<LauncherDiskState>('launcher_install', { installationId });
        if (!mounted.current) return;
        setDiskRead({ id: installationId, value: installed });
      }
      if (behavior === 'install') {
        setPhase('idle');
        return;
      }
      setPhase('starting');
      const start = await invoke<GameLaunchResult>('launcher_start', { installationId });
      if (!mounted.current) return;
      if (!start.success && !start.alreadyRunning) throw new Error(start.message);
      setPhase('connecting');
      for (let attempt = 0; attempt < 14 && mounted.current; attempt++) {
        const value = await invoke<LauncherSession>('launcher_session', { installationId }).catch(() => undefined);
        if (!mounted.current) return;
        if (value) setSessionRead({ id: installationId, value });
        if (value?.runtimeVersion) {
          setPhase('connected');
          return;
        }
        // An official-only launch is complete when its process is confirmed.
        if (value?.running && behavior === 'start' && current.state !== 'installed') break;
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      if (mounted.current) setPhase('waiting');
    } catch (error) {
      if (!mounted.current) return;
      setProblem(errorMessage(error));
      setConflict(Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT_CONFIRM_REQUIRED'));
      setPhase('idle');
    } finally {
      launching.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const refresh = async () => {
    await target.refresh();
    if (mounted.current) setRefreshes((count) => count + 1);
  };

  const channelName = zh ? extensionChannels.find(([id]) => id === target.channel)?.[1] : channelShortNames[target.channel];
  const channelShort = zh
    ? (extensionChannels.find(([id]) => id === target.channel)?.[1] ?? 'Astral Party')
        .replace(' Windows', '')
        .replace('哔哩哔哩', 'B 站')
    : channelShortNames[target.channel] ?? 'Astral Party';

  const action = launcherAction(disk, session);
  const componentUpdate = disk?.state === 'updateAvailable';
  const actionLabel = {
    checking: zh ? '正在检查游戏' : 'Checking game',
    running: zh ? '游戏运行中' : 'Game running',
    start: zh ? '启动游戏' : 'Launch game',
    startOfficial: zh ? '启动游戏' : 'Launch game',
  }[action];

  const installingBytesText =
    phase === 'installing' && componentProgress && componentProgress.totalBytes > 0
      ? ` (${(componentProgress.downloadedBytes / 1048576).toFixed(1)} MB / ${(componentProgress.totalBytes / 1048576).toFixed(1)} MB)`
      : '';

  const progress = {
    idle: '',
    checking: zh ? '正在核对安装位置' : 'Checking installation',
    installing:
      phase === 'installing' && componentProgress?.detail
        ? `${componentProgress.detail}${installingBytesText}`
        : zh
          ? '正在备份并安装官方插件 Mod'
          : 'Backing up and installing',
    starting: zh ? '正在启动官方游戏' : 'Starting game',
    connecting: zh ? '等待游戏连接星枢' : 'Waiting for XingShu',
    connected: zh ? '星枢官方插件已连接' : 'XingShu Plugin connected',
    waiting: zh ? '游戏已启动，进入大厅后将自动更新状态' : 'Game launched; status updates in the lobby',
  }[phase];

  const stepShortLabel = {
    idle: zh ? '准备就绪' : 'Ready',
    checking: zh ? '核对目录' : 'Checking folder',
    installing: zh ? '安装插件' : 'Installing',
    starting: zh ? '拉起进程' : 'Launching',
    connecting: zh ? '建立网桥' : 'Connecting',
    connected: zh ? '已连接' : 'Connected',
    waiting: zh ? '等待大厅' : 'In lobby',
  }[phase];

  const diskLabel = disk
    ? ({
        installed: zh ? '已安装' : 'Installed',
        installable: zh ? '未安装 · 纯净启动' : 'Optional · Clean launch',
        updateAvailable: zh
          ? `已安装旧版 ${disk.version?.replace(/^1\\.0\\.0-game-ui-/, '') || '旧版'}`
          : `Installed ${disk.version?.replace(/^1\\.0\\.0-game-ui-/, '') || 'older'} (Update available)`,
        incompatible: zh ? '资源版本需核对' : 'Version mismatch',
        resourceMissing: zh ? '需先进入游戏一次' : 'Open the game first',
        packageMissing: zh ? '缺少安装包' : 'Package missing',
        unsupported: zh ? '此渠道暂无插件' : 'Unsupported edition',
      })[disk.state]
    : installationId
      ? problem
        ? zh
          ? '检查未完成'
          : 'Check failed'
        : zh
          ? '检查中'
          : 'Checking'
      : zh
        ? '待选择游戏'
        : 'Choose an installation';

  const uidMismatch = Boolean(account && session?.playerId && String(account.uid) !== session.playerId);
  const connectionLabel = session?.runtimeVersion
    ? zh
      ? '插件已连接'
      : 'Plugin connected'
    : session?.running
      ? zh
        ? '游戏运行中'
        : 'Game running'
      : session
        ? zh
          ? '游戏未运行'
          : 'Game stopped'
        : zh
          ? '待检测'
          : 'Pending detection';

  const accountLabel = accountError
    ? zh
      ? '暂无法校验'
      : 'Check unavailable'
    : account === undefined
      ? zh
        ? '查询中'
        : 'Checking'
      : account
        ? zh
          ? '已连接'
          : 'Connected'
        : zh
          ? '未连接'
          : 'Not connected';

  const folderShort = shortFolderName(target.selected?.install_path);
  const launchSubtitle = `${channelShort} · ${
    disk?.gameVersion || folderShort || (zh ? '请先指定目录' : 'Select a folder')
  }`;
  const phasePercent =
    phase === 'installing' && componentProgress
      ? Math.max(launchPhaseProgress('checking'), componentProgress.percent)
      : launchPhaseProgress(phase);
  const installedComponentVersion = disk?.version?.replace(/^1\.0\.0-game-ui-/, '');
  const availableComponentVersion = disk?.availableVersion?.replace(/^1\.0\.0-game-ui-/, '');
  const componentDetail = componentUpdate && installedComponentVersion && availableComponentVersion
    ? (zh ? `已装 ${installedComponentVersion}（非纯净，可去模组页升级 ${availableComponentVersion} 或还原）` : `${installedComponentVersion} → ${availableComponentVersion}`)
    : installedComponentVersion
      ? (zh ? `已安装 ${installedComponentVersion}` : `Installed ${installedComponentVersion}`)
      : availableComponentVersion && disk?.state === 'installable'
        ? (zh ? `可去模组页选装 ${availableComponentVersion}` : `Optional in Mods (${availableComponentVersion})`)
        : (zh ? '纯净原版直启' : 'Pure vanilla launch');
  const activeError = problem || target.error;

  const pipelineNodes: Array<{
    key: string;
    label: string;
    value: string;
    detail: string;
    state: NodeState;
  }> = [
    {
      key: 'account',
      label: zh ? '星枢账号' : 'XingShu Account',
      value: accountLabel,
      detail: account
        ? account.nick
          ? `${account.nick} · UID ${account.uid}`
          : `UID ${account.uid}`
        : zh
          ? '可选：登录后同步云端数据'
          : 'Optional cloud data sync',
      state: account ? 'ok' : accountError ? 'warn' : 'idle',
    },
    {
      key: 'directory',
      label: zh ? '游戏目录' : 'Game Folder',
      value: installationId ? folderShort || (zh ? '已选定' : 'Selected') : zh ? '待配置' : 'Not set',
      detail: target.selected?.install_path || (zh ? '请在左侧选择或手动指定目录' : 'Select or set a folder on the left'),
      state: installationId ? 'ok' : 'warn',
    },
    {
      key: 'component',
      label: zh ? '星枢官方插件 Mod' : 'XingShu Plugin Mod',
      value: diskLabel,
      detail: componentDetail,
      state: disk?.state === 'installed' ? 'ok' : disk?.state === 'installable' || componentUpdate ? 'info' : disk ? 'warn' : 'idle',
    },
    {
      key: 'bridge',
      label: zh ? '局内连接' : 'In-Game Bridge',
      value: connectionLabel,
      detail: session?.runtimeVersion
        ? zh
          ? `运行时 ${session.runtimeVersion}`
          : `Runtime ${session.runtimeVersion}`
        : session?.playerId
          ? `UID ${session.playerId}`
          : zh
            ? '进入大厅后自动建立网桥'
            : 'Connects after entering lobby',
      state: session?.runtimeVersion ? 'ok' : session?.running ? 'info' : 'idle',
    },
  ];

  const quickItems = [
    {
      to: '/extensions/launcher',
      Icon: Blocks,
      title: zh ? '模组管理' : 'Mod Manager',
      desc: zh ? '启停局内工具与功能扩展' : 'Manage in-game tools & mods',
    },
    {
      to: '/diagnostics',
      Icon: ShieldCheck,
      title: zh ? '运行诊断' : 'Runtime diagnostics',
      desc: zh ? '检查游戏安装、官方插件和连接' : 'Check game, plugin and connection',
    },
    {
      to: '/maintenance/transactions',
      Icon: Check,
      title: zh ? '安装记录' : 'Install history',
      desc: zh ? '查看模组安装与恢复' : 'Review installs and rollback',
    },
  ];

  return (
    <div className="launcher-home pcl-launch-page">
      <aside className="pcl-launch-left" aria-label={zh ? '启动控制台' : 'Launch dock'}>
        <div className="pcl-dock-inner">
          {/* Idle Input View */}
          <div className={`pcl-pan-input ${showLaunchingPanel ? 'is-hidden' : 'is-active'}`} aria-hidden={showLaunchingPanel}>
            <div className="pcl-dock-top">
              <div className="pcl-dock-section-head">
                <span>
                  <Gamepad2 size={14} />
                  {zh ? 'PC 登录渠道' : 'PC Edition'}
                </span>
                {busy && hideProgress && (
                  <button
                    type="button"
                    className="pcl-progress-pill"
                    onClick={() => setHideProgress(false)}
                    tabIndex={showLaunchingPanel ? -1 : undefined}
                  >
                    <Orbit size={12} className="pcl-spin" />
                    <span>{zh ? `进行中 ${phasePercent}% · 查看` : `${phasePercent}% · View`}</span>
                  </button>
                )}
              </div>
              <fieldset className="pcl-channel-grid" disabled={busy || showLaunchingPanel} aria-label={zh ? 'PC 登录渠道' : 'PC edition'}>
                {extensionChannels.map(([id, name]) => (
                  <label key={id} className={`pcl-channel-capsule ${target.channel === id ? 'picked' : ''}`}>
                    <input
                      type="radio"
                      name="launch-edition"
                      checked={target.channel === id}
                      tabIndex={showLaunchingPanel ? -1 : undefined}
                      onChange={() => {
                        target.setChannel(id);
                        setBrowseOpen(false);
                      }}
                    />
                    <span>{zh ? name.replace(' Windows', '').replace('哔哩哔哩', 'B 站') : channelShortNames[id]}</span>
                  </label>
                ))}
              </fieldset>
            </div>

            <div className="pcl-dock-center">
              <div className="pcl-emblem-stage">
                <div className="pcl-emblem-ring" aria-hidden="true" />
                <img src={assetUrl('brand/xingshu.svg')} alt="" className="pcl-emblem-img" />
              </div>
              <div className="pcl-title-lockup">
                <span className={`pcl-edition-chip ${session?.runtimeVersion ? 'is-live' : ''}`}>
                  <i aria-hidden="true" />
                  {channelName ?? 'Astral Party'}
                </span>
                <h1>{zh ? '吉星派对' : 'Astral Party'}</h1>
                <p className="pcl-version-meta">
                  {disk?.gameVersion
                    ? `${disk.gameVersion}${disk.resourceVersion ? ` · ${zh ? '资源' : 'Res'} ${disk.resourceVersion}` : ''}`
                    : zh
                      ? 'Windows 客户端'
                      : 'Windows Client'}
                </p>
              </div>

              <div className="pcl-account-pill">
                <div className="pcl-account-avatar" aria-hidden="true">
                  <UserRound size={16} />
                </div>
                <div className="pcl-account-copy">
                  <strong>{account ? account.nick || `UID ${account.uid}` : zh ? '星枢账号' : 'XingShu Account'}</strong>
                  <small>{account ? `UID ${account.uid} · ${accountLabel}` : accountLabel}</small>
                </div>
                <Link
                  to={`/player/accounts?platform=${target.channel}`}
                  className="pcl-account-action"
                  tabIndex={showLaunchingPanel ? -1 : undefined}
                >
                  {account ? (zh ? '管理' : 'Manage') : zh ? '登录' : 'Sign in'}
                  <ArrowRight size={13} />
                </Link>
              </div>

              <div className="pcl-plat-dock-line">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {platform.user ? (
                    <>
                      <PlatformUserAvatar
                        name={platform.user.displayName || platform.user.username}
                        avatarUrl={platform.user.avatarUrl}
                        avatarColor={platform.user.avatarColor}
                        size={18}
                        fontSize={10}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {zh
                          ? `${platform.user.displayName} · UID #${platform.user.uid} (${platform.gameBindings.length})`
                          : `${platform.user.displayName} · UID #${platform.user.uid} (${platform.gameBindings.length})`}
                      </span>
                    </>
                  ) : (
                    <span>{zh ? '星枢平台账号 · 未登录' : 'XingShu Platform · Signed out'}</span>
                  )}
                </span>
                {platform.user ? (
                  <Link to="/platform-account?tab=game-bindings" tabIndex={showLaunchingPanel ? -1 : undefined}>
                    {zh ? '绑定游戏 →' : 'Bindings →'}
                  </Link>
                ) : (
                  <button
                    type="button"
                    tabIndex={showLaunchingPanel ? -1 : undefined}
                    onClick={() => openPlatformAuthModal('login')}
                  >
                    {zh ? '登录 / 注册' : 'Sign in'}
                  </button>
                )}
              </div>
            </div>

            <div className="pcl-dock-footer">
              {browseOpen && (
                <div className="pcl-folder-drawer">
                  <label className="pcl-field-label" htmlFor="launch-installation">
                    {zh ? '游戏安装位置' : 'Game installation'}
                  </label>
                  <select
                    id="launch-installation"
                    value={installationId}
                    disabled={busy || !target.options.length || showLaunchingPanel}
                    tabIndex={showLaunchingPanel ? -1 : undefined}
                    onChange={(event) => target.select(event.target.value)}
                  >
                    {!target.options.length && (
                      <option value="">{target.busy ? (zh ? '检测中…' : 'Detecting…') : zh ? '尚未找到此渠道' : 'Edition not found'}</option>
                    )}
                    {target.options.map((game) => (
                      <option value={game.id} key={game.id}>
                        {game.install_path}
                      </option>
                    ))}
                  </select>
                  <form
                    className="pcl-path-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void target.save();
                    }}
                  >
                    <input
                      value={target.path}
                      onChange={(event) => target.setPath(event.target.value)}
                      tabIndex={showLaunchingPanel ? -1 : undefined}
                      aria-label={zh ? '游戏目录或程序完整路径' : 'Full path to game directory or executable'}
                      placeholder={zh ? '粘贴游戏目录或程序路径' : 'Paste the game path'}
                    />
                    <button
                      type="submit"
                      className="pcl-btn-mini"
                      disabled={target.busy || busy || !target.path.trim() || showLaunchingPanel}
                      tabIndex={showLaunchingPanel ? -1 : undefined}
                    >
                      {zh ? '保存' : 'Save'}
                    </button>
                  </form>
                  {target.error && (
                    <p className="pcl-inline-error" role="alert">
                      {target.error}
                    </p>
                  )}
                </div>
              )}

              <button
                type="button"
                className={`pcl-btn-launch ${action === 'running' ? 'is-running' : ''}`}
                onClick={() => void launch('start')}
                disabled={!installationId || busy || action === 'checking' || action === 'running' || showLaunchingPanel}
                tabIndex={showLaunchingPanel ? -1 : undefined}
              >
                <span className="pcl-btn-launch-main">
                  {busy ? <Orbit className="pcl-spin" size={18} /> : <Play size={18} fill="currentColor" />}
                  <span>{busy ? progress : actionLabel}</span>
                </span>
                <span className="pcl-btn-launch-sub">{launchSubtitle}</span>
              </button>

              <div className="pcl-btn-row">
                <button
                  type="button"
                  className={`pcl-btn-secondary ${browseOpen ? 'is-open' : ''}`}
                  onClick={() => setBrowseOpen((open) => !open)}
                  disabled={busy || showLaunchingPanel}
                  aria-expanded={browseOpen}
                  tabIndex={showLaunchingPanel ? -1 : undefined}
                >
                  <FolderOpen size={14} />
                  <span>{zh ? '目录选择' : 'Folder'}</span>
                </button>
                <Link
                  className="pcl-btn-secondary"
                  to="/extensions/launcher"
                  tabIndex={showLaunchingPanel ? -1 : undefined}
                >
                  <Blocks size={14} />
                  <span>{zh ? '星枢模组' : 'XingShu Mods'}</span>
                </Link>
              </div>

              {!busy && progress && (
                <p className="pcl-dock-status" aria-live="polite">
                  <Check size={13} />
                  <span>{progress}</span>
                </p>
              )}
            </div>
          </div>

          {/* Launching Progress View (PCL2 PageLaunchLeft.xaml homage) */}
          <div className={`pcl-pan-launching ${showLaunchingPanel ? 'is-active' : 'is-hidden'}`} aria-hidden={!showLaunchingPanel}>
            <div className="pcl-launching-top">
              <div className="pcl-launch-spinner" aria-hidden="true">
                <svg viewBox="0 0 88 88" width="84" height="84">
                  <circle cx="44" cy="44" r="36" className="pcl-spinner-track" />
                  <circle cx="44" cy="44" r="36" className="pcl-spinner-arc" />
                  <g className="pcl-spinner-orbit">
                    <ellipse cx="44" cy="44" rx="30" ry="13" transform="rotate(-26 44 44)" className="pcl-spinner-ellipse" />
                    <circle cx="71" cy="31" r="3.8" className="pcl-spinner-orb" />
                  </g>
                  <path
                    d="M44 26 L48.5 39.5 L62 44 L48.5 48.5 L44 62 L39.5 48.5 L26 44 L39.5 39.5 Z"
                    className="pcl-spinner-star"
                  />
                </svg>
              </div>

              <div className="pcl-launching-heading">
                <h2>{phase === 'installing' ? (zh ? '正在安装组件' : 'Installing Component') : zh ? '正在启动吉星派对' : 'Launching Astral Party'}</h2>
                <p aria-live="polite">{progress || (zh ? '准备执行启动序列' : 'Preparing launch sequence')}</p>
              </div>

              <div className="pcl-launch-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={phasePercent}>
                <div className="pcl-launch-bar-fill" style={{ width: `${phasePercent}%` }} />
              </div>

              <dl className="pcl-launch-telemetry">
                <div>
                  <dt>{zh ? '当前步骤' : 'Current step'}</dt>
                  <dd>{stepShortLabel}</dd>
                </div>
                <div>
                  <dt>{zh ? '登录渠道' : 'Edition'}</dt>
                  <dd>{channelShort}</dd>
                </div>
                <div>
                  <dt>{zh ? '启动进度' : 'Progress'}</dt>
                  <dd>{phasePercent}%</dd>
                </div>
                <div>
                  <dt>{zh ? '组件状态' : 'Component'}</dt>
                  <dd>{diskLabel}</dd>
                </div>
              </dl>
            </div>

            <div className="pcl-launching-bottom">
              <div
                className="pcl-tip-box"
                onClick={() => setTipIndex((index) => (index + 1) % tips.length)}
                title={zh ? '点击切换下一条提示' : 'Click for next tip'}
              >
                <span className="pcl-tip-legend">{zh ? '你知道吗' : 'Did you know'}</span>
                <p>{tips[tipIndex]}</p>
              </div>

              <button
                type="button"
                className="pcl-btn-hide-progress"
                onClick={() => setHideProgress(true)}
                tabIndex={showLaunchingPanel ? undefined : -1}
              >
                <EyeOff size={14} />
                <span>{zh ? '隐藏进度' : 'Hide progress'}</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="pcl-launch-right">
        <div className="pcl-card-stack">
          {/* Card 1: Overview & 4-node Connection Pipeline */}
          <section className="pcl-card" style={{ '--card-index': 0 } as React.CSSProperties} aria-label={zh ? '运行总览与连接链路' : 'Overview and pipeline'}>
            <header className="pcl-card-head">
              <div className="pcl-card-title-group">
                <span className="pcl-card-icon">
                  <Orbit size={16} />
                </span>
                <div>
                  <h2>{zh ? '运行总览与连接链路' : 'Overview & Launch Pipeline'}</h2>
                  <p>
                    {disk?.gameVersion
                      ? `${zh ? '游戏版本' : 'Game'} ${disk.gameVersion}${disk.resourceVersion ? ` · ${zh ? '资源版本' : 'Resources'} ${disk.resourceVersion}` : ''}`
                      : zh
                        ? '自动检测游戏目录、启动组件与局内网桥状态'
                        : 'Live inspection for game directory, component, and in-game bridge'}
                  </p>
                </div>
              </div>
              <div className="pcl-card-actions">
                <span className={`pcl-live-badge ${session?.runtimeVersion ? 'is-connected' : session?.running ? 'is-waiting' : ''}`}>
                  <i aria-hidden="true" />
                  {channelShort}
                </span>
                <button type="button" className="pcl-btn-mini" onClick={refresh} disabled={busy || target.busy}>
                  <RefreshCw size={13} className={target.busy ? 'pcl-spin' : ''} />
                  <span>{zh ? '重新检测' : 'Rescan'}</span>
                </button>
              </div>
            </header>

            <div className="pcl-pipeline">
              {pipelineNodes.map((node, index) => (
                <div key={node.key} className={`pcl-pipeline-node is-${node.state}`}>
                  <div className="pcl-pipeline-step">
                    <span className="pcl-pipeline-dot">{node.state === 'ok' ? <Check size={11} /> : index + 1}</span>
                    {index < pipelineNodes.length - 1 && <span className="pcl-pipeline-line" aria-hidden="true" />}
                  </div>
                  <div className="pcl-pipeline-body">
                    <span className="pcl-pipeline-label">{node.label}</span>
                    <strong className="pcl-pipeline-value">{node.value}</strong>
                    <small className="pcl-pipeline-detail" title={node.detail}>
                      {node.detail}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Card 2: Collapsible Environment & Guidance Card */}
          <section className="pcl-card" style={{ '--card-index': 1 } as React.CSSProperties}>
            <button
              type="button"
              className="pcl-card-collapse-trigger"
              onClick={() => setGuideOpen((open) => !open)}
              aria-expanded={guideOpen}
            >
              <div className="pcl-card-title-group">
                <span className="pcl-card-icon">
                  <ShieldCheck size={16} />
                </span>
                <div>
                  <h2>{zh ? '环境状态与启动引导' : 'Environment & Guidance'}</h2>
                  <p>{`${accountLabel} · ${diskLabel} · ${connectionLabel}`}</p>
                </div>
              </div>
              <ChevronDown size={17} className={`pcl-chevron ${guideOpen ? 'is-open' : ''}`} />
            </button>

            {guideOpen && (
              <div className="pcl-card-body">
                <div className="pcl-summary-tiles" aria-label={zh ? '启动状态' : 'Launch status'}>
                  <div className="pcl-summary-tile">
                    <UserRound size={15} />
                    <span>{zh ? '星枢账号' : 'XingShu account'}</span>
                    <strong>{accountLabel}</strong>
                  </div>
                  <div className="pcl-summary-tile">
                    <ShieldCheck size={15} />
                    <span>{zh ? '星枢官方插件' : 'XingShu Plugin'}</span>
                    <strong>{diskLabel}</strong>
                  </div>
                  <div className="pcl-summary-tile">
                    {session?.runtimeVersion ? <Check size={15} /> : <Orbit size={15} />}
                    <span>{zh ? '局内连接' : 'Game connection'}</span>
                    <strong title={session?.runtimeVersion}>{connectionLabel}</strong>
                  </div>
                </div>

                <div className={`pcl-guidance-banner ${uidMismatch ? 'is-warning' : ''}`}>
                  <CircleAlert size={16} />
                  <span>
                    {uidMismatch
                      ? zh
                        ? '当前游戏 UID 与星枢账号不同。需要云端资料时，请切换到同一游戏账号。'
                        : 'Game and XingShu UIDs differ. Use the same account for cloud data.'
                      : zh
                        ? '本页仅作纯净游戏启动器。如需局内模组或游戏内开房，请前往「模组」页安装「星枢官方插件 Mod」并自选模块。'
                        : 'Launches the pure vanilla game cleanly. Install the optional XingShu Plugin Mod and feature modules on the Mods page.'}
                  </span>
                  <Link to="/extensions/launcher">{zh ? '前往模组页' : 'Open Mods'}</Link>
                </div>

                {target.channel.startsWith('STEAM_') && (
                  <p className="pcl-steam-note">
                    {zh
                      ? 'Steam 若弹出版本选择，请选择上方对应的国服或国际服。'
                      : 'If Steam asks for an edition, choose the one selected above.'}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Card 3: Quick Jump Hub Card */}
          <section className="pcl-card" style={{ '--card-index': 2 } as React.CSSProperties}>
            <header className="pcl-card-head">
              <div className="pcl-card-title-group">
                <span className="pcl-card-icon">
                  <Sparkles size={16} />
                </span>
                <div>
                  <h2>{zh ? '快捷入口' : 'Quick Access'}</h2>
                  <p>{zh ? '常用工作台与数据中心直达' : 'Frequent tools and game codex'}</p>
                </div>
              </div>
              <Link className="pcl-card-more" to="/tools">
                {zh ? '全部工具' : 'All tools'}
                <ArrowUpRight size={14} />
              </Link>
            </header>

            <div className="pcl-quick-grid">
              {quickItems.map(({ to, Icon, title, desc }) => (
                <Link key={to} to={to} className="pcl-quick-tile">
                  <span className="pcl-quick-icon">
                    <Icon size={17} />
                  </span>
                  <div className="pcl-quick-copy">
                    <strong>{title}</strong>
                    <small>{desc}</small>
                  </div>
                  <ArrowUpRight size={14} className="pcl-quick-arrow" />
                </Link>
              ))}
            </div>
          </section>

          {/* Card 4: Conditional Error & Conflict Recovery Card */}
          {activeError && (
            <section className="pcl-card pcl-card-error" style={{ '--card-index': 3 } as React.CSSProperties} role="alert">
              <header className="pcl-card-head">
                <div className="pcl-card-title-group">
                  <span className="pcl-card-icon is-danger">
                    <CircleAlert size={16} />
                  </span>
                  <div>
                    <h2>{zh ? '运行状态提示' : 'Attention Required'}</h2>
                    <p>{zh ? '检测到启动或目录异常，请核对下方详情' : 'An issue occurred while checking or launching'}</p>
                  </div>
                </div>
                <div className="pcl-card-actions">
                  {conflict && installationId && (
                    <button
                      type="button"
                      className="pcl-btn-danger-outline"
                      onClick={() => {
                        navigate('/extensions/launcher');
                      }}
                    >
                      {zh ? '去模组页处理冲突' : 'Resolve in Mods'}
                    </button>
                  )}
                  <button type="button" className="pcl-btn-mini" onClick={refresh} disabled={busy || target.busy}>
                    <RefreshCw size={13} />
                    <span>{zh ? '重试' : 'Retry'}</span>
                  </button>
                </div>
              </header>
              <p className="pcl-error-text">{activeError}</p>
            </section>
          )}
        </div>
      </div>

      {/* Floating Bottom-Right PCL2 MyExtraButton Stack */}
      <div className="pcl-extra-fab" role="group" aria-label={zh ? '快捷悬浮操作' : 'Quick floating actions'}>
        <button
          type="button"
          className="pcl-extra-btn"
          title={zh ? '打开星枢悬浮球' : 'Open XingShu Module Panel'}
          aria-label={zh ? '打开星枢悬浮球' : 'Open XingShu Module Panel'}
          onClick={() => {
            void invoke('open_module_panel', { installationId: installationId || null })
              .catch((error) => setProblem(errorMessage(error)));
          }}
        >
          <Sparkles size={17} />
        </button>
        <button
          type="button"
          className="pcl-extra-btn"
          onClick={refresh}
          disabled={busy || target.busy}
          title={zh ? '重新检测游戏目录与组件状态' : 'Rescan game folder and component'}
          aria-label={zh ? '重新检测' : 'Rescan'}
        >
          <RefreshCw size={17} className={target.busy ? 'pcl-spin' : ''} />
        </button>
        <Link
          className="pcl-extra-btn is-accent"
          to="/extensions/launcher"
          title={zh ? '打开模组' : 'Open Mods'}
          aria-label={zh ? '打开模组' : 'Open Mods'}
        >
          <Blocks size={17} />
        </Link>
      </div>
    </div>
  );
}
