import { lazy, Suspense, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createBrowserRouter, Navigate, RouterProvider, useNavigate } from 'react-router-dom';
import { I18nProvider, useTranslation } from '../i18n';
import officialModules from '../shared/launcherModules.json';
import { isTauriRuntime } from '../shared/runtime';
import { CloudLoginCard } from '../pages/account/CloudLoginCard';
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
  return <CloudLoginCard isZh={useTranslation().locale === 'zh-CN'} />;
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
      if (active && officialModules.some(({ id }) => id === payload)) {
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
