import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Coins,
  Eye,
  Film,
  FolderOpen,
  Gamepad2,
  History,
  Layers,
  MapPin,
  Radio,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

export const MAX_PINNED_TOP_TOOLS = 6;
const STORAGE_KEY = 'xingshu.launcher.pinnedTools.v1';
const CHANGE_EVENT = 'xingshu:pinned-tools-changed';

export type PinnableToolGroup = 'online' | 'player' | 'codex' | 'launcher';

export interface PinnableToolDef {
  key: string;
  to: string;
  group: PinnableToolGroup;
  Icon: LucideIcon;
  shortZh: string;
  shortEn: string;
  zh: string;
  en: string;
  detailZh: string;
  detailEn: string;
}

export const PINNABLE_TOOLS: readonly PinnableToolDef[] = [
  {
    key: 'room',
    to: '/room',
    group: 'online',
    Icon: Gamepad2,
    shortZh: '开房',
    shortEn: 'Room',
    zh: '星枢开房',
    en: 'XingShu Room',
    detailZh: '游戏内实时发起建房、修改房规、踢人与开局',
    detailEn: 'Create rooms, adjust settings, kick players and start in-game',
  },
  {
    key: 'spectator',
    to: '/spectator',
    group: 'online',
    Icon: Eye,
    shortZh: '观战',
    shortEn: 'Spec',
    zh: '星枢观战',
    en: 'Spectator',
    detailZh: '查看已连接的观战会话',
    detailEn: 'View connected spectator sessions',
  },
  {
    key: 'bridge',
    to: '/bridge',
    group: 'online',
    Icon: Radio,
    shortZh: '网桥',
    shortEn: 'Bridge',
    zh: '星枢网桥',
    en: 'Connection bridge',
    detailZh: '查看本机网桥连接和日志',
    detailEn: 'Inspect local bridge connections and logs',
  },
  {
    key: 'replay',
    to: '/player/replay',
    group: 'player',
    Icon: Film,
    shortZh: '回放',
    shortEn: 'Replay',
    zh: '回放分析',
    en: 'Replay analysis',
    detailZh: '按对局编号或回放文件分析',
    detailEn: 'Analyze by match ID or replay file',
  },
  {
    key: 'profile',
    to: '/player/profile',
    group: 'player',
    Icon: UserRound,
    shortZh: '资料',
    shortEn: 'Profile',
    zh: '玩家资料',
    en: 'Player profile',
    detailZh: '按 UID 查看公开资料',
    detailEn: 'Look up a public profile by UID',
  },
  {
    key: 'matches',
    to: '/player/matches',
    group: 'player',
    Icon: History,
    shortZh: '战绩',
    shortEn: 'Matches',
    zh: '对战记录',
    en: 'Match history',
    detailZh: '查看战绩和对局详情',
    detailEn: 'Review match results and details',
  },
  {
    key: 'characters',
    to: '/player/characters',
    group: 'codex',
    Icon: Users,
    shortZh: '角色',
    shortEn: 'Heroes',
    zh: '角色中心',
    en: 'Characters',
    detailZh: '查询角色技能、装扮与羁绊奖励',
    detailEn: 'Browse skills, outfits and bond rewards',
  },
  {
    key: 'cards',
    to: '/player/cards',
    group: 'codex',
    Icon: Layers,
    shortZh: '卡牌',
    shortEn: 'Cards',
    zh: '卡牌图鉴',
    en: 'Cards',
    detailZh: '查询卡牌效果和异画',
    detailEn: 'Browse card effects and alternate art',
  },
  {
    key: 'chips',
    to: '/player/chips',
    group: 'codex',
    Icon: Coins,
    shortZh: '筹码',
    shortEn: 'Chips',
    zh: '筹码图鉴',
    en: 'Chips',
    detailZh: '查看筹码品质和效果',
    detailEn: 'Browse chip tiers and effects',
  },
  {
    key: 'maps',
    to: '/player/maps',
    group: 'codex',
    Icon: MapPin,
    shortZh: '地图',
    shortEn: 'Maps',
    zh: '地图与场地',
    en: 'Maps & arenas',
    detailZh: '查询地图、玩法和场地效果',
    detailEn: 'Look up maps, game modes and arena effects',
  },
  {
    key: 'accounts',
    to: '/player/accounts',
    group: 'launcher',
    Icon: BookOpen,
    shortZh: '账号',
    shortEn: 'Accounts',
    zh: '游戏账号',
    en: 'Game accounts',
    detailZh: '连接星枢账号',
    detailEn: 'Link the XingShu account',
  },
  {
    key: 'diagnostics',
    to: '/diagnostics',
    group: 'launcher',
    Icon: ShieldCheck,
    shortZh: '诊断',
    shortEn: 'Diag',
    zh: '组件诊断',
    en: 'Component diagnostics',
    detailZh: '核对游戏、启动组件和连接',
    detailEn: 'Check game installation and runtime',
  },
  {
    key: 'transactions',
    to: '/maintenance/transactions?from=tools',
    group: 'launcher',
    Icon: History,
    shortZh: '记录',
    shortEn: 'History',
    zh: '安装记录',
    en: 'Install history',
    detailZh: '查看模组安装与还原记录',
    detailEn: 'Review mod installation and rollback',
  },
  {
    key: 'backups',
    to: '/maintenance/backups?from=tools',
    group: 'launcher',
    Icon: FolderOpen,
    shortZh: '备份',
    shortEn: 'Backups',
    zh: '备份与还原',
    en: 'Backups',
    detailZh: '查看并恢复文件备份',
    detailEn: 'Review and restore file backups',
  },
];

const VALID_KEYS = new Set(PINNABLE_TOOLS.map((t) => t.key));

export function findToolByKey(key: string): PinnableToolDef | undefined {
  return PINNABLE_TOOLS.find((t) => t.key === key);
}

export function findToolByPath(pathname: string): PinnableToolDef | undefined {
  return PINNABLE_TOOLS.find((t) => {
    const clean = t.to.split('?')[0];
    return pathname === clean || pathname.startsWith(`${clean}/`);
  });
}

function normalizePinnedKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || !VALID_KEYS.has(item) || seen.has(item)) continue;
    seen.add(item);
    next.push(item);
    if (next.length >= MAX_PINNED_TOP_TOOLS) break;
  }
  return next;
}

export function getPinnedTopToolKeys(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    return normalizePinnedKeys(JSON.parse(saved));
  } catch {
    return [];
  }
}

export function savePinnedTopToolKeys(keys: string[]): string[] {
  const next = normalizePinnedKeys(keys);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage quota or sandbox errors.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  }
  return next;
}

export function usePinnedTopTools(): {
  pinnedKeys: string[];
  pinnedTools: PinnableToolDef[];
  maxCount: number;
  isPinned: (key: string) => boolean;
  togglePin: (key: string) => { changed: boolean; limitReached: boolean };
  movePin: (key: string, delta: -1 | 1) => void;
  clearPins: () => void;
} {
  const [pinnedKeys, setPinnedKeys] = useState<string[]>(getPinnedTopToolKeys);

  useEffect(() => {
    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<string[] | undefined>).detail;
      setPinnedKeys(detail ? normalizePinnedKeys(detail) : getPinnedTopToolKeys());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setPinnedKeys(getPinnedTopToolKeys());
      }
    };
    window.addEventListener(CHANGE_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const pinnedTools = useMemo(
    () =>
      pinnedKeys
        .map((k) => findToolByKey(k))
        .filter((item): item is PinnableToolDef => Boolean(item)),
    [pinnedKeys],
  );

  const isPinned = useCallback((key: string) => pinnedKeys.includes(key), [pinnedKeys]);

  const togglePin = useCallback(
    (key: string): { changed: boolean; limitReached: boolean } => {
      if (!VALID_KEYS.has(key)) return { changed: false, limitReached: false };
      if (pinnedKeys.includes(key)) {
        const next = savePinnedTopToolKeys(pinnedKeys.filter((k) => k !== key));
        setPinnedKeys(next);
        return { changed: true, limitReached: false };
      }
      if (pinnedKeys.length >= MAX_PINNED_TOP_TOOLS) {
        return { changed: false, limitReached: true };
      }
      const next = savePinnedTopToolKeys([...pinnedKeys, key]);
      setPinnedKeys(next);
      return { changed: true, limitReached: false };
    },
    [pinnedKeys],
  );

  const movePin = useCallback(
    (key: string, delta: -1 | 1) => {
      const idx = pinnedKeys.indexOf(key);
      if (idx < 0) return;
      const target = idx + delta;
      if (target < 0 || target >= pinnedKeys.length) return;
      const copy = [...pinnedKeys];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      setPinnedKeys(savePinnedTopToolKeys(copy));
    },
    [pinnedKeys],
  );

  const clearPins = useCallback(() => {
    setPinnedKeys(savePinnedTopToolKeys([]));
  }, []);

  return {
    pinnedKeys,
    pinnedTools,
    maxCount: MAX_PINNED_TOP_TOOLS,
    isPinned,
    togglePin,
    movePin,
    clearPins,
  };
}
