import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

test('moving transparent windows reapplies their fixed size to prevent DPI drift', () => {
  assert.doesNotMatch(mainSource, /win\.setPosition\(/);
  assert.match(mainSource, /win\.setBounds\(\{\s*x:\s*roundedX,\s*y:\s*roundedY,\s*width,\s*height\s*\},\s*false\)/s);
  assert.match(mainSource, /safeSetPosition\(\s*entry\.win,[\s\S]*config\.render\.windowSize,\s*config\.render\.windowSize\s*\)/);
});
