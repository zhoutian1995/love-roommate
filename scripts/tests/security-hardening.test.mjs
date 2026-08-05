import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSharp } from '../lib/common.mjs';
import { nearestVisibleAlphaDistance } from '../lib/sprite-processing.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scripts = path.join(skillRoot, 'scripts');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function syntheticWindowsPath(...segments) {
  return ['C:', ...segments].join(path.win32.sep);
}

function syntheticUncPath(...segments) {
  return `${path.win32.sep}${path.win32.sep}${segments.join(path.win32.sep)}`;
}

function pngFixture(label) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from(label, 'utf8')]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rgbaPng(width, height, visible) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      row[offset] = 40; row[offset + 1] = 80; row[offset + 2] = 120;
      row[offset + 3] = visible(x, y) ? 255 : 0;
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

function keyedRgbaPng(width, height, visible) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const foreground = visible(x, y);
      row[offset] = foreground ? 40 : 255;
      row[offset + 1] = foreground ? 80 : 0;
      row[offset + 2] = foreground ? 120 : 255;
      row[offset + 3] = foreground ? 255 : 0;
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

function run(script, args) {
  return spawnSync(process.execPath, [path.join(scripts, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env }
  });
}

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createArgs(root, overrides = {}) {
  const source = path.join(root, 'source.jpg');
  if (!fs.existsSync(source)) fs.writeFileSync(source, 'synthetic source fixture', 'utf8');
  const values = {
    name: 'Test Roommate',
    out: path.join(root, 'output'),
    source,
    people: '3',
    mode: 'all',
    self: 'person-2',
    'prank-excluded': 'person-3',
    consent: 'confirmed',
    leader: 'person-1',
    followers: 'person-2,person-3',
    ...overrides
  };
  return Object.entries(values).flatMap(([key, value]) => value === null ? [] : [`--${key}`, value]);
}

function createAuditFixture(root, spriteBytes = pngFixture('generated sprite')) {
  const sprites = path.join(root, 'project', 'src', 'assets', 'sprites');
  const sprite = path.join(sprites, 'person-1', 'idle.png');
  fs.mkdirSync(path.dirname(sprite), { recursive: true });
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
  fs.writeFileSync(path.join(root, 'project-manifest.json'), JSON.stringify({
    schemaVersion: 2,
    paths: { project: 'project', release: 'release', preview: 'preview' },
    consent: { allSubjectsAuthorized: true }
  }, null, 2));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    characters: [{ id: 'person-1', frames: { idle: ['person-1/idle.png'] } }]
  }, null, 2));
  fs.writeFileSync(sprite, spriteBytes);
  return { sprite };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function setupDerivedActionFixture(t) {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  const master = path.join(sources, 'person-1-master.png');
  const source = path.join(sources, 'person-1-crawl-right-1.png');
  const derived = path.join(sources, 'person-1-crawl-left-1.png');
  fs.writeFileSync(master, rgbaPng(4, 3, () => true));
  fs.writeFileSync(source, rgbaPng(4, 3, (x, y) => (x === 0 && y === 0) || (x === 1 && y === 2)));
  fs.writeFileSync(derived, rgbaPng(4, 3, (x, y) => (x === 3 && y === 0) || (x === 2 && y === 2)));
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', source, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_right_1', '--master-fingerprint', sha256(master), '--prompt-version', 'action-v1', '--version', '1'
  ]).status, 0);
  return { root, preview, sources, master, source, derived };
}

test('project creation validates consent and participants before writing output', (t) => {
  const cases = [
    { consent: null },
    { 'prank-excluded': null },
    { self: 'person-9' },
    { 'prank-excluded': 'person-3,person-3' },
    { 'prank-excluded': 'person-9' },
    { leader: 'person-9' },
    { followers: 'person-2,person-2' },
    { followers: 'person-2,person-9' }
  ];
  for (const [index, overrides] of cases.entries()) {
    const root = workspace(t);
    const output = path.join(root, 'output');
    const result = run('create_project.mjs', createArgs(root, { ...overrides, out: output }));
    assert.notEqual(result.status, 0, `case ${index} unexpectedly succeeded`);
    assert.equal(fs.existsSync(output), false, `case ${index} left a partial output`);
    assert.deepEqual(fs.readdirSync(root).filter((name) => name.includes('.tmp-')), []);
  }
});

test('project creation writes a strict relative Manifest V2', (t) => {
  const root = workspace(t);
  const output = path.join(root, 'output');
  const result = run('create_project.mjs', createArgs(root, { out: output }));
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'project-manifest.json'), 'utf8'));
  assert.deepEqual(manifest, {
    schemaVersion: 2,
    name: 'Test Roommate',
    people: 3,
    paths: { project: 'project', release: 'release', preview: 'preview' },
    selection: {
      mode: 'all',
      userCharacterId: 'person-2',
      prankExcludedCharacterIds: ['person-2', 'person-3'],
      leaderId: 'person-1',
      followerIds: ['person-2', 'person-3']
    },
    consent: { allSubjectsAuthorized: true }
  });
  const text = fs.readFileSync(path.join(output, 'project-manifest.json'), 'utf8');
  assert.doesNotMatch(text, /sourcePhoto|createdAt|sha256|[A-Za-z]:[\\/]/);
  const config = JSON.parse(fs.readFileSync(path.join(output, 'project', 'src', 'config', 'pet.config.json'), 'utf8'));
  assert.deepEqual(config.selection.prankExcludedCharacterIds, ['person-2', 'person-3']);
});

test('image records use fixed workflow attestation and reject --model', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const file = path.join(preview, 'sources', 'identity.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'synthetic image bytes', 'utf8');
  const rejected = run('record_image_generation.mjs', [
    '--preview', preview, '--file', file, '--kind', 'identity', '--model', 'gpt-image-2'
  ]);
  assert.notEqual(rejected.status, 0);
  const accepted = run('record_image_generation.mjs', [
    '--preview', preview, '--file', file, '--kind', 'identity'
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(preview, 'generation-manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 3);
  assert.deepEqual(manifest.provenancePolicy, {
    generator: 'codex-imagegen',
    declaredModelPolicy: 'gpt-image-2',
    evidenceLevel: 'workflow-attested'
  });
  assert.equal(manifest.assets[0].file, 'preview/sources/identity.png');
  assert.equal(manifest.assets[0].origin, 'generated');
  assert.equal(Object.hasOwn(manifest.assets[0], 'model'), false);
});

test('action records require a matching approved master fingerprint and supported action', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  const master = path.join(sources, 'person-1-master.png');
  const action = path.join(sources, 'person-1-crawl-right-1.png');
  fs.writeFileSync(master, pngFixture('approved master'));
  fs.writeFileSync(action, pngFixture('crawl frame'));
  const masterHash = crypto.createHash('sha256').update(fs.readFileSync(master)).digest('hex');

  const recordedMaster = run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]);
  assert.equal(recordedMaster.status, 0, recordedMaster.stderr);

  const wrongFingerprint = run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_right_1', '--master-fingerprint', '0'.repeat(64), '--prompt-version', 'action-v1', '--version', '1'
  ]);
  assert.notEqual(wrongFingerprint.status, 0);
  assert.match(wrongFingerprint.stderr, /approved master fingerprint/i);

  const unsupportedAction = run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'wave_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '1'
  ]);
  assert.notEqual(unsupportedAction.status, 0);
  assert.match(unsupportedAction.stderr, /unsupported action/i);
});

test('generated action records preserve a validated image generation id', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  const master = path.join(sources, 'person-1-master.png');
  const action = path.join(sources, 'person-1-eat-right.png');
  fs.writeFileSync(master, pngFixture('approved master'));
  fs.writeFileSync(action, pngFixture('eat frame'));
  const masterHash = crypto.createHash('sha256').update(fs.readFileSync(master)).digest('hex');
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]).status, 0);

  const invalid = run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '1',
    '--image-generation-id', 'not-an-image-id'
  ]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /image generation id/i);

  const legacy64Hex = run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '1',
    '--image-generation-id', `ig_${'f'.repeat(64)}`
  ]);
  assert.notEqual(legacy64Hex.status, 0);
  assert.match(legacy64Hex.stderr, /image generation id/i);

  const imageGenerationId = `ig_${'a'.repeat(50)}`;
  const accepted = run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '1',
    '--image-generation-id', imageGenerationId
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(preview, 'generation-manifest.json'), 'utf8'));
  assert.equal(manifest.assets.find((item) => item.action === 'eat_right').imageGenerationId, imageGenerationId);
});

test('generated action records can add a missing image generation id without a fake replacement', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  const master = path.join(sources, 'person-1-master.png');
  const action = path.join(sources, 'person-1-eat-right.png');
  fs.writeFileSync(master, pngFixture('approved master'));
  fs.writeFileSync(action, pngFixture('eat frame'));
  const masterHash = sha256(master);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '1'
  ]).status, 0);

  const imageGenerationId = `ig_${'b'.repeat(50)}`;
  const augmented = run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '1',
    '--image-generation-id', imageGenerationId
  ]);
  assert.equal(augmented.status, 0, augmented.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(preview, 'generation-manifest.json'), 'utf8'));
  const entry = manifest.assets.find((item) => item.action === 'eat_right');
  assert.equal(entry.version, 1);
  assert.equal(entry.imageGenerationId, imageGenerationId);
  assert.equal(manifest.history.length, 0);
});

test('image generation id augmentation preserves an existing replacement chain', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  const master = path.join(sources, 'person-1-master.png');
  const first = path.join(sources, 'person-1-eat-right-v1.png');
  const replacement = path.join(sources, 'person-1-eat-right-v2.png');
  fs.writeFileSync(master, pngFixture('approved master'));
  fs.writeFileSync(first, pngFixture('eat frame v1'));
  fs.writeFileSync(replacement, pngFixture('eat frame v2'));
  const masterHash = sha256(master);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', first, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '1'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', replacement, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '2',
    '--supersedes', 'preview/sources/person-1-eat-right-v1.png', '--reason', 'cleaner silhouette'
  ]).status, 0);

  const imageGenerationId = `ig_${'c'.repeat(50)}`;
  const augmented = run('record_image_generation.mjs', [
    '--preview', preview, '--file', replacement, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '2',
    '--image-generation-id', imageGenerationId
  ]);
  assert.equal(augmented.status, 0, augmented.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(preview, 'generation-manifest.json'), 'utf8'));
  const entry = manifest.assets.find((item) => item.action === 'eat_right');
  assert.equal(entry.version, 2);
  assert.equal(entry.imageGenerationId, imageGenerationId);
  assert.equal(entry.supersedes, 'preview/sources/person-1-eat-right-v1.png');
  assert.equal(entry.replacementReason, 'cleaner silhouette');
  assert.equal(manifest.history.length, 1);
  assert.equal(manifest.history[0].version, 1);
});

test('derived action records reject image generation ids', (t) => {
  const fixture = setupDerivedActionFixture(t);
  const result = run('record_image_generation.mjs', [
    '--preview', fixture.preview, '--file', fixture.derived, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_left_1', '--origin', 'derived', '--derived-from-action', 'crawl_right_1',
    '--transform', 'horizontal-flip', '--version', '1', '--image-generation-id', `ig_${'d'.repeat(50)}`
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only for generated action records/i);
});

test('action records reject an approved master file changed after attestation', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  const master = path.join(sources, 'person-1-master.png');
  const action = path.join(sources, 'person-1-idle-right.png');
  fs.writeFileSync(master, pngFixture('approved master'));
  fs.writeFileSync(action, pngFixture('idle frame'));
  const approvedHash = crypto.createHash('sha256').update(fs.readFileSync(master)).digest('hex');
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]).status, 0);

  fs.writeFileSync(master, pngFixture('tampered master'));
  const result = run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'idle_right', '--master-fingerprint', approvedHash, '--prompt-version', 'action-v1', '--version', '1'
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /master.*changed after.*attestation/i);
});

test('derived action records preserve deterministic horizontal-flip lineage', (t) => {
  const fixture = setupDerivedActionFixture(t);
  const result = run('record_image_generation.mjs', [
    '--preview', fixture.preview, '--file', fixture.derived, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_left_1', '--origin', 'derived', '--derived-from-action', 'crawl_right_1',
    '--transform', 'horizontal-flip', '--version', '1'
  ]);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'generation-manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 3);
  const entry = manifest.assets.find((item) => item.action === 'crawl_left_1');
  assert.deepEqual({
    origin: entry.origin,
    sourceAction: entry.sourceAction,
    sourceFile: entry.sourceFile,
    sourceSha: entry.sourceSha,
    transform: entry.transform,
    derivedSha: entry.derivedSha
  }, {
    origin: 'derived',
    sourceAction: 'crawl_right_1',
    sourceFile: 'preview/sources/person-1-crawl-right-1.png',
    sourceSha: sha256(fixture.source),
    transform: 'horizontal-flip',
    derivedSha: sha256(fixture.derived)
  });
  assert.equal(Object.hasOwn(entry, 'generator'), false);
  assert.equal(Object.hasOwn(entry, 'declaredModelPolicy'), false);
  assert.equal(Object.hasOwn(entry, 'evidenceLevel'), false);
  assert.equal(entry.masterFingerprint, sha256(fixture.master));
});

test('derived action records reject illegal mappings and cross-character sources', (t) => {
  const fixture = setupDerivedActionFixture(t);
  const illegal = run('record_image_generation.mjs', [
    '--preview', fixture.preview, '--file', fixture.derived, '--kind', 'action', '--character', 'person-1',
    '--action', 'idle_left', '--origin', 'derived', '--derived-from-action', 'crawl_right_1',
    '--transform', 'horizontal-flip', '--version', '1'
  ]);
  assert.notEqual(illegal.status, 0);
  assert.match(illegal.stderr, /mapping/i);

  const manifestPath = path.join(fixture.preview, 'generation-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.assets.find((item) => item.action === 'crawl_right_1').characterId = 'person-2';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const crossCharacter = run('record_image_generation.mjs', [
    '--preview', fixture.preview, '--file', fixture.derived, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_left_1', '--origin', 'derived', '--derived-from-action', 'crawl_right_1',
    '--transform', 'horizontal-flip', '--version', '1'
  ]);
  assert.notEqual(crossCharacter.status, 0);
  assert.match(crossCharacter.stderr, /same character|source action/i);
});

test('derived action records reject tampered sources, pixel mismatches, and derived chains', (t) => {
  const tampered = setupDerivedActionFixture(t);
  fs.writeFileSync(tampered.source, rgbaPng(4, 3, (x, y) => x === 1 && y === 1));
  const sourceChanged = run('record_image_generation.mjs', [
    '--preview', tampered.preview, '--file', tampered.derived, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_left_1', '--origin', 'derived', '--derived-from-action', 'crawl_right_1',
    '--transform', 'horizontal-flip', '--version', '1'
  ]);
  assert.notEqual(sourceChanged.status, 0);
  assert.match(sourceChanged.stderr, /source.*changed|attestation/i);

  const mismatch = setupDerivedActionFixture(t);
  fs.writeFileSync(mismatch.derived, rgbaPng(4, 3, (x, y) => x === 0 && y === 0));
  const pixelMismatch = run('record_image_generation.mjs', [
    '--preview', mismatch.preview, '--file', mismatch.derived, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_left_1', '--origin', 'derived', '--derived-from-action', 'crawl_right_1',
    '--transform', 'horizontal-flip', '--version', '1'
  ]);
  assert.notEqual(pixelMismatch.status, 0);
  assert.match(pixelMismatch.stderr, /pixel|horizontal.flip/i);

  const chained = setupDerivedActionFixture(t);
  const manifestPath = path.join(chained.preview, 'generation-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const sourceEntry = manifest.assets.find((item) => item.action === 'crawl_right_1');
  sourceEntry.origin = 'derived';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const chain = run('record_image_generation.mjs', [
    '--preview', chained.preview, '--file', chained.derived, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_left_1', '--origin', 'derived', '--derived-from-action', 'crawl_right_1',
    '--transform', 'horizontal-flip', '--version', '1'
  ]);
  assert.notEqual(chain.status, 0);
  assert.match(chain.stderr, /generated source|derived chain/i);
});

test('recording a generated action safely upgrades a schema v2 manifest', (t) => {
  const fixture = setupDerivedActionFixture(t);
  const manifestPath = path.join(fixture.preview, 'generation-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.schemaVersion = 2;
  for (const entry of manifest.assets) delete entry.origin;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const idle = path.join(fixture.sources, 'person-1-idle-right.png');
  fs.writeFileSync(idle, rgbaPng(4, 3, () => true));
  const result = run('record_image_generation.mjs', [
    '--preview', fixture.preview, '--file', idle, '--kind', 'action', '--character', 'person-1',
    '--action', 'idle_right', '--master-fingerprint', sha256(fixture.master), '--prompt-version', 'action-v1', '--version', '1'
  ]);
  assert.equal(result.status, 0, result.stderr);
  const upgraded = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(upgraded.schemaVersion, 3);
  assert.ok(upgraded.assets.every((entry) => entry.origin === 'generated'));
});

test('self-check rejects tampered derived files and accepts legacy v2 generated schema', (t) => {
  const fixture = setupDerivedActionFixture(t);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', fixture.preview, '--file', fixture.derived, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_left_1', '--origin', 'derived', '--derived-from-action', 'crawl_right_1',
    '--transform', 'horizontal-flip', '--version', '1'
  ]).status, 0);
  const project = path.join(fixture.root, 'project');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(sprites, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 16, windowSize: 16 }, characters: [{ id: 'person-1', displayName: 'Person 1' }]
  }));
  fs.writeFileSync(path.join(configDir, 'behaviors.json'), JSON.stringify({ poopChase: { enabled: false } }));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({ spriteSize: 16, characters: [{ id: 'person-1', frames: {} }] }));

  fs.writeFileSync(fixture.derived, rgbaPng(4, 3, (x, y) => x === 1 && y === 1));
  run('self_check_project.mjs', ['--project', project, '--preview', fixture.preview, '--warn-only']);
  let report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => ['stale-derived-action', 'derived-pixel-mismatch'].includes(issue.code)));

  const manifestPath = path.join(fixture.preview, 'generation-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.schemaVersion = 2;
  manifest.assets = manifest.assets.filter((entry) => entry.origin !== 'derived');
  for (const entry of manifest.assets) delete entry.origin;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  run('self_check_project.mjs', ['--project', project, '--preview', fixture.preview, '--warn-only']);
  report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.equal(report.issues.some((issue) => issue.code === 'generation-manifest-schema'), false);
});

test('action replacements require an exact monotonic same-key chain', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  const master = path.join(sources, 'person-1-master.png');
  const first = path.join(sources, 'person-1-crawl-right-1-v1.png');
  const second = path.join(sources, 'person-1-crawl-right-1-v2.png');
  fs.writeFileSync(master, pngFixture('approved master'));
  fs.writeFileSync(first, pngFixture('crawl v1'));
  fs.writeFileSync(second, pngFixture('crawl v2'));
  const masterHash = crypto.createHash('sha256').update(fs.readFileSync(master)).digest('hex');
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', first, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_right_1', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '1'
  ]).status, 0);

  const missingChain = run('record_image_generation.mjs', [
    '--preview', preview, '--file', second, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_right_1', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '2'
  ]);
  assert.notEqual(missingChain.status, 0);
  assert.match(missingChain.stderr, /supersedes.*reason/i);

  const skippedVersion = run('record_image_generation.mjs', [
    '--preview', preview, '--file', second, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_right_1', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '3',
    '--supersedes', 'preview/sources/person-1-crawl-right-1-v1.png', '--reason', 'repair edge'
  ]);
  assert.notEqual(skippedVersion.status, 0);
  assert.match(skippedVersion.stderr, /increment/i);

  const valid = run('record_image_generation.mjs', [
    '--preview', preview, '--file', second, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_right_1', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '2',
    '--supersedes', 'preview/sources/person-1-crawl-right-1-v1.png', '--reason', 'repair edge'
  ]);
  assert.equal(valid.status, 0, valid.stderr);
});

test('replacement records cannot overwrite the superseded evidence file in place', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  const master = path.join(sources, 'person-1-master.png');
  fs.writeFileSync(master, pngFixture('approved master v1'));

  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]).status, 0);

  fs.writeFileSync(master, pngFixture('approved master v2'));
  const overwritten = run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v2', '--version', '2',
    '--supersedes', 'preview/sources/person-1-master.png', '--reason', 'identity correction'
  ]);
  assert.notEqual(overwritten.status, 0);
  assert.match(overwritten.stderr, /distinct file/i);
});

test('replacement records reject tampered superseded evidence', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  const first = path.join(sources, 'person-1-master-v1.png');
  const second = path.join(sources, 'person-1-master-v2.png');
  fs.writeFileSync(first, pngFixture('approved master v1'));
  fs.writeFileSync(second, pngFixture('approved master v2'));

  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', first, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]).status, 0);
  fs.writeFileSync(first, pngFixture('tampered old master'));

  const tampered = run('record_image_generation.mjs', [
    '--preview', preview, '--file', second, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v2', '--version', '2',
    '--supersedes', 'preview/sources/person-1-master-v1.png', '--reason', 'identity correction'
  ]);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /changed after.*attestation/i);
});

test('alpha anchor proximity rejects points detached from the visible subject', () => {
  const pixels = Buffer.alloc(10 * 10 * 4);
  for (let y = 3; y <= 6; y += 1) {
    for (let x = 3; x <= 6; x += 1) pixels[(y * 10 + x) * 4 + 3] = 255;
  }
  assert.equal(nearestVisibleAlphaDistance(pixels, 10, 10, [0.5, 0.5]), 0);
  assert.ok(nearestVisibleAlphaDistance(pixels, 10, 10, [0, 0]) > 3);
});

test('centipede processing requires explicit head, mouth, and rear anchors', (t) => {
  const root = workspace(t);
  const project = path.join(root, 'project');
  const preview = path.join(root, 'preview');
  const source = path.join(preview, 'person-1-centipede-right.png');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(sprites, { recursive: true });
  fs.mkdirSync(preview, { recursive: true });
  fs.writeFileSync(source, pngFixture('centipede'));
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 112 }, characters: [{ id: 'person-1' }]
  }));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({
    spriteSize: 112, characters: [{ id: 'person-1', frames: {} }]
  }));

  for (const anchorArgs of [
    [],
    ['--mouth', '0.8,0.4', '--rear', '0.2,0.6'],
    ['--head', '0.75,0.3', '--rear', '0.2,0.6'],
    ['--head', '0.75,0.3', '--mouth', '0.8,0.4']
  ]) {
    const result = run('process_action_sprite.mjs', [
      '--project', project, '--file', source, '--character', 'person-1', '--action', 'centipede_right', ...anchorArgs
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--head, --mouth, and --rear/i);
  }
});

test('centipede processing persists three separately calibrated anchors', (t) => {
  const root = workspace(t);
  const project = path.join(root, 'project');
  const preview = path.join(root, 'preview');
  const source = path.join(preview, 'person-1-centipede-right.png');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(sprites, { recursive: true });
  fs.mkdirSync(preview, { recursive: true });
  fs.writeFileSync(source, keyedRgbaPng(96, 64, (x, y) => x >= 8 && x <= 87 && y >= 16 && y <= 47));
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 112 }, characters: [{ id: 'person-1' }]
  }));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({
    spriteSize: 112, characters: [{ id: 'person-1', frames: {} }]
  }));

  const result = run('process_action_sprite.mjs', [
    '--project', project, '--file', source, '--character', 'person-1', '--action', 'centipede_right',
    '--head', '0.78,0.38', '--mouth', '0.88,0.5', '--rear', '0.12,0.5'
  ]);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(sprites, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.characters[0].anchors.right, {
    head: [0.78, 0.38], mouth: [0.88, 0.5], rear: [0.12, 0.5]
  });
  const report = JSON.parse(fs.readFileSync(path.join(sprites, 'person-1', 'centipede_right-processing-report.json'), 'utf8'));
  assert.deepEqual(report.anchors, {
    explicit: true, direction: 'right', head: [0.78, 0.38], mouth: [0.88, 0.5], rear: [0.12, 0.5]
  });
});

test('kneel shout actions replace the runtime shout frames instead of creating unused sprite groups', (t) => {
  const root = workspace(t);
  const project = path.join(root, 'project');
  const preview = path.join(root, 'preview');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(sprites, { recursive: true });
  fs.mkdirSync(preview, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 112 }, characters: [{ id: 'person-1' }]
  }));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({
    spriteSize: 112, characters: [{
      id: 'person-1',
      frames: { kneel_shout_1: ['person-1/kneel_shout_1.png'] }
    }]
  }));
  const personDir = path.join(sprites, 'person-1');
  fs.mkdirSync(personDir, { recursive: true });
  fs.writeFileSync(path.join(personDir, 'kneel_shout_1.png'), keyedRgbaPng(16, 16, () => true));

  for (let frame = 1; frame <= 3; frame += 1) {
    const action = `kneel_shout_${frame}`;
    const source = path.join(preview, `person-1-${action}.png`);
    fs.writeFileSync(source, keyedRgbaPng(96, 64, (x, y) => x >= 12 && x <= 83 && y >= 8 && y <= 55));
    const result = run('process_action_sprite.mjs', [
      '--project', project, '--file', source, '--character', 'person-1', '--action', action
    ]);
    assert.equal(result.status, 0, result.stderr);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(sprites, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.characters[0].frames.shout, [
    'person-1/shout_1.png', 'person-1/shout_2.png', 'person-1/shout_3.png'
  ]);
  for (let frame = 1; frame <= 3; frame += 1) {
    assert.equal(manifest.characters[0].frames[`kneel_shout_${frame}`], undefined);
    assert.equal(fs.existsSync(path.join(sprites, 'person-1', `shout_${frame}.png`)), true);
    assert.equal(fs.existsSync(path.join(sprites, 'person-1', `kneel_shout_${frame}.png`)), false);
  }
});

test('derived action processing mirrors the already processed source sprite exactly', async (t) => {
  const root = workspace(t);
  const project = path.join(root, 'project');
  const preview = path.join(root, 'preview');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(sprites, { recursive: true });
  fs.mkdirSync(preview, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 112 }, characters: [{ id: 'person-1' }]
  }));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({
    spriteSize: 112, characters: [{ id: 'person-1', frames: {} }]
  }));

  const master = path.join(preview, 'person-1-master.png');
  const right = path.join(preview, 'person-1-eat-right.png');
  const left = path.join(preview, 'person-1-eat-left.png');
  fs.writeFileSync(master, pngFixture('approved master'));
  fs.writeFileSync(right, keyedRgbaPng(97, 63, (x, y) => x >= 9 && x <= 70 && y >= 8 && y <= 55 && (x < 50 || y > 22)));
  const sharp = loadSharp(root);
  await sharp(right).flop().png().toFile(left);
  const masterHash = sha256(master);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', right, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '1'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', left, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_left', '--origin', 'derived', '--derived-from-action', 'eat_right',
    '--transform', 'horizontal-flip', '--version', '1'
  ]).status, 0);
  assert.equal(run('process_action_sprite.mjs', [
    '--project', project, '--file', right, '--character', 'person-1', '--action', 'eat_right'
  ]).status, 0);
  const derived = run('process_action_sprite.mjs', [
    '--project', project, '--file', left, '--character', 'person-1', '--action', 'eat_left'
  ]);
  assert.equal(derived.status, 0, derived.stderr);

  const [rightRaw, leftRaw] = await Promise.all([
    sharp(path.join(sprites, 'person-1', 'eat_right.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(path.join(sprites, 'person-1', 'eat_left.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  for (let y = 0; y < rightRaw.info.height; y += 1) {
    for (let x = 0; x < rightRaw.info.width; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        assert.equal(
          leftRaw.data[(y * leftRaw.info.width + x) * 4 + channel],
          rightRaw.data[(y * rightRaw.info.width + (rightRaw.info.width - 1 - x)) * 4 + channel]
        );
      }
    }
  }
  const report = JSON.parse(fs.readFileSync(path.join(sprites, 'person-1', 'eat_left-processing-report.json'), 'utf8'));
  assert.deepEqual(report.derivedFrom, { action: 'eat_right', transform: 'horizontal-flip' });
});

test('self-check rejects missing or alpha-detached centipede manifest anchors', (t) => {
  const root = workspace(t);
  const project = path.join(root, 'project');
  const preview = path.join(root, 'preview');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  const personDir = path.join(sprites, 'person-1');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(personDir, { recursive: true });
  fs.mkdirSync(preview, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 16, windowSize: 16 }, characters: [{ id: 'person-1' }]
  }));
  fs.writeFileSync(path.join(configDir, 'behaviors.json'), JSON.stringify({ poopChase: { enabled: false } }));
  fs.writeFileSync(path.join(personDir, 'centipede_right.png'), rgbaPng(16, 16, (x, y) => x >= 6 && x <= 9 && y >= 6 && y <= 9));

  const writeManifest = (anchors) => fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({
    spriteSize: 16,
    characters: [{ id: 'person-1', frames: { centipede_right: ['person-1/centipede_right.png'] }, anchors }]
  }));
  writeManifest({});
  run('self_check_project.mjs', ['--project', project, '--preview', preview, '--warn-only']);
  let report = JSON.parse(fs.readFileSync(path.join(preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'missing-centipede-anchors'));

  writeManifest({ right: { head: [0.95, 0.05], mouth: [0.95, 0.05], rear: [0.05, 0.95] } });
  run('self_check_project.mjs', ['--project', project, '--preview', preview, '--warn-only']);
  report = JSON.parse(fs.readFileSync(path.join(preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'detached-centipede-anchor'));
});

test('V1 migration is explicit, redacts paths, and preserves dry-run behavior', (t) => {
  const root = workspace(t);
  const project = path.join(root, 'project');
  const preview = path.join(root, 'preview');
  const source = path.join(preview, 'sources', 'identity.png');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'synthetic image bytes', 'utf8');
  fs.writeFileSync(path.join(root, 'project-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    name: 'Legacy',
    people: 1,
    project,
    release: path.join(root, 'release'),
    preview,
    sourcePhoto: { path: syntheticWindowsPath('Users', 'sample', 'roommates.jpg'), sha256: 'secret', size: 123 },
    createdAt: '2026-01-01T00:00:00.000Z',
    selection: { mode: 'normal', userCharacterId: null, leaderId: null, followerIds: [] }
  }, null, 2));
  fs.writeFileSync(path.join(preview, 'generation-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    requiredModel: 'gpt-image-2',
    assets: [{ key: 'identity::', kind: 'identity', file: source, sha256: 'abc' }]
  }, null, 2));
  fs.writeFileSync(path.join(preview, 'legacy-report.md'), `Host path: ${project}\n`, 'utf8');

  const dryRun = run('migrate_project_manifest.mjs', ['--root', root, '--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8')).schemaVersion, 1);

  const applyWithoutConsent = run('migrate_project_manifest.mjs', ['--root', root, '--apply']);
  assert.notEqual(applyWithoutConsent.status, 0);
  const applied = run('migrate_project_manifest.mjs', ['--root', root, '--apply', '--consent', 'confirmed']);
  assert.equal(applied.status, 0, applied.stderr);
  const migrated = JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8'));
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.consent.allSubjectsAuthorized, true);
  assert.equal(Object.hasOwn(migrated, 'sourcePhoto'), false);
  const generation = JSON.parse(fs.readFileSync(path.join(preview, 'generation-manifest.json'), 'utf8'));
  assert.equal(generation.assets[0].file, 'preview/sources/identity.png');
  assert.doesNotMatch(fs.readFileSync(path.join(preview, 'legacy-report.md'), 'utf8'), /[A-Za-z]:[\\/]/);
});

test('output privacy audit rejects host paths and unlisted raster files', (t) => {
  const root = workspace(t);
  const sprites = path.join(root, 'project', 'src', 'assets', 'sprites');
  fs.mkdirSync(sprites, { recursive: true });
  fs.writeFileSync(path.join(root, 'project-manifest.json'), JSON.stringify({
    schemaVersion: 2,
    paths: { project: 'project', release: 'release', preview: 'preview' },
    consent: { allSubjectsAuthorized: true }
  }, null, 2));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({ schemaVersion: 1, characters: [] }, null, 2));
  fs.writeFileSync(path.join(root, 'project', 'leak.json'), JSON.stringify({ path: syntheticWindowsPath('Users', 'sample', 'photo.png') }));
  fs.writeFileSync(path.join(root, 'project', 'unexpected.png'), 'synthetic bytes');
  fs.writeFileSync(path.join(root, 'project', 'unexpected.avif'), 'synthetic avif bytes');
  fs.writeFileSync(path.join(root, 'project', 'renamed-image.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const result = run('audit_output_privacy.mjs', ['--root', root]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected\.avif/);
  assert.match(result.stderr, /renamed-image\.bin/);
});

test('output privacy audit accepts escaped relative Windows paths but rejects real UNC paths', (t) => {
  const root = workspace(t);
  const sprites = path.join(root, 'project', 'src', 'assets', 'sprites');
  fs.mkdirSync(sprites, { recursive: true });
  fs.writeFileSync(path.join(root, 'project-manifest.json'), JSON.stringify({
    schemaVersion: 2,
    paths: { project: 'project', release: 'release', preview: 'preview' },
    consent: { allSubjectsAuthorized: true }
  }, null, 2));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({ schemaVersion: 1, characters: [] }, null, 2));
  const runtimeConfig = path.join(root, 'release', 'windows', 'vk_swiftshader_icd.json');
  fs.mkdirSync(path.dirname(runtimeConfig), { recursive: true });
  fs.writeFileSync(runtimeConfig, JSON.stringify({ ICD: { library_path: '.\\vk_swiftshader.dll' } }));

  const accepted = run('audit_output_privacy.mjs', ['--root', root]);
  assert.equal(accepted.status, 0, accepted.stderr);

  const errorLog = path.join(root, 'preview', 'runtime-smoke-error.txt');
  fs.mkdirSync(path.dirname(errorLog), { recursive: true });
  fs.writeFileSync(errorLog, `Capture failed at ${syntheticWindowsPath('Users', 'sample', 'source.png')}\n`);
  const rejectedLog = run('audit_output_privacy.mjs', ['--root', root]);
  assert.notEqual(rejectedLog.status, 0);
  assert.match(rejectedLog.stderr, /absolute\/private path/);
  fs.rmSync(errorLog);

  fs.writeFileSync(runtimeConfig, JSON.stringify({ ICD: { library_path: syntheticUncPath('synthetic-host', 'share', 'vk_swiftshader.dll') } }));
  const rejected = run('audit_output_privacy.mjs', ['--root', root]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /absolute\/private path/);
});

test('output privacy audit rejects exact source copies in project, release, and preview', (t) => {
  const workspaceRoot = workspace(t);
  const root = path.join(workspaceRoot, 'output');
  const source = path.join(workspaceRoot, 'source.png');
  const sourceBytes = pngFixture('original source');
  fs.writeFileSync(source, sourceBytes);
  const { sprite } = createAuditFixture(root);
  const targets = [
    sprite,
    path.join(root, 'release', 'source.png'),
    path.join(root, 'preview', 'source.png')
  ];

  for (const target of targets) {
    fs.writeFileSync(target, sourceBytes);
    const result = run('audit_output_privacy.mjs', ['--root', root, '--source', source]);
    assert.notEqual(result.status, 0, `${path.relative(root, target)} unexpectedly passed`);
    assert.match(result.stderr, /Original source photo was copied into output/);
    if (target === sprite) fs.writeFileSync(target, pngFixture('generated sprite'));
    else fs.rmSync(target);
  }
});

test('output privacy audit allows generated sprites and same-name images with different content', (t) => {
  const workspaceRoot = workspace(t);
  const root = path.join(workspaceRoot, 'output');
  const source = path.join(workspaceRoot, 'source.png');
  fs.writeFileSync(source, pngFixture('original source'));
  createAuditFixture(root, pngFixture('generated sprite'));
  fs.writeFileSync(path.join(root, 'release', 'source.png'), pngFixture('different generated image'));

  const result = run('audit_output_privacy.mjs', ['--root', root, '--source', source]);
  assert.equal(result.status, 0, result.stderr);
});

test('output privacy audit resolves symlinks before source comparison', (t) => {
  const workspaceRoot = workspace(t);
  const root = path.join(workspaceRoot, 'output');
  const source = path.join(workspaceRoot, 'source-assets', 'source.png');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, pngFixture('original source'));
  createAuditFixture(root);
  let link = path.join(root, 'preview', 'linked-source.png');
  try {
    fs.symlinkSync(source, link, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      link = path.join(root, 'preview', 'linked-source');
      try {
        fs.symlinkSync(path.dirname(source), link, 'junction');
      } catch (junctionError) {
        t.skip(`Symlink and junction creation are unavailable: ${junctionError.code || error.code}`);
        return;
      }
    } else {
      throw error;
    }
  }

  const result = run('audit_output_privacy.mjs', ['--root', root, '--source', source]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /preview\/linked-source/);
  assert.doesNotMatch(result.stderr, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
