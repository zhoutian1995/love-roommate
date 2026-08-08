import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const decoder = new TextDecoder('utf-8', { fatal: true });

function readUtf8(relative) {
  const bytes = fs.readFileSync(path.join(skillRoot, relative));
  const text = decoder.decode(bytes);
  assert.doesNotMatch(text, /\uFFFD/);
  assert.doesNotMatch(text, /鐓х墖|鍙穈|涓嶅湪|浜轰綋|锛焋|銆俙/);
  return text;
}

test('public Skill documents are strict UTF-8 without mojibake', () => {
  for (const relative of [
    'SKILL.md',
    'README.md',
    'references/codex-runtime.md',
    'references/visual-generation.md',
    'references/workflow-commands.md',
    'references/self-check.md'
  ]) readUtf8(relative);
});

test('Windows official validator is forced to decode Chinese Skill text as UTF-8', () => {
  const releaseCheck = readUtf8('scripts/release_check.mjs');
  assert.match(releaseCheck, /prefixArgs, '-X', 'utf8', validator/);
});

test('critical Chinese authorization and prank wording survives byte decoding', () => {
  const skill = readUtf8('SKILL.md');
  const readme = readUtf8('README.md');
  assert.match(skill, /照片里的人都知道并同意制作桌宠吗？/);
  assert.match(skill, /我只能记录你的确认，不能替你证明其他人真的同意。/);
  assert.match(readme, /你是照片里的几号？/);
  assert.match(readme, /其他角色全部跪下喊爸爸或爷爷/);
  assert.match(readme, /全员跪下喊爸爸或爷爷/);
  assert.match(readme, /被膜拜者/);
});

test('README exposes only the four current modes and fixed confirmation flow', () => {
  const readme = readUtf8('README.md');

  for (const mode of ['普通桌宠', '集体跪喊', '屎追逐', '全部都要']) {
    assert.match(readme, new RegExp(`\\| ${mode} \\|`));
  }

  assert.match(readme, /授权 → 本人 → 模式 → 最终确认/);
  assert.match(readme, /不再追加恶搞排除、领头人或接力顺序/);
  assert.doesNotMatch(readme, /\| 人体蜈蚣 \|/);
  assert.doesNotMatch(readme, /\| 接力模式 \|/);
});

test('README documents both self branches and a separate 90-point humor gate', () => {
  const readme = readUtf8('README.md');

  assert.match(readme, /有本人时，本人站立不跪，其他角色全部跪下喊爸爸或爷爷/);
  assert.match(readme, /明确回复本人不在照片里时，全员跪下喊爸爸或爷爷/);
  assert.match(readme, /本人是唯一且持续的拉屎者，其他角色轮流冲上去追吃、吃完归队/);
  assert.match(readme, /鼠标控制一坨点击穿透的屎，所有角色组成不断链的人形蜈蚣追着它爬/);
  assert.match(readme, /每个被选中的特殊恶搞[^\n]*分别打分/);
  assert.match(readme, /任一特殊恶搞总分低于 90[^\n]*整体不通过/);
  assert.match(readme, /特殊恶搞人工搞笑分同时不得低于 90/);
  assert.doesNotMatch(readme, /特殊恶搞[^\n]*低于 85|特殊恶搞[^\n]*不低于 85/);
});
