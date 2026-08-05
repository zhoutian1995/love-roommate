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
  readUtf8('SKILL.md');
  readUtf8('README.md');
});

test('critical Chinese authorization and prank wording survives byte decoding', () => {
  const skill = readUtf8('SKILL.md');
  const readme = readUtf8('README.md');
  assert.match(skill, /照片里的人都知道并同意制作桌宠吗？/);
  assert.match(skill, /我只能记录你的确认，不能替你证明其他人真的同意。/);
  assert.match(readme, /你是照片里的几号？/);
  assert.match(readme, /叫爸爸/);
  assert.match(readme, /叫爷爷/);
  assert.match(readme, /被膜拜者/);
});
