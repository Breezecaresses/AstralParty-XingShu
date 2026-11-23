export type ComponentState = 'packageMissing' | 'unsupported' | 'installed' | 'installable' | 'updateAvailable' | 'resourceMissing' | 'incompatible';

export interface LauncherDiskState {
  state: ComponentState;
  version?: string;
  availableVersion?: string;
  gameVersion?: string;
  resourceVersion?: string;
  installerAvailable: boolean;
}

export interface LauncherSession {
  running: boolean;
  runtimeVersion?: string;
  playerId?: string;
}

export interface ConflictInspectItem {
  pluginName: string;
  category: string;
  relativePath: string;
  sha256: string;
}

export interface ConflictInspectReport {
  ok: boolean;
  platform: string;
  platformLabel: string;
  gameRoot: string;
  targetSha256: string;
  targetState: 'installed' | 'vanilla' | 'updateAvailable' | 'conflict' | 'incompatible' | string;
  hasConflicts: boolean;
  targetIsConflict: boolean;
  pluginNames: string[];
  items: ConflictInspectItem[];
  hasBackup: boolean;
  backupIsVanilla: boolean;
  summary: string;
  conflictPrompt: string;
}

export type LaunchPhase = 'idle' | 'checking' | 'installing' | 'starting' | 'connecting' | 'connected' | 'waiting';

const PHASE_PROGRESS: Record<LaunchPhase, number> = {
  idle: 0,
  checking: 18,
  installing: 46,
  starting: 72,
  connecting: 90,
  connected: 100,
  waiting: 96,
};

export function launchPhaseProgress(phase: LaunchPhase): number {
  return PHASE_PROGRESS[phase] ?? 0;
}

export const LAUNCH_TIPS_ZH: readonly string[] = [
  '使用「星枢账号」可同步云端回放、对局战绩与角色图鉴配置。',
  '星枢默认作为纯净官方启动器运行；在「模组」页可按需安装「星枢官方插件 Mod」并自由开关 19 项功能。',
  '将 .zip、.xspkg、.apmm 模组包或模组文件夹拖入窗口任意位置，即可自动识别并安装。',
  '若检测到旧版 APX 残留或代理 DLL 冲突，可在「检查冲突」中一键备份并安全处理。',
  '所有插件与模组写入均自动创建事务快照，支持在「安装事务」中随时无损还原。',
  'Steam 国服与国际服渠道独立记录目录与模组状态，切换上方渠道胶囊即可分别管理。',
  '在「设置 → 个性化与启动动画」中可随时切换六套星枢主题配色并重播启动动画。',
];

export const LAUNCH_TIPS_EN: readonly string[] = [
  'Sign in with your XingShu account to sync cloud replays, match history, and character presets.',
  'XingShu Hub launches the official vanilla game cleanly by default. Install the optional XingShu Plugin Mod on the Mods page when needed.',
  'Drag and drop .zip, .xspkg, .apmm packages or mod folders anywhere onto this window to inspect and install.',
  'If legacy APX files or proxy DLL conflicts appear, use Review Conflicts to inspect and safely resolve with backups.',
  'Every extension write creates a transactional backup snapshot so you can roll back cleanly at any time.',
  'Steam CN and Steam Global keep separate folder and mod profiles when switched from the channel selector.',
  'Switch between six XingShu color themes and replay the startup splash anytime in Settings → Appearance.',
];

export function shortFolderName(path?: string): string {
  if (!path) return '';
  const trimmed = path.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return '';
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export function launcherAction(disk?: LauncherDiskState, session?: LauncherSession) {
  if (!disk || !session) return 'checking';
  if (session.running) return 'running';
  if (disk.state === 'installed') return 'start';
  return 'startOfficial';
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
