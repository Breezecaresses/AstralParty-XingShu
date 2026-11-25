import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../shared/api/tauri';
import type { DiagnosticReport } from '../../shared/types';
import { FolderUp } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { UpdatePromptController } from '../../components/UpdatePromptModal';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isLauncherPreview, isTauriRuntime } from '../../shared/runtime';
import { LauncherNav } from '../../pages/launcher/LauncherNav';
import { LauncherStartupSplash } from '../../pages/launcher/LauncherStartupSplash';
import { PCL_THEMES, REPLAY_STARTUP_EVENT, useLauncherAppearance, useLauncherTheme } from '../../pages/launcher/launcherTheme';
import { ModrinthWorkshopLayout } from '../../pages/workshop-web/ModrinthWorkshopLayout';
import { PlatformGlobalModals } from '../../components/platform/PlatformGlobalModals';
import '../../pages/launcher/launcher-shell.css';
import '../../pages/launcher/launcher.css';
import { enqueueDroppedModPaths } from '../../shared/modDropBridge';
import updateBuild from '../../../src-tauri/src/update_build.json';

const SPLASH_PLAYED_KEY = 'xingshu.launcher.splashPlayed';
type StartupStage = 'splash' | 'entering' | 'ready';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function shouldPlayInitialSplash(enabled: boolean): boolean {
  if (!enabled || prefersReducedMotion()) return false;
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SPLASH_PLAYED_KEY) === '1') {
      return false;
    }
  } catch {
    // Ignore storage access errors.
  }
  return true;
}

function markSplashPlayed(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SPLASH_PLAYED_KEY, '1');
    }
  } catch {
    // Ignore storage access errors.
  }
}

export const DesktopLayout: React.FC = () => {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const { locale } = useTranslation();
  const contentRef = useRef<HTMLElement>(null);
  const [dragOverWindow, setDragOverWindow] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const { theme, startupAnimEnabled } = useLauncherTheme();
  const { imageUrl: customBgUrl, blur: customBgBlur, opacity: customBgOpacity } = useLauncherAppearance();
  const activeThemePreset = PCL_THEMES.find((item) => item.id === theme) ?? PCL_THEMES[0];
  const isFlushLauncherPage = pathname === '/dashboard' || pathname === '/extensions/launcher';

  const [startupStage, setStartupStage] = useState<StartupStage>('splash');
  const [splashMounted, setSplashMounted] = useState<boolean>(false);
  const [splashRunId, setSplashRunId] = useState<number>(1);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupAnimEnabledRef = useRef(startupAnimEnabled);
  startupAnimEnabledRef.current = startupAnimEnabled;

  const runEntranceTransition = useCallback((forceEntrance = false) => {
    markSplashPlayed();
    if ((!forceEntrance && !startupAnimEnabledRef.current) || prefersReducedMotion()) {
      setStartupStage('ready');
      return;
    }
    setStartupStage('entering');
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    enterTimerRef.current = setTimeout(() => {
      enterTimerRef.current = null;
      setStartupStage('ready');
    }, 740);
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      el.scrollTo(0, 0);
    }
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    let failsafeTimer: ReturnType<typeof setTimeout> | undefined;

    if (!startupAnimEnabledRef.current || prefersReducedMotion()) {
      invoke('finish_splash_and_show_main').catch(() => {});
      setSplashMounted(false);
      setStartupStage('ready');
    } else {
      failsafeTimer = setTimeout(() => {
        if (!disposed) {
          setSplashMounted(false);
          setStartupStage('ready');
        }
      }, 6000);

      listen('xingshu:splash-finished', () => {
        if (disposed) return;
        if (failsafeTimer) {
          clearTimeout(failsafeTimer);
          failsafeTimer = undefined;
        }
        setSplashMounted(false);
        runEntranceTransition(true);
      })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => {});

      invoke<boolean>('get_startup_splash_active')
        .then((active) => {
          if (disposed) return;
          if (!active) {
            if (failsafeTimer) {
              clearTimeout(failsafeTimer);
              failsafeTimer = undefined;
            }
            runEntranceTransition(false);
          }
        })
        .catch(() => {
          if (disposed) return;
          if (failsafeTimer) {
            clearTimeout(failsafeTimer);
            failsafeTimer = undefined;
          }
          if (shouldPlayInitialSplash(startupAnimEnabledRef.current)) {
            setStartupStage('splash');
            setSplashMounted(true);
          } else {
            setStartupStage('ready');
          }
        });
    }

    const handleReplay = () => {
      if (enterTimerRef.current) {
        clearTimeout(enterTimerRef.current);
        enterTimerRef.current = null;
      }
      if (prefersReducedMotion()) {
        setSplashMounted(false);
        setStartupStage('ready');
        return;
      }
      setStartupStage('splash');
      setSplashMounted(true);
      setSplashRunId((prev) => prev + 1);
    };

    window.addEventListener(REPLAY_STARTUP_EVENT, handleReplay);
    return () => {
      disposed = true;
      if (failsafeTimer) clearTimeout(failsafeTimer);
      unlisten?.();
      window.removeEventListener(REPLAY_STARTUP_EVENT, handleReplay);
    };
  }, [runEntranceTransition]);

  useEffect(() => {
    return () => {
      if (enterTimerRef.current) {
        clearTimeout(enterTimerRef.current);
        enterTimerRef.current = null;
      }
    };
  }, []);

  const handleSplashReveal = useCallback(() => {
    runEntranceTransition(true);
  }, [runEntranceTransition]);

  const handleSplashComplete = useCallback(() => {
    setSplashMounted(false);
  }, []);

  const handleSplashSkip = useCallback(() => {
    markSplashPlayed();
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    setSplashMounted(false);
    setStartupStage('ready');
  }, []);

  useEffect(() => {
    const refresh = () =>
      api
        .getDiagnosticReport()
        .then(setReport)
        .catch(() => setReport(null));
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, []);

  const appTitle = locale === 'zh-CN' ? '星枢启动器' : 'XingShu Launcher';

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = appTitle;
    }
    try {
      const appWin = getCurrentWebviewWindow();
      appWin.setTitle(appTitle).catch((err) => {
        console.warn('Failed to set window title via Tauri:', err);
      });
    } catch {
      // Ignored outside Tauri webview
    }
  }, [appTitle]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const preventNativeDrop = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener('dragover', preventNativeDrop);
    window.addEventListener('drop', preventNativeDrop);
    try {
      const appWin = getCurrentWebviewWindow();
      appWin
        .onDragDropEvent((event) => {
          if (disposed) return;
          const payload = event.payload;
          if (payload.type === 'enter' || payload.type === 'over') {
            setDragOverWindow(true);
          } else if (payload.type === 'leave') {
            setDragOverWindow(false);
          } else if (payload.type === 'drop') {
            setDragOverWindow(false);
            if (payload.paths?.length) {
              enqueueDroppedModPaths(payload.paths);
              if (pathnameRef.current !== '/extensions/launcher' && pathnameRef.current !== '/extensions/mods') {
                navigate('/extensions/launcher?section=inspect');
              }
            }
          }
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    } catch {
      // Ignored outside Tauri webview
    }
    return () => {
      disposed = true;
      setDragOverWindow(false);
      window.removeEventListener('dragover', preventNativeDrop);
      window.removeEventListener('drop', preventNativeDrop);
      unlisten?.();
    };
  }, [navigate]);

  const statusClass =
    report?.overall_status === 'HEALTHY'
      ? 'healthy'
      : report?.overall_status === 'WARNING'
      ? 'warning'
      : 'degraded';

  const launcherBgStyle = customBgUrl
    ? ({
        '--xs-bg-blur': `${Math.round(customBgBlur * 0.28)}px`,
        '--xs-bg-surface-alpha': (customBgOpacity / 100).toFixed(2),
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={`desktop-app-frame launcher-frame launcher-stage-${startupStage}${isFlushLauncherPage ? ' launcher-is-home' : ''}${customBgUrl ? ' has-custom-bg' : ''}`}
      data-pcl-theme={theme}
      data-pcl-scheme={activeThemePreset.id === 'obsidian' ? 'dark' : 'light'}
      style={launcherBgStyle}
    >
      {customBgUrl && (
        <div
          className="launcher-bg-layer"
          aria-hidden="true"
          style={{
            backgroundImage: `url("${customBgUrl}")`,
            filter: customBgBlur > 0 ? `blur(${Math.round(customBgBlur * 0.24)}px)` : undefined,
          }}
        />
      )}
      <div className="launcher-window-stage">
        <LauncherNav />
        <div className="app-container">
          <div className="main-wrapper">
            {!isLauncherPreview && <UpdatePromptController />}

            <main className="content-area" ref={contentRef}>
              <div className="aurora-route-stage" key={pathname}>
                <Outlet />
              </div>
            </main>
          </div>
        </div>
        <footer className="desktop-status-bar">
          <span>
            <i className={`desktop-status-dot ${statusClass}`} />
            {report?.snapshot.primary_game
              ? locale === 'zh-CN'
                ? '游戏目录已连接'
                : 'Game directory connected'
              : locale === 'zh-CN'
              ? '等待选择游戏目录'
              : 'Select a game directory'}
          </span>
          <span className="desktop-status-meta">
            <span className="desktop-status-theme">
              <i style={{ background: activeThemePreset.swatchPrimary }} aria-hidden="true" />
              {locale === 'zh-CN' ? activeThemePreset.nameZh : activeThemePreset.nameEn}
            </span>
            <span className="desktop-status-sep" aria-hidden="true">
              ·
            </span>
            <span className="desktop-status-version">
              {isLauncherPreview ? (locale === 'zh-CN' ? '本地预览' : 'Local preview') : `v${updateBuild.version}`}
            </span>
          </span>
        </footer>
        {dragOverWindow && (
          <div className="global-mod-drop-overlay" aria-live="polite">
            <div className="global-mod-drop-card">
              <FolderUp size={34} />
              <strong>
                {locale === 'zh-CN' ? '松开鼠标以检测并安装模组' : 'Drop mod package or folder to inspect'}
              </strong>
              <span>
                {locale === 'zh-CN'
                  ? '支持 .zip、.rar、.xspkg、.apmm、.bundle 或解压后的模组文件夹'
                  : 'Supports .zip, .rar, .xspkg, .apmm, .bundle, or extracted mod folders'}
              </span>
            </div>
          </div>
        )}
      </div>
      {splashMounted && (
        <LauncherStartupSplash
          key={splashRunId}
          active={splashMounted}
          mode="overlay"
          onReveal={handleSplashReveal}
          onComplete={handleSplashComplete}
          onSkip={handleSplashSkip}
        />
      )}
      <PlatformGlobalModals />
    </div>
  );
};

export const Layout: React.FC = () => {
  if (!isTauriRuntime()) {
    return <ModrinthWorkshopLayout />;
  }
  return <DesktopLayout />;
};
