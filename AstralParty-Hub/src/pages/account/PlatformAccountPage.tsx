import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Bookmark,
  Camera,
  CheckCircle2,
  ExternalLink,
  FolderKanban,
  Gamepad2,
  Globe,
  Link2,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { RichGameName } from '../../components/common/RichGameName';
import { PlatformUserAvatar } from '../../components/platform/PlatformUserAvatar';
import { useTranslation } from '../../i18n';
import { isTauriRuntime } from '../../shared/runtime';
import {
  GAME_BIND_PLATFORMS,
  PLATFORM_AVATAR_SWATCHES,
  bindPlatformGameAccount,
  changePlatformPassword,
  createPlatformCollection,
  deletePlatformAvatar,
  deletePlatformCollection,
  deleteWorkshopProject,
  fetchMyWorkshopProjects,
  logoutPlatformAccount,
  openCreateProjectModal,
  openPlatformAuthModal,
  setPrimaryPlatformGameBinding,
  switchSavedPlatformAccount,
  unbindPlatformGameAccount,
  updatePlatformProfile,
  uploadPlatformAvatar,
  usePlatformAccount,
} from '../../shared/platformAccountClient';
import { fetchWorkshopMods, formatModBytes, workshopAssetUrl, type WorkshopModItem } from '../../shared/workshopClient';
import { getWebCloudSnapshot, subscribeWebCloud } from '../../shared/webCloudClient';
import '../../components/platform/platform-account.css';

type TabKey = 'profile' | 'game-bindings' | 'projects' | 'collections' | 'settings';

export const PlatformAccountPage: React.FC = () => {
  const { locale, setLocale } = useTranslation();
  const zh = locale === 'zh-CN';
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabKey) || 'profile';
  const [tab, setTab] = useState<TabKey>(initialTab);

  const platform = usePlatformAccount();
  const webCloud = useSyncExternalStore(subscribeWebCloud, getWebCloudSnapshot, getWebCloudSnapshot);
  const { user, gameBindings, follows, bookmarks, collections, savedAccounts } = platform;

  const [myProjects, setMyProjects] = useState<WorkshopModItem[]>([]);
  const [allCatalog, setAllCatalog] = useState<WorkshopModItem[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Bind Game Account form
  const [bindPlatform, setBindPlatform] = useState('STEAM_CN');
  const [bindUid, setBindUid] = useState('');
  const [bindNick, setBindNick] = useState('');
  const [bindBusy, setBindBusy] = useState(false);

  // Desktop active cloud game session (for 1-click bind)
  const [desktopCloudAcc, setDesktopCloudAcc] = useState<{ uid: string; nick?: string } | null>(null);

  // Profile Edit state
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editColor, setEditColor] = useState('#1bd96a');
  const [profBusy, setProfBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Password Change state
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  // Collection Create state
  const [colName, setColName] = useState('');
  const [colDesc, setColDesc] = useState('');
  const [colBusy, setColBusy] = useState(false);

  useEffect(() => {
    const paramTab = searchParams.get('tab') as TabKey | null;
    if (paramTab && ['profile', 'game-bindings', 'projects', 'collections', 'settings'].includes(paramTab)) {
      setTab(paramTab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (user) {
      setEditDisplayName(user.displayName);
      setEditEmail(user.email || '');
      setEditBio(user.bio || '');
      setEditColor(user.avatarColor || '#1bd96a');
    }
  }, [user]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    invoke<{ account?: { uid?: string; nick?: string } }>('get_cloud_account')
      .then((res) => {
        if (res.account?.uid) {
          setDesktopCloudAcc({ uid: String(res.account.uid), nick: res.account.nick });
        }
      })
      .catch(() => {});
  }, []);

  const loadProjects = useCallback(async () => {
    if (!user) return;
    try {
      const items = await fetchMyWorkshopProjects();
      setMyProjects(items);
    } catch {
      // Ignore transient load error.
    }
  }, [user]);

  useEffect(() => {
    void loadProjects();
    fetchWorkshopMods('all', '')
      .then((res) => setAllCatalog(res.items || []))
      .catch(() => {});
  }, [loadProjects]);

  const switchTab = (next: TabKey) => {
    setTab(next);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
    setNotice('');
    setError('');
  };

  const activeGameCandidate = isTauriRuntime()
    ? desktopCloudAcc
    : webCloud.account
    ? { uid: String(webCloud.account.uid), nick: webCloud.account.nick }
    : null;

  const handleBindSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBindBusy(true);
    try {
      await bindPlatformGameAccount({
        gameUid: bindUid.trim(),
        gameNick: bindNick.trim(),
        platform: bindPlatform,
      });
      setBindUid('');
      setBindNick('');
      setNotice(zh ? '游戏账号已绑定到当前星枢平台账号。' : 'Game account linked successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBindBusy(false);
    }
  };

  const handleOneClickCloudBind = async () => {
    if (!activeGameCandidate) return;
    setError('');
    setNotice('');
    setBindBusy(true);
    try {
      await bindPlatformGameAccount({
        gameUid: activeGameCandidate.uid,
        gameNick: activeGameCandidate.nick || '',
        platform: 'STEAM_CN',
      });
      setNotice(zh ? `已同步绑定游戏 UID ${activeGameCandidate.uid}。` : `Linked game UID ${activeGameCandidate.uid}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBindBusy(false);
    }
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setProfBusy(true);
    try {
      await updatePlatformProfile({
        displayName: editDisplayName.trim(),
        email: editEmail.trim(),
        bio: editBio.trim(),
        avatarColor: editColor,
      });
      setNotice(zh ? '星枢账号资料已更新。' : 'Profile updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProfBusy(false);
    }
  };

  const handleAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setNotice('');
    setAvatarBusy(true);
    try {
      await uploadPlatformAvatar(file);
      setNotice(zh ? '自定义头像已上传并全端生效。' : 'Custom avatar uploaded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarReset = async () => {
    setError('');
    setNotice('');
    setAvatarBusy(true);
    try {
      await deletePlatformAvatar();
      setNotice(zh ? '已恢复默认字符头像。' : 'Reverted to default initial avatar.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAvatarBusy(false);
    }
  };

  const handlePasswordSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setPwdBusy(true);
    try {
      await changePlatformPassword(curPwd, newPwd);
      setCurPwd('');
      setNewPwd('');
      setNotice(zh ? '密码已修改。' : 'Password updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPwdBusy(false);
    }
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setColBusy(true);
    try {
      await createPlatformCollection({ name: colName.trim(), description: colDesc.trim() });
      setColName('');
      setColDesc('');
      setNotice(zh ? '已创建新收藏夹。' : 'Collection created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setColBusy(false);
    }
  };

  const renderLanguageCard = () => (
    <section className="xp-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px', fontSize: 16 }}>
            <Globe size={16} color="var(--xp-accent)" />
            <span>{zh ? '界面语言 / Language' : 'Interface Language'}</span>
          </h2>
          <p className="xp-modal-sub" style={{ margin: 0 }}>
            {zh
              ? '切换星枢工坊的显示语言；首页中央游戏官方标志（星引擎 PARTY / ASTRAL PARTY）也会随语言自动切换。'
              : 'Switch workshop language. The official game logo on the home hero updates automatically with your locale.'}
          </p>
        </div>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <button
            type="button"
            className={zh ? 'xp-btn-primary' : 'xp-btn-secondary'}
            onClick={() => {
              setLocale('zh-CN');
              setNotice('界面语言已切换为简体中文。');
            }}
          >
            简体中文
          </button>
          <button
            type="button"
            className={!zh ? 'xp-btn-primary' : 'xp-btn-secondary'}
            onClick={() => {
              setLocale('en-US');
              setNotice('Interface language switched to English.');
            }}
          >
            English
          </button>
        </div>
      </div>
    </section>
  );

  if (!user) {
    return (
      <div className={`xp-scope ${isTauriRuntime() ? 'is-desktop' : ''}`}>
        <div className="xp-acc-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="xp-card" style={{ textAlign: 'center', padding: '44px 24px' }}>
            <UserRound size={42} style={{ marginBottom: 12, color: 'var(--xp-accent)' }} />
            <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>
              {zh ? '登录或注册星枢平台账号' : 'Sign in to XingShu Platform Account'}
            </h1>
            <p style={{ margin: '0 auto 20px', maxWidth: 500, color: 'var(--xp-text-sub)', fontSize: 13.5, lineHeight: 1.65 }}>
              {zh
                ? '拥有星枢账号后，可在网页工坊与桌面启动器全端同步个人档案、发布 Mod 项目、管理收藏夹并绑定多个《吉星派对》游戏渠道身份。'
                : 'Use one XingShu account across Web and Desktop to publish mods, sync collections, and bind your Astral Party game identities.'}
            </p>
            <div style={{ display: 'inline-flex', gap: 10 }}>
              <button type="button" className="xp-btn-primary" onClick={() => openPlatformAuthModal('login')}>
                {zh ? '立即登录' : 'Sign In'}
              </button>
              <button type="button" className="xp-btn-secondary" onClick={() => openPlatformAuthModal('register')}>
                {zh ? '注册新账号' : 'Create Account'}
              </button>
            </div>
          </div>

          {renderLanguageCard()}
        </div>
      </div>
    );
  }

  const primaryBinding = gameBindings.find((b) => b.isPrimary) || gameBindings[0];
  const byIdMap = new Map(allCatalog.map((m) => [m.id, m]));
  const authorKey = String(user.uid > 0 ? user.uid : user.username);

  return (
    <div className={`xp-scope ${isTauriRuntime() ? 'is-desktop' : ''}`}>
      <div className="xp-acc-wrap">
        <header className="xp-acc-banner">
          <div className="xp-acc-identity">
            <button
              type="button"
              className="xp-avatar-btn"
              title={zh ? '点击上传自定义头像（PNG/JPG/WebP ≤ 2MB）' : 'Upload custom avatar'}
              disabled={avatarBusy}
              onClick={() => avatarInputRef.current?.click()}
            >
              <PlatformUserAvatar
                name={user.displayName || user.username}
                avatarUrl={user.avatarUrl}
                avatarColor={user.avatarColor}
                size={60}
                fontSize={23}
                className="xp-avatar"
              />
              <span className="xp-avatar-cam" aria-hidden="true">
                <Camera size={12} />
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => void handleAvatarSelected(e)}
            />
            <div>
              <h1>{user.displayName}</h1>
              <div className="xp-acc-handle">
                <span>@{user.username}</span>
                {user.uid > 0 && <span className="xp-pill is-uid">UID #{user.uid}</span>}
                {primaryBinding && (
                  <span className="xp-pill is-accent">
                    <Gamepad2 size={12} />
                    {primaryBinding.platformLabel} · UID {primaryBinding.gameUid}
                  </span>
                )}
                {user.email && <span className="xp-pill">{user.email}</span>}
              </div>
            </div>
          </div>

          <div className="xp-acc-actions">
            <Link to={`/author/${encodeURIComponent(authorKey)}`} className="xp-btn-secondary">
              <ExternalLink size={14} />
              <span>{zh ? '创作者主页' : 'Creator Page'}</span>
            </Link>
            <button type="button" className="xp-btn-primary" onClick={openCreateProjectModal}>
              <Plus size={15} />
              <span>{zh ? '新建项目' : 'Create Project'}</span>
            </button>
            <button type="button" className="xp-btn-secondary" onClick={() => switchTab('game-bindings')}>
              <Link2 size={14} />
              <span>{zh ? '绑定游戏账号' : 'Link Game Account'}</span>
            </button>
            <button type="button" className="xp-btn-danger" onClick={() => void logoutPlatformAccount()}>
              <LogOut size={14} />
              <span>{zh ? '退出登录' : 'Sign Out'}</span>
            </button>
          </div>
        </header>

        <nav className="xp-acc-tabs" aria-label={zh ? '平台账号分区' : 'Account Sections'}>
          {(
            [
              { id: 'profile', Icon: UserRound, labelZh: '主页概览', labelEn: 'Overview' },
              {
                id: 'game-bindings',
                Icon: Gamepad2,
                labelZh: `绑定游戏账号 (${gameBindings.length})`,
                labelEn: `Game Accounts (${gameBindings.length})`,
              },
              {
                id: 'projects',
                Icon: FolderKanban,
                labelZh: `我的项目 (${myProjects.length})`,
                labelEn: `Projects (${myProjects.length})`,
              },
              {
                id: 'collections',
                Icon: Bookmark,
                labelZh: `收藏与关注 (${follows.length + bookmarks.length})`,
                labelEn: `Collections (${follows.length + bookmarks.length})`,
              },
              { id: 'settings', Icon: Settings, labelZh: '账号设置', labelEn: 'Settings' },
            ] as const
          ).map(({ id, Icon, labelZh, labelEn }) => (
            <button
              key={id}
              type="button"
              className={`xp-acc-tab ${tab === id ? 'is-active' : ''}`}
              onClick={() => switchTab(id)}
            >
              <Icon size={15} />
              <span>{zh ? labelZh : labelEn}</span>
            </button>
          ))}
        </nav>

        {error && <div className="xp-alert-err">{error}</div>}
        {notice && <div className="xp-alert-ok">{notice}</div>}

        {tab === 'profile' && (
          <>
            <div className="xp-stat-grid">
              <div className="xp-stat-box">
                <small>{zh ? '已绑定游戏身份' : 'Linked Game Accounts'}</small>
                <strong>{gameBindings.length}</strong>
              </div>
              <div className="xp-stat-box">
                <small>{zh ? '发布的 Mod 项目' : 'Published Projects'}</small>
                <strong>{myProjects.length}</strong>
              </div>
              <div className="xp-stat-box">
                <small>{zh ? '关注 / 收藏模组' : 'Followed & Bookmarked'}</small>
                <strong>{follows.length + bookmarks.length}</strong>
              </div>
            </div>

            <div className="xp-card">
              <h3>{zh ? '个人简介' : 'Bio'}</h3>
              <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--xp-text-sub)', lineHeight: 1.65 }}>
                {user.bio || (zh ? '暂未填写个人简介，可在「账号设置」中补充。' : 'No bio yet.')}
              </p>
            </div>
          </>
        )}

        {tab === 'game-bindings' && (
          <div className="xp-bind-layout">
            <section className="xp-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <h2>{zh ? '已绑定的《吉星派对》账号' : 'Linked Game Accounts'}</h2>
                  <p className="xp-modal-sub">
                    {zh
                      ? '支持关联 Steam 国服/国际服、TapTap、B站与 WeGame 账号，全端自动同步'
                      : 'Connect your Steam CN/Global, TapTap, Bilibili, or WeGame UIDs'}
                  </p>
                </div>
                {activeGameCandidate && (
                  <button
                    type="button"
                    className="xp-btn-primary"
                    disabled={bindBusy}
                    onClick={() => void handleOneClickCloudBind()}
                  >
                    <CheckCircle2 size={14} />
                    <span>
                      {zh
                        ? `一键绑定当前 UID ${activeGameCandidate.uid}`
                        : `Link Active UID ${activeGameCandidate.uid}`}
                    </span>
                  </button>
                )}
              </div>

              <div className="xp-bind-list">
                {gameBindings.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--xp-text-muted)', margin: '12px 0 0' }}>
                    {zh ? '尚未绑定游戏账号，可在右侧表单输入 UID 添加。' : 'No game accounts linked yet.'}
                  </p>
                ) : (
                  gameBindings.map((b) => (
                    <div key={b.id} className="xp-binding-row">
                      <div className="xp-binding-main">
                        <strong>
                          <RichGameName text={b.gameNick} fallback={`UID ${b.gameUid}`} />
                          <span className="xp-pill">{b.platformLabel}</span>
                          {b.isPrimary && (
                            <span className="xp-pill is-accent">
                              <Star size={11} />
                              {zh ? '主账号' : 'Primary'}
                            </span>
                          )}
                          {b.verified && (
                            <span className="xp-pill is-accent">
                              <ShieldCheck size={11} />
                              {zh ? '已核验' : 'Verified'}
                            </span>
                          )}
                        </strong>
                        <small>UID {b.gameUid}</small>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {!b.isPrimary && (
                          <button
                            type="button"
                            className="xp-btn-secondary"
                            onClick={() => void setPrimaryPlatformGameBinding(b.id)}
                          >
                            {zh ? '设为主账号' : 'Set Primary'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="xp-btn-danger"
                          onClick={() => void unbindPlatformGameAccount(b.id)}
                        >
                          <Trash2 size={13} />
                          <span>{zh ? '解绑' : 'Unlink'}</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="xp-card">
              <h2>{zh ? '添加绑定游戏账号' : 'Add Game Binding'}</h2>
              <p className="xp-modal-sub">
                {zh ? '输入游戏内数字 UID 后，将自动尝试匹配玩家昵称' : 'Enter numeric UID and game channel'}
              </p>

              <form className="xp-form" style={{ marginTop: 14 }} onSubmit={(e) => void handleBindSubmit(e)}>
                <div className="xp-field">
                  <label htmlFor="xp-bind-plat">{zh ? '游戏渠道 *' : 'Platform *'}</label>
                  <select
                    id="xp-bind-plat"
                    value={bindPlatform}
                    onChange={(e) => setBindPlatform(e.target.value)}
                  >
                    {GAME_BIND_PLATFORMS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {zh ? p.labelZh : p.labelEn}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="xp-field">
                  <label htmlFor="xp-bind-uid">{zh ? '游戏数字 UID *' : 'Game UID *'}</label>
                  <input
                    id="xp-bind-uid"
                    type="text"
                    required
                    pattern="\d{4,20}"
                    value={bindUid}
                    onChange={(e) => setBindUid(e.target.value)}
                    placeholder="10086421"
                  />
                </div>

                <div className="xp-field">
                  <label htmlFor="xp-bind-nick">{zh ? '备注昵称 (可选)' : 'Nickname (optional)'}</label>
                  <input
                    id="xp-bind-nick"
                    type="text"
                    maxLength={40}
                    value={bindNick}
                    onChange={(e) => setBindNick(e.target.value)}
                    placeholder={zh ? '留空自动从星枢公共服务识别' : 'Leave blank to auto-detect'}
                  />
                </div>

                <button type="submit" className="xp-btn-primary" disabled={bindBusy}>
                  <Link2 size={14} />
                  <span>{bindBusy ? (zh ? '绑定中…' : 'Linking…') : zh ? '绑定此游戏账号' : 'Link Account'}</span>
                </button>
              </form>
            </section>
          </div>
        )}

        {tab === 'projects' && (
          <section className="xp-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div>
                <h2>{zh ? '我创建的工坊项目' : 'My Workshop Projects'}</h2>
                <p className="xp-modal-sub">{zh ? '点击任意项目可进入专属详情页并继续上传版本' : 'Open any project to manage versions'}</p>
              </div>
              <button type="button" className="xp-btn-primary" onClick={openCreateProjectModal}>
                <Plus size={14} />
                <span>{zh ? '新建项目' : 'New Project'}</span>
              </button>
            </div>

            {myProjects.length === 0 ? (
              <p style={{ fontSize: 13.5, color: 'var(--xp-text-muted)' }}>
                {zh ? '还没有创建项目，点击右上角「新建项目」即可发布你的第一款 Mod！' : 'No projects yet.'}
              </p>
            ) : (
              <div className="xp-bind-list">
                {myProjects.map((p) => (
                  <div key={p.id} className="xp-binding-row">
                    <div className="xp-binding-main" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {p.previewUrl && (
                        <img
                          src={workshopAssetUrl(p.previewUrl)}
                          alt=""
                          style={{ width: 40, height: 40, borderRadius: 9, objectFit: 'cover', border: '1px solid var(--xp-border)', flexShrink: 0 }}
                        />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <strong>
                          <Link to={`/mod/${encodeURIComponent(p.slug || p.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                            {p.name}
                          </Link>
                          <span className="xp-pill">{p.categoryLabel}</span>
                          {p.isSeed && (
                            <span className="xp-pill is-accent">{zh ? '官方内置' : 'Official'}</span>
                          )}
                          <span className="xp-pill is-accent">{p.status === 'approved' ? (zh ? '已上架' : 'Published') : zh ? '草稿' : 'Draft'}</span>
                          <span className="xp-pill">{p.visibility === 'private' ? (zh ? '私有' : 'Private') : p.visibility === 'unlisted' ? (zh ? '未列出' : 'Unlisted') : zh ? '公开' : 'Public'}</span>
                        </strong>
                        <small>
                          /{p.slug || p.id} · v{p.version || '1.0.0'} · {formatModBytes(p.sizeBytes)}
                          {(p.galleryCount ?? 0) > 0 ? ` · ${p.galleryCount} ${zh ? '张展示图' : 'images'}` : ''}
                        </small>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Link to={`/mod/${encodeURIComponent(p.slug || p.id)}`} className="xp-btn-secondary">
                        {zh ? '打开详情页' : 'Open Page'}
                      </Link>
                      <Link to={`/mod/${encodeURIComponent(p.slug || p.id)}?tab=settings`} className="xp-btn-primary" style={{ minHeight: 34, padding: '0 12px', fontSize: 12.5 }}>
                        <Pencil size={13} />
                        <span>{zh ? '修改项目' : 'Edit Project'}</span>
                      </Link>
                      {!p.isSeed && (
                        <button
                          type="button"
                          className="xp-btn-danger"
                          onClick={() => {
                            if (!window.confirm(zh ? `确定删除项目「${p.name}」吗？此操作不可撤销。` : `Delete "${p.name}"?`)) {
                              return;
                            }
                            void deleteWorkshopProject(p.id)
                              .then(() => {
                                setNotice(zh ? `已删除项目「${p.name}」` : `Deleted ${p.name}`);
                                return loadProjects();
                              })
                              .catch((err) => setError(err instanceof Error ? err.message : String(err)));
                          }}
                        >
                          <Trash2 size={13} />
                          <span>{zh ? '删除' : 'Delete'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'collections' && (
          <div className="xp-bind-layout">
            <section className="xp-card">
              <h2>{zh ? '关注的模组 & 收藏夹' : 'Follows & Collections'}</h2>
              <p className="xp-modal-sub">
                {zh ? `共关注 ${follows.length} 项、书签收藏 ${bookmarks.length} 项` : `${follows.length} followed · ${bookmarks.length} bookmarked`}
              </p>

              <div className="xp-bind-list">
                {Array.from(new Set([...follows, ...bookmarks])).map((mid) => {
                  const mod = byIdMap.get(mid);
                  return (
                    <div key={mid} className="xp-binding-row">
                      <div className="xp-binding-main">
                        <strong>
                          <span>{mod?.name || mid}</span>
                          {follows.includes(mid) && <span className="xp-pill is-accent">{zh ? '已关注' : 'Following'}</span>}
                          {bookmarks.includes(mid) && <span className="xp-pill">{zh ? '已收藏' : 'Bookmarked'}</span>}
                        </strong>
                        <small>{mod?.description || mid}</small>
                      </div>
                      <Link to={`/mod/${encodeURIComponent(mod?.slug || mid)}`} className="xp-btn-secondary">
                        {zh ? '查看' : 'View'}
                      </Link>
                    </div>
                  );
                })}

                {collections.map((col) => (
                  <div key={col.id} className="xp-binding-row">
                    <div className="xp-binding-main">
                      <strong>
                        <span>{col.name}</span>
                        <span className="xp-pill">{col.modIds.length} 项模组</span>
                      </strong>
                      <small>{col.description || col.id}</small>
                    </div>
                    <button
                      type="button"
                      className="xp-btn-danger"
                      onClick={() => void deletePlatformCollection(col.id)}
                    >
                      <Trash2 size={13} />
                      <span>{zh ? '删除' : 'Delete'}</span>
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="xp-card">
              <h2>{zh ? '新建收藏夹' : 'Create Collection'}</h2>
              <form className="xp-form" style={{ marginTop: 14 }} onSubmit={(e) => void handleCreateCollection(e)}>
                <div className="xp-field">
                  <label htmlFor="xp-col-name">{zh ? '收藏夹名称 *' : 'Name *'}</label>
                  <input
                    id="xp-col-name"
                    type="text"
                    required
                    value={colName}
                    onChange={(e) => setColName(e.target.value)}
                    placeholder={zh ? '例如：开黑必备优化合集' : 'Collection name'}
                  />
                </div>
                <div className="xp-field">
                  <label htmlFor="xp-col-desc">{zh ? '简介 (可选)' : 'Description'}</label>
                  <textarea
                    id="xp-col-desc"
                    rows={2}
                    value={colDesc}
                    onChange={(e) => setColDesc(e.target.value)}
                  />
                </div>
                <button type="submit" className="xp-btn-primary" disabled={colBusy}>
                  <Plus size={14} />
                  <span>{colBusy ? (zh ? '创建中…' : 'Creating…') : zh ? '创建收藏夹' : 'Create'}</span>
                </button>
              </form>
            </section>
          </div>
        )}

        {tab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {renderLanguageCard()}
            <div className="xp-bind-layout">
            <section className="xp-card">
              <h2>{zh ? '自定义头像与基本资料' : 'Custom Avatar & Profile'}</h2>
              <div className="xp-avatar-upload-box">
                <PlatformUserAvatar
                  name={user.displayName || user.username}
                  avatarUrl={user.avatarUrl}
                  avatarColor={user.avatarColor}
                  size={56}
                  fontSize={22}
                />
                <div className="xp-avatar-upload-meta">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button
                      type="button"
                      className="xp-btn-secondary"
                      disabled={avatarBusy}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <Upload size={14} />
                      <span>{avatarBusy ? (zh ? '上传中…' : 'Uploading…') : zh ? '上传自定义头像' : 'Upload Avatar'}</span>
                    </button>
                    {user.avatarUrl && (
                      <button
                        type="button"
                        className="xp-btn-secondary"
                        disabled={avatarBusy}
                        onClick={() => void handleAvatarReset()}
                      >
                        <RotateCcw size={14} />
                        <span>{zh ? '恢复默认' : 'Reset'}</span>
                      </button>
                    )}
                  </div>
                  <small>{zh ? '支持 PNG / JPG / WebP，最大 2 MB；全端同步展示在个人名片、顶栏与创作者主页。' : 'PNG, JPG, or WebP up to 2 MB.'}</small>
                </div>
              </div>
              <form className="xp-form" style={{ marginTop: 14 }} onSubmit={(e) => void handleProfileSave(e)}>
                <div className="xp-field">
                  <label htmlFor="xp-set-display">{zh ? '显示昵称' : 'Display Name'}</label>
                  <input
                    id="xp-set-display"
                    type="text"
                    required
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                  />
                </div>
                <div className="xp-field">
                  <label htmlFor="xp-set-email">{zh ? '邮箱' : 'Email'}</label>
                  <input
                    id="xp-set-email"
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                  />
                </div>
                <div className="xp-field">
                  <label htmlFor="xp-set-bio">{zh ? '个人简介' : 'Bio'}</label>
                  <textarea
                    id="xp-set-bio"
                    rows={3}
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                  />
                </div>
                <div className="xp-field">
                  <span className="xp-field-label">{zh ? '头像色板' : 'Avatar Color'}</span>
                  <div className="xp-swatches">
                    {PLATFORM_AVATAR_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        className={`xp-swatch-btn ${editColor === hex ? 'is-active' : ''}`}
                        style={{ background: hex }}
                        onClick={() => setEditColor(hex)}
                        aria-label={hex}
                      />
                    ))}
                  </div>
                </div>
                <button type="submit" className="xp-btn-primary" disabled={profBusy}>
                  {profBusy ? (zh ? '保存中…' : 'Saving…') : zh ? '保存资料' : 'Save Profile'}
                </button>
              </form>
            </section>

            <section className="xp-card">
              <h2>{zh ? '修改密码 & 已存账户' : 'Security & Saved Accounts'}</h2>
              <form className="xp-form" style={{ marginTop: 14 }} onSubmit={(e) => void handlePasswordSave(e)}>
                <div className="xp-field">
                  <label htmlFor="xp-cur-pwd">{zh ? '当前密码' : 'Current Password'}</label>
                  <input
                    id="xp-cur-pwd"
                    type="password"
                    required
                    value={curPwd}
                    onChange={(e) => setCurPwd(e.target.value)}
                  />
                </div>
                <div className="xp-field">
                  <label htmlFor="xp-new-pwd">{zh ? '新密码 (≥8位)' : 'New Password'}</label>
                  <input
                    id="xp-new-pwd"
                    type="password"
                    required
                    minLength={8}
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                  />
                </div>
                <button type="submit" className="xp-btn-secondary" disabled={pwdBusy}>
                  {pwdBusy ? (zh ? '更新中…' : 'Updating…') : zh ? '更新密码' : 'Change Password'}
                </button>
              </form>

              {savedAccounts.length > 1 && (
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--xp-border)' }}>
                  <h3 style={{ fontSize: 14, marginBottom: 8 }}>{zh ? '快速切换本地已保存账户' : 'Switch Account'}</h3>
                  <div className="xp-bind-list">
                    {savedAccounts.map((acc) => (
                      <div key={acc.user.id} className="xp-binding-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="xp-avatar is-sm" style={{ background: acc.user.avatarColor }}>
                            {(acc.user.displayName || acc.user.username).slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <strong style={{ fontSize: 13 }}>{acc.user.displayName}</strong>
                            <small style={{ display: 'block', fontSize: 11.5, color: 'var(--xp-text-muted)' }}>
                              @{acc.user.username}
                            </small>
                          </div>
                        </div>
                        {acc.user.id === user.id ? (
                          <span className="xp-pill is-accent">{zh ? '当前' : 'Active'}</span>
                        ) : (
                          <button
                            type="button"
                            className="xp-btn-secondary"
                            onClick={() => void switchSavedPlatformAccount(acc.user.id)}
                          >
                            {zh ? '切换' : 'Switch'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
