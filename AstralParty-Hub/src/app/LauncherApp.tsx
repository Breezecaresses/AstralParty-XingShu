import { lazy, Suspense, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createBrowserRouter, Link, Navigate, RouterProvider, useNavigate } from 'react-router-dom';
import { I18nProvider, useTranslation } from '../i18n';
import { isTauriRuntime } from '../shared/runtime';
import { CloudLoginCard } from '../pages/account/CloudLoginCard';
import { openPlatformAuthModal, usePlatformAccount } from '../shared/platformAccountClient';
import { PlatformAccountPage } from '../pages/account/PlatformAccountPage';
import { LauncherHome } from '../pages/launcher/LauncherHome';
import { LauncherMods, LauncherTools } from '../pages/launcher/LauncherCatalog';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { RuntimeDiagnosticsPanel } from '../pages/runtime/RuntimePage';
import { TransactionsPage } from '../pages/maintenance/TransactionsPage';
import { BackupsPage } from '../pages/maintenance/BackupsPage';
import { DesktopLayout } from './layout/Layout';
import '../App.css';
import '../styles/aurora.css';
import '../styles/desktop-shell.css';

function LauncherAccount() {
  const { locale } = useTranslation();
  const isZh = locale === 'zh-CN';
  const platformAccount = usePlatformAccount();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <CloudLoginCard isZh={isZh} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
        <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                {isZh ? '星枢平台账号（工坊与社区）' : 'XingShu Platform Account'}
              </h3>
              <span style={{ fontSize: 12, padding: '2px 9px', borderRadius: 999, background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>
                {platformAccount.user
                  ? `${platformAccount.user.displayName} (@${platformAccount.user.username})`
                  : isZh ? '未登录' : 'Signed out'}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: 'var(--text-secondary)' }}>
              {platformAccount.user
                ? isZh
                  ? `平台 UID ${platformAccount.user.uid} · 已关联 ${platformAccount.gameBindings.length} 个游戏账号，可在网页工坊与桌面端同步项目、收藏和表情回应。`
                  : `Platform UID ${platformAccount.user.uid} · ${platformAccount.gameBindings.length} linked game accounts.`
                : isZh
                  ? '登录独立的星枢平台账号后，可将本机各渠道游戏 UID 绑定到平台主页，并同步模组工坊项目与收藏。'
                  : 'Sign in with a XingShu Platform Account to sync game bindings and mod projects across Web & Desktop.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!platformAccount.user && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => openPlatformAuthModal('login')}>
                  {isZh ? '登录星枢平台' : 'Sign in'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => openPlatformAuthModal('register')}>
                  {isZh ? '注册平台账号' : 'Register'}
                </button>
              </>
            )}
            <Link className="btn btn-secondary" to="/platform-account">
              {platformAccount.user ? (isZh ? '管理平台主页与绑定' : 'Manage platform account') : (isZh ? '打开平台账号页' : 'Open platform page')}
            </Link>
          </div>
        </section>

        <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>
              {isZh ? '多渠道支持与常用入口' : 'Supported Channels & Quick Links'}
            </h3>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: 'var(--text-secondary)' }}>
              {isZh
                ? '支持官服手机号、Steam、B 站、TapTap、WeGame 及手机渠道（小米 / 4399）；本机启动过的电脑端游戏可直接通过上方日志票据一键登录或授权 QQ Bot「趴登录」。'
                : 'Supports Official Phone, Steam, Bilibili, TapTap, WeGame, Xiaomi, and M4399. Desktop channels with local logs support one-click login and QQ Bot pairing.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn btn-secondary" to="/player/profile">{isZh ? '玩家资料' : 'Profile'}</Link>
            <Link className="btn btn-secondary" to="/player/matches">{isZh ? '历史战绩' : 'Matches'}</Link>
            <Link className="btn btn-secondary" to="/player/replay">{isZh ? '回放分析' : 'Replay'}</Link>
            <Link className="btn btn-secondary" to="/extensions/launcher">{isZh ? '模组与工坊' : 'Mods & Workshop'}</Link>
          </div>
        </section>
      </div>
    </div>
  );
}

const isModulePanel = new URLSearchParams(window.location.search).get('window') === 'module-ball';
const ModulePanel = lazy(async () => ({ default: (await import('../pages/launcher/ModulePanelWindow')).ModulePanelWindow }));

if (isModulePanel) document.documentElement.classList.add('xingshu-module-ball');

function LauncherLayout() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let stop: (() => void) | undefined;
    void listen<string>('xingshu:manage-module', ({ payload }) => {
      if (active && typeof payload === 'string' && /^[a-z0-9-]{2,64}$/.test(payload)) {
        navigate(`/extensions/launcher?section=discover&module=${encodeURIComponent(payload)}`);
      }
    }).then((unlisten) => {
      if (active) stop = unlisten;
      else unlisten();
    }).catch(() => {});
    return () => { active = false; stop?.(); };
  }, [navigate]);
  return <DesktopLayout />;
}

const router = isModulePanel ? null : createBrowserRouter([{
  path: '/',
  element: <LauncherLayout />,
  children: [
    { index: true, element: <Navigate to="/dashboard" replace /> },
    { path: 'dashboard', element: <LauncherHome /> },
    { path: 'customize', lazy: async () => ({ Component: (await import('../pages/customize/CustomizePage')).CustomizePage }) },
    { path: 'extensions/launcher', element: <LauncherMods /> },
    { path: 'extensions/mods', element: <Navigate to="/extensions/launcher?section=inspect" replace /> },
    { path: 'player/accounts', element: <LauncherAccount /> },
    { path: 'account', element: <LauncherAccount /> },
    { path: 'platform-account', element: <PlatformAccountPage /> },
    {
      path: 'author/:authorKey',
      lazy: async () => {
        const { ModrinthAuthorPage } = await import('../pages/workshop-web/ModrinthAuthorPage');
        return {
          Component: () => (
            <div className="mr-web-root" style={{ minHeight: 'auto', borderRadius: 14 }}>
              <ModrinthAuthorPage />
            </div>
          ),
        };
      },
    },
    {
      path: 'mod/:modId',
      lazy: async () => {
        const { ModrinthProjectDetailPage } = await import('../pages/workshop-web/ModrinthProjectDetailPage');
        return {
          Component: () => (
            <div className="mr-web-root" style={{ minHeight: 'auto', borderRadius: 14 }}>
              <ModrinthProjectDetailPage />
            </div>
          ),
        };
      },
    },
    { path: 'tools', element: <LauncherTools /> },
    { path: 'tools/plugin-guide', lazy: async () => ({ Component: (await import('../pages/tools/PluginSdkGuidePage')).PluginSdkGuidePage }) },
    { path: 'player/replay', lazy: async () => ({ Component: (await import('../pages/player/ReplayAnalyzerPage')).ReplayAnalyzerPage }) },
    { path: 'player/profile', lazy: async () => ({ Component: (await import('../pages/player/ProfilePage')).ProfilePage }) },
    { path: 'player/matches', lazy: async () => ({ Component: (await import('../pages/player/MatchesPage')).MatchesPage }) },
    { path: 'player/characters', lazy: async () => ({ Component: (await import('../pages/player/CharactersPage')).CharactersPage }) },
    { path: 'player/cards', lazy: async () => ({ Component: (await import('../pages/player/CardsPage')).CardsPage }) },
    { path: 'player/chips', lazy: async () => ({ Component: (await import('../pages/player/EncyclopediaPage')).ChipsPage }) },
    { path: 'player/maps', lazy: async () => ({ Component: (await import('../pages/player/EncyclopediaPage')).MapsPage }) },
    { path: 'spectator', lazy: async () => ({ Component: (await import('../pages/spectator/SpectatorPage')).SpectatorPage }) },
    { path: 'bridge', lazy: async () => ({ Component: (await import('../pages/bridge/BridgePage')).BridgePage }) },
    { path: 'room', lazy: async () => ({ Component: (await import('../pages/room/RoomLobbyPage')).RoomLobbyPage }) },
    { path: 'diagnostics', element: <RuntimeDiagnosticsPanel /> },
    { path: 'extensions/packages', lazy: async () => ({ Component: (await import('../pages/packages/PackagesPage')).PackagesPage }) },
    { path: 'maintenance/transactions', element: <TransactionsPage /> },
    { path: 'maintenance/backups', element: <BackupsPage /> },
    { path: 'settings', element: <SettingsPage /> },
    { path: '*', element: <Navigate to="/dashboard" replace /> },
  ],
}]);

export default function LauncherApp() {
  return (
    <I18nProvider>
      {router ? <RouterProvider router={router} /> : <Suspense fallback={null}><ModulePanel /></Suspense>}
    </I18nProvider>
  );
}
