import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSharp } from '../lib/common.mjs';
import { cleanPortraitChromaEdges, preparePortraitAlpha, removeChroma } from '../lib/sprite-processing.mjs';

const pixel = (buffer, width, x, y) => [...buffer.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function selfCheckChromaFixture(t, fringeAlpha) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-chroma-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const preview = path.join(root, 'preview');
  const configDir = path.join(project, 'src', 'config');
  const spriteDir = path.join(project, 'src', 'assets', 'sprites', 'person-1');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(spriteDir, { recursive: true });
  fs.mkdirSync(preview, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 32, windowSize: 64 },
    characters: [{ id: 'person-1', displayName: 'Person 1' }]
  }));
  fs.writeFileSync(path.join(configDir, 'behaviors.json'), JSON.stringify({ poopChase: { enabled: false } }));
  fs.writeFileSync(path.join(project, 'src', 'assets', 'sprites', 'manifest.json'), JSON.stringify({
    spriteSize: 32,
    characters: [{
      id: 'person-1',
      frames: { idle_right: ['person-1/idle_right.png'] },
      anchors: {
        right: { head: [22, 10], mouth: [23, 12], rear: [9, 20] },
        left: { head: [9, 10], mouth: [8, 12], rear: [22, 20] }
      }
    }]
  }));
  fs.writeFileSync(path.join(spriteDir, 'processing-report.json'), JSON.stringify({
    cells: [{ action: 'idle_right', key: '#ff00ff' }]
  }));

  const width = 32;
  const height = 32;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 4; y <= 27; y += 1) {
    for (let x = 6; x <= 25; x += 1) {
      const offset = (y * width + x) * 4;
      const fringe = x <= 7 || x >= 24 || y <= 5 || y >= 26;
      rgba.set(fringe ? [255, 0, 255, fringeAlpha] : [40, 80, 120, 255], offset);
    }
  }
  const sharp = loadSharp(root);
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(path.join(spriteDir, 'idle_right.png'));

  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'scripts', 'self_check_project.mjs'),
    '--project', project,
    '--preview', preview,
    '--warn-only'
  ], { encoding: 'utf8', env: { ...process.env } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(fs.readFileSync(path.join(preview, 'self-check-report.json'), 'utf8'));
}

test('portrait edge cleanup removes magenta fringe without changing skin or orange clothing', () => {
  const width = 7;
  const height = 7;
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let x = 0; x < width; x += 1) set(x, 0, [240, 8, 220, 0]);

  for (let y = 1; y <= 5; y += 1) {
    for (let x = 1; x <= 5; x += 1) set(x, y, [201, 146, 119, 255]);
  }
  set(1, 2, [246, 36, 222, 255]); // contaminated hair/skin boundary
  set(1, 4, [232, 91, 34, 255]); // legitimate orange jacket boundary
  set(3, 3, [201, 146, 119, 255]); // interior skin

  const cleaned = cleanPortraitChromaEdges(data, width, height, [240, 8, 220]);

  assert.deepEqual(pixel(cleaned, width, 3, 3), [201, 146, 119, 255]);
  assert.deepEqual(pixel(cleaned, width, 1, 4), [232, 91, 34, 255]);
  const fringe = pixel(cleaned, width, 1, 2);
  assert.ok(fringe[2] < 170, `blue fringe remained: ${fringe}`);
  assert.ok(Math.abs(fringe[0] - 201) < 30, `edge no longer matches nearby subject: ${fringe}`);
  assert.deepEqual(pixel(cleaned, width, 0, 0), [0, 0, 0, 0]);
});

test('portrait edge cleanup removes dark antialiased magenta fringe at transparent boundaries', () => {
  const width = 7;
  const height = 7;
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let y = 1; y <= 5; y += 1) {
    for (let x = 1; x <= 5; x += 1) set(x, y, [24, 28, 45, 255]);
  }
  set(1, 2, [100, 4, 117, 255]);

  const cleaned = cleanPortraitChromaEdges(data, width, height, [243, 8, 220]);

  const fringe = pixel(cleaned, width, 1, 2);
  assert.ok(fringe[0] < 50 && fringe[2] < 70, `dark magenta fringe remained: ${fringe}`);
  assert.deepEqual(pixel(cleaned, width, 3, 3), [24, 28, 45, 255]);
});

test('portrait edge cleanup removes low-saturation key mixtures from hair skin clothing and shoes', () => {
  const width = 11;
  const height = 9;
  const key = [239, 4, 241];
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  const subject = [
    [24, 28, 45],
    [201, 146, 119],
    [196, 78, 22],
    [181, 142, 105]
  ];
  for (let band = 0; band < subject.length; band += 1) {
    const y = band * 2 + 1;
    for (let x = 1; x <= 9; x += 1) set(x, y, [...subject[band], 255]);
    const mixed = subject[band].map((channel, index) => Math.round(channel * 0.82 + key[index] * 0.18));
    set(1, y, [...mixed, 255]);
  }

  const cleaned = cleanPortraitChromaEdges(data, width, height, key);

  for (let band = 0; band < subject.length; band += 1) {
    const y = band * 2 + 1;
    assert.deepEqual(pixel(cleaned, width, 1, y), [...subject[band], 255]);
    assert.deepEqual(pixel(cleaned, width, 5, y), [...subject[band], 255]);
  }
});

test('portrait edge cleanup preserves a real purple garment that reaches the silhouette', () => {
  const width = 9;
  const height = 9;
  const key = [239, 4, 241];
  const garment = [126, 62, 142];
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let y = 2; y <= 6; y += 1) {
    for (let x = 1; x <= 7; x += 1) set(x, y, [...garment, 255]);
  }

  const cleaned = cleanPortraitChromaEdges(data, width, height, key);

  assert.deepEqual(pixel(cleaned, width, 1, 4), [...garment, 255]);
  assert.deepEqual(pixel(cleaned, width, 4, 4), [...garment, 255]);
});

test('portrait preparation detects the actual generated border key instead of trusting nominal magenta', () => {
  const width = 7;
  const height = 7;
  const actualKey = [239, 4, 241]; // #ef04f1 from the isolated E2E reproduction
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) set(x, y, [...actualKey, 255]);
  }
  for (let y = 2; y <= 4; y += 1) {
    for (let x = 2; x <= 4; x += 1) set(x, y, [24, 28, 45, 255]);
  }

  const cleaned = preparePortraitAlpha(data, width, height, [255, 0, 255], 5, 10);

  assert.deepEqual(pixel(cleaned, width, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(cleaned, width, 3, 3), [24, 28, 45, 255]);
});

test('portrait cleanup preserves an enclosed key-colour region for manual classification', () => {
  const width = 13;
  const height = 13;
  const key = [239, 4, 241];
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let y = 2; y <= 10; y += 1) {
    for (let x = 2; x <= 10; x += 1) set(x, y, [24, 28, 45, 255]);
  }
  set(6, 6, [...key, 255]);
  set(6, 7, [235, 18, 234, 255]);

  const cleaned = cleanPortraitChromaEdges(data, width, height, key);

  assert.deepEqual(pixel(cleaned, width, 6, 6), [...key, 255]);
  assert.deepEqual(pixel(cleaned, width, 6, 7), [235, 18, 234, 255]);
  assert.deepEqual(pixel(cleaned, width, 5, 6), [24, 28, 45, 255]);
});

test('automatic chroma removal clears border-connected key while preserving enclosed exact and near-key subject pixels', () => {
  const width = 7;
  const height = 5;
  const key = [255, 0, 255];
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) set(x, y, [...key, 255]);
  }
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 5; x += 1) set(x, y, [24, 28, 45, 255]);
  }
  set(3, 2, [...key, 255]);
  set(4, 2, [240, 8, 240, 255]);

  const cleaned = removeChroma(data, width, height, key);

  assert.deepEqual(pixel(cleaned, width, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(cleaned, width, 3, 2), [...key, 255]);
  assert.deepEqual(pixel(cleaned, width, 4, 2), [240, 8, 240, 255]);
});

test('trusted corrected alpha preserves restored exact and near-key subject pixels', () => {
  const width = 4;
  const height = 1;
  const data = Buffer.from([
    255, 0, 255, 255,
    240, 8, 240, 255,
    20, 30, 40, 255,
    90, 80, 70, 0
  ]);

  const cleaned = preparePortraitAlpha(data, width, height, [255, 0, 255], 28, 105, { trustedCorrected: true });

  assert.deepEqual(pixel(cleaned, width, 0, 0), [255, 0, 255, 255]);
  assert.deepEqual(pixel(cleaned, width, 1, 0), [240, 8, 240, 255]);
  assert.deepEqual(pixel(cleaned, width, 3, 0), [0, 0, 0, 0]);
});

test('portrait cleanup preserves legitimate magenta-adjacent subject colors at a transparent edge', () => {
  const width = 9;
  const height = 9;
  const key = [239, 4, 241];
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let y = 1; y <= 7; y += 1) {
    for (let x = 1; x <= 7; x += 1) set(x, y, [15, 121, 110, 255]);
  }
  set(1, 2, [165, 108, 140, 255]); // plausible shaded skin/pink fabric from the E2E evidence
  set(3, 3, [201, 146, 119, 255]); // skin
  set(4, 3, [24, 28, 45, 255]); // dark hair
  set(5, 3, [196, 78, 22, 255]); // orange clothing

  const cleaned = cleanPortraitChromaEdges(data, width, height, key);

  assert.deepEqual(pixel(cleaned, width, 1, 2), [165, 108, 140, 255]);
  assert.deepEqual(pixel(cleaned, width, 3, 3), [201, 146, 119, 255]);
  assert.deepEqual(pixel(cleaned, width, 4, 3), [24, 28, 45, 255]);
  assert.deepEqual(pixel(cleaned, width, 5, 3), [196, 78, 22, 255]);
});

test('portrait edge cleanup removes green fringe without changing blue denim or skin', () => {
  const width = 7;
  const height = 7;
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let x = 0; x < width; x += 1) set(x, 0, [0, 255, 0, 0]);
  for (let y = 1; y <= 5; y += 1) {
    for (let x = 1; x <= 5; x += 1) set(x, y, [45, 64, 105, 255]);
  }
  set(1, 2, [18, 238, 31, 255]);
  set(1, 4, [44, 72, 126, 255]);
  set(3, 3, [201, 146, 119, 255]);

  const cleaned = cleanPortraitChromaEdges(data, width, height, [0, 255, 0]);
  assert.deepEqual(pixel(cleaned, width, 3, 3), [201, 146, 119, 255]);
  assert.deepEqual(pixel(cleaned, width, 1, 4), [44, 72, 126, 255]);
  const fringe = pixel(cleaned, width, 1, 2);
  assert.ok(fringe[1] < 130, `green fringe remained: ${fringe}`);
  assert.deepEqual(pixel(cleaned, width, 0, 0), [0, 0, 0, 0]);
});

test('already transparent portraits bypass destructive global chroma removal', () => {
  const width = 3;
  const height = 2;
  const data = Buffer.from([
    255, 0, 255, 0, 201, 146, 119, 255, 255, 0, 255, 0,
    0, 0, 0, 0, 35, 24, 20, 255, 0, 0, 0, 0
  ]);

  const cleaned = preparePortraitAlpha(data, width, height, [255, 0, 255]);

  assert.deepEqual(pixel(cleaned, width, 1, 0), [201, 146, 119, 255]);
  assert.deepEqual(pixel(cleaned, width, 1, 1), [35, 24, 20, 255]);
  assert.deepEqual(pixel(cleaned, width, 0, 0), [0, 0, 0, 0]);
});

test('self-check fails closed on a clearly visible opaque chroma fringe', async (t) => {
  const report = await selfCheckChromaFixture(t, 255);
  const issue = report.issues.find((item) => item.code === 'chroma-spill');

  assert.ok(issue, 'expected self-check to detect the visible chroma fringe');
  assert.equal(issue.severity, 'error');
  assert.equal(report.status, 'fail');
});

test('self-check does not fail closed on faint antialiasing at a transparent edge', async (t) => {
  const report = await selfCheckChromaFixture(t, 40);
  const issue = report.issues.find((item) => item.code === 'chroma-spill');

  assert.ok(issue, 'expected faint key-colour antialiasing to remain diagnostically visible');
  assert.notEqual(issue.severity, 'error');
});
