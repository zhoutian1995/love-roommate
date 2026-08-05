import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { BehaviorEngine } = require('../src/behavior-engine.js');
const configBase = JSON.parse(fs.readFileSync(path.join(root, 'src/config/pet.config.json'), 'utf8'));
const behaviorsBase = JSON.parse(fs.readFileSync(path.join(root, 'src/config/behaviors.json'), 'utf8'));
const manifestBase = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/sprites/manifest.json'), 'utf8'));

function fixture() {
  const config = structuredClone(configBase);
  const behaviors = structuredClone(behaviorsBase);
  const manifest = structuredClone(manifestBase);
  config.characters = Array.from({ length: 5 }, (_, index) => ({ id: `person-${index + 1}`, displayName: `P${index + 1}` }));
  config.selection.userCharacterId = 'person-3';
  config.selection.prankExcludedCharacterIds = ['person-3'];
  manifest.characters = config.characters.map((character) => {
    const entry = { ...structuredClone(manifestBase.characters[0]), id: character.id };
    entry.anchors.right.mouth = [...entry.anchors.right.head];
    entry.anchors.left.mouth = [...entry.anchors.left.head];
    return entry;
  });
  behaviors.centipede.enabled = true;
  behaviors.poopChase = {
    ...behaviors.poopChase,
    enabled: true,
    leaderId: 'person-3',
    followerIds: ['person-1', 'person-2', 'person-4', 'person-5']
  };
  return new BehaviorEngine({
    config,
    behaviors,
    manifest,
    displays: [{ id: 1, workArea: { x: 0, y: 0, width: 1600, height: 900 } }],
    random: () => 0.5
  });
}

const SHOUT_ORDER = ['person-1', 'person-2', 'person-4', 'person-5'];
const EXCLUDED_IDS = ['person-3'];
const SHOUT_SPEED = 180;
const FRAME_DT = 1 / 60;

function stageScatteredPositions(engine) {
  const positions = [
    { x: 40, y: 80 },
    { x: 1240, y: 210 },
    { x: 290, y: 520 },
    { x: 1010, y: 650 },
    { x: 650, y: 30 }
  ];
  engine.pets.forEach((pet, index) => Object.assign(pet, positions[index], {
    vx: 0,
    vy: 0,
    action: 'idle_right',
    frame: 0,
    phrase: ''
  }));
  return engine.pets.map(({ id, x, y }) => ({ id, x, y }));
}

function advance(engine, seconds) {
  const frames = Math.ceil(seconds / FRAME_DT);
  for (let index = 0; index < frames; index += 1) engine.update(FRAME_DT, { x: 800, y: 400 });
  return engine.snapshot();
}

function assertGradualKneelingShout(trigger, phrase) {
  const engine = fixture();
  const startingPositions = stageScatteredPositions(engine);
  const recipientStart = engine.pets.find((pet) => pet.id === 'person-3');
  const recipientStartPoint = { x: recipientStart.x, y: recipientStart.y };
  const result = trigger(engine);

  assert.deepEqual(result, {
    started: true,
    recipientId: 'person-3',
    participantIds: SHOUT_ORDER,
    excludedIds: EXCLUDED_IDS,
    skippedReason: null
  });

  assert.deepEqual(
    engine.pets.map(({ id, x, y }) => ({ id, x, y })),
    startingPositions,
    'triggering a group shout must not teleport anyone into the final row'
  );
  assert.equal(engine.mode, 'shout');
  assert.equal(engine.snapshot().shoutPhase, 'forming');
  assert.ok(engine.pets.every((pet) => pet.phrase === '' && pet.action !== 'shout'));

  let previous = engine.pets.map(({ x, y }) => ({ x, y }));
  let formingSamples = 0;
  const recipientSamples = new Set();
  for (let frame = 0; frame < 600 && engine.snapshot().shoutPhase === 'forming'; frame += 1) {
    const snapshot = engine.update(FRAME_DT, { x: 800, y: 400 });
    snapshot.pets.forEach((pet, index) => {
      const moved = Math.hypot(pet.x - previous[index].x, pet.y - previous[index].y);
      assert.ok(moved <= SHOUT_SPEED * FRAME_DT + 0.001, `${pet.id} moved ${moved}px in one frame`);
    });
    if (snapshot.shoutPhase === 'forming') {
      formingSamples += 1;
      assert.ok(snapshot.pets.filter((pet) => SHOUT_ORDER.includes(pet.id)).every((pet) => pet.phrase === '' && pet.action !== 'shout'));
      const recipient = snapshot.pets.find((pet) => pet.id === 'person-3');
      recipientSamples.add(`${recipient.x.toFixed(3)},${recipient.y.toFixed(3)}`);
      assert.match(recipient.action, /^idle_(left|right)$/);
      assert.equal(recipient.phrase, '');
    }
    previous = snapshot.pets.map(({ x, y }) => ({ x, y }));
  }

  assert.ok(formingSamples >= 3, `expected multiple visible forming samples, got ${formingSamples}`);
  assert.ok(recipientSamples.size >= 3, `expected recipient to have multiple visible forming positions, got ${recipientSamples.size}`);
  let snapshot = engine.snapshot();
  assert.equal(snapshot.shoutPhase, 'kneeling');
  const row = snapshot.pets.filter((pet) => SHOUT_ORDER.includes(pet.id)).sort((a, b) => a.x - b.x);
  assert.ok(row.every((pet) => pet.action === 'shout' && pet.frame === 0 && pet.phrase === ''));
  assert.deepEqual(row.map((pet) => pet.id), SHOUT_ORDER);
  assert.equal(new Set(row.map((pet) => pet.y.toFixed(3))).size, 1);
  const windowPadding = (engine.config.render.windowSize - engine.config.render.spriteSize) / 2;
  const workAreaBottom = engine.displays[0].workArea.y + engine.displays[0].workArea.height;
  assert.ok(row.every((pet) => pet.y + engine.config.render.spriteSize + windowPadding <= workAreaBottom), 'the complete kneeling window must remain visible above the work-area bottom');
  const gaps = row.slice(1).map((pet, index) => pet.x - row[index].x);
  assert.ok(gaps.every((gap) => Math.abs(gap - gaps[0]) < 0.001));
  const recipient = snapshot.pets.find((pet) => pet.id === 'person-3');
  const size = engine.config.render.spriteSize;
  const recipientCenter = recipient.x + size / 2;
  const rowCenter = (row[0].x + row.at(-1).x + size) / 2;
  assert.ok(Math.hypot(recipient.x - recipientStartPoint.x, recipient.y - recipientStartPoint.y) >= 40, 'recipient must visibly move into position');
  assert.ok(Math.abs(recipientCenter - rowCenter) < 0.001, 'recipient must stand on the kneeling row center axis');
  assert.ok(recipient.y + size + 16 <= row[0].y, 'recipient must stand in front of the row without overlap');
  assert.match(recipient.action, /^idle_(left|right)$/);
  assert.equal(recipient.phrase, '');
  row.forEach((pet) => assert.equal(pet.direction, pet.x + size / 2 < recipientCenter ? 'right' : 'left'));
  const recipientFinalState = { x: recipient.x, y: recipient.y, action: recipient.action, phrase: recipient.phrase };

  snapshot = advance(engine, 0.2);
  assert.equal(snapshot.shoutPhase, 'kneeling');
  assert.ok(snapshot.pets.every((pet) => pet.phrase === ''));
  let currentRecipient = snapshot.pets.find((pet) => pet.id === 'person-3');
  assert.deepEqual({ x: currentRecipient.x, y: currentRecipient.y, action: currentRecipient.action, phrase: currentRecipient.phrase }, recipientFinalState);
  snapshot = advance(engine, 0.2);
  assert.equal(snapshot.shoutPhase, 'shouting');
  assert.ok(snapshot.pets.filter((pet) => SHOUT_ORDER.includes(pet.id)).every((pet) => pet.action === 'shout' && pet.frame === 0 && pet.phrase === phrase));
  currentRecipient = snapshot.pets.find((pet) => pet.id === 'person-3');
  assert.deepEqual({ x: currentRecipient.x, y: currentRecipient.y, action: currentRecipient.action, phrase: currentRecipient.phrase }, recipientFinalState);
  snapshot = advance(engine, 1.4);
  assert.ok(snapshot.pets.filter((pet) => SHOUT_ORDER.includes(pet.id)).every((pet) => pet.frame === 1));
  snapshot = advance(engine, 1.4);
  assert.ok(snapshot.pets.filter((pet) => SHOUT_ORDER.includes(pet.id)).every((pet) => pet.frame === 2));
  snapshot = advance(engine, 1.4);
  assert.equal(snapshot.mode, 'free');
}

test('centipede follows the cursor without breaking mouth-to-rear connections', () => {
  const engine = fixture();
  engine.toggleCentipede({ x: 800, y: 400 });
  const positions = engine.pets.map(({ x, y }) => ({ x, y }));
  engine.update(1, { x: 100, y: 100 });
  const movedX = engine.pets[0].x - positions[0].x;
  const movedY = engine.pets[0].y - positions[0].y;
  assert.ok(Math.hypot(movedX, movedY) >= 40);
  engine.pets.forEach((pet, index) => {
    assert.ok(Math.abs((pet.x - positions[index].x) - movedX) < 0.01);
    assert.ok(Math.abs((pet.y - positions[index].y) - movedY) < 0.01);
    assert.ok(pet.x >= 0 && pet.x <= 1488);
    assert.ok(pet.y >= 0 && pet.y <= 788);
  });
  for (let index = 1; index < engine.pets.length; index += 1) {
    const rear = engine.anchorPoint(engine.pets[index - 1], 'rear');
    const mouth = engine.anchorPoint(engine.pets[index], 'mouth');
    assert.ok(Math.hypot(rear.x - mouth.x, rear.y - mouth.y) <= 10);
  }
});

test('relay follows the cursor and promotes each eater to the next poop source', () => {
  const engine = fixture();
  engine.togglePoopChase({ x: 800, y: 400 });
  const positions = engine.pets.map(({ x, y }) => ({ x, y }));
  engine.update(0.25, { x: 100, y: 100 });
  const leader = engine.pets.find((pet) => pet.id === 'person-3');
  const leaderIndex = engine.pets.findIndex((pet) => pet.id === 'person-3');
  const movedX = leader.x - positions[leaderIndex].x;
  const movedY = leader.y - positions[leaderIndex].y;
  assert.ok(Math.hypot(movedX, movedY) >= 40);
  engine.pets.forEach((pet, index) => {
    assert.ok(Math.abs((pet.x - positions[index].x) - movedX) < 0.01);
    assert.ok(Math.abs((pet.y - positions[index].y) - movedY) < 0.01);
  });
  assert.equal(engine.droppings[0].sourceId, 'person-3');
  assert.equal(engine.droppings[0].approachedTarget, true);
  engine.update(0.65, { x: 100, y: 100 });
  engine.update(0.42, { x: 100, y: 100 });
  assert.equal(engine.droppings[0].sourceId, 'person-1');
  const nextSource = engine.pets.find((pet) => pet.id === 'person-1');
  assert.equal(nextSource.action, `poop_${nextSource.direction}`);
});

test('dad gathers only eligible people gradually, kneels, then shouts three frames', () => {
  assertGradualKneelingShout((engine) => engine.callDad(false), behaviorsBase.phrases.dad);
});

test('grandpa gathers only eligible people gradually, kneels, then shouts three frames', () => {
  assertGradualKneelingShout((engine) => engine.callGrandpa(), behaviorsBase.phrases.grandpa);
});

test('dad and grandpa safely skip when every character is prank-excluded', () => {
  for (const trigger of [(engine) => engine.callDad(), (engine) => engine.callGrandpa()]) {
    const engine = fixture();
    engine.config.selection.prankExcludedCharacterIds = engine.pets.map((pet) => pet.id);
    const before = engine.snapshot();
    const result = trigger(engine);
    assert.deepEqual(result, {
      started: false,
      recipientId: 'person-3',
      participantIds: [],
      excludedIds: engine.pets.map((pet) => pet.id),
      skippedReason: 'no-eligible-participants'
    });
    assert.equal(engine.mode, before.mode);
    assert.equal(engine.snapshot().shoutPhase, null);
    assert.deepEqual(engine.snapshot().pets, before.pets);
  }
});
