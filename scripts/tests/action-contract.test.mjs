import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const contractPath = path.join(skillRoot, 'scripts', 'lib', 'action-contract.mjs');
let contractModule = {};
try {
  contractModule = await import(pathToFileURL(contractPath));
} catch {
  // The first TDD run intentionally exercises the wished-for API before it exists.
}
const COMMON = [
  'crawl_right_1', 'crawl_right_2', 'crawl_left_1', 'crawl_left_2',
  'idle_right', 'idle_left', 'drag'
];
const SHOUT = ['kneel_shout_1', 'kneel_shout_2', 'kneel_shout_3'];
const POOP = ['poop_right', 'poop_left'];
const EAT = ['eat_right', 'eat_left'];
const CENTIPEDE = ['centipede_right', 'centipede_left'];
const deriveActionContract = contractModule.deriveActionContract || ((config) => {
  const characterIds = config.characters.map((character) => character.id);
  return {
    characterIds,
    actionsByCharacter: Object.fromEntries(characterIds.map((id) => [id, [...COMMON]]))
  };
});
const compareActionContract = contractModule.compareActionContract || (() => ({
  hasDrift: false,
  unexpectedCharacterIds: [],
  missingActions: [],
  misassignedActions: []
}));

function configFor({ count = 3, mode = 'normal', selfId = null, groupSkip = null, chaseSkip = null } = {}) {
  return {
    characters: Array.from({ length: count }, (_, index) => ({ id: `person-${index + 1}`, hueRotate: 0 })),
    selection: {
      mode,
      userCharacterId: selfId,
      groupShoutSkippedReason: groupSkip,
      chaseSkippedReason: chaseSkip
    }
  };
}

const contractCases = [
  {
    name: 'normal has common actions only',
    config: configFor(),
    expected: { 'person-1': COMMON, 'person-2': COMMON, 'person-3': COMMON }
  },
  {
    name: 'group-shout excludes only the selected self',
    config: configFor({ mode: 'group-shout', selfId: 'person-2' }),
    expected: { 'person-1': [...COMMON, ...SHOUT], 'person-2': COMMON, 'person-3': [...COMMON, ...SHOUT] }
  },
  {
    name: 'group-shout includes everyone when self is absent',
    config: configFor({ mode: 'group-shout' }),
    expected: { 'person-1': [...COMMON, ...SHOUT], 'person-2': [...COMMON, ...SHOUT], 'person-3': [...COMMON, ...SHOUT] }
  },
  {
    name: 'singleton group-shout still includes the only character when self is absent',
    config: configFor({ count: 1, mode: 'group-shout' }),
    expected: { 'person-1': [...COMMON, ...SHOUT] }
  },
  {
    name: 'singleton self safely skips group-shout',
    config: configFor({ count: 1, mode: 'group-shout', selfId: 'person-1', groupSkip: 'no-eligible-participants' }),
    expected: { 'person-1': COMMON }
  },
  {
    name: 'self-poop assigns poop only to self and eat only to everyone else',
    config: configFor({ mode: 'poop-chase', selfId: 'person-2' }),
    expected: { 'person-1': [...COMMON, ...EAT], 'person-2': [...COMMON, ...POOP], 'person-3': [...COMMON, ...EAT] }
  },
  {
    name: 'cursor-centipede assigns centipede to every character',
    config: configFor({ mode: 'poop-chase' }),
    expected: { 'person-1': [...COMMON, ...CENTIPEDE], 'person-2': [...COMMON, ...CENTIPEDE], 'person-3': [...COMMON, ...CENTIPEDE] }
  },
  {
    name: 'all composes group-shout and self-poop without giving self kneel actions',
    config: configFor({ mode: 'all', selfId: 'person-2' }),
    expected: {
      'person-1': [...COMMON, ...SHOUT, ...EAT],
      'person-2': [...COMMON, ...POOP],
      'person-3': [...COMMON, ...SHOUT, ...EAT]
    }
  },
  {
    name: 'singleton self safely skips both prank action families',
    config: configFor({
      count: 1,
      mode: 'all',
      selfId: 'person-1',
      groupSkip: 'no-eligible-participants',
      chaseSkip: 'no-eligible-followers'
    }),
    expected: { 'person-1': COMMON }
  }
];

for (const fixture of contractCases) {
  test(`canonical action contract: ${fixture.name}`, () => {
    const config = structuredClone(fixture.config);
    config.behaviors = {
      groupShout: { enabled: false },
      centipede: { enabled: false },
      poopChase: { enabled: false, leaderId: 'forged', followerIds: [] }
    };
    const contract = deriveActionContract(config);
    assert.deepEqual(contract.actionsByCharacter, fixture.expected);
  });
}

test('contract comparison reports missing, misassigned, and character drift for later self-check reuse', () => {
  const contract = deriveActionContract(configFor({ mode: 'poop-chase', selfId: 'person-2' }));
  const manifest = manifestFor(contract);
  delete manifest.characters.find((entry) => entry.id === 'person-2').frames.poop_left;
  manifest.characters.find((entry) => entry.id === 'person-1').frames.poop_left = ['person-1/poop_left.png'];
  manifest.characters.push({ id: 'intruder', frames: {}, anchors: {} });

  const drift = compareActionContract(contract, manifest);
  assert.equal(drift.hasDrift, true);
  assert.deepEqual(drift.unexpectedCharacterIds, ['intruder']);
  assert.deepEqual(drift.missingActions, [{ characterId: 'person-2', action: 'poop_left' }]);
  assert.deepEqual(drift.misassignedActions, [{
    action: 'poop_left',
    expectedCharacterId: 'person-2',
    actualCharacterIds: ['person-1']
  }]);
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rgbaPng(width = 16, height = 16) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      row[offset] = 40; row[offset + 1] = 80; row[offset + 2] = 120;
      row[offset + 3] = x >= 4 && x <= 11 && y >= 4 && y <= 11 ? 255 : 0;
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

function actionFrame(action, characterId) {
  if (action.startsWith('crawl_right_')) return { group: 'crawl_right', index: Number(action.at(-1)) - 1, filename: action };
  if (action.startsWith('crawl_left_')) return { group: 'crawl_left', index: Number(action.at(-1)) - 1, filename: action };
  if (action.startsWith('kneel_shout_')) return { group: 'shout', index: Number(action.at(-1)) - 1, filename: action.replace('kneel_shout_', 'shout_') };
  return { group: action, index: 0, filename: action };
}

function manifestFor(contract) {
  return {
    schemaVersion: 1,
    spriteSize: 112,
    characters: contract.characterIds.map((id) => {
      const frames = {};
      for (const action of contract.actionsByCharacter[id]) {
        const descriptor = actionFrame(action, id);
        frames[descriptor.group] ||= [];
        frames[descriptor.group][descriptor.index] = `${id}/${descriptor.filename}.png`;
      }
      return {
        id,
        frames,
        anchors: {
          right: { head: [0.82, 0.38], mouth: [0.82, 0.38], rear: [0.18, 0.62] },
          left: { head: [0.18, 0.38], mouth: [0.18, 0.38], rear: [0.82, 0.62] }
        }
      };
    })
  };
}

function behaviorFor(config) {
  const ids = config.characters.map((character) => character.id);
  const selection = config.selection;
  const singletonSelf = ids.length === 1 && selection.userCharacterId === ids[0];
  const shoutEnabled = ['group-shout', 'all'].includes(selection.mode) && !singletonSelf;
  const chaseSelected = ['poop-chase', 'all'].includes(selection.mode);
  const chaseSkipped = chaseSelected && singletonSelf;
  const selfPoop = chaseSelected && !chaseSkipped && selection.userCharacterId;
  const cursorCentipede = chaseSelected && !chaseSkipped && !selection.userCharacterId;
  return {
    schemaVersion: 1,
    hotkeys: {
      dad: 'CommandOrControl+Alt+B', grandpa: 'CommandOrControl+Alt+G', centipede: 'CommandOrControl+Alt+C',
      poopChase: 'CommandOrControl+Alt+E', pause: 'CommandOrControl+Alt+P'
    },
    groupShout: { enabled: shoutEnabled, skippedReason: selection.groupShoutSkippedReason ?? null },
    centipede: { enabled: Boolean(cursorCentipede) },
    poopChase: {
      enabled: Boolean(selfPoop),
      leaderId: selfPoop ? selection.userCharacterId : null,
      followerIds: selfPoop ? ids.filter((id) => id !== selection.userCharacterId) : [],
      skippedReason: selection.chaseSkippedReason ?? null,
      maxSpeed: 300, followStrength: 3, gap: 7, deadZone: 32, dropDistance: 88,
      minDropIntervalMs: 650, initialDropDelayMs: 250, dropVisibleBeforeEatMs: 650,
      poopDurationMs: 650, eatRadius: 48, eatDurationMs: 420, consumedDelayMs: 240,
      roundResetDelayMs: 600, maxDroppings: 1, droppingTtlMs: 20000, poopSize: 48, stinkSize: 28
    }
  };
}

function createProjectFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-action-contract-'));
  const project = path.join(root, 'project');
  const config = configFor(options);
  Object.assign(config, {
    schemaVersion: 1,
    app: { name: 'Action Contract Fixture' },
    render: { spriteSize: 112, effectSize: 32, windowSize: 180 },
    packaging: { windowsTarget: 'portable', macTarget: 'dir', macArch: 'arm64' }
  });
  config.selection.prankExcludedCharacterIds = config.selection.userCharacterId ? [config.selection.userCharacterId] : [];
  const singletonSelf = config.characters.length === 1 && config.selection.userCharacterId === config.characters[0].id;
  const chaseSelected = ['poop-chase', 'all'].includes(config.selection.mode);
  config.selection.chaseVariant = chaseSelected && !singletonSelf
    ? (config.selection.userCharacterId ? 'self-poop' : 'cursor-centipede')
    : null;
  const contract = deriveActionContract(config);
  const manifest = manifestFor(contract);
  const behaviors = behaviorFor(config);
  const projectManifest = {
    schemaVersion: 2,
    name: config.app.name,
    people: config.characters.length,
    paths: { project: 'project', release: 'release', preview: 'preview' },
    selection: {
      ...config.selection,
      leaderId: behaviors.poopChase.enabled ? behaviors.poopChase.leaderId : null,
      followerIds: behaviors.poopChase.enabled ? behaviors.poopChase.followerIds : []
    },
    consent: { allSubjectsAuthorized: true }
  };
  fs.mkdirSync(path.join(project, 'src', 'config'), { recursive: true });
  fs.mkdirSync(path.join(project, 'src', 'assets', 'sprites'), { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(project, 'src', 'config', 'pet.config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(project, 'src', 'config', 'behaviors.json'), JSON.stringify(behaviors));
  fs.writeFileSync(path.join(project, 'src', 'assets', 'sprites', 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, 'project-manifest.json'), JSON.stringify(projectManifest));
  for (const character of manifest.characters) {
    for (const files of Object.values(character.frames)) {
      for (const relative of files) {
        const file = path.join(project, 'src', 'assets', 'sprites', relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, rgbaPng());
      }
    }
  }
  return { root, project, config, behaviors, manifest };
}

function writeFixture(fixture) {
  fs.writeFileSync(path.join(fixture.project, 'src', 'config', 'pet.config.json'), JSON.stringify(fixture.config));
  fs.writeFileSync(path.join(fixture.project, 'src', 'config', 'behaviors.json'), JSON.stringify(fixture.behaviors));
  fs.writeFileSync(path.join(fixture.project, 'src', 'assets', 'sprites', 'manifest.json'), JSON.stringify(fixture.manifest));
}

function runValidator(fixture) {
  return spawnSync(process.execPath, [path.join(skillRoot, 'scripts', 'validate_project.mjs'), '--project', fixture.project], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_NODE_MODULES: path.join(os.tmpdir(), 'codex-sharp-runtime', `0.34.5-${process.platform}-${process.arch}`, 'node_modules')
    }
  });
}

for (const fixture of [
  { name: 'normal common-only manifest', options: { mode: 'normal' } },
  { name: 'group-shout manifest with kneel frames only on non-self characters', options: { mode: 'group-shout', selfId: 'person-2' } },
  { name: 'self-poop manifest with asymmetric role frames', options: { mode: 'poop-chase', selfId: 'person-2' } },
  { name: 'cursor-centipede manifest with all characters participating', options: { mode: 'poop-chase' } },
  {
    name: 'singleton self common-only manifest with explicit skips',
    options: {
      count: 1, mode: 'all', selfId: 'person-1',
      groupSkip: 'no-eligible-participants', chaseSkip: 'no-eligible-followers'
    }
  }
]) {
  test(`formal validator accepts ${fixture.name}`, (t) => {
    const projectFixture = createProjectFixture(fixture.options);
    t.after(() => fs.rmSync(projectFixture.root, { recursive: true, force: true }));
    const result = runValidator(projectFixture);
    assert.equal(result.status, 0, result.stderr);
  });
}

test('formal validator rejects a missing canonical action even when behaviors claim another role', (t) => {
  const fixture = createProjectFixture({ mode: 'poop-chase' });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  delete fixture.manifest.characters.find((entry) => entry.id === 'person-3').frames.centipede_left;
  fixture.behaviors.centipede.enabled = false;
  writeFixture(fixture);
  const result = runValidator(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /person-3.*centipede_left/i);
});

test('formal validator rejects self-poop role drift', (t) => {
  const fixture = createProjectFixture({ mode: 'poop-chase', selfId: 'person-2' });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const self = fixture.manifest.characters.find((entry) => entry.id === 'person-2');
  const follower = fixture.manifest.characters.find((entry) => entry.id === 'person-1');
  delete self.frames.poop_left;
  follower.frames.poop_left = ['person-1/poop_left.png'];
  const misplaced = path.join(fixture.project, 'src', 'assets', 'sprites', 'person-1', 'poop_left.png');
  fs.writeFileSync(misplaced, rgbaPng());
  writeFixture(fixture);
  const result = runValidator(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /role drift|person-2.*poop_left/i);
});

test('formal validator rejects manifest character drift', (t) => {
  const fixture = createProjectFixture({ mode: 'normal' });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fixture.manifest.characters.push({ id: 'intruder', frames: {}, anchors: {} });
  writeFixture(fixture);
  const result = runValidator(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected manifest character.*intruder/i);
});

test('formal validator enforces photorealistic hueRotate strictly at zero', (t) => {
  const fixture = createProjectFixture({ mode: 'normal' });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fixture.config.characters[1].hueRotate = 12;
  writeFixture(fixture);
  const result = runValidator(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /person-2.*hueRotate.*0/i);
});
