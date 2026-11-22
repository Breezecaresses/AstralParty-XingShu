import assert from 'node:assert/strict';
import {
  WORKSHOP_CHANNEL_FILTER_OPTIONS,
  WORKSHOP_UPLOAD_CHANNEL_PRESETS,
  formatWorkshopChannelName,
  modPlatformSummaryBadge,
  modSupportsChannelFilter,
  sanitizeWorkshopPlatforms,
} from '../shared/workshopClient.ts';
import {
  GAME_BIND_PLATFORMS,
  isPlatformAdmin,
  type PlatformUser,
} from '../shared/platformAccountClient.ts';

// 1. iOS is completely excluded from channel filter options, upload presets, and game bind platforms.
assert.ok(
  WORKSHOP_CHANNEL_FILTER_OPTIONS.some((opt) => opt.id === 'ANDROID_CN' && opt.labelZh.includes('手机端')),
  'browse channel filters must include ANDROID_CN mobile option',
);
assert.equal(
  WORKSHOP_CHANNEL_FILTER_OPTIONS.some((opt) => /ios/i.test(opt.id) || /ios/i.test(opt.labelZh)),
  false,
  'browse channel filters must exclude iOS',
);
assert.equal(
  WORKSHOP_UPLOAD_CHANNEL_PRESETS.some((p) => /ios/i.test(p.value) || /ios/i.test(p.labelZh)),
  false,
  'upload channel presets must exclude iOS',
);
assert.equal(
  GAME_BIND_PLATFORMS.some((p) => /ios/i.test(p.id) || /ios/i.test(p.labelZh)),
  false,
  'game bind platforms must exclude iOS',
);

// 2. Sanitization strips legacy IOS / IOS_CN entries without losing Android/PE or PC platforms.
assert.deepEqual(
  sanitizeWorkshopPlatforms(['STEAM_CN', 'IOS_CN', 'ANDROID_CN', 'ios', 'PE']),
  ['STEAM_CN', 'ANDROID_CN', 'PE'],
);
assert.equal(formatWorkshopChannelName('ANDROID_CN', true), '手机端 (安卓 / PE)');

// 3. Single-version official .xspkg mods supporting both PC & Android must display PC / 手机端通用 badge.
const officialXspkg = {
  platforms: ['STEAM_CN', 'TAPTAP', 'BILIBILI', 'WEGAME', 'ANDROID_CN'],
  platformLabels: ['PC · 手机端'],
  versionCount: 1,
  versions: [],
};
assert.equal(modPlatformSummaryBadge(officialXspkg, true), 'PC / 手机端通用');
assert.equal(modPlatformSummaryBadge(officialXspkg, false), 'PC & Mobile');
assert.equal(modSupportsChannelFilter(officialXspkg, 'ANDROID_CN'), true);
assert.equal(modSupportsChannelFilter(officialXspkg, 'WEGAME'), true);

// 4. Multi-version mods keep version summary while stripping iOS labels and match mobile via version platforms.
const multiVersionPack = {
  platforms: ['STEAM_CN', 'TAPTAP'],
  platformLabels: ['PC 端', '手机端 / iOS (PE)'],
  versionCount: 2,
  versions: [
    { platforms: ['STEAM_CN', 'TAPTAP'] },
    { platforms: ['PE', 'IOS_CN'] },
  ],
};
assert.equal(modSupportsChannelFilter(multiVersionPack, 'ANDROID_CN'), true);
assert.equal(modPlatformSummaryBadge(multiVersionPack, true), '2 个版本 · PC 端 / 手机端 (PE)');
assert.equal(
  modPlatformSummaryBadge({ ...multiVersionPack, platformLabels: ['PC 端', 'iOS'] }, true),
  '2 个版本 · PC 端',
);

// 5. Mobile-only single version shows mobile badge, and PC-only hides mobile filter.
assert.equal(modPlatformSummaryBadge({ platforms: ['ANDROID_CN'], versionCount: 1, versions: [] }, true), '手机端 (安卓 / PE)');
assert.equal(modPlatformSummaryBadge({ platforms: ['STEAM_CN'], versionCount: 1, versions: [] }, true), null);
assert.equal(modSupportsChannelFilter({ platforms: ['STEAM_CN'], versions: [] }, 'ANDROID_CN'), false);

// 6. Platform admin detection only grants access to official / admin roles.
const makeUser = (role: string): PlatformUser => ({
  id: 'u1',
  uid: 1,
  username: 'tester',
  displayName: 'Tester',
  email: '',
  bio: '',
  avatarColor: '#2f7cf6',
  role,
  createdAt: 0,
  updatedAt: 0,
});
assert.equal(isPlatformAdmin(null), false);
assert.equal(isPlatformAdmin(makeUser('member')), false);
assert.equal(isPlatformAdmin(makeUser('creator')), false);
assert.equal(isPlatformAdmin(makeUser('banned')), false);
assert.equal(isPlatformAdmin(makeUser('official')), true);
assert.equal(isPlatformAdmin(makeUser('admin')), true);

console.log('workshop_channel_badge.test.ts: all assertions passed');
