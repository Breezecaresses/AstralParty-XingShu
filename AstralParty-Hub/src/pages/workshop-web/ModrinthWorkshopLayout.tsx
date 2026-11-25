import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRightLeft,
  Blocks,
  Bookmark,
  BookOpen,
  ChevronDown,
  Compass,
  Download,
  ExternalLink,
  FolderPlus,
  Gamepad2,
  Layers,
  LayoutDashboard,
  LogOut,
  PackagePlus,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PlatformGlobalModals } from '../../components/platform/PlatformGlobalModals';
import { PlatformUserAvatar } from '../../components/platform/PlatformUserAvatar';
import { useTranslation } from '../../i18n';
import {
  isPlatformAdmin,
  logoutPlatformAccount,
  openCreateProjectModal,
  openPlatformAuthModal,
  switchSavedPlatformAccount,
  usePlatformAccount,
} from '../../shared/platformAccountClient';
import { PROJECT_SOURCE } from '../../shared/projectSource';
import { assetUrl } from '../../shared/runtime';
import './modrinth.css';

export const ModrinthWorkshopLayout: React.FC = () => {
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const { pathname, search } = useLocation();
  const navigate = useNavigate();

  const { user, gameBindings, savedAccounts } = usePlatformAccount();

  const [launcherModalOpen, setLauncherModalOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [switchSubOpen, setSwitchSubOpen] = useState(false);

  const navMenusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = zh ? '星枢模组工坊 · AstralParty XingShu' : 'XingShu Mod Workshop';
    }
  }, [zh]);

  useEffect(() => {
    window.scrollTo(0, 0);
    setDiscoverOpen(false);
    setPublishOpen(false);
    setAccountOpen(false);
    setSwitchSubOpen(false);
  }, [pathname, search]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (navMenusRef.current && !navMenusRef.current.contains(e.target as Node)) {
        setDiscoverOpen(false);
        setPublishOpen(false);
        setAccountOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDiscoverOpen(false);
        setPublishOpen(false);
        setAccountOpen(false);
        setLauncherModalOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const isBrowse = pathname.startsWith('/extensions/mods');
  const primaryGame = gameBindings.find((b) => b.isPrimary) || gameBindings[0];

  return (
    <div className="mr-web-root" ref={navMenusRef}>
      <header className="mr-navbar">
        <div className="mr-navbar-inner">
          <Link to="/dashboard" className="mr-brand">
            <img src={assetUrl('brand/xingshu.svg')} alt="" />
            <span>{zh ? '星枢工坊' : 'XingShu'}</span>
            <span className="mr-brand-tag">MODS</span>
          </Link>

          <nav className="mr-nav-links" aria-label={zh ? '模组工坊导航' : 'Mod Workshop navigation'}>
            <div className="mr-menu-wrap">
              <button
                type="button"
                className={`mr-nav-trigger ${isBrowse || discoverOpen ? 'is-open' : ''}`}
                onClick={() => {
                  setDiscoverOpen((v) => !v);
                  setPublishOpen(false);
                  setAccountOpen(false);
                }}
              >
                <Compass size={15} />
                <span>{zh ? '发现内容' : 'Discover content'}</span>
                <ChevronDown size={14} />
              </button>

              {discoverOpen && (
                <div className="mr-dropdown is-left" role="menu">
                  <Link to="/extensions/mods" className="mr-dropdown-item" role="menuitem">
                    <Compass size={15} />
                    <span>{zh ? '全部模组' : 'All Mods'}</span>
                  </Link>
                  <Link
                    to="/extensions/mods?category=optimization"
                    className="mr-dropdown-item"
                    role="menuitem"
                  >
                    <Sparkles size={15} />
                    <span>{zh ? '功能优化 (.xspkg)' : 'Optimization (.xspkg)'}</span>
                  </Link>
                  <Link to="/extensions/mods?category=skin" className="mr-dropdown-item" role="menuitem">
                    <Blocks size={15} />
                    <span>{zh ? '角色皮肤' : 'Character Skins'}</span>
                  </Link>
                  <Link to="/extensions/mods?category=card" className="mr-dropdown-item" role="menuitem">
                    <Layers size={15} />
                    <span>{zh ? '卡牌替换' : 'Cards'}</span>
                  </Link>
                  <Link to="/extensions/mods?category=voice_vfx" className="mr-dropdown-item" role="menuitem">
                    <Layers size={15} />
                    <span>{zh ? '语音 · 特效' : 'Voice & VFX'}</span>
                  </Link>
                  <Link to="/extensions/plugin-guide" className="mr-dropdown-item" role="menuitem">
                    <BookOpen size={15} />
                    <span>{zh ? '外部优化 Mod 接入指南' : 'Plugin SDK Guide'}</span>
                  </Link>
                </div>
              )}
            </div>

            <button
              type="button"
              className="mr-nav-trigger"
              onClick={() => setLauncherModalOpen(true)}
            >
              <Download size={15} />
              <span>{zh ? '获取星枢启动器' : 'Get XingShu App'}</span>
            </button>

            <NavLink to="/extensions/mods" className={({ isActive }) => (isActive ? 'is-active' : '')}>
              <span>{zh ? '模组列表' : 'Mods'}</span>
            </NavLink>

            <NavLink to="/extensions/plugin-guide" className={({ isActive }) => (isActive ? 'is-active' : '')}>
              <BookOpen size={14} style={{ marginRight: 5, verticalAlign: '-2px' }} />
              <span>{zh ? '插件接入指南' : 'Plugin SDK'}</span>
            </NavLink>

            {isPlatformAdmin(user) && (
              <NavLink to="/admin" className={({ isActive }) => (isActive ? 'is-active' : '')}>
                <ShieldCheck size={14} style={{ marginRight: 5, verticalAlign: '-2px' }} />
                <span>{zh ? '管理后台' : 'Admin'}</span>
              </NavLink>
            )}
          </nav>

          <div className="mr-nav-actions">
            {!user && (
              <Link
                to="/settings"
                className="mr-icon-nav-btn"
                title={zh ? '语言与设置' : 'Language & Settings'}
                aria-label={zh ? '语言与设置' : 'Language & Settings'}
              >
                <Settings size={15} />
              </Link>
            )}

            <div className="mr-menu-wrap">
              <button
                type="button"
                className="mr-publish-btn"
                onClick={() => {
                  setPublishOpen((v) => !v);
                  setDiscoverOpen(false);
                  setAccountOpen(false);
                }}
              >
                <Plus size={15} />
                <span>{zh ? '发布' : 'Publish'}</span>
              </button>

              {publishOpen && (
                <div className="mr-dropdown" role="menu">
                  <button
                    type="button"
                    className="mr-dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setPublishOpen(false);
                      openCreateProjectModal();
                    }}
                  >
                    <PackagePlus size={15} />
                    <span>{zh ? '新建项目' : 'New project'}</span>
                  </button>
                  <Link
                    to="/extensions/creator"
                    className="mr-dropdown-item"
                    role="menuitem"
                    onClick={() => setPublishOpen(false)}
                  >
                    <Sparkles size={15} />
                    <span>{zh ? '投稿审核入口' : 'Anonymous submission'}</span>
                  </Link>
                  <Link
                    to="/extensions/plugin-guide"
                    className="mr-dropdown-item"
                    role="menuitem"
                    onClick={() => setPublishOpen(false)}
                  >
                    <BookOpen size={15} />
                    <span>{zh ? '插件接入指南' : 'Plugin SDK Guide'}</span>
                  </Link>
                  <button
                    type="button"
                    className="mr-dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setPublishOpen(false);
                      if (!user) openPlatformAuthModal('login');
                      else navigate('/account?tab=collections');
                    }}
                  >
                    <FolderPlus size={15} />
                    <span>{zh ? '新建收藏夹' : 'New collection'}</span>
                  </button>
                </div>
              )}
            </div>

            {!user ? (
              <button
                type="button"
                className="mr-btn-emerald"
                onClick={() => openPlatformAuthModal('login')}
              >
                <UserRound size={15} />
                <span>{zh ? '登录' : 'Sign in'}</span>
              </button>
            ) : (
              <div className="mr-menu-wrap">
                <button
                  type="button"
                  className="mr-avatar-btn"
                  aria-label={zh ? '平台账号菜单' : 'Account menu'}
                  onClick={() => {
                    setAccountOpen((v) => !v);
                    setPublishOpen(false);
                    setDiscoverOpen(false);
                    setSwitchSubOpen(false);
                  }}
                >
                  <PlatformUserAvatar
                    name={user.displayName || user.username}
                    avatarUrl={user.avatarUrl}
                    avatarColor={user.avatarColor}
                    size={30}
                    fontSize={13}
                    className="mr-avatar-dot"
                  />
                  <ChevronDown size={14} />
                </button>

                {accountOpen && (
                  <div className="mr-dropdown is-wide" role="menu">
                    <div className="mr-dropdown-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PlatformUserAvatar
                          name={user.displayName || user.username}
                          avatarUrl={user.avatarUrl}
                          avatarColor={user.avatarColor}
                          size={34}
                          fontSize={14}
                        />
                        <div style={{ minWidth: 0 }}>
                          <strong>{user.displayName}</strong>
                          <small>
                            @{user.username}
                            {user.uid ? ` · UID #${user.uid}` : ''}
                            {primaryGame ? ` · 游戏 ${primaryGame.gameUid}` : ''}
                          </small>
                        </div>
                      </div>
                    </div>

                    <Link
                      to={`/author/${encodeURIComponent(String(user.uid > 0 ? user.uid : user.username))}`}
                      className="mr-dropdown-item"
                      role="menuitem"
                    >
                      <Sparkles size={15} />
                      <span>{zh ? '我的创作者主页' : 'Creator Profile'}</span>
                    </Link>
                    <Link to="/account?tab=profile" className="mr-dropdown-item" role="menuitem">
                      <UserRound size={15} />
                      <span>{zh ? '主页' : 'Profile'}</span>
                    </Link>
                    <Link to="/account?tab=game-bindings" className="mr-dropdown-item" role="menuitem">
                      <Gamepad2 size={15} />
                      <span>{zh ? '绑定游戏账号' : 'Linked Game Accounts'}</span>
                    </Link>
                    <Link to="/account?tab=settings" className="mr-dropdown-item" role="menuitem">
                      <Settings size={15} />
                      <span>{zh ? '设置' : 'Settings'}</span>
                    </Link>

                    <div className="mr-dropdown-sep" />

                    <Link to="/account?tab=collections" className="mr-dropdown-item" role="menuitem">
                      <Bookmark size={15} />
                      <span>{zh ? '收藏与关注' : 'Collections'}</span>
                    </Link>
                    <Link to="/account?tab=projects" className="mr-dropdown-item" role="menuitem">
                      <PackagePlus size={15} />
                      <span>{zh ? '项目' : 'Projects'}</span>
                    </Link>
                    <Link to="/account?tab=profile" className="mr-dropdown-item" role="menuitem">
                      <LayoutDashboard size={15} />
                      <span>{zh ? '仪表板' : 'Dashboard'}</span>
                    </Link>
                    {isPlatformAdmin(user) && (
                      <Link to="/admin" className="mr-dropdown-item" role="menuitem">
                        <ShieldCheck size={15} />
                        <span>{zh ? '管理员后台 / 审核渠道' : 'Admin Console'}</span>
                      </Link>
                    )}

                    <div className="mr-dropdown-sep" />

                    <button
                      type="button"
                      className="mr-dropdown-item"
                      role="menuitem"
                      onClick={() => setSwitchSubOpen((v) => !v)}
                    >
                      <ArrowRightLeft size={15} />
                      <span>{zh ? '切换账户' : 'Switch account'}</span>
                    </button>

                    {switchSubOpen && (
                      <div style={{ padding: '4px 6px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {savedAccounts
                          .filter((acc) => acc.user.id !== user.id)
                          .map((acc) => (
                            <button
                              key={acc.user.id}
                              type="button"
                              className="mr-dropdown-item"
                              style={{ fontSize: 12.5, padding: '6px 9px' }}
                              onClick={() => {
                                setAccountOpen(false);
                                void switchSavedPlatformAccount(acc.user.id);
                              }}
                            >
                              <PlatformUserAvatar
                                name={acc.user.displayName || acc.user.username}
                                avatarUrl={acc.user.avatarUrl}
                                avatarColor={acc.user.avatarColor}
                                size={20}
                                fontSize={10}
                              />
                              <span>@{acc.user.username}</span>
                            </button>
                          ))}
                        <button
                          type="button"
                          className="mr-dropdown-item"
                          style={{ fontSize: 12.5, padding: '6px 9px', color: 'var(--mr-accent)' }}
                          onClick={() => {
                            setAccountOpen(false);
                            openPlatformAuthModal('login');
                          }}
                        >
                          <Plus size={14} />
                          <span>{zh ? '添加 / 登录其他账户' : 'Add account'}</span>
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      className="mr-dropdown-item is-danger"
                      role="menuitem"
                      onClick={() => {
                        setAccountOpen(false);
                        void logoutPlatformAccount();
                      }}
                    >
                      <LogOut size={15} />
                      <span>{zh ? '退出登录' : 'Sign out'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mr-main">
        <Outlet />
      </main>

      <footer className="mr-footer">
        <div className="mr-footer-grid">
          <div className="mr-footer-brand">
            <Link to="/dashboard" className="mr-brand">
              <img src={assetUrl('brand/xingshu.svg')} alt="" />
              <span>{zh ? '星枢工坊' : 'XingShu'}</span>
            </Link>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--mr-text-secondary)', lineHeight: 1.6 }}>
              {zh
                ? '星枢工坊是一个开源的《吉星派对》模组与扩展分发平台，支持全端账号绑定与安全包校验。'
                : 'Open-source mod & package hub for Astral Party with cross-platform account sync.'}
            </p>
            <small style={{ color: 'var(--mr-text-muted)' }}>© 2026 AstralParty XingShu Hub</small>
          </div>

          <div className="mr-footer-col">
            <h4>{zh ? '探索' : 'Explore'}</h4>
            <ul>
              <li><Link to="/extensions/mods">{zh ? '全部模组' : 'All Mods'}</Link></li>
              <li><Link to="/extensions/mods?category=optimization">{zh ? '优化功能模块' : 'Optimization Modules'}</Link></li>
              <li><Link to="/extensions/mods?category=skin">{zh ? '角色皮肤' : 'Skins'}</Link></li>
              <li><Link to="/extensions/mods?category=card">{zh ? '卡牌替换' : 'Card Packs'}</Link></li>
            </ul>
          </div>

          <div className="mr-footer-col">
            <h4>{zh ? '产品' : 'Products'}</h4>
            <ul>
              <li><button type="button" onClick={() => setLauncherModalOpen(true)}>{zh ? '星枢桌面启动器' : 'XingShu App'}</button></li>
              <li><button type="button" onClick={openCreateProjectModal}>{zh ? '发布 Mod 项目' : 'Publish a Mod'}</button></li>
              <li><Link to="/account?tab=game-bindings">{zh ? '绑定游戏账号' : 'Link Game Account'}</Link></li>
            </ul>
          </div>

          <div className="mr-footer-col">
            <h4>{zh ? '资源' : 'Resources'}</h4>
            <ul>
              <li><Link to="/extensions/creator">{zh ? '投稿规范与审核' : 'Creator Guide'}</Link></li>
              <li><a href={PROJECT_SOURCE} target="_blank" rel="noreferrer">GitHub 源码 ↗</a></li>
              <li><a href={`${PROJECT_SOURCE}/releases`} target="_blank" rel="noreferrer">{zh ? '桌面客户端下载 ↗' : 'Desktop Releases ↗'}</a></li>
            </ul>
          </div>

          <div className="mr-footer-col">
            <h4>{zh ? '说明' : 'Legal'}</h4>
            <ul>
              <li><Link to="/account">{zh ? '星枢平台账号' : 'Platform Account'}</Link></li>
              <li><Link to="/settings">{zh ? '语言与设置' : 'Language & Settings'}</Link></li>
              <li><span style={{ fontSize: 12.5, color: 'var(--mr-text-muted)' }}>SHA-256 包体核验</span></li>
              <li><span style={{ fontSize: 12.5, color: 'var(--mr-text-muted)' }}>非官方《吉星派对》社区工具</span></li>
            </ul>
          </div>
        </div>
        <div className="mr-footer-bottom">
          <span>{zh ? '星枢平台账号与游戏渠道身份相互隔离存储，仅用于社区身份与模组同步。' : 'XingShu platform identity is isolated from game credentials.'}</span>
          <span>AstralParty-XingShu</span>
        </div>
      </footer>

      {launcherModalOpen &&
        createPortal(
          <div className="mr-web-root">
            <div className="mr-modal-backdrop" onClick={() => setLauncherModalOpen(false)}>
              <div
                className="mr-modal"
                role="dialog"
                aria-modal="true"
                aria-label={zh ? '获取星枢桌面启动器' : 'Get XingShu Desktop Launcher'}
                onClick={(e) => e.stopPropagation()}
              >
                <header className="mr-modal-head">
                  <div className="mr-icon-tile is-sm" style={{ background: 'var(--mr-accent-soft)' }}>
                    <img src={assetUrl('brand/xingshu.svg')} alt="" />
                  </div>
                  <div className="mr-modal-title">
                    <h2>{zh ? '星枢桌面启动器 (XingShu Hub)' : 'XingShu Desktop Launcher'}</h2>
                    <p>{zh ? '一键安装 .xspkg、SHA-256 校验与事务回滚' : 'One-click .xspkg install, SHA-256 checks & safe rollback'}</p>
                  </div>
                  <button
                    type="button"
                    className="mr-modal-close"
                    onClick={() => setLauncherModalOpen(false)}
                    aria-label={zh ? '关闭' : 'Close'}
                  >
                    <X size={16} />
                  </button>
                </header>

                <div className="mr-install-note">
                  {zh
                    ? '在网页工坊下载任意 .xspkg 后，拖入桌面端「星枢启动器」即可安装；登录同一星枢平台账号后，已绑定游戏账号与收藏列表可全端互通。'
                    : 'Drop any downloaded .xspkg onto XingShu Desktop App, or sign in with the same platform account on desktop to install directly.'}
                </div>

                <footer className="mr-modal-foot">
                  <button type="button" className="mr-btn-outline" onClick={() => setLauncherModalOpen(false)}>
                    {zh ? '继续浏览' : 'Keep Browsing'}
                  </button>
                  <a
                    href={`${PROJECT_SOURCE}/releases`}
                    target="_blank"
                    rel="noreferrer"
                    className="mr-btn-emerald"
                  >
                    <ExternalLink size={14} />
                    <span>{zh ? '前往 GitHub Releases' : 'GitHub Releases'}</span>
                  </a>
                </footer>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <PlatformGlobalModals />
    </div>
  );
};
