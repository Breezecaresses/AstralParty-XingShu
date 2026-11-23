import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  ArrowUpRight,
  Blocks,
  BookOpen,
  CheckCircle2,
  Coins,
  Download,
  ExternalLink,
  Eye,
  Film,
  FolderOpen,
  Gamepad2,
  History,
  Info,
  Layers,
  MapPin,
  Paintbrush,
  Plus,
  Puzzle,
  Radio,
  ScanSearch,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { EmoteReactionBar } from '../../components/platform/EmoteReactionBar';
import { useTranslation } from '../../i18n';
import { api, type DroppedModRecord, type WorkshopLocalItemState } from '../../shared/api/tauri';
import officialModules from '../../shared/launcherModules.json';
import { usePendingDroppedModPaths } from '../../shared/modDropBridge';
import { isTauriRuntime, openExternalUrl } from '../../shared/runtime';
import {
  WORKSHOP_CATEGORIES,
  fetchWorkshopModDetail,
  fetchWorkshopMods,
  formatModBytes,
  installKindLabel,
  modPlatformSummaryBadge,
  sanitizeWorkshopPlatforms,
  workshopAssetUrl,
  type WorkshopCategory,
  type WorkshopModItem,
  type WorkshopVersionEntry,
} from '../../shared/workshopClient';
import {
  extensionChannels,
  useExtensionTarget,
} from '../extensions/ExtensionWorkspace';
import { ExternalModsPanel } from '../extensions/ExternalModsPanel';
import { ModDropInspector } from '../extensions/ModDropInspector';
import { type ConflictInspectReport, type LauncherDiskState, errorMessage } from './launcherModel';
import { useLauncherTheme } from './launcherTheme';
import {
  OFFICIAL_SUB_GROUPS,
  getCategoryVisualMeta,
  getLauncherModuleMeta,
  normalizeModuleSlug,
} from './launcherModMeta';
import './launcher.css';

type ToolEntry = {
  to: string;
  Icon: typeof Film;
  zh: string;
  en: string;
  detail: string;
  english: string;
};

type ToolGroup = {
  key: string;
  Icon: typeof Film;
  zh: string;
  en: string;
  descZh: string;
  descEn: string;
  items: ToolEntry[];
};

const toolGroups: ToolGroup[] = [
  {
    key: 'player',
    Icon: Film,
    zh: '对局与资料',
    en: 'Matches & players',
    descZh: '支持回放文件和游戏 UID 查询。',
    descEn: 'Analyze replay files and look up game UIDs.',
    items: [
      { to: '/player/replay', Icon: Film, zh: '回放分析', en: 'Replay analysis', detail: '按对局编号或回放文件分析', english: 'Analyze by match ID or replay file' },
      { to: '/player/profile', Icon: UserRound, zh: '玩家资料', en: 'Player profile', detail: '按 UID 查看公开资料', english: 'Look up a public profile by UID' },
      { to: '/player/matches', Icon: History, zh: '对战记录', en: 'Match history', detail: '查看战绩和对局详情', english: 'Review match results and details' },
    ],
  },
  {
    key: 'codex',
    Icon: BookOpen,
    zh: '游戏图鉴',
    en: 'Game codex',
    descZh: '按游戏配置查询属性与效果。',
    descEn: 'Look up stats and effects from the game data.',
    items: [
      { to: '/player/characters', Icon: Users, zh: '角色中心', en: 'Characters', detail: '查询角色技能、装扮与羁绊奖励', english: 'Browse skills, outfits and bond rewards' },
      { to: '/player/cards', Icon: Layers, zh: '卡牌图鉴', en: 'Cards', detail: '查询卡牌效果和异画', english: 'Browse card effects and alternate art' },
      { to: '/player/chips', Icon: Coins, zh: '筹码图鉴', en: 'Chips', detail: '查看筹码品质和效果', english: 'Browse chip tiers and effects' },
      { to: '/player/maps', Icon: MapPin, zh: '地图与场地', en: 'Maps & arenas', detail: '查询地图、玩法和场地效果', english: 'Look up maps, game modes and arena effects' },
    ],
  },
  {
    key: 'online',
    Icon: Gamepad2,
    zh: '联机与网桥',
    en: 'Online play & bridge',
    descZh: '查看游戏运行时与星枢的连接状态。',
    descEn: 'View the game runtime connection to XingShu.',
    items: [
      { to: '/spectator', Icon: Eye, zh: '星枢观战', en: 'Spectator', detail: '查看已连接的观战会话', english: 'View connected spectator sessions' },
      { to: '/bridge', Icon: Radio, zh: '星枢网桥', en: 'Connection bridge', detail: '查看本机网桥连接和日志', english: 'Inspect local bridge connections and logs' },
      { to: '/room', Icon: Gamepad2, zh: '联机房间', en: 'Room lobby', detail: '查看和管理联机房间', english: 'View and manage online rooms' },
    ],
  },
  {
    key: 'launcher',
    Icon: Wrench,
    zh: '启动器维护',
    en: 'Launcher maintenance',
    descZh: '管理授权账号、安装记录与备份。',
    descEn: 'Manage linked accounts, installation records and backups.',
    items: [
      { to: '/player/accounts', Icon: UserRound, zh: '游戏账号', en: 'Game accounts', detail: '连接星枢账号', english: 'Link the XingShu account' },
      { to: '/diagnostics', Icon: ShieldCheck, zh: '组件诊断', en: 'Component diagnostics', detail: '核对游戏、启动组件和连接', english: 'Check game installation and runtime' },
      { to: '/maintenance/transactions?from=tools', Icon: History, zh: '安装记录', en: 'Install history', detail: '查看模组安装与还原记录', english: 'Review mod installation and rollback' },
      { to: '/maintenance/backups?from=tools', Icon: FolderOpen, zh: '备份与还原', en: 'Backups', detail: '查看并恢复文件备份', english: 'Review and restore file backups' },
    ],
  },
];

export function LauncherTools() {
  const zh = useTranslation().locale === 'zh-CN';
  let stagger = 0;

  return (
    <div className="launcher-catalog pcl-catalog-page">
      <div className="pcl-page-header">
        <div>
          <h1>{zh ? '工具库' : 'Tools'}</h1>
        </div>
      </div>

      <div className="pcl-catalog-groups">
        {toolGroups.map((group, groupIdx) => {
          const GroupIcon = group.Icon;
          return (
            <section
              key={group.key}
              className="pcl-card pcl-catalog-card"
              style={{ '--card-index': groupIdx } as React.CSSProperties}
            >
              <header className="pcl-card-head">
                <div className="pcl-card-title-group">
                  <span className="pcl-card-icon">
                    <GroupIcon size={16} />
                  </span>
                  <div>
                    <h2>{zh ? group.zh : group.en}</h2>
                    <p>{zh ? group.descZh : group.descEn}</p>
                  </div>
                </div>
                <span className="pcl-count-chip">{group.items.length} {zh ? '项' : 'items'}</span>
              </header>

              <div className="pcl-tool-grid">
                {group.items.map(({ to, Icon, zh: name, en, detail, english }) => {
                  const tileIdx = stagger++;
                  return (
                    <Link
                      key={to}
                      className="pcl-tool-tile"
                      to={to}
                      style={{ '--stagger-index': tileIdx } as React.CSSProperties}
                    >
                      <div className="pcl-tool-tile-head">
                        <span className="pcl-tool-tile-icon">
                          <Icon size={17} />
                        </span>
                        <strong>{zh ? name : en}</strong>
                        <ArrowUpRight size={14} className="pcl-tool-tile-arrow" />
                      </div>
                      <p>{zh ? detail : english}</p>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

type ModRow = {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  disabled?: boolean;
  managed: boolean;
  available: boolean;
};
type ModCatalog = { modules: ModRow[]; ready: boolean };

type RailSection = 'installed' | 'discover' | 'local' | 'inspect';
type SourceFilter = 'all' | 'official' | 'workshop' | 'dropped';
type InstalledFilter = 'all' | 'enabled' | 'disabled' | 'official' | 'community';
type StatusFilter = 'all' | 'installed' | 'available';
type SortMode = 'recommended' | 'name' | 'size_asc' | 'size_desc';

interface UnifiedModItem {
  key: string;
  sourceKind: 'official' | 'workshop' | 'dropped';
  officialMod?: ModRow;
  workshopItem?: WorkshopModItem;
  localState?: WorkshopLocalItemState;
  droppedRecord?: DroppedModRecord;
  id: string;
  slug: string;
  name: string;
  author: string;
  category: Exclude<WorkshopCategory, 'all'> | string;
  secondaryCategories?: string[];
  categoryLabel: string;
  installKind: string;
  description: string;
  tags: string[];
  platforms: string[];
  version: string;
  versionCount?: number;
  platformLabels?: string[];
  versions?: WorkshopModItem['versions'];
  sizeBytes: number;
  sha256: string;
  targets: string[];
  targetInfo: string;
  previewUrl?: string | null;
  externalUrl?: string | null;
  downloadUrl?: string | null;
  downloadable: boolean;
  installed: boolean;
  downloaded: boolean;
  enabled: boolean;
  disabled: boolean;
  canToggle: boolean;
  canLocalOfficialToggle: boolean;
  canDirectWorkshopInstall: boolean;
}

export function LauncherMods() {
  const zh = useTranslation().locale === 'zh-CN';
  const { theme } = useLauncherTheme();
  const target = useExtensionTarget();
  const installationId = target.selected?.id ?? '';
  const location = useLocation();
  const [droppedPaths] = usePendingDroppedModPaths();

  const [railSection, setRailSection] = useState<RailSection>('installed');
  const [installedFilter, setInstalledFilter] = useState<InstalledFilter>('all');
  const [installedQuery, setInstalledQuery] = useState('');

  // Discover filter state
  const [categoryFilter, setCategoryFilter] = useState<WorkshopCategory>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recommended');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');

  // Folder drawer toggle inside left rail
  const [folderEditorOpen, setFolderEditorOpen] = useState(false);

  // Data state
  const [catalog, setCatalog] = useState<ModCatalog>();
  const [currentInst, setCurrentInst] = useState('');
  const [workshopItems, setWorkshopItems] = useState<WorkshopModItem[]>([]);
  const [workshopLoading, setWorkshopLoading] = useState(true);
  const [workshopError, setWorkshopError] = useState('');
  const [localStates, setLocalStates] = useState<Record<string, WorkshopLocalItemState>>({});
  const [droppedRecords, setDroppedRecords] = useState<DroppedModRecord[]>([]);
  const [failedPreviews, setFailedPreviews] = useState<Record<string, boolean>>({});

  // Action & feedback state
  const [disk, setDisk] = useState<LauncherDiskState>();
  const [conflictReport, setConflictReport] = useState<ConflictInspectReport | null>(null);
  const [checkingConflict, setCheckingConflict] = useState(false);
  const [componentProgress, setComponentProgress] = useState<{
    channel: string;
    stage: string;
    downloadedBytes: number;
    totalBytes: number;
    percent: number;
    detail: string;
  } | null>(null);
  const busyRef = useRef(false);
  const forceCoreRefreshRef = useRef(false);
  const [pendingKey, setPendingKey] = useState('');
  const [installProgress, setInstallProgress] = useState<{
    modId: string;
    stage: string;
    downloadedBytes: number;
    totalBytes: number;
    percent: number;
    detail: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [conflictRetryItem, setConflictRetryItem] = useState<UnifiedModItem | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailFull, setDetailFull] = useState<WorkshopModItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; caption?: string } | null>(null);
  const localReady = Boolean(installationId) && currentInst === installationId;

  useEffect(() => {
    let active = true;
    const forceRefresh = forceCoreRefreshRef.current;
    forceCoreRefreshRef.current = false;
    setError('');
    void Promise.allSettled([
      invoke<ModCatalog>('launcher_mods', { installationId: installationId || null }),
      installationId
        ? invoke<LauncherDiskState>('launcher_check', { installationId, forceRefresh })
        : Promise.resolve(undefined),
      installationId
        ? api.workshopListLocalState(installationId)
        : Promise.resolve([] as WorkshopLocalItemState[]),
      installationId
        ? api.listDroppedMods(installationId)
        : Promise.resolve([] as DroppedModRecord[]),
    ]).then(([modCat, diskRes, localList, droppedList]) => {
      if (!active) return;
      const states = localList.status === 'fulfilled' ? localList.value.filter((entry) => entry.canRestore) : [];
      setCatalog(modCat.status === 'fulfilled' ? modCat.value : undefined);
      setDisk(diskRes.status === 'fulfilled' ? diskRes.value : undefined);
      setLocalStates(Object.fromEntries([
        ...states.filter((state) => state.source === 'library'),
        ...states.filter((state) => state.source !== 'library'),
      ].map((entry) => [entry.modId, entry])));
      setDroppedRecords(droppedList.status === 'fulfilled' ? droppedList.value : []);
      setCurrentInst(installationId);
      const failure = [modCat, diskRes, localList, droppedList].find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') setError(errorMessage(failure.reason));
    });
    return () => { active = false; };
  }, [installationId, revision]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<{
      channel: string;
      stage: string;
      downloadedBytes: number;
      totalBytes: number;
      percent: number;
      detail: string;
    }>('xingshu:component-install-progress', ({ payload }) => {
      if (!active || !payload) return;
      setComponentProgress(payload);
    }).then((fn) => {
      if (!active) fn();
      else unlisten = fn;
    });
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const section = query.get('section');
    if (section === 'inspect' || section === 'local' || section === 'installed' || section === 'discover') {
      setRailSection(section);
    }
    const module = query.get('module');
    if (module && officialModules.some(({ id }) => id === module)) {
      setDetailKey(`xingshu.launcher.${module}`);
    }
  }, [location.key, location.search]);

  useEffect(() => {
    if (droppedPaths.length) {
      setDetailKey(null);
      setRailSection('inspect');
    }
  }, [droppedPaths]);

  useEffect(() => {
    const controller = new AbortController();
    setWorkshopLoading(true);
    setWorkshopError('');
    void fetchWorkshopMods('all', '', controller.signal)
      .then(({ items }) => {
        if (!controller.signal.aborted) setWorkshopItems(items);
      })
      .catch((issue) => {
        if (!controller.signal.aborted) setWorkshopError(errorMessage(issue));
      })
      .finally(() => {
        if (!controller.signal.aborted) setWorkshopLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!detailKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lightboxImage) {
        setLightboxImage(null);
        return;
      }
      if (document.querySelector('.xp-modal-backdrop, .mr-emote-popover')) {
        return;
      }
      setDetailKey(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailKey, lightboxImage]);

  useEffect(() => {
    if (!isTauriRuntime() || !installationId) {
      if (!busyRef.current) {
        setPendingKey('');
        setInstallProgress(null);
      }
      return;
    }
    let active = true;
    void api.workshopActiveInstallProgress(installationId).then((prog) => {
      if (!active) return;
      if (prog) {
        busyRef.current = true;
        setPendingKey(prog.modId);
        setInstallProgress({
          modId: prog.modId,
          stage: prog.stage,
          downloadedBytes: prog.downloadedBytes,
          totalBytes: prog.totalBytes,
          percent: prog.percent,
          detail: prog.detail,
        });
      } else if (!busyRef.current) {
        setPendingKey('');
        setInstallProgress(null);
      }
    });
    return () => {
      active = false;
    };
  }, [installationId]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen('xingshu:modules-changed', () => {
      if (active) setRevision((v) => v + 1);
    }).then((fn) => {
      if (!active) fn();
      else unlisten = fn;
    });
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<{
      modId: string;
      stage: string;
      downloadedBytes: number;
      totalBytes: number;
      percent: number;
      detail: string;
    }>('xingshu:mod-install-progress', ({ payload }) => {
      if (!active || !payload) return;
      if (payload.stage === 'done' || payload.stage === 'error') {
        busyRef.current = false;
        setPendingKey('');
        setInstallProgress(null);
        if (payload.stage === 'done') {
          setRevision((v) => v + 1);
        }
        return;
      }
      busyRef.current = true;
      setPendingKey((prev) => prev || payload.modId);
      setInstallProgress((prev) => {
        if (
          prev
          && prev.modId === payload.modId
          && prev.stage === 'downloading'
          && payload.stage === 'downloading'
        ) {
          return {
            ...payload,
            downloadedBytes: Math.max(prev.downloadedBytes, payload.downloadedBytes),
            percent: Math.max(prev.percent, payload.percent),
          };
        }
        return payload;
      });
    }).then((fn) => {
      if (!active) fn();
      else unlisten = fn;
    });
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  const unifiedItems = useMemo<UnifiedModItem[]>(() => {
    const wsMap = new Map<string, WorkshopModItem>();
    for (const item of workshopItems) {
      wsMap.set(item.id, item);
    }

    const list: UnifiedModItem[] = [];
    const states: Record<string, WorkshopLocalItemState> = localReady ? localStates : {};
    const linkedDrops = new Set(Object.values(states).map((state) => state.linkedDropId).filter(Boolean));
    const mergedWorkshopIds = new Set<string>();

    const modules: ModRow[] = localReady && catalog?.modules
      ? catalog.modules
      : officialModules.map((mod) => ({ ...mod, installed: false, managed: false, available: false }));
    for (const mod of modules) {
      const wsId = `xingshu.launcher.${mod.id}`;
      const ws = wsMap.get(wsId);
      mergedWorkshopIds.add(wsId);
      const localState = states[wsId];
      const visual = getLauncherModuleMeta(mod.id);
      const isDisabled = Boolean(mod.disabled) || localState?.phase === 'disabled';
      const isInstalled = mod.installed || Boolean(localState?.canRestore);
      const isEnabled = mod.installed ? !mod.disabled : localState?.phase === 'installed';
      const canLocalInstall = localReady && !isInstalled && mod.available;

      list.push({
        key: wsId,
        sourceKind: 'official',
        officialMod: mod,
        workshopItem: ws,
        localState,
        id: wsId,
        slug: mod.id,
        name: mod.name,
        author: ws?.author || (zh ? '星枢官方' : 'XingShu Official'),
        category: 'optimization',
        categoryLabel: zh ? '功能优化' : 'Optimization',
        installKind: 'xspkg',
        description: ws?.description || mod.description,
        tags: ws?.tags?.length ? ws.tags : [zh ? visual.groupZh : visual.groupEn, zh ? '官方模块' : 'Official', '.xspkg'],
        platforms: ws?.platforms?.length ? ws.platforms : ['STEAM_CN', 'TAPTAP', 'BILIBILI', 'WEGAME', 'ANDROID_CN'],
        version: ws?.version || '1.0.0',
        versionCount: ws?.versionCount ?? 1,
        platformLabels: ws?.platformLabels,
        versions: ws?.versions,
        sizeBytes: ws?.sizeBytes ?? 0,
        sha256: ws?.sha256 || '',
        targets: ws?.targets?.length ? ws.targets : [`xingshu/plugins/${wsId}.module`],
        targetInfo: ws?.targetInfo || `xingshu/plugins/${wsId}.module`,
        previewUrl: ws?.previewUrl || null,
        externalUrl: ws?.externalUrl || null,
        downloadUrl: ws?.downloadUrl || null,
        downloadable: Boolean(ws?.downloadable),
        installed: isInstalled,
        downloaded: isInstalled || localState?.phase === 'downloaded',
        enabled: isEnabled,
        disabled: isDisabled,
        canToggle: localReady && (mod.installed || localState?.phase === 'installed' || localState?.phase === 'disabled'),
        canLocalOfficialToggle: canLocalInstall,
        canDirectWorkshopInstall: false,
      });
    }

    for (const id of new Set([...wsMap.keys(), ...Object.keys(states)])) {
      if (mergedWorkshopIds.has(id) || id.startsWith('xingshu.launcher.')) continue;
      const ws = wsMap.get(id);
      const localState = states[id];
      const phase = localState?.phase;
      const isInstalled = phase === 'installed' || phase === 'disabled' || phase === 'prepared';
      const library = localState?.source === 'library';

      list.push({
        key: id,
        sourceKind: library ? 'dropped' : 'workshop',
        workshopItem: ws,
        localState,
        id,
        slug: normalizeModuleSlug(id),
        name: ws?.name || localState?.name || id,
        author: ws?.author || (library ? (zh ? '本地模组库' : 'Local library') : (zh ? '社区工坊' : 'Workshop')),
        category: ws?.category || 'optimization',
        secondaryCategories: ws?.secondaryCategories,
        categoryLabel: ws?.categoryLabel || (zh ? '本地记录' : 'Local record'),
        installKind: ws?.installKind || localState?.installKind || '',
        description: ws?.description || (library ? (zh ? '来自本地模组库' : 'From the local mod library') : (zh ? '来自已保存的工坊记录' : 'From saved workshop records')),
        tags: ws?.tags || [],
        platforms: ws?.platforms || (target.selected ? [target.selected.platform] : []),
        version: ws?.version || ws?.gameVersion || '',
        versionCount: ws?.versionCount,
        platformLabels: ws?.platformLabels,
        versions: ws?.versions,
        sizeBytes: ws?.sizeBytes || 0,
        sha256: ws?.sha256 || '',
        targets: ws?.targets || [],
        targetInfo: ws?.targetInfo || '',
        previewUrl: ws?.previewUrl || null,
        externalUrl: ws?.externalUrl || null,
        downloadUrl: ws?.downloadUrl || null,
        downloadable: Boolean(ws?.downloadable),
        installed: isInstalled,
        downloaded: isInstalled || phase === 'downloaded',
        enabled: phase === 'installed',
        disabled: phase === 'disabled',
        canToggle: localReady && (phase === 'installed' || phase === 'disabled' || (phase === 'downloaded' && Boolean(localState?.downloadedPath))),
        canLocalOfficialToggle: false,
        canDirectWorkshopInstall: localReady && Boolean(ws?.downloadable && ws.downloadUrl?.startsWith('/api/workshop/')),
      });
    }

    for (const dr of localReady ? droppedRecords : []) {
      if (!dr.canRestore || linkedDrops.has(dr.modId)) continue;
      const isDisabled = dr.phase === 'disabled';
      list.push({
        key: `dropped:${dr.modId}`,
        sourceKind: 'dropped',
        droppedRecord: dr,
        id: dr.modId,
        slug: dr.modId,
        name: dr.name,
        author: zh ? '本地导入' : 'Local Drop',
        category: dr.sourceKind === 'xspkg' ? 'optimization' : 'card',
        categoryLabel: zh ? '本地安装包' : 'Local Package',
        installKind: dr.sourceKind === 'xspkg' ? 'xspkg' : 'bundle_mod',
        description: zh
          ? `本地导入替换资源（${dr.fileCount} 个目标资产，支持随时无损开关与还原）`
          : `Locally imported mod (${dr.fileCount} target assets, lossless toggle ready)`,
        tags: [zh ? '本地导入' : 'Local', dr.sourceKind],
        platforms: ['STEAM_CN', 'TAPTAP', 'BILIBILI', 'WEGAME'],
        version: 'Local',
        sizeBytes: 0,
        sha256: '',
        targets: dr.targets || [],
        targetInfo: (dr.targets || []).slice(0, 3).join(', '),
        previewUrl: null,
        externalUrl: null,
        downloadUrl: null,
        downloadable: false,
        installed: true,
        downloaded: true,
        enabled: dr.phase === 'installed',
        disabled: isDisabled,
        canToggle: dr.phase === 'installed' || dr.phase === 'disabled',
        canLocalOfficialToggle: false,
        canDirectWorkshopInstall: false,
      });
    }

    return list;
  }, [catalog?.modules, droppedRecords, localReady, localStates, target.selected, workshopItems, zh]);

  const detailItem = unifiedItems.find((item) => item.key === detailKey);
  const detailWsId = detailItem?.workshopItem?.id || '';

  useEffect(() => {
    setLightboxImage(null);
    if (!detailWsId) {
      setDetailFull(null);
      setDetailLoading(false);
      return;
    }
    const seed = workshopItems.find((w) => w.id === detailWsId) ?? null;
    setDetailFull(seed);
    let cancelled = false;
    setDetailLoading(true);
    void fetchWorkshopModDetail(detailWsId)
      .then((detail) => {
        if (!cancelled) setDetailFull(detail);
      })
      .catch(() => {
        // Keep catalog summary seed when network detail fetch fails
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey, detailWsId]);

  const installedItems = useMemo(() => {
    const q = installedQuery.trim().toLowerCase();
    return unifiedItems.filter((item) => {
      if (!item.installed && !item.downloaded) return false;
      if (installedFilter === 'enabled' && !item.enabled) return false;
      if (installedFilter === 'disabled' && !(item.disabled || (item.downloaded && !item.installed))) return false;
      if (installedFilter === 'official' && item.sourceKind !== 'official') return false;
      if (installedFilter === 'community' && item.sourceKind === 'official') return false;
      if (!q) return true;
      const hay = `${item.name} ${item.description} ${item.id} ${item.author} ${item.tags.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [installedFilter, installedQuery, unifiedItems]);

  const allInstalledCount = useMemo(
    () => unifiedItems.filter((i) => i.installed || i.downloaded).length,
    [unifiedItems],
  );
  const enabledInstalledCount = useMemo(
    () => unifiedItems.filter((i) => i.enabled).length,
    [unifiedItems],
  );
  const disabledInstalledCount = useMemo(
    () => unifiedItems.filter((i) => i.disabled || (i.downloaded && !i.installed)).length,
    [unifiedItems],
  );
  const installedOfficialCount = useMemo(
    () => unifiedItems.filter((i) => (i.installed || i.downloaded) && i.sourceKind === 'official').length,
    [unifiedItems],
  );
  const enabledOfficialCount = useMemo(
    () => unifiedItems.filter((i) => i.enabled && i.sourceKind === 'official').length,
    [unifiedItems],
  );
  const installedCommunityCount = allInstalledCount - installedOfficialCount;

  const filteredDiscoverItems = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    const list = unifiedItems.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter && !item.secondaryCategories?.includes(categoryFilter)) {
        return false;
      }
      if (sourceFilter !== 'all' && item.sourceKind !== sourceFilter) return false;
      if (statusFilter === 'installed' && !item.installed) return false;
      if (statusFilter === 'available' && item.installed) return false;
      if (tagFilter && !item.tags.some((t) => t === tagFilter)) return false;
      if (q) {
        const hay = `${item.name} ${item.author} ${item.description} ${item.id} ${item.targetInfo} ${item.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortMode === 'name') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name, zh ? 'zh-CN' : 'en'));
    }
    if (sortMode === 'size_asc') {
      return [...list].sort((a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0));
    }
    if (sortMode === 'size_desc') {
      return [...list].sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
    }
    return list;
  }, [categoryFilter, searchInput, sortMode, sourceFilter, statusFilter, tagFilter, unifiedItems, zh]);

  const handleInstall = async (item: UnifiedModItem, skipConflicts = false) => {
    if (!localReady || busyRef.current || pendingKey) return;
    busyRef.current = true;
    let keepBusy = false;
    setPendingKey(item.key);
    setInstallProgress({
      modId: item.id,
      stage: 'fetching_meta',
      downloadedBytes: 0,
      totalBytes: item.sizeBytes || 0,
      percent: 2,
      detail: zh ? `准备下载并安装「${item.name}」…` : `Preparing ${item.name}…`,
    });
    setError('');
    setConflictRetryItem(null);
    setNotice({
      kind: 'info',
      text: skipConflicts
        ? zh ? `正在跳过冲突文件并安装「${item.name}」…` : `Installing ${item.name} (skipping conflicts)…`
        : zh ? `正在下载并安装「${item.name}」…` : `Installing ${item.name}…`,
    });
    try {
      if (item.officialMod && item.canLocalOfficialToggle && !item.officialMod.installed) {
        await invoke('launcher_change_mod', {
          installationId,
          modId: item.officialMod.id,
          install: true,
        });
        setNotice({
          kind: 'success',
          text: zh
            ? `已下载并启用「${item.name}」。${catalog?.ready ? '' : '安装兼容组件后，局内功能会生效。'}`
            : `Installed and enabled ${item.name}.${catalog?.ready ? '' : ' In-game use requires a compatible component.'}`,
        });
      } else if (item.workshopItem && item.canDirectWorkshopInstall) {
        const ws = item.workshopItem;
        const result = await api.workshopDownloadAndInstall({
          installationId,
          modId: ws.id,
          skipConflicts,
        });
        setNotice({ kind: 'success', text: result.message });
      } else {
        throw new Error(
          zh
            ? '请先在上方安装「星枢官方插件 Mod」后再启用，或检查网络连接。'
            : 'Install the XingShu Official Plugin Mod above first or verify network access.',
        );
      }
      setRevision((v) => v + 1);
    } catch (issue) {
      const msg = errorMessage(issue);
      const code = issue && typeof issue === 'object' && 'code' in issue
        ? String((issue as { code?: unknown }).code || '')
        : '';
      const isInProgress = code === 'MOD_INSTALL_IN_PROGRESS' || msg.includes('正在处理');
      if (isInProgress) {
        keepBusy = true;
        setConflictRetryItem(null);
        setError('');
        setNotice({
          kind: 'info',
          text: zh ? '该模组或当前目录已有下载任务进行中，请等待完成。' : 'A mod install task is already running; please wait.',
        });
        if (installationId) {
          void api.workshopActiveInstallProgress(installationId).then((prog) => {
            if (prog) {
              busyRef.current = true;
              setPendingKey(prog.modId);
              setInstallProgress({
                modId: prog.modId,
                stage: prog.stage,
                downloadedBytes: prog.downloadedBytes,
                totalBytes: prog.totalBytes,
                percent: prog.percent,
                detail: prog.detail,
              });
            } else {
              busyRef.current = false;
              setPendingKey('');
              setInstallProgress(null);
            }
          });
        }
        return;
      }
      const isModConflict =
        (code === 'MOD_TARGET_CONFLICT'
          || msg.includes('目标资源与已启用模组冲突')
          || msg.includes('目标资源由其他模组管理'));
      if (!skipConflicts && isModConflict && item.workshopItem && item.canDirectWorkshopInstall) {
        setNotice(null);
        setConflictRetryItem(item);
        setError(msg);
      } else {
        setConflictRetryItem(null);
        setError('');
        setNotice({ kind: 'error', text: msg });
      }
    } finally {
      if (!keepBusy) {
        busyRef.current = false;
        setPendingKey('');
        setInstallProgress(null);
      }
    }
  };

  const handleRemove = async (item: UnifiedModItem) => {
    if (!localReady || busyRef.current || pendingKey) return;
    busyRef.current = true;
    setPendingKey(item.key);
    setError('');
    setConflictRetryItem(null);
    try {
      if (item.officialMod?.installed) {
        await invoke('launcher_change_mod', {
          installationId,
          modId: item.officialMod.id,
          install: false,
        });
        setNotice({ kind: 'success', text: zh ? `已移除「${item.name}」。` : `Removed ${item.name}.` });
      } else if (item.droppedRecord?.canRestore) {
        const msg = await api.restoreDroppedMod(installationId, item.droppedRecord.modId);
        setNotice({ kind: 'success', text: msg });
      } else if (item.localState?.canRestore) {
        const msg = await api.workshopRestoreMod(installationId, item.localState.modId);
        setNotice({ kind: 'success', text: msg });
      }
      setRevision((v) => v + 1);
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      busyRef.current = false;
      setPendingKey('');
    }
  };

  const handleToggleMod = async (item: UnifiedModItem) => {
    if (!localReady || busyRef.current || pendingKey || !item.canToggle) return;
    busyRef.current = true;
    const nextEnabled = !item.enabled;
    setPendingKey(item.key);
    setError('');
    setConflictRetryItem(null);
    try {
      if (item.officialMod?.installed) {
        await invoke('launcher_toggle_mod', {
          installationId,
          modId: item.officialMod.id,
          enabled: nextEnabled,
        });
      } else if (item.droppedRecord) {
        await api.toggleDroppedMod(installationId, item.droppedRecord.modId, nextEnabled);
      } else if (item.localState) {
        await api.workshopToggleMod(installationId, item.localState.modId, nextEnabled);
      }
      setNotice({
        kind: 'success',
        text: nextEnabled
          ? zh
            ? `已开启「${item.name}」。`
            : `Enabled ${item.name}.`
          : zh
            ? `已关闭「${item.name}」，已保留本地缓存。`
            : `Disabled ${item.name} (cached locally).`,
      });
      setRevision((v) => v + 1);
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      busyRef.current = false;
      setPendingKey('');
    }
  };

  const handleOpenFolder = async () => {
    if (!installationId) return;
    try {
      await invoke('launcher_open_mods_dir', { installationId });
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    }
  };

  const handleInstallCorePlugin = async (replaceConflicts = false) => {
    if (!localReady || busyRef.current || pendingKey) return;
    busyRef.current = true;
    setPendingKey('xingshu.core.plugin');
    setComponentProgress({
      channel: target.channel,
      stage: 'downloading',
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 4,
      detail: zh ? '准备下载星枢官方插件 Mod…' : 'Preparing XingShu Official Plugin Mod…',
    });
    setError('');
    setNotice({
      kind: 'info',
      text: replaceConflicts
        ? zh ? '正在备份冲突文件并安装「星枢官方插件 Mod」…' : 'Backing up conflicts and installing XingShu Plugin Mod…'
        : zh ? '正在下载并安装「星枢官方插件 Mod」…' : 'Installing XingShu Official Plugin Mod…',
    });
    try {
      const next = await invoke<LauncherDiskState>('launcher_install', {
        installationId,
        replaceConflicts,
      });
      setDisk(next);
      setConflictReport(null);
      setNotice({
        kind: 'success',
        text: zh
          ? '「星枢官方插件 Mod」已安装完成。现在可自由启用下方 19 项星枢功能或使用游戏内开房。'
          : 'XingShu Official Plugin Mod installed cleanly.',
      });
      setRevision((v) => v + 1);
    } catch (issue) {
      const msg = errorMessage(issue);
      const isConflictConfirm = Boolean(
        issue && typeof issue === 'object' && 'code' in issue && (issue as { code?: string }).code === 'CONFLICT_CONFIRM_REQUIRED',
      ) || msg.includes('CONFLICT_CONFIRM_REQUIRED');
      if (isConflictConfirm) {
        try {
          const report = await invoke<ConflictInspectReport>('launcher_inspect_conflicts', { installationId });
          setConflictReport(report);
        } catch {
          // ignore follow-up inspect error; primary message is already set
        }
      }
      setNotice({ kind: 'error', text: msg });
    } finally {
      busyRef.current = false;
      setPendingKey('');
      setComponentProgress(null);
    }
  };

  const handleUninstallCorePlugin = async () => {
    if (!localReady || busyRef.current || pendingKey) return;
    busyRef.current = true;
    setPendingKey('xingshu.core.plugin');
    setComponentProgress({
      channel: target.channel,
      stage: 'installing',
      downloadedBytes: 1,
      totalBytes: 1,
      percent: 40,
      detail: zh ? '正在卸载官方插件并还原为官方原版…' : 'Restoring official vanilla game bundle…',
    });
    setError('');
    setNotice({ kind: 'info', text: zh ? '正在卸载「星枢官方插件 Mod」并还原为官方原版…' : 'Restoring vanilla bundle…' });
    try {
      const next = await invoke<LauncherDiskState>('launcher_restore', { installationId });
      setDisk(next);
      setConflictReport(null);
      setNotice({
        kind: 'success',
        text: zh
          ? '已卸载「星枢官方插件 Mod」并还原为官方原版，现在将以纯净客户端启动游戏。'
          : 'XingShu Official Plugin Mod removed and vanilla bundle restored.',
      });
      setRevision((v) => v + 1);
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      busyRef.current = false;
      setPendingKey('');
      setComponentProgress(null);
    }
  };

  const handleCheckCoreConflict = async () => {
    if (!installationId || checkingConflict) return;
    setCheckingConflict(true);
    setError('');
    try {
      const report = await invoke<ConflictInspectReport>('launcher_inspect_conflicts', { installationId });
      setConflictReport(report);
      setNotice({
        kind: report.hasConflicts ? 'error' : report.targetState === 'updateAvailable' ? 'info' : 'success',
        text: report.summary,
      });
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      setCheckingConflict(false);
    }
  };

  const handleInstallAllOfficialMods = async () => {
    if (!localReady || busyRef.current || pendingKey) return;
    busyRef.current = true;
    const key = 'xingshu.official.batch';
    setPendingKey(key);
    setInstallProgress({
      modId: key,
      stage: 'installing',
      downloadedBytes: 0,
      totalBytes: officialModules.length,
      percent: 4,
      detail: zh ? '准备安装核心插件与全部 19 项官方模组…' : 'Preparing core plugin and all 19 official modules…',
    });
    setError('');
    setNotice({ kind: 'info', text: zh ? '正在一键安装全部官方模组…' : 'Installing all official modules…' });
    try {
      const res = await invoke<{
        coreInstalled: boolean;
        installedCount: number;
        enabledCount: number;
        skippedCount: number;
        totalCount: number;
      }>('launcher_install_all_official_mods', { installationId, includeCore: true });
      const touched = res.installedCount + res.enabledCount;
      setNotice({
        kind: 'success',
        text: zh
          ? `已完成一键安装（共 ${res.totalCount} 项官方功能：新增 ${res.installedCount} · 启用 ${res.enabledCount} · 原已开启 ${res.skippedCount}${res.coreInstalled ? ' · 含核心插件' : ''}${touched === 0 ? '，全部均已处于开启状态' : ''}）。`
          : `Installed/enabled all ${res.totalCount} official modules.`,
      });
      setRevision((v) => v + 1);
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      busyRef.current = false;
      setPendingKey('');
      setInstallProgress(null);
    }
  };

  const handleUninstallAllOfficialMods = async () => {
    if (!localReady || busyRef.current || pendingKey) return;
    busyRef.current = true;
    const key = 'xingshu.official.batch';
    setPendingKey(key);
    setInstallProgress({
      modId: key,
      stage: 'installing',
      downloadedBytes: 0,
      totalBytes: officialModules.length,
      percent: 5,
      detail: zh ? '正在一键卸载所有星枢官方功能模组…' : 'Removing all official feature modules…',
    });
    setError('');
    setNotice({ kind: 'info', text: zh ? '正在一键卸载全部官方模组…' : 'Removing all official modules…' });
    try {
      const res = await invoke<{ removedCount: number; totalCount: number }>(
        'launcher_uninstall_all_official_mods',
        { installationId },
      );
      setNotice({
        kind: 'success',
        text: zh
          ? `已卸载 ${res.removedCount} 项官方功能模组；如需还原纯净原版客户端，可点击上方核心插件「卸载并还原原版」。`
          : `Removed ${res.removedCount} official modules.`,
      });
      setRevision((v) => v + 1);
    } catch (issue) {
      setNotice({ kind: 'error', text: errorMessage(issue) });
    } finally {
      busyRef.current = false;
      setPendingKey('');
      setInstallProgress(null);
    }
  };

  const resetDiscoverFilters = () => {
    setCategoryFilter('all');
    setSourceFilter('all');
    setStatusFilter('all');
    setSortMode('recommended');
    setTagFilter('');
    setSearchInput('');
  };

  const selectDiscoverCategory = (cat: WorkshopCategory) => {
    setRailSection('discover');
    setCategoryFilter(cat);
  };

  const renderModBadge = (item: UnifiedModItem, size: 'sm' | 'md' | 'lg' = 'md') => {
    const px = size === 'sm' ? 40 : size === 'lg' ? 64 : 48;
    const iconPx = size === 'sm' ? 19 : size === 'lg' ? 28 : 22;
    const previewSrc =
      item.previewUrl && !failedPreviews[item.key] ? workshopAssetUrl(item.previewUrl) : '';
    if (previewSrc) {
      return (
        <div
          className={`pcl-mod-icon-badge is-${size} has-img`}
          style={{ width: px, height: px }}
        >
          <img
            src={previewSrc}
            alt=""
            onError={() => setFailedPreviews((prev) => ({ ...prev, [item.key]: true }))}
          />
        </div>
      );
    }
    const visual =
      item.sourceKind === 'official'
        ? getLauncherModuleMeta(item.slug)
        : getCategoryVisualMeta(item.category);
    const ModIcon = visual.Icon;
    return (
      <div
        className={`pcl-mod-icon-badge is-${size}`}
        style={{
          width: px,
          height: px,
          background: visual.accentBg,
          color: visual.accentFg,
          borderColor: visual.accentBorder,
        }}
        aria-hidden="true"
      >
        <ModIcon size={iconPx} />
      </div>
    );
  };

  const renderToggleSwitch = (item: UnifiedModItem) => {
    const isBusy = pendingKey === item.key || pendingKey === item.id;
    if (item.canToggle) {
      return (
        <button
          type="button"
          role="switch"
          aria-checked={item.enabled}
          aria-label={item.name}
          className={`pcl-mod-switch ${item.enabled ? 'is-on' : 'is-off'}`}
          disabled={Boolean(pendingKey) || !localReady}
          onClick={() => void handleToggleMod(item)}
          title={item.enabled ? (zh ? '点击停用此 Mod（保留本地缓存）' : 'Disable mod') : zh ? '点击一键启用此 Mod' : 'Enable mod'}
        >
          <span className="pcl-mod-switch-track">
            <span className="pcl-mod-switch-thumb" />
          </span>
          <span className="pcl-mod-switch-text">
            {isBusy ? (zh ? '切换中' : '…') : item.enabled ? (zh ? '已开启' : 'On') : item.installed ? (zh ? '已关闭' : 'Off') : (zh ? '启用' : 'Enable')}
          </span>
        </button>
      );
    }
    return null;
  };

  const activeProgressFor = (item: UnifiedModItem) => {
    if (!installProgress) return null;
    if (pendingKey !== item.key && pendingKey !== item.id) return null;
    if (installProgress.modId !== item.id && installProgress.modId !== item.slug && installProgress.modId !== item.key) {
      return null;
    }
    return installProgress;
  };

  const renderActionButton = (item: UnifiedModItem, compact = false) => {
    const isBusy = pendingKey === item.key || pendingKey === item.id;
    const itemProg = activeProgressFor(item);
    if (item.installed || item.downloaded) {
      const canRemove = Boolean(
        item.officialMod?.managed || item.localState?.canRestore || item.droppedRecord?.canRestore,
      );
      return (
        <>
          {renderToggleSwitch(item)}
          <button
            type="button"
            className={compact ? 'btn btn-secondary btn-sm' : 'pcl-mod-btn-remove'}
            disabled={Boolean(pendingKey) || !localReady || !canRemove}
            onClick={() => void handleRemove(item)}
          >
            <RotateCcw size={13} />
            <span>{isBusy ? (zh ? '移除中…' : 'Removing…') : zh ? '移除' : 'Remove'}</span>
          </button>
        </>
      );
    }

    if (item.canLocalOfficialToggle || item.canDirectWorkshopInstall) {
      const busyLabel = itemProg
        ? itemProg.stage === 'installing' || itemProg.stage === 'verifying'
          ? zh
            ? `写入中 ${itemProg.percent}%`
            : `Applying ${itemProg.percent}%`
          : zh
            ? `下载中 ${itemProg.percent}%`
            : `Downloading ${itemProg.percent}%`
        : zh
          ? '安装中…'
          : 'Installing…';
      return (
        <button
          type="button"
          className="btn btn-primary btn-sm pcl-tabular"
          disabled={Boolean(pendingKey) || !installationId}
          onClick={() => void handleInstall(item)}
        >
          <Download size={13} />
          <span>{isBusy ? busyLabel : zh ? '下载并开启' : 'Download & Enable'}</span>
        </button>
      );
    }

    if (item.externalUrl) {
      return (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void openExternalUrl(item.externalUrl!)}
        >
          <ExternalLink size={13} />
          <span>{zh ? '发布页' : 'Release'}</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={!installationId}
        onClick={() => setDetailKey(item.key)}
      >
        <Info size={13} />
        <span>{zh ? '查看' : 'Details'}</span>
      </button>
    );
  };

  return (
    <div className="pcl-mods-shell">
      {/* Left Navigation & Channel Target Rail */}
      <aside className="pcl-mods-rail" aria-label={zh ? '模组导航与目录选择' : 'Mod navigation and target'}>
        <div className="pcl-mods-target-box">
          <div className="pcl-mods-target-head">
            <span>{zh ? '游戏目录' : 'Target Folder'}</span>
            <button
              type="button"
              className="pcl-mods-icon-link"
              onClick={() => {
                forceCoreRefreshRef.current = true;
                void target.refresh().then(() => setRevision((v) => v + 1));
              }}
              disabled={target.busy || Boolean(pendingKey)}
              title={zh ? '重新检测目录' : 'Rescan'}
            >
              <RefreshCw size={13} className={target.busy ? 'pcl-spin' : ''} />
            </button>
          </div>
          <select
            aria-label={zh ? '选择游戏渠道' : 'Select edition'}
            value={target.channel}
            disabled={Boolean(pendingKey)}
            onChange={(e) => target.setChannel(e.target.value)}
          >
            {extensionChannels.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label={zh ? '选择安装目录' : 'Select folder'}
            value={installationId}
            disabled={Boolean(pendingKey) || !target.options.length}
            onChange={(e) => target.select(e.target.value)}
          >
            {!target.options.length && (
              <option value="">{target.busy ? (zh ? '检测中…' : 'Scanning…') : zh ? '未找到目录' : 'No folder found'}</option>
            )}
            {target.options.map((g) => (
              <option key={g.id} value={g.id}>
                {g.install_path}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="pcl-mods-folder-toggle"
            onClick={() => setFolderEditorOpen((v) => !v)}
          >
            <FolderOpen size={13} />
            <span>{folderEditorOpen ? (zh ? '收起路径输入' : 'Hide path input') : zh ? '手动指定目录' : 'Set custom path'}</span>
          </button>
          {folderEditorOpen && (
            <form
              className="pcl-mods-path-form"
              onSubmit={(e) => {
                e.preventDefault();
                void target.save().then(() => setFolderEditorOpen(false));
              }}
            >
              <input
                value={target.path}
                onChange={(e) => target.setPath(e.target.value)}
                placeholder={zh ? '粘贴游戏文件夹路径' : 'Paste game folder path'}
              />
              <button
                type="submit"
                className="btn btn-secondary btn-sm"
                disabled={target.busy || !target.path.trim()}
              >
                {zh ? '保存' : 'Save'}
              </button>
            </form>
          )}
          {target.error && <p className="pcl-mods-rail-err">{target.error}</p>}
        </div>

        <nav className="pcl-mods-rail-nav">
          <div className="pcl-rail-group-label">{zh ? '本地管理' : 'Local Manager'}</div>
          <button
            type="button"
            className={`pcl-rail-item ${railSection === 'installed' ? 'is-active' : ''}`}
            onClick={() => setRailSection('installed')}
          >
            <CheckCircle2 size={16} />
            <span>{zh ? '已安装 Mod' : 'Installed Mods'}</span>
            <span className="pcl-rail-badge">{allInstalledCount}</span>
          </button>
          <button
            type="button"
            className={`pcl-rail-item ${railSection === 'local' ? 'is-active' : ''}`}
            onClick={() => setRailSection('local')}
          >
            <Upload size={16} />
            <span>{zh ? '导入与外部 Mod' : 'Import & External'}</span>
          </button>
          <button
            type="button"
            className={`pcl-rail-item ${railSection === 'inspect' ? 'is-active' : ''}`}
            onClick={() => setRailSection('inspect')}
          >
            <ScanSearch size={16} />
            <span>{zh ? '检测本地包' : 'Inspect Local Package'}</span>
          </button>

          <div className="pcl-rail-group-label">{zh ? '探索与筛选' : 'Discover & Filter'}</div>
          <button
            type="button"
            className={`pcl-rail-item ${railSection === 'discover' && categoryFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => selectDiscoverCategory('all')}
          >
            <Blocks size={16} />
            <span>{zh ? '全部模组' : 'All Mods'}</span>
            <span className="pcl-rail-badge">{unifiedItems.length}</span>
          </button>
          {WORKSHOP_CATEGORIES.filter((c) => c.id !== 'all').map((cat) => {
            const CatIcon = getCategoryVisualMeta(cat.id).Icon;
            const catCount = unifiedItems.filter((i) => i.category === cat.id).length;
            return (
              <button
                key={cat.id}
                type="button"
                className={`pcl-rail-item ${railSection === 'discover' && categoryFilter === cat.id ? 'is-active' : ''}`}
                onClick={() => selectDiscoverCategory(cat.id)}
              >
                <CatIcon size={16} />
                <span>{zh ? cat.labelZh : cat.labelEn}</span>
                <span className="pcl-rail-badge">{catCount}</span>
              </button>
            );
          })}
        </nav>

        <div className="pcl-mods-rail-foot">
          <button
            type="button"
            className="pcl-rail-ext-link"
            onClick={() => void openExternalUrl("https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/platform-account?tab=projects")}
          >
            <Plus size={14} />
            <span>{zh ? '发布 Mod 项目' : 'Publish Mod Project'}</span>
          </button>
          <button type="button" className="pcl-rail-ext-link" onClick={() => void openExternalUrl("https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/extensions/creator")}>
            <Paintbrush size={14} />
            <span>{zh ? '创作者投稿入口' : 'Creator Portal'}</span>
          </button>
          <button
            type="button"
            className="pcl-rail-ext-link"
            onClick={() => void openExternalUrl('https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/extensions/mods')}
          >
            <ExternalLink size={14} />
            <span>{zh ? '网页版模组工坊' : 'Web Workshop'}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="pcl-mods-main">
        {notice && (
          <div className={`pcl-mods-notice is-${notice.kind} ${pendingKey && installProgress ? 'has-progress' : ''}`} role="status">
            <div className="pcl-mods-notice-top">
              <Info size={15} />
              <span>
                {pendingKey && installProgress
                  ? `${notice.text} ${installProgress.detail}${installProgress.totalBytes > 0 ? ` (${formatModBytes(installProgress.downloadedBytes)} / ${formatModBytes(installProgress.totalBytes)})` : ''}`
                  : notice.text}
              </span>
              {pendingKey && installProgress && (
                <strong className="pcl-mods-notice-pct pcl-tabular">{installProgress.percent}%</strong>
              )}
              <button type="button" onClick={() => setNotice(null)} aria-label={zh ? '关闭提示' : 'Dismiss'}>
                <X size={14} />
              </button>
            </div>
            {pendingKey && installProgress && (
              <div
                className="pcl-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={installProgress.percent}
              >
                <div className="pcl-progress-fill" style={{ width: `${installProgress.percent}%` }} />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="pcl-error-banner" role="alert">
            <span>{error}</span>
            <div className="pcl-error-banner-actions">
              {conflictRetryItem && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={Boolean(pendingKey) || !localReady}
                  onClick={() => void handleInstall(conflictRetryItem, true)}
                >
                  <ShieldCheck size={13} />
                  <span>{zh ? '跳过冲突文件继续安装' : 'Skip Conflicts & Install'}</span>
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setError('');
                  setConflictRetryItem(null);
                }}
              >
                {zh ? '关闭' : 'Dismiss'}
              </button>
            </div>
          </div>
        )}

        {(railSection === 'installed' || railSection === 'discover') && (
          <div className="pcl-mods-stack" style={{ marginBottom: 14 }}>
            <section className="pcl-card pcl-core-plugin-card">
              <div className="pcl-core-plugin-head">
                <div className="pcl-core-plugin-title">
                  <span className="pcl-card-icon">
                    <ShieldCheck size={16} />
                  </span>
                  <div>
                    <div className="pcl-core-plugin-name-row">
                      <strong>{zh ? '星枢官方插件 Mod（核心框架）' : 'XingShu Official Plugin Mod (Core)'}</strong>
                      <span
                        className={`pcl-core-plugin-badge ${
                          disk?.state === 'installed'
                            ? 'is-installed'
                            : disk?.state === 'updateAvailable'
                              ? 'is-update'
                              : disk?.state === 'incompatible' || disk?.state === 'resourceMissing'
                                ? 'is-warn'
                                : 'is-optional'
                        }`}
                      >
                        {!localReady
                          ? zh ? '待选择游戏目录' : 'Select game folder'
                          : disk?.state === 'installed'
                            ? zh ? `已安装 ${disk.version?.replace(/^1\\.0\\.0-game-ui-/, '') || ''}` : 'Installed'
                            : disk?.state === 'updateAvailable'
                              ? zh
                                ? `已安装旧版 ${disk.version?.replace(/^1\\.0\\.0-game-ui-/, '') || ''} · 可升级至 ${disk.availableVersion?.replace(/^1\\.0\\.0-game-ui-/, '') || ''}`
                                : `Installed ${disk.version?.replace(/^1\\.0\\.0-game-ui-/, '') || ''} · Update available`
                              : disk?.state === 'installable'
                                ? zh ? '未安装 · 当前纯净启动' : 'Not installed · Vanilla'
                                : disk?.state === 'incompatible'
                                  ? zh ? '资源版本需核对' : 'Version mismatch'
                                  : disk?.state === 'resourceMissing'
                                    ? zh ? '需先启动一次游戏' : 'Launch game once first'
                                    : zh ? '状态检查中' : 'Checking'}
                      </span>
                    </div>
                    <p>
                      {disk?.state === 'updateAvailable'
                        ? zh
                          ? `当前游戏目录仍安装着旧版星枢插件（${disk.version?.replace(/^1\\.0\\.0-game-ui-/, '') || '旧版'}），尚未还原为官方原版。可点击右侧「更新插件至新版」升级修复，或点击「卸载并还原原版」恢复纯净客户端。`
                          : `An older XingShu plugin (${disk.version || 'older'}) is still installed in this game folder. Update to the latest version or uninstall & restore to vanilla.`
                        : zh
                          ? '星枢默认纯净启动官方游戏。仅当你需要启用下方 19 项局内功能或使用游戏内开房时，才需要在此安装此核心插件；随时可一键卸载还原回官方原版。'
                          : 'Hub launches the vanilla game cleanly by default. Install this optional core plugin to enable in-game modules and live room control, or restore to vanilla anytime.'}
                    </p>
                  </div>
                </div>

                <div className="pcl-core-plugin-actions">
                  {(disk?.state === 'installable' || disk?.state === 'updateAvailable') && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!localReady || Boolean(pendingKey)}
                      onClick={() => void handleInstallCorePlugin(false)}
                    >
                      <Download size={14} />
                      <span>
                        {disk.state === 'updateAvailable'
                          ? zh ? '更新插件至新版' : 'Update Plugin'
                          : zh ? '安装官方插件 Mod' : 'Install Plugin Mod'}
                      </span>
                    </button>
                  )}
                  {localReady && disk?.installerAvailable && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={Boolean(pendingKey) || checkingConflict}
                      onClick={() => void handleCheckCoreConflict()}
                    >
                      <ScanSearch size={14} />
                      <span>{checkingConflict ? (zh ? '扫描中…' : 'Scanning…') : (zh ? '检查冲突与状态' : 'Inspect Conflicts')}</span>
                    </button>
                  )}
                  {(disk?.state === 'installed' || disk?.state === 'updateAvailable' || disk?.state === 'incompatible') && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={!localReady || Boolean(pendingKey)}
                      onClick={() => void handleUninstallCorePlugin()}
                    >
                      <RotateCcw size={14} />
                      <span>{zh ? '卸载并还原原版' : 'Uninstall & Restore'}</span>
                    </button>
                  )}
                </div>
              </div>

              {conflictReport && (
                <div className={`pcl-core-conflict-panel ${conflictReport.hasConflicts ? 'has-conflicts' : ''}`}>
                  <div className="pcl-core-conflict-head">
                    <div>
                      <strong>{conflictReport.summary}</strong>
                      <div className="pcl-core-conflict-meta">
                        <span>
                          {zh ? '目录状态：' : 'Target state: '}
                          {conflictReport.targetState === 'installed'
                            ? zh ? '已安装最新版' : 'Latest installed'
                            : conflictReport.targetState === 'vanilla'
                              ? zh ? '官方原版（纯净）' : 'Official vanilla'
                              : conflictReport.targetState === 'updateAvailable'
                                ? zh ? '存在旧版星枢残留（可更新或卸载还原）' : 'Older XingShu runtime installed'
                                : conflictReport.targetState === 'conflict'
                                  ? zh ? '检测到同位置第三方冲突插件' : 'Third-party conflict detected'
                                  : zh ? '资源指纹不匹配' : 'Hash mismatch'}
                        </span>
                        <span>
                          {conflictReport.hasBackup
                            ? conflictReport.backupIsVanilla
                              ? zh ? ' · 已找到官方原版备份（支持一键还原）' : ' · Vanilla backup ready'
                              : zh ? ' · 已找到历史安装前备份' : ' · Prior backup available'
                            : zh ? ' · 当前尚无安装前备份（安装新版时将自动备份）' : ' · No prior backup yet'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="pcl-btn-mini"
                      onClick={() => setConflictReport(null)}
                      aria-label={zh ? '收起检查报告' : 'Close inspection report'}
                    >
                      <X size={13} />
                    </button>
                  </div>

                  {conflictReport.items.length > 0 && (
                    <ul className="pcl-core-conflict-list">
                      {conflictReport.items.map((item, idx) => (
                        <li key={`${item.category}-${item.relativePath}-${idx}`}>
                          <span className="pcl-core-conflict-plugin">{item.pluginName}</span>
                          <code>{item.relativePath}</code>
                        </li>
                      ))}
                    </ul>
                  )}

                  {conflictReport.hasConflicts && (
                    <div className="pcl-core-conflict-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!localReady || Boolean(pendingKey)}
                        onClick={() => void handleInstallCorePlugin(true)}
                      >
                        <ShieldCheck size={14} />
                        <span>
                          {zh
                            ? '确认备份以上冲突文件并安装星枢官方插件 Mod'
                            : 'Confirm Backup & Install XingShu Plugin Mod'}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {pendingKey === 'xingshu.core.plugin' && componentProgress && (
                <div className="pcl-mod-inline-progress" style={{ marginTop: 10 }}>
                  <div className="pcl-mod-inline-progress-head pcl-tabular">
                    <span>{componentProgress.detail}</span>
                    <span>
                      {componentProgress.totalBytes > 0
                        ? `${formatModBytes(componentProgress.downloadedBytes)} / ${formatModBytes(componentProgress.totalBytes)} · `
                        : ''}
                      {componentProgress.percent}%
                    </span>
                  </div>
                  <div
                    className="pcl-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={componentProgress.percent}
                  >
                    <div className="pcl-progress-fill" style={{ width: `${componentProgress.percent}%` }} />
                  </div>
                </div>
              )}
            </section>

            <section className="pcl-card pcl-official-batch-bar">
              <div className="pcl-official-batch-info">
                <div className="pcl-official-batch-title">
                  <Blocks size={16} />
                  <strong>{zh ? '星枢官方功能模组（19 项独立模块）' : 'XingShu Official Feature Modules (19)'}</strong>
                  <span className="pcl-count-chip pcl-tabular">
                    {zh
                      ? `已开启 ${enabledOfficialCount} / ${officialModules.length} 项`
                      : `${enabledOfficialCount} / ${officialModules.length} active`}
                  </span>
                </div>
                <p>
                  {zh
                    ? '支持「一键全部安装并启用」（自动补全核心插件 Mod），也可以不安装或在下方逐项自由开关。'
                    : 'Install and enable all 19 modules at once (includes core plugin), or toggle them individually below.'}
                </p>
              </div>
              <div className="pcl-official-batch-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm pcl-tabular"
                  disabled={!localReady || Boolean(pendingKey)}
                  onClick={() => void handleInstallAllOfficialMods()}
                >
                  <Download size={14} />
                  <span>{zh ? `一键安装全部官方模组 (${officialModules.length} 项)` : `Install All (${officialModules.length})`}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!localReady || Boolean(pendingKey) || installedOfficialCount === 0}
                  onClick={() => void handleUninstallAllOfficialMods()}
                >
                  <RotateCcw size={14} />
                  <span>{zh ? '一键全部卸载' : 'Uninstall All'}</span>
                </button>
              </div>
              {pendingKey === 'xingshu.official.batch' && installProgress && (
                <div className="pcl-mod-inline-progress" style={{ marginTop: 10 }}>
                  <div className="pcl-mod-inline-progress-head pcl-tabular">
                    <span>{installProgress.detail}</span>
                    <span>{installProgress.percent}%</span>
                  </div>
                  <div
                    className="pcl-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={installProgress.percent}
                  >
                    <div className="pcl-progress-fill" style={{ width: `${installProgress.percent}%` }} />
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {railSection === 'installed' && (
          <div className="pcl-mods-stack">
            <section className="pcl-card pcl-mod-toolbar-card">
              <label className="pcl-mod-search-input">
                <Search size={16} />
                <input
                  type="search"
                  value={installedQuery}
                  onChange={(e) => setInstalledQuery(e.target.value)}
                  placeholder={zh ? '搜索已安装 Mod 名称、描述或标识…' : 'Search installed mods by name, description, or ID…'}
                />
              </label>
              <div className="pcl-mod-toolbar-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!installationId}
                  onClick={() => void handleOpenFolder()}
                >
                  <FolderOpen size={14} />
                  <span>{zh ? '打开文件夹' : 'Open Folder'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setRailSection('inspect')}
                >
                  <Upload size={14} />
                  <span>{zh ? '从文件安装' : 'Install File'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setRailSection('discover')}
                >
                  <Download size={14} />
                  <span>{zh ? '下载新 Mod' : 'Get More Mods'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    forceCoreRefreshRef.current = true;
                    setRevision((v) => v + 1);
                  }}
                >
                  <RefreshCw size={14} />
                  <span>{zh ? '刷新' : 'Refresh'}</span>
                </button>
              </div>
            </section>

            <section className="pcl-card pcl-mod-list-card">
              <header className="pcl-card-head pcl-mod-list-head">
                <div className="pcl-mod-filter-pills">
                  <button
                    type="button"
                    className={`pcl-mod-pill ${installedFilter === 'all' ? 'is-selected' : ''}`}
                    onClick={() => setInstalledFilter('all')}
                  >
                    {zh ? `全部 (${allInstalledCount})` : `All (${allInstalledCount})`}
                  </button>
                  <button
                    type="button"
                    className={`pcl-mod-pill ${installedFilter === 'enabled' ? 'is-selected' : ''}`}
                    onClick={() => setInstalledFilter('enabled')}
                  >
                    {zh ? `已开启 (${enabledInstalledCount})` : `Enabled (${enabledInstalledCount})`}
                  </button>
                  <button
                    type="button"
                    className={`pcl-mod-pill ${installedFilter === 'disabled' ? 'is-selected' : ''}`}
                    onClick={() => setInstalledFilter('disabled')}
                  >
                    {zh ? `已关闭 / 已下载 (${disabledInstalledCount})` : `Off / Downloaded (${disabledInstalledCount})`}
                  </button>
                  <button
                    type="button"
                    className={`pcl-mod-pill ${installedFilter === 'official' ? 'is-selected' : ''}`}
                    onClick={() => setInstalledFilter('official')}
                  >
                    {zh ? `官方模块 (${installedOfficialCount})` : `Official (${installedOfficialCount})`}
                  </button>
                  <button
                    type="button"
                    className={`pcl-mod-pill ${installedFilter === 'community' ? 'is-selected' : ''}`}
                    onClick={() => setInstalledFilter('community')}
                  >
                    {zh ? `工坊与本地 (${installedCommunityCount})` : `Workshop & Local (${installedCommunityCount})`}
                  </button>
                </div>
                <span className="pcl-count-chip pcl-mod-path-chip" title={target.selected?.install_path || ''}>
                  {target.selected?.install_path || (zh ? '未选择目录' : 'No folder')}
                </span>
              </header>

              {installedItems.length === 0 ? (
                <div className="pcl-mods-empty">
                  <Puzzle size={28} />
                  <strong>{zh ? '当前筛选下暂无已安装 Mod' : 'No installed mods match'}</strong>
                  <p>
                    {zh
                      ? '可点击上方「下载新 Mod」启用 19 项官方功能模块，或从社区工坊一键安装皮肤与卡图包。'
                      : 'Explore official feature modules and community workshop packs to install your first mod.'}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setRailSection('discover')}
                  >
                    {zh ? '前往探索与下载 Mod' : 'Browse Mods'}
                  </button>
                </div>
              ) : (
                <div className="pcl-mod-rows">
                  {installedItems.map((item, idx) => (
                    <article
                      key={item.key}
                      className={`pcl-mod-row is-installed ${item.disabled || (!item.enabled && item.downloaded) ? 'is-disabled' : ''}`}
                      style={{ '--stagger-index': Math.min(idx, 12) } as React.CSSProperties}
                    >
                      {renderModBadge(item, 'sm')}
                      <div className="pcl-mod-row-body">
                        <div className="pcl-mod-row-title">
                          <strong>{item.name}</strong>
                          <code className="pcl-mod-id">{item.slug}</code>
                          {item.enabled ? (
                            <span className="pcl-mod-chip is-on">{zh ? '已开启' : 'Enabled'}</span>
                          ) : item.installed ? (
                            <span className="pcl-mod-chip is-off">{item.disabled ? (zh ? '已关闭' : 'Disabled') : (zh ? '操作未完成' : 'Needs recovery')}</span>
                          ) : (
                            <span className="pcl-mod-chip">{zh ? '已下载' : 'Downloaded'}</span>
                          )}
                        </div>
                        <p className="pcl-mod-row-desc">{item.description}</p>
                      </div>
                      <div className="pcl-mod-row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setDetailKey(item.key)}
                        >
                          {zh ? '详情' : 'Info'}
                        </button>
                        {renderActionButton(item, true)}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {railSection === 'discover' && (
          <div className="pcl-mods-stack">
            <section className="pcl-card pcl-mod-filter-card">
              <div className="pcl-mod-filter-head">
                <h2>{zh ? '筛选与搜索 Mod' : 'Search & Filter Mods'}</h2>
                <span>
                  {zh
                    ? `共 ${filteredDiscoverItems.length} / ${unifiedItems.length} 项`
                    : `${filteredDiscoverItems.length} / ${unifiedItems.length} mods`}
                </span>
              </div>

              <div className="pcl-mod-filter-grid">
                <label className="pcl-filter-field is-wide">
                  <span>{zh ? '名称' : 'Name'}</span>
                  <div className="pcl-filter-input-wrap">
                    <Search size={14} />
                    <input
                      type="search"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder={zh ? '输入 Mod 名称、作者、标签或 Bundle 名…' : 'Search name, author, tag, or bundle…'}
                    />
                  </div>
                </label>

                <label className="pcl-filter-field">
                  <span>{zh ? '来源' : 'Source'}</span>
                  <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}>
                    <option value="all">{zh ? '全部来源' : 'All Sources'}</option>
                    <option value="official">{zh ? '星枢官方 (.xspkg)' : 'XingShu Official (.xspkg)'}</option>
                    <option value="workshop">{zh ? '社区工坊' : 'Community Workshop'}</option>
                  </select>
                </label>

                <label className="pcl-filter-field">
                  <span>{zh ? '类型' : 'Category'}</span>
                  <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as WorkshopCategory)}>
                    {WORKSHOP_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {zh ? c.labelZh : c.labelEn}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="pcl-filter-field">
                  <span>{zh ? '状态' : 'Status'}</span>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                    <option value="all">{zh ? '全部状态' : 'All Status'}</option>
                    <option value="available">{zh ? '未安装' : 'Not Installed'}</option>
                    <option value="installed">{zh ? '已安装' : 'Installed'}</option>
                  </select>
                </label>

                <label className="pcl-filter-field">
                  <span>{zh ? '排序' : 'Sort'}</span>
                  <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
                    <option value="recommended">{zh ? '默认推荐' : 'Recommended'}</option>
                    <option value="name">{zh ? '名称 A–Z' : 'Name A–Z'}</option>
                    <option value="size_asc">{zh ? '体积由小到大' : 'Smallest First'}</option>
                    <option value="size_desc">{zh ? '体积由大到小' : 'Largest First'}</option>
                  </select>
                </label>
              </div>

              <div className="pcl-mod-filter-foot">
                <div className="pcl-mod-quick-tags">
                  <button
                    type="button"
                    className={`pcl-tag-chip ${tagFilter === '' ? 'is-selected' : ''}`}
                    onClick={() => setTagFilter('')}
                  >
                    {zh ? '全部标签' : 'All Tags'}
                  </button>
                  {OFFICIAL_SUB_GROUPS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`pcl-tag-chip ${tagFilter === g.labelZh ? 'is-selected' : ''}`}
                      onClick={() => setTagFilter((prev) => (prev === g.labelZh ? '' : g.labelZh))}
                    >
                      {zh ? g.labelZh : g.labelEn}
                    </button>
                  ))}
                </div>
                <div className="pcl-mod-filter-btns">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={resetDiscoverFilters}
                  >
                    {zh ? '重置条件' : 'Reset'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={workshopLoading}
                    onClick={() => {
                      forceCoreRefreshRef.current = true;
                      setRevision((v) => v + 1);
                    }}
                  >
                    <RefreshCw size={13} className={workshopLoading ? 'pcl-spin' : ''} />
                    <span>{zh ? '刷新目录' : 'Refresh'}</span>
                  </button>
                </div>
              </div>
            </section>

            {workshopError && (
              <div className="pcl-guidance-banner is-warning">
                <Info size={16} />
                <span>{zh ? `服务器暂未连接（仍可管理已安装模组）：${workshopError}` : `Workshop offline (installed mods are still available): ${workshopError}`}</span>
              </div>
            )}

            <section className="pcl-card">
              {filteredDiscoverItems.length === 0 ? (
                <div className="pcl-mods-empty">
                  <Search size={26} />
                  <strong>{zh ? '没有符合筛选条件的模组' : 'No matching mods found'}</strong>
                  <p>{zh ? '尝试清空搜索关键词或点击重置条件。' : 'Try clearing your search or resetting filters.'}</p>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={resetDiscoverFilters}>
                    {zh ? '重置筛选条件' : 'Reset Filters'}
                  </button>
                </div>
              ) : (
                <div className="pcl-mod-rows">
                  {filteredDiscoverItems.map((item, idx) => (
                    <article
                      key={item.key}
                      className={`pcl-mod-row is-discover ${item.installed ? 'is-installed' : ''}`}
                      style={{ '--stagger-index': Math.min(idx, 12) } as React.CSSProperties}
                    >
                      {renderModBadge(item, 'md')}
                      <div className="pcl-mod-row-body">
                        <div className="pcl-mod-row-title">
                          <strong>{item.name}</strong>
                          <span className="pcl-mod-author">{item.author}</span>
                          {item.enabled && <span className="pcl-mod-chip is-on">{zh ? '已开启' : 'Enabled'}</span>}
                          {item.installed && !item.enabled && (
                            <span className="pcl-mod-chip is-off">{item.disabled ? (zh ? '已关闭' : 'Disabled') : (zh ? '操作未完成' : 'Needs recovery')}</span>
                          )}
                          {!item.installed && item.downloaded && (
                            <span className="pcl-mod-chip">{zh ? '已下载' : 'Downloaded'}</span>
                          )}
                          {item.sourceKind === 'official' && !item.installed && !item.downloaded && (
                            <span className="pcl-mod-chip">{zh ? '未安装' : 'Not installed'}</span>
                          )}
                          {modPlatformSummaryBadge(item, zh) && (
                            <span className="pcl-mod-chip is-multi pcl-tabular">
                              {modPlatformSummaryBadge(item, zh)}
                            </span>
                          )}
                        </div>
                        <div className="pcl-mod-row-tags">
                          <span className="pcl-mod-cat-pill">{item.categoryLabel}</span>
                          {item.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="pcl-mod-tag-pill">
                              {tag}
                            </span>
                          ))}
                        </div>
                        <p className="pcl-mod-row-desc">{item.description}</p>
                        <div className="pcl-mod-row-meta">
                          <span>{installKindLabel(item.installKind)}</span>
                          {item.version && <span>v{item.version}</span>}
                          {item.sizeBytes > 0 && <span className="pcl-tabular">{formatModBytes(item.sizeBytes)}</span>}
                          <span>{sanitizeWorkshopPlatforms(item.platforms).slice(0, 3).join(' / ')}</span>
                        </div>
                        {activeProgressFor(item) && (
                          <div className="pcl-mod-inline-progress">
                            <div className="pcl-mod-inline-progress-head pcl-tabular">
                              <span>{activeProgressFor(item)!.detail}</span>
                              <span>
                                {activeProgressFor(item)!.totalBytes > 0
                                  ? `${formatModBytes(activeProgressFor(item)!.downloadedBytes)} / ${formatModBytes(activeProgressFor(item)!.totalBytes)} · `
                                  : ''}
                                {activeProgressFor(item)!.percent}%
                              </span>
                            </div>
                            <div
                              className="pcl-progress-track"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={activeProgressFor(item)!.percent}
                            >
                              <div className="pcl-progress-fill" style={{ width: `${activeProgressFor(item)!.percent}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="pcl-mod-row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setDetailKey(item.key)}
                        >
                          <Info size={13} />
                          <span>{zh ? '详情' : 'Info'}</span>
                        </button>
                        {renderActionButton(item)}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {railSection === 'inspect' && (
          <div className="pcl-mods-stack">
            <ModDropInspector
              installationId={installationId || null}
              onBusy={(busy) => setPendingKey(busy ? 'drop' : '')}
              disabled={Boolean(pendingKey)}
              onInstalled={() => setRevision((v) => v + 1)}
              showInstalled={false}
              onOpenInstalled={() => setRailSection('installed')}
            />
          </div>
        )}

        {railSection === 'local' && (
          <div className="pcl-mods-stack">
            <section className="pcl-card pcl-mod-toolbar-card">
              <div className="pcl-mod-row-body">
                <strong>{zh ? '导入本地 Mod' : 'Import a local mod'}</strong>
                <p className="pcl-mod-row-desc">{zh ? '选择或拖入模组包，核对适配和替换文件后安装。' : 'Choose or drop a mod package to check its compatibility before installing.'}</p>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setRailSection('inspect')}>
                <ScanSearch size={14} />
                {zh ? '检测本地包' : 'Inspect Local Package'}
              </button>
            </section>
            {target.selected ? (
              <ExternalModsPanel
                key={`ext-${target.selected.id}`}
                installationId={target.selected.id}
                onBusy={(busy) => setPendingKey(busy ? 'ext' : '')}
                disabled={Boolean(pendingKey)}
                showInstalled={false}
                onChanged={() => setRevision((v) => v + 1)}
              />
            ) : (
              <section className="pcl-card">
                <div className="pcl-mods-empty">
                  <FolderOpen size={26} />
                  <strong>{zh ? '请先在左侧选择游戏安装目录' : 'Select a game folder on the left first'}</strong>
                  <p>{zh ? '选择安装目录后即可验证并导入本地 .xspkg / .zip 或排查外部模组。' : 'Choose an installation directory to import local archives or inspect external mods.'}</p>
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {detailItem && (() => {
        const detailWs = detailFull?.id === detailItem.workshopItem?.id
          ? detailFull
          : detailItem.workshopItem || null;
        const detailVersions: WorkshopVersionEntry[] = detailWs?.versions || [];
        const hasMultipleVersions = detailVersions.length > 1 || (detailWs?.versionCount ?? 0) > 1;
        const activeReactions = detailWs?.reactions || [];
        const activeReactionTotal = detailWs?.reactionTotal
          ?? activeReactions.reduce((sum, entry) => sum + entry.count, 0);
        const detailGallery = detailWs?.gallery || [];
        const webModUrl = detailItem.externalUrl
          || (detailWs
            ? `https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/mod/${encodeURIComponent(detailWs.slug || detailWs.id)}`
            : null);
        const modalRoot = typeof document !== 'undefined'
          ? (document.querySelector('.launcher-frame') as HTMLElement | null) ?? document.body
          : null;
        const handleReactionUpdated = (next: {
          reactions: NonNullable<WorkshopModItem['reactions']>;
          reactionTotal: number;
          viewerEmoteId: string | null;
        }) => {
          if (!detailWs) return;
          const targetId = detailWs.id;
          setDetailFull((prev) =>
            prev && prev.id === targetId
              ? {
                  ...prev,
                  reactions: next.reactions,
                  reactionTotal: next.reactionTotal,
                  viewerState: {
                    following: prev.viewerState?.following ?? false,
                    bookmarked: prev.viewerState?.bookmarked ?? false,
                    isOwner: prev.viewerState?.isOwner ?? false,
                    viewerEmoteId: next.viewerEmoteId,
                  },
                }
              : prev,
          );
          setWorkshopItems((prev) =>
            prev.map((w) =>
              w.id === targetId
                ? {
                    ...w,
                    reactions: next.reactions,
                    reactionTotal: next.reactionTotal,
                    viewerState: w.viewerState
                      ? { ...w.viewerState, viewerEmoteId: next.viewerEmoteId }
                      : {
                          following: false,
                          bookmarked: false,
                          isOwner: false,
                          viewerEmoteId: next.viewerEmoteId,
                        },
                  }
                : w,
            ),
          );
        };

        if (!modalRoot) return null;

        return createPortal(
          <div
            className="pcl-mod-modal-backdrop"
            data-pcl-theme={theme}
            onClick={() => setDetailKey(null)}
          >
            <div
              className="pcl-mod-modal"
              role="dialog"
              aria-modal="true"
              aria-label={detailItem.name}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="pcl-mod-modal-head">
                {renderModBadge(detailItem, 'lg')}
                <div className="pcl-mod-modal-title">
                  <div className="pcl-mod-modal-title-row">
                    <h3>{detailItem.name}</h3>
                    <span className="pcl-mod-chip pcl-tabular">v{detailItem.version}</span>
                    {detailItem.installed ? (
                      <span className={`pcl-mod-chip ${detailItem.enabled ? 'is-on' : 'is-off'}`}>
                        {detailItem.enabled ? (zh ? '已开启' : 'Enabled') : zh ? '已关闭' : 'Disabled'}
                      </span>
                    ) : (
                      <span className="pcl-mod-chip">{zh ? '未安装' : 'Not installed'}</span>
                    )}
                  </div>
                  <p className="pcl-mod-modal-sub pcl-tabular">
                    <span>
                      {detailItem.author} · {detailItem.categoryLabel} · {installKindLabel(detailItem.installKind)}
                    </span>
                    {(detailWs?.downloads ?? 0) > 0 && (
                      <span>· {detailWs?.downloads} {zh ? '次下载' : 'downloads'}</span>
                    )}
                  </p>
                  {detailItem.tags.length > 0 && (
                    <div className="pcl-mod-modal-tags">
                      {detailItem.tags.slice(0, 5).map((tag) => (
                        <span key={tag} className="pcl-mod-tag-pill">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="pcl-mod-modal-close"
                  onClick={() => setDetailKey(null)}
                  aria-label={zh ? '关闭详情' : 'Close'}
                >
                  <X size={16} />
                </button>
              </header>

              <div className="pcl-mod-modal-body">
                {detailWs && (
                  <section className="pcl-mod-modal-reactions" aria-label={zh ? '角色表情回应' : 'Reactions'}>
                    <div className="pcl-mod-modal-reactions-head">
                      <strong>{zh ? '角色表情回应' : 'Character Reactions'}</strong>
                      <span className="pcl-tabular">
                        {activeReactionTotal > 0
                          ? zh
                            ? `共 ${activeReactionTotal} 次回应`
                            : `${activeReactionTotal} reactions`
                          : zh
                            ? '选一个游戏角色表情回应吧'
                            : 'Pick a character sticker reaction'}
                      </span>
                    </div>
                    <EmoteReactionBar
                      modId={detailWs.id}
                      reactions={activeReactions}
                      reactionTotal={activeReactionTotal}
                      viewerEmoteId={detailWs.viewerState?.viewerEmoteId}
                      mode="detail"
                      onUpdated={handleReactionUpdated}
                    />
                  </section>
                )}

                {detailGallery.length > 0 && (
                  <section className="pcl-mod-modal-gallery" aria-label={zh ? '效果展示' : 'Gallery'}>
                    {detailGallery.map((img) => {
                      const imgUrl = workshopAssetUrl(img.url);
                      return (
                        <button
                          key={img.id}
                          type="button"
                          className="pcl-mod-modal-thumb"
                          onClick={() => setLightboxImage({ url: imgUrl, caption: img.caption })}
                          title={img.caption || detailItem.name}
                        >
                          <img src={imgUrl} alt={img.caption || detailItem.name} loading="lazy" />
                        </button>
                      );
                    })}
                  </section>
                )}

                <div className="pcl-mod-modal-desc">
                  {detailWs?.longDescription || detailItem.description}
                </div>

                <div className="pcl-mod-modal-meta">
                  <div>
                    <small>{zh ? '标识符' : 'Identifier'}</small>
                    <code>{detailItem.id}</code>
                  </div>
                  <div>
                    <small>{zh ? '资源体积' : 'Size'}</small>
                    <strong className="pcl-tabular">
                      {detailItem.sizeBytes > 0 ? formatModBytes(detailItem.sizeBytes) : zh ? '本地内置包' : 'Built-in'}
                    </strong>
                  </div>
                  <div>
                    <small>{zh ? '支持方案' : 'Distribution'}</small>
                    <strong>{installKindLabel(detailItem.installKind)}</strong>
                  </div>
                  <div className="is-full">
                    <small>{zh ? '适用渠道' : 'Supported Channels'}</small>
                    <div className="pcl-mod-modal-platforms">
                      {detailItem.platforms.map((plat) => (
                        <span key={plat} className="pcl-mod-chip">
                          {plat}
                        </span>
                      ))}
                    </div>
                  </div>
                  {detailItem.sha256 && (
                    <div className="is-full">
                      <small>SHA-256</small>
                      <code>{detailItem.sha256}</code>
                    </div>
                  )}
                  {detailItem.targetInfo && (
                    <div className="is-full">
                      <small>{zh ? '目标路径' : 'Target'}</small>
                      <code>{detailItem.targetInfo}</code>
                    </div>
                  )}
                </div>

                {hasMultipleVersions && (
                  <div className="pcl-mod-modal-versions">
                    <div className="pcl-mod-modal-versions-head">
                      <strong>{zh ? '可选版本与平台方案' : 'Available Editions & Versions'}</strong>
                      <span className="pcl-tabular">
                        {detailLoading && detailVersions.length === 0
                          ? zh
                            ? '加载中…'
                            : 'Loading…'
                          : zh
                            ? `共 ${detailVersions.length} 个版本`
                            : `${detailVersions.length} versions`}
                      </span>
                    </div>
                    <div className="pcl-mod-ver-list">
                      {detailVersions.map((ver, idx) => {
                        const verUrl = ver.downloadUrl ? workshopAssetUrl(ver.downloadUrl) : '';
                        const platText = ver.platformLabel || ver.platforms.join(' / ');
                        return (
                          <div key={ver.id || `${ver.version}-${idx}`} className="pcl-mod-ver-row">
                            <div className="pcl-mod-ver-info">
                              <div className="pcl-mod-ver-title">
                                <strong>{ver.title || ver.fileName || `v${ver.version}`}</strong>
                                <span className="pcl-mod-chip pcl-tabular">v{ver.version}</span>
                                {platText && <span className="pcl-mod-chip is-multi">{platText}</span>}
                              </div>
                              <div className="pcl-mod-ver-sub pcl-tabular">
                                <span>{ver.fileName}</span>
                                {ver.sizeBytes > 0 && <span>· {formatModBytes(ver.sizeBytes)}</span>}
                                {ver.gameVersion && <span>· Game {ver.gameVersion}</span>}
                              </div>
                              {ver.notes && <p className="pcl-mod-ver-note">{ver.notes}</p>}
                            </div>
                            {verUrl && (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => void openExternalUrl(verUrl)}
                              >
                                <Download size={13} />
                                <span>{zh ? '下载' : 'Download'}</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <footer className="pcl-mod-modal-foot">
                <div className="pcl-mod-modal-foot-links">
                  {webModUrl && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void openExternalUrl(webModUrl)}
                    >
                      <ExternalLink size={13} />
                      <span>{zh ? '网页工坊查看' : 'View on Web'}</span>
                    </button>
                  )}
                </div>
                <div className="pcl-mod-modal-foot-actions">
                  {renderActionButton(detailItem)}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetailKey(null)}>
                    {zh ? '关闭' : 'Close'}
                  </button>
                </div>
              </footer>
            </div>

            {lightboxImage && (
              <div
                className="pcl-mod-lightbox"
                role="dialog"
                aria-modal="true"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxImage(null);
                }}
              >
                <div className="pcl-mod-lightbox-inner" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="pcl-mod-modal-close pcl-mod-lightbox-close"
                    onClick={() => setLightboxImage(null)}
                    aria-label={zh ? '关闭预览图' : 'Close image'}
                  >
                    <X size={16} />
                  </button>
                  <img src={lightboxImage.url} alt={lightboxImage.caption || detailItem.name} />
                  {lightboxImage.caption && <p>{lightboxImage.caption}</p>}
                </div>
              </div>
            )}
          </div>,
          modalRoot,
        );
      })()}
    </div>
  );
}
