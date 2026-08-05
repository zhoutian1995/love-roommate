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

test('group shout uses three kneeling frames before returning to free mode', () => {
  const engine = fixture();
  engine.callGrandpa();
  assert.ok(engine.pets.every((pet) => pet.action === 'kneel_shout_1'));
  engine.update(1, {}); engine.update(0.41, {});
  assert.ok(engine.pets.every((pet) => pet.action === 'kneel_shout_2'));
  engine.update(1, {}); engine.update(0.41, {});
  assert.ok(engine.pets.every((pet) => pet.action === 'kneel_shout_3'));
  engine.update(1, {}); engine.update(0.41, {});
  assert.equal(engine.mode, 'free');
});

test('single dad shout keeps the selected pet kneeling through all three frames', () => {
  const engine = fixture();
  engine.callDad(false);
  const target = engine.pets.find((pet) => pet.action === 'kneel_shout_1');
  assert.ok(target, 'the selected pet must start in a kneeling pose');
  assert.equal(engine.pets.filter((pet) => pet.action === 'kneel_shout_1').length, 1);
  assert.equal(engine.mode, 'shout');
  engine.update(1, {}); engine.update(0.41, {});
  assert.equal(target.action, 'kneel_shout_2');
  engine.update(1, {}); engine.update(0.41, {});
  assert.equal(target.action, 'kneel_shout_3');
});
