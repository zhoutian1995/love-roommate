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
    this.formationTransition = null;
    this.shoutStartedAt = 0;
    this.shoutTargetIds = new Set();
    this.shoutSequence = null;
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

  windowPadding() {
    const size = this.config.render.spriteSize;
    const windowSize = this.config.render.windowSize;
    return Math.max(0, (windowSize - size) / 2);
  }

  petPositionBounds(display) {
    const padding = this.windowPadding();
    const windowSize = this.config.render.windowSize;
    const workArea = display.workArea;
    return {
      minX: workArea.x + padding,
      maxX: workArea.x + workArea.width - windowSize + padding,
      minY: workArea.y + padding,
      maxY: workArea.y + workArea.height - windowSize + padding
    };
  }

  petWindowRect(pet) {
    const padding = this.windowPadding();
    const windowSize = this.config.render.windowSize;
    return {
      left: pet.x - padding,
      top: pet.y - padding,
      right: pet.x - padding + windowSize,
      bottom: pet.y - padding + windowSize
    };
  }

  createPet(character, index) {
    const display = this.displays[index % this.displays.length];
    const bounds = this.petPositionBounds(display);
    const speed = this.randomBetween(this.behaviors.freeRoam.speedMin, this.behaviors.freeRoam.speedMax);
    const direction = this.random() > 0.5 ? 1 : -1;
    return {
      id: character.id,
      displayName: character.displayName,
      hueRotate: character.hueRotate || 0,
      x: bounds.minX + this.random() * Math.max(1, bounds.maxX - bounds.minX),
      y: clamp(bounds.maxY - 8 - this.random() * Math.min(120, display.workArea.height / 5), bounds.minY, bounds.maxY),
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
    const bounds = this.petPositionBounds(display);
    pet.x = clamp(pet.x, bounds.minX, bounds.maxX);
    pet.y = clamp(pet.y, bounds.minY, bounds.maxY);
  }

  petFitsWorkArea(pet) {
    const rect = this.petWindowRect(pet);
    return this.displays.some(({ workArea }) =>
      rect.left >= workArea.x && rect.top >= workArea.y &&
      rect.right <= workArea.x + workArea.width &&
      rect.bottom <= workArea.y + workArea.height
    );
  }

  nearestWorkAreaTarget(pet) {
    return this.clampTargetForPet(pet, { x: pet.x, y: pet.y });
  }

  sanitizePet(pet, index = 0) {
    const display = this.displays[index % this.displays.length] || DEFAULT_DISPLAY;
    const bounds = this.petPositionBounds(display);
    if (!finite(pet.x)) pet.x = (bounds.minX + bounds.maxX) / 2;
    if (!finite(pet.y)) pet.y = Math.max(bounds.minY, bounds.maxY - 8);
    if (!finite(pet.vx)) pet.vx = 0;
    if (!finite(pet.vy)) pet.vy = 0;
    if (!finite(pet.frame)) pet.frame = 0;
    if (!finite(pet.phraseUntil)) pet.phraseUntil = 0;
    if (!finite(pet.poopUntil)) pet.poopUntil = 0;
    if (!finite(pet.eatUntil)) pet.eatUntil = 0;
    if (!finite(pet.effectSize)) pet.effectSize = this.config.render.effectSize;
    if (pet.direction !== 'left' && pet.direction !== 'right') pet.direction = pet.vx < 0 ? 'left' : 'right';
    if (typeof pet.action !== 'string' || !pet.action) pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left';
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
    this.formationTransition = null;
    this.shoutSequence = null;
    this.shoutTargetIds.clear();
    this.pets.forEach((pet) => {
      pet.phrase = '';
      pet.phraseUntil = 0;
      pet.effect = '';
      pet.effectSize = this.config.render.effectSize;
      pet.poopUntil = 0;
      pet.eatUntil = 0;
      pet.shoutRecipient = false;
      pet.dragging = false;
    });
  }

  motionSettings(overrides = {}) {
    const configured = this.behaviors.motion || {};
    return {
      maxSpeed: finite(overrides.maxSpeed) && overrides.maxSpeed > 0
        ? overrides.maxSpeed
        : (finite(configured.maxSpeed) && configured.maxSpeed > 0 ? configured.maxSpeed : 120),
      maxAcceleration: finite(overrides.maxAcceleration) && overrides.maxAcceleration > 0
        ? overrides.maxAcceleration
        : (finite(configured.maxAcceleration) && configured.maxAcceleration > 0 ? configured.maxAcceleration : 220),
      arrivalTolerance: finite(configured.arrivalTolerance) && configured.arrivalTolerance > 0
        ? configured.arrivalTolerance
        : 1,
      trailSampleDistance: finite(configured.trailSampleDistance) && configured.trailSampleDistance > 0
        ? configured.trailSampleDistance
        : 3
    };
  }

  clampTargetForPet(pet, target) {
    const size = this.config.render.spriteSize;
    const display = this.getDisplayForPoint({
      x: finite(target?.x) ? target.x + size / 2 : pet.x + size / 2,
      y: finite(target?.y) ? target.y + size / 2 : pet.y + size / 2
    });
    const bounds = this.petPositionBounds(display);
    return {
      x: clamp(target?.x, bounds.minX, bounds.maxX),
      y: clamp(target?.y, bounds.minY, bounds.maxY)
    };
  }

  moveActorToward(pet, target, dt, overrides = {}) {
    const settings = this.motionSettings(overrides);
    const safeDt = finite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const safeTarget = this.clampTargetForPet(pet, target);
    const deltaX = safeTarget.x - pet.x;
    const deltaY = safeTarget.y - pet.y;
    const remaining = Math.hypot(deltaX, deltaY);
    const currentVx = finite(pet.vx) ? pet.vx : 0;
    const currentVy = finite(pet.vy) ? pet.vy : 0;
    const currentSpeed = Math.hypot(currentVx, currentVy);
    if (safeDt <= 0) return remaining <= settings.arrivalTolerance;

    if (remaining <= settings.arrivalTolerance && currentSpeed <= settings.maxAcceleration * safeDt + 0.01) {
      pet.x = safeTarget.x;
      pet.y = safeTarget.y;
      pet.vx = 0;
      pet.vy = 0;
      return true;
    }

    const brakingSpeed = Math.sqrt(Math.max(0, 2 * settings.maxAcceleration * remaining));
    const desiredSpeed = Math.min(settings.maxSpeed, brakingSpeed);
    const desiredVx = remaining > 0 ? deltaX / remaining * desiredSpeed : 0;
    const desiredVy = remaining > 0 ? deltaY / remaining * desiredSpeed : 0;
    const velocityDeltaX = desiredVx - currentVx;
    const velocityDeltaY = desiredVy - currentVy;
    const velocityDelta = Math.hypot(velocityDeltaX, velocityDeltaY);
    const accelerationStep = settings.maxAcceleration * safeDt;
    const accelerationRatio = velocityDelta > accelerationStep && velocityDelta > 0
      ? accelerationStep / velocityDelta
      : 1;
    let nextVx = currentVx + velocityDeltaX * accelerationRatio;
    let nextVy = currentVy + velocityDeltaY * accelerationRatio;
    const nextSpeed = Math.hypot(nextVx, nextVy);
    if (nextSpeed > settings.maxSpeed) {
      nextVx *= settings.maxSpeed / nextSpeed;
      nextVy *= settings.maxSpeed / nextSpeed;
    }

    let stepX = nextVx * safeDt;
    let stepY = nextVy * safeDt;
    const stepDistance = Math.hypot(stepX, stepY);
    const maxStep = settings.maxSpeed * safeDt;
    if (stepDistance > maxStep && stepDistance > 0) {
      stepX *= maxStep / stepDistance;
      stepY *= maxStep / stepDistance;
    }
    if (remaining > 0 && stepX * deltaX + stepY * deltaY > 0 && Math.hypot(stepX, stepY) > remaining) {
      stepX = deltaX;
      stepY = deltaY;
      nextVx = stepX / safeDt;
      nextVy = stepY / safeDt;
    }

    pet.x += stepX;
    pet.y += stepY;
    pet.vx = nextVx;
    pet.vy = nextVy;
    return remaining <= settings.arrivalTolerance && Math.hypot(nextVx, nextVy) <= accelerationStep + 0.01;
  }

  initializeTrail(leader, participantCount) {
    const size = this.config.render.spriteSize;
    const anchors = this.anchorsFor(leader);
    const rear = { x: leader.x + anchors.rear[0] * size, y: leader.y + anchors.rear[1] * size };
    const direction = leader.direction === 'right' ? -1 : 1;
    const requiredLength = Math.max(300, participantCount * size * 1.2);
    this.trail = [{ x: rear.x, y: rear.y, direction: leader.direction }];
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

  callDad() {
    return this.startGroupShout(this.behaviors.phrases.dad);
  }

  callGrandpa() {
    return this.startGroupShout(this.behaviors.phrases.grandpa);
  }

  prankExcludedIds() {
    const excludedIds = new Set();
    const recipientId = this.config.selection?.userCharacterId;
    if (recipientId) excludedIds.add(recipientId);
    return excludedIds;
  }

  shoutRecipient() {
    const recipientId = this.config.selection?.userCharacterId;
    return recipientId ? this.pets.find((pet) => pet.id === recipientId) || null : null;
  }

  shoutParticipants() {
    const settings = this.behaviors.poopChase || {};
    const orderedIds = [settings.leaderId, ...(settings.followerIds || [])];
    const excludedIds = this.prankExcludedIds();
    const seen = new Set();
    const participants = [];
    for (const id of orderedIds) {
      const pet = this.pets.find((item) => item.id === id);
      if (pet && !excludedIds.has(pet.id) && !seen.has(pet.id)) {
        seen.add(pet.id);
        participants.push(pet);
      }
    }
    for (const pet of this.pets) {
      if (!excludedIds.has(pet.id) && !seen.has(pet.id)) participants.push(pet);
    }
    return participants;
  }

  startGroupShout(phrase) {
    const participants = this.shoutParticipants();
    const recipient = this.shoutRecipient();
    const result = {
      started: participants.length > 0,
      recipientId: recipient?.id || null,
      participantIds: participants.map((pet) => pet.id),
      excludedIds: [...this.prankExcludedIds()],
      skippedReason: participants.length ? null : 'no-eligible-participants'
    };
    if (!participants.length) return result;
    const formation = this.groupShoutTargets(participants, recipient);
    if (formation.skippedReason) {
      return { ...result, started: false, skippedReason: formation.skippedReason };
    }
    this.clearFormation();
    this.shoutTargetIds = new Set(participants.map((pet) => pet.id));
    this.shoutSequence = {
      phase: 'forming',
      phaseStartedAt: this.elapsed,
      phrase,
      participants,
      targets: formation.participantTargets,
      recipient,
      recipientTarget: formation.recipientTarget
    };
    participants.forEach((pet) => {
      pet.phrase = '';
      pet.phraseUntil = 0;
      pet.action = pet.direction === 'left' ? 'idle_left' : 'idle_right';
      pet.frame = 0;
      pet.dragging = false;
    });
    if (recipient) {
      recipient.phrase = '';
      recipient.phraseUntil = 0;
      recipient.action = recipient.direction === 'left' ? 'idle_left' : 'idle_right';
      recipient.frame = 0;
      recipient.dragging = false;
    }
    this.mode = 'shout';
    this.modeUntil = Number.POSITIVE_INFINITY;
    return result;
  }

  kneelingRowTargets(participants, display = null) {
    if (!participants.length) return new Map();
    const size = this.config.render.spriteSize;
    const windowSize = this.config.render.windowSize;
    const activeDisplay = display || this.getDisplayForPoint({ x: participants[0].x + size / 2, y: participants[0].y + size / 2 });
    const workArea = activeDisplay.workArea;
    const windowGap = Math.max(8, windowSize * 0.08);
    const bodyGap = Math.max(12, size * 0.12);
    const maxColumns = Math.max(1, Math.floor((workArea.width + windowGap) / (windowSize + windowGap)));
    const rows = [];
    for (let index = 0; index < participants.length; index += maxColumns) {
      rows.push(participants.slice(index, index + maxColumns));
    }
    const windowPadding = Math.max(0, (windowSize - size) / 2);
    const bottomMargin = Math.max(24, size * 0.22);
    const rowsHeight = rows.length * windowSize + Math.max(0, rows.length - 1) * windowGap;
    const queueTop = workArea.y + workArea.height - bottomMargin - rowsHeight;
    const targets = new Map();
    rows.forEach((row, rowIndex) => {
      const rowWidth = row.length * size + Math.max(0, row.length - 1) * bodyGap;
      const rowLeft = workArea.x + (workArea.width - rowWidth) / 2;
      row.forEach((pet, columnIndex) => {
        targets.set(pet.id, {
          x: rowLeft + columnIndex * (size + bodyGap),
          y: queueTop + rowIndex * (windowSize + windowGap) + windowPadding
        });
      });
    });
    return targets;
  }

  groupShoutTargets(participants, recipient) {
    const size = this.config.render.spriteSize;
    const focus = recipient || participants[0];
    const activeDisplay = this.getDisplayForPoint({ x: focus.x + size / 2, y: focus.y + size / 2 });
    const participantTargets = this.kneelingRowTargets(participants, activeDisplay);
    const windowSize = this.config.render.windowSize;
    const windowPadding = Math.max(0, (windowSize - size) / 2);
    const targetFits = (target) => {
      const left = target.x - windowPadding;
      const top = target.y - windowPadding;
      return left >= activeDisplay.workArea.x &&
        top >= activeDisplay.workArea.y &&
        left + windowSize <= activeDisplay.workArea.x + activeDisplay.workArea.width &&
        top + windowSize <= activeDisplay.workArea.y + activeDisplay.workArea.height;
    };
    if ([...participantTargets.values()].some((target) => !targetFits(target))) {
      return { participantTargets: new Map(), recipientTarget: null, skippedReason: 'insufficient-work-area' };
    }
    if (!recipient) return { participantTargets, recipientTarget: null, skippedReason: null };
    const firstRowVisibleTop = Math.min(...participantTargets.values().map((target) => target.y));
    const verticalGap = Math.max(48, size * 0.48);
    const recipientTarget = {
      x: activeDisplay.workArea.x + (activeDisplay.workArea.width - size) / 2,
      y: firstRowVisibleTop - size - verticalGap
    };
    if (!targetFits(recipientTarget)) {
      return { participantTargets: new Map(), recipientTarget: null, skippedReason: 'insufficient-work-area' };
    }
    return {
      participantTargets,
      recipientTarget,
      skippedReason: null
    };
  }

  moveShoutActor(pet, target, gatherSpeed, dt, standing) {
    const deltaX = target.x - pet.x;
    const arrived = this.moveActorToward(pet, target, dt, { maxSpeed: Math.min(gatherSpeed, this.motionSettings().maxSpeed) });
    if (Math.abs(deltaX) >= 0.01) pet.direction = deltaX > 0 ? 'right' : 'left';
    pet.action = standing
      ? (pet.direction === 'right' ? 'idle_right' : 'idle_left')
      : (pet.direction === 'right' ? 'crawl_right' : 'crawl_left');
    pet.frame = 0;
    pet.phrase = '';
    pet.phraseUntil = 0;
    pet.dragging = false;
    return arrived;
  }

  holdShoutRecipient(sequence) {
    if (!sequence.recipient || !sequence.recipientTarget) return;
    const pet = sequence.recipient;
    Object.assign(pet, sequence.recipientTarget, {
      vx: 0,
      vy: 0,
      action: pet.direction === 'left' ? 'idle_left' : 'idle_right',
      frame: 0,
      phrase: '',
      phraseUntil: 0,
      shoutRecipient: true,
      dragging: false
    });
  }

  updateShout(dt) {
    const sequence = this.shoutSequence;
    if (!sequence) {
      this.finishGroupShout();
      return;
    }
    const settings = this.behaviors.groupShout || {};
    const gatherSpeed = finite(settings.gatherSpeed) && settings.gatherSpeed > 0 ? settings.gatherSpeed : 180;
    const kneelDelay = (finite(settings.kneelDelayMs) ? Math.max(0, settings.kneelDelayMs) : 350) / 1000;
    const frameDuration = (finite(settings.frameDurationMs) && settings.frameDurationMs > 0 ? settings.frameDurationMs : 1400) / 1000;

    if (sequence.phase === 'forming') {
      let allArrived = true;
      for (const pet of sequence.participants) {
        const target = sequence.targets.get(pet.id);
        if (!this.moveShoutActor(pet, target, gatherSpeed, dt, false)) allArrived = false;
      }
      if (sequence.recipient && !this.moveShoutActor(sequence.recipient, sequence.recipientTarget, gatherSpeed, dt, true)) allArrived = false;
      if (allArrived) {
        this.holdShoutRecipient(sequence);
        const size = this.config.render.spriteSize;
        const recipientCenter = sequence.recipientTarget ? sequence.recipientTarget.x + size / 2 : null;
        for (const pet of sequence.participants) {
          const target = sequence.targets.get(pet.id);
          Object.assign(pet, target, {
            vx: 0,
            vy: 0,
            direction: recipientCenter === null || pet.x + size / 2 < recipientCenter ? 'right' : 'left',
            action: 'shout',
            frame: 0,
            phrase: '',
            phraseUntil: 0
          });
        }
        sequence.phase = 'kneeling';
        sequence.phaseStartedAt = this.elapsed;
      }
      return;
    }

    if (sequence.phase === 'kneeling') {
      this.holdShoutRecipient(sequence);
      for (const pet of sequence.participants) {
        pet.action = 'shout';
        pet.frame = 0;
        pet.phrase = '';
        pet.phraseUntil = 0;
      }
      if (this.elapsed - sequence.phaseStartedAt < kneelDelay) return;
      sequence.phase = 'shouting';
      sequence.phaseStartedAt = this.elapsed;
      this.shoutStartedAt = this.elapsed;
      this.modeUntil = this.elapsed + frameDuration * 3;
    }

    const shoutElapsed = this.elapsed - sequence.phaseStartedAt;
    if (shoutElapsed + 1e-9 >= frameDuration * 3) {
      this.finishGroupShout();
      return;
    }
    const frame = Math.min(2, Math.floor((shoutElapsed + 1e-9) / frameDuration));
    this.holdShoutRecipient(sequence);
    for (const pet of sequence.participants) {
      pet.vx = 0;
      pet.vy = 0;
      pet.action = 'shout';
      pet.frame = frame;
      pet.phrase = sequence.phrase;
      pet.phraseUntil = this.modeUntil;
    }
  }

  finishGroupShout() {
    const participants = this.shoutSequence?.participants || [];
    const recipient = this.shoutSequence?.recipient || null;
    this.mode = 'free';
    this.shoutSequence = null;
    this.shoutTargetIds.clear();
    participants.forEach((pet) => {
      pet.phrase = '';
      pet.phraseUntil = 0;
      pet.vx = 0;
      pet.vy = 0;
      pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left';
    });
    if (recipient) {
      recipient.shoutRecipient = false;
      recipient.phrase = '';
      recipient.phraseUntil = 0;
      recipient.vx = 0;
      recipient.vy = 0;
      recipient.action = recipient.direction === 'right' ? 'idle_right' : 'idle_left';
    }
  }

  centipedeRowTargets(participants, display = null) {
    if (!participants.length) return { targets: new Map(), skippedReason: 'no-eligible-participants' };
    const size = this.config.render.spriteSize;
    const activeDisplay = display || this.getDisplayForPoint({ x: participants[0].x + size / 2, y: participants[0].y + size / 2 });
    const staged = this.stagedCentipede(participants);
    const extents = this.centipedeWindowExtents(staged);
    if (extents.width > activeDisplay.workArea.width || extents.height > activeDisplay.workArea.height) {
      return { targets: new Map(), skippedReason: 'insufficient-work-area' };
    }
    const centeredLeft = activeDisplay.workArea.x + (activeDisplay.workArea.width - extents.width) / 2;
    const desiredBottom = activeDisplay.workArea.y + activeDisplay.workArea.height - Math.max(24, size * 0.22);
    const lowestSafeBottom = activeDisplay.workArea.y + extents.height;
    const fittedBottom = clamp(desiredBottom, lowestSafeBottom, activeDisplay.workArea.y + activeDisplay.workArea.height);
    const dx = centeredLeft - extents.minX;
    const dy = fittedBottom - extents.maxY;
    return {
      targets: new Map(staged.map((pet) => [pet.id, { x: pet.x + dx, y: pet.y + dy, direction: 'right' }])),
      skippedReason: null
    };
  }

  stagedCentipede(participants) {
    const size = this.config.render.spriteSize;
    const staged = participants.map((pet) => ({ ...pet, x: 0, y: 0, direction: 'right' }));
    const connectionOverlap = Math.max(3, size * 0.04);
    for (let index = 1; index < staged.length; index += 1) {
      const previous = staged[index - 1];
      const pet = staged[index];
      const rear = this.anchorPoint(previous, 'rear');
      const mouth = this.anchorsFor(pet, 'right').mouth || this.anchorsFor(pet, 'right').head;
      pet.x = rear.x - mouth[0] * size + connectionOverlap;
      pet.y = rear.y - mouth[1] * size;
    }
    return staged;
  }

  centipedeWindowExtents(staged) {
    const rects = staged.map((pet) => this.petWindowRect(pet));
    const minX = Math.min(...rects.map((rect) => rect.left));
    const maxX = Math.max(...rects.map((rect) => rect.right));
    const minY = Math.min(...rects.map((rect) => rect.top));
    const maxY = Math.max(...rects.map((rect) => rect.bottom));
    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  clampLeaderForConnectedFormation(target, participants, display) {
    const staged = this.stagedCentipede(participants);
    const extents = this.centipedeWindowExtents(staged);
    const workArea = display.workArea;
    return {
      x: clamp(target.x, workArea.x - extents.minX, workArea.x + workArea.width - extents.maxX),
      y: clamp(target.y, workArea.y - extents.minY, workArea.y + workArea.height - extents.maxY)
    };
  }

  arrangeCentipedeRow(participants, display = null) {
    const formation = this.centipedeRowTargets(participants, display);
    if (formation.skippedReason) return formation;
    for (const pet of participants) {
      const target = formation.targets.get(pet.id);
      Object.assign(pet, target, { vx: 0, vy: 0, dragging: false, action: 'centipede_right' });
    }
    return formation;
  }

  beginFormationTransition(kind, participants, targets) {
    this.formationTransition = {
      kind,
      participantIds: participants.map((pet) => pet.id),
      targets,
      startedAt: this.elapsed
    };
    for (const pet of participants) {
      pet.dragging = false;
      pet.phrase = '';
      pet.phraseUntil = 0;
    }
  }

  updateFormationTransition(dt) {
    const transition = this.formationTransition;
    if (!transition) return true;
    let allArrived = true;
    for (const id of transition.participantIds) {
      const pet = this.pets.find((item) => item.id === id);
      const target = transition.targets.get(id);
      if (!pet || !target) continue;
      const deltaX = target.x - pet.x;
      if (Math.abs(deltaX) >= 0.01) pet.direction = deltaX > 0 ? 'right' : 'left';
      if (!this.moveActorToward(pet, target, dt)) allArrived = false;
      if (transition.kind === 'shout-recipient') pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left';
      else pet.action = pet.direction === 'right' ? 'crawl_right' : 'crawl_left';
      pet.frame = 0;
      pet.effect = '';
      pet.dragging = false;
    }
    if (allArrived) {
      for (const id of transition.participantIds) {
        const pet = this.pets.find((item) => item.id === id);
        const target = transition.targets.get(id);
        if (!pet || !target) continue;
        pet.direction = target.direction === 'left' ? 'left' : 'right';
        pet.vx = 0;
        pet.vy = 0;
      }
      this.formationTransition = null;
    }
    return allArrived;
  }

  centipedeParticipants() {
    const selfId = this.config.selection?.userCharacterId;
    return selfId ? this.pets.filter((pet) => pet.id !== selfId) : [...this.pets];
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
    const participants = this.centipedeParticipants();
    if (!participants.length) return this.mode;
    const display = this.getDisplayForPoint(cursor || participants[0]);
    const formation = this.centipedeRowTargets(participants, display);
    if (formation.skippedReason) return this.mode;
    this.mode = 'centipede';
    this.beginFormationTransition('centipede', participants, formation.targets);
    const participantIds = new Set(participants.map((pet) => pet.id));
    this.pets.forEach((pet) => {
      if (participantIds.has(pet.id)) return;
      pet.vx = 0;
      pet.vy = 0;
      pet.effect = '';
      pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left';
    });
    return this.mode;
  }

  poopChaseParticipants() {
    const settings = this.behaviors.poopChase || {};
    const selfId = this.config.selection?.userCharacterId;
    const configuredIds = [settings.leaderId, ...(settings.followerIds || [])];
    const leader = this.pets.find((pet) => pet.id === (selfId || settings.leaderId));
    const seen = new Set();
    const followers = [...configuredIds, ...this.pets.map((pet) => pet.id)]
      .filter((id) => id !== leader?.id && !seen.has(id) && seen.add(id))
      .map((id) => this.pets.find((pet) => pet.id === id))
      .filter(Boolean);
    return { settings, leader, followers, participants: leader ? [leader, ...followers] : followers, hasUser: Boolean(selfId && leader) };
  }

  togglePoopChase(cursor = null) {
    const { settings, leader, followers, participants, hasUser } = this.poopChaseParticipants();
    if (!settings.enabled || !leader || (hasUser && !followers.length)) return this.mode;
    if (this.mode === 'poopChase') {
      this.mode = 'free';
      this.clearFormation();
      this.pets.forEach((pet) => { pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left'; });
      return this.mode;
    }

    this.clearFormation();
    const size = this.config.render.spriteSize;
    const target = this.safePoint(cursor, { x: leader.x + size / 2, y: leader.y + size / 2 });
    const display = this.getDisplayForPoint(target);
    const formation = this.poopChaseRowTargets(participants, settings, display);
    if (formation.skippedReason) return this.mode;
    this.mode = 'poopChase';
    this.beginFormationTransition(hasUser ? 'self-poop' : 'cursor-poop', participants, formation.targets);
    if (!hasUser) {
      this.poopRelay = { cursorControlled: true, phase: 'forming' };
      this.updateCursorDropping(cursor, leader);
      return this.mode;
    }
    this.poopRelay = {
      cursorControlled: false,
      fixedSource: true,
      targetIndex: 1,
      phase: 'forming',
      phaseUntil: Number.POSITIVE_INFINITY
    };
    return this.mode;
  }

  arrangePoopChaseRow(participants, settings, display = null) {
    const formation = this.poopChaseRowTargets(participants, settings, display);
    if (formation.skippedReason) return formation;
    for (const pet of participants) {
      const target = formation.targets.get(pet.id);
      Object.assign(pet, target, { vx: 0, vy: 0, dragging: false });
    }
    return formation;
  }

  poopChaseRowTargets(participants, settings, display = null) {
    return this.centipedeRowTargets(participants, display);
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
      this.updateShout(safeDt);
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
      this.callDad();
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
      if (!this.petFitsWorkArea(pet)) {
        const previousX = pet.x;
        const previousY = pet.y;
        this.moveActorToward(pet, this.nearestWorkAreaTarget(pet), dt);
        const movedX = pet.x - previousX;
        if (Math.abs(movedX) >= 0.25) pet.direction = movedX > 0 ? 'right' : 'left';
        pet.action = pet.direction === 'right' ? 'crawl_right' : 'crawl_left';
        return;
      }
      if (shouldTurn && this.random() < 0.35) {
        const speed = this.randomBetween(this.behaviors.freeRoam.speedMin, this.behaviors.freeRoam.speedMax);
        pet.vx = (this.random() > 0.5 ? 1 : -1) * speed;
        pet.vy = this.randomBetween(-12, 12);
      }
      pet.x += pet.vx * dt;
      pet.y += pet.vy * dt;
      const display = this.getDisplayForPoint({ x: pet.x + size / 2, y: pet.y + size / 2 });
      const bounds = this.petPositionBounds(display);
      const { minX, maxX, minY, maxY } = bounds;
      if (pet.x <= minX || pet.x >= maxX) pet.vx *= -1;
      if (pet.y <= minY || pet.y >= maxY) pet.vy *= -1;
      pet.x = clamp(pet.x, minX, maxX);
      pet.y = clamp(pet.y, minY, maxY);
      pet.direction = pet.vx >= 0 ? 'right' : 'left';
      pet.action = pet.direction === 'right' ? 'crawl_right' : 'crawl_left';
    });
  }

  moveLeaderToward(leader, cursor, settings, participants = [leader]) {
    const size = this.config.render.spriteSize;
    const rightHead = this.anchorsFor(leader, 'right').head;
    const leftHead = this.anchorsFor(leader, 'left').head;
    const followAnchor = { x: (rightHead[0] + leftHead[0]) / 2, y: (rightHead[1] + leftHead[1]) / 2 };
    const safeCursor = this.safePoint(cursor, {
      x: leader.x + followAnchor.x * size,
      y: leader.y + followAnchor.y * size
    });
    const rawTargetX = safeCursor.x - followAnchor.x * size;
    const rawTargetY = safeCursor.y - followAnchor.y * size;
    const deltaX = rawTargetX - leader.x;
    const deltaY = rawTargetY - leader.y;
    const desiredDistance = Math.hypot(deltaX, deltaY);
    const deadZone = settings.deadZone || 0;
    const previousX = leader.x;
    const previousY = leader.y;
    const stopRatio = desiredDistance > 0 ? Math.max(0, desiredDistance - deadZone) / desiredDistance : 0;
    const unconstrainedTarget = desiredDistance <= deadZone
      ? { x: leader.x, y: leader.y }
      : { x: leader.x + deltaX * stopRatio, y: leader.y + deltaY * stopRatio };
    const targetDisplay = this.getDisplayForPoint(safeCursor);
    const target = this.clampLeaderForConnectedFormation(unconstrainedTarget, participants, targetDisplay);
    const shared = this.motionSettings();
    this.moveActorToward(leader, target, settings.dt, {
      maxSpeed: Math.min(finite(settings.maxSpeed) && settings.maxSpeed > 0 ? settings.maxSpeed : shared.maxSpeed, shared.maxSpeed),
      maxAcceleration: finite(settings.maxAcceleration) && settings.maxAcceleration > 0
        ? Math.min(settings.maxAcceleration, shared.maxAcceleration)
        : shared.maxAcceleration
    });
    const movedX = leader.x - previousX;
    const movedY = leader.y - previousY;
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
    const sampleDistance = this.motionSettings().trailSampleDistance;
    if (!this.trail.length) this.trail.push(rear, { ...rear });
    else {
      const newestFixedSample = this.trail[1] || this.trail[0];
      const segment = distance(newestFixedSample, rear);
      if (segment >= sampleDistance) {
        const steps = Math.floor(segment / sampleDistance);
        const fixedSamples = [];
        for (let step = 1; step <= steps; step += 1) {
          const ratio = Math.min(1, step * sampleDistance / segment);
          fixedSamples.push({
            x: newestFixedSample.x + (rear.x - newestFixedSample.x) * ratio,
            y: newestFixedSample.y + (rear.y - newestFixedSample.y) * ratio,
            direction: rear.x >= newestFixedSample.x ? 'right' : 'left'
          });
        }
        this.trail = [rear, ...fixedSamples.reverse(), ...this.trail.slice(1)];
      } else this.trail[0] = rear;
    }
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
    const settings = this.behaviors.centipede;
    const participants = this.centipedeParticipants();
    if (this.formationTransition) {
      if (!this.updateFormationTransition(dt)) return;
      if (participants[0]) this.initializeTrail(participants[0], participants.length);
    }
    this.updateCentipedeParticipants(participants, dt, cursor, settings);
    const participantIds = new Set(participants.map((pet) => pet.id));
    for (const pet of this.pets) {
      if (participantIds.has(pet.id)) continue;
      pet.vx = 0;
      pet.vy = 0;
      pet.effect = '';
      pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left';
    }
  }

  updateCentipedeParticipants(participants, dt, cursor, settings = this.behaviors.centipede) {
    const leader = participants[0];
    if (!leader) return;
    const size = this.config.render.spriteSize;
    this.moveLeaderToward(leader, cursor, { ...settings, dt }, participants);
    this.updateTrailFromLeader(leader);
    const connectionOverlap = Math.max(3, size * 0.04);
    let connectionPoint = sampleTrail(this.trail, 0);
    for (let index = 1; index < participants.length; index += 1) {
      const pet = participants[index];
      const direction = pet.direction === 'left' ? 'left' : 'right';
      const anchors = this.anchorsFor(pet, direction);
      const mouth = anchors.mouth || anchors.head;
      const overlapOffset = direction === 'right' ? connectionOverlap : -connectionOverlap;
      const target = {
        x: connectionPoint.x - mouth[0] * size + overlapOffset,
        y: connectionPoint.y - mouth[1] * size
      };
      const maxStep = this.motionSettings().maxSpeed * dt;
      const deltaX = target.x - pet.x;
      const deltaY = target.y - pet.y;
      const stepDistance = Math.hypot(deltaX, deltaY);
      const ratio = stepDistance > maxStep && stepDistance > 0 ? maxStep / stepDistance : 1;
      const movedX = deltaX * ratio;
      const movedY = deltaY * ratio;
      pet.x += movedX;
      pet.y += movedY;
      pet.vx = dt > 0 ? movedX / dt : 0;
      pet.vy = dt > 0 ? movedY / dt : 0;
      connectionPoint = this.anchorPoint(pet, 'rear');
    }
    this.trimTrail(Math.max(300, (participants.length + 2) * size * 1.4));
    for (let index = 0; index < participants.length; index += 1) {
      const pet = participants[index];
      pet.action = `centipede_${pet.direction}`;
      pet.effect = index === participants.length - 1 && settings.flies && this.behaviors.prankEffects.enabled ? 'flies' : '';
      pet.effectSize = this.config.render.effectSize;
      pet.phrase = index === 0 && !this.config.selection?.userCharacterId ? '别跑！' : '';
      pet.phraseUntil = index === 0 && !this.config.selection?.userCharacterId ? Number.POSITIVE_INFINITY : 0;
      pet.dragging = false;
    }
  }

  updatePoopChase(dt, cursor) {
    const { settings, leader, followers, participants, hasUser } = this.poopChaseParticipants();
    if (!settings.enabled || !leader || (hasUser && !followers.length)) {
      this.mode = 'free';
      this.clearFormation();
      return;
    }

    if (!hasUser) {
      this.updateCursorDropping(cursor, leader, dt);
      if (this.formationTransition) {
        if (!this.updateFormationTransition(dt)) return;
        this.initializeTrail(leader, participants.length);
        this.poopRelay.phase = 'active';
      }
      const cursorPoop = this.droppings[0] || this.safePoint(cursor, this.anchorPoint(leader, 'head'));
      this.updateCentipedeParticipants(participants, dt, cursorPoop, {
        ...this.behaviors.centipede,
        maxSpeed: Math.min(settings.maxSpeed || this.behaviors.centipede.maxSpeed, this.behaviors.centipede.maxSpeed),
        maxAcceleration: settings.maxAcceleration || this.behaviors.centipede.maxAcceleration
      });
      return;
    }

    if (this.formationTransition) {
      if (!this.updateFormationTransition(dt)) return;
      this.initializeTrail(leader, participants.length);
      this.createRelayDropping(settings, participants);
    }
    this.updateCentipedeParticipants(participants, dt, cursor, settings);

    const participantIds = new Set([leader.id, ...followers.map((pet) => pet.id)]);
    for (const pet of this.pets) {
      if (participantIds.has(pet.id)) continue;
      pet.effect = '';
      pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left';
    }

    this.updatePoopRelay(settings, participants);
    const relay = this.poopRelay;
    const activeSource = participants[0];
    const nextEater = participants[relay?.targetIndex || 1] || null;
    for (const pet of participants) {
      const eating = this.elapsed < pet.eatUntil;
      if (relay?.fixedSource && pet.id === activeSource?.id) pet.action = `poop_${pet.direction}`;
      else if (eating || pet.id === nextEater?.id) pet.action = `eat_${pet.direction}`;
      else pet.action = `crawl_${pet.direction}`;
      pet.effect = eating && this.behaviors.prankEffects.enabled ? 'stink' : '';
      pet.effectSize = eating ? settings.stinkSize : this.config.render.effectSize;
      pet.phrase = eating ? '啊呜！' : '';
      pet.phraseUntil = eating ? pet.eatUntil : 0;
      pet.dragging = false;
    }
  }

  moveDroppingToward(dropping, target, dt, maxSpeed, maxAcceleration) {
    const safeDt = finite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    if (safeDt <= 0) return distance(dropping, target) <= 0.5;
    const deltaX = target.x - dropping.x;
    const deltaY = target.y - dropping.y;
    const remaining = Math.hypot(deltaX, deltaY);
    const currentVx = finite(dropping.vx) ? dropping.vx : 0;
    const currentVy = finite(dropping.vy) ? dropping.vy : 0;
    const safeSpeed = finite(maxSpeed) && maxSpeed > 0 ? maxSpeed : 120;
    const safeAcceleration = finite(maxAcceleration) && maxAcceleration > 0 ? maxAcceleration : safeSpeed * 2;
    const desiredSpeed = Math.min(safeSpeed, Math.sqrt(Math.max(0, 2 * safeAcceleration * remaining)));
    const desiredVx = remaining > 0 ? deltaX / remaining * desiredSpeed : 0;
    const desiredVy = remaining > 0 ? deltaY / remaining * desiredSpeed : 0;
    const deltaVx = desiredVx - currentVx;
    const deltaVy = desiredVy - currentVy;
    const deltaV = Math.hypot(deltaVx, deltaVy);
    const accelerationStep = safeAcceleration * safeDt;
    const accelerationRatio = deltaV > accelerationStep && deltaV > 0 ? accelerationStep / deltaV : 1;
    let nextVx = currentVx + deltaVx * accelerationRatio;
    let nextVy = currentVy + deltaVy * accelerationRatio;
    const nextSpeed = Math.hypot(nextVx, nextVy);
    if (nextSpeed > safeSpeed) {
      nextVx *= safeSpeed / nextSpeed;
      nextVy *= safeSpeed / nextSpeed;
    }
    let stepX = nextVx * safeDt;
    let stepY = nextVy * safeDt;
    if (stepX * deltaX + stepY * deltaY > 0 && Math.hypot(stepX, stepY) > remaining) {
      stepX = deltaX;
      stepY = deltaY;
      nextVx = stepX / safeDt;
      nextVy = stepY / safeDt;
    }
    dropping.x += stepX;
    dropping.y += stepY;
    dropping.vx = nextVx;
    dropping.vy = nextVy;
    return remaining <= 0.5 && Math.hypot(nextVx, nextVy) <= accelerationStep + 0.01;
  }

  updateCursorDropping(cursor, leader, dt = 0) {
    const fallback = this.anchorPoint(leader, 'head');
    const point = this.safePoint(cursor, fallback);
    let dropping = this.droppings.find((item) => item.id === 'cursor-poop');
    if (!dropping) {
      dropping = {
        id: 'cursor-poop',
        x: point.x,
        y: point.y,
        vx: 0,
        vy: 0,
        sourceId: null,
        targetId: null,
        cursorControlled: true,
        createdAt: this.elapsed,
        edibleAt: Number.POSITIVE_INFINITY,
        approachedTarget: false,
        eatenBy: [],
        consumedAt: null
      };
      this.droppings = [dropping];
      return;
    }
    const settings = this.behaviors.poopChase || {};
    this.moveDroppingToward(
      dropping,
      point,
      dt,
      settings.cursorPoopMaxSpeed,
      settings.maxAcceleration || this.motionSettings().maxAcceleration
    );
  }

  anchorPoint(pet, kind) {
    const size = this.config.render.spriteSize;
    const anchors = this.anchorsFor(pet);
    const anchor = anchors[kind] || (kind === 'mouth' ? anchors.head : null);
    return { x: pet.x + anchor[0] * size, y: pet.y + anchor[1] * size };
  }

  droppingPoint(source, settings, target = null) {
    const size = this.config.render.spriteSize;
    const rear = this.anchorPoint(source, 'rear');
    const radius = Math.max(1, (settings.poopSize || this.config.render.effectSize || 1) / 2);
    const display = this.getDisplayForPoint({ x: source.x + size / 2, y: source.y + size / 2 });
    const workArea = display.workArea;
    if (target) {
      const mouth = this.anchorPoint(target, 'mouth');
      return {
        x: clamp((rear.x + mouth.x) / 2, workArea.x + radius, workArea.x + workArea.width - radius),
        y: clamp((rear.y + mouth.y) / 2, workArea.y + radius, workArea.y + workArea.height - radius)
      };
    }
    const clearance = Math.max(radius + 2, size * 0.1);
    const desiredX = source.direction === 'left'
      ? Math.max(rear.x + clearance, source.x + size + 2)
      : Math.min(rear.x - clearance, source.x - 2);
    return {
      x: clamp(desiredX, workArea.x + radius, workArea.x + workArea.width - radius),
      y: clamp(rear.y + size * 0.12, workArea.y + radius, workArea.y + workArea.height - radius)
    };
  }

  eatingContactPoint(source, target, settings) {
    const mouth = this.anchorPoint(target, 'mouth');
    const rear = this.anchorPoint(source, 'rear');
    const radius = Math.max(1, (settings.poopSize || this.config.render.effectSize || 1) / 2);
    const deltaX = rear.x - mouth.x;
    const deltaY = rear.y - mouth.y;
    const length = Math.hypot(deltaX, deltaY) || 1;
    const contactOffset = radius * 0.62;
    return {
      x: mouth.x + deltaX / length * contactOffset,
      y: mouth.y + deltaY / length * contactOffset
    };
  }

  createRelayDropping(settings, participants) {
    const source = participants[0];
    const targetIndex = finite(this.poopRelay?.targetIndex) ? this.poopRelay.targetIndex : 1;
    const target = participants[targetIndex];
    if (!source || !target) return;
    const point = this.anchorPoint(source, 'rear');
    source.poopUntil = this.elapsed + Math.max(settings.poopDurationMs, settings.dropVisibleBeforeEatMs + settings.eatDurationMs) / 1000;
    const dropping = {
      id: `poop-${this.nextDroppingId++}`,
      x: point.x,
      y: point.y,
      vx: 0,
      vy: 0,
      sourceId: source.id,
      targetId: target.id,
      createdAt: this.elapsed,
      edibleAt: this.elapsed,
      approachedTarget: false,
      eatenBy: [],
      consumedAt: null
    };
    this.droppings = [dropping];
    this.poopRelay.targetIndex = targetIndex;
    this.poopRelay.phase = 'sourceHold';
    this.poopRelay.phaseUntil = this.elapsed + Math.max(0, settings.initialDropDelayMs || settings.dropVisibleBeforeEatMs || 0) / 1000;
  }

  createTailDropping(settings, source) {
    const point = this.droppingPoint(source, settings);
    source.poopUntil = this.elapsed + settings.poopDurationMs / 1000;
    this.droppings = [{
      id: `poop-${this.nextDroppingId++}`,
      x: point.x,
      y: point.y,
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
    if (relay.cursorControlled || relay.phase === 'forming') return;
    const dropping = this.droppings[0];
    const source = participants[0];
    if (!dropping || !source) return;
    const relaySpeed = finite(settings.relaySpeed) && settings.relaySpeed > 0 ? settings.relaySpeed : 120;
    const relayAcceleration = finite(settings.maxAcceleration) && settings.maxAcceleration > 0
      ? settings.maxAcceleration
      : this.motionSettings().maxAcceleration;
    const dt = finite(relay.lastUpdatedAt) ? Math.max(0, Math.min(0.1, this.elapsed - relay.lastUpdatedAt)) : 0;
    relay.lastUpdatedAt = this.elapsed;

    if (relay.phase === 'sourceHold') {
      this.moveDroppingToward(dropping, this.anchorPoint(source, 'rear'), dt, relaySpeed, relayAcceleration);
      if (this.elapsed >= relay.phaseUntil) relay.phase = 'travelling';
      return;
    }

    const target = participants[relay.targetIndex];
    if (!target) return;
    const contact = this.eatingContactPoint(source, target, settings);
    dropping.targetId = target.id;

    if (relay.phase === 'travelling') {
      const arrived = this.moveDroppingToward(dropping, contact, dt, relaySpeed, relayAcceleration);
      if (!arrived) return;
      dropping.approachedTarget = true;
      if (!dropping.eatenBy.includes(target.id)) dropping.eatenBy.push(target.id);
      target.eatUntil = this.elapsed + settings.eatDurationMs / 1000;
      relay.phase = 'mouthHold';
      relay.phaseUntil = this.elapsed + Math.max(settings.mouthHoldMs || 0, settings.eatDurationMs || 0) / 1000;
      return;
    }

    if (relay.phase === 'mouthHold') {
      this.moveDroppingToward(dropping, contact, dt, relaySpeed, relayAcceleration);
      if (this.elapsed < relay.phaseUntil) return;
      if (relay.targetIndex < participants.length - 1) {
        relay.targetIndex += 1;
        relay.phase = 'travelling';
        relay.phaseUntil = Number.POSITIVE_INFINITY;
      } else {
        dropping.consumedAt = this.elapsed;
        relay.phase = 'finalHold';
        relay.phaseUntil = this.elapsed + Math.max(0, settings.consumedDelayMs || 300) / 1000;
      }
      return;
    }

    if (relay.phase === 'finalHold') {
      this.moveDroppingToward(dropping, contact, dt, relaySpeed, relayAcceleration);
      if (this.elapsed < relay.phaseUntil) return;
      this.droppings = [];
      relay.phase = 'roundReset';
      relay.phaseUntil = this.elapsed + Math.max(0, settings.roundResetDelayMs || 0) / 1000;
      return;
    }

    if (relay.phase === 'roundReset' && this.elapsed >= relay.phaseUntil) {
      relay.targetIndex = 1;
      relay.lastUpdatedAt = this.elapsed;
      this.createRelayDropping(settings, participants);
    }
  }

  snapshot() {
    return {
      mode: this.mode,
      shoutPhase: this.shoutSequence?.phase || null,
      paused: this.paused,
      pets: this.pets.map((pet) => ({ ...pet })),
      droppings: this.droppings.map((dropping) => ({ ...dropping, eatenBy: [...dropping.eatenBy] }))
    };
  }
}

module.exports = { BehaviorEngine, sampleTrail, clamp };
