import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const templateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validatorSource = fs.readFileSync(path.join(templateRoot, 'tools', 'validate-project.mjs'), 'utf8');
const ids = ['person-1', 'person-2', 'person-3'];
const baseGroups = [
  'crawl_right', 'crawl_left', 'idle_right', 'idle_left',
  'centipede_right', 'centipede_left', 'shout', 'drag'
];

function baseBehavior() {
  return {
    schemaVersion: 1,
    hotkeys: { poopChase: 'CommandOrControl+Alt+E' },
    groupShout: { enabled: false },
    centipede: { enabled: false },
    poopChase: {
      enabled: false,
      leaderId: 'person-1',
      followerIds: [],
      maxDroppings: 1
    }
  };
}

function frameMap(characterId, extraGroups = []) {
  return Object.fromEntries([...baseGroups, ...extraGroups].map((group) => [group, [`${characterId}/${group}.png`]]));
}

function fixtureFor({ mode, selfId = null }) {
  const chaseEnabled = mode === 'poop-chase' || mode === 'all';
  const chaseVariant = chaseEnabled ? (selfId ? 'self-poop' : 'cursor-centipede') : null;
  const behavior = baseBehavior();
  behavior.groupShout.enabled = mode === 'group-shout' || mode === 'all';
  behavior.centipede.enabled = chaseVariant === 'cursor-centipede';
  behavior.poopChase.enabled = chaseVariant === 'self-poop';
  if (behavior.poopChase.enabled) {
    behavior.poopChase.leaderId = selfId;
    behavior.poopChase.followerIds = ids.filter((id) => id !== selfId);
  }

  return {
    config: {
      schemaVersion: 1,
      characters: ids.map((id) => ({ id })),
      selection: {
        mode,
        userCharacterId: selfId,
        prankExcludedCharacterIds: selfId ? [selfId] : [],
        chaseVariant
      }
    },
    behavior,
    manifest: {
      schemaVersion: 1,
      characters: ids.map((id) => ({
        id,
        frames: frameMap(id, chaseVariant === 'self-poop'
          ? (id === selfId ? ['poop_right', 'poop_left'] : ['eat_right', 'eat_left'])
          : []),
        anchors: {
          right: { head: [0.8, 0.3], mouth: [0.8, 0.4], rear: [0.2, 0.6] },
          left: { head: [0.2, 0.3], mouth: [0.2, 0.4], rear: [0.8, 0.6] }
        }
      }))
    }
  };
}

function runValidator({ config, behavior, manifest }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-template-validator-'));
  try {
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'assets', 'sprites'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools', 'validate-project.mjs'), validatorSource);
    fs.writeFileSync(path.join(root, 'src', 'config', 'pet.config.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(root, 'src', 'config', 'behaviors.json'), JSON.stringify(behavior));
    fs.writeFileSync(path.join(root, 'src', 'assets', 'sprites', 'manifest.json'), JSON.stringify(manifest));
    for (const character of manifest.characters) {
      for (const files of Object.values(character.frames)) {
        for (const relative of files) {
          const target = path.join(root, 'src', 'assets', 'sprites', relative);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, 'fixture');
        }
      }
    }
    return spawnSync(process.execPath, [path.join(root, 'tools', 'validate-project.mjs')], {
      cwd: root,
      encoding: 'utf8'
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const fixture of [
  { mode: 'normal', selfId: null },
  { mode: 'group-shout', selfId: 'person-2' },
  { mode: 'poop-chase', selfId: 'person-2' },
  { mode: 'all', selfId: null }
]) {
  test(`accepts the ${fixture.mode} public mode with its derived roles`, () => {
    const result = runValidator(fixtureFor(fixture));
    assert.equal(result.status, 0, result.stderr);
  });
}

test('selected self is the only prank-excluded character', () => {
  const fixture = fixtureFor({ mode: 'group-shout', selfId: 'person-2' });
  fixture.config.selection.prankExcludedCharacterIds.push('person-1');
  const result = runValidator(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only the selected self/i);
});

test('no-self projects cannot exclude any photographed character', () => {
  const fixture = fixtureFor({ mode: 'group-shout', selfId: null });
  fixture.config.selection.prankExcludedCharacterIds = ['person-1'];
  const result = runValidator(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /empty when the user is not depicted/i);
});

test('self-poop derives the persistent source and every follower in photo order', () => {
  for (const mutate of [
    (fixture) => { fixture.behavior.poopChase.leaderId = 'person-1'; },
    (fixture) => { fixture.behavior.poopChase.followerIds = ['person-3', 'person-1']; },
    (fixture) => { fixture.behavior.poopChase.followerIds = ['person-1']; }
  ]) {
    const fixture = fixtureFor({ mode: 'poop-chase', selfId: 'person-2' });
    mutate(fixture);
    const result = runValidator(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /selected self|every other character in photo order/i);
  }
});

test('no-self poop chase is cursor-centipede with all characters participating', () => {
  const fixture = fixtureFor({ mode: 'poop-chase', selfId: null });
  fixture.behavior.centipede.enabled = false;
  let result = runValidator(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cursor-centipede|centipede/i);

  const missingParticipant = fixtureFor({ mode: 'poop-chase', selfId: null });
  delete missingParticipant.manifest.characters.find((item) => item.id === 'person-3').frames.centipede_left;
  result = runValidator(missingParticipant);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /person-3.*centipede_left/i);
});

test('role sprites are asymmetric: self poops and every other character eats', () => {
  const fixture = fixtureFor({ mode: 'poop-chase', selfId: 'person-2' });
  let result = runValidator(fixture);
  assert.equal(result.status, 0, result.stderr);

  delete fixture.manifest.characters.find((item) => item.id === 'person-2').frames.poop_left;
  result = runValidator(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /person-2.*poop_left/i);

  const followerFixture = fixtureFor({ mode: 'poop-chase', selfId: 'person-2' });
  delete followerFixture.manifest.characters.find((item) => item.id === 'person-1').frames.eat_right;
  result = runValidator(followerFixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /person-1.*eat_right/i);
});

test('self-poop all mode does not require centipede frames or a shout frame from the selected self', () => {
  const fixture = fixtureFor({ mode: 'all', selfId: 'person-2' });
  for (const character of fixture.manifest.characters) {
    delete character.frames.centipede_right;
    delete character.frames.centipede_left;
  }
  delete fixture.manifest.characters.find((item) => item.id === 'person-2').frames.shout;

  const result = runValidator(fixture);
  assert.equal(result.status, 0, result.stderr);
});

for (const mode of ['normal', 'group-shout', 'poop-chase', 'all']) {
  test(`one-person self project preserves ${mode} while safely skipping impossible prank roles`, () => {
    const fixture = fixtureFor({ mode, selfId: 'person-1' });
    const includesShout = mode === 'group-shout' || mode === 'all';
    const includesChase = mode === 'poop-chase' || mode === 'all';
    fixture.config.characters = fixture.config.characters.slice(0, 1);
    fixture.config.selection.chaseVariant = null;
    fixture.config.selection.groupShoutSkippedReason = includesShout ? 'no-eligible-participants' : null;
    fixture.config.selection.chaseSkippedReason = includesChase ? 'no-eligible-followers' : null;
    fixture.behavior.groupShout = {
      enabled: false,
      skippedReason: includesShout ? 'no-eligible-participants' : null
    };
    fixture.behavior.centipede.enabled = false;
    fixture.behavior.poopChase = {
      ...fixture.behavior.poopChase,
      enabled: false,
      leaderId: null,
      followerIds: [],
      skippedReason: includesChase ? 'no-eligible-followers' : null
    };
    fixture.manifest.characters = fixture.manifest.characters.slice(0, 1);
    for (const group of ['poop_right', 'poop_left', 'eat_right', 'eat_left']) {
      delete fixture.manifest.characters[0].frames[group];
    }

    const result = runValidator(fixture);
    assert.equal(result.status, 0, result.stderr);
  });
}

test('one-person self skip reasons are fail-closed', () => {
  const fixture = fixtureFor({ mode: 'all', selfId: 'person-1' });
  fixture.config.characters = fixture.config.characters.slice(0, 1);
  fixture.config.selection.chaseVariant = null;
  fixture.config.selection.groupShoutSkippedReason = 'no-eligible-participants';
  fixture.config.selection.chaseSkippedReason = 'no-eligible-followers';
  fixture.behavior.groupShout = { enabled: false, skippedReason: 'wrong-reason' };
  fixture.behavior.centipede.enabled = false;
  fixture.behavior.poopChase = {
    ...fixture.behavior.poopChase,
    enabled: false,
    leaderId: null,
    followerIds: [],
    skippedReason: 'wrong-reason'
  };
  fixture.manifest.characters = fixture.manifest.characters.slice(0, 1);
  const result = runValidator(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /skippedReason/i);
});

test('one-person self no-op evidence rejects selection drift and invented poop roles', () => {
  const makeFixture = () => {
    const fixture = fixtureFor({ mode: 'all', selfId: 'person-1' });
    fixture.config.characters = fixture.config.characters.slice(0, 1);
    Object.assign(fixture.config.selection, {
      chaseVariant: null,
      groupShoutSkippedReason: 'no-eligible-participants',
      chaseSkippedReason: 'no-eligible-followers'
    });
    fixture.behavior.groupShout = { enabled: false, skippedReason: 'no-eligible-participants' };
    fixture.behavior.centipede.enabled = false;
    fixture.behavior.poopChase = {
      ...fixture.behavior.poopChase,
      enabled: false,
      leaderId: null,
      followerIds: [],
      skippedReason: 'no-eligible-followers'
    };
    fixture.manifest.characters = fixture.manifest.characters.slice(0, 1);
    return fixture;
  };
  for (const mutate of [
    (fixture) => { fixture.config.selection.groupShoutSkippedReason = null; },
    (fixture) => { fixture.config.selection.chaseSkippedReason = null; },
    (fixture) => { fixture.behavior.poopChase.leaderId = 'person-1'; },
    (fixture) => { fixture.behavior.poopChase.followerIds = ['person-1']; }
  ]) {
    const fixture = makeFixture();
    mutate(fixture);
    const result = runValidator(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skippedReason|leader|follower|no-op/i);
  }
});
