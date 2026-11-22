export interface RoomLabelOption {
  id: number;
  label: string;
  enLabel: string;
}

export interface OfficialModeSpec {
  id: number;
  name: string;
  enName: string;
  kind: 'pve' | 'pvp';
  seasonal?: boolean;
  officialOpen?: boolean;
  openNote?: string;
  hasDifficulty: boolean;
  hasUpgrade: boolean;
  defaultUpgrade: number;
  labels: RoomLabelOption[];
}

export interface OfficialMapSpec {
  id: number;
  modeId: number;
  name: string;
  enName: string;
  hasStory: boolean;
}

export interface OfficialRoomDraft {
  modeId: number;
  mapId: number;
  difficulty: number;
  upgradePlan: number;
  timePlan: number;
  speedType: number;
  roomLabel: number;
  skipStory: boolean;
  roomName: string;
  password: string;
}

export interface OfficialRoomPlayer {
  playerId: string;
  name: string;
  slot: number;
  level: number;
  ready: boolean;
  isHost: boolean;
  offline: boolean;
}

export interface ActiveOfficialRoom {
  roomId: string;
  name: string;
  mode: number;
  modeName: string;
  mapId: number;
  mapName: string;
  difficulty: number;
  difficultyName: string;
  timePlan: number;
  timePlanName: string;
  speedType: number;
  speedName: string;
  upgradePlan: number;
  upgradeName: string;
  roomLabel: number;
  roomLabelName: string;
  skipStory: boolean;
  hasPwd: boolean;
  pwd?: string;
  masterId: string;
  playerCount: number;
  maxPlayers: number;
  status: string;
  handedOff: boolean;
  message: string;
  ttlSecondsRemaining: number;
  canUpdate: boolean;
  canKick: boolean;
  players: OfficialRoomPlayer[];
}

export interface LobbyRoomSummary {
  roomId: string;
  name: string;
  mode: number;
  modeName: string;
  mapId: number;
  mapName: string;
  masterId: string;
  playerCount: number;
  maxPlayers: number;
  hasPwd: boolean;
  timePlanName: string;
  speedName: string;
  difficultyName: string;
  roomLabelName: string;
}

export const OFFICIAL_MODES: OfficialModeSpec[] = [
  {
    id: 4,
    name: '合作挑战',
    enName: 'Co-op Challenge',
    kind: 'pve',
    seasonal: false,
    officialOpen: true,
    hasDifficulty: true,
    hasUpgrade: false,
    defaultUpgrade: 4,
    labels: [
      { id: 0, label: '无标签', enLabel: 'No Tag' },
      { id: 1, label: '完成任务', enLabel: 'Quests' },
      { id: 2, label: '快速通关', enLabel: 'Speedrun' },
      { id: 3, label: '新手局', enLabel: 'Casual' },
      { id: 4, label: '高端局', enLabel: 'Veteran' },
    ],
  },
  {
    id: 1,
    name: '标准模式',
    enName: 'Standard PvP',
    kind: 'pvp',
    seasonal: false,
    officialOpen: true,
    hasDifficulty: false,
    hasUpgrade: true,
    defaultUpgrade: 1,
    labels: [
      { id: 0, label: '无标签', enLabel: 'No Tag' },
      { id: 1, label: '新手局', enLabel: 'Casual' },
      { id: 2, label: '高端局', enLabel: 'Veteran' },
    ],
  },
  {
    id: 3,
    name: '激战模式',
    enName: 'Fierce Battle',
    kind: 'pvp',
    seasonal: true,
    openNote: '官方限时活动，仅活动开放期内可建房',
    hasDifficulty: false,
    hasUpgrade: true,
    defaultUpgrade: 1,
    labels: [
      { id: 0, label: '无标签', enLabel: 'No Tag' },
      { id: 1, label: '新手局', enLabel: 'Casual' },
      { id: 2, label: '高端局', enLabel: 'Veteran' },
    ],
  },
  {
    id: 7,
    name: '礼物大作战',
    enName: 'Gift Battle',
    kind: 'pvp',
    seasonal: true,
    openNote: '官方限时活动，仅活动开放期内可建房',
    hasDifficulty: false,
    hasUpgrade: false,
    defaultUpgrade: 1,
    labels: [
      { id: 0, label: '无标签', enLabel: 'No Tag' },
      { id: 1, label: '新手局', enLabel: 'Casual' },
      { id: 2, label: '高端局', enLabel: 'Veteran' },
    ],
  },
  {
    id: 11,
    name: '幸运星争夺战',
    enName: 'Lucky Star',
    kind: 'pvp',
    seasonal: true,
    openNote: '官方限时活动，仅活动开放期内可建房',
    hasDifficulty: false,
    hasUpgrade: true,
    defaultUpgrade: 6,
    labels: [
      { id: 0, label: '无标签', enLabel: 'No Tag' },
      { id: 1, label: '新手局', enLabel: 'Casual' },
      { id: 2, label: '高端局', enLabel: 'Veteran' },
    ],
  },
  {
    id: 12,
    name: '畸变组件',
    enName: 'Anomaly Trial',
    kind: 'pve',
    seasonal: true,
    openNote: '官方限时活动，仅活动开放期内可建房',
    hasDifficulty: true,
    hasUpgrade: false,
    defaultUpgrade: 4,
    labels: [
      { id: 0, label: '无标签', enLabel: 'No Tag' },
      { id: 1, label: '完成任务', enLabel: 'Quests' },
      { id: 2, label: '快速通关', enLabel: 'Speedrun' },
      { id: 3, label: '新手局', enLabel: 'Casual' },
      { id: 4, label: '高端局', enLabel: 'Veteran' },
    ],
  },
];

export const OFFICIAL_MAPS: OfficialMapSpec[] = [
  // 模式 4 合作挑战（含线上实测存在的 82017 森秋幻境）
  { id: 82017, modeId: 4, name: '森秋幻境', enName: 'Autumn Forest', hasStory: false },
  { id: 82016, modeId: 4, name: '异变图书馆', enName: 'Anomaly Library', hasStory: false },
  { id: 82015, modeId: 4, name: '园林中庭', enName: 'Garden Courtyard', hasStory: true },
  { id: 82014, modeId: 4, name: '幽魂暗巷', enName: 'Phantom Alley', hasStory: false },
  { id: 82013, modeId: 4, name: '龙宫游乐园', enName: 'Dragon Palace', hasStory: true },
  { id: 82012, modeId: 4, name: '魔法学院', enName: 'Magic Academy', hasStory: false },
  { id: 82010, modeId: 4, name: '水乡古镇', enName: 'Water Town', hasStory: false },
  { id: 82008, modeId: 4, name: '御魂庆典', enName: 'Mitama Festival', hasStory: false },
  { id: 82007, modeId: 4, name: '星趴·梦想号', enName: 'Astral Express: Dream', hasStory: false },
  // 模式 1 标准模式
  { id: 81003, modeId: 1, name: '游乐园', enName: 'Amusement Park', hasStory: false },
  { id: 81005, modeId: 1, name: '樱花小镇', enName: 'Sakura Town', hasStory: false },
  { id: 81004, modeId: 1, name: '十字路口站', enName: 'Crossroad Station', hasStory: false },
  { id: 81006, modeId: 1, name: '魅影都市', enName: 'Phantom City', hasStory: false },
  { id: 81011, modeId: 1, name: '丛林冒险', enName: 'Jungle Adventure', hasStory: false },
  // 模式 3 激战模式
  { id: 81003, modeId: 3, name: '游乐园', enName: 'Amusement Park', hasStory: false },
  { id: 81005, modeId: 3, name: '樱花小镇', enName: 'Sakura Town', hasStory: false },
  { id: 81004, modeId: 3, name: '十字路口站', enName: 'Crossroad Station', hasStory: false },
  { id: 81006, modeId: 3, name: '魅影都市', enName: 'Phantom City', hasStory: false },
  { id: 81011, modeId: 3, name: '丛林冒险', enName: 'Jungle Adventure', hasStory: false },
  // 模式 7 礼物大作战
  { id: 82009, modeId: 7, name: '礼物广场', enName: 'Gift Plaza', hasStory: false },
  // 模式 11 幸运星争夺战
  { id: 81007, modeId: 11, name: '梦想号-上层甲板', enName: 'Dream Upper Deck', hasStory: false },
  // 模式 12 畸变组件
  { id: 83001, modeId: 12, name: '海选赛运动场', enName: 'Qualifier Stadium', hasStory: false },
  { id: 83002, modeId: 12, name: '淘汰赛运动场', enName: 'Knockout Stadium', hasStory: false },
  { id: 83003, modeId: 12, name: '决赛大赛场', enName: 'Finals Arena', hasStory: false },
];

export const DIFFICULTY_OPTIONS = [
  { id: 0, label: '普通', enLabel: 'Normal' },
  { id: 1, label: '困难', enLabel: 'Hard' },
  { id: 2, label: '噩梦', enLabel: 'Nightmare' },
  { id: 3, label: '疯狂', enLabel: 'Insane' },
] as const;

export const THINK_TIME_OPTIONS = [
  { id: 1, label: '短', enLabel: 'Fast' },
  { id: 2, label: '中', enLabel: 'Medium' },
  { id: 3, label: '长', enLabel: 'Slow' },
] as const;

export const SPEED_OPTIONS = [
  { id: 1, label: '普通', enLabel: 'Normal' },
  { id: 2, label: '快速', enLabel: 'Fast' },
] as const;

export const UPGRADE_PLAN_OPTIONS = [
  { id: 1, label: '简单 (15/30/50)', enLabel: 'Simple (15/30/50)' },
  { id: 2, label: '普通 (20/40/60)', enLabel: 'Normal (20/40/60)' },
  { id: 3, label: '困难 (20/40/70)', enLabel: 'Hard (20/40/70)' },
] as const;

export function createDefaultOfficialDraft(): OfficialRoomDraft {
  return {
    modeId: 4,
    mapId: 82016,
    difficulty: 2,
    upgradePlan: 1,
    timePlan: 2,
    speedType: 2,
    roomLabel: 0,
    skipStory: false,
    roomName: '',
    password: '',
  };
}

export function getModeSpec(modeId: number): OfficialModeSpec {
  return OFFICIAL_MODES.find((m) => m.id === modeId) ?? OFFICIAL_MODES[0];
}

export function getMapsForMode(modeId: number): OfficialMapSpec[] {
  return OFFICIAL_MAPS.filter((m) => m.modeId === modeId);
}

export function getMapForMode(modeId: number, mapId: number): OfficialMapSpec {
  const maps = getMapsForMode(modeId);
  return maps.find((m) => m.id === mapId) ?? maps[0] ?? OFFICIAL_MAPS[0];
}

export function sanitizeRoomPassword(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, '').trim().slice(0, 12);
}

export function applyModeSelection(prev: OfficialRoomDraft, modeId: number): OfficialRoomDraft {
  const spec = getModeSpec(modeId);
  const maps = getMapsForMode(spec.id);
  const firstMap = maps[0];
  const validLabel = spec.labels.some((l) => l.id === prev.roomLabel) ? prev.roomLabel : 0;
  return {
    ...prev,
    modeId: spec.id,
    mapId: firstMap ? firstMap.id : prev.mapId,
    upgradePlan: spec.hasUpgrade ? prev.upgradePlan : spec.defaultUpgrade,
    roomLabel: validLabel,
    skipStory: Boolean(firstMap?.hasStory && prev.skipStory),
  };
}

export function buildCreateRoomPayload(
  draft: OfficialRoomDraft,
  confirmSessionSwitch = false,
): Record<string, unknown> {
  const mode = getModeSpec(draft.modeId);
  const map = getMapForMode(mode.id, draft.mapId);
  const payload: Record<string, unknown> = {
    mode: mode.id,
    mapId: map.id,
    timePlan: draft.timePlan,
    speedType: draft.speedType,
    roomLabel: draft.roomLabel,
    pwd: sanitizeRoomPassword(draft.password),
  };
  if (mode.hasDifficulty) {
    payload.difficulty = Math.max(0, Math.min(3, Math.trunc(draft.difficulty)));
  } else if (mode.hasUpgrade) {
    payload.upgradePlan = draft.upgradePlan;
  }
  if (map.hasStory) {
    payload.skipStory = Boolean(draft.skipStory);
  }
  const cleanName = draft.roomName.trim().slice(0, 36);
  if (cleanName) {
    payload.name = cleanName;
  }
  if (confirmSessionSwitch) {
    payload.confirm_session_switch = true;
  }
  return payload;
}

export function buildInviteCopyText(room: ActiveOfficialRoom, zh: boolean): string {
  const parts = [room.modeName || `模式#${room.mode}`, room.mapName || `地图#${room.mapId}`];
  if (room.difficultyName) parts.push(room.difficultyName);
  if (room.upgradeName) parts.push(room.upgradeName);
  if (room.speedName) parts.push(`${room.speedName}局`);
  if (room.timePlanName) parts.push(zh ? `思考${room.timePlanName}` : `Think:${room.timePlanName}`);
  if (room.roomLabelName && room.roomLabelName !== '无标签') parts.push(`[${room.roomLabelName}]`);
  const pwdPart = room.hasPwd
    ? (room.pwd ? (zh ? `｜密码 ${room.pwd}` : ` | Pass ${room.pwd}`) : (zh ? '｜私密房间' : ' | Locked'))
    : (zh ? '｜公开房间' : ' | Public');
  return zh
    ? `【星枢 · 趴开房】房号 #${room.roomId}｜${parts.join(' · ')}${pwdPart}｜当前 ${room.playerCount}/${room.maxPlayers} 人｜QQ 可发「趴加入 ${room.roomId}」查看`
    : `[XingShu Room] #${room.roomId} | ${parts.join(' · ')}${pwdPart} | ${room.playerCount}/${room.maxPlayers} players`;
}
