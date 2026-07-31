'use strict';

const DEFAULT_DISPLAY = { id: 'fallback', workArea: { x: 0, y: 0, width: 1280, height: 720 } };
const finite = (value) => Number.isFinite(value);
const clamp = (value, min, max) => {
  const safeMin = finite(min) ? min : 0;
  const safeMax = finite(max) ? max : safeMin;
  const safeValue = finite(value) ? value : safeMin;
  if (safeMax < safeMin) return safeMin;
  return Math.min(safeMax, Math.max(safeMin, safeValue));
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function sampleTrail(trail, wantedDistance) {
  if (!trail.length) return { x: 0, y: 0, direction: 'right' };
  if (wantedDistance <= 0) return { ...trail[0] };
  let traversed = 0;
  for (let index = 0; index < trail.length - 1; index += 1) {
    const newer = trail[index];
    const older = trail[index + 1];
    const segment = distance(newer, older);
    if (traversed + segment >= wantedDistance && segment > 0) {
      const ratio = (wantedDistance - traversed) / segment;
      return {
        x: newer.x + (older.x - newer.x) * ratio,
        y: newer.y + (older.y - newer.y) * ratio,
        direction: newer.x >= older.x ? 'right' : 'left'
      };
    }
    traversed += segment;
  }
  return { ...trail[trail.length - 1] };
}

class BehaviorEngine {
  constructor({ config, behaviors, manifest, displays, random = Math.random }) {
    this.config = config;
    this.behaviors = behaviors;
    this.manifest = manifest;
    this.displays = this.normalizeDisplays(displays);
    this.random = random;
    this.elapsed = 0;
    this.mode = 'free';
    this.paused = false;
    this.modeUntil = 0;
    this.trail = [];
    this.droppings = [];
    this.nextDroppingId = 1;
    this.lastDropAt = Number.NEGATIVE_INFINITY;
    this.lastDropPoint = null;
    this.poopRelay = null;
    this.nextTurnAt = 0;
    this.nextDadAt = this.randomDadDelay();
    this.pets = config.characters.map((character, index) => this.createPet(character, index));
  }

  randomBetween(min, max) {
    const safeMin = finite(min) ? min : 0;
    const safeMax = finite(max) ? max : safeMin;
    return safeMin + (safeMax - safeMin) * this.random();
  }

  randomDadDelay() {
    const settings = this.behaviors.randomDad;
    return this.randomBetween(settings.minDelayMs, settings.maxDelayMs) / 1000;
  }

  getDisplayForPoint(point) {
    const first = this.displays[0] || DEFAULT_DISPLAY;
    const safePoint = this.safePoint(point, {
      x: first.workArea.x + first.workArea.width / 2,
      y: first.workArea.y + first.workArea.height / 2
    });
    const containing = this.displays.find(({ workArea }) =>
      safePoint.x >= workArea.x && safePoint.x <= workArea.x + workArea.width &&
      safePoint.y >= workArea.y && safePoint.y <= workArea.y + workArea.height
    );
    if (containing) return containing;
    return this.displays.reduce((best, display) => {
      const center = {
        x: display.workArea.x + display.workArea.width / 2,
        y: display.workArea.y + display.workArea.height / 2
      };
      const score = distance(center, safePoint);
      return !best || score < best.score ? { display, score } : best;
    }, null).display;
  }

  normalizeDisplays(displays) {
    const normalized = (Array.isArray(displays) ? displays : []).map((display, index) => {
      const workArea = display?.workArea || {};
      return {
        id: display?.id ?? index,
        workArea: {
          x: finite(workArea.x) ? workArea.x : 0,
          y: finite(workArea.y) ? workArea.y : 0,
          width: finite(workArea.width) && workArea.width > 0 ? workArea.width : DEFAULT_DISPLAY.workArea.width,
          height: finite(workArea.height) && workArea.height > 0 ? workArea.height : DEFAULT_DISPLAY.workArea.height
        }
      };
    });
    return normalized.length ? normalized : [structuredClone(DEFAULT_DISPLAY)];
  }

  safePoint(point, fallback) {
    return {
      x: finite(point?.x) ? point.x : fallback.x,
      y: finite(point?.y) ? point.y : fallback.y
    };
  }

  createPet(character, index) {
    const display = this.displays[index % this.displays.length];
    const size = this.config.render.spriteSize;
    const speed = this.randomBetween(this.behaviors.freeRoam.speedMin, this.behaviors.freeRoam.speedMax);
    const direction = this.random() > 0.5 ? 1 : -1;
    return {
      id: character.id,
      displayName: character.displayName,
      hueRotate: character.hueRotate || 0,
      x: display.workArea.x + this.random() * Math.max(1, display.workArea.width - size),
      y: display.workArea.y + display.workArea.height - size - 8 - this.random() * Math.min(120, display.workArea.height / 5),
      vx: direction * speed,
      vy: this.randomBetween(-10, 10),
      direction: direction > 0 ? 'right' : 'left',
      action: direction > 0 ? 'crawl_right' : 'crawl_left',
      frame: 0,
      phrase: '',
      phraseUntil: 0,
      effect: '',
      effectSize: this.config.render.effectSize,
      poopUntil: 0,
      eatUntil: 0,
      dragging: false
    };
  }

  setDisplays(displays) {
    this.displays = this.normalizeDisplays(displays);
  }

  anchorsFor(pet, direction = pet.direction) {
    const character = this.manifest.characters.find((item) => item.id === pet.id) || this.manifest.characters[0];
    return character.anchors[direction] || character.anchors.right;
  }

  clampPet(pet) {
    const size = this.config.render.spriteSize;
    const display = this.getDisplayForPoint({ x: pet.x + size / 2, y: pet.y + size / 2 });
    pet.x = clamp(pet.x, display.workArea.x, display.workArea.x + display.workArea.width - size);
    pet.y = clamp(pet.y, display.workArea.y, display.workArea.y + display.workArea.height - size);
  }

  sanitizePet(pet, index = 0) {
    const size = this.config.render.spriteSize;
    const display = this.displays[index % this.displays.length] || DEFAULT_DISPLAY;
    if (!finite(pet.x)) pet.x = display.workArea.x + Math.max(0, (display.workArea.width - size) / 2);
    if (!finite(pet.y)) pet.y = display.workArea.y + Math.max(0, display.workArea.height - size - 8);
    if (!finite(pet.vx)) pet.vx = 0;
    if (!finite(pet.vy)) pet.vy = 0;
    if (!finite(pet.frame)) pet.frame = 0;
    if (!finite(pet.phraseUntil)) pet.phraseUntil = 0;
    if (!finite(pet.poopUntil)) pet.poopUntil = 0;
    if (!finite(pet.eatUntil)) pet.eatUntil = 0;
    if (!finite(pet.effectSize)) pet.effectSize = this.config.render.effectSize;
    if (pet.direction !== 'left' && pet.direction !== 'right') pet.direction = pet.vx < 0 ? 'left' : 'right';
    if (typeof pet.action !== 'string' || !pet.action) pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left';
    this.clampPet(pet);
  }

  sanitizeState() {
    this.pets.forEach((pet, index) => this.sanitizePet(pet, index));
    this.trail = this.trail.filter((point) => finite(point?.x) && finite(point?.y));
    this.droppings = this.droppings.filter((dropping) => finite(dropping?.x) && finite(dropping?.y));
    this.droppings.forEach((dropping) => {
      if (!Array.isArray(dropping.eatenBy)) dropping.eatenBy = [];
    });
  }

  clearFormation() {
    this.trail = [];
    this.droppings = [];
    this.lastDropPoint = null;
    this.poopRelay = null;
    this.pets.forEach((pet) => {
      pet.effect = '';
      pet.effectSize = this.config.render.effectSize;
      pet.poopUntil = 0;
      pet.eatUntil = 0;
      pet.dragging = false;
    });
  }

  initializeTrail(leader, participantCount) {
    const size = this.config.render.spriteSize;
    const anchors = this.anchorsFor(leader);
    const rear = { x: leader.x + anchors.rear[0] * size, y: leader.y + anchors.rear[1] * size };
    const direction = leader.direction === 'right' ? -1 : 1;
    const requiredLength = Math.max(300, participantCount * size * 1.2);
    this.trail = [];
    for (let offset = 0; offset <= requiredLength; offset += 3) {
      this.trail.push({ x: rear.x + direction * offset, y: rear.y, direction: leader.direction });
    }
    return rear;
  }

  respawn() {
    this.mode = 'free';
    this.clearFormation();
    this.pets.forEach((pet, index) => {
      const fresh = this.createPet(this.config.characters[index], index);
      Object.assign(pet, fresh);
    });
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  setDragging(id, dragging, position) {
    const pet = this.pets.find((item) => item.id === id);
    if (!pet || this.mode === 'centipede' || this.mode === 'poopChase') return;
    pet.dragging = dragging;
    if (position) {
      pet.x = position.x;
      pet.y = position.y;
      this.clampPet(pet);
    }
    pet.action = dragging ? 'drag' : (pet.direction === 'right' ? 'idle_right' : 'idle_left');
  }

  interruptFormation() {
    if (this.mode === 'centipede' || this.mode === 'poopChase') {
      this.mode = 'free';
      this.clearFormation();
    }
  }

  callDad(group = true) {
    this.interruptFormation();
    const duration = this.behaviors.randomDad.durationMs / 1000;
    const targets = group ? this.pets : [this.pets[Math.floor(this.random() * this.pets.length)]];
    targets.forEach((pet) => {
      pet.phrase = this.behaviors.phrases.dad;
      pet.phraseUntil = this.elapsed + duration;
      pet.action = 'shout';
    });
    if (group) {
      this.mode = 'shout';
      this.modeUntil = this.elapsed + duration;
    }
  }

  callGrandpa() {
    this.interruptFormation();
    const duration = this.behaviors.randomDad.durationMs / 1000;
    this.pets.forEach((pet) => {
      pet.phrase = this.behaviors.phrases.grandpa;
      pet.phraseUntil = this.elapsed + duration;
      pet.action = 'shout';
    });
    this.mode = 'shout';
    this.modeUntil = this.elapsed + duration;
  }

  toggleCentipede(cursor = null) {
    if (!this.behaviors.centipede.enabled) return this.mode;
    if (this.mode === 'centipede') {
      this.mode = 'free';
      this.clearFormation();
      if (this.behaviors.centipede.exitShout) this.callGrandpa();
      return this.mode;
    }

    this.clearFormation();
    this.mode = 'centipede';
    const leader = this.pets[0];
    const size = this.config.render.spriteSize;
    const target = cursor || { x: leader.x + size, y: leader.y + size / 2 };
    leader.direction = target.x >= leader.x + size / 2 ? 'right' : 'left';
    this.initializeTrail(leader, this.pets.length);
    return this.mode;
  }

  poopChaseParticipants() {
    const settings = this.behaviors.poopChase || {};
    const leader = this.pets.find((pet) => pet.id === settings.leaderId);
    const seen = new Set();
    const followers = (settings.followerIds || [])
      .filter((id) => id !== settings.leaderId && !seen.has(id) && seen.add(id))
      .map((id) => this.pets.find((pet) => pet.id === id))
      .filter(Boolean);
    return { settings, leader, followers, participants: leader ? [leader, ...followers] : followers };
  }

  togglePoopChase(cursor = null) {
    const { settings, leader, followers } = this.poopChaseParticipants();
    if (!settings.enabled || !leader || !followers.length) return this.mode;
    if (this.mode === 'poopChase') {
      this.mode = 'free';
      this.clearFormation();
      this.pets.forEach((pet) => { pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left'; });
      return this.mode;
    }

    this.clearFormation();
    this.mode = 'poopChase';
    const size = this.config.render.spriteSize;
    const target = this.safePoint(cursor, { x: leader.x + size / 2, y: leader.y + size / 2 });
    const display = this.getDisplayForPoint(target);
    leader.x = display.workArea.x + display.workArea.width / 2;
    leader.y = display.workArea.y + display.workArea.height - size - Math.max(28, size * 0.25);
    leader.direction = 'right';
    this.arrangePoopChaseRow([leader, ...followers], settings, display);
    this.initializeTrail(leader, followers.length + 1);
    this.poopRelay = { sourceIndex: 0, phase: 'waitingDrop', phaseUntil: this.elapsed };
    this.createRelayDropping(settings, [leader, ...followers]);
    return this.mode;
  }

  arrangePoopChaseRow(participants, settings, display = null) {
    if (!participants.length) return;
    const size = this.config.render.spriteSize;
    const leader = participants[0];
    const direction = leader.direction === 'left' ? 'left' : 'right';
    leader.direction = direction;
    leader.vx = 0;
    leader.vy = 0;

    for (let index = 1; index < participants.length; index += 1) {
      const source = participants[index - 1];
      const pet = participants[index];
      const rear = this.anchorPoint(source, 'rear');
      const anchors = this.anchorsFor(pet, direction);
      const gapOffset = direction === 'right' ? -settings.gap : settings.gap;
      pet.x = rear.x + gapOffset - anchors.head[0] * size;
      pet.y = leader.y;
      pet.direction = direction;
      pet.vx = 0;
      pet.vy = 0;
      pet.dragging = false;
    }

    const activeDisplay = display || this.getDisplayForPoint({ x: leader.x + size / 2, y: leader.y + size / 2 });
    const minX = Math.min(...participants.map((pet) => pet.x));
    const maxX = Math.max(...participants.map((pet) => pet.x + size));
    const minY = Math.min(...participants.map((pet) => pet.y));
    const maxY = Math.max(...participants.map((pet) => pet.y + size));
    const rowWidth = maxX - minX;
    const rowHeight = maxY - minY;
    const targetLeft = activeDisplay.workArea.x + Math.max(0, (activeDisplay.workArea.width - rowWidth) / 2);
    const targetTop = activeDisplay.workArea.y + activeDisplay.workArea.height - rowHeight - Math.max(28, size * 0.25);
    const dx = targetLeft - minX;
    const dy = targetTop - minY;
    participants.forEach((pet) => {
      pet.x += dx;
      pet.y += dy;
    });
  }

  update(dt, cursor) {
    const safeDt = finite(dt) ? Math.max(0, Math.min(1, dt)) : 0;
    this.sanitizeState();
    if (this.paused) return this.snapshot();
    this.elapsed += safeDt;
    this.pets.forEach((pet) => {
      if (pet.phrase && pet.phraseUntil <= this.elapsed) pet.phrase = '';
      pet.frame = (pet.frame + safeDt * 6) % 10000;
    });
    if (this.mode === 'shout') {
      if (this.elapsed >= this.modeUntil) {
        this.mode = 'free';
        this.pets.forEach((pet) => {
          pet.phrase = '';
          pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left';
        });
      }
      this.sanitizeState();
      return this.snapshot();
    }

    if (this.mode === 'centipede') {
      this.updateCentipede(safeDt, cursor);
      this.sanitizeState();
      return this.snapshot();
    }
    if (this.mode === 'poopChase') {
      this.updatePoopChase(safeDt, cursor);
      this.sanitizeState();
      return this.snapshot();
    }

    this.updateFree(safeDt);
    this.sanitizeState();
    if (this.behaviors.randomDad.enabled && this.elapsed >= this.nextDadAt) {
      this.callDad(this.random() < this.behaviors.randomDad.groupChance);
      this.nextDadAt = this.elapsed + this.randomDadDelay();
    }
    return this.snapshot();
  }

  updateFree(dt) {
    const size = this.config.render.spriteSize;
    const shouldTurn = this.elapsed >= this.nextTurnAt;
    if (shouldTurn) this.nextTurnAt = this.elapsed + this.behaviors.freeRoam.turnIntervalMs / 1000;

    this.pets.forEach((pet) => {
      pet.effect = '';
      pet.effectSize = this.config.render.effectSize;
      if (pet.dragging) return;
      if (shouldTurn && this.random() < 0.35) {
        const speed = this.randomBetween(this.behaviors.freeRoam.speedMin, this.behaviors.freeRoam.speedMax);
        pet.vx = (this.random() > 0.5 ? 1 : -1) * speed;
        pet.vy = this.randomBetween(-12, 12);
      }
      pet.x += pet.vx * dt;
      pet.y += pet.vy * dt;
      const display = this.getDisplayForPoint({ x: pet.x + size / 2, y: pet.y + size / 2 });
      const minX = display.workArea.x;
      const maxX = display.workArea.x + display.workArea.width - size;
      const minY = display.workArea.y;
      const maxY = display.workArea.y + display.workArea.height - size;
      if (pet.x <= minX || pet.x >= maxX) pet.vx *= -1;
      if (pet.y <= minY || pet.y >= maxY) pet.vy *= -1;
      pet.x = clamp(pet.x, minX, maxX);
      pet.y = clamp(pet.y, minY, maxY);
      pet.direction = pet.vx >= 0 ? 'right' : 'left';
      pet.action = pet.direction === 'right' ? 'crawl_right' : 'crawl_left';
    });
  }

  moveLeaderToward(leader, cursor, settings) {
    const size = this.config.render.spriteSize;
    const rightHead = this.anchorsFor(leader, 'right').head;
    const leftHead = this.anchorsFor(leader, 'left').head;
    const followAnchor = { x: (rightHead[0] + leftHead[0]) / 2, y: (rightHead[1] + leftHead[1]) / 2 };
    const safeCursor = this.safePoint(cursor, {
      x: leader.x + followAnchor.x * size,
      y: leader.y + followAnchor.y * size
    });
    const targetX = safeCursor.x - followAnchor.x * size;
    const targetY = safeCursor.y - followAnchor.y * size;
    const deltaX = targetX - leader.x;
    const deltaY = targetY - leader.y;
    const desiredDistance = Math.hypot(deltaX, deltaY);
    const deadZone = settings.deadZone || 0;
    if (desiredDistance <= deadZone || settings.dt <= 0) {
      leader.vx = 0;
      leader.vy = 0;
      return { movedX: 0, movedY: 0, moving: false };
    }
    const previousX = leader.x;
    const previousY = leader.y;
    const maxStep = settings.maxSpeed * settings.dt;
    const smoothStep = 1 - Math.exp(-settings.followStrength * settings.dt);
    const wantedStep = Math.max(0, desiredDistance - deadZone) * smoothStep;
    const ratio = desiredDistance > 0 ? Math.min(wantedStep, maxStep) / desiredDistance : 0;
    leader.x += deltaX * ratio;
    leader.y += deltaY * ratio;
    this.clampPet(leader);
    const movedX = leader.x - previousX;
    const movedY = leader.y - previousY;
    leader.vx = movedX / settings.dt;
    leader.vy = movedY / settings.dt;
    if (Math.abs(movedX) >= 0.25) leader.direction = movedX > 0 ? 'right' : 'left';
    return { movedX, movedY, moving: Math.hypot(movedX, movedY) >= 0.1 };
  }

  updateTrailFromLeader(leader) {
    const size = this.config.render.spriteSize;
    const anchors = this.anchorsFor(leader);
    const rear = {
      x: leader.x + anchors.rear[0] * size,
      y: leader.y + anchors.rear[1] * size,
      direction: leader.direction
    };
    if (!this.trail.length || distance(this.trail[0], rear) >= 2) this.trail.unshift(rear);
    return { rear, anchors };
  }

  trimTrail(maxTrail) {
    let accumulated = 0;
    let keep = this.trail.length;
    for (let index = 0; index < this.trail.length - 1; index += 1) {
      accumulated += distance(this.trail[index], this.trail[index + 1]);
      if (accumulated >= maxTrail) { keep = index + 2; break; }
    }
    this.trail.length = keep;
  }

  updateCentipede(dt, cursor) {
    const size = this.config.render.spriteSize;
    const settings = this.behaviors.centipede;
    const leader = this.pets[0];
    this.moveLeaderToward(leader, cursor, { ...settings, dt });
    leader.action = leader.direction === 'right' ? 'centipede_right' : 'centipede_left';
    leader.effect = settings.slime && this.behaviors.prankEffects.enabled ? 'slime' : '';

    const { anchors } = this.updateTrailFromLeader(leader);
    const headRearLength = Math.abs(anchors.head[0] - anchors.rear[0]) * size;
    const stride = Math.max(size * 0.52, headRearLength) + settings.gap;
    this.trimTrail(stride * Math.max(1, this.pets.length) + 220);

    for (let index = 1; index < this.pets.length; index += 1) {
      const pet = this.pets[index];
      const target = sampleTrail(this.trail, settings.gap + (index - 1) * stride);
      pet.direction = target.direction;
      const petAnchors = this.anchorsFor(pet);
      pet.x = target.x - petAnchors.head[0] * size;
      pet.y = target.y - petAnchors.head[1] * size;
      pet.action = pet.direction === 'right' ? 'centipede_right' : 'centipede_left';
      pet.effect = index === this.pets.length - 1 && settings.flies && this.behaviors.prankEffects.enabled ? 'flies' : '';
      pet.effectSize = this.config.render.effectSize;
      pet.dragging = false;
      this.clampPet(pet);
    }
  }

  updatePoopChase(dt, cursor) {
    const { settings, leader, followers, participants } = this.poopChaseParticipants();
    if (!settings.enabled || !leader || !followers.length) {
      this.mode = 'free';
      this.clearFormation();
      return;
    }

    this.moveLeaderToward(leader, cursor, { ...settings, dt });
    const size = this.config.render.spriteSize;
    const { anchors } = this.updateTrailFromLeader(leader);
    const headRearLength = Math.abs(anchors.head[0] - anchors.rear[0]) * size;
    const stride = Math.max(size * 0.52, headRearLength) + settings.gap;
    this.trimTrail(stride * Math.max(1, participants.length) + 220);

    for (let index = 0; index < followers.length; index += 1) {
      const pet = followers[index];
      const target = sampleTrail(this.trail, settings.gap + index * stride);
      pet.direction = target.direction;
      const petAnchors = this.anchorsFor(pet);
      pet.x = target.x - petAnchors.head[0] * size;
      pet.y = target.y - petAnchors.head[1] * size;
      pet.vx = 0;
      pet.vy = 0;
      pet.dragging = false;
      this.clampPet(pet);
    }

    const participantIds = new Set([leader.id, ...followers.map((pet) => pet.id)]);
    for (const pet of this.pets) {
      if (participantIds.has(pet.id)) continue;
      pet.effect = '';
      pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left';
    }

    this.updatePoopRelay(settings, participants);
    leader.action = `poop_${leader.direction}`;
    leader.effect = '';
    leader.effectSize = this.config.render.effectSize;
    leader.dragging = false;

    for (const pet of followers) {
      const eating = this.elapsed < pet.eatUntil;
      pet.action = eating ? `eat_${pet.direction}` : `centipede_${pet.direction}`;
      pet.effect = eating && this.behaviors.prankEffects.enabled ? 'stink' : '';
      pet.effectSize = eating ? settings.stinkSize : this.config.render.effectSize;
      pet.dragging = false;
    }
  }

  anchorPoint(pet, kind) {
    const size = this.config.render.spriteSize;
    const anchors = this.anchorsFor(pet);
    return { x: pet.x + anchors[kind][0] * size, y: pet.y + anchors[kind][1] * size };
  }

  createRelayDropping(settings, participants) {
    const source = participants[this.poopRelay.sourceIndex];
    const target = participants[this.poopRelay.sourceIndex + 1];
    if (!source || !target) return;
    const rear = this.anchorPoint(source, 'rear');
    source.poopUntil = this.elapsed + Math.max(settings.poopDurationMs, settings.dropVisibleBeforeEatMs + settings.eatDurationMs) / 1000;
    const dropping = {
      id: `poop-${this.nextDroppingId++}`,
      x: rear.x,
      y: rear.y + this.config.render.spriteSize * 0.12,
      sourceId: source.id,
      targetId: target.id,
      createdAt: this.elapsed,
      edibleAt: this.elapsed + settings.dropVisibleBeforeEatMs / 1000,
      approachedTarget: false,
      eatenBy: [],
      consumedAt: null
    };
    dropping.approachedTarget = distance(this.anchorPoint(target, 'head'), dropping) <= settings.eatRadius;
    this.droppings = [dropping];
    this.poopRelay.phase = 'waitingEat';
    this.poopRelay.phaseUntil = Number.POSITIVE_INFINITY;
  }

  createTailDropping(settings, source) {
    const rear = this.anchorPoint(source, 'rear');
    source.poopUntil = this.elapsed + settings.poopDurationMs / 1000;
    this.droppings = [{
      id: `poop-${this.nextDroppingId++}`,
      x: rear.x,
      y: rear.y + this.config.render.spriteSize * 0.12,
      sourceId: source.id,
      targetId: null,
      createdAt: this.elapsed,
      edibleAt: Number.POSITIVE_INFINITY,
      approachedTarget: false,
      eatenBy: [],
      consumedAt: null
    }];
    this.poopRelay.phase = 'tailDrop';
    this.poopRelay.phaseUntil = source.poopUntil;
  }

  updatePoopRelay(settings, participants) {
    if (!this.poopRelay) return;
    const relay = this.poopRelay;
    if (relay.phase === 'waitingDrop' && this.elapsed >= relay.phaseUntil) {
      this.createRelayDropping(settings, participants);
      return;
    }
    if (relay.phase === 'waitingEat') {
      const dropping = this.droppings[0];
      const target = participants[relay.sourceIndex + 1];
      if (!dropping || !target) return;
      if (this.elapsed - dropping.createdAt >= settings.droppingTtlMs / 1000) {
        this.createRelayDropping(settings, participants);
        return;
      }
      if (distance(this.anchorPoint(target, 'head'), dropping) <= settings.eatRadius) dropping.approachedTarget = true;
      if (this.elapsed < dropping.edibleAt || !dropping.approachedTarget) return;
      dropping.eatenBy = [target.id];
      dropping.consumedAt = this.elapsed;
      target.eatUntil = this.elapsed + settings.eatDurationMs / 1000;
      relay.sourceIndex += 1;
      relay.phase = 'eating';
      relay.phaseUntil = target.eatUntil;
      return;
    }
    if (relay.phase === 'eating') {
      if (this.elapsed < relay.phaseUntil) return;
      if (relay.sourceIndex >= participants.length - 1) this.createTailDropping(settings, participants[participants.length - 1]);
      else this.createRelayDropping(settings, participants);
      return;
    }
    if (relay.phase === 'tailDrop' && this.elapsed >= relay.phaseUntil) {
      relay.phase = 'roundReset';
      relay.phaseUntil = this.elapsed + settings.roundResetDelayMs / 1000;
      return;
    }
    if (relay.phase === 'roundReset' && this.elapsed >= relay.phaseUntil) {
      relay.sourceIndex = 0;
      this.createRelayDropping(settings, participants);
    }
  }

  snapshot() {
    return {
      mode: this.mode,
      paused: this.paused,
      pets: this.pets.map((pet) => ({ ...pet })),
      droppings: this.droppings.map((dropping) => ({ ...dropping, eatenBy: [...dropping.eatenBy] }))
    };
  }
}

module.exports = { BehaviorEngine, sampleTrail, clamp };
