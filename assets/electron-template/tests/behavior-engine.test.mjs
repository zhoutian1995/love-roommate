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
  fixtureBehaviors.motion = {
    maxSpeed: 120,
    maxAcceleration: 220,
    arrivalTolerance: 1,
    trailSampleDistance: 3
  };
  config.selection.userCharacterId = null;
  config.selection.prankExcludedCharacterIds = [];
  config.selection.chaseVariant = 'cursor-centipede';
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

function shoutFixture(count, { width = 800, height = 900, selfId = `person-${count}`, excludedIds = [] } = {}) {
  const engine = fixture(count);
  engine.displays = engine.normalizeDisplays([{ id: 1, workArea: { x: 0, y: 0, width, height } }]);
  engine.config.selection.userCharacterId = selfId;
  engine.config.selection.prankExcludedCharacterIds = excludedIds;
  engine.behaviors.poopChase = {
    ...engine.behaviors.poopChase,
    leaderId: 'person-1',
    followerIds: engine.pets.slice(1).map((pet) => pet.id)
  };
  return engine;
}

function runUntilShoutPhase(engine, wantedPhase) {
  for (let frame = 0; frame < 1200 && engine.snapshot().shoutPhase !== wantedPhase; frame += 1) {
    engine.update(1 / 60, { x: 400, y: 450 });
  }
  assert.equal(engine.snapshot().shoutPhase, wantedPhase);
}

function windowRect(position, render) {
  const padding = (render.windowSize - render.spriteSize) / 2;
  return {
    left: position.x - padding,
    top: position.y - padding,
    right: position.x - padding + render.windowSize,
    bottom: position.y - padding + render.windowSize
  };
}

function bodyRect(position, render) {
  return {
    left: position.x,
    top: position.y,
    right: position.x + render.spriteSize,
    bottom: position.y + render.spriteSize
  };
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function poopFixture(count = 5) {
  const engine = fixture(count);
  engine.behaviors.poopChase = {
    enabled: true,
    leaderId: 'person-3',
    followerIds: ['person-1', 'person-2', 'person-4', 'person-5'],
    maxSpeed: 300,
    maxAcceleration: 220,
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
    relaySpeed: 90,
    cursorPoopMaxSpeed: 150,
    mouthHoldMs: 480,
    poopSize: 36,
    stinkSize: 28
  };
  return engine;
}

function crossDisplayFixture(count = 5) {
  const engine = poopFixture(count);
  engine.displays = engine.normalizeDisplays([
    { id: 'upper', workArea: { x: 522, y: -1080, width: 2560, height: 1032 } },
    { id: 'lower', workArea: { x: 0, y: 0, width: 2560, height: 1392 } }
  ]);
  const starts = [
    { x: 760, y: -720 },
    { x: 320, y: 760 },
    { x: 1180, y: 920 },
    { x: 2040, y: -610 },
    { x: 2140, y: 980 }
  ];
  engine.pets.forEach((pet, index) => Object.assign(pet, starts[index], { vx: 0, vy: 0 }));
  return engine;
}

function assertPetsInsideDisplay(engine, displayId) {
  const display = engine.displays.find((item) => item.id === displayId);
  const size = engine.config.render.spriteSize;
  assert.ok(display, `missing display ${displayId}`);
  for (const pet of engine.pets) {
    assert.ok(
      pet.x >= display.workArea.x && pet.y >= display.workArea.y &&
      pet.x + size <= display.workArea.x + display.workArea.width &&
      pet.y + size <= display.workArea.y + display.workArea.height,
      `${pet.id} did not finish inside ${displayId}: ${JSON.stringify({ x: pet.x, y: pet.y })}`
    );
  }
}

function assertPetWindowsInsideDisplay(engine, displayId) {
  const display = engine.displays.find((item) => item.id === displayId);
  assert.ok(display, `missing display ${displayId}`);
  const epsilon = 1e-6;
  const right = display.workArea.x + display.workArea.width;
  const bottom = display.workArea.y + display.workArea.height;
  for (const pet of engine.pets) {
    const rect = windowRect(pet, engine.config.render);
    assert.ok(
      rect.left >= display.workArea.x - epsilon && rect.top >= display.workArea.y - epsilon &&
      rect.right <= right + epsilon && rect.bottom <= bottom + epsilon,
      `${pet.id} full window did not finish inside ${displayId}: ${JSON.stringify(rect)}`
    );
  }
}

function positions(engine) {
  return Object.fromEntries(engine.pets.map((pet) => [pet.id, { x: pet.x, y: pet.y }]));
}

function maxPositionDelta(before, after) {
  return Math.max(...Object.keys(before).map((id) => Math.hypot(
    after[id].x - before[id].x,
    after[id].y - before[id].y
  )));
}

function assertBoundedCharacterFrame(engine, before, dt, label) {
  const after = positions(engine);
  const cap = engine.behaviors.motion.maxSpeed * dt + 0.05;
  assert.ok(maxPositionDelta(before, after) <= cap, `${label} exceeded ${cap.toFixed(2)}px per frame`);
  return after;
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

function runUntil(engine, predicate, cursor, maxFrames = 2400) {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const snapshot = engine.update(1 / 60, typeof cursor === 'function' ? cursor() : cursor);
    if (predicate(snapshot, engine)) return snapshot;
  }
  assert.fail('timed out waiting for the requested engine state');
}

function runUntilFormationComplete(engine, cursor) {
  return runUntil(engine, () => !engine.formationTransition, cursor);
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
  runUntilFormationComplete(engine, { x: 600, y: 400 });
  const leader = engine.pets[0];
  const before = { x: leader.x, y: leader.y };
  const rightHead = engine.anchorsFor(leader, 'right').head;
  const leftHead = engine.anchorsFor(leader, 'left').head;
  const size = engine.config.render.spriteSize;
  const cursor = {
    x: leader.x + (rightHead[0] + leftHead[0]) / 2 * size + 360,
    y: leader.y + (rightHead[1] + leftHead[1]) / 2 * size
  };

  for (let frame = 0; frame < 120; frame += 1) engine.update(1 / 60, cursor);

  const movedX = leader.x - before.x;
  const movedY = leader.y - before.y;
  assert.ok(Math.hypot(movedX, movedY) >= 40, 'leader must visibly follow the cursor');
  for (let index = 1; index < engine.pets.length; index += 1) {
    const rear = engine.anchorPoint(engine.pets[index - 1], 'rear');
    const mouth = engine.anchorPoint(engine.pets[index], 'mouth');
    const anchorOverlap = Math.hypot(rear.x - mouth.x, rear.y - mouth.y);
    assert.ok(anchorOverlap >= 3, `connection ${index} needs a small visual overlap instead of a loose display-row join`);
    assert.ok(anchorOverlap <= 8, `connection ${index} is not touching tightly enough`);
  }
});

test('centipede excludes the selected self and leaves that character as a stationary spectator', () => {
  const engine = fixture(5);
  engine.config.selection.userCharacterId = 'person-3';
  const self = engine.pets.find((pet) => pet.id === 'person-3');
  const selfBefore = { x: self.x, y: self.y };

  engine.toggleCentipede({ x: 900, y: 320 });
  const participants = engine.centipedeParticipants();
  assert.deepEqual(participants.map((pet) => pet.id), ['person-1', 'person-2', 'person-4', 'person-5']);
  assert.match(self.action, /^idle_/);

  for (let frame = 0; frame < 120; frame += 1) engine.update(1 / 60, { x: 1080, y: 300 });

  assert.deepEqual({ x: self.x, y: self.y }, selfBefore);
  assert.match(self.action, /^idle_/);
  assert.equal(self.effect, '');
  assert.ok(participants.every((pet) => pet.action === 'centipede_right'));
  assert.ok(participants.every((pet) => pet.phrase === ''));
});

test('exiting centipede shows grandpa only for eligible participants', async (t) => {
  const cases = [
    {
      name: 'selected self stays silent',
      count: 3,
      selfId: 'person-1',
      excludedIds: [],
      participantIds: ['person-2', 'person-3'],
      silentIds: ['person-1']
    },
    {
      name: 'photo without self lets every person participate',
      count: 3,
      selfId: null,
      excludedIds: [],
      participantIds: ['person-1', 'person-2', 'person-3'],
      silentIds: []
    },
    {
      name: 'legacy extra exclusions cannot spare anyone except the selected self',
      count: 4,
      selfId: 'person-2',
      excludedIds: ['person-4'],
      participantIds: ['person-1', 'person-3', 'person-4'],
      silentIds: ['person-2']
    },
    {
      name: 'legacy exclusions cannot suppress the other prank participants',
      count: 3,
      selfId: 'person-1',
      excludedIds: ['person-2', 'person-3'],
      participantIds: ['person-2', 'person-3'],
      silentIds: ['person-1']
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const engine = shoutFixture(scenario.count, {
        width: 1600,
        selfId: scenario.selfId,
        excludedIds: scenario.excludedIds
      });
      engine.toggleCentipede({ x: 600, y: 400 });
      engine.toggleCentipede({ x: 600, y: 400 });

      if (!scenario.participantIds.length) {
        assert.equal(engine.mode, 'free');
        assert.equal(engine.shoutSequence, null);
        assert.ok(engine.pets.every((pet) => pet.phrase === ''));
        return;
      }

      assert.equal(engine.mode, 'shout');
      assert.equal(engine.snapshot().shoutPhase, 'forming');
      assert.deepEqual(engine.shoutSequence.participants.map((pet) => pet.id), scenario.participantIds);
      assert.ok(engine.pets.every((pet) => pet.phrase === ''));
      runUntilShoutPhase(engine, 'shouting');

      for (const pet of engine.pets) {
        const expectedPhrase = scenario.participantIds.includes(pet.id) ? behaviors.phrases.grandpa : '';
        assert.equal(pet.phrase, expectedPhrase, `${pet.id} phrase mismatch`);
      }
      assert.ok(scenario.silentIds.every((id) => engine.pets.find((pet) => pet.id === id).phrase === ''));
    });
  }
});

test('eight-person shout fits seven kneeling windows into centered stable rows on an 800px display', () => {
  const engine = shoutFixture(8, { selfId: 'person-8' });
  const result = engine.callDad();
  assert.deepEqual(result.participantIds, ['person-1', 'person-2', 'person-3', 'person-4', 'person-5', 'person-6', 'person-7']);
  runUntilShoutPhase(engine, 'kneeling');

  const windowSize = engine.config.render.windowSize;
  const participants = result.participantIds.map((id) => engine.pets.find((pet) => pet.id === id));
  const participantRects = participants.map((pet) => windowRect(pet, engine.config.render));
  const participantBodies = participants.map((pet) => bodyRect(pet, engine.config.render));
  const recipient = engine.pets.find((pet) => pet.id === 'person-8');
  const recipientRect = windowRect(recipient, engine.config.render);
  const recipientBody = bodyRect(recipient, engine.config.render);

  for (const rect of [...participantRects, recipientRect]) {
    assert.ok(rect.left >= 0 && rect.top >= 0 && rect.right <= 800 && rect.bottom <= 900, `window outside work area: ${JSON.stringify(rect)}`);
  }
  for (let left = 0; left < participantRects.length; left += 1) {
    for (let right = left + 1; right < participantRects.length; right += 1) {
      assert.equal(overlaps(participantBodies[left], participantBodies[right]), false, `${result.participantIds[left]} visibly overlaps ${result.participantIds[right]}`);
    }
  }
  assert.ok(participantBodies.every((rect) => !overlaps(rect, recipientBody)), 'recipient body must not overlap the kneeling queue');

  const rows = Map.groupBy(participants, (pet) => pet.y);
  assert.ok(rows.size > 1, 'seven participants must wrap to multiple rows on an 800px display');
  const orderedRows = [...rows.entries()].sort(([a], [b]) => a - b).map(([, pets]) => pets);
  assert.deepEqual(orderedRows.flat().map((pet) => pet.id), result.participantIds, 'row-major order must preserve configured participant order');
  for (const row of orderedRows) {
    const centers = row.map((pet) => pet.x + engine.config.render.spriteSize / 2);
    assert.deepEqual(centers, [...centers].sort((a, b) => a - b), 'each row must preserve left-to-right order');
    assert.ok(Math.abs((centers[0] + centers.at(-1)) / 2 - 400) < 0.01, 'each row must be centered on the display');
  }
  assert.ok(Math.abs(recipient.x + engine.config.render.spriteSize / 2 - 400) < 0.01, 'recipient must share the overall queue center axis');
  assert.ok(recipientBody.bottom <= Math.min(...participantBodies.map((rect) => rect.top)), 'recipient body must stand in front of the entire queue');
});

test('one-person shout is a safe no-op when the only character is the recipient', () => {
  const engine = shoutFixture(1, { selfId: 'person-1' });
  const before = engine.snapshot();
  const result = engine.callGrandpa();
  assert.deepEqual(result, {
    started: false,
    recipientId: 'person-1',
    participantIds: [],
    excludedIds: ['person-1'],
    skippedReason: 'no-eligible-participants'
  });
  assert.equal(engine.mode, 'free');
  assert.equal(engine.shoutSequence, null);
  assert.deepEqual(engine.snapshot().pets, before.pets);
});

test('two-person shout keeps the selected self standing while the other character kneels', () => {
  const engine = shoutFixture(2, { selfId: 'person-1' });
  const result = engine.callDad();
  assert.deepEqual(result.participantIds, ['person-2']);
  runUntilShoutPhase(engine, 'kneeling');
  const recipient = engine.pets.find((pet) => pet.id === 'person-1');
  const participant = engine.pets.find((pet) => pet.id === 'person-2');
  assert.match(recipient.action, /^idle_/);
  assert.equal(recipient.shoutRecipient, true);
  assert.equal(recipient.phrase, '');
  assert.equal(participant.action, 'shout');
  assert.equal(participant.frame, 0);
});

test('starting a group shout clears stale poop and chase effects from the previous joke', () => {
  const engine = shoutFixture(3, { selfId: 'person-2' });
  engine.droppings = [{ id: 'stale-poop', x: 400, y: 300, eatenBy: [] }];
  engine.lastDropPoint = { x: 400, y: 300 };
  engine.poopRelay = { active: true };
  engine.pets[0].effect = 'flies';
  engine.pets[0].poopUntil = 99;
  engine.pets[2].eatUntil = 99;

  const result = engine.callGrandpa();

  assert.equal(result.started, true);
  assert.deepEqual(engine.droppings, []);
  assert.equal(engine.lastDropPoint, null);
  assert.equal(engine.poopRelay, null);
  assert.ok(engine.pets.every((pet) => pet.effect === ''));
  assert.ok(engine.pets.every((pet) => pet.poopUntil === 0));
  assert.ok(engine.pets.every((pet) => pet.eatUntil === 0));
});

test('every supported one-to-eight-person shout count uses the configured self and a safe dynamic formation', async (t) => {
  const cases = [
    { count: 1 },
    { count: 2 },
    { count: 3 },
    { count: 4 },
    { count: 5 },
    { count: 6 },
    { count: 7 },
    { count: 8 }
  ];

  for (const { count } of cases) {
    await t.test(`count: ${count}`, () => {
      const selfId = `person-${Math.ceil(count / 2)}`;
      const engine = shoutFixture(count, { width: 1600, height: 900, selfId });
      const before = engine.snapshot().pets;
      const result = count % 2 === 0 ? engine.callDad() : engine.callGrandpa();
      const expectedParticipants = engine.pets.map((pet) => pet.id).filter((id) => id !== selfId);

      assert.equal(result.recipientId, selfId);
      assert.deepEqual(result.participantIds, expectedParticipants);
      assert.deepEqual(result.excludedIds, [selfId]);

      if (count === 1) {
        assert.equal(result.started, false);
        assert.equal(result.skippedReason, 'no-eligible-participants');
        assert.deepEqual(engine.snapshot().pets, before);
        return;
      }

      assert.equal(result.started, true);
      assert.equal(result.skippedReason, null);
      runUntilShoutPhase(engine, 'kneeling');
      const recipient = engine.pets.find((pet) => pet.id === selfId);
      const recipientRect = windowRect(recipient, engine.config.render);
      const recipientBody = bodyRect(recipient, engine.config.render);
      const participantRects = expectedParticipants.map((id) => windowRect(
        engine.pets.find((pet) => pet.id === id),
        engine.config.render
      ));
      const participantBodies = expectedParticipants.map((id) => bodyRect(
        engine.pets.find((pet) => pet.id === id),
        engine.config.render
      ));

      assert.match(recipient.action, /^idle_/);
      assert.equal(recipient.phrase, '');
      for (const rect of [recipientRect, ...participantRects]) {
        assert.ok(rect.left >= 0 && rect.top >= 0 && rect.right <= 1600 && rect.bottom <= 900);
      }
      for (let left = 0; left < participantRects.length; left += 1) {
        assert.equal(overlaps(participantBodies[left], recipientBody), false);
        for (let right = left + 1; right < participantRects.length; right += 1) {
          assert.equal(overlaps(participantBodies[left], participantBodies[right]), false);
        }
      }
    });
  }
});

test('every supported self position remains the standing recipient for one-to-eight-person photos', async (t) => {
  for (let count = 1; count <= 8; count += 1) {
    for (let selfIndex = 1; selfIndex <= count; selfIndex += 1) {
      await t.test(`count: ${count}, self: ${selfIndex}`, () => {
        const selfId = `person-${selfIndex}`;
        const engine = shoutFixture(count, { width: 1600, height: 900, selfId });
        const result = engine.callDad();

        assert.equal(result.recipientId, selfId);
        assert.deepEqual(
          result.participantIds,
          engine.pets.map((pet) => pet.id).filter((id) => id !== selfId)
        );
        assert.deepEqual(result.excludedIds, [selfId]);

        if (count === 1) {
          assert.equal(result.started, false);
          assert.equal(result.skippedReason, 'no-eligible-participants');
          return;
        }

        assert.equal(result.started, true);
        runUntilShoutPhase(engine, 'kneeling');
        const recipient = engine.pets.find((pet) => pet.id === selfId);
        assert.match(recipient.action, /^idle_/);
        assert.equal(recipient.phrase, '');
        assert.ok(engine.shoutSequence.participants.every((pet) => pet.id !== selfId));
      });
    }
  }
});

test('a photo without the user has no standing recipient and all eligible characters kneel', () => {
  const engine = shoutFixture(3, { selfId: null });
  const result = engine.callGrandpa();

  assert.equal(result.started, true);
  assert.equal(result.recipientId, null);
  assert.deepEqual(result.participantIds, ['person-1', 'person-2', 'person-3']);
  assert.deepEqual(result.excludedIds, []);
  runUntilShoutPhase(engine, 'kneeling');
  assert.ok(engine.pets.every((pet) => pet.action === 'shout'));
  assert.ok(engine.pets.every((pet) => pet.frame === 0));
});

test('a one-person photo without the user still kneels and shouts', () => {
  const engine = shoutFixture(1, { selfId: null });
  const result = engine.callDad();

  assert.equal(result.started, true);
  assert.equal(result.skippedReason, null);
  assert.equal(result.recipientId, null);
  assert.deepEqual(result.participantIds, ['person-1']);
  assert.deepEqual(result.excludedIds, []);
  runUntilShoutPhase(engine, 'kneeling');
  assert.equal(engine.pets[0].action, 'shout');
  assert.equal(engine.pets[0].frame, 0);
});

test('a photo without the user makes every character kneel even when legacy exclusions are present', () => {
  const engine = shoutFixture(8, {
    width: 800,
    height: 900,
    selfId: null,
    excludedIds: ['person-1', 'person-4', 'person-8']
  });
  const result = engine.callDad();

  assert.equal(result.recipientId, null);
  assert.deepEqual(result.participantIds, engine.pets.map((pet) => pet.id));
  assert.deepEqual(result.excludedIds, []);
  runUntilShoutPhase(engine, 'kneeling');
  assert.deepEqual(engine.shoutSequence.participants.map((pet) => pet.id), result.participantIds);
  assert.ok(engine.pets.every((pet) => pet.action === 'shout'));
});

test('five-person shout includes everyone except self even when a legacy extra exclusion exists', () => {
  const engine = shoutFixture(5, { selfId: 'person-3', excludedIds: ['person-5'] });
  const result = engine.callGrandpa();
  assert.deepEqual(result.participantIds, ['person-1', 'person-2', 'person-4', 'person-5']);
  assert.deepEqual(result.excludedIds, ['person-3']);
  runUntilShoutPhase(engine, 'kneeling');
  assert.deepEqual(
    [...engine.shoutSequence.targets.keys()],
    ['person-1', 'person-2', 'person-4', 'person-5'],
    'formation target order must include every non-self character'
  );
});

test('legacy exclusions cannot turn a multi-person self prank into a no-op', () => {
  const engine = shoutFixture(5, {
    selfId: 'person-3',
    excludedIds: ['person-1', 'person-2', 'person-4', 'person-5']
  });
  const result = engine.callDad();
  assert.equal(result.started, true);
  assert.deepEqual(result.participantIds, ['person-1', 'person-2', 'person-4', 'person-5']);
  assert.deepEqual(result.excludedIds, ['person-3']);
  assert.equal(result.skippedReason, null);
  assert.equal(engine.mode, 'shout');
});

test('shout fails closed when an 800x500 work area cannot contain the full eight-person formation', () => {
  const engine = shoutFixture(8, { width: 800, height: 500, selfId: 'person-8' });
  const before = engine.snapshot().pets;
  const result = engine.callDad();
  assert.equal(result.started, false);
  assert.equal(result.skippedReason, 'insufficient-work-area');
  assert.deepEqual(result.participantIds, ['person-1', 'person-2', 'person-3', 'person-4', 'person-5', 'person-6', 'person-7']);
  assert.equal(engine.mode, 'free');
  assert.equal(engine.shoutSequence, null);
  assert.deepEqual(engine.snapshot().pets, before);
});

test('shout fails closed when the work area is narrower than one pet window', () => {
  const engine = shoutFixture(2, { width: 179, height: 900, selfId: 'person-1' });
  const result = engine.callGrandpa();
  assert.equal(result.started, false);
  assert.equal(result.skippedReason, 'insufficient-work-area');
  assert.deepEqual(result.participantIds, ['person-2']);
  assert.equal(engine.mode, 'free');
  assert.equal(engine.shoutSequence, null);
});

test('shouting participants keep facing the recipient from both sides of the queue', () => {
  const engine = shoutFixture(5, { width: 1200, height: 900, selfId: 'person-3' });
  engine.callDad();
  runUntilShoutPhase(engine, 'shouting');
  const recipient = engine.pets.find((pet) => pet.id === 'person-3');
  const recipientCenter = recipient.x + engine.config.render.spriteSize / 2;
  const leftSide = engine.shoutSequence.participants.filter((pet) => pet.x + engine.config.render.spriteSize / 2 < recipientCenter);
  const rightSide = engine.shoutSequence.participants.filter((pet) => pet.x + engine.config.render.spriteSize / 2 > recipientCenter);
  assert.ok(leftSide.length > 0 && rightSide.length > 0, 'fixture must place participants on both sides of recipient');
  assert.ok(leftSide.every((pet) => pet.direction === 'right'), 'left-side participants must face right toward recipient');
  assert.ok(rightSide.every((pet) => pet.direction === 'left'), 'right-side participants must face left toward recipient');
});

test('group shout uses compact visible-body spacing instead of transparent-window spacing', () => {
  const engine = shoutFixture(5, { width: 1200, height: 900, selfId: 'person-3' });
  const result = engine.callDad();
  runUntilShoutPhase(engine, 'kneeling');
  const participants = result.participantIds
    .map((id) => engine.pets.find((pet) => pet.id === id))
    .sort((left, right) => left.x - right.x);
  const centers = participants.map((pet) => pet.x + engine.config.render.spriteSize / 2);
  const gaps = centers.slice(1).map((center, index) => center - centers[index]);
  assert.ok(Math.max(...gaps) <= engine.config.render.spriteSize * 1.35, `visible-body gap is too wide: ${Math.max(...gaps)}`);
});

test('standing shout recipient clears the kneeling row speech bubbles without looking detached', () => {
  const engine = shoutFixture(5, { width: 1200, height: 900, selfId: 'person-3' });
  const result = engine.callDad();
  runUntilShoutPhase(engine, 'kneeling');
  const recipient = engine.pets.find((pet) => pet.id === result.recipientId);
  const participants = result.participantIds.map((id) => engine.pets.find((pet) => pet.id === id));
  const firstRowTop = Math.min(...participants.map((pet) => pet.y));
  const visibleGap = firstRowTop - (recipient.y + engine.config.render.spriteSize);

  assert.ok(visibleGap >= engine.config.render.spriteSize * 0.44, `recipient overlaps the compact row speech bubbles: ${visibleGap}`);
  assert.ok(visibleGap <= engine.config.render.spriteSize * 0.52, `recipient is visually detached from the kneeling row: ${visibleGap}`);
});

test('pause freezes free-roam positions', () => {
  const engine = fixture(1);
  const before = { x: engine.pets[0].x, y: engine.pets[0].y };
  engine.togglePause();
  engine.update(1, { x: 0, y: 0 });
  assert.deepEqual({ x: engine.pets[0].x, y: engine.pets[0].y }, before);
});

test('entering every chase mode preserves visible positions and moves through bounded frames', async (t) => {
  const cases = [
    {
      name: 'cursor centipede',
      setup(engine) {
        engine.config.selection.userCharacterId = null;
        engine.toggleCentipede({ x: 1050, y: 180 });
      }
    },
    {
      name: 'self-present poop chase',
      setup(engine) {
        engine.config.selection.userCharacterId = 'person-3';
        engine.togglePoopChase({ x: 1050, y: 180 });
      }
    },
    {
      name: 'cursor-poop chase',
      setup(engine) {
        engine.config.selection.userCharacterId = null;
        engine.togglePoopChase({ x: 1050, y: 180 });
      }
    }
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const engine = poopFixture();
      const beforeToggle = positions(engine);
      entry.setup(engine);
      assert.deepEqual(positions(engine), beforeToggle, 'a visible mode switch must not rearrange characters synchronously');

      let previous = beforeToggle;
      let moved = 0;
      for (let frame = 0; frame < 240; frame += 1) {
        engine.update(1 / 60, { x: 1050, y: 180 });
        const current = positions(engine);
        moved = Math.max(moved, maxPositionDelta(beforeToggle, current));
        previous = assertBoundedCharacterFrame(engine, previous, 1 / 60, `${entry.name} frame ${frame}`);
      }
      assert.ok(moved >= 20, `${entry.name} never made a readable gradual transition`);
    });
  }
});

test('cross-display poop chase crosses a work-area gap without stalling or teleporting', () => {
  const engine = crossDisplayFixture();
  engine.config.selection.userCharacterId = 'person-3';
  const cursor = { x: 1700, y: -520 };
  let previous = positions(engine);

  engine.togglePoopChase(cursor);
  assert.deepEqual(positions(engine), previous, 'entering cross-display poop chase must not rearrange characters synchronously');

  for (let frame = 0; frame < 3600 && engine.formationTransition; frame += 1) {
    engine.update(1 / 60, cursor);
    previous = assertBoundedCharacterFrame(engine, previous, 1 / 60, `cross-display poop frame ${frame}`);
  }

  assert.equal(engine.formationTransition, null, 'cross-display poop chase stalled at the work-area gap');
  assertPetsInsideDisplay(engine, 'upper');
});

test('eight-person cross-display poop chase settles every full window inside the lower target work area', () => {
  const engine = crossDisplayFixture(8);
  engine.config.selection.userCharacterId = 'person-6';
  engine.behaviors.poopChase.leaderId = 'person-6';
  engine.behaviors.poopChase.followerIds = engine.pets
    .filter((pet) => pet.id !== 'person-6')
    .map((pet) => pet.id);
  engine.pets.forEach((pet, index) => Object.assign(pet, {
    x: 760 + index * 180,
    y: -760 + index % 2 * 60,
    vx: 0,
    vy: 0
  }));
  const cursor = { x: 1450, y: 1388 };
  let previous = positions(engine);

  engine.togglePoopChase(cursor);
  assert.deepEqual(positions(engine), previous, 'entering lower-display chase must not rearrange visible windows synchronously');

  for (let frame = 0; frame < 6000; frame += 1) {
    engine.update(1 / 60, cursor);
    previous = assertBoundedCharacterFrame(engine, previous, 1 / 60, `lower-display chase frame ${frame}`);
  }

  assert.equal(engine.formationTransition, null, 'lower-display chase did not finish its bounded formation transition');
  assertPetWindowsInsideDisplay(engine, 'lower');
});

test('cross-display group shout crosses a work-area gap without stalling or teleporting', () => {
  const engine = crossDisplayFixture();
  engine.config.selection.userCharacterId = 'person-1';
  let previous = positions(engine);

  const result = engine.callDad();
  assert.equal(result.started, true);
  assert.deepEqual(positions(engine), previous, 'entering a cross-display shout must not rearrange characters synchronously');

  for (let frame = 0; frame < 3600 && engine.snapshot().shoutPhase === 'forming'; frame += 1) {
    engine.update(1 / 60, { x: 1700, y: -520 });
    previous = assertBoundedCharacterFrame(engine, previous, 1 / 60, `cross-display shout frame ${frame}`);
  }

  assert.equal(engine.snapshot().shoutPhase, 'kneeling', 'cross-display shout stalled at the work-area gap');
  assertPetsInsideDisplay(engine, 'upper');
});

test('leaving or replacing a special mode while crossing displays never snaps to a work-area edge', async (t) => {
  for (const nextMode of ['free', 'shout']) {
    await t.test(nextMode, () => {
      const engine = crossDisplayFixture();
      engine.config.selection.userCharacterId = 'person-3';
      const cursor = { x: 1700, y: -520 };
      engine.togglePoopChase(cursor);
      engine.pets[0].x = 900;
      engine.pets[0].y = -80;
      engine.pets[0].vx = 0;
      engine.pets[0].vy = -30;
      const beforeSwitch = positions(engine);

      if (nextMode === 'free') engine.togglePoopChase(cursor);
      else engine.callGrandpa();
      assert.deepEqual(positions(engine), beforeSwitch, `${nextMode} switch rearranged a visible character synchronously`);

      engine.update(1 / 60, cursor);
      assertBoundedCharacterFrame(engine, beforeSwitch, 1 / 60, `${nextMode} first frame after cross-display switch`);
    });
  }
});

test('group shout uses the shared acceleration cap while gathering', () => {
  const engine = shoutFixture(5, { width: 1200, height: 900, selfId: 'person-3' });
  engine.behaviors.groupShout.gatherSpeed = 180;
  const beforeToggle = positions(engine);
  const previousVelocity = new Map(engine.pets.map((pet) => [pet.id, { vx: pet.vx, vy: pet.vy }]));

  engine.callDad();
  assert.deepEqual(positions(engine), beforeToggle);
  engine.update(1 / 60, { x: 600, y: 450 });
  assertBoundedCharacterFrame(engine, beforeToggle, 1 / 60, 'group shout first gather frame');

  const accelerationCap = engine.behaviors.motion.maxAcceleration / 60 + 0.05;
  for (const pet of engine.pets) {
    const before = previousVelocity.get(pet.id);
    const velocityDelta = Math.hypot(pet.vx - before.vx, pet.vy - before.vy);
    assert.ok(velocityDelta <= accelerationCap, `${pet.id} accelerated by ${velocityDelta.toFixed(2)}px/s in one frame`);
  }
});

test('cursor-controlled poop follows a large mouse jump without teleporting', () => {
  const engine = poopFixture();
  engine.config.selection.userCharacterId = null;
  const start = { x: 420, y: 360 };
  const far = { x: 1120, y: 120 };
  engine.togglePoopChase(start);
  engine.update(1 / 60, start);
  const before = { x: engine.droppings[0].x, y: engine.droppings[0].y };

  engine.update(1 / 60, far);
  const after = engine.droppings[0];
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  assert.ok(moved > 0.01, 'cursor poop should begin accelerating toward the mouse');
  assert.ok(moved <= engine.behaviors.poopChase.cursorPoopMaxSpeed / 60 + 0.05, `cursor poop teleported ${moved.toFixed(2)}px`);
  assert.ok(Math.hypot(far.x - after.x, far.y - after.y) > 100, 'cursor poop should retain a readable smoothing delay after a large jump');
});

test('one poop advances continuously through every eater in photo order', () => {
  const engine = poopFixture();
  engine.config.selection.userCharacterId = 'person-3';
  const cursor = leaderCursor(engine, 260, -120);
  const expected = ['person-1', 'person-2', 'person-4', 'person-5'];
  const contacts = [];
  let roundId = null;
  let previousDropping = null;
  let previousPositions = positions(engine);

  engine.togglePoopChase(cursor);
  for (let frame = 0; frame < 3600 && contacts.length < expected.length; frame += 1) {
    const snapshot = engine.update(1 / 60, cursor);
    previousPositions = assertBoundedCharacterFrame(engine, previousPositions, 1 / 60, `poop relay frame ${frame}`);
    const dropping = snapshot.droppings[0];
    if (!dropping) {
      previousDropping = null;
      continue;
    }
    if (!roundId) roundId = dropping.id;
    assert.equal(dropping.id, roundId, 'the relay recreated the poop before every eater received the same round');
    if (previousDropping?.id === dropping.id) {
      const moved = Math.hypot(dropping.x - previousDropping.x, dropping.y - previousDropping.y);
      assert.ok(moved <= engine.behaviors.poopChase.relaySpeed / 60 + 0.05, `poop jumped ${moved.toFixed(2)}px in one frame`);
    }
    for (const id of dropping.eatenBy) {
      if (!contacts.includes(id)) contacts.push(id);
    }
    previousDropping = { id: dropping.id, x: dropping.x, y: dropping.y };
  }

  assert.deepEqual(contacts, expected);
});

test('repairs non-finite state before returning snapshots', () => {
  const engine = fixture(2);
  Object.assign(engine.pets[0], { x: Number.NaN, y: Number.POSITIVE_INFINITY, vx: Number.NaN, frame: Number.NaN });
  assertFiniteState(engine.update(Number.NaN, { x: Number.NaN, y: Number.POSITIVE_INFINITY }));
});

test('poop chase makes the selected self lead and every other character follow', () => {
  const engine = poopFixture();
  engine.config.selection.userCharacterId = 'person-3';
  engine.behaviors.poopChase.leaderId = 'person-1';
  engine.behaviors.poopChase.followerIds = ['person-2'];
  const cursor = { x: 900, y: 320 };
  engine.togglePoopChase(cursor);
  runUntilFormationComplete(engine, cursor);
  assert.equal(engine.mode, 'poopChase');
  const leader = engine.pets.find((pet) => pet.id === 'person-3');
  assert.equal(leader.action, 'poop_right');
  assert.equal(engine.droppings.length, 1);
  assert.equal(engine.droppings[0].sourceId, 'person-3');
  assert.equal(engine.droppings[0].targetId, 'person-1');
  assert.equal(engine.pets.find((pet) => pet.id === 'person-1').action, 'eat_right');
  for (const id of ['person-2', 'person-4', 'person-5']) {
    assert.equal(engine.pets.find((pet) => pet.id === id).action, 'crawl_right');
  }
});

test('poop chase keeps the selected self as the only source while every other character eats in rotation', () => {
  const engine = poopFixture();
  engine.config.selection.userCharacterId = 'person-3';
  engine.togglePoopChase(leaderCursor(engine));
  runUntilFormationComplete(engine, () => leaderCursor(engine));
  const droppingId = engine.droppings[0].id;
  const expectedTargets = ['person-1', 'person-2', 'person-4', 'person-5'];
  for (let index = 0; index < expectedTargets.length; index += 1) {
    const expected = expectedTargets.slice(0, index + 1);
    runUntil(engine, (snapshot) => snapshot.droppings[0]?.eatenBy.length >= expected.length, () => leaderCursor(engine));
    assert.equal(engine.droppings[0].id, droppingId);
    assert.equal(engine.droppings[0].sourceId, 'person-3');
    assert.deepEqual(engine.droppings[0].eatenBy, expected);
  }

  assert.ok(engine.pets.filter((pet) => pet.id !== 'person-3').every((pet) => !pet.action.startsWith('poop_')));
});

test('poop chase without a selected self makes every character a centipede chasing cursor-controlled poop', () => {
  const engine = poopFixture();
  engine.config.selection.userCharacterId = null;
  const cursor = { x: 900, y: 320 };
  engine.togglePoopChase(cursor);
  runUntilFormationComplete(engine, cursor);
  engine.update(1 / 60, cursor);

  const { participants } = engine.poopChaseParticipants();
  assert.deepEqual(participants.map((pet) => pet.id), ['person-3', 'person-1', 'person-2', 'person-4', 'person-5']);
  assert.ok(participants.every((pet) => pet.action === 'centipede_right'));
  assert.equal(participants[0].phrase, '别跑！');
  assert.ok(participants.slice(1).every((pet) => pet.phrase === ''));
  assert.equal(engine.droppings.length, 1);
  assert.equal(engine.droppings[0].sourceId, null);
  assert.equal(engine.droppings[0].targetId, null);
  assert.equal(engine.droppings[0].cursorControlled, true);
  assert.deepEqual({ x: engine.droppings[0].x, y: engine.droppings[0].y }, cursor);
});

test('one-person photo without a selected self still chases the cursor-controlled poop', () => {
  const engine = fixture(1);
  engine.config.selection.userCharacterId = null;
  engine.behaviors.poopChase = {
    ...engine.behaviors.poopChase,
    enabled: true,
    leaderId: 'person-1',
    followerIds: []
  };
  const cursor = { x: 640, y: 360 };

  engine.togglePoopChase(cursor);
  runUntilFormationComplete(engine, cursor);
  engine.update(1 / 60, cursor);

  assert.equal(engine.mode, 'poopChase');
  assert.equal(engine.pets[0].action, 'centipede_right');
  assert.equal(engine.droppings.length, 1);
  assert.equal(engine.droppings[0].cursorControlled, true);
});

test('poop chase forms one connected queue and starts the dropping at the selected self', () => {
  const engine = poopFixture();
  engine.config.selection.userCharacterId = 'person-3';
  const cursor = leaderCursor(engine);
  engine.togglePoopChase(cursor);
  runUntilFormationComplete(engine, () => leaderCursor(engine));
  const { participants } = engine.poopChaseParticipants();
  for (let index = 1; index < participants.length; index += 1) {
    const rear = engine.anchorPoint(participants[index - 1], 'rear');
    const mouth = engine.anchorPoint(participants[index], 'mouth');
    assert.ok(Math.hypot(rear.x - mouth.x, rear.y - mouth.y) <= 8, `queue connection ${index} is detached`);
  }
  const sourceRear = engine.anchorPoint(participants[0], 'rear');
  const dropping = engine.droppings[0];
  assert.ok(Math.hypot(dropping.x - sourceRear.x, dropping.y - sourceRear.y) <= 0.01);
});

test('eating climax moves the dropping to visible mouth contact without covering the face', () => {
  const engine = poopFixture();
  engine.config.selection.userCharacterId = 'person-3';
  const cursor = leaderCursor(engine);
  engine.togglePoopChase(cursor);
  runUntilFormationComplete(engine, () => leaderCursor(engine));
  runUntil(engine, (snapshot) => snapshot.droppings[0]?.eatenBy.length >= 1, () => leaderCursor(engine));

  const dropping = engine.droppings[0];
  const target = engine.pets.find((pet) => pet.id === dropping.targetId);
  const mouth = engine.anchorPoint(target, 'mouth');
  const mouthDistance = Math.hypot(dropping.x - mouth.x, dropping.y - mouth.y);
  const radius = engine.behaviors.poopChase.poopSize / 2;

  assert.deepEqual(dropping.eatenBy, [target.id]);
  assert.ok(mouthDistance >= radius * 0.45, `dropping center covers the eater face: ${mouthDistance}`);
  assert.ok(mouthDistance <= radius * 0.8, `dropping never reaches the eater mouth: ${mouthDistance}`);
});

test('each follower eats poop from the selected self before the selected self serves the next person', () => {
  const engine = poopFixture();
  engine.config.selection.userCharacterId = 'person-3';
  const expectedTargets = ['person-1', 'person-2', 'person-4', 'person-5'];
  engine.togglePoopChase(leaderCursor(engine));
  runUntilFormationComplete(engine, () => leaderCursor(engine));
  const currentId = engine.droppings[0].id;
  for (let index = 0; index < expectedTargets.length; index += 1) {
    assert.equal(engine.droppings.length, 1);
    assert.equal(engine.droppings[0].sourceId, 'person-3');
    assert.equal(engine.droppings[0].targetId, expectedTargets[index]);
    runUntil(engine, (snapshot) => snapshot.droppings[0]?.eatenBy.length >= index + 1, () => leaderCursor(engine));
    assert.deepEqual(engine.droppings[0].eatenBy, expectedTargets.slice(0, index + 1));
    assert.equal(engine.droppings[0].id, currentId);
    if (index < expectedTargets.length - 1) {
      runUntil(engine, () => engine.poopRelay.targetIndex === index + 2 && engine.droppings[0]?.targetId === expectedTargets[index + 1], () => leaderCursor(engine));
      assert.equal(engine.pets.find((pet) => pet.id === 'person-3').action, 'poop_right');
    }
  }
  assert.equal(engine.droppings[0].sourceId, 'person-3');
});

test('selected self follows the cursor while the eating queue rotates behind it with one dropping', () => {
  const engine = poopFixture();
  engine.config.selection.userCharacterId = 'person-3';
  engine.togglePoopChase({ x: 900, y: 320 });
  runUntilFormationComplete(engine, { x: 900, y: 320 });
  const leader = engine.pets.find((pet) => pet.id === 'person-3');
  const leaderBefore = { x: leader.x, y: leader.y };
  for (let frame = 0; frame < 240; frame += 1) {
    engine.update(1 / 60, { x: 1080, y: 300 });
    assert.equal(engine.droppings.length, 1);
    assert.equal(engine.droppings[0].sourceId, 'person-3');
  }
  const movedX = leader.x - leaderBefore.x;
  const movedY = leader.y - leaderBefore.y;
  assert.ok(Math.hypot(movedX, movedY) >= 40, 'relay leader must visibly follow the cursor');
  for (const pet of engine.pets) {
    assert.ok(pet.x >= -300 && pet.x <= 1188, `${pet.id} escaped the work area horizontally`);
    assert.ok(pet.y >= 0 && pet.y <= 788, `${pet.id} escaped the work area vertically`);
  }
});

test('self keeps pooping while the next eater eats and the remaining followers crawl after them', () => {
  const engine = poopFixture();
  engine.config.selection.userCharacterId = 'person-3';
  const relayRoles = () => Object.fromEntries(engine.pets.map((pet) => [
    pet.id,
    pet.action.replace(/_(?:left|right)$/, '')
  ]));
  engine.togglePoopChase({ x: 500, y: 300 });
  runUntilFormationComplete(engine, { x: 500, y: 300 });
  assert.deepEqual(
    relayRoles(),
    {
      'person-1': 'eat',
      'person-2': 'crawl',
      'person-3': 'poop',
      'person-4': 'crawl',
      'person-5': 'crawl'
    }
  );

  runUntil(engine, (snapshot) => snapshot.droppings[0]?.eatenBy.includes('person-1'), { x: 500, y: 300 });
  assert.equal(engine.pets.find((pet) => pet.id === 'person-1').effect, 'stink');
  assert.equal(engine.pets.find((pet) => pet.id === 'person-1').phrase, '啊呜！');
  assert.deepEqual(
    relayRoles(),
    {
      'person-1': 'eat',
      'person-2': 'crawl',
      'person-3': 'poop',
      'person-4': 'crawl',
      'person-5': 'crawl'
    }
  );

  runUntil(engine, () => engine.poopRelay.targetIndex === 2, { x: 500, y: 300 });
  engine.update(1 / 60, { x: 500, y: 300 });
  assert.deepEqual(
    relayRoles(),
    {
      'person-1': 'crawl',
      'person-2': 'eat',
      'person-3': 'poop',
      'person-4': 'crawl',
      'person-5': 'crawl'
    }
  );
});

test('poop chase pause and exit preserve recovery controls', () => {
  const engine = poopFixture();
  engine.config.selection.userCharacterId = 'person-3';
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
