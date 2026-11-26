import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Flag,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { RichGameName } from '../../components/common/RichGameName';
import { PlatformUserAvatar } from '../../components/platform/PlatformUserAvatar';
import { useTranslation } from '../../i18n';
import {
  createAdminCreditAdjustment,
  downloadWorkshopArchiveAuthenticated,
  fetchAdminCreditPlayer,
  fetchAdminCreditReports,
  fetchAdminMods,
  fetchAdminOverview,
  fetchAdminSubmissions,
  fetchAdminUsers,
  isPlatformAdmin,
  openPlatformAuthModal,
  reviewAdminCreditReport,
  revokeAdminCreditAdjustment,
  submitAdminReview,
  updateAdminUserRole,
  usePlatformAccount,
  type AdminCreditPlayerDetail,
  type AdminCreditReportItem,
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

type AdminTab = 'overview' | 'queue' | 'credit' | 'users' | 'mods';
type RoleChoice = 'member' | 'creator' | 'official' | 'admin' | 'banned';

const VALID_ADMIN_TABS: readonly AdminTab[] = ['overview', 'queue', 'credit', 'users', 'mods'];

function creditTierPillClass(tier?: string): string {
  switch ((tier || '').toLowerCase()) {
    case 'excellent':
    case 'good':
      return 'is-ok';
    case 'fair':
      return 'is-versions';
    case 'warning':
      return 'is-warn';
    case 'danger':
      return 'is-danger';
    default:
      return 'is-muted';
  }
}

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

  const [creditReports, setCreditReports] = useState<AdminCreditReportItem[]>([]);
  const [creditStatus, setCreditStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [creditQuery, setCreditQuery] = useState('');
  const [creditNoteDrafts, setCreditNoteDrafts] = useState<Record<string, string>>({});
  const [creditDeltaDrafts, setCreditDeltaDrafts] = useState<Record<string, number>>({});
  const [creditBadgeDrafts, setCreditBadgeDrafts] = useState<Record<string, string>>({});
  const [creditBanDrafts, setCreditBanDrafts] = useState<Record<string, boolean>>({});
  const [creditLookupUid, setCreditLookupUid] = useState('');
  const [creditPlayerDetail, setCreditPlayerDetail] = useState<AdminCreditPlayerDetail | null>(null);
  const [manualDelta, setManualDelta] = useState<number>(-10);
  const [manualBadge, setManualBadge] = useState('');
  const [manualFleetBan, setManualFleetBan] = useState(false);
  const [manualReason, setManualReason] = useState('');

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

  const loadCreditReports = useCallback(async () => {
    if (!isAdmin) return;
    const res = await fetchAdminCreditReports(creditStatus, creditQuery);
    setCreditReports(res.items || []);
    if (res.stats) {
      setOverview((prev) => (prev ? { ...prev, credit: { ...prev.credit, ...res.stats! } } : prev));
    }
  }, [creditQuery, creditStatus, isAdmin]);

  const refreshActiveTab = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setNotice(null);
    try {
      await loadOverview();
      if (tab === 'queue') await loadQueue();
      else if (tab === 'credit') await loadCreditReports();
      else if (tab === 'users') await loadUsers();
      else if (tab === 'mods') await loadAllMods();
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, loadAllMods, loadCreditReports, loadOverview, loadQueue, loadUsers, tab]);

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

  const handleCreditLookup = async (uidOverride?: string) => {
    const uid = (uidOverride ?? creditLookupUid).trim();
    if (!/^\d{1,20}$/.test(uid)) {
      setNotice({ kind: 'err', text: zh ? '请输入纯数字游戏 UID' : 'Enter numeric game UID' });
      return;
    }
    setActionBusyKey(`credit:lookup:${uid}`);
    setNotice(null);
    try {
      setCreditLookupUid(uid);
      const detail = await fetchAdminCreditPlayer(uid);
      setCreditPlayerDetail(detail);
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActionBusyKey('');
    }
  };

  const handleCreditReportReview = async (rep: AdminCreditReportItem, action: 'approve' | 'reject') => {
    setActionBusyKey(`credit:${rep.id}:${action}`);
    setNotice(null);
    try {
      const res = await reviewAdminCreditReport(rep.id, {
        action,
        reviewNote: (creditNoteDrafts[rep.id] || '').trim(),
        scoreDelta: action === 'approve' ? (creditDeltaDrafts[rep.id] ?? -10) : 0,
        badge: action === 'approve' ? (creditBadgeDrafts[rep.id] || '').trim() : '',
        fleetBan: action === 'approve' ? Boolean(creditBanDrafts[rep.id]) : false,
      });
      setNotice({
        kind: 'ok',
        text: zh
          ? `已${action === 'approve' ? '采纳' : '驳回'}针对 UID ${res.report.targetUid} 的星枢反馈工单。`
          : `Report ${action}d.`,
      });
      await Promise.all([loadOverview(), loadCreditReports()]);
      if (creditPlayerDetail?.profile.uid === rep.targetUid) {
        const refreshed = await fetchAdminCreditPlayer(rep.targetUid);
        setCreditPlayerDetail(refreshed);
      }
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActionBusyKey('');
    }
  };

  const handleManualCreditAdjust = async () => {
    const uid = (creditPlayerDetail?.profile.uid || creditLookupUid).trim();
    if (!/^\d{1,20}$/.test(uid)) {
      setNotice({ kind: 'err', text: zh ? '请先查询或输入目标玩家数字 UID' : 'Target UID required' });
      return;
    }
    setActionBusyKey(`credit:adjust:${uid}`);
    setNotice(null);
    try {
      const detail = await createAdminCreditAdjustment({
        targetUid: uid,
        scoreDelta: manualDelta,
        badge: manualBadge.trim(),
        fleetBan: manualFleetBan,
        reason: manualReason.trim(),
      });
      setCreditPlayerDetail(detail);
      setManualReason('');
      setManualBadge('');
      setNotice({
        kind: 'ok',
        text: zh ? `已写入对 UID ${uid} 的星枢信誉裁定。` : `Adjustment saved for ${uid}.`,
      });
      await loadOverview();
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActionBusyKey('');
    }
  };

  const handleRevokeAdjustment = async (adjId: string) => {
    setActionBusyKey(`credit:revoke:${adjId}`);
    setNotice(null);
    try {
      const detail = await revokeAdminCreditAdjustment(adjId);
      setCreditPlayerDetail(detail);
      setNotice({
        kind: 'ok',
        text: zh ? `已撤销信誉裁定记录 ${adjId}。` : `Revoked adjustment ${adjId}.`,
      });
      await Promise.all([loadOverview(), loadCreditReports()]);
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActionBusyKey('');
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
  const creditPendingCount = overview?.credit?.pendingReports ?? 0;

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
          aria-selected={tab === 'credit'}
          className={`mr-detail-tab ${tab === 'credit' ? 'is-active' : ''}`}
          onClick={() => setTab('credit')}
        >
          <Flag size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          <span>{zh ? '信誉审核' : 'Credit Review'}</span>
          {creditPendingCount > 0 && (
            <span className="mr-tab-badge mr-tabular">{creditPendingCount}</span>
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

            {overview.credit && (
              <article className={`mr-admin-kpi-card ${overview.credit.pendingReports > 0 ? 'is-highlight' : ''}`}>
                <span className="mr-admin-kpi-label">{zh ? '星枢信誉与车队' : 'Credit & Fleets'}</span>
                <strong className="mr-admin-kpi-value mr-tabular">{overview.credit.pendingReports}</strong>
                <span className="mr-admin-kpi-sub mr-tabular">
                  {zh
                    ? `待审反馈 · 生效裁定 ${overview.credit.activeSanctions} · 在线车队 ${overview.credit.activeFleetRooms}`
                    : `Pending · Sanctions ${overview.credit.activeSanctions} · Fleets ${overview.credit.activeFleetRooms}`}
                </span>
              </article>
            )}
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
                        <td><RichGameName text={entry.targetName || entry.targetId} fallback={entry.targetId} /></td>
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

      {tab === 'credit' && (
        <div className="mr-admin-stack">
          <section className="mr-admin-card">
            <div className="mr-admin-card-head">
              <div>
                <h2>{zh ? '玩家信誉档案查询与手动裁定 / 申诉撤销' : 'UID Credit Lookup & Sanctions'}</h2>
                <p>{zh ? '输入任意游戏 UID 核查实时信誉分、拔线统计，或执行星枢社区扣分 / 加分 / 限制高信誉车队与撤销。' : 'Inspect UID credit and apply or revoke adjustments.'}</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="mr-admin-search-wrap">
                  <Search size={14} />
                  <input
                    type="search"
                    value={creditLookupUid}
                    onChange={(e) => setCreditLookupUid(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreditLookup();
                    }}
                    placeholder={zh ? '输入游戏数字 UID…' : 'Game UID…'}
                  />
                </div>
                <button
                  type="button"
                  className="mr-btn-emerald"
                  disabled={Boolean(actionBusyKey)}
                  onClick={() => void handleCreditLookup()}
                >
                  {zh ? '查询信誉档案' : 'Lookup UID'}
                </button>
              </div>
            </div>

            {creditPlayerDetail && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <strong style={{ fontSize: 15 }}>
                    <RichGameName
                      text={creditPlayerDetail.profile.nick}
                      fallback={creditPlayerDetail.profile.uid}
                    />{' '}
                    (UID {creditPlayerDetail.profile.uid})
                  </strong>
                  <span className={`mr-pill mr-tabular ${creditTierPillClass(creditPlayerDetail.profile.tier)}`}>
                    信誉 {creditPlayerDetail.profile.score} · {creditPlayerDetail.profile.tierLabel}
                  </span>
                  <span className="mr-pill mr-tabular">
                    已录 {creditPlayerDetail.profile.recordedMatches} 局 · 拔线 {creditPlayerDetail.profile.giveUpCount} ({creditPlayerDetail.profile.giveUpRate}%)
                  </span>
                  <span className="mr-pill mr-tabular">
                    点赞 {creditPlayerDetail.profile.likesCount} · 社区避雷 {creditPlayerDetail.profile.blacklistCount}
                  </span>
                  {creditPlayerDetail.profile.tags.map((tag) => (
                    <span key={tag} className="mr-pill is-versions">{tag}</span>
                  ))}
                </div>

                <div className="mr-admin-review-bar">
                  <select
                    className="mr-inline-input"
                    style={{ flex: '0 0 auto', minWidth: 140 }}
                    value={manualDelta}
                    onChange={(e) => setManualDelta(Number(e.target.value))}
                  >
                    <option value={-20}>分值 -20（严重违规）</option>
                    <option value={-10}>分值 -10（中等违规）</option>
                    <option value={-5}>分值 -5（轻度警示）</option>
                    <option value={0}>分值 0（仅打标/限车）</option>
                    <option value={5}>分值 +5（申诉补偿）</option>
                    <option value={10}>分值 +10（表现嘉奖）</option>
                  </select>
                  <input
                    type="text"
                    className="mr-inline-input"
                    style={{ maxWidth: 180 }}
                    value={manualBadge}
                    onChange={(e) => setManualBadge(e.target.value)}
                    placeholder={zh ? '标签（如：恶意挂机）' : 'Optional badge'}
                  />
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={manualFleetBan}
                      onChange={(e) => setManualFleetBan(e.target.checked)}
                    />
                    <span>{zh ? '限制高信誉车队' : 'Fleet Ban'}</span>
                  </label>
                  <input
                    type="text"
                    className="mr-inline-input"
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                    placeholder={zh ? '裁定原因 / 备注说明…' : 'Adjustment reason…'}
                  />
                  <button
                    type="button"
                    className="mr-btn-emerald"
                    disabled={Boolean(actionBusyKey)}
                    onClick={() => void handleManualCreditAdjust()}
                  >
                    {zh ? '写入裁定' : 'Apply'}
                  </button>
                </div>

                {creditPlayerDetail.adjustments.length > 0 && (
                  <div className="mr-admin-table-wrap">
                    <table className="mr-admin-table">
                      <thead>
                        <tr>
                          <th>{zh ? '时间' : 'Time'}</th>
                          <th>{zh ? '分值' : 'Delta'}</th>
                          <th>{zh ? '标签 / 限车' : 'Badge / Ban'}</th>
                          <th>{zh ? '原因' : 'Reason'}</th>
                          <th>{zh ? '操作员' : 'Actor'}</th>
                          <th>{zh ? '状态 / 操作' : 'Status'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {creditPlayerDetail.adjustments.map((adj) => (
                          <tr key={adj.id}>
                            <td className="mr-tabular">{formatEpochOrIso(adj.created, zh)}</td>
                            <td className="mr-tabular">{adj.scoreDelta >= 0 ? `+${adj.scoreDelta}` : adj.scoreDelta}</td>
                            <td>
                              {adj.badge ? <span className="mr-pill is-warn">{adj.badge}</span> : '—'}
                              {adj.fleetBan && <span className="mr-pill is-danger" style={{ marginLeft: 4 }}>限制车队</span>}
                            </td>
                            <td>{adj.reason || '—'}</td>
                            <td>{adj.actor}</td>
                            <td>
                              {adj.active ? (
                                <button
                                  type="button"
                                  className="mr-btn-outline"
                                  style={{ padding: '4px 10px', fontSize: 12 }}
                                  disabled={Boolean(actionBusyKey)}
                                  onClick={() => void handleRevokeAdjustment(adj.id)}
                                >
                                  <RotateCcw size={12} />
                                  <span>{zh ? '撤销裁定' : 'Revoke'}</span>
                                </button>
                              ) : (
                                <span className="mr-pill is-muted">{zh ? '已撤销' : 'Revoked'}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="mr-admin-toolbar">
            <div className="mr-admin-filter-pills">
              {(
                [
                  { id: 'pending', label: zh ? '待审核工单' : 'Pending' },
                  { id: 'approved', label: zh ? '已采纳' : 'Approved' },
                  { id: 'rejected', label: zh ? '已驳回' : 'Rejected' },
                  { id: 'all', label: zh ? '全部反馈' : 'All Reports' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`mr-facet-btn ${creditStatus === opt.id ? 'is-active' : ''}`}
                  onClick={() => setCreditStatus(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="mr-admin-search-wrap">
              <Search size={14} />
              <input
                type="search"
                value={creditQuery}
                onChange={(e) => setCreditQuery(e.target.value)}
                placeholder={zh ? '搜索 UID / 昵称 / 录像编号 / 描述…' : 'Search reports…'}
              />
            </div>
          </div>

          {creditReports.length === 0 ? (
            <div className="mr-empty">
              <CheckCircle2 size={28} />
              <h3>{zh ? '当前筛选下暂无星枢反馈工单' : 'No matching credit reports'}</h3>
              <p>{zh ? '玩家从星枢 Mod 提交的局内/结算反馈工单会集中显示在此处，由管理员审核是否扣分或限制进高信誉车队。' : 'All reports cleared.'}</p>
            </div>
          ) : (
            <div className="mr-admin-queue-list">
              {creditReports.map((rep) => {
                const tp = rep.targetProfile;
                const penaltyVal = creditDeltaDrafts[rep.id] ?? -10;
                const badgeVal = creditBadgeDrafts[rep.id] ?? '';
                const banVal = Boolean(creditBanDrafts[rep.id]);
                const stPill =
                  rep.status === 'approved'
                    ? { cls: 'is-ok', label: zh ? '已采纳' : 'Approved' }
                    : rep.status === 'rejected'
                      ? { cls: 'is-danger', label: zh ? '已驳回' : 'Rejected' }
                      : { cls: 'is-warn', label: zh ? '待审核' : 'Pending' };

                return (
                  <article key={rep.id} className="mr-admin-card mr-admin-queue-card">
                    <div className="mr-admin-queue-top">
                      <div>
                        <div className="mr-admin-queue-title">
                          <span style={{ fontWeight: 700, fontSize: 15.5 }}>
                            <RichGameName text={rep.targetNick} fallback={rep.targetUid} /> (UID {rep.targetUid})
                          </span>
                          <span className={`mr-pill ${stPill.cls}`}>{stPill.label}</span>
                          <span className="mr-pill is-versions">{rep.reasonLabel}</span>
                          {tp && (
                            <span className={`mr-pill mr-tabular ${creditTierPillClass(tp.tier)}`}>
                              当前信誉 {tp.score} · 拔线率 {tp.giveUpRate}% ({tp.recordedMatches}局)
                            </span>
                          )}
                        </div>
                        <div className="mr-admin-queue-meta mr-tabular">
                          <span>工单号: {rep.id}</span>
                          <span>
                            反馈人: <RichGameName text={rep.reporterNick} fallback={rep.reporterUid} /> (UID {rep.reporterUid})
                          </span>
                          {rep.roomId && <span>房间号: {rep.roomId}</span>}
                          <span>提交时间: {formatEpochOrIso(rep.created, zh)}</span>
                        </div>
                      </div>

                      <div className="mr-admin-queue-links">
                        <button
                          type="button"
                          className="mr-btn-outline"
                          onClick={() => void handleCreditLookup(rep.targetUid)}
                        >
                          <Search size={13} />
                          <span>{zh ? '查此 UID 档案' : 'Inspect UID'}</span>
                        </button>
                        {rep.replayId && (
                          <Link to={`/replay?id=${encodeURIComponent(rep.replayId)}`} className="mr-btn-outline">
                            <ExternalLink size={13} />
                            <span>{zh ? `核验录像 ${rep.replayId}` : `Replay ${rep.replayId}`}</span>
                          </Link>
                        )}
                      </div>
                    </div>

                    <p className="mr-admin-queue-desc">{rep.detail || (zh ? '（未填写额外文字描述）' : '(No description)')}</p>

                    {rep.status === 'pending' ? (
                      <div className="mr-admin-review-bar">
                        <select
                          className="mr-inline-input"
                          style={{ flex: '0 0 auto', minWidth: 130 }}
                          value={penaltyVal}
                          onChange={(e) =>
                            setCreditDeltaDrafts((prev) => ({ ...prev, [rep.id]: Number(e.target.value) }))
                          }
                        >
                          <option value={0}>仅记录 (0 分)</option>
                          <option value={-5}>轻度警示 (-5 分)</option>
                          <option value={-10}>核实违规 (-10 分)</option>
                          <option value={-20}>严重违规 (-20 分)</option>
                          <option value={-30}>恶意破坏 (-30 分)</option>
                        </select>
                        <input
                          type="text"
                          className="mr-inline-input"
                          style={{ maxWidth: 150 }}
                          value={badgeVal}
                          onChange={(e) =>
                            setCreditBadgeDrafts((prev) => ({ ...prev, [rep.id]: e.target.value }))
                          }
                          placeholder={zh ? '标签（可选）' : 'Badge'}
                        />
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={banVal}
                            onChange={(e) =>
                              setCreditBanDrafts((prev) => ({ ...prev, [rep.id]: e.target.checked }))
                            }
                          />
                          <span>{zh ? '限制高信誉车队' : 'Fleet Ban'}</span>
                        </label>
                        <input
                          type="text"
                          className="mr-inline-input"
                          value={creditNoteDrafts[rep.id] ?? ''}
                          onChange={(e) =>
                            setCreditNoteDrafts((prev) => ({ ...prev, [rep.id]: e.target.value }))
                          }
                          placeholder={zh ? '审核说明 / 核实结论…' : 'Review note…'}
                        />
                        <div className="mr-admin-review-btns">
                          <button
                            type="button"
                            className="mr-btn-emerald"
                            disabled={Boolean(actionBusyKey)}
                            onClick={() => void handleCreditReportReview(rep, 'approve')}
                          >
                            <CheckCircle2 size={14} />
                            <span>{zh ? '采纳并处理' : 'Approve'}</span>
                          </button>
                          <button
                            type="button"
                            className="mr-btn-danger-sm"
                            disabled={Boolean(actionBusyKey)}
                            onClick={() => void handleCreditReportReview(rep, 'reject')}
                          >
                            <XCircle size={14} />
                            <span>{zh ? '驳回' : 'Reject'}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mr-admin-queue-target">
                        {zh ? '审核结果：' : 'Outcome: '}
                        <strong>{rep.reviewer}</strong> · 分值 {rep.scoreDelta >= 0 ? `+${rep.scoreDelta}` : rep.scoreDelta}
                        {rep.badge ? ` · 标签「${rep.badge}」` : ''}
                        {rep.fleetBan ? ' · 限制车队' : ''}
                        {rep.reviewNote ? ` · 说明：${rep.reviewNote}` : ''}
                        {rep.adjustmentId && (
                          <button
                            type="button"
                            className="mr-btn-outline"
                            style={{ marginLeft: 10, padding: '2px 8px', fontSize: 12 }}
                            disabled={Boolean(actionBusyKey)}
                            onClick={() => void handleRevokeAdjustment(rep.adjustmentId)}
                          >
                            <RotateCcw size={11} />
                            <span>{zh ? '撤销处罚' : 'Revoke'}</span>
                          </button>
                        )}
                      </div>
                    )}
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
