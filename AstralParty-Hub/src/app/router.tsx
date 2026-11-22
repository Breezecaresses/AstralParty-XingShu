import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Layout } from './layout/Layout';
import { ProfilePage } from '../pages/player/ProfilePage';
import { GameAccountCenter } from '../pages/account/GameAccountCenter';
import { CharactersPage } from '../pages/player/CharactersPage';
import { CardsPage } from '../pages/player/CardsPage';
import { ChipsPage, MapsPage } from '../pages/player/EncyclopediaPage';
import { MatchesPage } from '../pages/player/MatchesPage';
import { ReplayAnalyzerPage } from '../pages/player/ReplayAnalyzerPage';
import { isTauriRuntime, routerBasename } from '../shared/runtime';
import { ModsPage } from '../pages/extensions/ModsPage';
import { WorkshopCreatorPage } from '../pages/extensions/WorkshopCreatorPage';
import { PackagesPage } from '../pages/packages/PackagesPage';
import { SpectatorPage } from '../pages/spectator/SpectatorPage';
import { BridgePage } from '../pages/bridge/BridgePage';
import { RoomLobbyPage } from '../pages/room/RoomLobbyPage';
import { TransactionsPage } from '../pages/maintenance/TransactionsPage';
import { BackupsPage } from '../pages/maintenance/BackupsPage';
import { DiagnosticsPage } from '../pages/diagnostics/DiagnosticsPage';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { LauncherHome } from '../pages/launcher/LauncherHome';
import { LauncherTools, LauncherMods } from '../pages/launcher/LauncherCatalog';
import { ModrinthHomePage } from '../pages/workshop-web/ModrinthHomePage';
import { ModrinthBrowsePage } from '../pages/workshop-web/ModrinthBrowsePage';
import { ModrinthAuthorPage } from '../pages/workshop-web/ModrinthAuthorPage';
import { ModrinthAdminPage } from '../pages/workshop-web/ModrinthAdminPage';
import { ModrinthProjectDetailPage } from '../pages/workshop-web/ModrinthProjectDetailPage';
import { PlatformAccountPage } from '../pages/account/PlatformAccountPage';

const desktopOnly = (element: ReactNode) =>
  isTauriRuntime() ? element : <Navigate to="/extensions/mods" replace />;

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: (
          <Navigate
            to={
              isTauriRuntime() &&
              typeof window !== 'undefined' &&
              (window.location.search.includes('spectator') || window.location.hash.includes('spectator'))
                ? '/spectator'
                : isTauriRuntime() &&
                  typeof window !== 'undefined' &&
                  (window.location.search.includes('diagnostics') || window.location.hash.includes('diagnostics'))
                ? '/diagnostics'
                : '/dashboard'
            }
            replace
          />
        ),
      },
      {
        path: 'dashboard',
        element: isTauriRuntime() ? <LauncherHome /> : <ModrinthHomePage />,
      },
      { path: 'tools', element: desktopOnly(<LauncherTools />) },
      { path: 'extensions/launcher', element: desktopOnly(<LauncherMods />) },
      // Player & Game Data Centers (Desktop)
      {
        path: 'player/profile',
        element: desktopOnly(<ProfilePage />),
      },
      {
        path: 'player/accounts',
        element: desktopOnly(<GameAccountCenter />),
      },
      {
        path: 'account',
        element: isTauriRuntime() ? <GameAccountCenter /> : <PlatformAccountPage />,
      },
      {
        path: 'platform-account',
        element: <PlatformAccountPage />,
      },
      {
        path: 'mod/:modId',
        element: isTauriRuntime() ? (
          <div className="mr-web-root" style={{ minHeight: 'auto', borderRadius: 14 }}>
            <ModrinthProjectDetailPage />
          </div>
        ) : (
          <ModrinthProjectDetailPage />
        ),
      },
      {
        path: 'author/:authorKey',
        element: isTauriRuntime() ? (
          <div className="mr-web-root" style={{ minHeight: 'auto', borderRadius: 14 }}>
            <ModrinthAuthorPage />
          </div>
        ) : (
          <ModrinthAuthorPage />
        ),
      },
      {
        path: 'admin',
        element: isTauriRuntime() ? (
          <div className="mr-web-root" style={{ minHeight: 'auto', borderRadius: 14 }}>
            <ModrinthAdminPage />
          </div>
        ) : (
          <ModrinthAdminPage />
        ),
      },
      {
        path: 'account/center',
        element: desktopOnly(<GameAccountCenter />),
      },
      {
        path: 'player/characters',
        element: desktopOnly(<CharactersPage />),
      },
      {
        path: 'player/cards',
        element: desktopOnly(<CardsPage />),
      },
      {
        path: 'player/chips',
        element: desktopOnly(<ChipsPage />),
      },
      {
        path: 'player/maps',
        element: desktopOnly(<MapsPage />),
      },
      {
        path: 'player/matches',
        element: desktopOnly(<MatchesPage />),
      },
      {
        path: 'player/replay',
        element: desktopOnly(<ReplayAnalyzerPage />),
      },
      // XingShu Core Integration (Desktop)
      {
        path: 'room',
        element: desktopOnly(<RoomLobbyPage />),
      },
      {
        path: 'runtime',
        element: desktopOnly(<Navigate to="/diagnostics?section=runtime" replace />),
      },
      {
        path: 'spectator',
        element: desktopOnly(<SpectatorPage />),
      },
      {
        path: 'bridge',
        element: desktopOnly(<BridgePage />),
      },
      // Extensions & Packages
      {
        path: 'extensions/plugins',
        element: desktopOnly(<Navigate to="/diagnostics?section=runtime" replace />),
      },
      {
        path: 'extensions/mods',
        element: isTauriRuntime() ? <ModsPage /> : <ModrinthBrowsePage />,
      },
      {
        path: 'extensions/creator',
        element: isTauriRuntime() ? (
          <WorkshopCreatorPage />
        ) : (
          <div className="mr-container">
            <WorkshopCreatorPage />
          </div>
        ),
      },
      {
        path: 'extensions/packages',
        element: desktopOnly(<PackagesPage />),
      },
      {
        path: 'extensions/import',
        element: desktopOnly(<Navigate to="/extensions/mods" replace />),
      },
      // Maintenance & System (Desktop)
      {
        path: 'maintenance/transactions',
        element: desktopOnly(<TransactionsPage />),
      },
      {
        path: 'maintenance/backups',
        element: desktopOnly(<BackupsPage />),
      },
      {
        path: 'diagnostics',
        element: desktopOnly(<DiagnosticsPage />),
      },
      {
        path: 'settings',
        element: isTauriRuntime() ? <SettingsPage /> : <Navigate to="/account?tab=settings" replace />,
      },
      {
        path: '*',
        element: <Navigate to={isTauriRuntime() ? '/dashboard' : '/extensions/mods'} replace />,
      },
    ],
  },
], { basename: routerBasename() });
