import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Calendar,
  Clock,
  Download,
  Images,
  LayoutGrid,
  LayoutList,
  Package,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SmilePlus,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmoteReactionBar } from '../../components/platform/EmoteReactionBar';
import { PlatformUserAvatar } from '../../components/platform/PlatformUserAvatar';
import { useTranslation } from '../../i18n';
import {
  fetchPublicAuthorProfile,
  usePlatformAccount,
  type PublicAuthorProfile,
} from '../../shared/platformAccountClient';
import {
  WORKSHOP_CATEGORIES,
  formatModBytes,
  installKindLabel,
  workshopAssetUrl,
  type WorkshopCategory,
  type WorkshopModItem,
} from '../../shared/workshopClient';
import { getCategoryVisualMeta, getLauncherModuleMeta } from '../launcher/launcherModMeta';
import './modrinth.css';

function modDetailPath(item: WorkshopModItem): string {
  return `/mod/${encodeURIComponent(item.slug || item.id)}`;
}

export const ModrinthAuthorPage: React.FC = () => {
  const { authorKey = '' } = useParams<{ authorKey: string }>();
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const navigate = useNavigate();
  const { user } = usePlatformAccount();

  const [author, setAuthor] = useState<PublicAuthorProfile | null>(null);
  const [items, setItems] = useState<WorkshopModItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<WorkshopCategory>('all');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({});

  const loadAuthor = useCallback(async () => {
    const key = decodeURIComponent(authorKey || '').trim();
    if (!key) {
      setError(zh ? '缺少创作者标识。' : 'Missing author identifier.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetchPublicAuthorProfile(key);
      setAuthor(res.author);
      setItems(res.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [authorKey, zh]);

  useEffect(() => {
    void loadAuthor();
  }, [loadAuthor]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!q) return true;
      return `${item.name} ${item.description} ${item.tags.join(' ')}`.toLowerCase().includes(q);
    });
  }, [category, items, query]);

  const isOwnProfile = Boolean(
    user &&
      author &&
      ((author.id && author.id === user.id) ||
        (author.isOfficial && ['official', 'admin'].includes((user.role || '').toLowerCase()))),
  );

  const handleCardClick = (e: React.MouseEvent<HTMLElement>, item: WorkshopModItem) => {
    const selection = typeof window !== 'undefined' ? window.getSelection()?.toString() : '';
    if (selection) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('a, button, input, select, textarea, [role="dialog"], .mr-emote-bar')) {
      return;
    }
    navigate(modDetailPath(item));
  };

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLElement>, item: WorkshopModItem) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(modDetailPath(item));
    }
  };

  const renderIconTile = (item: WorkshopModItem) => {
    const iconUrl = item.previewUrl ? workshopAssetUrl(item.previewUrl) : '';
    const iconBroken = failedIcons[item.id];
    const visual =
      item.id.startsWith('xingshu.launcher.')
        ? getLauncherModuleMeta(item.id)
        : getCategoryVisualMeta(item.category);
    const Icon = visual.Icon;

    if (iconUrl && !iconBroken) {
      return (
        <div className="mr-icon-tile mr-author-icon" style={{ borderColor: visual.accentBorder }}>
          <img
            src={iconUrl}
            alt={item.name}
            onError={() => setFailedIcons((prev) => ({ ...prev, [item.id]: true }))}
          />
        </div>
      );
    }

    return (
      <div
        className="mr-icon-tile mr-author-icon"
        style={{
          background: visual.accentBg,
          color: visual.accentFg,
          borderColor: visual.accentBorder,
        }}
      >
        <Icon size={22} />
      </div>
    );
  };

  return (
    <div className="mr-container mr-author-wrap">
      <div className="mr-detail-breadcrumb">
        <Link to="/dashboard">{zh ? '星枢工坊' : 'Workshop'}</Link>
        <span>/</span>
        <Link to="/extensions/mods">{zh ? '发现模组' : 'Discover Mods'}</Link>
        <span>/</span>
        <span>{author?.displayName || decodeURIComponent(authorKey || '')}</span>
      </div>

      {loading && (
        <div className="mr-empty">
          <RefreshCw size={24} className="spin" />
          <p>{zh ? '正在加载创作者主页…' : 'Loading creator profile…'}</p>
        </div>
      )}

      {!loading && error && (
        <div className="mr-empty">
          <Package size={28} />
          <h3>{zh ? '未能找到创作者主页' : 'Creator profile not found'}</h3>
          <p>{error}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link to="/extensions/mods" className="mr-btn-outline">
              <ArrowLeft size={14} />
              <span>{zh ? '返回模组列表' : 'Back to Mods'}</span>
            </Link>
            <button type="button" className="mr-btn-emerald" onClick={() => void loadAuthor()}>
              <RefreshCw size={14} />
              <span>{zh ? '重试' : 'Retry'}</span>
            </button>
          </div>
        </div>
      )}

      {!loading && !error && author && (
        <>
          <section className="mr-author-hero">
            <div className="mr-author-hero-left">
              <PlatformUserAvatar
                name={author.displayName}
                avatarUrl={author.avatarUrl}
                avatarColor={author.avatarColor}
                size={56}
                fontSize={22}
                style={{ boxShadow: '0 0 0 2px rgba(255,255,255,0.12)' }}
              />
              <div className="mr-author-hero-meta">
                <div className="mr-author-name-row">
                  <h1>{author.displayName}</h1>
                  {author.isOfficial && (
                    <span className="mr-official-badge">
                      <BadgeCheck size={13} />
                      <span>{zh ? '星枢官方认证' : 'Official Maintainer'}</span>
                    </span>
                  )}
                  {author.uid ? (
                    <span className="mr-uid-badge">UID #{author.uid}</span>
                  ) : null}
                </div>
                <div className="mr-author-subrow">
                  {author.username && <span>@{author.username}</span>}
                  {author.createdAt ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Calendar size={12} />
                      {zh ? '加入于 ' : 'Joined '}
                      {new Date(author.createdAt * 1000).toLocaleDateString()}
                    </span>
                  ) : null}
                  <span>{zh ? `${author.modCount} 个公开模组` : `${author.modCount} public mods`}</span>
                  <span>{zh ? `${author.totalDownloads} 次下载` : `${author.totalDownloads} downloads`}</span>
                  <span>{zh ? `${author.totalReactions} 次表情回应` : `${author.totalReactions} reactions`}</span>
                </div>
                {author.bio && <p className="mr-author-bio">{author.bio}</p>}
              </div>
            </div>

            <div className="mr-author-hero-actions">
              <Link to="/extensions/mods" className="mr-btn-outline">
                <ArrowLeft size={14} />
                <span>{zh ? '浏览全部模组' : 'Browse All Mods'}</span>
              </Link>
              {isOwnProfile && (
                <Link to="/account?tab=settings" className="mr-btn-emerald">
                  <Settings size={14} />
                  <span>{zh ? '编辑头像与资料' : 'Edit Profile & Avatar'}</span>
                </Link>
              )}
            </div>
          </section>

          <div className="mr-author-filter-bar">
            <div className="mr-author-tabs">
              {WORKSHOP_CATEGORIES.map((cat) => {
                const count =
                  cat.id === 'all' ? items.length : items.filter((item) => item.category === cat.id).length;
                if (cat.id !== 'all' && count === 0) return null;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={`mr-author-tab ${category === cat.id ? 'is-active' : ''}`}
                    onClick={() => setCategory(cat.id)}
                  >
                    <span>{zh ? cat.labelZh : cat.labelEn}</span>
                    <small>{count}</small>
                  </button>
                );
              })}
            </div>

            <div className="mr-author-toolbar-right">
              <div className="mr-author-search">
                <Search size={14} color="var(--mr-text-muted)" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={zh ? '筛选TA发布的模组…' : 'Filter mods…'}
                />
              </div>
              <div className="mr-view-switch" role="group" aria-label={zh ? '切换视图' : 'Switch view'}>
                <button
                  type="button"
                  className={viewMode === 'list' ? 'is-active' : ''}
                  onClick={() => setViewMode('list')}
                  title={zh ? '紧凑列表视图' : 'Compact List'}
                >
                  <LayoutList size={15} />
                </button>
                <button
                  type="button"
                  className={viewMode === 'grid' ? 'is-active' : ''}
                  onClick={() => setViewMode('grid')}
                  title={zh ? '双列网格视图' : 'Grid View'}
                >
                  <LayoutGrid size={15} />
                </button>
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="mr-empty">
              <Package size={26} />
              <p>{zh ? '该分类下暂无公开模组。' : 'No public mods in this category.'}</p>
            </div>
          ) : (
            <div className={`mr-project-list mr-author-list ${viewMode === 'grid' ? 'is-grid' : ''}`}>
              {filtered.map((item) => {
                const versionLabel = `v${item.version || item.gameVersion || '1.0.0'}`;
                return (
                  <article
                    key={item.id}
                    className="mr-project-card is-clickable"
                    tabIndex={0}
                    onClick={(e) => handleCardClick(e, item)}
                    onKeyDown={(e) => handleCardKeyDown(e, item)}
                  >
                    <Link to={modDetailPath(item)} style={{ textDecoration: 'none', flexShrink: 0 }}>
                      {renderIconTile(item)}
                    </Link>
                    <div className="mr-project-body">
                      <div className="mr-project-title-row">
                        <h3>
                          <Link to={modDetailPath(item)} style={{ color: 'inherit', textDecoration: 'none' }}>
                            {item.name}
                          </Link>
                        </h3>
                        <span className={`mr-kind-badge ${item.installKind === 'xspkg' ? 'is-xspkg' : ''}`}>
                          {installKindLabel(item.installKind)}
                        </span>
                      </div>
                      <p className="mr-project-desc">{item.description}</p>
                      <div className="mr-project-pills">
                        <span className="mr-pill">{item.categoryLabel}</span>
                        {(item.versionCount ?? 0) > 1 && (
                          <span className="mr-pill is-versions mr-tabular">
                            {zh ? `${item.versionCount} 个版本` : `${item.versionCount} versions`}
                            {item.platformLabels?.length ? ` · ${item.platformLabels.slice(0, 2).join(' / ')}` : ''}
                          </span>
                        )}
                        {item.tags.slice(0, 3).map((t) => (
                          <span key={t} className="mr-pill">
                            {t}
                          </span>
                        ))}
                        <span className="mr-pill">{versionLabel}</span>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <EmoteReactionBar
                          modId={item.id}
                          reactions={item.reactions}
                          reactionTotal={item.reactionTotal}
                          mode="card"
                          onUpdated={(next) =>
                            setItems((prev) =>
                              prev.map((row) =>
                                row.id === item.id
                                  ? { ...row, reactions: next.reactions, reactionTotal: next.reactionTotal }
                                  : row,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                    <div className="mr-project-aside">
                      <div className="mr-project-metrics">
                        <span title={zh ? '下载次数' : 'Downloads'}>
                          <Download size={13} />
                          {item.downloads ?? 0}
                        </span>
                        <span title={zh ? '表情回应数' : 'Sticker reactions'}>
                          <SmilePlus size={13} />
                          {item.reactionTotal ?? 0}
                        </span>
                        {(item.galleryCount ?? 0) > 0 && (
                          <span title={zh ? '展示图数量' : 'Gallery images'}>
                            <Images size={13} />
                            {item.galleryCount}
                          </span>
                        )}
                      </div>
                      <div className="mr-project-submetrics">
                        {item.sizeBytes > 0 && <span>{formatModBytes(item.sizeBytes)}</span>}
                        {item.sha256 && (
                          <span title={`SHA-256: ${item.sha256}`}>
                            <ShieldCheck size={12} color="var(--mr-accent)" />
                          </span>
                        )}
                        <span>
                          <Clock size={12} />
                          {versionLabel}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};
