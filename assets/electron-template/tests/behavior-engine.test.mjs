import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { BehaviorEngine, sampleTrail } = require('../src/behavior-engine.js');
const configBase = JSON.parse(fs.readFileSync(path.join(root, 'src/config/pet.config.json'), 'utf8'));
const behaviors = JSON.parse(fs.readFileSync(path.join(root, 'src/config/behaviors.json'), 'utf8'));
const manifestBase = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/sprites/manifest.json'), 'utf8'));

function fixture(count = 5) {
  const config = structuredClone(configBase);
  const manifest = structuredClone(manifestBase);
  const fixtureBehaviors = structuredClone(behaviors);
  fixtureBehaviors.centipede.enabled = true;
  config.characters = Array.from({ length: count }, (_, index) => ({ id: `person-${index + 1}`, displayName: `P${index + 1}`, hueRotate: 0 }));
  manifest.characters = config.characters.map((character) => ({ ...structuredClone(manifestBase.characters[0]), id: character.id }));
  return new BehaviorEngine({
    config,
    behaviors: fixtureBehaviors,
    manifest,
    displays: [{ id: 1, workArea: { x: -300, y: 0, width: 1600, height: 900 } }],
    random: () => 0.5
  });
}

function poopFixture() {
  const engine = fixture(5);
  engine.behaviors.poopChase = {
    enabled: true,
    leaderId: 'person-3',
    followerIds: ['person-1', 'person-2', 'person-4', 'person-5'],
    maxSpeed: 300,
    followStrength: 3,
    deadZone: 32,
    gap: 7,
    initialDropDelayMs: 250,
    dropVisibleBeforeEatMs: 650,
    poopDurationMs: 650,
    eatRadius: 48,
    eatDurationMs: 420,
    consumedDelayMs: 180,
    roundResetDelayMs: 600,
    maxDroppings: 1,
    droppingTtlMs: 20000,
    poopSize: 36,
    stinkSize: 28
  };
  return engine;
}

function leaderCursor(engine, offsetX = 0, offsetY = 0) {
  const leader = engine.pets.find((pet) => pet.id === 'person-3');
  const right = engine.anchorsFor(leader, 'right').head;
  const left = engine.anchorsFor(leader, 'left').head;
  const size = engine.config.render.spriteSize;
  return {
    x: leader.x + (right[0] + left[0]) / 2 * size + offsetX,
    y: leader.y + (right[1] + left[1]) / 2 * size + offsetY
  };
}

function assertFiniteState(snapshot) {
  for (const pet of snapshot.pets) {
    for (const key of ['x', 'y', 'vx', 'vy', 'frame', 'effectSize']) {
      assert.ok(Number.isFinite(pet[key]), `${pet.id}.${key} must be finite, got ${pet[key]}`);
    }
  }
  for (const dropping of snapshot.droppings) {
    assert.ok(Number.isFinite(dropping.x), `${dropping.id}.x must be finite`);
    assert.ok(Number.isFinite(dropping.y), `${dropping.id}.y must be finite`);
  }
}

test('samples a trail by arc length', () => {
  const result = sampleTrail([{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: -10, y: 0 }], 15);
  assert.equal(result.x, -5);
  assert.equal(result.y, 0);
});

test('centipede followers remain separated and inside work area', () => {
  const engine = fixture(5);
  engine.toggleCentipede({ x: 600, y: 400 });
  for (let index = 0; index < 160; index += 1) engine.update(1 / 60, { x: 600 + index * 1.5, y: 400 + Math.sin(index / 16) * 80 });
  assert.equal(engine.mode, 'centipede');
  for (const pet of engine.pets) {
    assert.ok(pet.x >= -300 && pet.x <= 1188);
    assert.ok(pet.y >= 0 && pet.y <= 788);
  }
  for (let index = 1; index < engine.pets.length; index += 1) {
    const previous = engine.pets[index - 1];
    const current = engine.pets[index];
    assert.ok(Math.hypot(previous.x - current.x, previous.y - current.y) > 42, `pets ${index} and ${index + 1} overlap`);
  }
});

test('centipede follows the cursor while preserving its connected row', () => {
  const engine = fixture(5);
  engine.toggleCentipede({ x: 600, y: 400 });
  const before = engine.pets.map((pet) => ({ x: pet.x, y: pet.y }));
  const leader = engine.pets[0];
  const rightHead = engine.anchorsFor(leader, 'right').head;
  const leftHead = engine.anchorsFor(leader, 'left').head;
  const size = engine.config.render.spriteSize;
  const cursor = {
    x: leader.x + (rightHead[0] + leftHead[0]) / 2 * size + 360,
    y: leader.y + (rightHead[1] + leftHead[1]) / 2 * size
  };

  for (let frame = 0; frame < 120; frame += 1) engine.update(1 / 60, cursor);

  const movedX = leader.x - before[0].x;
  const movedY = leader.y - before[0].y;
  assert.ok(Math.hypot(movedX, movedY) >= 40, 'leader must visibly follow the cursor');
  for (let index = 1; index < engine.pets.length; index += 1) {
    assert.ok(Math.abs((engine.pets[index].x - before[index].x) - movedX) < 0.01, `pet ${index} must keep the fixed row offset`);
    assert.ok(Math.abs((engine.pets[index].y - before[index].y) - movedY) < 0.01, `pet ${index} must keep the fixed row height`);
    const rear = engine.anchorPoint(engine.pets[index - 1], 'rear');
    const mouth = engine.anchorPoint(engine.pets[index], 'mouth');
    assert.ok(Math.hypot(rear.x - mouth.x, rear.y - mouth.y) <= 10, `connection ${index} is not touching`);
  }
});

test('exiting centipede produces only grandpa phrase', () => {
  const engine = fixture(5);
  engine.toggleCentipede({ x: 600, y: 400 });
  engine.toggleCentipede({ x: 600, y: 400 });
  assert.equal(engine.mode, 'shout');
  assert.ok(engine.pets.every((pet) => pet.phrase === behaviors.phrases.grandpa));
});

test('pause freezes free-roam positions', () => {
  const engine = fixture(1);
  const before = { x: engine.pets[0].x, y: engine.pets[0].y };
  engine.togglePause();
  engine.update(1, { x: 0, y: 0 });
  assert.deepEqual({ x: engine.pets[0].x, y: engine.pets[0].y }, before);
});

test('repairs non-finite state before returning snapshots', () => {
  const engine = fixture(2);
  Object.assign(engine.pets[0], { x: Number.NaN, y: Number.POSITIVE_INFINITY, vx: Number.NaN, frame: Number.NaN });
  assertFiniteState(engine.update(Number.NaN, { x: Number.NaN, y: Number.POSITIVE_INFINITY }));
});

test('poop chase uses configured leader and follower order', () => {
  const engine = poopFixture();
  const cursor = { x: 900, y: 320 };
  engine.togglePoopChase(cursor);
  engine.update(0.25, cursor);
  assert.equal(engine.mode, 'poopChase');
  const leader = engine.pets.find((pet) => pet.id === 'person-3');
  assert.equal(leader.action, 'poop_right');
  assert.equal(engine.droppings.length, 1);
  assert.equal(engine.droppings[0].sourceId, 'person-3');
  assert.equal(engine.droppings[0].targetId, 'person-1');
  const followers = ['person-1', 'person-2', 'person-4', 'person-5'].map((id) => engine.pets.find((pet) => pet.id === id));
  followers.forEach((pet) => assert.equal(pet.action, 'eat_right'));
});

test('each follower eats before passing a new dropping to the next person', () => {
  const engine = poopFixture();
  const expectedSources = ['person-3', 'person-1', 'person-2', 'person-4'];
  const expectedTargets = ['person-1', 'person-2', 'person-4', 'person-5'];
  engine.togglePoopChase(leaderCursor(engine));
  engine.update(0.25, leaderCursor(engine));
  for (let index = 0; index < expectedTargets.length; index += 1) {
    assert.equal(engine.droppings.length, 1);
    assert.equal(engine.droppings[0].sourceId, expectedSources[index]);
    assert.equal(engine.droppings[0].targetId, expectedTargets[index]);
    const currentId = engine.droppings[0].id;
    assert.equal(engine.droppings[0].approachedTarget, true, 'the next eater must begin within the configured eat radius');
    engine.update(0.65, leaderCursor(engine));
    assert.deepEqual(engine.droppings[0].eatenBy, [expectedTargets[index]]);
    assert.equal(engine.droppings[0].id, currentId);
    engine.update(0.42, leaderCursor(engine));
    if (index < expectedTargets.length - 1) assert.equal(engine.pets.find((pet) => pet.id === expectedTargets[index]).action, 'poop_right');
  }
  assert.equal(engine.poopRelay.phase, 'tailDrop');
  assert.equal(engine.droppings[0].sourceId, 'person-5');
  assert.equal(engine.droppings[0].targetId, null);
  engine.update(0.66, leaderCursor(engine));
  engine.update(0.6, leaderCursor(engine));
  assert.equal(engine.droppings[0].sourceId, 'person-3');
  assert.equal(engine.droppings[0].targetId, 'person-1');
});

test('poop chase follows the cursor while keeping one dropping and a fixed row', () => {
  const engine = poopFixture();
  engine.togglePoopChase({ x: 900, y: 320 });
  const before = engine.pets.map((pet) => ({ id: pet.id, x: pet.x, y: pet.y }));
  const leaderBefore = before.find((pet) => pet.id === 'person-3');
  for (let frame = 0; frame < 240; frame += 1) {
    engine.update(1 / 60, { x: 1080, y: 300 });
    assert.equal(engine.droppings.length, 1);
  }
  const leader = engine.pets.find((pet) => pet.id === 'person-3');
  const movedX = leader.x - leaderBefore.x;
  const movedY = leader.y - leaderBefore.y;
  assert.ok(Math.hypot(movedX, movedY) >= 40, 'relay leader must visibly follow the cursor');
  for (const original of before) {
    const pet = engine.pets.find((item) => item.id === original.id);
    assert.ok(Math.abs((pet.x - original.x) - movedX) < 0.01, `${pet.id} must keep the fixed row offset`);
    assert.ok(Math.abs((pet.y - original.y) - movedY) < 0.01, `${pet.id} must keep the fixed row height`);
  }
});

test('followers never use the standing poop pose', () => {
  const engine = poopFixture();
  engine.togglePoopChase({ x: 500, y: 300 });
  engine.update(0.25, { x: 500, y: 300 });
  const followers = ['person-1', 'person-2', 'person-4', 'person-5'].map((id) => engine.pets.find((pet) => pet.id === id));
  assert.ok(followers.every((pet) => !pet.action.startsWith('poop_')));
  engine.update(0.65, { x: -1000000, y: -1000000 });
  assert.ok(followers.every((pet) => !pet.action.startsWith('poop_')));
});

test('poop chase pause and exit preserve recovery controls', () => {
  const engine = poopFixture();
  engine.togglePoopChase({ x: 700, y: 400 });
  for (let index = 0; index < 120; index += 1) engine.update(1 / 60, { x: 700 + index * 2, y: 400 });
  const before = engine.snapshot();
  engine.togglePause();
  engine.update(1, { x: 1000, y: 600 });
  assert.deepEqual(engine.snapshot().droppings, before.droppings);
  engine.togglePause();
  engine.togglePoopChase({ x: 1000, y: 600 });
  assert.equal(engine.mode, 'free');
  assert.equal(engine.droppings.length, 0);
  assert.equal(engine.poopRelay, null);
});
