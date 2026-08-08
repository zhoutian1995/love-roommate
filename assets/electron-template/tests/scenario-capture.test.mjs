import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import captureHelpers from '../src/scenario-capture.js';

const {
  boundedCaptureRetry,
  centipedeCaptureMilestone,
  createNativeWindowUpdateGate,
  createBoundedWindowUpdater,
  centeredFormationOffset,
  cropDesktopCapture,
  cursorEffectBounds,
  cursorPoopSize,
  desktopForegroundRatio,
  desktopPixelMatchRatio,
  desktopSurfaceMatchRatio,
  fitCaptureToLogicalBounds,
  groupShoutEvidenceLayout,
  presentAlwaysOnTopWindow,
  presentAlwaysOnTopWindowBounded,
  presentValidationSurfaceBehindPets,
  runtimeEvidenceCoverage,
  runtimeEvidenceLayout,
  runtimeEvidenceMotion,
  runtimeValidationArea,
  scenarioCapturePolicy
} = captureHelpers;

const testDir = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(testDir, '..', 'src', 'main.js'), 'utf8');

test('development scenario composites require an explicit flag and remain ineligible for release evidence', () => {
  assert.deepEqual(scenarioCapturePolicy({ desktopAvailable: true, developmentFallbackRequested: false }), {
    captureKind: 'desktop-compositor',
    releaseEligible: true
  });
  assert.throws(
    () => scenarioCapturePolicy({ desktopAvailable: false, developmentFallbackRequested: false }),
    /desktop compositor/i
  );
  assert.deepEqual(scenarioCapturePolicy({ desktopAvailable: false, developmentFallbackRequested: true }), {
    captureKind: 'synthetic-development',
    releaseEligible: false
  });
});

test('centipede evidence waits for every participant to enter the connected action before early capture', () => {
  const base = {
    participantIds: ['person-1', 'person-2', 'person-3'],
    leaderId: 'person-1',
    captures: [],
    elapsedMs: 900,
    cursor: { x: 500, y: 300 }
  };
  const forming = {
    mode: 'centipede',
    pets: [
      { id: 'person-1', x: 120, y: 100, action: 'centipede_right' },
      { id: 'person-2', x: 80, y: 100, action: 'crawl_right' },
      { id: 'person-3', x: 40, y: 100, action: 'centipede_right' }
    ]
  };
  assert.equal(centipedeCaptureMilestone({ ...base, snapshot: forming }), null);

  const connected = {
    ...forming,
    pets: forming.pets.map((pet) => ({ ...pet, action: 'centipede_right' }))
  };
  assert.deepEqual(centipedeCaptureMilestone({ ...base, snapshot: connected }), {
    label: 'centipede-early',
    evidence: {
      kind: 'cursor-centipede',
      elapsedMs: 900,
      cursor: { x: 500, y: 300 },
      leaderPosition: { x: 120, y: 100 }
    }
  });
});

test('centipede late evidence waits for a completed early capture and at least 40 pixels of leader travel', () => {
  const snapshot = {
    mode: 'centipede',
    pets: [
      { id: 'person-1', x: 139.99, y: 100, action: 'centipede_right' },
      { id: 'person-2', x: 90, y: 100, action: 'centipede_right' }
    ]
  };
  const base = {
    snapshot,
    participantIds: ['person-1', 'person-2'],
    leaderId: 'person-1',
    elapsedMs: 1300,
    cursor: { x: 500, y: 300 }
  };

  assert.equal(centipedeCaptureMilestone({ ...base, captures: [] })?.label, 'centipede-early');
  const captures = [{
    label: 'centipede-early',
    evidence: {
      kind: 'cursor-centipede',
      elapsedMs: 900,
      leaderPosition: { x: 100, y: 100 }
    }
  }];
  assert.equal(centipedeCaptureMilestone({ ...base, captures }), null);

  const moved = {
    ...snapshot,
    pets: snapshot.pets.map((pet) => pet.id === 'person-1' ? { ...pet, x: 140 } : pet)
  };
  assert.deepEqual(centipedeCaptureMilestone({ ...base, snapshot: moved, captures }), {
    label: 'centipede-late',
    evidence: {
      kind: 'cursor-centipede',
      elapsedMs: 1300,
      cursor: { x: 500, y: 300 },
      leaderPosition: { x: 140, y: 100 }
    }
  });
});

test('scenario window capture retries transient compositor errors within a strict bound', async () => {
  let attempts = 0;
  const result = await boundedCaptureRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('UnknownVizError');
    return 'captured';
  }, { attempts: 3, delayMs: 0 });
  assert.equal(result, 'captured');
  assert.equal(attempts, 3);

  let failedAttempts = 0;
  await assert.rejects(
    boundedCaptureRetry(async () => {
      failedAttempts += 1;
      throw new Error('still unavailable');
    }, { attempts: 2, delayMs: 0 }),
    /still unavailable/
  );
  assert.equal(failedAttempts, 2);
});

test('scenario capture scales device-pixel images to BrowserWindow logical bounds', () => {
  const resized = [];
  const image = {
    getSize: () => ({ width: 270, height: 270 }),
    resize: (size) => {
      resized.push(size);
      return { getSize: () => size, marker: 'logical' };
    }
  };

  const result = fitCaptureToLogicalBounds(image, { width: 180, height: 181 });

  assert.deepEqual(resized, [{ width: 180, height: 181, quality: 'best' }]);
  assert.equal(result.marker, 'logical');
});

test('scenario capture keeps an image already matching logical bounds', () => {
  const image = {
    getSize: () => ({ width: 180, height: 181 }),
    resize: () => assert.fail('resize should not run')
  };

  assert.equal(fitCaptureToLogicalBounds(image, { width: 180, height: 181 }), image);
});

test('pet windows reassert topmost state after becoming visible', () => {
  assert.equal(typeof presentAlwaysOnTopWindow, 'function');
  const calls = [];
  const win = {
    isDestroyed: () => false,
    showInactive: () => calls.push('showInactive'),
    setAlwaysOnTop: (enabled, level) => calls.push(`setAlwaysOnTop:${enabled}:${level}`),
    moveTop: () => calls.push('moveTop')
  };

  assert.equal(presentAlwaysOnTopWindow(win, true), true);
  assert.deepEqual(calls, [
    'showInactive',
    'setAlwaysOnTop:true:floating',
    'moveTop'
  ]);
});

test('effect-window topmost presentation is immediate, bounded during steady state, and forceable for capture', () => {
  assert.equal(typeof presentAlwaysOnTopWindowBounded, 'function');
  const calls = [];
  let visible = false;
  const win = {
    isDestroyed: () => false,
    isVisible: () => visible,
    showInactive: () => { visible = true; calls.push('showInactive'); },
    setAlwaysOnTop: (enabled, level) => calls.push(`setAlwaysOnTop:${enabled}:${level}`),
    moveTop: () => calls.push('moveTop')
  };

  assert.equal(presentAlwaysOnTopWindowBounded(win, true, { now: 0, intervalMs: 5000 }), true);
  assert.equal(presentAlwaysOnTopWindowBounded(win, true, { now: 16, intervalMs: 5000 }), false);
  assert.equal(presentAlwaysOnTopWindowBounded(win, true, { now: 4999, intervalMs: 5000 }), false);
  assert.equal(presentAlwaysOnTopWindowBounded(win, true, { now: 5000, intervalMs: 5000 }), true);
  assert.equal(presentAlwaysOnTopWindowBounded(win, true, { now: 5001, intervalMs: 5000, force: true }), true);
  assert.equal(calls.filter((call) => call === 'moveTop').length, 3);
});

test('effect-window native bounds updates run at a bounded rate without treating skipped frames as failures', () => {
  assert.equal(typeof createBoundedWindowUpdater, 'function');
  const updateWindow = createBoundedWindowUpdater(100);
  const win = { isDestroyed: () => false };
  let calls = 0;
  const update = () => { calls += 1; return true; };

  assert.deepEqual(updateWindow(win, update, { now: 0 }), { attempted: true, succeeded: true });
  assert.deepEqual(updateWindow(win, update, { now: 16 }), { attempted: false, succeeded: true });
  assert.deepEqual(updateWindow(win, update, { now: 99 }), { attempted: false, succeeded: true });
  assert.deepEqual(updateWindow(win, update, { now: 100 }), { attempted: true, succeeded: true });
  assert.deepEqual(updateWindow(win, update, { now: 101, force: true }), { attempted: true, succeeded: true });
  assert.equal(calls, 3);
});

test('native window updates pause for an already locked session and resume after unlock', () => {
  assert.equal(typeof createNativeWindowUpdateGate, 'function');
  const listeners = new Map();
  let unlocks = 0;
  const gate = createNativeWindowUpdateGate({
    getSystemIdleState: () => 'locked',
    on: (event, listener) => listeners.set(event, listener)
  }, () => { unlocks += 1; });

  assert.equal(gate.allowed(), false);
  listeners.get('unlock-screen')();
  assert.equal(gate.allowed(), true);
  assert.equal(unlocks, 1);
  listeners.get('lock-screen')();
  assert.equal(gate.allowed(), false);
});

test('ticker gates every steady-state native window move while the desktop session is locked', () => {
  assert.match(mainSource, /powerMonitor/);
  assert.match(mainSource, /createNativeWindowUpdateGate/);
  const tickerSource = mainSource.slice(mainSource.indexOf('function runTickerFrame'), mainSource.indexOf('function startTicker'));
  assert.match(tickerSource, /const nativeWindowUpdatesAllowed\s*=\s*nativeWindowUpdateGate\.allowed\(\)/);
  assert.match(tickerSource, /nativeWindowUpdatesAllowed\s*&&\s*\(!entry\.lastBounds/);
  assert.match(tickerSource, /if \(nativeWindowUpdatesAllowed\) \{[\s\S]*reconcileDroppingWindows/);
  assert.match(tickerSource, /showPoop\s*&&\s*nativeWindowUpdatesAllowed\s*\?\s*ensureCursorPoopWindow/);
  assert.match(tickerSource, /if \(nativeWindowUpdatesAllowed\s*&&\s*showPoop\s*&&\s*poopWindow/);
});

test('validation surface is placed above the desktop and below visible pets', () => {
  assert.equal(typeof presentValidationSurfaceBehindPets, 'function');
  const calls = [];
  const win = (id) => ({
    isDestroyed: () => false,
    isVisible: () => true,
    showInactive: () => calls.push(`${id}:show`),
    setAlwaysOnTop: () => calls.push(`${id}:topmost`),
    moveTop: () => calls.push(`${id}:moveTop`)
  });

  assert.equal(presentValidationSurfaceBehindPets(win('surface'), [win('pet-1'), win('pet-2')]), true);
  assert.deepEqual(calls, [
    'surface:show', 'surface:topmost', 'surface:moveTop',
    'pet-1:show', 'pet-1:topmost', 'pet-1:moveTop',
    'pet-2:show', 'pet-2:topmost', 'pet-2:moveTop'
  ]);
});

test('runtime validation area stays centered, private, and readable on a large desktop', () => {
  const area = runtimeValidationArea({ x: 0, y: 0, width: 2560, height: 1392 }, 112, 5);

  assert.deepEqual(area, { x: 620, y: 336, width: 1320, height: 720 });
});

test('runtime evidence layout keeps every pet window inside a compact non-row canvas', () => {
  const { area, points } = runtimeEvidenceLayout(
    { x: 0, y: 0, width: 2560, height: 1392 },
    5,
    112,
    180
  );
  const windowPadding = (180 - 112) / 2;

  assert.equal(points.length, 5);
  assert.ok(new Set(points.map((point) => Math.round(point.y))).size >= 3, 'normal evidence must not stage a fixed row');
  for (const point of points) {
    const window = {
      left: point.x - windowPadding,
      top: point.y - windowPadding,
      right: point.x - windowPadding + 180,
      bottom: point.y - windowPadding + 180
    };
    assert.ok(window.left >= area.x && window.top >= area.y);
    assert.ok(window.right <= area.x + area.width && window.bottom <= area.y + area.height);
  }
});

test('runtime evidence motion keeps both live frames inside non-overlapping lanes', () => {
  for (let count = 1; count <= 8; count += 1) {
    const { area, points } = runtimeEvidenceLayout(
      { x: 0, y: 0, width: 2560, height: 1392 },
      count,
      112,
      180
    );
    const motions = runtimeEvidenceMotion(points, area, 112, 180, 1500);
    const windowPadding = (180 - 112) / 2;
    const evidenceAt = (elapsedMs) => points.map((point, index) => ({
      id: `person-${index + 1}`,
      visible: true,
      desktopForegroundRatio: 0.05,
      bounds: {
        x: point.x - windowPadding + motions[index].vx * elapsedMs / 1000,
        y: point.y - windowPadding + motions[index].vy * elapsedMs / 1000,
        width: 180,
        height: 180
      }
    }));
    const expectedIds = points.map((_point, index) => `person-${index + 1}`);

    assert.equal(motions.length, points.length, `count ${count}`);
    assert.deepEqual(runtimeEvidenceCoverage(expectedIds, evidenceAt(0), area), [], `initial count ${count}`);
    assert.deepEqual(runtimeEvidenceCoverage(expectedIds, evidenceAt(1500), area), [], `moving count ${count}`);
    assert.ok(motions.some((motion) => Math.hypot(motion.vx, motion.vy) >= 12), `count ${count} must show real movement`);
  }
});

test('runtime evidence coverage fails closed on missing, hidden, clipped, or overlapping pet windows', () => {
  const area = { x: 100, y: 200, width: 900, height: 600 };
  const valid = [
    { id: 'person-1', bounds: { x: 140, y: 260, width: 180, height: 180 }, visible: true, desktopForegroundRatio: 0.08 },
    { id: 'person-2', bounds: { x: 380, y: 320, width: 180, height: 180 }, visible: true, desktopForegroundRatio: 0.07 },
    { id: 'person-3', bounds: { x: 660, y: 420, width: 180, height: 180 }, visible: true, desktopForegroundRatio: 0.09 }
  ];

  assert.deepEqual(runtimeEvidenceCoverage(['person-1', 'person-2', 'person-3'], valid, area), []);
  assert.match(runtimeEvidenceCoverage(['person-1', 'person-2', 'person-3'], valid.slice(0, 2), area).join('\n'), /missing person-3/);
  assert.match(runtimeEvidenceCoverage(['person-1', 'person-2', 'person-3'], valid.map((frame) => frame.id === 'person-2' ? { ...frame, visible: false } : frame), area).join('\n'), /person-2 is not visible/);
  assert.match(runtimeEvidenceCoverage(['person-1', 'person-2', 'person-3'], valid.map((frame) => frame.id === 'person-2' ? { ...frame, desktopForegroundRatio: 0 } : frame), area).join('\n'), /person-2 has no readable compositor foreground/);
  assert.match(runtimeEvidenceCoverage(['person-1', 'person-2', 'person-3'], valid.map((frame) => frame.id === 'person-3' ? { ...frame, bounds: { x: 950, y: 420, width: 180, height: 180 } } : frame), area).join('\n'), /person-3 is outside the capture area/);
  assert.match(runtimeEvidenceCoverage(['person-1', 'person-2', 'person-3'], valid.map((frame) => frame.id === 'person-2' ? { ...frame, bounds: { ...valid[0].bounds } } : frame), area).join('\n'), /person-1 overlaps person-2/);
});

test('desktop evidence crops the real compositor frame to the controlled logical area', () => {
  const crops = [];
  const cropped = { marker: 'cropped' };
  const image = {
    getSize: () => ({ width: 3840, height: 2160 }),
    crop: (bounds) => {
      crops.push(bounds);
      return cropped;
    }
  };

  const result = cropDesktopCapture(
    image,
    { bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
    { x: 620, y: 336, width: 1320, height: 720 }
  );

  assert.equal(result, cropped);
  assert.deepEqual(crops, [{ x: 930, y: 504, width: 1980, height: 1080 }]);
});

test('desktop evidence distinguishes a visible pet from an occluded pet window', () => {
  assert.equal(typeof desktopPixelMatchRatio, 'function');
  const pixel = [24, 112, 238, 255];
  const frame = {
    getSize: () => ({ width: 2, height: 2 }),
    toBitmap: () => Buffer.from([...pixel, ...pixel, ...pixel, ...pixel])
  };
  const visibleDesktop = Buffer.from([
    246, 246, 246, 255, ...pixel, ...pixel, 246, 246, 246, 255,
    246, 246, 246, 255, ...pixel, ...pixel, 246, 246, 246, 255
  ]);
  const hiddenDesktop = Buffer.from(Array.from({ length: 8 }, () => [246, 246, 246, 255]).flat());
  const desktop = (bitmap) => ({
    getSize: () => ({ width: 4, height: 2 }),
    toBitmap: () => bitmap
  });
  const bounds = { x: 1, y: 0, width: 2, height: 2 };
  const workArea = { x: 0, y: 0, width: 4, height: 2 };

  assert.equal(desktopPixelMatchRatio(frame, bounds, desktop(visibleDesktop), workArea), 1);
  assert.equal(desktopPixelMatchRatio(frame, bounds, desktop(hiddenDesktop), workArea), 0);
});

test('desktop evidence tolerates short movement between window and compositor captures', () => {
  const pixel = [24, 112, 238, 255];
  const frame = {
    getSize: () => ({ width: 2, height: 2 }),
    toBitmap: () => Buffer.from([...pixel, ...pixel, ...pixel, ...pixel])
  };
  const shiftedDesktop = Buffer.from([
    246, 246, 246, 255, 246, 246, 246, 255, ...pixel, ...pixel, 246, 246, 246, 255,
    246, 246, 246, 255, 246, 246, 246, 255, ...pixel, ...pixel, 246, 246, 246, 255
  ]);
  const desktop = {
    getSize: () => ({ width: 5, height: 2 }),
    toBitmap: () => shiftedDesktop
  };

  assert.equal(
    desktopPixelMatchRatio(
      frame,
      { x: 1, y: 0, width: 2, height: 2 },
      desktop,
      { x: 0, y: 0, width: 5, height: 2 }
    ),
    1
  );
});

test('desktop evidence proves the controlled validation surface covers the user desktop', () => {
  assert.equal(typeof desktopSurfaceMatchRatio, 'function');
  const surfacePixels = Buffer.from([
    237, 242, 245, 255,
    251, 252, 253, 255
  ]);
  const surface = {
    getSize: () => ({ width: 2, height: 1 }),
    toBitmap: () => surfacePixels
  };
  const desktop = (pixels) => ({
    getSize: () => ({ width: 2, height: 1 }),
    toBitmap: () => Buffer.from(pixels)
  });

  assert.equal(desktopSurfaceMatchRatio(surface, { x: 0, y: 0, width: 2, height: 1 }, desktop(surfacePixels), { x: 0, y: 0, width: 2, height: 1 }), 1);
  assert.equal(desktopSurfaceMatchRatio(surface, { x: 0, y: 0, width: 2, height: 1 }, desktop([0, 0, 0, 255, 0, 0, 0, 255]), { x: 0, y: 0, width: 2, height: 1 }), 0);
});

test('desktop evidence rejects an all-black compositor even when the captured surface is also black', () => {
  const blackPixels = Buffer.from([
    0, 0, 0, 255,
    0, 0, 0, 255
  ]);
  const blackImage = {
    getSize: () => ({ width: 2, height: 1 }),
    toBitmap: () => blackPixels
  };

  assert.equal(
    desktopSurfaceMatchRatio(
      blackImage,
      { x: 0, y: 0, width: 2, height: 1 },
      blackImage,
      { x: 0, y: 0, width: 2, height: 1 }
    ),
    0,
    'matching black buffers are invalid compositor evidence, not proof of the controlled surface'
  );
});

test('desktop evidence detects real foreground inside a pet window without depending on the current action frame', () => {
  assert.equal(typeof desktopForegroundRatio, 'function');
  const surfacePixels = Buffer.from(Array.from({ length: 4 }, () => [246, 246, 246, 255]).flat());
  const visiblePixels = Buffer.from([
    246, 246, 246, 255,
    20, 80, 220, 255,
    246, 246, 246, 255,
    20, 80, 220, 255
  ]);
  const image = (pixels) => ({
    getSize: () => ({ width: 4, height: 1 }),
    toBitmap: () => pixels
  });
  const bounds = { x: 1, y: 0, width: 2, height: 1 };
  const workArea = { x: 0, y: 0, width: 4, height: 1 };

  assert.equal(desktopForegroundRatio(bounds, image(visiblePixels), image(surfacePixels), workArea, workArea), 0.5);
  assert.equal(desktopForegroundRatio(bounds, image(surfacePixels), image(surfacePixels), workArea, workArea), 0);
});

test('cursor effect keeps its normal offset when it does not cover a pet', () => {
  const bounds = cursorEffectBounds(
    { x: 900, y: 400 },
    40,
    [{ x: 200, y: 200, width: 112, height: 112 }],
    { x: 0, y: 0, width: 1200, height: 800 }
  );

  assert.deepEqual(bounds, { x: 910, y: 410, width: 40, height: 40 });
});

test('cursor poop is readable at 40-45 percent of the character scale', () => {
  const config = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../src/config/pet.config.json', import.meta.url)), 'utf8'));
  const minimumReadableSize = Math.round(config.render.spriteSize * 0.40);
  const maximumSubordinateSize = Math.round(config.render.spriteSize * 0.45);
  const size = cursorPoopSize(config.render.effectSize);

  assert.equal(size, 48);
  for (const supportedSize of [cursorPoopSize(16), size, cursorPoopSize(48)]) {
    assert.ok(supportedSize >= minimumReadableSize, `${supportedSize}px cursor poop is too small beside a ${config.render.spriteSize}px character`);
    assert.ok(supportedSize <= maximumSubordinateSize, `${supportedSize}px cursor poop dominates a ${config.render.spriteSize}px character`);
  }
});

test('tray exposes one adaptive poop-chase command and gates group shouts by the selected mode', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const toggleSource = mainSource.slice(mainSource.indexOf('function adaptiveChaseRuntimeMode'), mainSource.indexOf('function broadcastPauseState'));
  const menuSource = mainSource.slice(mainSource.indexOf('function menuTemplate'), mainSource.indexOf('function refreshTrayMenu'));
  const shortcutSource = mainSource.slice(mainSource.indexOf('function registerShortcuts'), mainSource.indexOf('function stageGroupShoutScenario'));

  assert.match(toggleSource, /chaseVariant\s*===\s*'self-poop'[\s\S]*togglePoopChase[\s\S]*toggleCentipede/);
  assert.match(menuSource, /屎追逐模式/);
  assert.doesNotMatch(menuSource, /人体蜈蚣模式|接力模式/);
  assert.match(menuSource, /groupShout\?\.enabled/);
  assert.match(shortcutSource, /groupShout\?\.enabled/);
  assert.match(shortcutSource, /adaptiveChase/);
});

test('adaptive cursor-poop effect windows are click-through and follow the real cursor', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const effectSource = mainSource.slice(mainSource.indexOf('function createEffectWindow'), mainSource.indexOf('function reconcileDroppingWindows'));
  const tickerSource = mainSource.slice(mainSource.indexOf('function scheduleTicker'), mainSource.indexOf('function registerIpc'));

  assert.match(effectSource, /setIgnoreMouseEvents\(true/);
  assert.match(tickerSource, /cursorControlled/);
  assert.match(tickerSource, /cursorEffectBounds\(\s*cursor/);
});

test('cursor effect moves outside the pet formation when the leader catches the cursor', () => {
  const petRects = [
    { x: 560, y: 500, width: 112, height: 112 },
    { x: 486, y: 500, width: 112, height: 112 },
    { x: 412, y: 500, width: 112, height: 112 }
  ];
  const bounds = cursorEffectBounds(
    { x: 650, y: 532 },
    40,
    petRects,
    { x: 0, y: 0, width: 1200, height: 700 }
  );
  const overlaps = (left, right) => (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );

  assert.ok(petRects.every((rect) => !overlaps(bounds, rect)), `effect still covers a pet: ${JSON.stringify(bounds)}`);
  assert.ok(bounds.x >= 0 && bounds.y >= 0);
  assert.ok(bounds.x + bounds.width <= 1200 && bounds.y + bounds.height <= 700);
});

test('group shout evidence uses parallel non-crossing paths into the final formation', () => {
  const size = 112;
  const workArea = { x: 0, y: 0, width: 1320, height: 720 };
  const targets = [
    { id: 'person-1', x: 417, y: 574 },
    { id: 'person-2', x: 542, y: 574 },
    { id: 'person-4', x: 667, y: 574 },
    { id: 'person-5', x: 792, y: 574 },
    { id: 'person-3', x: 604, y: 437 }
  ];
  const starts = groupShoutEvidenceLayout(targets, workArea, size);
  const byId = new Map(starts.map((point) => [point.id, point]));
  const deltas = targets.map((target) => {
    const start = byId.get(target.id);
    return { x: start.x - target.x, y: start.y - target.y };
  });
  const overlaps = (left, right) => (
    left.x < right.x + size && left.x + size > right.x &&
    left.y < right.y + size && left.y + size > right.y
  );

  assert.ok(Math.hypot(deltas[0].x, deltas[0].y) >= size, 'forming evidence must show visible travel');
  assert.ok(deltas.every((delta) => Math.abs(delta.x - deltas[0].x) < 0.01 && Math.abs(delta.y - deltas[0].y) < 0.01));
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    const frame = targets.map((target) => {
      const start = byId.get(target.id);
      return {
        id: target.id,
        x: start.x + (target.x - start.x) * progress,
        y: start.y + (target.y - start.y) * progress
      };
    });
    for (let left = 0; left < frame.length; left += 1) {
      for (let right = left + 1; right < frame.length; right += 1) {
        assert.equal(overlaps(frame[left], frame[right]), false, `parallel path overlaps at progress ${progress}`);
      }
    }
  }
  for (const start of starts) {
    assert.ok(start.x >= workArea.x && start.y >= workArea.y);
    assert.ok(start.x + size <= workArea.x + workArea.width);
    assert.ok(start.y + size <= workArea.y + workArea.height);
  }
});

test('runtime smoke evidence composites every live pet window instead of capturing only the first one', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const smokeSource = mainSource.slice(mainSource.indexOf('function runSmokeCapture()'));
  const smokeLayoutSource = mainSource.slice(mainSource.indexOf('function stageSmokeLayout()'), mainSource.indexOf('function scenarioDisplay'));

  assert.match(smokeLayoutSource, /broadcastPauseState\(\)/);
  assert.doesNotMatch(smokeLayoutSource, /sendPauseToRenderers/);
  assert.match(smokeSource, /stageSmokeLayout\(\);[\s\S]*capturePetWindowComposition/);
  assert.match(smokeSource, /const display = screen\.getPrimaryDisplay\(\);[\s\S]*capturePetWindowComposition\(display\.workArea\)/);
  assert.doesNotMatch(smokeSource, /petWindows\.values\(\)\.next\(\)\.value/);
});

test('runtime product evidence captures the desktop before deterministic smoke staging', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const smokeSource = mainSource.slice(mainSource.indexOf('async function runSmokeCapture()'));

  assert.match(mainSource, /desktopCapturer/);
  assert.match(smokeSource, /PET_RUNTIME_OUT/);
  assert.match(smokeSource, /PET_RUNTIME_OUT_2/);
  assert.match(smokeSource, /captureDesktopWithPets\([^)]+\)[\s\S]*captureDesktopWithPets\([^)]+\)[\s\S]*stageSmokeLayout\(\)/);
  assert.match(smokeSource, /PET_RUNTIME_EVIDENCE_MANIFEST/);
});

test('runtime product evidence includes a full paused compositor frame', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const smokeSource = mainSource.slice(mainSource.indexOf('async function runSmokeCapture()'));

  assert.match(smokeSource, /PET_RUNTIME_PAUSED_OUT/);
  assert.match(smokeSource, /engine\.togglePause\(\)[\s\S]*broadcastPauseState\(\)[\s\S]*captureDesktopWithPets\(display,\s*validationArea\)/);
  assert.match(smokeSource, /runtimeEvidenceEntry\('normal-paused'/);
});

test('runtime product evidence uses a controlled private validation surface and readable roaming layout', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const smokeSource = mainSource.slice(mainSource.indexOf('async function runSmokeCapture()'));
  const layoutSource = mainSource.slice(mainSource.indexOf('function stageProductEvidenceLayout'), mainSource.indexOf('function stageSmokeLayout'));

  assert.match(mainSource, /function createValidationSurface/);
  assert.match(mainSource, /focusable:\s*false/);
  assert.match(mainSource, /skipTaskbar:\s*true/);
  assert.match(mainSource, /setIgnoreMouseEvents\(true/);
  assert.match(mainSource, /内部验收画布/);
  assert.match(mainSource, /非产品界面/);
  assert.doesNotMatch(mainSource, /RUNTIME VALIDATION SURFACE/);
  assert.match(layoutSource, /runtimeEvidenceMotion\(/);
  assert.match(layoutSource, /engine\.nextTurnAt\s*=\s*Number\.POSITIVE_INFINITY/);
  assert.match(smokeSource, /await showValidationSurface[\s\S]*stageProductEvidenceLayout[\s\S]*captureDesktopWithPets\(display,\s*validationArea\)/);
});

test('scenario compositions come from the desktop compositor over the controlled surface', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const captureSource = mainSource.slice(
    mainSource.indexOf('async function captureScenarioWindows'),
    mainSource.indexOf('function startScenarioTest') > mainSource.indexOf('async function captureScenarioWindows')
      ? mainSource.indexOf('function startScenarioTest')
      : mainSource.indexOf('async function runSmokeCapture')
  );

  assert.match(captureSource, /captureDesktopWithPets\(scenarioTest\.display,\s*scenarioTest\.workArea\)/);
  assert.doesNotMatch(captureSource, /compositeScenarioImages\(compositeItems/);
});

test('scenario capture reasserts every live pet above the validation surface before compositor capture', () => {
  const captureSource = mainSource.slice(
    mainSource.indexOf('async function captureScenarioWindows'),
    mainSource.indexOf('function performanceDuration')
  );
  assert.match(captureSource, /await scenarioTest\.validationReady;[\s\S]*presentValidationSurfaceBehindPets\([\s\S]*validationWindow[\s\S]*petWindows\.values\(\)/);
  assert.match(captureSource, /presentValidationSurfaceBehindPets[\s\S]*await new Promise\(\(resolve\) => setTimeout\(resolve, 80\)\)[\s\S]*captureDesktopWithPets/);
});

test('no-self centipede evidence captures the cursor poop with explicit metadata', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const captureSource = mainSource.slice(
    mainSource.indexOf('async function captureScenarioWindows'),
    mainSource.indexOf('function performanceDuration')
  );

  assert.match(captureSource, /scenarioTest\.scenario\s*===\s*'centipede'[\s\S]*cursorPoopWindow/);
  assert.match(captureSource, /role:\s*'cursor-poop'/);
  assert.match(captureSource, /file:\s*path\.relative\(outputDir,\s*fullPath\)/);
  assert.match(captureSource, /effects/);
  assert.match(captureSource, /frames,\s*\n\s*droppings,\s*\n\s*effects/);
});

test('chase scenario staging keeps the full joke away from the desktop edges', () => {
  assert.match(mainSource, /leader\.x = primary\.workArea\.x \+ Math\.min\(360, primary\.workArea\.width \* 0\.32\)/);
  assert.match(mainSource, /leader\.y = primary\.workArea\.y \+ primary\.workArea\.height \* 0\.24/);
  assert.match(mainSource, /const scenarioTravel = Math\.min\(280, primary\.workArea\.width \* 0\.24\)/);
  assert.match(mainSource, /primary\.workArea\.x \+ 220/);
  assert.match(mainSource, /primary\.workArea\.x \+ primary\.workArea\.width - 220/);
});

test('scenario-only centipede staging recenters an existing connected formation', () => {
  const workArea = { x: 680, y: 300, width: 1200, height: 700 };
  const frames = [
    { x: 1650, y: 722, width: 180, height: 180 },
    { x: 1578, y: 749, width: 180, height: 180 },
    { x: 1507, y: 776, width: 180, height: 180 },
    { x: 1435, y: 802, width: 180, height: 180 },
    { x: 1363, y: 829, width: 180, height: 180 }
  ];

  const offset = centeredFormationOffset(frames, workArea, { x: 0.52, y: 0.52 });
  const moved = frames.map((frame) => ({ ...frame, x: frame.x + offset.x, y: frame.y + offset.y }));
  const left = Math.min(...moved.map((frame) => frame.x));
  const right = Math.max(...moved.map((frame) => frame.x + frame.width));
  const top = Math.min(...moved.map((frame) => frame.y));
  const bottom = Math.max(...moved.map((frame) => frame.y + frame.height));

  assert.ok(left >= workArea.x && right <= workArea.x + workArea.width);
  assert.ok(top >= workArea.y && bottom <= workArea.y + workArea.height);
  assert.ok(Math.abs((left + right) / 2 - (workArea.x + workArea.width * 0.52)) <= 1);
  assert.ok(Math.abs((top + bottom) / 2 - (workArea.y + workArea.height * 0.52)) <= 1);
  assert.match(mainSource, /centeredFormationOffset\(centipedeFrames, primary\.workArea, \{ x: 0\.34, y: 0\.52 \}\)/);
});

test('scenario-only eight-person self-poop staging completes the evidence row before relay activation', () => {
  const scenarioSource = mainSource.slice(mainSource.indexOf('function startScenarioTest'), mainSource.indexOf('function scenarioCursor'));
  const arrangeIndex = scenarioSource.indexOf('engine.arrangePoopChaseRow');
  const toggleIndex = scenarioSource.indexOf('engine.togglePoopChase(initialCursor)');

  assert.ok(arrangeIndex >= 0, 'self-poop evidence must deterministically stage every participant inside the work area');
  assert.ok(toggleIndex > arrangeIndex, 'the relay must start only after the evidence row is staged');
  assert.match(scenarioSource, /engine\.arrangePoopChaseRow\(poopParticipants\.participants, poopParticipants\.settings, primary\)/);
});

test('no-self centipede capture fails closed unless cursor poop is visible in the compositor', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const captureSource = mainSource.slice(
    mainSource.indexOf('async function captureScenarioWindows'),
    mainSource.indexOf('function performanceDuration')
  );

  assert.match(captureSource, /for \(const item of effectImages\)[\s\S]*desktopForegroundRatio\(/);
  assert.match(captureSource, /for \(const item of effectImages\)[\s\S]*desktopPixelMatchRatio\(/);
  assert.match(captureSource, /scenarioTest\.scenario\s*===\s*'centipede'[\s\S]*cursor-poop[\s\S]*Desktop compositor omitted visible cursor poop/);
});

test('scenario milestone capture freezes the ticker until the labeled compositor frame is complete', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const requestSource = mainSource.slice(mainSource.indexOf('function requestScenarioCapture'), mainSource.indexOf('function captureScenarioMilestone'));
  const tickerSource = mainSource.slice(mainSource.indexOf('function runTickerFrame'), mainSource.indexOf('function startTicker'));

  assert.match(requestSource, /scenarioTest\.captureInProgress\s*=\s*true/);
  assert.match(requestSource, /captureScenarioWindows\(label,\s*expectedPhase,\s*evidence\)/);
  assert.match(requestSource, /finally\([\s\S]*scenarioTest\.captureInProgress\s*=\s*false/);
  assert.match(tickerSource, /if \(scenarioTest\?\.captureInProgress\)[\s\S]*scheduleTicker\(16\)[\s\S]*return/);
});

test('relay dropping visual avoids a heavy cartoon sticker outline', () => {
  const poopSvg = fs.readFileSync(fileURLToPath(new URL('../src/assets/effects/poop.svg', import.meta.url)), 'utf8');
  const effectCss = fs.readFileSync(fileURLToPath(new URL('../src/renderer/effect.css', import.meta.url)), 'utf8');
  const effectJs = fs.readFileSync(fileURLToPath(new URL('../src/renderer/effect.js', import.meta.url)), 'utf8');

  assert.match(poopSvg, /radialGradient/);
  assert.doesNotMatch(poopSvg, /stroke-width="[34]"/);
  assert.doesNotMatch(poopSvg, /stroke="#33251f"/);
  assert.match(effectJs, /document\.body\.dataset\.asset\s*=\s*asset/);
  assert.match(effectCss, /body\[data-asset="poop"\]\s+img/);
  assert.doesNotMatch(effectCss, /body\[data-asset="poop"\][\s\S]*rgba\(255,\s*238,\s*185,\s*0\.95\)/);
});

test('relay dropping remains readable without dominating the character scale', () => {
  const config = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../src/config/pet.config.json', import.meta.url)), 'utf8'));
  const behaviors = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../src/config/behaviors.json', import.meta.url)), 'utf8'));
  const minimumReadableSize = Math.round(config.render.spriteSize * 0.40);
  const maximumSubordinateSize = Math.round(config.render.spriteSize * 0.45);

  assert.ok(
    behaviors.poopChase.poopSize >= minimumReadableSize,
    `poopSize ${behaviors.poopChase.poopSize} is too small to read beside a ${config.render.spriteSize}px character`
  );
  assert.ok(
    behaviors.poopChase.poopSize <= maximumSubordinateSize,
    `poopSize ${behaviors.poopChase.poopSize} dominates a ${config.render.spriteSize}px character`
  );
});

test('pet sprite uses the same symmetric window padding as engine anchor coordinates', () => {
  const petCss = fs.readFileSync(fileURLToPath(new URL('../src/renderer/pet.css', import.meta.url)), 'utf8');
  const spriteRule = petCss.match(/#sprite\s*\{([^}]*)\}/s)?.[1] || '';

  assert.match(
    spriteRule,
    /bottom:\s*calc\(\(100%\s*-\s*var\(--sprite-size,\s*112px\)\)\s*\/\s*2\)/,
    'renderer sprite origin must match the symmetric padding used by BehaviorEngine and BrowserWindow placement'
  );
});

test('relay dropping is reasserted above pet windows after it becomes visible', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const start = mainSource.indexOf('function reconcileDroppingWindows');
  const end = mainSource.indexOf('function clearDroppingWindows', start);
  const reconcileSource = mainSource.slice(start, end);

  assert.match(reconcileSource, /presentAlwaysOnTopWindowBounded\(win, true/);
  assert.doesNotMatch(reconcileSource, /presentAlwaysOnTopWindow\(win, true\)/);
});

test('cursor poop is reasserted above pet windows after it becomes visible', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const tickerSource = mainSource.slice(mainSource.indexOf('function runTickerFrame'), mainSource.indexOf('function startTicker'));
  const cursorPoopSource = tickerSource.slice(tickerSource.indexOf('if (nativeWindowUpdatesAllowed && showPoop && poopWindow'), tickerSource.indexOf('recordScenarioSample'));

  assert.match(cursorPoopSource, /presentAlwaysOnTopWindowBounded\(poopWindow, true/);
  assert.doesNotMatch(cursorPoopSource, /presentAlwaysOnTopWindow\(poopWindow, true\)/);
  assert.match(mainSource, /const EFFECT_POSITION_UPDATE_MS\s*=\s*100/);
  assert.match(cursorPoopSource, /updateEffectWindowBounds\(poopWindow,[\s\S]*safeSetPosition\(poopWindow/);
  assert.doesNotMatch(cursorPoopSource, /if \(safeSetPosition\(poopWindow/);
});

test('scenario capture still force-presents effects immediately before compositor evidence', () => {
  const captureSource = mainSource.slice(mainSource.indexOf('async function captureScenarioWindows'), mainSource.indexOf('function performanceDuration'));
  assert.match(captureSource, /for \(const win of droppingWindows\.values\(\)\) presentAlwaysOnTopWindow\(win, true\)/);
  assert.match(captureSource, /presentAlwaysOnTopWindow\(cursorPoopWindow, true\)/);
});

test('centipede tail flies render behind the direction of travel', () => {
  const petSource = fs.readFileSync(fileURLToPath(new URL('../src/renderer/pet.js', import.meta.url)), 'utf8');
  const petCss = fs.readFileSync(fileURLToPath(new URL('../src/renderer/pet.css', import.meta.url)), 'utf8');

  assert.match(petSource, /document\.body\.dataset\.effect\s*=\s*state\.effect\s*\|\|\s*''/);
  assert.match(petSource, /document\.body\.dataset\.direction\s*=\s*state\.direction/);
  assert.match(petCss, /body\[data-effect="flies"\]\[data-direction="right"\]\s+#effect\s*\{[^}]*left:/s);
  assert.match(petCss, /body\[data-effect="flies"\]\[data-direction="left"\]\s+#effect\s*\{[^}]*right:/s);
});

test('group shout bubbles visually escalate across frames and distinguish dad from grandpa', () => {
  const petSource = fs.readFileSync(fileURLToPath(new URL('../src/renderer/pet.js', import.meta.url)), 'utf8');
  const petCss = fs.readFileSync(fileURLToPath(new URL('../src/renderer/pet.css', import.meta.url)), 'utf8');

  assert.match(petSource, /document\.body\.dataset\.action\s*=\s*state\.action\s*\|\|\s*''/);
  assert.match(petSource, /document\.body\.dataset\.shoutFrame\s*=\s*String\(Math\.max\(0, Math\.min\(2, Math\.floor\(state\.frame\s*\|\|\s*0\)\)\)\)/);
  assert.match(petSource, /String\(state\.phrase\s*\|\|\s*''\)\.startsWith\('爷爷'\)/);
  assert.match(petSource, /String\(state\.phrase\s*\|\|\s*''\)\.startsWith\('爸爸'\)/);
  assert.match(petCss, /body\[data-action="shout"\]\[data-shout-frame="1"\]\s+#bubble/s);
  assert.match(petCss, /body\[data-action="shout"\]\[data-shout-frame="2"\]\s+#bubble/s);
  assert.match(petCss, /body\[data-phrase-kind="grandpa"\]\s+#bubble/s);
  assert.match(petCss, /#bubble\s*\{[^}]*max-width:\s*112px[^}]*font-size:\s*16px/s);
  assert.match(petCss, /body\[data-phrase-kind="grandpa"\]\[data-shout-frame="1"\]\s+#sprite/s);
  assert.match(petCss, /body\[data-phrase-kind="grandpa"\]\[data-shout-frame="2"\]\s+#sprite/s);
});

test('grandpa shout adds a visibly different three-beat body rhythm instead of only recoloring dad shout', () => {
  const petCss = fs.readFileSync(fileURLToPath(new URL('../src/renderer/pet.css', import.meta.url)), 'utf8');
  const frames = [...petCss.matchAll(/body\[data-phrase-kind="grandpa"\]\[data-shout-frame="([012])"\]\s+#sprite\s*\{[^}]*transform:\s*([^;]+);/gs)]
    .map((match) => ({ frame: Number(match[1]), transform: match[2] }))
    .sort((left, right) => left.frame - right.frame);

  assert.equal(frames.length, 3, 'grandpa shout needs an explicit body transform for all three beats');
  assert.equal(new Set(frames.map((frame) => frame.transform)).size, 3, 'grandpa beats must use visibly distinct body transforms');
  const values = frames.map(({ transform }) => ({
    rotate: Number(transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1]),
    translateY: Number(transform.match(/translateY\((-?[\d.]+)px\)/)?.[1]),
    scale: Number(transform.match(/scale\(([\d.]+)\)/)?.[1])
  }));
  assert.ok(values.every((value) => Object.values(value).every(Number.isFinite)), 'each grandpa beat must declare rotation, vertical travel, and scale');
  assert.ok(Math.max(...values.map((value) => value.rotate)) - Math.min(...values.map((value) => value.rotate)) >= 14, 'grandpa rhythm needs a visible left-right swing');
  assert.ok(Math.max(...values.map((value) => value.translateY)) - Math.min(...values.map((value) => value.translateY)) >= 12, 'grandpa rhythm needs visible vertical travel');
  assert.ok(Math.max(...values.map((value) => value.scale)) - Math.min(...values.map((value) => value.scale)) >= 0.2, 'grandpa rhythm needs visible size escalation');
});

test('scenario capture waits for every renderer sprite to finish loading before saving a frame', () => {
  const petSource = fs.readFileSync(fileURLToPath(new URL('../src/renderer/pet.js', import.meta.url)), 'utf8');
  assert.match(petSource, /dataset\.spriteReady\s*=\s*'false'/);
  assert.match(petSource, /dataset\.spriteReady\s*=\s*'true'/);
  assert.match(mainSource, /waitForScenarioSprites/);
  assert.match(mainSource, /spriteReady\s*===\s*'true'/);
});

test('self-poop scenario captures a real eating climax instead of only a generic chase frame', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const milestoneSource = mainSource.slice(mainSource.indexOf('function captureScenarioMilestone'), mainSource.indexOf('function scenarioCompositionBounds'));

  assert.match(milestoneSource, /scenarioTest\.scenario\s*===\s*'poop-chase'[\s\S]*pet\.action\.startsWith\('eat_'\)[\s\S]*pet\.effect\s*===\s*'stink'[\s\S]*requestScenarioCapture\(`eating-\$\{eater\.id\}`/);
});

test('sequence evidence records two cursor-centipede compositions at distinct chase positions', () => {
  const milestoneSource = mainSource.slice(mainSource.indexOf('function captureScenarioMilestone'), mainSource.indexOf('function scenarioCompositionBounds'));
  const captureSource = mainSource.slice(mainSource.indexOf('async function captureScenarioWindows'), mainSource.indexOf('function performanceDuration'));
  const helperSource = fs.readFileSync(fileURLToPath(new URL('../src/scenario-capture.js', import.meta.url)), 'utf8');

  assert.match(milestoneSource, /scenarioTest\.scenario\s*===\s*'centipede'[\s\S]*centipedeCaptureMilestone\([\s\S]*requestScenarioCapture\(milestone\.label/);
  assert.match(helperSource, /centipede-early[\s\S]*centipede-late/);
  assert.match(helperSource, /kind:\s*'cursor-centipede'[\s\S]*cursor:[\s\S]*leaderPosition:/);
  assert.match(captureSource, /evidence:\s*evidence/);
  assert.match(captureSource, /schemaVersion:\s*3/);
});

test('cursor-centipede sequence compositions keep one fixed viewport instead of recropping around each frame', () => {
  const captureSource = mainSource.slice(mainSource.indexOf('async function captureScenarioWindows'), mainSource.indexOf('function performanceDuration'));

  assert.match(captureSource, /const compositionBounds\s*=\s*\{\s*\.\.\.scenarioTest\.workArea\s*\}/);
  assert.match(captureSource, /compositeScenarioImages\(\s*compositeItems,\s*compositionBounds\s*\)/);
  assert.match(captureSource, /compositionBounds:\s*compositionBounds/);
  assert.doesNotMatch(captureSource, /scenarioCompositionBounds\(compositeItems,\s*scenarioTest\.workArea\)/);
});

test('sequence evidence names every eating climax by eater and records a return handoff', () => {
  const milestoneSource = mainSource.slice(mainSource.indexOf('function captureScenarioMilestone'), mainSource.indexOf('function scenarioCompositionBounds'));

  assert.match(milestoneSource, /`eating-\$\{eater\.id\}`/);
  assert.match(milestoneSource, /kind:\s*'eating-climax'[\s\S]*eaterId:\s*eater\.id/);
  assert.match(milestoneSource, /kind:\s*'handoff-return'[\s\S]*returningEaterId:[\s\S]*nextEaterId:/);
});

test('failed milestone capture becomes retryable and successful retry clears stale error evidence', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const requestSource = mainSource.slice(mainSource.indexOf('function requestScenarioCapture'), mainSource.indexOf('function captureScenarioMilestone'));

  assert.match(requestSource, /capturedLabels\.delete\(key\)/);
  assert.match(requestSource, /const errorFile\s*=\s*path\.join\([^;]*capture-[^;]*error\.txt[^;]*\);[\s\S]*fs\.rmSync\(errorFile,\s*\{\s*force:\s*true\s*\}\)/);
});

test('pet bootstrap carries an initial engine state so startup captures cannot freeze an empty sprite', () => {
  const mainSource = fs.readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
  const petSource = fs.readFileSync(fileURLToPath(new URL('../src/renderer/pet.js', import.meta.url)), 'utf8');
  const bootstrapSource = mainSource.slice(mainSource.indexOf("ipcMain.handle('pet:get-bootstrap'"), mainSource.indexOf("ipcMain.on('pet:set-interactive'"));

  assert.match(bootstrapSource, /state:\s*engine\.snapshot\(\)\.pets\.find\(\(pet\)\s*=>\s*pet\.id\s*===\s*authorized\.id\)/);
  assert.match(petSource, /if\s*\(bootstrap\.state\)\s*updateState\(bootstrap\.state\)/);
});

test('renderer makes shout escalation, the selected recipient, and the eating climax visually explicit', () => {
  const petSource = fs.readFileSync(fileURLToPath(new URL('../src/renderer/pet.js', import.meta.url)), 'utf8');
  const petCss = fs.readFileSync(fileURLToPath(new URL('../src/renderer/pet.css', import.meta.url)), 'utf8');

  assert.match(petSource, /dataset\.shoutRecipient\s*=\s*String\(Boolean\(state\.shoutRecipient\)\)/);
  assert.match(petSource, /shoutText\(/);
  assert.match(petCss, /data-shout-recipient="true"[\s\S]*scale\(1\.4[0-9]?\)/);
  assert.match(petCss, /data-shout-recipient="true"[\s\S]*content:\s*"👑 本人"/);
  assert.match(petCss, /data-action\^="eat_"[\s\S]*#bubble/);
});
