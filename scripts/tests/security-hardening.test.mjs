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
import { sanitizePersistedValue, sensitivePathMatches } from '../lib/privacy.mjs';
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

function writeGroupShoutScenarioFixture(root) {
  const project = path.join(root, 'project');
  const reportDir = path.join(root, 'preview', 'scenarios', 'dad-shout');
  const configDir = path.join(project, 'src', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  const participantIds = Array.from({ length: 7 }, (_, index) => `person-${index + 1}`);
  const recipientId = 'person-8';
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'scenario-fixture' }));
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 100, windowSize: 160 },
    selection: { userCharacterId: recipientId },
    characters: [...participantIds, recipientId].map((id) => ({ id }))
  }));
  fs.writeFileSync(path.join(configDir, 'behaviors.json'), JSON.stringify({ groupShout: { gatherSpeed: 180 } }));

  const completedPets = [
    ['person-1', 230, 400], ['person-2', 350, 400], ['person-3', 470, 400],
    ['person-4', 170, 520], ['person-5', 290, 520], ['person-6', 410, 520], ['person-7', 530, 520]
  ].map(([id, x, y]) => ({
    id, x, y, vx: 0, vy: 0, frame: 0, action: 'shout', phrase: '',
    direction: x + 50 < 400 ? 'right' : 'left'
  }));
  const recipient = (x = 350, y = 275) => ({
    id: recipientId, x, y, vx: 0, vy: 0, frame: 0, action: 'idle_right', phrase: '', direction: 'right'
  });
  const sample = (phase, pets) => ({ phase, pets: structuredClone(pets) });
  const samples = [
    sample('forming', [...completedPets.map((pet) => ({ ...pet, x: pet.x - 90, y: pet.y - 30, action: 'idle_right' })), recipient(290, 190)]),
    sample('forming', [...completedPets.map((pet) => ({ ...pet, x: pet.x - 45, y: pet.y - 15, action: 'idle_right' })), recipient(320, 220)]),
    sample('forming', [...completedPets.map((pet) => ({ ...pet, x: pet.x - 15, y: pet.y - 5, action: 'idle_right' })), recipient(340, 240)]),
    sample('kneeling', [...completedPets, recipient()]),
    ...[0, 1, 2].map((frame) => sample('shouting', [
      ...completedPets.map((pet) => ({ ...pet, frame, phrase: '爸爸' })), recipient()
    ])),
    ...Array.from({ length: 3 }, () => sample('complete', [...completedPets, recipient()]))
  ];
  const capturePhases = new Map([
    ['forming-early', 'forming'], ['forming-late', 'forming'], ['kneeling', 'kneeling'],
    ['shout-0', 'shouting'], ['shout-1', 'shouting'], ['shout-2', 'shouting']
  ]);
  const captures = [...capturePhases].map(([label, phase]) => {
    const composition = `${label}.png`;
    fs.writeFileSync(path.join(reportDir, composition), pngFixture(label));
    return { label, phase, composition, captureKind: 'desktop-compositor', releaseEligible: true };
  });
  const report = {
    scenario: 'dad-shout', expectedPhrase: '爸爸', expectedOrder: participantIds,
    participantIds, excludedIds: [recipientId], recipientId, skippedReason: null,
    workArea: { x: 0, y: 0, width: 800, height: 700 }, samples, captures
  };
  const reportPath = path.join(reportDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return { project, reportPath, report };
}

function writeGroupShoutNoopScenarioFixture(root) {
  const project = path.join(root, 'project');
  const reportDir = path.join(root, 'preview', 'scenarios', 'dad-shout');
  const configDir = path.join(project, 'src', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'scenario-noop-fixture' }));
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 100, windowSize: 160 },
    characters: [{ id: 'person-1' }],
    selection: { userCharacterId: 'person-1' }
  }));
  fs.writeFileSync(path.join(configDir, 'behaviors.json'), JSON.stringify({ groupShout: { gatherSpeed: 180 } }));
  const pet = { id: 'person-1', x: 200, y: 220, vx: 0, vy: 0, frame: 0, action: 'idle_right', phrase: '', direction: 'right' };
  const report = {
    scenario: 'dad-shout',
    expectedPhrase: '爸爸',
    expectedOrder: [],
    participantIds: [],
    excludedIds: ['person-1'],
    recipientId: 'person-1',
    skippedReason: 'no-eligible-participants',
    workArea: { x: 0, y: 0, width: 800, height: 700 },
    samples: Array.from({ length: 10 }, () => ({ phase: 'free', pets: [structuredClone(pet)] })),
    captures: []
  };
  const reportPath = path.join(reportDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return { project, reportPath, report };
}

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function createReadableRuntimeFixture(t) {
  const root = workspace(t);
  const project = path.join(root, 'project');
  const preview = path.join(root, 'preview');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(sprites, { recursive: true });
  fs.mkdirSync(preview, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 16, windowSize: 16 },
    characters: [{ id: 'person-1' }, { id: 'person-2' }]
  }));
  fs.writeFileSync(path.join(configDir, 'behaviors.json'), JSON.stringify({ poopChase: { enabled: false } }));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({
    spriteSize: 16,
    characters: [{ id: 'person-1', frames: {} }, { id: 'person-2', frames: {} }]
  }));
  return { root, project, preview };
}

function writeRuntimeEvidenceFixture(fixture, {
  includeProduct = true,
  identicalProduct = false,
  controlledSurface = true,
  display = { id: '1', width: 48, height: 24, scaleFactor: 1 },
  captureArea = { x: 0, y: 0, width: 48, height: 24 }
} = {}) {
  const liveCharacters = [
    { id: 'person-1', visible: true, bounds: { x: captureArea.x + 2, y: captureArea.y + 2, width: 16, height: 16 }, desktopForegroundRatio: 0.1, desktopMatchRatio: 0.7 },
    { id: 'person-2', visible: true, bounds: { x: captureArea.x + 28, y: captureArea.y + 2, width: 16, height: 16 }, desktopForegroundRatio: 0.1, desktopMatchRatio: 0.7 }
  ];
  const technicalCharacters = liveCharacters.map(({ id, visible, bounds }) => ({ id, visible, bounds, alphaCoverage: 0.1 }));
  const first = rgbaPng(48, 24, (x, y) => (
    (x >= 4 && x <= 12 && y >= 5 && y <= 19) || (x >= 30 && x <= 38 && y >= 5 && y <= 19)
  ));
  const second = identicalProduct ? first : rgbaPng(48, 24, (x, y) => (
    (x >= 6 && x <= 14 && y >= 5 && y <= 19) || (x >= 28 && x <= 36 && y >= 5 && y <= 19)
  ));
  const paused = second;
  const technical = rgbaPng(48, 24, (x, y) => (
    (x >= 2 && x <= 10 && y >= 5 && y <= 19) || (x >= 36 && x <= 44 && y >= 5 && y <= 19)
  ));
  const evidence = [];
  if (includeProduct) {
    fs.writeFileSync(path.join(fixture.preview, 'runtime-window.png'), first);
    fs.writeFileSync(path.join(fixture.preview, 'runtime-window-2.png'), second);
    fs.writeFileSync(path.join(fixture.preview, 'runtime-paused.png'), paused);
    evidence.push(
      { kind: 'normal-live-1', file: 'runtime-window.png', sha256: sha256Bytes(first), width: 48, height: 24, characters: liveCharacters },
      { kind: 'normal-live-2', file: 'runtime-window-2.png', sha256: sha256Bytes(second), width: 48, height: 24, characters: liveCharacters },
      { kind: 'normal-paused', file: 'runtime-paused.png', sha256: sha256Bytes(paused), width: 48, height: 24, paused: true, characters: liveCharacters }
    );
  }
  fs.writeFileSync(path.join(fixture.preview, 'runtime-smoke-technical.png'), technical);
  evidence.push({ kind: 'technical-window-count', file: 'runtime-smoke-technical.png', sha256: sha256Bytes(technical), width: 48, height: 24, characters: technicalCharacters });
  fs.writeFileSync(path.join(fixture.preview, 'runtime-evidence-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    capturedAt: '2026-08-06T00:00:00.000Z',
    display,
    captureArea,
    surface: controlledSurface ? { kind: 'controlled-validation', containsUserDesktopContent: false } : undefined,
    expectedCharacterIds: ['person-1', 'person-2'],
    evidence
  }, null, 2));
}

function writeHumorScenarioEvidence(fixture, scenario) {
  const directory = path.join(fixture.preview, 'scenarios', scenario);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'composition.png'), rgbaPng(48, 24, (x, y) => x > 4 && x < 44 && y > 3 && y < 21));
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({
    scenario,
    captures: [{ composition: 'composition.png', captureKind: 'desktop-compositor', releaseEligible: true }]
  }, null, 2));
}

function configureHumorMode(fixture, { mode = 'all', selfId = 'person-1' } = {}) {
  const configPath = path.join(fixture.project, 'src', 'config', 'pet.config.json');
  const behaviorsPath = path.join(fixture.project, 'src', 'config', 'behaviors.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const behaviors = JSON.parse(fs.readFileSync(behaviorsPath, 'utf8'));
  const chaseEnabled = mode === 'poop-chase' || mode === 'all';
  const chaseVariant = chaseEnabled ? (selfId ? 'self-poop' : 'cursor-centipede') : null;
  config.selection = { mode, userCharacterId: selfId, prankExcludedCharacterIds: selfId ? [selfId] : [], chaseVariant };
  behaviors.groupShout = { enabled: mode === 'group-shout' || mode === 'all' };
  behaviors.poopChase = { enabled: chaseVariant === 'self-poop' };
  behaviors.centipede = { enabled: chaseVariant === 'cursor-centipede' };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  fs.writeFileSync(behaviorsPath, JSON.stringify(behaviors, null, 2));
  const scenarios = [
    ...(behaviors.groupShout.enabled ? ['dad-shout', 'grandpa-shout'] : []),
    ...(chaseVariant === 'self-poop' ? ['poop-chase'] : []),
    ...(chaseVariant === 'cursor-centipede' ? ['centipede'] : [])
  ];
  for (const scenario of scenarios) writeHumorScenarioEvidence(fixture, scenario);
}

function completeHumorEntry(entry, total = 90) {
  const scores = total === 89
    ? { roleClarity: 23, absurdity: 18, timingEscalation: 18, formationReadability: 13, poopReadability: 8, surpriseRewatch: 9 }
      : { roleClarity: 23, absurdity: 18, timingEscalation: 18, formationReadability: 14, poopReadability: 8, surpriseRewatch: 9 };
  Object.assign(entry, scores, {
    total,
    deductions: ['追逐方向和动作节拍仍有明确扣分。'],
    optimizations: ['已拉开队形间距并强化动作节拍。'],
    reevaluationNotes: '已根据新截图逐项复评并重新计算总分。',
    status: total >= 90 ? 'pass' : 'fail'
  });
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
    consent: 'confirmed',
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
    { self: null },
    { self: 'person-9' },
    { mode: 'legacy-mode' },
    { 'prank-excluded': 'person-3' },
    { leader: 'person-1' },
    { followers: 'person-2,person-3' }
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
      prankExcludedCharacterIds: ['person-2'],
      chaseVariant: 'self-poop',
      groupShoutSkippedReason: null,
      chaseSkippedReason: null,
      leaderId: 'person-2',
      followerIds: ['person-1', 'person-3']
    },
    consent: { allSubjectsAuthorized: true }
  });
  const text = fs.readFileSync(path.join(output, 'project-manifest.json'), 'utf8');
  assert.doesNotMatch(text, /sourcePhoto|createdAt|sha256|[A-Za-z]:[\\/]/);
  const config = JSON.parse(fs.readFileSync(path.join(output, 'project', 'src', 'config', 'pet.config.json'), 'utf8'));
  assert.deepEqual(
    config.characters.map((character) => character.hueRotate),
    [0, 0, 0],
    'photorealistic characters must preserve their generated skin and clothing colors'
  );
  assert.deepEqual(config.selection.prankExcludedCharacterIds, ['person-2']);
  assert.equal(config.selection.chaseVariant, 'self-poop');
  const behavior = JSON.parse(fs.readFileSync(path.join(output, 'project', 'src', 'config', 'behaviors.json'), 'utf8'));
  assert.equal(behavior.groupShout.enabled, true);
  assert.equal(behavior.centipede.enabled, false);
  assert.equal(behavior.poopChase.enabled, true);
  assert.equal(behavior.poopChase.leaderId, 'person-2');
  assert.deepEqual(behavior.poopChase.followerIds, ['person-1', 'person-3']);
});

test('project creation supports a random group photo where the user is not depicted', (t) => {
  const root = workspace(t);
  const output = path.join(root, 'output');
  const result = run('create_project.mjs', createArgs(root, {
    out: output,
    self: 'none'
  }));
  assert.equal(result.status, 0, result.stderr);

  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'project-manifest.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(output, 'project', 'src', 'config', 'pet.config.json'), 'utf8'));
  assert.equal(manifest.selection.userCharacterId, null);
  assert.equal(config.selection.userCharacterId, null);
  assert.deepEqual(manifest.selection.prankExcludedCharacterIds, []);
  assert.deepEqual(config.selection.prankExcludedCharacterIds, []);
  assert.equal(manifest.selection.chaseVariant, 'cursor-centipede');
  assert.equal(config.selection.chaseVariant, 'cursor-centipede');
  const behavior = JSON.parse(fs.readFileSync(path.join(output, 'project', 'src', 'config', 'behaviors.json'), 'utf8'));
  assert.equal(behavior.groupShout.enabled, true);
  assert.equal(behavior.centipede.enabled, true);
  assert.equal(behavior.poopChase.enabled, false);
  assert.equal(manifest.selection.leaderId, null);
  assert.deepEqual(manifest.selection.followerIds, []);
});

test('one-person photo without the user keeps group shout and cursor-centipede enabled', (t) => {
  const root = workspace(t);
  const output = path.join(root, 'output');
  const result = run('create_project.mjs', createArgs(root, {
    out: output,
    people: '1',
    mode: 'all',
    self: 'none'
  }));
  assert.equal(result.status, 0, result.stderr);

  const project = path.join(output, 'project');
  const config = JSON.parse(fs.readFileSync(path.join(project, 'src', 'config', 'pet.config.json'), 'utf8'));
  const behavior = JSON.parse(fs.readFileSync(path.join(project, 'src', 'config', 'behaviors.json'), 'utf8'));
  assert.equal(config.selection.userCharacterId, null);
  assert.equal(config.selection.groupShoutSkippedReason, null);
  assert.equal(config.selection.chaseSkippedReason, null);
  assert.equal(config.selection.chaseVariant, 'cursor-centipede');
  assert.equal(behavior.groupShout.enabled, true);
  assert.equal(behavior.centipede.enabled, true);
  assert.equal(behavior.poopChase.enabled, false);
  assert.equal(run('validate_project.mjs', ['--project', project, '--selection-only']).status, 0);
  assert.equal(spawnSync(process.execPath, [path.join(project, 'tools', 'validate-project.mjs')], {
    cwd: project,
    encoding: 'utf8'
  }).status, 0);
});

test('one-person projects with the selected self preserve requested modes as explicit safe no-ops', (t) => {
  for (const mode of ['normal', 'group-shout', 'poop-chase', 'all']) {
    const root = workspace(t);
    const output = path.join(root, `output-${mode}`);
    const result = run('create_project.mjs', createArgs(root, {
      out: output,
      people: '1',
      mode,
      self: 'person-1'
    }));
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);

    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'project-manifest.json'), 'utf8'));
    const project = path.join(output, 'project');
    const config = JSON.parse(fs.readFileSync(path.join(project, 'src', 'config', 'pet.config.json'), 'utf8'));
    const behavior = JSON.parse(fs.readFileSync(path.join(project, 'src', 'config', 'behaviors.json'), 'utf8'));
    const includesShout = mode === 'group-shout' || mode === 'all';
    const includesChase = mode === 'poop-chase' || mode === 'all';

    assert.equal(config.selection.mode, mode);
    assert.equal(config.selection.userCharacterId, 'person-1');
    assert.deepEqual(config.selection.prankExcludedCharacterIds, ['person-1']);
    assert.equal(config.selection.chaseVariant, null);
    assert.equal(config.selection.groupShoutSkippedReason, includesShout ? 'no-eligible-participants' : null);
    assert.equal(config.selection.chaseSkippedReason, includesChase ? 'no-eligible-followers' : null);
    assert.deepEqual(manifest.selection, {
      mode,
      userCharacterId: 'person-1',
      prankExcludedCharacterIds: ['person-1'],
      chaseVariant: null,
      groupShoutSkippedReason: includesShout ? 'no-eligible-participants' : null,
      chaseSkippedReason: includesChase ? 'no-eligible-followers' : null,
      leaderId: null,
      followerIds: []
    });
    assert.equal(behavior.groupShout.enabled, false);
    assert.equal(behavior.groupShout.skippedReason, includesShout ? 'no-eligible-participants' : null);
    assert.equal(behavior.centipede.enabled, false);
    assert.equal(behavior.poopChase.enabled, false);
    assert.equal(behavior.poopChase.leaderId, null);
    assert.deepEqual(behavior.poopChase.followerIds, []);
    assert.equal(behavior.poopChase.skippedReason, includesChase ? 'no-eligible-followers' : null);

    const validation = run('validate_project.mjs', ['--project', project, '--selection-only']);
    assert.equal(validation.status, 0, `${mode}: ${validation.stderr}`);
    const generatedValidation = spawnSync(process.execPath, [path.join(project, 'tools', 'validate-project.mjs')], {
      cwd: project,
      encoding: 'utf8'
    });
    assert.equal(generatedValidation.status, 0, `${mode} generated validator: ${generatedValidation.stderr}`);
  }
});

test('project creation maps each Chinese-facing mode contract to the correct runtime features', (t) => {
  const cases = [
    { mode: 'normal', self: 'person-2', shout: false, centipede: false, poop: false, chaseVariant: null },
    { mode: 'group-shout', self: 'person-2', shout: true, centipede: false, poop: false, chaseVariant: null },
    { mode: 'poop-chase', self: 'person-2', shout: false, centipede: false, poop: true, chaseVariant: 'self-poop' },
    { mode: 'poop-chase', self: 'none', shout: false, centipede: true, poop: false, chaseVariant: 'cursor-centipede' },
    { mode: 'all', self: 'person-2', shout: true, centipede: false, poop: true, chaseVariant: 'self-poop' },
    { mode: 'all', self: 'none', shout: true, centipede: true, poop: false, chaseVariant: 'cursor-centipede' }
  ];
  for (const [index, expected] of cases.entries()) {
    const root = workspace(t);
    const output = path.join(root, `output-${index}`);
    const result = run('create_project.mjs', createArgs(root, { out: output, mode: expected.mode, self: expected.self }));
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(fs.readFileSync(path.join(output, 'project', 'src', 'config', 'pet.config.json'), 'utf8'));
    const behavior = JSON.parse(fs.readFileSync(path.join(output, 'project', 'src', 'config', 'behaviors.json'), 'utf8'));
    assert.equal(config.selection.chaseVariant, expected.chaseVariant);
    assert.equal(behavior.groupShout.enabled, expected.shout);
    assert.equal(behavior.centipede.enabled, expected.centipede);
    assert.equal(behavior.poopChase.enabled, expected.poop);
  }
});

test('project validator rejects adaptive prank roles that drift from the selected self and mode', (t) => {
  const root = workspace(t);
  const output = path.join(root, 'output');
  const created = run('create_project.mjs', createArgs(root, { out: output, mode: 'all', self: 'person-2' }));
  assert.equal(created.status, 0, created.stderr);
  const project = path.join(output, 'project');
  const configPath = path.join(project, 'src', 'config', 'pet.config.json');
  const behaviorsPath = path.join(project, 'src', 'config', 'behaviors.json');
  const manifestPath = path.join(output, 'project-manifest.json');
  const originalConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const originalBehaviors = JSON.parse(fs.readFileSync(behaviorsPath, 'utf8'));
  const originalManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const verify = () => run('validate_project.mjs', ['--project', project, '--selection-only']);
  const freshValidation = verify();
  assert.equal(freshValidation.status, 0, freshValidation.stderr || 'fresh adaptive project must validate');

  const cases = [
    {
      label: 'extra prank exclusion',
      mutate(config) { config.selection.prankExcludedCharacterIds.push('person-3'); },
      error: /prankExcludedCharacterIds|selected self/i
    },
    {
      label: 'wrong persistent poop source',
      mutate(_config, behavior) { behavior.poopChase.leaderId = 'person-1'; },
      error: /leader|selected self/i
    },
    {
      label: 'missing eater',
      mutate(_config, behavior) { behavior.poopChase.followerIds = ['person-1']; },
      error: /follower|every other/i
    },
    {
      label: 'wrong chase variant',
      mutate(config) { config.selection.chaseVariant = 'cursor-centipede'; },
      error: /chaseVariant|selected self/i
    },
    {
      label: 'both chase engines enabled',
      mutate(_config, behavior) { behavior.centipede.enabled = true; },
      error: /centipede|poopChase|chase/i
    },
    {
      label: 'manifest role drift',
      mutate(_config, _behavior, manifest) { manifest.selection.leaderId = 'person-1'; },
      error: /project-manifest leaderId/i
    }
  ];
  for (const fixture of cases) {
    const config = structuredClone(originalConfig);
    const behavior = structuredClone(originalBehaviors);
    const manifest = structuredClone(originalManifest);
    fixture.mutate(config, behavior, manifest);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    fs.writeFileSync(behaviorsPath, JSON.stringify(behavior, null, 2));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const result = verify();
    assert.notEqual(result.status, 0, `${fixture.label} unexpectedly validated`);
    assert.match(result.stderr, fixture.error);
  }
});

test('project validator rejects forged one-person no-op reasons and invented poop-chase roles', (t) => {
  const root = workspace(t);
  const output = path.join(root, 'output');
  const created = run('create_project.mjs', createArgs(root, {
    out: output,
    people: '1',
    mode: 'all',
    self: 'person-1'
  }));
  assert.equal(created.status, 0, created.stderr);
  const project = path.join(output, 'project');
  const configPath = path.join(project, 'src', 'config', 'pet.config.json');
  const behaviorsPath = path.join(project, 'src', 'config', 'behaviors.json');
  const manifestPath = path.join(output, 'project-manifest.json');
  const originals = [configPath, behaviorsPath, manifestPath].map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
  const verify = () => run('validate_project.mjs', ['--project', project, '--selection-only']);

  const cases = [
    {
      label: 'missing group-shout reason',
      mutate(config) { config.selection.groupShoutSkippedReason = null; },
      error: /groupShoutSkippedReason|no-op/i
    },
    {
      label: 'enabled skipped shout engine',
      mutate(_config, behavior) { behavior.groupShout.enabled = true; },
      error: /groupShout\.enabled|no-op/i
    },
    {
      label: 'invented poop leader',
      mutate(_config, behavior) { behavior.poopChase.leaderId = 'person-1'; },
      error: /invent.*leader|leader.*followers|skipped poopChase/i
    },
    {
      label: 'invented poop follower',
      mutate(_config, behavior) { behavior.poopChase.followerIds = ['person-1']; },
      error: /invent.*followers|leader.*followers|skipped poopChase/i
    },
    {
      label: 'missing empty follower evidence',
      mutate(_config, behavior) { delete behavior.poopChase.followerIds; },
      error: /followerIds|empty follower/i
    },
    {
      label: 'manifest reason drift',
      mutate(_config, _behavior, manifest) { manifest.selection.chaseSkippedReason = null; },
      error: /project-manifest chaseSkippedReason/i
    }
  ];

  for (const fixture of cases) {
    const [config, behavior, manifest] = originals.map((value) => structuredClone(value));
    fixture.mutate(config, behavior, manifest);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    fs.writeFileSync(behaviorsPath, JSON.stringify(behavior, null, 2));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const result = verify();
    assert.notEqual(result.status, 0, `${fixture.label} unexpectedly validated`);
    assert.match(result.stderr, fixture.error);
  }
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

test('native transparency fallback uses a closed authorization flag and fixed provenance', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const file = path.join(preview, 'sources', 'person-1-master-native.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rgbaPng(8, 8, (x, y) => x >= 2 && x <= 5 && y >= 1 && y <= 6));

  const missingAuthorization = run('record_image_generation.mjs', [
    '--preview', preview, '--file', file, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-native-v1', '--version', '1', '--model', 'gpt-image-1.5'
  ]);
  assert.notEqual(missingAuthorization.status, 0);

  const accepted = run('record_image_generation.mjs', [
    '--preview', preview, '--file', file, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-native-v1', '--version', '1',
    '--authorized-native-transparency-fallback'
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(preview, 'generation-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.assets[0], {
    key: 'master:person-1::',
    kind: 'master',
    characterId: 'person-1',
    role: null,
    action: null,
    origin: 'generated',
    masterFingerprint: null,
    promptVersion: 'identity-native-v1',
    version: 1,
    supersedes: null,
    replacementReason: null,
    file: 'preview/sources/person-1-master-native.png',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    generationMode: 'native-transparent-fallback',
    generator: 'codex-imagegen',
    declaredModelPolicy: 'gpt-image-1.5',
    fallbackAuthorization: 'user-explicit',
    fallbackReason: 'chroma-transparency-gate-exhausted',
    evidenceLevel: 'workflow-attested'
  });
});

test('native transparency fallback rejects an opaque file', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const file = path.join(preview, 'sources', 'opaque-master.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rgbaPng(8, 8, () => true));
  const result = run('record_image_generation.mjs', [
    '--preview', preview, '--file', file, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-native-v1', '--version', '1',
    '--authorized-native-transparency-fallback'
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /transparent pixels/i);
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

test('native transparency fallback can add a missing image generation id only with renewed authorization', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  const master = path.join(sources, 'person-1-master-native.png');
  const action = path.join(sources, 'person-1-eat-right-native.png');
  fs.writeFileSync(master, rgbaPng(8, 8, (x, y) => x >= 2 && x <= 5 && y >= 1 && y <= 6));
  fs.writeFileSync(action, rgbaPng(8, 8, (x, y) => x >= 1 && x <= 6 && y >= 2 && y <= 5));
  const masterHash = sha256(master);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-native-v1', '--version', '1', '--authorized-native-transparency-fallback'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-native-v1', '--version', '1',
    '--authorized-native-transparency-fallback'
  ]).status, 0);

  const imageGenerationId = `ig_${'e'.repeat(50)}`;
  const missingAuthorization = run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-native-v1', '--version', '1',
    '--image-generation-id', imageGenerationId
  ]);
  assert.notEqual(missingAuthorization.status, 0);

  const augmented = run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'eat_right', '--master-fingerprint', masterHash, '--prompt-version', 'action-native-v1', '--version', '1',
    '--image-generation-id', imageGenerationId, '--authorized-native-transparency-fallback'
  ]);
  assert.equal(augmented.status, 0, augmented.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(preview, 'generation-manifest.json'), 'utf8'));
  const entry = manifest.assets.find((item) => item.action === 'eat_right');
  assert.equal(entry.imageGenerationId, imageGenerationId);
  assert.equal(entry.generationMode, 'native-transparent-fallback');
  assert.equal(manifest.history.length, 0);
});

test('native transparency fallback replacements preserve history and remain valid derived sources', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  const master = path.join(sources, 'person-1-master-native.png');
  const first = path.join(sources, 'person-1-crawl-right-1-native-v1.png');
  const replacement = path.join(sources, 'person-1-crawl-right-1-native-v2.png');
  const derived = path.join(sources, 'person-1-crawl-left-1-native-v1.png');
  fs.writeFileSync(master, rgbaPng(4, 3, (x, y) => x === 1 && y === 1));
  fs.writeFileSync(first, rgbaPng(4, 3, (x, y) => x === 0 && y === 0));
  fs.writeFileSync(replacement, rgbaPng(4, 3, (x, y) => (x === 0 && y === 0) || (x === 1 && y === 2)));
  fs.writeFileSync(derived, rgbaPng(4, 3, (x, y) => (x === 3 && y === 0) || (x === 2 && y === 2)));
  const masterHash = sha256(master);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-native-v1', '--version', '1', '--authorized-native-transparency-fallback'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', first, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_right_1', '--master-fingerprint', masterHash, '--prompt-version', 'action-native-v1', '--version', '1',
    '--authorized-native-transparency-fallback'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', replacement, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_right_1', '--master-fingerprint', masterHash, '--prompt-version', 'action-native-v2', '--version', '2',
    '--supersedes', 'preview/sources/person-1-crawl-right-1-native-v1.png', '--reason', '更干净的透明边缘',
    '--authorized-native-transparency-fallback'
  ]).status, 0);
  const manifestPath = path.join(preview, 'generation-manifest.json');
  let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.history.find((entry) => entry.action === 'crawl_right_1').generationMode, 'native-transparent-fallback');
  assert.equal(manifest.assets.find((entry) => entry.action === 'crawl_right_1').version, 2);

  manifest.assets.find((entry) => entry.action === 'crawl_right_1').declaredModelPolicy = 'gpt-image-2';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const rejected = run('record_image_generation.mjs', [
    '--preview', preview, '--file', derived, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_left_1', '--origin', 'derived', '--derived-from-action', 'crawl_right_1',
    '--transform', 'horizontal-flip', '--version', '1'
  ]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /attestation/i);

  manifest.assets.find((entry) => entry.action === 'crawl_right_1').declaredModelPolicy = 'gpt-image-1.5';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const derivedResult = run('record_image_generation.mjs', [
    '--preview', preview, '--file', derived, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_left_1', '--origin', 'derived', '--derived-from-action', 'crawl_right_1',
    '--transform', 'horizontal-flip', '--version', '1'
  ]);
  assert.equal(derivedResult.status, 0, derivedResult.stderr);
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.assets.find((entry) => entry.action === 'crawl_left_1').origin, 'derived');
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

test('self-check accepts only complete native transparency fallback attestations', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  const project = path.join(root, 'project');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  fs.mkdirSync(sources, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(sprites, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 16, windowSize: 16 }, characters: [{ id: 'person-1', displayName: 'Person 1' }]
  }));
  fs.writeFileSync(path.join(configDir, 'behaviors.json'), JSON.stringify({ poopChase: { enabled: false } }));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({ spriteSize: 16, characters: [{ id: 'person-1', frames: {} }] }));

  const identity = path.join(sources, 'identity.png');
  const master = path.join(sources, 'person-1-master.png');
  const action = path.join(sources, 'person-1-crawl-right-1.png');
  fs.writeFileSync(identity, rgbaPng(4, 3, () => true));
  fs.writeFileSync(master, rgbaPng(4, 3, (x, y) => x === 1 && y === 1));
  fs.writeFileSync(action, rgbaPng(4, 3, (x, y) => x === 2 && y === 1));
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', identity, '--kind', 'identity'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-native-v1', '--version', '1', '--authorized-native-transparency-fallback'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'crawl_right_1', '--master-fingerprint', sha256(master),
    '--prompt-version', 'action-native-v1', '--version', '1', '--authorized-native-transparency-fallback'
  ]).status, 0);

  const runCheck = () => {
    run('self_check_project.mjs', ['--project', project, '--preview', preview, '--warn-only']);
    return JSON.parse(fs.readFileSync(path.join(preview, 'self-check-report.json'), 'utf8'));
  };
  let report = runCheck();
  assert.equal(report.issues.some((issue) => issue.code === 'invalid-image-generation-attestation'), false);

  const manifestPath = path.join(preview, 'generation-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const fallbackAction = manifest.assets.find((entry) => entry.action === 'crawl_right_1');
  delete fallbackAction.fallbackAuthorization;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  report = runCheck();
  assert.ok(report.issues.some((issue) => issue.code === 'invalid-image-generation-attestation'));

  fallbackAction.fallbackAuthorization = 'user-explicit';
  fallbackAction.declaredModelPolicy = 'gpt-image-2';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  report = runCheck();
  assert.ok(report.issues.some((issue) => issue.code === 'invalid-image-generation-attestation'));

  fallbackAction.declaredModelPolicy = 'gpt-image-1.5';
  manifest.history = [{ ...fallbackAction, fallbackAuthorization: 'implicit' }];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  report = runCheck();
  assert.ok(report.issues.some((issue) => issue.code === 'invalid-image-generation-attestation'));
});

test('no-self generation attestation requires centipede actions but not unused poop or eat roles', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  const project = path.join(root, 'project');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  fs.mkdirSync(sources, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(sprites, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 16, windowSize: 16 },
    characters: [{ id: 'person-1', displayName: 'Person 1' }],
    selection: { mode: 'all', userCharacterId: null, chaseVariant: 'cursor-centipede' }
  }));
  fs.writeFileSync(path.join(configDir, 'behaviors.json'), JSON.stringify({
    groupShout: { enabled: true },
    centipede: { enabled: true },
    poopChase: { enabled: false, leaderId: null, followerIds: [] }
  }));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({
    spriteSize: 16,
    characters: [{ id: 'person-1', frames: {}, anchors: {} }]
  }));

  const identity = path.join(sources, 'identity.png');
  const master = path.join(sources, 'person-1-master.png');
  fs.writeFileSync(identity, pngFixture('identity'));
  fs.writeFileSync(master, pngFixture('master'));
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', identity, '--kind', 'identity'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]).status, 0);
  const masterHash = sha256(master);
  const requiredActions = [
    'crawl_right_1', 'crawl_right_2', 'crawl_left_1', 'crawl_left_2',
    'idle_right', 'idle_left', 'centipede_right', 'centipede_left',
    'kneel_shout_1', 'kneel_shout_2', 'kneel_shout_3', 'drag'
  ];
  for (const action of requiredActions) {
    const file = path.join(sources, `person-1-${action}.png`);
    fs.writeFileSync(file, pngFixture(action));
    const result = run('record_image_generation.mjs', [
      '--preview', preview, '--file', file, '--kind', 'action', '--character', 'person-1',
      '--action', action, '--master-fingerprint', masterHash, '--prompt-version', 'action-v1', '--version', '1'
    ]);
    assert.equal(result.status, 0, `${action}: ${result.stderr}`);
  }

  run('self_check_project.mjs', ['--project', project, '--preview', preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(preview, 'self-check-report.json'), 'utf8'));
  const missing = report.issues
    .filter((issue) => issue.code === 'missing-image-generation-attestation')
    .map((issue) => issue.asset);
  assert.deepEqual(missing, []);

  const behaviorsPath = path.join(configDir, 'behaviors.json');
  const generationManifestPath = path.join(preview, 'generation-manifest.json');
  const tamperedBehaviors = JSON.parse(fs.readFileSync(behaviorsPath, 'utf8'));
  tamperedBehaviors.groupShout.enabled = false;
  tamperedBehaviors.centipede.enabled = false;
  fs.writeFileSync(behaviorsPath, JSON.stringify(tamperedBehaviors, null, 2));
  const generationManifest = JSON.parse(fs.readFileSync(generationManifestPath, 'utf8'));
  generationManifest.assets = generationManifest.assets.filter((entry) => entry.action !== 'centipede_right');
  fs.writeFileSync(generationManifestPath, JSON.stringify(generationManifest, null, 2));

  run('self_check_project.mjs', ['--project', project, '--preview', preview, '--warn-only']);
  const tamperedReport = JSON.parse(fs.readFileSync(path.join(preview, 'self-check-report.json'), 'utf8'));
  assert.ok(tamperedReport.issues.some((issue) => (
    issue.code === 'missing-image-generation-attestation'
    && issue.asset === 'action:person-1:centipede_right'
  )));
});

test('self-check frame gates use canonical self roles even when behaviors try to shrink requirements', (t) => {
  const root = workspace(t);
  const project = path.join(root, 'project');
  const preview = path.join(root, 'preview');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(sprites, { recursive: true });
  fs.mkdirSync(preview, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 16, windowSize: 16 },
    characters: [{ id: 'person-1' }, { id: 'person-2' }],
    selection: { mode: 'group-shout', userCharacterId: 'person-1', groupShoutSkippedReason: null, chaseSkippedReason: null }
  }));
  fs.writeFileSync(path.join(configDir, 'behaviors.json'), JSON.stringify({
    groupShout: { enabled: false },
    centipede: { enabled: false },
    poopChase: { enabled: false, leaderId: null, followerIds: [] }
  }));
  const commonFrames = (id) => ({
    crawl_right: [`${id}/crawl_right_1.png`, `${id}/crawl_right_2.png`],
    crawl_left: [`${id}/crawl_left_1.png`, `${id}/crawl_left_2.png`],
    idle_right: [`${id}/idle_right.png`],
    idle_left: [`${id}/idle_left.png`],
    drag: [`${id}/drag.png`]
  });
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({
    spriteSize: 16,
    characters: [
      { id: 'person-1', frames: commonFrames('person-1'), anchors: {} },
      { id: 'person-2', frames: { ...commonFrames('person-2'), shout: ['person-2/shout_1.png', 'person-2/shout_2.png', 'person-2/shout_3.png'] }, anchors: {} }
    ]
  }));

  run('self_check_project.mjs', ['--project', project, '--preview', preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(preview, 'self-check-report.json'), 'utf8'));
  const irrelevantFrameIssues = report.issues.filter((issue) => (
    issue.code === 'insufficient-animation-frames'
    && (issue.group?.startsWith('centipede_') || (issue.characterId === 'person-1' && issue.group === 'shout'))
  ));
  assert.deepEqual(irrelevantFrameIssues, []);
  assert.equal(report.issues.some((issue) => issue.code === 'missing-centipede-anchors'), false);
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

test('self-check rejects missing or changed replacement history evidence', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  const project = path.join(root, 'project');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  fs.mkdirSync(sources, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(sprites, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 16, windowSize: 16 }, characters: [{ id: 'person-1' }]
  }));
  fs.writeFileSync(path.join(configDir, 'behaviors.json'), JSON.stringify({ poopChase: { enabled: false } }));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({ spriteSize: 16, characters: [{ id: 'person-1', frames: {} }] }));

  const first = path.join(sources, 'person-1-master-v1.png');
  const second = path.join(sources, 'person-1-master-v2.png');
  fs.writeFileSync(first, pngFixture('approved master v1'));
  fs.writeFileSync(second, pngFixture('approved master v2'));
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', first, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v1', '--version', '1'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', second, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-v2', '--version', '2',
    '--supersedes', 'preview/sources/person-1-master-v1.png', '--reason', 'identity correction'
  ]).status, 0);

  const runCheck = () => {
    run('self_check_project.mjs', ['--project', project, '--preview', preview, '--warn-only']);
    return JSON.parse(fs.readFileSync(path.join(preview, 'self-check-report.json'), 'utf8'));
  };
  fs.rmSync(first);
  let report = runCheck();
  assert.ok(report.issues.some((issue) => issue.code === 'missing-generation-history-source'));

  fs.writeFileSync(first, pngFixture('tampered old master'));
  report = runCheck();
  assert.ok(report.issues.some((issue) => issue.code === 'stale-generation-history-attestation'));
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

test('native transparency fallback processing preserves the attested alpha channel', (t) => {
  const root = workspace(t);
  const project = path.join(root, 'project');
  const preview = path.join(root, 'preview');
  const sources = path.join(preview, 'sources');
  const configDir = path.join(project, 'src', 'config');
  const sprites = path.join(project, 'src', 'assets', 'sprites');
  fs.mkdirSync(sources, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(sprites, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({
    render: { spriteSize: 64 }, characters: [{ id: 'person-1' }]
  }));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({
    spriteSize: 64, characters: [{ id: 'person-1', frames: {} }]
  }));

  const master = path.join(sources, 'person-1-master-native.png');
  const action = path.join(sources, 'person-1-idle-right-native.png');
  const nativeAlpha = rgbaPng(32, 32, (x, y) => x >= 8 && x <= 23 && y >= 6 && y <= 25);
  fs.writeFileSync(master, nativeAlpha);
  fs.writeFileSync(action, nativeAlpha);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', master, '--kind', 'master', '--character', 'person-1',
    '--prompt-version', 'identity-native-v1', '--version', '1', '--authorized-native-transparency-fallback'
  ]).status, 0);
  assert.equal(run('record_image_generation.mjs', [
    '--preview', preview, '--file', action, '--kind', 'action', '--character', 'person-1',
    '--action', 'idle_right', '--master-fingerprint', sha256(master),
    '--prompt-version', 'action-native-v1', '--version', '1', '--authorized-native-transparency-fallback'
  ]).status, 0);

  const generationManifestPath = path.join(preview, 'generation-manifest.json');
  const generationManifest = JSON.parse(fs.readFileSync(generationManifestPath, 'utf8'));
  const fallbackAction = generationManifest.assets.find((entry) => entry.action === 'idle_right');
  delete fallbackAction.generationMode;
  fs.writeFileSync(generationManifestPath, JSON.stringify(generationManifest, null, 2));
  const downgraded = run('process_action_sprite.mjs', [
    '--project', project, '--file', action, '--character', 'person-1', '--action', 'idle_right'
  ]);
  assert.notEqual(downgraded.status, 0);
  assert.match(downgraded.stderr, /attestation|generation record/i);

  fallbackAction.generationMode = 'native-transparent-fallback';
  const invalidAttestations = [
    ['generationMode', 'unknown-native-mode'],
    ['declaredModelPolicy', 'gpt-image-2'],
    ['fallbackAuthorization', 'implicit'],
    ['fallbackReason', 'unknown-reason']
  ];
  for (const [field, value] of invalidAttestations) {
    const original = fallbackAction[field];
    fallbackAction[field] = value;
    fs.writeFileSync(generationManifestPath, JSON.stringify(generationManifest, null, 2));
    const rejected = run('process_action_sprite.mjs', [
      '--project', project, '--file', action, '--character', 'person-1', '--action', 'idle_right'
    ]);
    assert.notEqual(rejected.status, 0, `${field} tampering unexpectedly passed`);
    assert.match(rejected.stderr, /attestation|generation record/i);
    fallbackAction[field] = original;
  }
  fs.writeFileSync(generationManifestPath, JSON.stringify(generationManifest, null, 2));

  const result = run('process_action_sprite.mjs', [
    '--project', project, '--file', action, '--character', 'person-1', '--action', 'idle_right'
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(sprites, 'person-1', 'idle_right-processing-report.json'), 'utf8'));
  assert.equal(report.transparencyMode, 'trusted-native-alpha');
  assert.ok(report.coverage > 0.1);
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

test('build scenario gate accepts centered multi-row groups and rejects unsafe or reordered layouts', (t) => {
  const root = workspace(t);
  const { project, reportPath, report } = writeGroupShoutScenarioFixture(root);
  const verify = () => run('build_project.mjs', [
    '--project', project,
    '--verify-scenario-report',
    '--scenario', 'dad-shout',
    '--report', reportPath
  ]);
  const writeReport = (value) => fs.writeFileSync(reportPath, JSON.stringify(value, null, 2));

  const valid = verify();
  assert.equal(valid.status, 0, valid.stderr);

  const cases = [
    {
      label: 'outside the work area',
      mutate(value) { value.samples.find((sample) => sample.phase === 'kneeling').pets[6].x = 750; },
      error: /work area/i
    },
    {
      label: 'overlapping participants',
      mutate(value) { value.samples.find((sample) => sample.phase === 'kneeling').pets[1].x = 220; },
      error: /overlap/i
    },
    {
      label: 'row-major order mismatch',
      mutate(value) {
        const pets = value.samples.find((sample) => sample.phase === 'kneeling').pets;
        [pets[0].id, pets[1].id] = [pets[1].id, pets[0].id];
      },
      error: /order/i
    },
    {
      label: 'recipient intersection',
      mutate(value) { value.samples.find((sample) => sample.phase === 'kneeling').pets.at(-1).y = 350; },
      error: /recipient.*overlap|overlap.*recipient|formation (?:windows|characters visibly) overlap/i
    }
  ];
  for (const fixture of cases) {
    const invalid = structuredClone(report);
    fixture.mutate(invalid);
    writeReport(invalid);
    const result = verify();
    assert.notEqual(result.status, 0, `${fixture.label} unexpectedly passed`);
    assert.match(result.stderr, fixture.error);
  }

  const configPath = path.join(project, 'src', 'config', 'pet.config.json');
  const paddedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  paddedConfig.render.windowSize = 140;
  fs.writeFileSync(configPath, JSON.stringify(paddedConfig));

  const windowOverlap = structuredClone(report);
  writeReport(windowOverlap);
  let result = verify();
  assert.equal(result.status, 0, 'transparent window rectangles may overlap when every visible sprite body remains separate');

  const windowOverflow = structuredClone(report);
  windowOverflow.workArea.width = 720;
  const positions = [
    ['person-1', 210, 380], ['person-2', 370, 380], ['person-3', 530, 380],
    ['person-4', 130, 540], ['person-5', 290, 540], ['person-6', 450, 540], ['person-7', 610, 540]
  ];
  const kneeling = windowOverflow.samples.find((sample) => sample.phase === 'kneeling');
  for (const [id, x, y] of positions) {
    const pet = kneeling.pets.find((candidate) => candidate.id === id);
    Object.assign(pet, { x, y, direction: x + 50 < 420 ? 'right' : 'left' });
  }
  Object.assign(kneeling.pets.find((pet) => pet.id === 'person-8'), { x: 370, y: 200 });
  writeReport(windowOverflow);
  result = verify();
  assert.notEqual(result.status, 0, 'a padded window crosses the work-area edge even though its sprite remains inside');
  assert.match(result.stderr, /work area/i);

  const wrongShoutDirection = structuredClone(report);
  wrongShoutDirection.samples.find((sample) => sample.phase === 'shouting').pets[0].direction = 'left';
  paddedConfig.render.windowSize = 100;
  fs.writeFileSync(configPath, JSON.stringify(paddedConfig));
  writeReport(wrongShoutDirection);
  result = verify();
  assert.notEqual(result.status, 0, 'participants must keep facing the recipient throughout shouting');
  assert.match(result.stderr, /facing/i);
});

test('build scenario gate binds a one-person shout no-op to the selected self', (t) => {
  const root = workspace(t);
  const { project, reportPath, report } = writeGroupShoutNoopScenarioFixture(root);
  const verify = () => run('build_project.mjs', [
    '--project', project,
    '--verify-scenario-report',
    '--scenario', 'dad-shout',
    '--report', reportPath
  ]);
  let result = verify();
  assert.equal(result.status, 0, result.stderr);

  const forged = structuredClone(report);
  forged.recipientId = null;
  fs.writeFileSync(reportPath, JSON.stringify(forged, null, 2));
  result = verify();
  assert.notEqual(result.status, 0, 'a no-op report must not erase the selected-self recipient');
  assert.match(result.stderr, /selected self|recipient/i);
});

test('build scenario gate binds group-shout roles exactly to the selected self', (t) => {
  const root = workspace(t);
  const { project, reportPath, report } = writeGroupShoutScenarioFixture(root);
  const verify = () => run('build_project.mjs', [
    '--project', project,
    '--verify-scenario-report',
    '--scenario', 'dad-shout',
    '--report', reportPath
  ]);
  const writeReport = (value) => fs.writeFileSync(reportPath, JSON.stringify(value, null, 2));

  const wrongRecipient = structuredClone(report);
  wrongRecipient.recipientId = null;
  wrongRecipient.excludedIds = [];
  wrongRecipient.participantIds = wrongRecipient.expectedOrder = report.participantIds.concat(report.recipientId);
  writeReport(wrongRecipient);
  let result = verify();
  assert.notEqual(result.status, 0, 'a project with self must not omit its standing recipient');
  assert.match(result.stderr, /recipient.*selected self|selected self.*recipient/i);

  const extraSpectator = structuredClone(report);
  extraSpectator.participantIds = extraSpectator.expectedOrder = report.participantIds.slice(0, -1);
  extraSpectator.excludedIds = [report.recipientId, report.participantIds.at(-1)];
  writeReport(extraSpectator);
  result = verify();
  assert.notEqual(result.status, 0, 'only the selected self may be excluded from kneeling');
  assert.match(result.stderr, /excluded ids.*only.*selected self/i);

  const allExcluded = structuredClone(report);
  allExcluded.recipientId = report.recipientId;
  allExcluded.participantIds = [];
  allExcluded.expectedOrder = [];
  allExcluded.excludedIds = report.participantIds.concat(report.recipientId);
  allExcluded.skippedReason = 'no-eligible-participants';
  const frozenPets = structuredClone(report.samples[0].pets).map((pet) => ({
    ...pet, vx: 0, vy: 0, action: 'idle_right', phrase: ''
  }));
  allExcluded.samples = Array.from({ length: 10 }, () => ({ phase: 'complete', pets: structuredClone(frozenPets) }));
  writeReport(allExcluded);
  result = verify();
  assert.notEqual(result.status, 0, 'multi-person projects must not turn group shout into an all-excluded no-op');
  assert.match(result.stderr, /no-eligible-participants.*single|single.*no-eligible-participants/i);
});

test('build scenario gate requires every character to kneel when self is absent', (t) => {
  const root = workspace(t);
  const { project, reportPath, report } = writeGroupShoutScenarioFixture(root);
  const configPath = path.join(project, 'src', 'config', 'pet.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.selection.userCharacterId = null;
  config.characters = config.characters.filter((character) => character.id !== report.recipientId);
  fs.writeFileSync(configPath, JSON.stringify(config));
  const noSelfReport = structuredClone(report);
  noSelfReport.recipientId = null;
  noSelfReport.excludedIds = [];
  noSelfReport.samples = noSelfReport.samples.map((sample) => ({
    ...sample,
    pets: sample.pets.filter((pet) => pet.id !== report.recipientId)
  }));
  fs.writeFileSync(reportPath, JSON.stringify(noSelfReport, null, 2));

  const verify = () => run('build_project.mjs', [
    '--project', project,
    '--verify-scenario-report',
    '--scenario', 'dad-shout',
    '--report', reportPath
  ]);
  let result = verify();
  assert.equal(result.status, 0, result.stderr);

  const forgedRecipient = structuredClone(noSelfReport);
  forgedRecipient.recipientId = forgedRecipient.participantIds.at(-1);
  forgedRecipient.excludedIds = [forgedRecipient.recipientId];
  forgedRecipient.participantIds = forgedRecipient.expectedOrder = forgedRecipient.participantIds.slice(0, -1);
  fs.writeFileSync(reportPath, JSON.stringify(forgedRecipient, null, 2));
  result = verify();
  assert.notEqual(result.status, 0, 'a no-self project must not invent a standing recipient');
  assert.match(result.stderr, /without.*self.*recipient|null.*excluded|no self.*recipient/i);
});

test('build scenario gate permits no-eligible-participants only for singleton self', (t) => {
  const root = workspace(t);
  const { project, reportPath, report } = writeGroupShoutScenarioFixture(root);
  const configPath = path.join(project, 'src', 'config', 'pet.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.characters = [{ id: report.recipientId }];
  fs.writeFileSync(configPath, JSON.stringify(config));

  const self = report.samples[0].pets.find((pet) => pet.id === report.recipientId);
  report.participantIds = [];
  report.expectedOrder = [];
  report.excludedIds = [report.recipientId];
  report.recipientId = report.recipientId;
  report.skippedReason = 'no-eligible-participants';
  report.samples = Array.from({ length: 10 }, () => ({
    phase: 'complete',
    pets: [{ ...self, vx: 0, vy: 0, action: 'idle_right', phrase: '' }]
  }));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const result = run('build_project.mjs', [
    '--project', project,
    '--verify-scenario-report',
    '--scenario', 'dad-shout',
    '--report', reportPath
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test('release checklist exposes the exact group-shout role contract without spectator or relay wording', () => {
  const checklist = fs.readFileSync(path.join(skillRoot, 'docs', '发布检查清单.md'), 'utf8');
  assert.match(checklist, /recipientId` 必须是本人/);
  assert.match(checklist, /excludedIds` 必须严格只含本人/);
  assert.match(checklist, /本人不在照片中[\s\S]*recipientId` 必须为 `null`[\s\S]*照片中全员都是跪喊参与者/);
  assert.match(checklist, /只有“照片仅一人且该人就是本人”[\s\S]*no-eligible-participants/);
  assert.doesNotMatch(checklist, /其他被排除者|多额外排除|真实运行覆盖[^\n]*接力/);
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
    render: { spriteSize: 16, windowSize: 16 },
    characters: [{ id: 'person-1' }],
    selection: { mode: 'poop-chase', userCharacterId: null, chaseVariant: 'cursor-centipede', chaseSkippedReason: null }
  }));
  fs.writeFileSync(path.join(configDir, 'behaviors.json'), JSON.stringify({
    centipede: { enabled: true },
    poopChase: { enabled: false }
  }));
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

test('self-check accepts a readable multi-window runtime composition', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  writeRuntimeEvidenceFixture(fixture);

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.equal(report.issues.some((issue) => issue.code === 'runtime-dimensions'), false);
  assert.equal(report.issues.some((issue) => issue.code.startsWith('runtime-product-evidence-')), false);
});

test('self-check creates one evidence-bound six-dimension humor review per enabled special prank', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  configureHumorMode(fixture, { mode: 'all', selfId: 'person-1' });
  writeRuntimeEvidenceFixture(fixture);

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const review = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-review.json'), 'utf8'));
  assert.equal(review.schemaVersion, 3);
  assert.match(review.runtime.humor.contractFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(review.runtime.humor.reviews.map((entry) => entry.prankId), ['dad-shout', 'grandpa-shout', 'poop-chase']);
  for (const entry of review.runtime.humor.reviews) {
    assert.ok(entry.evidenceRefs.length >= 1);
    assert.ok(entry.evidenceRefs.every((reference) => reference.startsWith(`preview/scenarios/${entry.prankId}/`)));
    assert.ok(entry.evidenceRefs.some((reference) => reference.endsWith('.png')));
    assert.equal(entry.roleClarity, null);
    assert.equal(entry.total, null);
    assert.equal(entry.status, 'pending');
  }
});

test('self-check excludes synthetic development captures from manual humor evidence', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  configureHumorMode(fixture, { mode: 'group-shout', selfId: 'person-1' });
  writeRuntimeEvidenceFixture(fixture);
  for (const scenario of ['dad-shout', 'grandpa-shout']) {
    const reportPath = path.join(fixture.preview, 'scenarios', scenario, 'report.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.captures[0].captureKind = 'synthetic-development';
    report.captures[0].releaseEligible = false;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const review = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-review.json'), 'utf8'));
  assert.ok(review.runtime.humor.reviews.every((entry) => entry.evidenceRefs.length === 0));
});

test('self-check does not demand humor evidence for explicitly skipped one-person pranks', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  const configPath = path.join(fixture.project, 'src', 'config', 'pet.config.json');
  const behaviorsPath = path.join(fixture.project, 'src', 'config', 'behaviors.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.characters = [config.characters[0]];
  config.selection = {
    mode: 'all',
    userCharacterId: 'person-1',
    prankExcludedCharacterIds: ['person-1'],
    chaseVariant: null,
    groupShoutSkippedReason: 'no-eligible-participants',
    chaseSkippedReason: 'no-eligible-followers'
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  fs.writeFileSync(behaviorsPath, JSON.stringify({
    groupShout: { enabled: false, skippedReason: 'no-eligible-participants' },
    centipede: { enabled: false },
    poopChase: { enabled: false, leaderId: null, followerIds: [], skippedReason: 'no-eligible-followers' }
  }, null, 2));
  writeRuntimeEvidenceFixture(fixture);

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const review = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-review.json'), 'utf8'));
  assert.equal(review.runtime.humor.required, false);
  assert.equal(review.runtime.humor.status, 'not-applicable');
  assert.deepEqual(review.runtime.humor.reviews, []);
});

test('self-check fails all mode when any individual prank is below the 90-point humor threshold', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  configureHumorMode(fixture, { mode: 'all', selfId: 'person-1' });
  writeRuntimeEvidenceFixture(fixture);

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const reviewPath = path.join(fixture.preview, 'self-check-review.json');
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  Object.assign(review.runtime, { visible: 'pass', framing: 'pass', transparency: 'pass' });
  for (const entry of review.runtime.humor.reviews) completeHumorEntry(entry, entry.prankId === 'grandpa-shout' ? 89 : 90);
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.equal(report.manualReview.humor.reviews.find((entry) => entry.prankId === 'grandpa-shout').total, 89);
  assert.equal(report.manualReview.failed, true);
  assert.ok(report.issues.some((issue) => issue.code === 'manual-humor-below-threshold' && issue.prankId === 'grandpa-shout'));
});

test('self-check rejects forged humor totals, meaningless review text, and stale or cross-prank evidence refs', async (t) => {
  const cases = [
    {
      name: 'reported total differs from the strict sum',
      mutate(entry) { completeHumorEntry(entry, 90); entry.total = 91; }
    },
    {
      name: 'a dimension cannot exceed its weight',
      mutate(entry) { completeHumorEntry(entry, 90); entry.roleClarity = 26; entry.total = 93; }
    },
    {
      name: 'a dimension cannot use fractional points',
      mutate(entry) { completeHumorEntry(entry, 90); entry.absurdity = 17.5; entry.total = 89.5; }
    },
    {
      name: 'deductions cannot use an object',
      mutate(entry) { completeHumorEntry(entry, 90); entry.deductions = [{}]; }
    },
    {
      name: 'optimizations cannot use booleans',
      mutate(entry) { completeHumorEntry(entry, 90); entry.optimizations = [true]; }
    },
    {
      name: 'zero-width reevaluation notes are not meaningful',
      mutate(entry) { completeHumorEntry(entry, 90); entry.reevaluationNotes = '\u200b\u200c\u200d'; }
    },
    {
      name: 'evidence from another prank cannot be reused',
      mutate(entry) { completeHumorEntry(entry, 90); entry.evidenceRefs = ['preview/scenarios/grandpa-shout/composition.png']; }
    },
    {
      name: 'stale scenario evidence cannot be referenced',
      mutate(entry) { completeHumorEntry(entry, 90); entry.evidenceRefs = ['preview/scenarios/dad-shout/removed.png']; }
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const fixture = createReadableRuntimeFixture(t);
      configureHumorMode(fixture, { mode: 'group-shout', selfId: 'person-1' });
      writeRuntimeEvidenceFixture(fixture);
      run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
      const reviewPath = path.join(fixture.preview, 'self-check-review.json');
      const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
      Object.assign(review.runtime, { visible: 'pass', framing: 'pass', transparency: 'pass' });
      for (const entry of review.runtime.humor.reviews) completeHumorEntry(entry, 90);
      scenario.mutate(review.runtime.humor.reviews[0]);
      fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));

      run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
      const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
      assert.equal(report.manualReview.failed, true);
      assert.ok(report.issues.some((issue) => issue.code === 'manual-humor-invalid'));
    });
  }
});

test('self-check derives the runtime fingerprint from the stable humor scoring contract and invalidates schema v2 reviews', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  configureHumorMode(fixture, { mode: 'poop-chase', selfId: null });
  writeRuntimeEvidenceFixture(fixture);

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const reviewPath = path.join(fixture.preview, 'self-check-review.json');
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  const initialFingerprint = review.runtime.artifactFingerprint;
  assert.match(review.runtime.humor.contractFingerprint, /^[a-f0-9]{64}$/);
  assert.match(initialFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(review.runtime.humor.reviews.map((entry) => entry.prankId), ['cursor-centipede']);
  assert.ok(review.runtime.humor.reviews[0].evidenceRefs.every((reference) => reference.startsWith('preview/scenarios/centipede/')));

  review.schemaVersion = 2;
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));
  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.equal(report.status, 'fail');
  assert.ok(report.issues.some((issue) => issue.code === 'review-schema'));
  assert.equal(report.artifacts.runtimeEvidence.fingerprint, initialFingerprint);
});

test('self-check accepts exactly 90 only when every enabled prank has complete current evidence and meaningful review text', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  configureHumorMode(fixture, { mode: 'group-shout', selfId: 'person-1' });
  writeRuntimeEvidenceFixture(fixture);

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const reviewPath = path.join(fixture.preview, 'self-check-review.json');
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  Object.assign(review.runtime, { visible: 'pass', framing: 'pass', transparency: 'pass' });
  for (const entry of review.runtime.humor.reviews) completeHumorEntry(entry, 90);
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.equal(report.manualReview.humor.status, 'pass');
  assert.equal(report.issues.some((issue) => issue.code.startsWith('manual-humor-')), false);
});

test('normal mode does not require a humor review', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  configureHumorMode(fixture, { mode: 'normal', selfId: null });
  writeRuntimeEvidenceFixture(fixture);

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const review = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-review.json'), 'utf8'));
  assert.equal(review.runtime.humor.required, false);
  assert.deepEqual(review.runtime.humor.reviews, []);
});

test('self-check accepts a controlled compositor crop smaller than the physical display', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  writeRuntimeEvidenceFixture(fixture, {
    display: { id: '1', width: 96, height: 48, scaleFactor: 1 },
    captureArea: { x: 24, y: 12, width: 48, height: 24 }
  });

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.equal(report.issues.some((issue) => issue.code === 'runtime-product-evidence-cropped'), false);
  assert.equal(report.issues.some((issue) => issue.code === 'runtime-product-evidence-area-mismatch'), false);
});

test('self-check rejects product frames without the controlled private surface declaration', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  writeRuntimeEvidenceFixture(fixture, { controlledSurface: false });

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'runtime-product-evidence-surface-invalid'));
});

test('self-check rejects product frame dimensions that do not match the declared compositor crop', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  writeRuntimeEvidenceFixture(fixture, { captureArea: { x: 0, y: 0, width: 45, height: 24 } });

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'runtime-product-evidence-area-mismatch'));
});

test('self-check rejects technical smoke used without live product evidence', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  writeRuntimeEvidenceFixture(fixture, { includeProduct: false });

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'runtime-product-evidence-missing'));
});

test('self-check rejects identical live normal-mode frames', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  writeRuntimeEvidenceFixture(fixture, { identicalProduct: true });

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'runtime-product-evidence-frozen'));
});

test('self-check rejects runtime evidence without a paused full composition', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  writeRuntimeEvidenceFixture(fixture);
  const manifestPath = path.join(fixture.preview, 'runtime-evidence-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.evidence = manifest.evidence.filter((entry) => entry.kind !== 'normal-paused');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.rmSync(path.join(fixture.preview, 'runtime-paused.png'), { force: true });

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'runtime-product-evidence-missing' && issue.kind === 'normal-paused'));
});

test('self-check rejects a normal-paused frame that is not declared paused', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  writeRuntimeEvidenceFixture(fixture);
  const manifestPath = path.join(fixture.preview, 'runtime-evidence-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.evidence.find((entry) => entry.kind === 'normal-paused').paused = false;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'runtime-paused-state-invalid' && issue.kind === 'normal-paused'));
});

test('self-check rejects live runtime evidence that omits a configured character', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  writeRuntimeEvidenceFixture(fixture);
  const manifestPath = path.join(fixture.preview, 'runtime-evidence-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.evidence.find((entry) => entry.kind === 'normal-live-1').characters = manifest.evidence
    .find((entry) => entry.kind === 'normal-live-1').characters
    .filter((character) => character.id !== 'person-2');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'runtime-evidence-character-coverage'));
});

test('self-check rejects technical smoke without readable alpha for every configured character', (t) => {
  const fixture = createReadableRuntimeFixture(t);
  writeRuntimeEvidenceFixture(fixture);
  const manifestPath = path.join(fixture.preview, 'runtime-evidence-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.evidence.find((entry) => entry.kind === 'technical-window-count').characters
    .find((character) => character.id === 'person-2').alphaCoverage = 0;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'runtime-evidence-character-coverage'));
});

test('project build keeps live product evidence separate from structural smoke evidence', () => {
  const buildSource = fs.readFileSync(path.join(scripts, 'build_project.mjs'), 'utf8');

  assert.match(buildSource, /runtime-window-2\.png/);
  assert.match(buildSource, /runtime-paused\.png/);
  assert.match(buildSource, /runtime-smoke-technical\.png/);
  assert.match(buildSource, /runtime-evidence-manifest\.json/);
  assert.match(buildSource, /PET_RUNTIME_OUT:\s*runtime/);
  assert.match(buildSource, /PET_RUNTIME_PAUSED_OUT:\s*runtimePaused/);
  assert.match(buildSource, /PET_SMOKE_OUT:\s*runtimeSmokeTechnical/);
  assert.doesNotMatch(buildSource, /PET_SMOKE_OUT:\s*runtime\b/);
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

test('output privacy audit rejects external symlinks even when --source is omitted', (t) => {
  const workspaceRoot = workspace(t);
  const root = path.join(workspaceRoot, 'output');
  const external = path.join(workspaceRoot, 'private-assets');
  fs.mkdirSync(external, { recursive: true });
  fs.writeFileSync(path.join(external, 'private.png'), pngFixture('private external image'));
  createAuditFixture(root);
  const link = path.join(root, 'preview', 'external-assets');
  try {
    fs.symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`Directory link creation is unavailable: ${error.code || error.message}`);
    return;
  }

  const result = run('audit_output_privacy.mjs', ['--root', root]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink|junction|outside the output root/i);
  assert.equal(result.stderr.includes(external), false);
});

test('persisted path privacy covers common POSIX roots and file URLs', () => {
  const samples = [
    ['/', 'Volumes', '/PrivateSSD/project/source.png'].join(''),
    ['/', 'private', '/', 'var', '/folders/aa/source.png'].join(''),
    ['/', 'tmp', '/love-roommate/source.png'].join(''),
    ['file://', '/Users', '/sample/source.png'].join('')
  ];
  for (const sample of samples) assert.ok(sensitivePathMatches(sample).length, sample);
  assert.deepEqual(sensitivePathMatches('https://example.com/assets/source.png'), []);
  const sanitized = sanitizePersistedValue({ samples }, path.resolve('synthetic-output-root'));
  const privateUserSegment = ['/', 'Users', '/sample'].join('');
  assert.ok(sanitized.samples.every((value) => !value.includes('PrivateSSD') && !value.includes(privateUserSegment)));
});
