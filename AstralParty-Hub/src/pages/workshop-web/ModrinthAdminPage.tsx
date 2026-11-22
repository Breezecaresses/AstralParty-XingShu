import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PlatformUserAvatar } from '../../components/platform/PlatformUserAvatar';
import { useTranslation } from '../../i18n';
import {
  downloadWorkshopArchiveAuthenticated,
  fetchAdminMods,
  fetchAdminOverview,
  fetchAdminSubmissions,
  fetchAdminUsers,
  isPlatformAdmin,
  openPlatformAuthModal,
  submitAdminReview,
  updateAdminUserRole,
  usePlatformAccount,
  type AdminOverviewResponse,
  type AdminUserEntry,
} from '../../shared/platformAccountClient';
import {
  formatModBytes,
  installKindLabel,
  modPlatformSummaryBadge,
  sanitizeWorkshopPlatforms,
  type WorkshopModItem,
} from '../../shared/workshopClient';
import './modrinth.css';

type AdminTab = 'overview' | 'queue' | 'users' | 'mods';
type RoleChoice = 'member' | 'creator' | 'official' | 'admin' | 'banned';

const VALID_ADMIN_TABS: readonly AdminTab[] = ['overview', 'queue', 'users', 'mods'];

function formatEpochOrIso(val?: string | number | null, zh = true): string {
  if (val === null || val === undefined || val === '') return '—';
  let ms = 0;
  if (typeof val === 'number' && Number.isFinite(val)) {
    ms = val < 1e12 ? val * 1000 : val;
  } else {
    const str = String(val).trim();
    if (/^\d+(\.\d+)?$/.test(str)) {
      const n = Number(str);
      ms = n < 1e12 ? n * 1000 : n;
    } else {
      ms = Date.parse(str);
    }
  }
  if (!Number.isFinite(ms) || ms <= 0) return String(val).slice(0, 16);
  try {
    return new Date(ms).toLocaleString(zh ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(val).slice(0, 16);
  }
}

function statusPillMeta(status?: string, zh = true): { label: string; cls: string } {
  switch ((status || 'approved').toLowerCase()) {
    case 'pending':
      return { label: zh ? '待审核' : 'Pending', cls: 'is-warn' };
    case 'rejected':
      return { label: zh ? '已驳回' : 'Rejected', cls: 'is-danger' };
    case 'unpublished':
      return { label: zh ? '已下架' : 'Unpublished', cls: 'is-muted' };
    default:
      return { label: zh ? '已通过' : 'Approved', cls: 'is-ok' };
  }
}

function roleLabel(role: string, zh = true): string {
  switch ((role || 'member').toLowerCase()) {
    case 'official':
      return zh ? '官方管理员' : 'Official';
    case 'admin':
      return zh ? '管理员' : 'Admin';
    case 'creator':
      return zh ? '认证创作者' : 'Creator';
    case 'banned':
      return zh ? '已封禁' : 'Banned';
    default:
      return zh ? '普通用户' : 'Member';
  }
}

export const ModrinthAdminPage: React.FC = () => {
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const platform = usePlatformAccount();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab = searchParams.get('tab') as AdminTab | null;
  const [tab, setTabState] = useState<AdminTab>(
    initialTab && VALID_ADMIN_TABS.includes(initialTab) ? initialTab : 'overview',
  );

  const isAdmin = isPlatformAdmin(platform.user);

  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [users, setUsers] = useState<AdminUserEntry[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [submissions, setSubmissions] = useState<WorkshopModItem[]>([]);
  const [allMods, setAllMods] = useState<WorkshopModItem[]>([]);

  const [queueStatus, setQueueStatus] = useState<'pending' | 'approved' | 'rejected' | 'unpublished' | 'all'>('pending');
  const [queueQuery, setQueueQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [modsQuery, setModsQuery] = useState('');

  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, RoleChoice>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [actionBusyKey, setActionBusyKey] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const t = searchParams.get('tab') as AdminTab | null;
    if (t && VALID_ADMIN_TABS.includes(t)) {
      setTabState(t);
    }
  }, [searchParams]);

  const setTab = (next: AdminTab) => {
    setTabState(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const loadOverview = useCallback(async () => {
    if (!isAdmin) return;
    const data = await fetchAdminOverview();
    setOverview(data);
  }, [isAdmin]);

  const loadQueue = useCallback(async () => {
    if (!isAdmin) return;
    const res = await fetchAdminSubmissions(queueStatus, queueQuery);
    setSubmissions(res.items || []);
    if (res.stats) {
      setOverview((prev) => (prev ? { ...prev, workshop: res.stats! } : prev));
    }
  }, [isAdmin, queueQuery, queueStatus]);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    const res = await fetchAdminUsers(userQuery, userRoleFilter);
    setUsers(res.items || []);
    setUsersTotal(Number(res.total || (res.items || []).length));
    const drafts: Record<string, RoleChoice> = {};
    for (const u of res.items || []) {
      const r = (u.role || 'member').toLowerCase();
      drafts[u.id] = (['member', 'creator', 'official', 'admin', 'banned'].includes(r) ? r : 'member') as RoleChoice;
    }
    setRoleDrafts(drafts);
  }, [isAdmin, userQuery, userRoleFilter]);

  const loadAllMods = useCallback(async () => {
    if (!isAdmin) return;
    const res = await fetchAdminMods(modsQuery);
    setAllMods(res.items || []);
  }, [isAdmin, modsQuery]);

  const refreshActiveTab = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setNotice(null);
    try {
      await loadOverview();
      if (tab === 'queue') await loadQueue();
      else if (tab === 'users') await loadUsers();
      else if (tab === 'mods') await loadAllMods();
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, loadAllMods, loadOverview, loadQueue, loadUsers, tab]);

  useEffect(() => {
    if (isAdmin) {
      void refreshActiveTab();
    }
  }, [isAdmin, refreshActiveTab]);

  const handleReviewAction = async (
    modId: string,
    action: 'approve' | 'reject' | 'unpublish' | 'restore' | 'delete',
    versionId?: string,
  ) => {
    if (action === 'delete' && !versionId && confirmDeleteId !== modId) {
      setConfirmDeleteId(modId);
      return;
    }
    const key = `${modId}:${versionId || ''}:${action}`;
    setActionBusyKey(key);
    setNotice(null);
    try {
      const res = await submitAdminReview({
        id: modId,
        action,
        note: (noteDrafts[modId] || '').trim(),
        versionId,
      });
      setConfirmDeleteId(null);
      setNotice({
        kind: 'ok',
        text: res.deleted
          ? zh ? '已删除该投稿及其存储包体。' : 'Submission deleted.'
          : zh ? '审核操作已完成并写入审计日志。' : 'Review updated.',
      });
      await Promise.all([loadOverview(), loadQueue()]);
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActionBusyKey('');
    }
  };

  const handleSaveUserRole = async (u: AdminUserEntry) => {
    const nextRole = roleDrafts[u.id] || 'member';
    setActionBusyKey(`role:${u.id}`);
    setNotice(null);
    try {
      const res = await updateAdminUserRole(u.id, nextRole);
      setNotice({
        kind: 'ok',
        text: zh
          ? `已更新 UID #${u.uid} (${u.displayName || u.username}) 的身份为「${roleLabel(res.user.role, zh)}」。`
          : `Updated UID #${u.uid} role to ${res.user.role}.`,
      });
      await Promise.all([loadOverview(), loadUsers()]);
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActionBusyKey('');
    }
  };

  const handleInspectDownload = async (urlOrPath?: string | null, fallbackName?: string) => {
    if (!urlOrPath) return;
    try {
      await downloadWorkshopArchiveAuthenticated(urlOrPath, fallbackName || 'submission-package.zip');
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  };

  if (!platform.user) {
    return (
      <div className="mr-container mr-admin-page">
        <div className="mr-empty">
          <ShieldAlert size={30} />
          <h3>{zh ? '需要管理员身份登录' : 'Admin Sign-in Required'}</h3>
          <p>{zh ? '请先登录星枢官方或管理员平台账号以访问审核渠道与运营数据后台。' : 'Sign in with an official or admin account.'}</p>
          <button type="button" className="mr-btn-emerald" onClick={() => openPlatformAuthModal('login')}>
            {zh ? '立即登录' : 'Sign In'}
          </button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mr-container mr-admin-page">
        <div className="mr-empty">
          <ShieldAlert size={30} />
          <h3>{zh ? '暂无管理员权限' : 'Admin Permission Required'}</h3>
          <p>
            {zh
              ? `当前登录账号 UID #${platform.user.uid}（${roleLabel(platform.user.role, true)}）无权访问管理后台，仅 official / admin 角色可用。`
              : 'Your current account does not have admin permissions.'}
          </p>
          <Link to="/extensions/mods" className="mr-btn-outline">
            {zh ? '返回模组工坊' : 'Back to Workshop'}
          </Link>
        </div>
      </div>
    );
  }

  const pendingBadgeCount = overview?.workshop.pendingQueueTotal ?? 0;

  return (
    <div className="mr-container mr-admin-page">
      <header className="mr-admin-hero">
        <div>
          <span className="mr-admin-eyebrow">
            <ShieldCheck size={14} />
            <span>{zh ? 'XINGSHU ADMIN CONSOLE · 管理员后台' : 'XINGSHU ADMIN CONSOLE'}</span>
          </span>
          <h1>{zh ? '星枢工坊审核与平台控制台' : 'Workshop Moderation & Admin Console'}</h1>
          <p>
            {zh
              ? `当前操作管理员：UID #${platform.user.uid} · ${platform.user.displayName || platform.user.username} (${roleLabel(platform.user.role, zh)})`
              : `Signed in as UID #${platform.user.uid} (${platform.user.role})`}
          </p>
        </div>
        <div className="mr-admin-hero-actions">
          <Link to="/extensions/creator" className="mr-btn-outline">
            <span>{zh ? '创作者投稿页' : 'Creator Page'}</span>
          </Link>
          <button
            type="button"
            className="mr-btn-emerald"
            disabled={loading}
            onClick={() => void refreshActiveTab()}
          >
            <RefreshCw size={14} />
            <span>{loading ? (zh ? '刷新中…' : 'Refreshing…') : zh ? '刷新实时数据' : 'Refresh'}</span>
          </button>
        </div>
      </header>

      <nav className="mr-detail-tabs" role="tablist" aria-label={zh ? '管理员功能模块' : 'Admin sections'}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          className={`mr-detail-tab ${tab === 'overview' ? 'is-active' : ''}`}
          onClick={() => setTab('overview')}
        >
          <Activity size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          <span>{zh ? '数据总览' : 'Overview'}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'queue'}
          className={`mr-detail-tab ${tab === 'queue' ? 'is-active' : ''}`}
          onClick={() => setTab('queue')}
        >
          <Clock size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          <span>{zh ? '审核渠道' : 'Review Queue'}</span>
          {pendingBadgeCount > 0 && (
            <span className="mr-tab-badge mr-tabular">{pendingBadgeCount}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'users'}
          className={`mr-detail-tab ${tab === 'users' ? 'is-active' : ''}`}
          onClick={() => setTab('users')}
        >
          <Users size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          <span>{zh ? `注册用户 (${overview?.platform.totalUsers ?? usersTotal})` : 'Users'}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'mods'}
          className={`mr-detail-tab ${tab === 'mods' ? 'is-active' : ''}`}
          onClick={() => setTab('mods')}
        >
          <Package size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          <span>{zh ? '全站模组' : 'All Mods'}</span>
        </button>
      </nav>

      {notice && (
        <div className={`mr-feedback-banner ${notice.kind === 'err' ? 'is-err' : 'is-ok'}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Close">
            <XCircle size={14} />
          </button>
        </div>
      )}

      {tab === 'overview' && overview && (
        <div className="mr-admin-stack">
          <div className="mr-admin-kpi-grid">
            <article className="mr-admin-kpi-card">
              <span className="mr-admin-kpi-label">{zh ? '星枢平台注册人数' : 'Platform Users'}</span>
              <strong className="mr-admin-kpi-value mr-tabular">{overview.platform.totalUsers}</strong>
              <span className="mr-admin-kpi-sub mr-tabular">
                {zh
                  ? `24 小时新增 ${overview.platform.todayUsers} · 活跃会话 ${overview.platform.activeSessions}`
                  : `Today +${overview.platform.todayUsers} · Sessions ${overview.platform.activeSessions}`}
              </span>
            </article>

            <article className="mr-admin-kpi-card">
              <span className="mr-admin-kpi-label">{zh ? '游戏授权 / 渠道绑定账号' : 'Authorized Game Accounts'}</span>
              <strong className="mr-admin-kpi-value mr-tabular">{overview.gameAuth.authorizedAccounts}</strong>
              <span className="mr-admin-kpi-sub mr-tabular">
                {zh
                  ? `渠道绑定 ${overview.gameAuth.channelBindings} · 对局存档 ${overview.gameAuth.archivedMatches}`
                  : `Bindings ${overview.gameAuth.channelBindings} · Matches ${overview.gameAuth.archivedMatches}`}
              </span>
            </article>

            <article className="mr-admin-kpi-card is-highlight">
              <span className="mr-admin-kpi-label">{zh ? '审核渠道待办' : 'Pending Review Queue'}</span>
              <strong className="mr-admin-kpi-value mr-tabular">{overview.workshop.pendingQueueTotal}</strong>
              <span className="mr-admin-kpi-sub mr-tabular">
                {zh
                  ? `待审新项目 ${overview.workshop.pendingCount} · 待审新版本 ${overview.workshop.pendingVersionUpdates}`
                  : `Projects ${overview.workshop.pendingCount} · Versions ${overview.workshop.pendingVersionUpdates}`}
              </span>
            </article>

            <article className="mr-admin-kpi-card">
              <span className="mr-admin-kpi-label">{zh ? '工坊模组与总下载' : 'Workshop Catalog'}</span>
              <strong className="mr-admin-kpi-value mr-tabular">
                {overview.workshop.totalSeed + overview.workshop.approvedCount}
              </strong>
              <span className="mr-admin-kpi-sub mr-tabular">
                {zh
                  ? `官方种子 ${overview.workshop.totalSeed} · 累计下载 ${overview.workshop.totalDownloads}`
                  : `Official ${overview.workshop.totalSeed} · Downloads ${overview.workshop.totalDownloads}`}
              </span>
            </article>
          </div>

          <section className="mr-admin-card">
            <div className="mr-admin-card-head">
              <div>
                <h2>{zh ? '平台账号角色分布' : 'Account Role Distribution'}</h2>
                <p>{zh ? '实时统计全站注册用户的权限分布与社区互动概况。' : 'Real-time role & engagement summary.'}</p>
              </div>
              <button type="button" className="mr-btn-outline" onClick={() => setTab('users')}>
                <span>{zh ? '查看全部用户明细 →' : 'Manage Users →'}</span>
              </button>
            </div>
            <div className="mr-admin-role-chips mr-tabular">
              <span className="mr-pill">普通用户：{overview.platform.roleCounts?.member ?? 0}</span>
              <span className="mr-pill is-versions">认证创作者：{overview.platform.roleCounts?.creator ?? 0}</span>
              <span className="mr-pill is-ok">官方：{overview.platform.roleCounts?.official ?? 0}</span>
              <span className="mr-pill is-ok">管理员：{overview.platform.roleCounts?.admin ?? 0}</span>
              <span className="mr-pill is-danger">已封禁：{overview.platform.roleCounts?.banned ?? 0}</span>
              <span className="mr-pill">平台绑定游戏账号：{overview.platform.totalGameBindings}</span>
              <span className="mr-pill">累计表情回应：{overview.platform.totalReactions}</span>
            </div>
          </section>

          <section className="mr-admin-card">
            <div className="mr-admin-card-head">
              <div>
                <h2>{zh ? '最近管理审计日志' : 'Recent Admin Audit Log'}</h2>
                <p>{zh ? '记录所有审核通过、驳回、下架、删除与用户角色变更操作。' : 'Audit trail of moderation & role actions.'}</p>
              </div>
            </div>
            {overview.auditLog.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--mr-text-muted)', fontSize: 13.5 }}>
                {zh ? '暂无管理操作记录；执行任意审核或角色修改后将在此实时显示。' : 'No audit actions logged yet.'}
              </p>
            ) : (
              <div className="mr-admin-table-wrap">
                <table className="mr-admin-table">
                  <thead>
                    <tr>
                      <th>{zh ? '时间' : 'Time'}</th>
                      <th>{zh ? '操作员' : 'Actor'}</th>
                      <th>{zh ? '动作' : 'Action'}</th>
                      <th>{zh ? '对象' : 'Target'}</th>
                      <th>{zh ? '备注' : 'Detail'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.auditLog.map((entry) => (
                      <tr key={entry.id}>
                        <td className="mr-tabular">{formatEpochOrIso(entry.at, zh)}</td>
                        <td>
                          {entry.actorName}
                          {entry.actorUid ? ` (#${entry.actorUid})` : ''}
                        </td>
                        <td>
                          <code>{entry.action}</code>
                        </td>
                        <td>{entry.targetName || entry.targetId}</td>
                        <td>{entry.detail || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'queue' && (
        <div className="mr-admin-stack">
          <div className="mr-admin-toolbar">
            <div className="mr-admin-filter-pills">
              {(
                [
                  { id: 'pending', label: zh ? '待审核队列' : 'Pending' },
                  { id: 'approved', label: zh ? '已通过' : 'Approved' },
                  { id: 'rejected', label: zh ? '已驳回' : 'Rejected' },
                  { id: 'unpublished', label: zh ? '已下架' : 'Unpublished' },
                  { id: 'all', label: zh ? '全部投稿' : 'All Submissions' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`mr-facet-btn ${queueStatus === opt.id ? 'is-active' : ''}`}
                  onClick={() => setQueueStatus(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="mr-admin-search-wrap">
              <Search size={14} />
              <input
                type="search"
                value={queueQuery}
                onChange={(e) => setQueueQuery(e.target.value)}
                placeholder={zh ? '搜索投稿名称 / 作者 / 编号…' : 'Search submissions…'}
              />
            </div>
          </div>

          {submissions.length === 0 ? (
            <div className="mr-empty">
              <CheckCircle2 size={28} />
              <h3>{zh ? '当前筛选下暂无投稿项目' : 'Queue is clear'}</h3>
              <p>{zh ? '所有社区待审项目与版本均已处理完毕，或可切换其他状态筛选查看历史记录。' : 'No matching submissions.'}</p>
            </div>
          ) : (
            <div className="mr-admin-queue-list">
              {submissions.map((sub) => {
                const st = statusPillMeta(sub.status, zh);
                const badge = modPlatformSummaryBadge(sub, zh);
                const cleanPlats = sanitizeWorkshopPlatforms(sub.platforms);
                const pendingVersions = (sub.versions || []).filter((v) => v.reviewStatus === 'pending');

                return (
                  <article key={sub.id} className="mr-admin-card mr-admin-queue-card">
                    <div className="mr-admin-queue-top">
                      <div>
                        <div className="mr-admin-queue-title">
                          <Link to={`/mod/${encodeURIComponent(sub.slug || sub.id)}`}>{sub.name}</Link>
                          <span className={`mr-pill ${st.cls}`}>{st.label}</span>
                          {badge && <span className="mr-pill is-versions">{badge}</span>}
                          {(sub.pendingVersionCount ?? 0) > 0 && (
                            <span className="mr-pill is-warn mr-tabular">
                              {zh ? `${sub.pendingVersionCount} 个待审版本` : `${sub.pendingVersionCount} pending ver`}
                            </span>
                          )}
                        </div>
                        <div className="mr-admin-queue-meta mr-tabular">
                          <span>ID: {sub.id}</span>
                          <span>
                            {zh ? '作者' : 'Author'}: {sub.author}
                            {sub.authorUid ? ` (UID #${sub.authorUid})` : ''}
                          </span>
                          <span>{sub.categoryLabel}</span>
                          <span>{installKindLabel(sub.installKind)}</span>
                          <span>v{sub.version}</span>
                          <span>{cleanPlats.join(', ') || 'STEAM_CN'}</span>
                          <span>{formatEpochOrIso(sub.submittedAt, zh)}</span>
                        </div>
                      </div>

                      <div className="mr-admin-queue-links">
                        <Link to={`/mod/${encodeURIComponent(sub.slug || sub.id)}`} className="mr-btn-outline">
                          <ExternalLink size={13} />
                          <span>{zh ? '查看详情' : 'Inspect'}</span>
                        </Link>
                        {sub.downloadable && sub.downloadUrl && (
                          sub.downloadUrl.startsWith('/api/') ? (
                            <button
                              type="button"
                              className="mr-btn-outline"
                              onClick={() => void handleInspectDownload(sub.downloadUrl, sub.packageFile || `${sub.slug || sub.id}.zip`)}
                            >
                              <Download size={13} />
                              <span>{zh ? '下载包体核验' : 'Download Pkg'}</span>
                            </button>
                          ) : (
                            <a href={sub.downloadUrl} target="_blank" rel="noreferrer" className="mr-btn-outline">
                              <ExternalLink size={13} />
                              <span>{zh ? '外链核验' : 'External Link'}</span>
                            </a>
                          )
                        )}
                      </div>
                    </div>

                    <p className="mr-admin-queue-desc">{sub.description}</p>
                    {sub.targetInfo && (
                      <div className="mr-admin-queue-target">
                        {zh ? '替换目标：' : 'Target: '}
                        <code>{sub.targetInfo}</code>
                        {sub.sha256 ? (
                          <>
                            {' · SHA-256: '}
                            <code>{sub.sha256.slice(0, 16)}…</code>
                          </>
                        ) : null}
                      </div>
                    )}

                    {pendingVersions.length > 0 && (
                      <div className="mr-admin-subver-list">
                        <strong>{zh ? '待审核新版本包体：' : 'Pending version uploads:'}</strong>
                        {pendingVersions.map((ver) => (
                          <div key={ver.id || ver.version} className="mr-admin-subver-row">
                            <span className="mr-tabular">
                              <strong>v{ver.version}</strong> · {ver.fileName} · {formatModBytes(ver.sizeBytes)} ·{' '}
                              {sanitizeWorkshopPlatforms(ver.platforms).join('/')}
                            </span>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {ver.downloadUrl && ver.downloadUrl.startsWith('/api/') && (
                                <button
                                  type="button"
                                  className="mr-btn-outline"
                                  style={{ padding: '4px 10px', fontSize: 12 }}
                                  onClick={() => void handleInspectDownload(ver.downloadUrl, ver.fileName)}
                                >
                                  <Download size={12} />
                                  <span>{zh ? '下载此包' : 'Download'}</span>
                                </button>
                              )}
                              {ver.id && (
                                <>
                                  <button
                                    type="button"
                                    className="mr-btn-emerald"
                                    style={{ padding: '4px 10px', fontSize: 12, minHeight: 0 }}
                                    disabled={Boolean(actionBusyKey)}
                                    onClick={() => void handleReviewAction(sub.id, 'approve', ver.id)}
                                  >
                                    {zh ? '通过此版本' : 'Approve Version'}
                                  </button>
                                  <button
                                    type="button"
                                    className="mr-btn-danger-sm"
                                    disabled={Boolean(actionBusyKey)}
                                    onClick={() => void handleReviewAction(sub.id, 'reject', ver.id)}
                                  >
                                    {zh ? '驳回此版本' : 'Reject Version'}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mr-admin-review-bar">
                      <input
                        type="text"
                        className="mr-inline-input"
                        value={noteDrafts[sub.id] ?? sub.reviewNote ?? ''}
                        onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [sub.id]: e.target.value }))}
                        placeholder={zh ? '审核意见 / 驳回原因（创作者可见）' : 'Review note (visible to creator)'}
                      />
                      <div className="mr-admin-review-btns">
                        {sub.status !== 'approved' && (
                          <button
                            type="button"
                            className="mr-btn-emerald"
                            disabled={Boolean(actionBusyKey)}
                            onClick={() =>
                              void handleReviewAction(sub.id, sub.status === 'unpublished' ? 'restore' : 'approve')
                            }
                          >
                            <CheckCircle2 size={14} />
                            <span>{sub.status === 'unpublished' ? (zh ? '恢复上架' : 'Restore') : zh ? '通过并公开' : 'Approve'}</span>
                          </button>
                        )}
                        {sub.status !== 'rejected' && (
                          <button
                            type="button"
                            className="mr-btn-danger-sm"
                            disabled={Boolean(actionBusyKey)}
                            onClick={() => void handleReviewAction(sub.id, 'reject')}
                          >
                            <XCircle size={14} />
                            <span>{zh ? '驳回' : 'Reject'}</span>
                          </button>
                        )}
                        {sub.status === 'approved' && (
                          <button
                            type="button"
                            className="mr-btn-outline"
                            disabled={Boolean(actionBusyKey)}
                            onClick={() => void handleReviewAction(sub.id, 'unpublish')}
                          >
                            <span>{zh ? '下架' : 'Unpublish'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="mr-btn-danger-sm"
                          disabled={Boolean(actionBusyKey)}
                          onClick={() => void handleReviewAction(sub.id, 'delete')}
                        >
                          <Trash2 size={13} />
                          <span>{confirmDeleteId === sub.id ? (zh ? '确认彻底删除' : 'Confirm Delete') : zh ? '删除' : 'Delete'}</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'users' && (
        <div className="mr-admin-stack">
          <div className="mr-admin-toolbar">
            <div className="mr-admin-filter-pills">
              {(
                [
                  { id: 'all', label: zh ? `全部角色 (${usersTotal})` : `All (${usersTotal})` },
                  { id: 'member', label: zh ? '普通用户' : 'Member' },
                  { id: 'creator', label: zh ? '认证创作者' : 'Creator' },
                  { id: 'official', label: zh ? '官方' : 'Official' },
                  { id: 'admin', label: zh ? '管理员' : 'Admin' },
                  { id: 'banned', label: zh ? '已封禁' : 'Banned' },
                ] as const
              ).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`mr-facet-btn ${userRoleFilter === r.id ? 'is-active' : ''}`}
                  onClick={() => setUserRoleFilter(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="mr-admin-search-wrap">
              <Search size={14} />
              <input
                type="search"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder={zh ? '搜索 UID / 用户名 / 昵称…' : 'Search users…'}
              />
            </div>
          </div>

          <div className="mr-admin-card">
            <div className="mr-admin-table-wrap">
              <table className="mr-admin-table">
                <thead>
                  <tr>
                    <th>UID</th>
                    <th>{zh ? '账号与昵称' : 'Account'}</th>
                    <th>{zh ? '邮箱' : 'Email'}</th>
                    <th>{zh ? '角色' : 'Role'}</th>
                    <th>{zh ? '绑定/投稿' : 'Stats'}</th>
                    <th>{zh ? '注册时间' : 'Joined'}</th>
                    <th>{zh ? '权限控制' : 'Role Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isUid1 = u.uid === 1;
                    const draft = roleDrafts[u.id] || 'member';
                    const changed = draft !== (u.role || 'member').toLowerCase();
                    return (
                      <tr key={u.id}>
                        <td className="mr-tabular">
                          <strong>#{u.uid}</strong>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <PlatformUserAvatar
                              name={u.displayName || u.username}
                              avatarUrl={u.avatarUrl}
                              avatarColor={u.avatarColor}
                              size={26}
                              fontSize={11}
                            />
                            <div>
                              <div style={{ fontWeight: 700, color: 'var(--mr-text)' }}>{u.displayName || u.username}</div>
                              <div style={{ fontSize: 12, color: 'var(--mr-text-muted)' }}>@{u.username}</div>
                            </div>
                          </div>
                        </td>
                        <td>{u.email || '—'}</td>
                        <td>
                          <span
                            className={`mr-pill ${
                              u.role === 'banned'
                                ? 'is-danger'
                                : isPlatformAdmin(u as never)
                                  ? 'is-ok'
                                  : u.role === 'creator'
                                    ? 'is-versions'
                                    : ''
                            }`}
                          >
                            {roleLabel(u.role, zh)}
                          </span>
                        </td>
                        <td className="mr-tabular">
                          {zh
                            ? `游戏 ${u.gameBindingsCount} · 投稿 ${u.submissionCount} · 会话 ${u.activeSessionCount}`
                            : `Games ${u.gameBindingsCount} · Mods ${u.submissionCount}`}
                        </td>
                        <td className="mr-tabular">{formatEpochOrIso(u.createdAt, zh)}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <select
                              className="mr-ver-select"
                              value={draft}
                              disabled={isUid1}
                              onChange={(e) =>
                                setRoleDrafts((prev) => ({ ...prev, [u.id]: e.target.value as RoleChoice }))
                              }
                            >
                              <option value="member">{zh ? '普通用户' : 'Member'}</option>
                              <option value="creator">{zh ? '认证创作者' : 'Creator'}</option>
                              <option value="official">{zh ? '官方' : 'Official'}</option>
                              <option value="admin">{zh ? '管理员' : 'Admin'}</option>
                              <option value="banned">{zh ? '封禁' : 'Banned'}</option>
                            </select>
                            {isUid1 ? (
                              <span style={{ fontSize: 11.5, color: 'var(--mr-text-muted)' }}>
                                {zh ? '创始账号受保护' : 'Protected'}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="mr-btn-emerald"
                                style={{ padding: '5px 10px', fontSize: 12, minHeight: 0 }}
                                disabled={!changed || actionBusyKey === `role:${u.id}`}
                                onClick={() => void handleSaveUserRole(u)}
                              >
                                {zh ? '保存' : 'Save'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'mods' && (
        <div className="mr-admin-stack">
          <div className="mr-admin-toolbar">
            <span style={{ fontSize: 13.5, color: 'var(--mr-text-secondary)' }}>
              {zh ? `全站共加载 ${allMods.length} 个模组条目（含官方模块与用户投稿）` : `${allMods.length} total catalog items`}
            </span>
            <div className="mr-admin-search-wrap">
              <Search size={14} />
              <input
                type="search"
                value={modsQuery}
                onChange={(e) => setModsQuery(e.target.value)}
                placeholder={zh ? '搜索模组 ID / 名称 / 作者…' : 'Search all mods…'}
              />
            </div>
          </div>

          <div className="mr-admin-card">
            <div className="mr-admin-table-wrap">
              <table className="mr-admin-table">
                <thead>
                  <tr>
                    <th>{zh ? '模组' : 'Mod'}</th>
                    <th>{zh ? '分类 / 格式' : 'Category'}</th>
                    <th>{zh ? '双端 / 渠道' : 'Platforms'}</th>
                    <th>{zh ? '状态' : 'Status'}</th>
                    <th>{zh ? '下载 / 表情' : 'Stats'}</th>
                    <th>{zh ? '操作' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {allMods.map((mod) => {
                    const st = statusPillMeta(mod.status, zh);
                    const badge = modPlatformSummaryBadge(mod, zh);
                    const cleanPlats = sanitizeWorkshopPlatforms(mod.platforms);
                    return (
                      <tr key={mod.id}>
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--mr-text)' }}>{mod.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--mr-text-muted)' }}>
                            {mod.author} · <code>{mod.id}</code>
                          </div>
                        </td>
                        <td>
                          <span>{mod.categoryLabel}</span>
                          <div style={{ fontSize: 12, color: 'var(--mr-text-muted)' }}>{installKindLabel(mod.installKind)}</div>
                        </td>
                        <td>
                          {badge && <span className="mr-pill is-versions">{badge}</span>}
                          <div style={{ fontSize: 11.5, color: 'var(--mr-text-muted)', marginTop: 4 }}>
                            {cleanPlats.join(', ') || 'STEAM_CN'}
                          </div>
                        </td>
                        <td>
                          <span className={`mr-pill ${st.cls}`}>{st.label}</span>
                        </td>
                        <td className="mr-tabular">
                          {mod.downloads ?? 0} ↓ / {mod.reactionTotal ?? 0} ★
                        </td>
                        <td>
                          <Link to={`/mod/${encodeURIComponent(mod.slug || mod.id)}`} className="mr-btn-outline">
                            {zh ? '打开项目' : 'Open'}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
