import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Images,
  Info,
  LayoutGrid,
  List,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  SmilePlus,
  X,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EmoteReactionBar } from '../../components/platform/EmoteReactionBar';
import { PlatformUserAvatar } from '../../components/platform/PlatformUserAvatar';
import { useTranslation } from '../../i18n';
import {
  WORKSHOP_CATEGORIES,
  WORKSHOP_CHANNEL_FILTER_OPTIONS,
  compareModsByHeat,
  fetchWorkshopMods,
  formatModBytes,
  installKindLabel,
  modPlatformSummaryBadge,
  modSupportsChannelFilter,
  workshopAssetUrl,
  type WorkshopCategory,
  type WorkshopModItem,
} from '../../shared/workshopClient';
import { OFFICIAL_SUB_GROUPS, getCategoryVisualMeta, getLauncherModuleMeta } from '../launcher/launcherModMeta';

type ViewMode = 'list' | 'grid';
type SortKey = 'popular' | 'downloads' | 'reactions' | 'newest' | 'updated';
type ModItemWithDates = WorkshopModItem & {
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
};

const PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 50, 100] as const;

const FORMAT_OPTIONS = [
  { id: 'all', labelZh: '全部格式', labelEn: 'All Formats' },
  { id: 'xspkg', labelZh: '.xspkg 扩展包', labelEn: '.xspkg Package' },
  { id: 'bundle_mod', labelZh: 'Bundle 替换', labelEn: 'Bundle Mod' },
  { id: 'external_archive', labelZh: '外部整包', labelEn: 'External Archive' },
];

function parseTimestampMs(value?: string | number | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    }
    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

function modCreatedMs(item: ModItemWithDates): number {
  return (
    parseTimestampMs(item.createdAt) ||
    parseTimestampMs(item.updatedAt) ||
    parseTimestampMs(item.submittedAt) ||
    parseTimestampMs(item.versions?.[item.versions.length - 1]?.publishedAt) ||
    0
  );
}

function modUpdatedMs(item: ModItemWithDates): number {
  return (
    parseTimestampMs(item.updatedAt) ||
    parseTimestampMs(item.versions?.[0]?.publishedAt) ||
    parseTimestampMs(item.submittedAt) ||
    parseTimestampMs(item.createdAt) ||
    0
  );
}

function formatShortDate(ms: number, zh: boolean): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString(zh ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '';
  }
}

type PaginationToken = number | 'ellipsis-left' | 'ellipsis-right';

function buildPaginationTokens(current: number, totalPages: number): PaginationToken[] {
  if (totalPages <= 1) return [1];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (current <= 3) {
    return [1, 2, 3, 4, 'ellipsis-right', totalPages];
  }
  if (current >= totalPages - 2) {
    return [1, 'ellipsis-left', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, 'ellipsis-left', current - 1, current, current + 1, 'ellipsis-right', totalPages];
}

interface DarkDropdownOption<T extends string | number> {
  value: T;
  label: string;
}

function DarkSelectDropdown<T extends string | number>({
  prefix,
  ariaLabel,
  value,
  options,
  open,
  onToggle,
  onClose,
  onChange,
}: {
  prefix: string;
  ariaLabel: string;
  value: T;
  options: readonly DarkDropdownOption<T>[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (next: T) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const currentOption = options.find((opt) => opt.value === value) ?? options[0];

  return (
    <div ref={wrapRef} className={`mr-custom-select ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className={`mr-select-trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={onToggle}
      >
        <span className="mr-select-prefix">{prefix}</span>
        <span className="mr-select-value">{currentOption?.label}</span>
        <ChevronDown size={14} className="mr-select-caret" />
      </button>

      {open && (
        <div className="mr-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                role="option"
                aria-selected={selected}
                className={`mr-select-option ${selected ? 'is-active' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  onClose();
                }}
              >
                <span>{opt.label}</span>
                {selected && <Check size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PaginationBar({
  page,
  totalPages,
  zh,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  zh: boolean;
  onPageChange: (nextPage: number) => void;
}) {
  const tokens = buildPaginationTokens(page, totalPages);
  return (
    <nav className="mr-pagination" aria-label={zh ? '分页导航' : 'Pagination'}>
      <button
        type="button"
        className="mr-page-btn mr-page-nav"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label={zh ? '上一页' : 'Previous page'}
      >
        <ChevronLeft size={15} />
      </button>

      {tokens.map((tok) =>
        typeof tok === 'number' ? (
          <button
            key={tok}
            type="button"
            className={`mr-page-btn ${tok === page ? 'is-active' : ''}`}
            aria-current={tok === page ? 'page' : undefined}
            onClick={() => onPageChange(tok)}
          >
            {tok}
          </button>
        ) : (
          <span key={tok} className="mr-page-ellipsis" aria-hidden="true">
            …
          </span>
        ),
      )}

      <button
        type="button"
        className="mr-page-btn mr-page-nav"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label={zh ? '下一页' : 'Next page'}
      >
        <ChevronRight size={15} />
      </button>
    </nav>
  );
}

export const ModrinthBrowsePage: React.FC = () => {
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const resultsTopRef = useRef<HTMLDivElement | null>(null);

  const initialCat = (searchParams.get('category') as WorkshopCategory) || 'all';
  const initialKind = searchParams.get('installKind') || 'all';
  const initialTag = searchParams.get('tag') || '';

  const [category, setCategory] = useState<WorkshopCategory>(
    WORKSHOP_CATEGORIES.some((c) => c.id === initialCat) ? initialCat : 'all',
  );
  const [installKind, setInstallKind] = useState<string>(initialKind);
  const [selectedTag, setSelectedTag] = useState<string>(initialTag);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [downloadableOnly, setDownloadableOnly] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortKey>('popular');
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [openDropdown, setOpenDropdown] = useState<'sort' | 'pageSize' | null>(null);

  const [items, setItems] = useState<WorkshopModItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [failedPreviews, setFailedPreviews] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const paramCat = (searchParams.get('category') as WorkshopCategory) || 'all';
    const paramKind = searchParams.get('installKind') || 'all';
    const paramTag = searchParams.get('tag') || '';
    if (WORKSHOP_CATEGORIES.some((c) => c.id === paramCat)) {
      setCategory(paramCat);
    }
    if (FORMAT_OPTIONS.some((f) => f.id === paramKind)) {
      setInstallKind(paramKind);
    }
    setSelectedTag(paramTag);
    setPage(1);
  }, [searchParams]);

  const loadMods = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetchWorkshopMods('all', '');
      setItems(resp.items || []);
      setCounts(resp.counts || {});
      setTotal(resp.total || (resp.items || []).length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMods();
  }, [loadMods]);

  const selectCategory = (next: WorkshopCategory) => {
    setCategory(next);
    setPage(1);
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'all') nextParams.delete('category');
    else nextParams.set('category', next);
    setSearchParams(nextParams, { replace: true });
  };

  const toggleTagFilter = (tag: string) => {
    const nextTag = selectedTag === tag ? '' : tag;
    setSelectedTag(nextTag);
    setPage(1);
    const nextParams = new URLSearchParams(searchParams);
    if (!nextTag) nextParams.delete('tag');
    else nextParams.set('tag', nextTag);
    setSearchParams(nextParams, { replace: true });
  };

  const resetAllFilters = () => {
    setCategory('all');
    setInstallKind('all');
    setSelectedTag('');
    setSelectedPlatform('all');
    setDownloadableOnly(false);
    setQuery('');
    setSortBy('popular');
    setPageSize(20);
    setPage(1);
    setOpenDropdown(null);
    setSearchParams({}, { replace: true });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = items.filter((item) => {
      if (category !== 'all' && item.category !== category && !item.secondaryCategories?.includes(category)) {
        return false;
      }
      if (installKind !== 'all' && item.installKind !== installKind) return false;
      if (selectedTag && !item.tags.includes(selectedTag)) return false;
      if (selectedPlatform !== 'all' && !modSupportsChannelFilter(item, selectedPlatform)) return false;
      if (downloadableOnly && !item.downloadable) return false;
      if (q) {
        const hay = `${item.name} ${item.author} ${item.description} ${item.id} ${item.targetInfo} ${item.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const loc = zh ? 'zh-CN' : 'en';
    if (sortBy === 'downloads') {
      return [...rows].sort(
        (a, b) =>
          (b.downloads || 0) - (a.downloads || 0) ||
          (b.reactionTotal || 0) - (a.reactionTotal || 0) ||
          a.name.localeCompare(b.name, loc),
      );
    }
    if (sortBy === 'reactions') {
      return [...rows].sort(
        (a, b) =>
          (b.reactionTotal || 0) - (a.reactionTotal || 0) ||
          (b.downloads || 0) - (a.downloads || 0) ||
          a.name.localeCompare(b.name, loc),
      );
    }
    if (sortBy === 'newest') {
      return [...rows].sort(
        (a, b) =>
          modCreatedMs(b as ModItemWithDates) - modCreatedMs(a as ModItemWithDates) ||
          compareModsByHeat(a, b, loc),
      );
    }
    if (sortBy === 'updated') {
      return [...rows].sort(
        (a, b) =>
          modUpdatedMs(b as ModItemWithDates) - modUpdatedMs(a as ModItemWithDates) ||
          compareModsByHeat(a, b, loc),
      );
    }
    return [...rows].sort((a, b) => compareModsByHeat(a, b, loc));
  }, [category, downloadableOnly, installKind, items, query, selectedPlatform, selectedTag, sortBy, zh]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [currentPage, filtered, pageSize]);

  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(filtered.length, currentPage * pageSize);

  const downloadableCount = useMemo(
    () => filtered.filter((item) => item.downloadable).length,
    [filtered],
  );

  const sortOptions: readonly DarkDropdownOption<SortKey>[] = useMemo(
    () => [
      { value: 'popular', label: zh ? '综合热度' : 'Relevance / Popular' },
      { value: 'downloads', label: zh ? '下载量' : 'Downloads' },
      { value: 'reactions', label: zh ? '表情回应' : 'Reactions' },
      { value: 'newest', label: zh ? '最新发布' : 'Newest' },
      { value: 'updated', label: zh ? '最近更新' : 'Recently Updated' },
    ],
    [zh],
  );

  const pageSizeOptions: readonly DarkDropdownOption<number>[] = useMemo(
    () => PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: String(n) })),
    [],
  );

  const modDetailPath = (item: WorkshopModItem) =>
    `/mod/${encodeURIComponent(item.slug || item.id)}`;

  const handlePageChange = (nextPage: number, scrollTop = false) => {
    const clamped = Math.min(Math.max(1, nextPage), totalPages);
    setPage(clamped);
    if (scrollTop) {
      resultsTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

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
    const previewSrc =
      item.previewUrl && !failedPreviews[item.id] ? workshopAssetUrl(item.previewUrl) : '';
    if (previewSrc) {
      return (
        <div className="mr-icon-tile">
          <img
            src={previewSrc}
            alt=""
            onError={() => setFailedPreviews((prev) => ({ ...prev, [item.id]: true }))}
          />
        </div>
      );
    }
    const isOfficial = item.id.startsWith('xingshu.launcher.');
    const visual = isOfficial ? getLauncherModuleMeta(item.id) : getCategoryVisualMeta(item.category);
    const Icon = visual.Icon;
    return (
      <div
        className="mr-icon-tile"
        style={{
          background: visual.accentBg,
          color: visual.accentFg,
          borderColor: visual.accentBorder,
        }}
        aria-hidden="true"
      >
        <Icon size={30} />
      </div>
    );
  };

  return (
    <div className="mr-container">
      <header className="mr-discover-header">
        <div>
          <h1>{zh ? '发现与下载模组' : 'Discover & Download Mods'}</h1>
          <p>
            {zh
              ? '点击任意模组卡片即可进入详情页查看功能介绍、版本、更新日志并下载 .xspkg 扩展包。'
              : 'Click any mod card to inspect documentation, versions, changelogs, and download verified .xspkg files.'}
          </p>
        </div>
        <button type="button" className="mr-btn-outline" onClick={() => void loadMods()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          <span>{zh ? '刷新目录' : 'Refresh'}</span>
        </button>
      </header>

      <div className="mr-discover-layout">
        <aside className="mr-facets" aria-label={zh ? '筛选条件' : 'Filters'}>
          <div className="mr-facet-group">
            <h2 className="mr-facet-title">{zh ? '模组分类' : 'Categories'}</h2>
            {WORKSHOP_CATEGORIES.map((cat) => {
              const cnt = cat.id === 'all' ? total : counts[cat.id] ?? 0;
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`mr-facet-btn ${category === cat.id ? 'is-active' : ''}`}
                  onClick={() => selectCategory(cat.id)}
                >
                  <span>{zh ? cat.labelZh : cat.labelEn}</span>
                  <span className="mr-facet-count">{cnt}</span>
                </button>
              );
            })}
          </div>

          <div className="mr-facet-group">
            <h2 className="mr-facet-title">{zh ? '功能标签' : 'Feature Tags'}</h2>
            {OFFICIAL_SUB_GROUPS.map((grp) => (
              <button
                key={grp.id}
                type="button"
                className={`mr-facet-btn ${selectedTag === grp.labelZh ? 'is-active' : ''}`}
                onClick={() => toggleTagFilter(grp.labelZh)}
              >
                <span>{zh ? grp.labelZh : grp.labelEn}</span>
              </button>
            ))}
          </div>

          <div className="mr-facet-group">
            <h2 className="mr-facet-title">{zh ? '包格式' : 'Package Format'}</h2>
            {FORMAT_OPTIONS.map((fmt) => (
              <button
                key={fmt.id}
                type="button"
                className={`mr-facet-btn ${installKind === fmt.id ? 'is-active' : ''}`}
                onClick={() => {
                  setInstallKind(fmt.id);
                  setPage(1);
                }}
              >
                <span>{zh ? fmt.labelZh : fmt.labelEn}</span>
              </button>
            ))}
          </div>

          <div className="mr-facet-group">
            <h2 className="mr-facet-title">{zh ? '适用渠道' : 'Channels'}</h2>
            <button
              type="button"
              className={`mr-facet-btn ${selectedPlatform === 'all' ? 'is-active' : ''}`}
              onClick={() => {
                setSelectedPlatform('all');
                setPage(1);
              }}
            >
              <span>{zh ? '全部渠道' : 'All Platforms'}</span>
            </button>
            {WORKSHOP_CHANNEL_FILTER_OPTIONS.map((plat) => (
              <button
                key={plat.id}
                type="button"
                className={`mr-facet-btn ${selectedPlatform === plat.id ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedPlatform((prev) => (prev === plat.id ? 'all' : plat.id));
                  setPage(1);
                }}
              >
                <span>{zh ? plat.labelZh : plat.labelEn}</span>
              </button>
            ))}
          </div>

          <label className="mr-facet-check">
            <input
              type="checkbox"
              checked={downloadableOnly}
              onChange={(e) => {
                setDownloadableOnly(e.target.checked);
                setPage(1);
              }}
            />
            <span>{zh ? '仅显示可直接下载' : 'Downloadable only'}</span>
          </label>

          <button type="button" className="mr-btn-outline" onClick={resetAllFilters}>
            {zh ? '重置筛选条件' : 'Reset Filters'}
          </button>
        </aside>

        <section ref={resultsTopRef} className="mr-results-col">
          <div className="mr-search-panel">
            <div className="mr-search-box is-full">
              <Search size={16} color="var(--mr-text-muted)" />
              <input
                type="text"
                aria-label={zh ? '搜索模组' : 'Search mods'}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={zh ? '搜索模组……' : 'Search mods…'}
              />
              {query && (
                <button
                  type="button"
                  className="mr-search-clear"
                  onClick={() => {
                    setQuery('');
                    setPage(1);
                  }}
                  aria-label={zh ? '清空搜索' : 'Clear search'}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="mr-toolbar-controls">
              <div className="mr-toolbar-left">
                <DarkSelectDropdown
                  prefix={zh ? '排序方式:' : 'Sort by:'}
                  ariaLabel={zh ? '排序方式' : 'Sort by'}
                  value={sortBy}
                  options={sortOptions}
                  open={openDropdown === 'sort'}
                  onToggle={() => setOpenDropdown((prev) => (prev === 'sort' ? null : 'sort'))}
                  onClose={() => setOpenDropdown((prev) => (prev === 'sort' ? null : prev))}
                  onChange={(next) => {
                    setSortBy(next);
                    setPage(1);
                  }}
                />

                <DarkSelectDropdown
                  prefix={zh ? '显示数量:' : 'Show:'}
                  ariaLabel={zh ? '显示数量' : 'Items per page'}
                  value={pageSize}
                  options={pageSizeOptions}
                  open={openDropdown === 'pageSize'}
                  onToggle={() => setOpenDropdown((prev) => (prev === 'pageSize' ? null : 'pageSize'))}
                  onClose={() => setOpenDropdown((prev) => (prev === 'pageSize' ? null : prev))}
                  onChange={(next) => {
                    setPageSize(next);
                    setPage(1);
                  }}
                />

                <div className="mr-view-toggle" role="group" aria-label={zh ? '视图切换' : 'View mode'}>
                  <button
                    type="button"
                    className={viewMode === 'list' ? 'is-active' : ''}
                    onClick={() => setViewMode('list')}
                    aria-label={zh ? '列表视图' : 'List view'}
                    title={zh ? '列表视图' : 'List view'}
                  >
                    <List size={16} />
                  </button>
                  <button
                    type="button"
                    className={viewMode === 'grid' ? 'is-active' : ''}
                    onClick={() => setViewMode('grid')}
                    aria-label={zh ? '网格视图' : 'Grid view'}
                    title={zh ? '网格视图' : 'Grid view'}
                  >
                    <LayoutGrid size={16} />
                  </button>
                </div>
              </div>

              {filtered.length > 0 && (
                <div className="mr-toolbar-right">
                  <PaginationBar
                    page={currentPage}
                    totalPages={totalPages}
                    zh={zh}
                    onPageChange={(next) => handlePageChange(next, false)}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="mr-results-meta mr-tabular">
            <span>
              {zh
                ? `显示第 ${rangeStart}–${rangeEnd} / 共 ${filtered.length} 个模组（总收录 ${total || items.length}）· ${downloadableCount} 个可下载`
                : `Showing ${rangeStart}–${rangeEnd} of ${filtered.length} mods (${total || items.length} total) · ${downloadableCount} downloadable`}
            </span>
          </div>

          {error && (
            <div className="mr-empty">
              <Info size={24} />
              <h3>{zh ? '加载模组目录失败' : 'Failed to load mods'}</h3>
              <p>{error}</p>
              <button type="button" className="mr-btn-emerald" onClick={() => void loadMods()}>
                {zh ? '重试加载' : 'Retry'}
              </button>
            </div>
          )}

          {!error && loading && (
            <div className="mr-empty">
              <RefreshCw size={24} className="spin" />
              <p>{zh ? '正在加载星枢模组工坊目录…' : 'Loading XingShu Mod Workshop…'}</p>
            </div>
          )}

          {!error && !loading && filtered.length === 0 && (
            <div className="mr-empty">
              <Package size={28} />
              <h3>{zh ? '没有符合筛选条件的模组' : 'No mods match your filters'}</h3>
              <p>{zh ? '尝试清空关键词或重置左侧筛选维度。' : 'Try clearing your search or resetting sidebar filters.'}</p>
              <button type="button" className="mr-btn-outline" onClick={resetAllFilters}>
                {zh ? '重置全部条件' : 'Reset Filters'}
              </button>
            </div>
          )}

          {!error && !loading && paginated.length > 0 && (
            <>
              <div className={`mr-project-list ${viewMode === 'grid' ? 'is-grid' : ''}`}>
                {paginated.map((item) => {
                  const updatedMs = modUpdatedMs(item as ModItemWithDates);
                  const dateLabel = formatShortDate(updatedMs, zh);
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
                            <Link
                              to={modDetailPath(item)}
                              style={{ color: 'inherit', textDecoration: 'none' }}
                            >
                              {item.name}
                            </Link>
                          </h3>
                          <Link
                            to={`/author/${encodeURIComponent(
                              item.authorKey ||
                                (item.id.startsWith('xingshu.launcher.') ? 'official' : item.author),
                            )}`}
                            className="mr-project-author is-link"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <PlatformUserAvatar
                              name={item.author}
                              avatarUrl={item.authorAvatarUrl}
                              avatarColor={item.authorAvatarColor || (item.authorIsOfficial ? '#2f7cf6' : '#f02878')}
                              size={16}
                              fontSize={9}
                            />
                            <span>by {item.author}</span>
                          </Link>
                          <span className={`mr-kind-badge ${item.installKind === 'xspkg' ? 'is-xspkg' : ''}`}>
                            {installKindLabel(item.installKind)}
                          </span>
                        </div>
                        <p className="mr-project-desc">{item.description}</p>
                        <div className="mr-project-pills">
                          <span className="mr-pill">{item.categoryLabel}</span>
                          {modPlatformSummaryBadge(item, zh) && (
                            <span className="mr-pill is-versions mr-tabular">
                              {modPlatformSummaryBadge(item, zh)}
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
                                    ? {
                                        ...row,
                                        reactions: next.reactions,
                                        reactionTotal: next.reactionTotal,
                                      }
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
                          <span title={dateLabel ? `${versionLabel} · ${dateLabel}` : versionLabel}>
                            <Clock size={12} />
                            {dateLabel || versionLabel}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="mr-pagination-bottom">
                  <PaginationBar
                    page={currentPage}
                    totalPages={totalPages}
                    zh={zh}
                    onPageChange={(next) => handlePageChange(next, true)}
                  />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
};
