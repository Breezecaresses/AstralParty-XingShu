import type { LucideIcon } from 'lucide-react';
import {
  Aperture,
  BarChart3,
  Camera,
  Clock,
  Crosshair,
  Dices,
  Eye,
  Film,
  Gauge,
  HeartHandshake,
  Hourglass,
  Image as ImageIcon,
  Layers,
  MapPin,
  MessageSquareHeart,
  Puzzle,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Volume2,
  Zap,
} from 'lucide-react';

export type ModSubGroup = 'info' | 'combat' | 'utility' | 'media';

export interface LauncherModuleVisualMeta {
  slug: string;
  group: ModSubGroup;
  groupZh: string;
  groupEn: string;
  accentBg: string;
  accentFg: string;
  accentBorder: string;
  Icon: LucideIcon;
}

const GROUP_STYLES: Record<
  ModSubGroup,
  { groupZh: string; groupEn: string; accentBg: string; accentFg: string; accentBorder: string }
> = {
  info: {
    groupZh: '局内信息',
    groupEn: 'Match Info',
    accentBg: 'rgba(20, 124, 240, 0.14)',
    accentFg: '#1d76e8',
    accentBorder: 'rgba(29, 118, 232, 0.28)',
  },
  combat: {
    groupZh: '战斗推演',
    groupEn: 'Combat Calc',
    accentBg: 'rgba(217, 119, 6, 0.14)',
    accentFg: '#d97706',
    accentBorder: 'rgba(217, 119, 6, 0.28)',
  },
  utility: {
    groupZh: '互动效率',
    groupEn: 'Interaction',
    accentBg: 'rgba(16, 163, 98, 0.15)',
    accentFg: '#13995f',
    accentBorder: 'rgba(19, 153, 95, 0.28)',
  },
  media: {
    groupZh: '画面与控制',
    groupEn: 'Visual & Control',
    accentBg: 'rgba(124, 92, 224, 0.14)',
    accentFg: '#6c4fd6',
    accentBorder: 'rgba(108, 79, 214, 0.28)',
  },
};

const MODULE_SPECS: Record<string, { group: ModSubGroup; Icon: LucideIcon }> = {
  'hand-monitor': { group: 'info', Icon: Eye },
  'battle-stats': { group: 'info', Icon: BarChart3 },
  'thinking-time': { group: 'info', Icon: Clock },
  'select-map-name': { group: 'info', Icon: MapPin },
  'avatar-praise': { group: 'utility', Icon: HeartHandshake },
  'quick-thanks': { group: 'utility', Icon: MessageSquareHeart },
  'star-coin-shop': { group: 'utility', Icon: ShoppingBag },
  'defense-hint': { group: 'combat', Icon: Shield },
  'knockback-preview': { group: 'combat', Icon: Zap },
  'monster-targeting': { group: 'combat', Icon: Crosshair },
  'monster-cooldown': { group: 'combat', Icon: Hourglass },
  'battle-card-points': { group: 'combat', Icon: Dices },
  'free-camera': { group: 'media', Icon: Camera },
  'game-speed': { group: 'media', Icon: Gauge },
  'action-guard': { group: 'media', Icon: ShieldCheck },
  'replay-player': { group: 'media', Icon: Film },
  'static-portraits': { group: 'media', Icon: ImageIcon },
  'settlement-capture': { group: 'media', Icon: Aperture },
  'custom-lobby-bg': { group: 'media', Icon: Film },
  'megath-damage': { group: 'combat', Icon: Zap },
  'player-combat-hud': { group: 'info', Icon: Shield },
};

export const OFFICIAL_SUB_GROUPS: Array<{ id: ModSubGroup; labelZh: string; labelEn: string }> = [
  { id: 'info', labelZh: '局内信息', labelEn: 'Match Info' },
  { id: 'combat', labelZh: '战斗推演', labelEn: 'Combat Calc' },
  { id: 'utility', labelZh: '互动效率', labelEn: 'Interaction' },
  { id: 'media', labelZh: '画面与控制', labelEn: 'Visual & Control' },
];

export function normalizeModuleSlug(idOrSlug: string): string {
  const raw = (idOrSlug || '').trim();
  return raw.startsWith('xingshu.launcher.') ? raw.slice('xingshu.launcher.'.length) : raw;
}

export function getLauncherModuleMeta(idOrSlug: string): LauncherModuleVisualMeta {
  const slug = normalizeModuleSlug(idOrSlug);
  const spec = MODULE_SPECS[slug] ?? { group: 'info' as ModSubGroup, Icon: Puzzle };
  const palette = GROUP_STYLES[spec.group];
  return {
    slug,
    group: spec.group,
    ...palette,
    Icon: spec.Icon,
  };
}

export function getCategoryVisualMeta(category: string): {
  accentBg: string;
  accentFg: string;
  accentBorder: string;
  Icon: LucideIcon;
} {
  switch (category) {
    case 'optimization':
      return {
        accentBg: 'rgba(27, 217, 106, 0.15)',
        accentFg: '#16a34a',
        accentBorder: 'rgba(22, 163, 74, 0.28)',
        Icon: Sparkles,
      };
    case 'card':
      return {
        accentBg: 'rgba(234, 155, 29, 0.16)',
        accentFg: '#d97706',
        accentBorder: 'rgba(217, 119, 6, 0.28)',
        Icon: Layers,
      };
    case 'voice_vfx':
      return {
        accentBg: 'rgba(59, 130, 246, 0.15)',
        accentFg: '#2563eb',
        accentBorder: 'rgba(37, 99, 235, 0.28)',
        Icon: Volume2,
      };
    default:
      return {
        accentBg: 'rgba(225, 75, 134, 0.14)',
        accentFg: '#db2777',
        accentBorder: 'rgba(219, 39, 119, 0.28)',
        Icon: ImageIcon,
      };
  }
}
