import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ArrowLeft,
  Blocks,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Gamepad2,
  LogOut,
  Minus,
  PackagePlus,
  Paintbrush,
  Pin,
  Play,
  Plus,
  Settings2,
  Square,
  Trash2,
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
import {
  MAX_PINNED_TOP_TOOLS,
  PINNABLE_TOOLS,
  findToolByPath,
  usePinnedTopTools,
  type PinnableToolGroup,
} from './topBarTools';

type CoreTabKey = 'launch' | 'customize' | 'mods' | 'tools' | 'settings';
type TabKey = CoreTabKey | `pin:${string}`;

interface SubPageMeta {
  tab: CoreTabKey;
  backTo: string;
  backZh: string;
  backEn: string;
  titleZh: string;
  titleEn: string;
}

function resolveRouteMeta(
  pathname: string,
  search: string,
  pinnedKeys: string[],
): { tab: TabKey; subPage: SubPageMeta | null } {
  if (pathname === '/dashboard') {
    return { tab: 'launch', subPage: null };
  }
  if (pathname === '/customize' || pathname.startsWith('/customize/')) {
    return { tab: 'customize', subPage: null };
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

  const matchedTool = findToolByPath(pathname);
  if (matchedTool && pinnedKeys.includes(matchedTool.key)) {
    return { tab: `pin:${matchedTool.key}`, subPage: null };
  }

  if (pathname === '/room' || pathname.startsWith('/room/')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '星枢开房',
        titleEn: 'XingShu Room',
      },
    };
  }
  if (pathname.startsWith('/tools/plugin-guide')) {
    return {
      tab: 'tools',
      subPage: {
        tab: 'tools',
        backTo: '/tools',
        backZh: '返回工具库',
        backEn: 'Back to Tools',
        titleZh: '外部 Mod 接入指南',
        titleEn: 'Plugin SDK Guide',
      },
    };
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
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { user: platUser, gameBindings } = usePlatformAccount();
  const { pinnedKeys, pinnedTools, isPinned, togglePin, movePin, clearPins } = usePinnedTopTools();

  const { tab, subPage } = resolveRouteMeta(pathname, search, pinnedKeys);

  const [maximized, setMaximized] = useState(false);
  const [platMenuOpen, setPlatMenuOpen] = useState(false);
  const [pinMenuOpen, setPinMenuOpen] = useState(false);
  const [pinLimitMsg, setPinLimitMsg] = useState('');
  const platPickerRef = useRef<HTMLDivElement>(null);
  const pinPickerRef = useRef<HTMLDivElement>(null);

  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
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
  }, [measureActivePill, locale, pinnedKeys, tab]);

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
    if (!platMenuOpen && !pinMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (platPickerRef.current && !platPickerRef.current.contains(event.target as Node)) {
        setPlatMenuOpen(false);
      }
      if (pinPickerRef.current && !pinPickerRef.current.contains(event.target as Node)) {
        setPinMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlatMenuOpen(false);
        setPinMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pinMenuOpen, platMenuOpen]);

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

  const items: Array<{ key: CoreTabKey; to: string; icon: typeof Play; label: string }> = [
    { key: 'launch', to: '/dashboard', icon: Play, label: zh ? '启动' : 'Launch' },
    { key: 'customize', to: '/customize', icon: Paintbrush, label: zh ? '自定义' : 'Customize' },
    { key: 'mods', to: '/extensions/launcher', icon: Blocks, label: zh ? '模组' : 'Mods' },
    { key: 'tools', to: '/tools', icon: Wrench, label: zh ? '工具' : 'Tools' },
    { key: 'settings', to: '/settings', icon: Settings2, label: zh ? '设置' : 'Settings' },
  ];

  const pinGroupLabels: Array<{ group: PinnableToolGroup; zh: string; en: string }> = [
    { group: 'online', zh: '联机与网桥', en: 'Online & Bridge' },
    { group: 'player', zh: '对局与资料', en: 'Matches & Players' },
    { group: 'codex', zh: '游戏图鉴', en: 'Game Codex' },
    { group: 'launcher', zh: '启动器维护', en: 'Maintenance' },
  ];

  const handleToggleTopPin = (toolKey: string) => {
    const res = togglePin(toolKey);
    if (res.limitReached) {
      setPinLimitMsg(zh ? `顶部最多添加 ${MAX_PINNED_TOP_TOOLS} 个工具快捷栏位` : `Max ${MAX_PINNED_TOP_TOOLS} pinned tools`);
    } else {
      setPinLimitMsg('');
    }
  };

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
          {pinnedTools.length > 0 && <span className="pcl-capsule-sep" aria-hidden="true" />}
          {pinnedTools.map((tool) => {
            const Icon = tool.Icon;
            const pinTabKey: TabKey = `pin:${tool.key}`;
            return (
              <NavLink
                key={pinTabKey}
                to={tool.to}
                ref={(el) => {
                  tabRefs.current[pinTabKey] = el;
                }}
                title={zh ? tool.zh : tool.en}
                className={tab === pinTabKey ? 'is-pinned-tab selected' : 'is-pinned-tab'}
              >
                <Icon size={14} />
                <span>{zh ? tool.shortZh : tool.shortEn}</span>
              </NavLink>
            );
          })}
          <div className="pcl-pin-wrap" ref={pinPickerRef} data-no-drag>
            <button
              type="button"
              className={`pcl-capsule-pin-btn${pinMenuOpen ? ' is-open' : ''}`}
              title={
                zh
                  ? `自定义顶部栏位（已固定 ${pinnedTools.length}/${MAX_PINNED_TOP_TOOLS}）`
                  : `Customize top bar (${pinnedTools.length}/${MAX_PINNED_TOP_TOOLS})`
              }
              aria-label={zh ? '自定义顶部栏位' : 'Customize top bar'}
              onClick={() => {
                setPinLimitMsg('');
                setPinMenuOpen((v) => !v);
                setPlatMenuOpen(false);
              }}
            >
              {pinnedTools.length > 0 ? <Pin size={13} /> : <Plus size={14} />}
            </button>
            {pinMenuOpen && (
              <div className="pcl-pin-popover" role="dialog" aria-label={zh ? '自定义顶部栏位' : 'Customize Top Bar'}>
                <div className="pcl-pin-pop-head">
                  <div>
                    <strong>{zh ? '自定义顶部栏位' : 'Top Bar Shortcuts'}</strong>
                    <small>
                      {zh
                        ? `从「工具」添加快捷入口到顶部（最多 ${MAX_PINNED_TOP_TOOLS} 个）`
                        : `Pin up to ${MAX_PINNED_TOP_TOOLS} items from Tools`}
                    </small>
                  </div>
                  <span className="pcl-pin-counter">
                    {pinnedTools.length} / {MAX_PINNED_TOP_TOOLS}
                  </span>
                </div>

                {pinnedTools.length > 0 && (
                  <div className="pcl-pin-active-strip">
                    {pinnedTools.map((tool, idx) => (
                      <div key={tool.key} className="pcl-pin-chip">
                        <span>{zh ? tool.shortZh : tool.shortEn}</span>
                        <button
                          type="button"
                          disabled={idx === 0}
                          title={zh ? '左移' : 'Move left'}
                          onClick={() => movePin(tool.key, -1)}
                        >
                          <ChevronLeft size={11} />
                        </button>
                        <button
                          type="button"
                          disabled={idx === pinnedTools.length - 1}
                          title={zh ? '右移' : 'Move right'}
                          onClick={() => movePin(tool.key, 1)}
                        >
                          <ChevronRight size={11} />
                        </button>
                        <button
                          type="button"
                          className="is-remove"
                          title={zh ? '移除' : 'Remove'}
                          onClick={() => handleToggleTopPin(tool.key)}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="pcl-pin-clear-btn"
                      onClick={() => {
                        setPinLimitMsg('');
                        clearPins();
                      }}
                    >
                      <Trash2 size={11} />
                      <span>{zh ? '清空' : 'Clear'}</span>
                    </button>
                  </div>
                )}

                {pinLimitMsg && <div className="pcl-pin-limit-note">{pinLimitMsg}</div>}

                <div className="pcl-pin-groups">
                  {pinGroupLabels.map(({ group, zh: gZh, en: gEn }) => {
                    const groupTools = PINNABLE_TOOLS.filter((t) => t.group === group);
                    return (
                      <div key={group} className="pcl-pin-group">
                        <span className="pcl-pin-group-title">{zh ? gZh : gEn}</span>
                        <div className="pcl-pin-tool-grid">
                          {groupTools.map((tool) => {
                            const ToolIcon = tool.Icon;
                            const active = isPinned(tool.key);
                            const disabled = !active && pinnedTools.length >= MAX_PINNED_TOP_TOOLS;
                            return (
                              <button
                                key={tool.key}
                                type="button"
                                disabled={disabled}
                                className={`pcl-pin-tool-btn${active ? ' is-pinned' : ''}`}
                                onClick={() => handleToggleTopPin(tool.key)}
                              >
                                <ToolIcon size={13} />
                                <span>{zh ? tool.zh : tool.en}</span>
                                {active && <Check size={12} className="pcl-pin-check" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
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
