import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ArrowLeft,
  Blocks,
  Check,
  Copy,
  Gamepad2,
  LogOut,
  Minus,
  PackagePlus,
  Palette,
  Play,
  Settings2,
  Square,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { PlatformUserAvatar } from '../../components/platform/PlatformUserAvatar';
import { useTranslation } from '../../i18n';
import {
  logoutPlatformAccount,
  openCreateProjectModal,
  openPlatformAuthModal,
  usePlatformAccount,
} from '../../shared/platformAccountClient';
import { assetUrl, isTauriRuntime } from '../../shared/runtime';
import { PCL_THEMES, useLauncherTheme } from './launcherTheme';

type TabKey = 'launch' | 'room' | 'mods' | 'tools' | 'settings';

interface SubPageMeta {
  tab: TabKey;
  backTo: string;
  backZh: string;
  backEn: string;
  titleZh: string;
  titleEn: string;
}

function resolveRouteMeta(pathname: string, search: string): { tab: TabKey; subPage: SubPageMeta | null } {
  if (pathname === '/dashboard') {
    return { tab: 'launch', subPage: null };
  }
  if (pathname === '/room' || pathname.startsWith('/room/')) {
    return { tab: 'room', subPage: null };
  }
  if (pathname === '/extensions/launcher') {
    return { tab: 'mods', subPage: null };
  }
  if (pathname === '/tools') {
    return { tab: 'tools', subPage: null };
  }
  if (pathname === '/settings') {
    return { tab: 'settings', subPage: null };
  }

  if (pathname.startsWith('/extensions/mods')) {
    return {
      tab: 'mods',
      subPage: {
        tab: 'mods',
        backTo: '/extensions/launcher',
        backZh: '返回模组',
        backEn: 'Back to Mods',
        titleZh: '模组工坊',
        titleEn: 'Mod Workshop',
      },
    };
  }
  if (pathname.startsWith('/extensions/creator')) {
    return {
      tab: 'mods',
      subPage: {
        tab: 'mods',
        backTo: '/extensions/launcher',
        backZh: '返回模组',
        backEn: 'Back to Mods',
        titleZh: '创作者入口',
        titleEn: 'Creator Portal',
      },
    };
  }
  if (pathname.startsWith('/extensions/packages')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '手机连接与安装',
        titleEn: 'Android Install',
      },
    };
  }
  if (pathname.startsWith('/player/accounts') || pathname.startsWith('/account')) {
    return {
      tab: 'launch',
      subPage: {
        tab: 'launch',
        backTo: '/dashboard',
        backZh: '返回启动器',
        backEn: 'Back to Launch',
        titleZh: '游戏账号',
        titleEn: 'Game Accounts',
      },
    };
  }
  if (pathname.startsWith('/player/replay')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '回放分析',
        titleEn: 'Replay Analysis',
      },
    };
  }
  if (pathname.startsWith('/player/profile')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '玩家资料',
        titleEn: 'Player Profile',
      },
    };
  }
  if (pathname.startsWith('/player/matches')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '对战记录',
        titleEn: 'Match History',
      },
    };
  }
  if (pathname.startsWith('/player/characters')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '角色中心',
        titleEn: 'Characters',
      },
    };
  }
  if (pathname.startsWith('/player/cards')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '卡牌图鉴',
        titleEn: 'Cards',
      },
    };
  }
  if (pathname.startsWith('/player/chips')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '筹码图鉴',
        titleEn: 'Chips',
      },
    };
  }
  if (pathname.startsWith('/player/maps')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '地图与场地',
        titleEn: 'Maps & Arenas',
      },
    };
  }
  if (pathname.startsWith('/spectator')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '星枢观战',
        titleEn: 'Spectator',
      },
    };
  }
  if (pathname.startsWith('/bridge')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '星枢网桥',
        titleEn: 'Bridge',
      },
    };
  }
  if (pathname.startsWith('/diagnostics')) {
    const fromLaunch = search.includes('section=runtime');
    return {
      tab: fromLaunch ? 'launch' : 'tools',
      subPage: {
        tab: fromLaunch ? 'launch' : 'tools',
        backTo: fromLaunch ? '/dashboard' : '/tools',
        backZh: fromLaunch ? '返回启动器' : '返回工具库',
        backEn: fromLaunch ? 'Back to Launch' : 'Back to Tools',
        titleZh: '系统诊断',
        titleEn: 'Diagnostics',
      },
    };
  }
  const isTransactions = pathname.startsWith('/maintenance/transactions');
  if (isTransactions || pathname.startsWith('/maintenance/backups')) {
    const fromTools = new URLSearchParams(search).get('from') === 'tools';
    const tab = fromTools ? 'tools' : 'settings';
    return {
      tab,
      subPage: {
        tab,
        backTo: fromTools ? '/tools' : '/settings',
        backZh: fromTools ? '返回工具库' : '返回设置',
        backEn: fromTools ? 'Back to Tools' : 'Back to Settings',
        titleZh: isTransactions ? '安装事务记录' : '备份与还原',
        titleEn: isTransactions ? 'Transactions' : 'Backups',
      },
    };
  }
  if (pathname.startsWith('/platform-account')) {
    return {
      tab: 'launch',
      subPage: {
        tab: 'launch',
        backTo: '/dashboard',
        backZh: '返回启动器',
        backEn: 'Back to Launch',
        titleZh: '星枢平台账号',
        titleEn: 'Platform Account',
      },
    };
  }
  if (pathname.startsWith('/mod/')) {
    return {
      tab: 'mods',
      subPage: {
        tab: 'mods',
        backTo: '/extensions/launcher',
        backZh: '返回模组',
        backEn: 'Back to Mods',
        titleZh: '模组详情',
        titleEn: 'Mod Detail',
      },
    };
  }
  return {
    tab: 'tools',
    subPage: {
      tab: 'tools',
      backTo: '/tools',
      backZh: '返回工具库',
      backEn: 'Back to Tools',
      titleZh: '功能详情',
      titleEn: 'Details',
    },
  };
}

export function LauncherNav() {
  const { locale, setLocale } = useTranslation();
  const zh = locale === 'zh-CN';
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useLauncherTheme();
  const activePreset = PCL_THEMES.find((item) => item.id === theme) ?? PCL_THEMES[0];
  const { user: platUser, gameBindings } = usePlatformAccount();

  const { tab, subPage } = resolveRouteMeta(pathname, search);

  const [maximized, setMaximized] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [platMenuOpen, setPlatMenuOpen] = useState(false);
  const themePickerRef = useRef<HTMLDivElement>(null);
  const platPickerRef = useRef<HTMLDivElement>(null);

  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<TabKey, HTMLAnchorElement | null>>({
    launch: null,
    room: null,
    mods: null,
    tools: null,
    settings: null,
  });
  const hasMeasuredRef = useRef(false);
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number; ready: boolean; animated: boolean }>({
    left: 0,
    width: 0,
    ready: false,
    animated: false,
  });

  const measureActivePill = useCallback(() => {
    const activeEl = tabRefs.current[tab];
    if (!activeEl) return;
    const nextLeft = activeEl.offsetLeft;
    const nextWidth = activeEl.offsetWidth;
    if (nextWidth <= 0) return;

    const alreadyMeasured = hasMeasuredRef.current;
    hasMeasuredRef.current = true;
    setPillStyle({
      left: nextLeft,
      width: nextWidth,
      ready: true,
      animated: alreadyMeasured,
    });
  }, [tab]);

  useLayoutEffect(() => {
    measureActivePill();
  }, [measureActivePill, locale]);

  useEffect(() => {
    const navEl = navRef.current;
    if (!navEl) return;

    let rafId = 0;
    const scheduleMeasure = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        measureActivePill();
      });
    };

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null;
    observer?.observe(navEl);
    window.addEventListener('resize', scheduleMeasure);
    document.fonts?.ready?.then(scheduleMeasure).catch(() => {});

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [measureActivePill]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: undefined | (() => void);

    try {
      const appWindow = getCurrentWindow();
      const sync = () => {
        try {
          const check = appWindow?.isMaximized?.();
          if (check && typeof check.then === 'function') {
            check
              .then((value) => {
                if (!disposed) setMaximized(Boolean(value));
              })
              .catch(() => {});
          }
        } catch {
          // Ignore in mocked preview environments without full window IPC.
        }
      };

      sync();
      const register = appWindow?.onResized?.(sync);
      if (register && typeof register.then === 'function') {
        register
          .then((fn) => {
            if (disposed) fn?.();
            else unlisten = fn;
          })
          .catch(() => {});
      }
    } catch {
      // Ignore in mocked preview environments without full window IPC.
    }

    return () => {
      disposed = true;
      try {
        unlisten?.();
      } catch {
        // Ignore cleanup errors.
      }
    };
  }, []);

  useEffect(() => {
    if (!themeMenuOpen && !platMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (themePickerRef.current && !themePickerRef.current.contains(event.target as Node)) {
        setThemeMenuOpen(false);
      }
      if (platPickerRef.current && !platPickerRef.current.contains(event.target as Node)) {
        setPlatMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setThemeMenuOpen(false);
        setPlatMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [platMenuOpen, themeMenuOpen]);

  const runWindowAction = (action: 'minimize' | 'toggleMaximize' | 'close') => {
    if (!isTauriRuntime()) return;
    try {
      const appWindow = getCurrentWindow();
      const fn = appWindow?.[action];
      if (typeof fn === 'function') {
        Promise.resolve(fn.call(appWindow))
          .then(() => {
            if (action === 'toggleMaximize') {
              return Promise.resolve(appWindow?.isMaximized?.()).then((val) => {
                if (typeof val === 'boolean') setMaximized(val);
              });
            }
          })
          .catch(() => {});
      }
    } catch {
      // Ignore in mocked preview browser without full Tauri IPC.
    }
  };

  const handleHeaderMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest('button, a, input, select, textarea, [role="button"], [role="dialog"], [data-no-drag]')) {
      return;
    }
    event.preventDefault();
    if (!isTauriRuntime()) return;
    try {
      const appWindow = getCurrentWindow();
      if (event.detail === 2) {
        if (typeof appWindow?.toggleMaximize === 'function') {
          Promise.resolve(appWindow.toggleMaximize()).catch(() => {});
        }
      } else if (typeof appWindow?.startDragging === 'function') {
        Promise.resolve(appWindow.startDragging()).catch(() => {});
      }
    } catch {
      // Ignore in mocked preview browser without full Tauri IPC.
    }
  };

  const items: Array<{ key: TabKey; to: string; icon: typeof Play; label: string }> = [
    { key: 'launch', to: '/dashboard', icon: Play, label: zh ? '启动' : 'Launch' },
    { key: 'room', to: '/room', icon: Gamepad2, label: zh ? '开房' : 'Room' },
    { key: 'mods', to: '/extensions/launcher', icon: Blocks, label: zh ? '模组' : 'Mods' },
    { key: 'tools', to: '/tools', icon: Wrench, label: zh ? '工具' : 'Tools' },
    { key: 'settings', to: '/settings', icon: Settings2, label: zh ? '设置' : 'Settings' },
  ];

  return (
    <header
      className="launcher-nav"
      data-tauri-drag-region
      onMouseDown={handleHeaderMouseDown}
    >
      <div className="pcl-title-left" data-tauri-drag-region>
        {subPage ? (
          <div className="pcl-title-inner" key={`${subPage.backTo}:${subPage.titleEn}`} data-tauri-drag-region>
            <Link to={subPage.backTo} className="pcl-back-btn">
              <ArrowLeft size={14} />
              <span>{zh ? subPage.backZh : subPage.backEn}</span>
            </Link>
            <span className="pcl-title-sep" aria-hidden="true" data-tauri-drag-region />
            <span className="pcl-subpage-title" data-tauri-drag-region>
              {zh ? subPage.titleZh : subPage.titleEn}
            </span>
          </div>
        ) : (
          <NavLink to="/dashboard" className="launcher-wordmark">
            <img src={assetUrl('brand/xingshu-mark.svg')} alt="" />
            <span>{zh ? '星枢' : 'XingShu'}</span>
          </NavLink>
        )}
      </div>

      <div className="pcl-title-center" data-tauri-drag-region>
        <nav
          ref={navRef}
          className="pcl-capsule-nav"
          aria-label={zh ? '启动器导航' : 'Launcher navigation'}
        >
          <span
            className={`pcl-capsule-indicator${pillStyle.animated ? ' is-animated' : ''}`}
            style={{
              width: `${pillStyle.width}px`,
              transform: `translateX(${pillStyle.left}px)`,
              opacity: pillStyle.ready ? 1 : 0,
            }}
            aria-hidden="true"
          />
          {items.map(({ key, to, icon: Icon, label }) => (
            <NavLink
              key={key}
              to={to}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              className={key === tab ? 'selected' : ''}
            >
              <Icon size={15} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="pcl-title-right" data-tauri-drag-region>
        <div className="pcl-title-actions" data-no-drag>
          <div className="pcl-plat-wrap" ref={platPickerRef}>
            {!platUser ? (
              <button
                type="button"
                className="pcl-plat-pill is-guest"
                title={zh ? '登录星枢平台账号（全端同步收藏、发布 Mod 与绑定游戏账号）' : 'Sign in to XingShu Platform Account'}
                onClick={() => openPlatformAuthModal('login')}
              >
                <UserRound size={13} />
                <span>{zh ? '登录星枢' : 'Sign in'}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`pcl-plat-pill${platMenuOpen ? ' is-open' : ''}`}
                  onClick={() => {
                    setPlatMenuOpen((v) => !v);
                    setThemeMenuOpen(false);
                  }}
                >
                  <PlatformUserAvatar
                    name={platUser.displayName || platUser.username}
                    avatarUrl={platUser.avatarUrl}
                    avatarColor={platUser.avatarColor}
                    size={20}
                    fontSize={11}
                    className="pcl-plat-avatar"
                  />
                  <span className="pcl-plat-name">{platUser.displayName}</span>
                </button>
                {platMenuOpen && (
                  <div className="pcl-plat-popover" role="menu">
                    <div className="pcl-plat-pop-head">
                      <strong>{platUser.displayName}</strong>
                      <small>
                        @{platUser.username}
                        {platUser.uid ? ` · UID #${platUser.uid}` : ''} · {gameBindings.length}{' '}
                        {zh ? '个游戏绑定' : 'bindings'}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="pcl-plat-pop-item"
                      onClick={() => {
                        setPlatMenuOpen(false);
                        navigate('/platform-account?tab=profile');
                      }}
                    >
                      <UserRound size={14} />
                      <span>{zh ? '星枢平台主页' : 'Platform Profile'}</span>
                    </button>
                    <button
                      type="button"
                      className="pcl-plat-pop-item"
                      onClick={() => {
                        setPlatMenuOpen(false);
                        navigate('/platform-account?tab=game-bindings');
                      }}
                    >
                      <Gamepad2 size={14} />
                      <span>{zh ? '绑定游戏账号' : 'Link Game Accounts'}</span>
                    </button>
                    <button
                      type="button"
                      className="pcl-plat-pop-item"
                      onClick={() => {
                        setPlatMenuOpen(false);
                        openCreateProjectModal();
                      }}
                    >
                      <PackagePlus size={14} />
                      <span>{zh ? '发布新 Mod' : 'Publish Mod'}</span>
                    </button>
                    <button
                      type="button"
                      className="pcl-plat-pop-item is-danger"
                      onClick={() => {
                        setPlatMenuOpen(false);
                        void logoutPlatformAccount();
                      }}
                    >
                      <LogOut size={14} />
                      <span>{zh ? '退出平台账号' : 'Sign out'}</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="pcl-theme-picker-wrap" ref={themePickerRef}>
            <button
              type="button"
              className={`pcl-title-pill-btn${themeMenuOpen ? ' is-open' : ''}`}
              aria-label={zh ? '主题配色' : 'Theme palette'}
              aria-expanded={themeMenuOpen}
              aria-haspopup="dialog"
              title={zh ? `当前主题：${activePreset.nameZh}` : `Theme: ${activePreset.nameEn}`}
              onClick={() => setThemeMenuOpen((open) => !open)}
            >
              <Palette size={14} />
              <span
                className="pcl-theme-dot"
                style={{ background: activePreset.swatchPrimary }}
                aria-hidden="true"
              />
            </button>

            {themeMenuOpen && (
              <div
                className="pcl-theme-popover"
                role="dialog"
                aria-label={zh ? '快速切换主题' : 'Quick theme picker'}
              >
                <div className="pcl-theme-popover-head">
                  <span>{zh ? '主题配色' : 'PCL2 Themes'}</span>
                  <small>{zh ? activePreset.nameZh : activePreset.nameEn}</small>
                </div>
                <div className="pcl-theme-popover-grid">
                  {PCL_THEMES.map((preset) => {
                    const selected = preset.id === theme;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`pcl-theme-option${selected ? ' is-selected' : ''}`}
                        onClick={() => {
                          setTheme(preset.id);
                        }}
                      >
                        <span
                          className="pcl-theme-swatch"
                          style={{
                            background: `linear-gradient(135deg, ${preset.swatchPrimary} 0%, ${preset.swatchSecondary} 100%)`,
                          }}
                          aria-hidden="true"
                        />
                        <span className="pcl-theme-name">{zh ? preset.nameZh : preset.nameEn}</span>
                        {selected && <Check size={13} className="pcl-theme-check" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            className="pcl-lang-toggle"
            aria-label={zh ? '切换界面语言为英文' : 'Switch language to Chinese'}
            title={zh ? '切换语言 (中 / EN)' : 'Switch language (中 / EN)'}
            onClick={() => setLocale(zh ? 'en-US' : 'zh-CN')}
          >
            <span className={zh ? 'is-active' : ''}>中</span>
            <span className={!zh ? 'is-active' : ''}>EN</span>
          </button>
        </div>

        <div className="pcl-window-controls" data-no-drag>
          <button
            type="button"
            aria-label={zh ? '最小化' : 'Minimize'}
            onClick={() => runWindowAction('minimize')}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            aria-label={maximized ? (zh ? '还原窗口' : 'Restore window') : (zh ? '最大化' : 'Maximize')}
            onClick={() => runWindowAction('toggleMaximize')}
          >
            {maximized ? <Copy size={12} /> : <Square size={11.5} />}
          </button>
          <button
            type="button"
            className="pcl-window-close"
            aria-label={zh ? '关闭' : 'Close'}
            onClick={() => runWindowAction('close')}
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
