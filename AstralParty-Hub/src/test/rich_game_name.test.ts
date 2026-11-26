import assert from 'node:assert/strict';
import { parseRichGameName, plainRichGameName } from '../shared/richGameName.ts';

const rainbow =
  '[b][color=#D21D36]喜[/color][color=#FF7A00]欢[/color][color=#FFD400]锻[/color][color=#00C853]炼[/color][color=#00AAFF]身[/color][color=#4B4BFF]体[/color][color=#AA00FF]的[/color][color=#FF69B4]螺[/color][color=#00C853]油[/color][color=#7CFC00]油[/color][/b]';

const parsed = parseRichGameName(rainbow);
assert.equal(parsed.plain, '喜欢锻炼身体的螺油油');
assert.equal(parsed.hasRichStyle, true);
assert.equal(parsed.runs.length, 10);
assert.equal(parsed.runs[0].bold, true);
assert.equal(parsed.runs[0].colors?.[0].hex, '#D21D36');
assert.equal(parsed.runs[9].colors?.[0].hex, '#7CFC00');

const grad = parseRichGameName('[gradient=#FF0000,#0000FF]渐变昵称[/gradient]');
assert.equal(grad.plain, '渐变昵称');
assert.equal(grad.runs[0].colors?.length, 2);

const unityAndXss = parseRichGameName('<color=cyan><b>玩家</b></color><script>alert(1)</script>');
assert.equal(unityAndXss.plain, '玩家alert(1)');
assert.equal(unityAndXss.runs[0].colors?.[0].hex, '#00FFFF');
assert.equal(unityAndXss.runs[0].bold, true);

const brokenTail = parseRichGameName('[color=#FF0000]正常[/color][color=#123');
assert.equal(brokenTail.plain, '正常');
assert.equal(plainRichGameName('', '默认'), '默认');

console.log('rich_game_name tests passed');
