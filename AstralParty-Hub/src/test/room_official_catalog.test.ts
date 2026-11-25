import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DIFFICULTY_OPTIONS,
  OFFICIAL_MAPS,
  OFFICIAL_MODES,
  applyModeSelection,
  buildCreateRoomPayload,
  buildInviteCopyText,
  createDefaultOfficialDraft,
  getMapsForMode,
} from '../pages/room/roomTemplateData.ts';

// 1. Strictly expose the 6 game-supported official modes (4, 1, 3, 7, 11, 12).
assert.deepEqual(
  OFFICIAL_MODES.map((m) => m.id),
  [4, 1, 3, 7, 11, 12],
  'Official room modes must strictly match the 6 in-game modes',
);
assert.deepEqual(
  OFFICIAL_MODES.filter((m) => m.seasonal).map((m) => m.id),
  [3, 7, 11, 12],
  'Seasonal official modes must mark 3, 7, 11, 12',
);
assert.deepEqual(
  OFFICIAL_MODES.filter((m) => !m.seasonal).map((m) => m.id),
  [4, 1],
  'Permanent official modes must be 4 and 1',
);
assert.deepEqual(
  DIFFICULTY_OPTIONS.map((d) => d.id),
  [0, 1, 2, 3],
  'Co-op difficulties must expose permanent 0..3 tiers without seasonal Extreme (4)',
);

// 2. Mode 4 Co-op Challenge includes all 9 official maps including 82017 森秋幻境.
const coopMaps = getMapsForMode(4);
assert.equal(coopMaps.length, 9);
assert.ok(
  coopMaps.some((m) => m.id === 82017 && m.name === '森秋幻境'),
  'Co-op map catalog must include 82017 森秋幻境',
);
assert.equal(OFFICIAL_MAPS.length, 24);

// 3. Switching modes updates default map & removes incompatible story flags.
const baseDraft = { ...createDefaultOfficialDraft(), skipStory: true, roomLabel: 3 };
const pvpDraft = applyModeSelection(baseDraft, 1);
assert.equal(pvpDraft.modeId, 1);
assert.equal(pvpDraft.mapId, 81003);
assert.equal(pvpDraft.roomLabel, 0);
assert.equal(pvpDraft.skipStory, false);

// 4. Create payload builds official fields without retired/mock properties.
const coopPayload = buildCreateRoomPayload(
  { ...createDefaultOfficialDraft(), modeId: 4, mapId: 82015, skipStory: true, password: ' 2580 ', difficulty: 3 },
  true,
);
assert.deepEqual(coopPayload, {
  mode: 4,
  mapId: 82015,
  difficulty: 3,
  timePlan: 2,
  speedType: 2,
  roomLabel: 0,
  skipStory: true,
  pwd: '2580',
  confirm_session_switch: true,
});

// 5. Invite copy string prints real #roomId and never mock/0-yield copy.
const invite = buildInviteCopyText(
  {
    roomId: '9123456',
    name: '测试房',
    mode: 4,
    modeName: '合作挑战',
    mapId: 82017,
    mapName: '森秋幻境',
    difficulty: 2,
    difficultyName: '噩梦',
    timePlan: 2,
    timePlanName: '中',
    speedType: 2,
    speedName: '快速',
    upgradePlan: 4,
    upgradeName: '',
    roomLabel: 2,
    roomLabelName: '快速通关',
    skipStory: false,
    hasPwd: true,
    pwd: '2580',
    masterId: '1556514',
    playerCount: 1,
    maxPlayers: 4,
    status: 'hosting',
    handedOff: false,
    message: '官方房间已开启',
    ttlSecondsRemaining: 1200,
    canUpdate: true,
    canKick: true,
    players: [],
  },
  true,
);
assert.ok(invite.includes('#9123456'));
assert.ok(invite.includes('森秋幻境'));
assert.ok(!invite.includes('0收益'));

// 6. Verify RoomLobbyPage.tsx, topBarTools.ts and LauncherNav.tsx contain no leftover mock/preview placeholders and match the new nav + tools layout.
const roomPageSrc = fs.readFileSync(path.resolve('src/pages/room/RoomLobbyPage.tsx'), 'utf8');
assert.ok(!roomPageSrc.includes('模板预览'), 'RoomLobbyPage must not show preview mock banner');
assert.ok(!roomPageSrc.includes('0收益'), 'RoomLobbyPage must not show self-hosted 0-yield copy');
assert.ok(!roomPageSrc.includes('模拟占位'), 'RoomLobbyPage must not show mock join buttons');
assert.ok(roomPageSrc.includes('in_game_room_create'), 'RoomLobbyPage must invoke real in_game_room_create');
assert.ok(roomPageSrc.includes('in_game_room_modify'), 'RoomLobbyPage must invoke real in_game_room_modify');
assert.ok(roomPageSrc.includes('in_game_room_start'), 'RoomLobbyPage must invoke real in_game_room_start');

const navSrc = fs.readFileSync(path.resolve('src/pages/launcher/LauncherNav.tsx'), 'utf8');
assert.ok(navSrc.includes("key: 'customize', to: '/customize'"), 'LauncherNav must include top-level /customize tab');
const topBarToolsSrc = fs.readFileSync(path.resolve('src/pages/launcher/topBarTools.ts'), 'utf8');
assert.ok(topBarToolsSrc.includes("key: 'room'") && topBarToolsSrc.includes("to: '/room'"), 'topBarTools must include /room under Tools');

console.log('room_official_catalog tests passed.');
