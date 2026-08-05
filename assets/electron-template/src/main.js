'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { monitorEventLoopDelay, performance: nodePerformance } = require('node:perf_hooks');
const zlib = require('node:zlib');
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  Tray
} = require('electron');
const { BehaviorEngine } = require('./behavior-engine');
const {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  PERFORMANCE_FINGERPRINT_SCHEMA_VERSION,
  PERFORMANCE_METRIC_SOURCE,
  PERFORMANCE_REPORT_SCHEMA_VERSION,
  compensatedTickerDelay,
  evaluatePerformanceReport,
  nextTickerSchedule,
  nextTickerDelay,
  petRenderKey,
  runtimeFingerprintForProject,
  summarizePerformancePhase,
  summarizeProcessLifecycle
} = require('./performance-audit');
const { fitCaptureToLogicalBounds } = require('./scenario-capture');
const { authorizePetEvent, denySessionPermissions, hardenWebContents } = require('./security');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'pet.config.json'), 'utf8'));
const behaviors = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'behaviors.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'sprites', 'manifest.json'), 'utf8'));
const PET_PAGE = path.join(__dirname, 'renderer', 'index.html');
const EFFECT_PAGE = path.join(__dirname, 'renderer', 'effect.html');

let engine;
let tray;
let cursorPoopWindow;
let droppingPoopWindow;
let ticker;
let tickerDeadline = null;
let previousTick = Date.now();
let quitting = false;
let scenarioTest = null;
let performanceAudit = null;
const petWindows = new Map();
const droppingWindows = new Map();
const dragStates = new Map();
const positionWarnings = new Map();
const visiblePetIds = new Set();
const presentedPetIds = new Set();
const MIN_WINDOW_COORDINATE = -2147483648;
const MAX_WINDOW_COORDINATE = 2147483647;

function publicErrorMessage(error) {
  return String(error?.message || error || 'Unknown runtime capture error.')
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'`<>]*/g, '[redacted-path]')
    .replace(/\\\\[^\s"'`<>]+/g, '[redacted-path]')
    .replace(/\/(?:Users|home)\/[^\s"'`<>]*/g, '[redacted-path]')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function warnPosition(label, message) {
  const now = Date.now();
  if (now - (positionWarnings.get(label) || 0) < 5000) return;
  positionWarnings.set(label, now);
  console.error(`[window-position:${label}] ${message}`);
}

function safeSetPosition(win, x, y, label, width, height) {
  if (!win || win.isDestroyed()) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    warnPosition(label, `Skipped non-finite bounds x=${x}, y=${y}, width=${width}, height=${height}`);
    return false;
  }
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  if (roundedX < MIN_WINDOW_COORDINATE || roundedX > MAX_WINDOW_COORDINATE || roundedY < MIN_WINDOW_COORDINATE || roundedY > MAX_WINDOW_COORDINATE) {
    warnPosition(label, `Skipped out-of-range coordinates x=${roundedX}, y=${roundedY}`);
    return false;
  }
  try {
    win.setBounds({ x: roundedX, y: roundedY, width, height }, false);
    return true;
  } catch (error) {
    warnPosition(label, error?.stack || error?.message || String(error));
    return false;
  }
}

function smokeDelay(name, fallback, minimum = 100) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? Math.round(value) : fallback;
}

function exitAutomatedTest(exitCode = 0) {
  if (quitting) return;
  quitting = true;
  if (ticker) clearTimeout(ticker);
  globalShortcut.unregisterAll();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }
  app.exit(exitCode);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createTrayImage() {
  const width = 24;
  const height = 24;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = [0];
    for (let x = 0; x < width; x += 1) {
      const dx = x - 12;
      const dy = y - 13;
      const inside = (dx * dx) / 85 + (dy * dy) / 70 < 1 || (x > 8 && x < 16 && y > 4 && y < 14);
      const highlight = inside && x < 10 && y < 12;
      row.push(inside ? (highlight ? 164 : 111) : 0, inside ? (highlight ? 105 : 67) : 0, inside ? (highlight ? 65 : 40) : 0, inside ? 255 : 0);
    }
    rows.push(Buffer.from(row));
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return nativeImage.createFromBuffer(Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0))
  ])).resize({ width: 18, height: 18 });
}

function displays() {
  return screen.getAllDisplays().map((display) => ({ id: display.id, workArea: display.workArea }));
}

function petFromEvent(event) {
  return authorizePetEvent(event, petWindows, PET_PAGE);
}

function setWindowInteractive(win, interactive) {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
}

function createPetWindow(character) {
  const size = config.render.windowSize;
  const win = new BrowserWindow({
    width: size,
    height: size,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });
  hardenWebContents(win.webContents, PET_PAGE);
  if (config.render.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  let shown = false;
  const showWindow = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    setWindowInteractive(win, false);
    win.showInactive();
    visiblePetIds.add(character.id);
    win.webContents.send('pet:present-request');
  };
  win.once('ready-to-show', showWindow);
  const entry = { win, interactive: false, lastBounds: null, lastRenderKey: null };
  win.loadFile(PET_PAGE);
  win.on('closed', () => petWindows.delete(character.id));
  petWindows.set(character.id, entry);
}

function createEffectWindow(asset, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false }
  });
  hardenWebContents(win.webContents, EFFECT_PAGE);
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setIgnoreMouseEvents(true, { forward: false });
  win.loadFile(EFFECT_PAGE, { query: { asset } });
  return win;
}

function createCursorPoopWindow() {
  const size = Math.max(28, config.render.effectSize + 8);
  cursorPoopWindow = createEffectWindow('poop', size);
  return cursorPoopWindow;
}

function ensureCursorPoopWindow() {
  return !cursorPoopWindow || cursorPoopWindow.isDestroyed() ? createCursorPoopWindow() : cursorPoopWindow;
}

function createDroppingPoopWindow() {
  const size = behaviors.poopChase?.poopSize || 26;
  droppingPoopWindow = createEffectWindow('poop', size);
  return droppingPoopWindow;
}

function ensureDroppingPoopWindow() {
  return !droppingPoopWindow || droppingPoopWindow.isDestroyed() ? createDroppingPoopWindow() : droppingPoopWindow;
}

function reconcileDroppingWindows(droppings) {
  const dropping = droppings[0];
  droppingWindows.clear();
  if (!dropping) {
    if (droppingPoopWindow && !droppingPoopWindow.isDestroyed() && droppingPoopWindow.isVisible()) droppingPoopWindow.hide();
    return;
  }
  const size = behaviors.poopChase?.poopSize || 26;
  const win = ensureDroppingPoopWindow();
  droppingWindows.set(dropping.id, win);
  if (!safeSetPosition(win, dropping.x - size / 2, dropping.y - size / 2, `dropping:${dropping.id}`, size, size)) {
    if (win.isVisible()) win.hide();
    return;
  }
  if (!win.webContents.isLoading() && !win.isVisible()) win.showInactive();
}

function clearDroppingWindows() {
  droppingWindows.clear();
  if (droppingPoopWindow && !droppingPoopWindow.isDestroyed() && droppingPoopWindow.isVisible()) droppingPoopWindow.hide();
}

function toggleCentipede() {
  engine.toggleCentipede(screen.getCursorScreenPoint());
  refreshTrayMenu();
}

function togglePoopChase() {
  engine.togglePoopChase(screen.getCursorScreenPoint());
  refreshTrayMenu();
}

function broadcastPauseState() {
  for (const entry of petWindows.values()) {
    if (!entry.win.isDestroyed() && !entry.win.webContents.isLoading()) entry.win.webContents.send('pet:paused', engine.paused);
  }
}

function togglePause() {
  engine.togglePause();
  broadcastPauseState();
  previousTick = Date.now();
  if (ticker) clearTimeout(ticker);
  ticker = null;
  scheduleTicker(engine.paused ? nextTickerDelay(true) : 0);
  refreshTrayMenu();
}

function menuTemplate() {
  return [
    { label: '参与人物叫爸爸', accelerator: behaviors.hotkeys.dad, click: () => engine.callDad() },
    { label: '参与人物叫爷爷', accelerator: behaviors.hotkeys.grandpa, click: () => engine.callGrandpa() },
    { type: 'separator' },
    { label: engine.mode === 'centipede' ? '退出人体蜈蚣模式' : '人体蜈蚣模式', accelerator: behaviors.hotkeys.centipede, click: toggleCentipede },
    {
      label: engine.mode === 'poopChase' ? '退出接力模式' : '接力模式',
      accelerator: behaviors.hotkeys.poopChase,
      enabled: Boolean(behaviors.poopChase?.enabled),
      click: togglePoopChase
    },
    { label: engine.paused ? '继续' : '暂停', accelerator: behaviors.hotkeys.pause, click: togglePause },
    { label: '重新散开', click: () => engine.respawn() },
    { type: 'separator' },
    { label: '退出桌宠', click: () => { quitting = true; app.quit(); } }
  ];
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip(config.app.name);
  refreshTrayMenu();
  tray.on('click', togglePause);
}

function registerShortcuts() {
  const registrations = [
    [behaviors.hotkeys.dad, () => engine.callDad()],
    [behaviors.hotkeys.grandpa, () => engine.callGrandpa()],
    [behaviors.hotkeys.centipede, toggleCentipede],
    [behaviors.hotkeys.poopChase, togglePoopChase],
    [behaviors.hotkeys.pause, togglePause]
  ];
  for (const [accelerator, callback] of registrations) {
    if (!accelerator) continue;
    if (!globalShortcut.register(accelerator, callback)) console.warn(`Global shortcut unavailable: ${accelerator}`);
  }
}


function stageGroupShoutScenario(primary) {
  const size = config.render.spriteSize;
  const width = Math.max(1, primary.workArea.width - size);
  const height = Math.max(1, primary.workArea.height - size);
  const points = [
    [0.04, 0.12],
    [0.82, 0.25],
    [0.18, 0.55],
    [0.68, 0.72],
    [0.46, 0.06]
  ];
  engine.pets.forEach((pet, index) => {
    const point = points[index % points.length];
    pet.x = primary.workArea.x + width * point[0];
    pet.y = primary.workArea.y + height * point[1];
    pet.vx = 0;
    pet.vy = 0;
    pet.direction = index % 2 ? 'left' : 'right';
    pet.action = pet.direction === 'right' ? 'idle_right' : 'idle_left';
    pet.frame = 0;
    pet.phrase = '';
    pet.phraseUntil = 0;
  });
}

function startScenarioTest() {
  const scenario = process.env.PET_SCENARIO_TEST;
  const groupShout = scenario === 'dad-shout' || scenario === 'grandpa-shout';
  if (!groupShout && scenario !== 'poop-chase' && scenario !== 'centipede') return;
  engine.nextDadAt = Number.POSITIVE_INFINITY;
  const primary = screen.getPrimaryDisplay();
  const direction = process.env.PET_SCENARIO_DIRECTION === 'left' ? 'left' : 'right';
  const size = config.render.spriteSize;
  let leader;
  let originCursor;
  let targetCursor;
  let expectedPhrase = null;
  let expectedOrder = [];
  let recipientId = null;
  let participantIds = [];
  let excludedIds = [];
  let skippedReason = null;

  if (groupShout) {
    stageGroupShoutScenario(primary);
    expectedPhrase = scenario === 'dad-shout' ? behaviors.phrases.dad : behaviors.phrases.grandpa;
    const shoutResult = scenario === 'dad-shout' ? engine.callDad() : engine.callGrandpa();
    recipientId = shoutResult.recipientId;
    participantIds = [...shoutResult.participantIds];
    excludedIds = [...shoutResult.excludedIds];
    skippedReason = shoutResult.skippedReason;
    expectedOrder = [...participantIds];
    leader = engine.pets.find((pet) => pet.id === participantIds[0]) || null;
    originCursor = {
      x: primary.workArea.x + primary.workArea.width / 2,
      y: primary.workArea.y + primary.workArea.height / 2
    };
    targetCursor = { ...originCursor };
  } else {
    const poopParticipants = scenario === 'poop-chase' ? engine.poopChaseParticipants() : null;
    leader = scenario === 'poop-chase' ? poopParticipants.leader : engine.pets[0];
    const followers = scenario === 'poop-chase' ? poopParticipants.followers : engine.pets.slice(1);
    if (!leader || !followers.length || (scenario === 'poop-chase' && !poopParticipants.settings.enabled)) return;
    const rightHead = engine.anchorsFor(leader, 'right').head;
    const leftHead = engine.anchorsFor(leader, 'left').head;
    const followAnchor = { x: (rightHead[0] + leftHead[0]) / 2, y: (rightHead[1] + leftHead[1]) / 2 };
    leader.x = primary.workArea.x + Math.min(520, primary.workArea.width * 0.48);
    leader.y = primary.workArea.y + primary.workArea.height * 0.48;
    leader.direction = direction;
    const initialCursor = { x: leader.x + followAnchor.x * size, y: leader.y + followAnchor.y * size };
    if (scenario === 'poop-chase') engine.togglePoopChase(initialCursor);
    else engine.toggleCentipede(initialCursor);
    originCursor = { x: leader.x + followAnchor.x * size, y: leader.y + followAnchor.y * size };
    targetCursor = {
      x: direction === 'left'
        ? Math.max(primary.workArea.x + 140, originCursor.x - 360)
        : Math.min(primary.workArea.x + primary.workArea.width - 140, originCursor.x + 360),
      y: originCursor.y
    };
  }

  scenarioTest = {
    scenario,
    leaderId: leader?.id || null,
    startedAt: Date.now(),
    lastSampleAt: Number.NEGATIVE_INFINITY,
    direction,
    originCursor,
    targetCursor,
    expectedPhrase,
    expectedOrder,
    recipientId,
    participantIds,
    excludedIds,
    skippedReason,
    workArea: primary.workArea,
    samples: [],
    captures: [],
    capturedLabels: new Set(),
    capturePromises: []
  };
  const captureAtMs = Math.max(500, Number.parseInt(process.env.PET_SCENARIO_CAPTURE_AT_MS || '2500', 10));
  if (!groupShout && process.env.PET_SCENARIO_CAPTURE_DIR) {
    setTimeout(() => requestScenarioCapture(null), captureAtMs).unref();
  }
  const fallbackDuration = groupShout ? 12000 : 6000;
  const durationMs = Math.max(3000, Number.parseInt(process.env.PET_SCENARIO_DURATION_MS || String(fallbackDuration), 10));
  setTimeout(async () => {
    if (ticker) {
      clearTimeout(ticker);
      ticker = null;
    }
    await Promise.allSettled(scenarioTest?.capturePromises || []);
    const output = process.env.PET_SCENARIO_OUT;
    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const report = {
        scenario,
        direction,
        originCursor,
        targetCursor,
        expectedPhrase,
        expectedOrder,
        recipientId,
        participantIds,
        excludedIds,
        skippedReason,
        captures: scenarioTest?.captures || [],
        samples: scenarioTest?.samples || []
      };
      fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    exitAutomatedTest();
  }, durationMs).unref();
}

function scenarioCursor() {
  if (!scenarioTest) return null;
  if (scenarioTest.scenario === 'dad-shout' || scenarioTest.scenario === 'grandpa-shout') {
    return { ...scenarioTest.targetCursor };
  }
  const elapsed = (Date.now() - scenarioTest.startedAt) / 1000;
  const ratio = Math.min(1, elapsed / 1.2);
  return {
    x: scenarioTest.originCursor.x + (scenarioTest.targetCursor.x - scenarioTest.originCursor.x) * ratio,
    y: scenarioTest.originCursor.y + (scenarioTest.targetCursor.y - scenarioTest.originCursor.y) * ratio
  };
}

function recordScenarioSample(snapshot, cursor) {
  if (!scenarioTest) return;
  const elapsed = (Date.now() - scenarioTest.startedAt) / 1000;
  if (elapsed - scenarioTest.lastSampleAt < 0.1) return;
  scenarioTest.lastSampleAt = elapsed;
  const leader = snapshot.pets.find((pet) => pet.id === scenarioTest.leaderId);
  scenarioTest.samples.push({
    elapsed: Number(elapsed.toFixed(3)),
    phase: snapshot.shoutPhase || snapshot.mode,
    cursor: { x: Math.round(cursor.x), y: Math.round(cursor.y) },
    leader: leader ? {
      x: Number(leader.x.toFixed(2)),
      y: Number(leader.y.toFixed(2)),
      vx: Number(leader.vx.toFixed(2)),
      vy: Number(leader.vy.toFixed(2)),
      direction: leader.direction,
      action: leader.action,
      frame: Number(leader.frame.toFixed(2)),
      phrase: leader.phrase
    } : null,
    pets: snapshot.pets.map((pet) => ({
      id: pet.id,
      x: Number(pet.x.toFixed(2)),
      y: Number(pet.y.toFixed(2)),
      vx: Number(pet.vx.toFixed(2)),
      vy: Number(pet.vy.toFixed(2)),
      direction: pet.direction,
      action: pet.action,
      frame: Number(pet.frame.toFixed(2)),
      phrase: pet.phrase
    })),
    droppings: snapshot.droppings.map((dropping) => ({
      id: dropping.id,
      sourceId: dropping.sourceId,
      targetId: dropping.targetId,
      x: Number(dropping.x.toFixed(2)),
      y: Number(dropping.y.toFixed(2)),
      approachedTarget: dropping.approachedTarget,
      eatenBy: dropping.eatenBy
    })),
    droppingWindows: {
      count: droppingWindows.size,
      visible: [...droppingWindows.values()].filter((win) => !win.isDestroyed() && win.isVisible()).length
    }
  });
}

function requestScenarioCapture(label) {
  if (!scenarioTest || !process.env.PET_SCENARIO_CAPTURE_DIR) return;
  const key = label || 'active';
  if (scenarioTest.capturedLabels.has(key)) return;
  scenarioTest.capturedLabels.add(key);
  const promise = new Promise((resolve) => setTimeout(resolve, 80))
    .then(() => captureScenarioWindows(label))
    .catch((error) => {
      const outputDir = process.env.PET_SCENARIO_CAPTURE_DIR;
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, `capture-${key}-error.txt`), `${publicErrorMessage(error)}\n`, 'utf8');
    });
  scenarioTest.capturePromises.push(promise);
}

function captureScenarioMilestone(snapshot) {
  if (!scenarioTest || !process.env.PET_SCENARIO_CAPTURE_DIR) return;
  if (scenarioTest.scenario !== 'dad-shout' && scenarioTest.scenario !== 'grandpa-shout') return;
  const elapsed = (Date.now() - scenarioTest.startedAt) / 1000;
  if (snapshot.shoutPhase === 'forming') {
    if (elapsed >= 0.5) requestScenarioCapture('forming-early');
    if (elapsed >= 2.0) requestScenarioCapture('forming-late');
    return;
  }
  if (snapshot.shoutPhase === 'kneeling') {
    requestScenarioCapture('kneeling');
    return;
  }
  if (snapshot.shoutPhase === 'shouting') {
    const participant = snapshot.pets.find((pet) => scenarioTest.participantIds.includes(pet.id));
    if (!participant) return;
    const frame = Math.max(0, Math.min(2, Math.floor(participant.frame || 0)));
    requestScenarioCapture(`shout-${frame}`);
  }
}

function scenarioCompositionBounds(items, workArea) {
  const margin = 48;
  if (!items.length) return { ...workArea };
  const minX = Math.max(workArea.x, Math.min(...items.map((item) => item.bounds.x)) - margin);
  const minY = Math.max(workArea.y, Math.min(...items.map((item) => item.bounds.y)) - margin);
  const maxX = Math.min(workArea.x + workArea.width, Math.max(...items.map((item) => item.bounds.x + item.bounds.width)) + margin);
  const maxY = Math.min(workArea.y + workArea.height, Math.max(...items.map((item) => item.bounds.y + item.bounds.height)) + margin);
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function compositeScenarioImages(items, workArea) {
  const width = Math.max(1, Math.round(workArea.width));
  const height = Math.max(1, Math.round(workArea.height));
  const bitmap = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    bitmap[offset] = 246;
    bitmap[offset + 1] = 246;
    bitmap[offset + 2] = 246;
    bitmap[offset + 3] = 255;
  }
  for (const item of items) {
    const source = item.image.toBitmap();
    const sourceSize = item.image.getSize();
    const offsetX = Math.round(item.bounds.x - workArea.x);
    const offsetY = Math.round(item.bounds.y - workArea.y);
    for (let y = 0; y < sourceSize.height; y += 1) {
      const targetY = offsetY + y;
      if (targetY < 0 || targetY >= height) continue;
      for (let x = 0; x < sourceSize.width; x += 1) {
        const targetX = offsetX + x;
        if (targetX < 0 || targetX >= width) continue;
        const sourceOffset = (y * sourceSize.width + x) * 4;
        const alpha = source[sourceOffset + 3] / 255;
        if (alpha <= 0) continue;
        const targetOffset = (targetY * width + targetX) * 4;
        const inverse = 1 - alpha;
        bitmap[targetOffset] = Math.min(255, Math.round(source[sourceOffset] + bitmap[targetOffset] * inverse));
        bitmap[targetOffset + 1] = Math.min(255, Math.round(source[sourceOffset + 1] + bitmap[targetOffset + 1] * inverse));
        bitmap[targetOffset + 2] = Math.min(255, Math.round(source[sourceOffset + 2] + bitmap[targetOffset + 2] * inverse));
      }
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 }).toPNG();
}

async function captureScenarioWindows(label = null) {
  const outputDir = process.env.PET_SCENARIO_CAPTURE_DIR;
  if (!outputDir || !scenarioTest) return;
  const captureDir = label ? path.join(outputDir, label) : outputDir;
  fs.mkdirSync(captureDir, { recursive: true });
  const frames = [];
  const compositeItems = [];
  for (const [id, entry] of petWindows) {
    if (entry.win.isDestroyed()) continue;
    const image = await entry.win.webContents.capturePage();
    const file = `${id}.png`;
    const fullPath = path.join(captureDir, file);
    fs.writeFileSync(fullPath, image.toPNG());
    const bounds = entry.win.getBounds();
    frames.push({
      id,
      file: path.relative(outputDir, fullPath).split(path.sep).join('/'),
      bounds,
      visible: entry.win.isVisible()
    });
    compositeItems.push({ image: fitCaptureToLogicalBounds(image, bounds), bounds });
  }
  const droppings = [];
  for (const [id, win] of [...droppingWindows]) {
    if (win.isDestroyed()) continue;
    const image = await win.webContents.capturePage();
    const file = `dropping-${id}.png`;
    const fullPath = path.join(captureDir, file);
    fs.writeFileSync(fullPath, image.toPNG());
    const bounds = win.getBounds();
    droppings.push({
      id,
      file: path.relative(outputDir, fullPath).split(path.sep).join('/'),
      bounds,
      visible: win.isVisible()
    });
    compositeItems.push({ image: fitCaptureToLogicalBounds(image, bounds), bounds });
  }
  const compositionFile = label ? `${label}.png` : 'composition.png';
  fs.writeFileSync(path.join(outputDir, compositionFile), compositeScenarioImages(compositeItems, scenarioCompositionBounds(compositeItems, scenarioTest.workArea)));
  const capture = {
    label: label || 'active',
    phase: engine.snapshot().shoutPhase || engine.mode,
    capturedAt: Date.now(),
    composition: compositionFile,
    frames,
    droppings
  };
  scenarioTest.captures.push(capture);
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 2,
    scenario: scenarioTest.scenario,
    direction: scenarioTest.direction,
    captures: scenarioTest.captures
  }, null, 2)}\n`, 'utf8');
}

function performanceDuration(name, fallback, minimum = 1000) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? Math.round(value) : fallback;
}

function waitForPerformance(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function performanceCursor() {
  if (!performanceAudit || !['centipede', 'poop-chase'].includes(performanceAudit.cursorMode)) return null;
  const workArea = screen.getPrimaryDisplay().workArea;
  const elapsed = (nodePerformance.now() - performanceAudit.cursorStartedAt) / 1000;
  return {
    x: workArea.x + workArea.width / 2 + Math.cos(elapsed * 0.9) * Math.min(320, workArea.width * 0.28),
    y: workArea.y + workArea.height / 2 + Math.sin(elapsed * 0.7) * Math.min(140, workArea.height * 0.18)
  };
}

function recordPerformanceTick(now) {
  const phase = performanceAudit?.current;
  if (!phase) return;
  if (phase.lastTickAt !== null) phase.frameIntervalsMs.push(now - phase.lastTickAt);
  phase.lastTickAt = now;
}

function effectRendererSnapshot() {
  return [
    ['cursor-poop', cursorPoopWindow],
    ['dropping-poop', droppingPoopWindow]
  ].flatMap(([role, win]) => {
    if (!win || win.isDestroyed()) return [];
    return [{ role, pid: win.webContents.getOSProcessId(), visible: win.isVisible() }];
  });
}

function visibleEffectWindows() {
  return effectRendererSnapshot().filter((entry) => entry.visible).length;
}

function performanceStateFingerprint() {
  const snapshot = engine.snapshot();
  return crypto.createHash('sha256').update(JSON.stringify({
    mode: snapshot.mode,
    pets: snapshot.pets.map(({ id, x, y, action, frame, phrase }) => ({ id, x: roundCoordinate(x), y: roundCoordinate(y), action, frame: Math.floor(frame), phrase })),
    droppings: snapshot.droppings.map(({ id, sourceId, targetId, x, y }) => ({ id, sourceId, targetId, x: roundCoordinate(x), y: roundCoordinate(y) })),
    effects: effectRendererSnapshot().map(({ role, pid, visible }) => ({ role, pid, visible }))
  })).digest('hex');
}

function roundCoordinate(value) {
  return Number(Number(value).toFixed(3));
}

function samplePerformanceMetrics() {
  const phase = performanceAudit?.current;
  if (!phase) return;
  const now = nodePerformance.now();
  const metrics = app.getAppMetrics();
  const cpuPercent = metrics.reduce((sum, metric) => sum + (Number(metric.cpu?.percentCPUUsage) || 0), 0);
  const workingSetMb = metrics.reduce((sum, metric) => sum + (Number(metric.memory?.workingSetSize) || 0), 0) / 1024;
  const privateMemoryMb = metrics.reduce((sum, metric) => sum + (Number(metric.memory?.privateBytes) || 0), 0) / 1024;
  phase.processSamples.push({
    atMs: now - phase.startedAt,
    cpuPercent,
    workingSetMb,
    privateMemoryMb,
    processes: metrics.map((metric) => ({
      pid: Number(metric.pid),
      creationTime: Number(metric.creationTime),
      type: metric.type,
      serviceName: metric.serviceName,
      name: metric.name
    })),
    effectRenderers: effectRendererSnapshot()
  });
  const eventLoopMaxMs = performanceAudit.eventLoop.max / 1e6;
  if (Number.isFinite(eventLoopMaxMs)) phase.eventLoopDelaysMs.push(eventLoopMaxMs);
  performanceAudit.eventLoop.reset();
}

function beginPerformancePhase(name) {
  performanceAudit.eventLoop.reset();
  performanceAudit.current = {
    name,
    startedAt: nodePerformance.now(),
    lastTickAt: null,
    frameIntervalsMs: [],
    eventLoopDelaysMs: [],
    processSamples: []
  };
  samplePerformanceMetrics();
}

function endPerformancePhase() {
  if (!performanceAudit?.current) return null;
  samplePerformanceMetrics();
  const phase = performanceAudit.current;
  performanceAudit.current = null;
  const summary = summarizePerformancePhase({
    durationMs: nodePerformance.now() - phase.startedAt,
    frameIntervalsMs: phase.frameIntervalsMs,
    eventLoopDelaysMs: phase.eventLoopDelaysMs,
    processSamples: phase.processSamples
  });
  performanceAudit.phases[phase.name] = summary;
  writePerformanceCheckpoint();
  return summary;
}

async function waitForVisiblePetWindows() {
  const deadline = nodePerformance.now() + 15000;
  while (presentedPetIds.size < config.characters.length && nodePerformance.now() < deadline) {
    await waitForPerformance(100);
  }
  if (presentedPetIds.size !== config.characters.length || performanceAudit.startupVisibleMs === null) {
    throw new Error('Not every pet window reported a presented frame before the startup deadline.');
  }
}

function performanceCenterCursor() {
  const workArea = screen.getPrimaryDisplay().workArea;
  return { x: workArea.x + workArea.width / 2, y: workArea.y + workArea.height / 2 };
}

function writePerformanceJson(report) {
  fs.mkdirSync(path.dirname(performanceAudit.output), { recursive: true });
  const temporary = `${performanceAudit.output}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.rmSync(performanceAudit.output, { force: true });
  fs.renameSync(temporary, performanceAudit.output);
}

function performanceReportBase(status) {
  return {
    schemaVersion: PERFORMANCE_REPORT_SCHEMA_VERSION,
    fingerprintSchemaVersion: PERFORMANCE_FINGERPRINT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    platform: process.platform,
    arch: process.arch,
    runtime: performanceAudit.runtime,
    metricSource: PERFORMANCE_METRIC_SOURCE,
    runtimeFingerprint: performanceAudit.runtimeFingerprint,
    thresholds: DEFAULT_PERFORMANCE_THRESHOLDS,
    startupMeasurement: {
      start: 'runner-before-executable-spawn',
      end: 'all-pet-windows-presented'
    },
    startupVisibleMs: performanceAudit.startupVisibleMs,
    expectedWindowCount: config.characters.length,
    windowCount: presentedPetIds.size,
    phases: performanceAudit.phases,
    processLifecycle: summarizeProcessLifecycle(performanceAudit.phases)
  };
}

function writePerformanceCheckpoint() {
  if (!performanceAudit?.output) return;
  writePerformanceJson(performanceReportBase('running'));
}

function stopSpecialModeForPerformance() {
  if (engine.mode === 'centipede') {
    const exitShout = behaviors.centipede.exitShout;
    behaviors.centipede.exitShout = false;
    engine.toggleCentipede(performanceCenterCursor());
    behaviors.centipede.exitShout = exitShout;
  } else if (engine.mode === 'poopChase') {
    engine.togglePoopChase(performanceCenterCursor());
  }
}

async function runTimedPerformancePhase(name, durationMs, enter) {
  performanceAudit.cursorMode = name;
  performanceAudit.cursorStartedAt = nodePerformance.now();
  if (enter) enter();
  await waitForPerformance(1000);
  beginPerformancePhase(name);
  await waitForPerformance(durationMs);
  endPerformancePhase();
  performanceAudit.cursorMode = null;
}

async function runShoutPerformancePhase(name, trigger) {
  stopSpecialModeForPerformance();
  if (engine.paused) engine.togglePause();
  stageGroupShoutScenario(screen.getPrimaryDisplay());
  beginPerformancePhase(name);
  const result = trigger();
  const deadline = nodePerformance.now() + performanceDuration('PET_PERF_SHOUT_TIMEOUT_MS', 20000);
  while (result.started && engine.mode === 'shout' && nodePerformance.now() < deadline) {
    await waitForPerformance(100);
  }
  endPerformancePhase();
}

async function runPerformanceAudit() {
  try {
    await waitForVisiblePetWindows();
    engine.nextDadAt = Number.POSITIVE_INFINITY;
    if (engine.paused) engine.togglePause();
    stopSpecialModeForPerformance();

    await runTimedPerformancePhase('idle', performanceDuration('PET_PERF_IDLE_MS', 60000), null);
    stopSpecialModeForPerformance();

    await runTimedPerformancePhase('centipede', performanceDuration('PET_PERF_CENTIPEDE_MS', 60000), () => {
      engine.toggleCentipede(performanceCenterCursor());
    });
    stopSpecialModeForPerformance();

    await runTimedPerformancePhase('poop-chase', performanceDuration('PET_PERF_POOP_CHASE_MS', 60000), () => {
      engine.togglePoopChase(performanceCenterCursor());
    });

    const pauseContext = {
      modeBeforePause: engine.mode,
      visibleEffectWindows: visibleEffectWindows(),
      effectRenderers: effectRendererSnapshot(),
      stateFingerprintBefore: performanceStateFingerprint()
    };
    if (!engine.paused) togglePause();
    pauseContext.modeDuringPause = engine.mode;
    await waitForPerformance(1000);
    beginPerformancePhase('pause');
    await waitForPerformance(performanceDuration('PET_PERF_PAUSE_MS', 30000));
    endPerformancePhase();
    pauseContext.stateFingerprintAfter = performanceStateFingerprint();
    if (engine.paused) togglePause();
    stopSpecialModeForPerformance();

    await runShoutPerformancePhase('dad-shout', () => engine.callDad());
    await runShoutPerformancePhase('grandpa-shout', () => engine.callGrandpa());

    await runTimedPerformancePhase('soak', performanceDuration('PET_PERF_SOAK_MS', 600000), null);

    const activeCpu = performanceAudit.phases['poop-chase'].cpuPercent.average;
    const pausedCpu = performanceAudit.phases.pause.cpuPercent.average;
    const pauseRatio = activeCpu > 0 ? pausedCpu / activeCpu : null;
    const activeTicker = performanceAudit.phases['poop-chase'].tickerUpdatesPerSecond;
    const pausedTicker = performanceAudit.phases.pause.tickerUpdatesPerSecond;
    const tickerRatio = activeTicker > 0 ? pausedTicker / activeTicker : null;
    const soakMemory = performanceAudit.phases.soak.memoryMb;
    const pauseComparison = {
      activePhase: 'poop-chase',
      activeAverageCpuPercent: activeCpu,
      pausedAverageCpuPercent: pausedCpu,
      ratio: Number.isFinite(pauseRatio) ? Number(pauseRatio.toFixed(3)) : null,
      activeTickerUpdatesPerSecond: activeTicker,
      pausedTickerUpdatesPerSecond: pausedTicker,
      tickerRatio: Number.isFinite(tickerRatio) ? Number(tickerRatio.toFixed(3)) : null
    };
    const report = {
      ...performanceReportBase('pending'),
      startupVisibleMs: Number(performanceAudit.startupVisibleMs.toFixed(3)),
      pauseContext,
      soak: {
        memoryGrowthMb: Number((soakMemory.end - soakMemory.start).toFixed(3)),
        memoryGrowthMetric: 'private-bytes'
      },
      pauseComparison
    };
    const evaluation = evaluatePerformanceReport(report, DEFAULT_PERFORMANCE_THRESHOLDS, { expectedRuntimeFingerprint: performanceAudit.runtimeFingerprint });
    report.status = evaluation.pass ? 'pass' : 'fail';
    report.evaluation = evaluation;
    writePerformanceJson(report);
    exitAutomatedTest(evaluation.pass ? 0 : 2);
  } catch (error) {
    const report = {
      schemaVersion: PERFORMANCE_REPORT_SCHEMA_VERSION,
      fingerprintSchemaVersion: PERFORMANCE_FINGERPRINT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      status: 'error',
      error: publicErrorMessage(error),
      partialReport: performanceAudit ? performanceReportBase('running') : null
    };
    if (performanceAudit?.output) {
      writePerformanceJson(report);
    }
    exitAutomatedTest(2);
  }
}

function startPerformanceAudit() {
  if (process.env.PET_PERFORMANCE_TEST !== '1' || process.env.PET_SCENARIO_TEST) return;
  const output = process.env.PET_PERFORMANCE_OUT;
  if (!output) throw new Error('PET_PERFORMANCE_OUT is required for PET_PERFORMANCE_TEST.');
  const launchStartedAtEpochMs = Number(process.env.PET_PERFORMANCE_LAUNCHED_AT_MS);
  const executableSha256 = process.env.PET_PERFORMANCE_EXECUTABLE_SHA256;
  if (!Number.isFinite(launchStartedAtEpochMs) || !/^[a-f0-9]{64}$/.test(executableSha256 || '')) {
    throw new Error('Performance runner launch timestamp and executable SHA-256 are required.');
  }
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  performanceAudit = {
    output,
    launchStartedAtEpochMs,
    startupVisibleMs: null,
    runtimeFingerprint: runtimeFingerprintForProject(path.resolve(__dirname, '..')),
    runtime: {
      electronVersion: process.versions.electron,
      executableSha256
    },
    phases: {},
    current: null,
    cursorMode: null,
    cursorStartedAt: nodePerformance.now(),
    eventLoop,
    metricsTimer: null
  };
  performanceAudit.metricsTimer = setInterval(samplePerformanceMetrics, 1000);
  runPerformanceAudit();
}


function scheduleTicker(delay) {
  if (quitting) return;
  const now = nodePerformance.now();
  if (Number.isFinite(delay)) {
    const boundedDelay = Math.max(0, delay);
    tickerDeadline = now + boundedDelay;
    ticker = setTimeout(runTickerFrame, boundedDelay);
    return;
  }
  const schedule = nextTickerSchedule(engine.paused, tickerDeadline, now);
  tickerDeadline = schedule.deadlineMs;
  ticker = setTimeout(runTickerFrame, schedule.delayMs);
}

function runTickerFrame() {
    ticker = null;
    recordPerformanceTick(nodePerformance.now());
    if (engine.paused) {
      scheduleTicker();
      return;
    }
    const now = Date.now();
    const dt = Math.min(0.08, Math.max(0.001, (now - previousTick) / 1000));
    previousTick = now;
    const cursor = scenarioCursor() || performanceCursor() || screen.getCursorScreenPoint();

    for (const [id, drag] of dragStates) {
      const pet = engine.pets.find((item) => item.id === id);
      if (!pet) continue;
      engine.setDragging(id, true, {
        x: drag.petStart.x + cursor.x - drag.cursorStart.x,
        y: drag.petStart.y + cursor.y - drag.cursorStart.y
      });
    }

    const snapshot = engine.update(dt, cursor);
    const padding = (config.render.windowSize - config.render.spriteSize) / 2;
    snapshot.pets.forEach((pet) => {
      const entry = petWindows.get(pet.id);
      if (!entry || entry.win.isDestroyed()) return;
      const nextBounds = {
        x: Math.round(pet.x - padding),
        y: Math.round(pet.y - padding),
        width: config.render.windowSize,
        height: config.render.windowSize
      };
      if (!entry.lastBounds || entry.lastBounds.x !== nextBounds.x || entry.lastBounds.y !== nextBounds.y) {
        if (safeSetPosition(
          entry.win,
          nextBounds.x,
          nextBounds.y,
          `pet:${pet.id}`,
          config.render.windowSize,
          config.render.windowSize
        )) entry.lastBounds = nextBounds;
      }
      const renderKey = petRenderKey(pet);
      if (!entry.win.webContents.isLoading() && entry.lastRenderKey !== renderKey) {
        entry.win.webContents.send('pet:state', pet);
        entry.lastRenderKey = renderKey;
      }
    });

    if (snapshot.mode === 'poopChase' && behaviors.prankEffects.enabled) {
      reconcileDroppingWindows(snapshot.droppings);
    } else {
      clearDroppingWindows();
    }

    const showPoop = snapshot.mode === 'centipede' && behaviors.centipede.poopCursor && behaviors.prankEffects.enabled;
    const poopWindow = showPoop ? ensureCursorPoopWindow() : cursorPoopWindow;
    if (showPoop && poopWindow && !poopWindow.isDestroyed()) {
      const cursorSize = Math.max(28, config.render.effectSize + 8);
      if (safeSetPosition(poopWindow, cursor.x + 10, cursor.y + 10, 'cursor-poop', cursorSize, cursorSize)) {
        if (!poopWindow.webContents.isLoading() && !poopWindow.isVisible()) poopWindow.showInactive();
      } else if (poopWindow.isVisible()) poopWindow.hide();
    } else if (poopWindow?.isVisible()) {
      poopWindow.hide();
    }
    recordScenarioSample(snapshot, cursor);
    captureScenarioMilestone(snapshot);
    scheduleTicker();
}

function startTicker() {
  previousTick = Date.now();
  scheduleTicker(0);
}

function installIpc() {
  ipcMain.handle('pet:get-bootstrap', (event) => {
    const authorized = petFromEvent(event);
    if (!authorized) throw new Error('Unauthorized pet IPC sender.');
    return {
      config,
      behaviors,
      character: config.characters.find((item) => item.id === authorized.id),
      sprite: manifest.characters.find((item) => item.id === authorized.id) || manifest.characters[0]
    };
  });

  ipcMain.on('pet:set-interactive', (event, interactive) => {
    const authorized = petFromEvent(event);
    if (!authorized || typeof interactive !== 'boolean') return;
    const { entry } = authorized;
    if (entry.interactive === interactive) return;
    entry.interactive = interactive;
    setWindowInteractive(entry.win, interactive);
  });

  ipcMain.on('pet:presented', (event) => {
    const authorized = petFromEvent(event);
    if (!authorized) return;
    presentedPetIds.add(authorized.id);
    if (performanceAudit && performanceAudit.startupVisibleMs === null && presentedPetIds.size === config.characters.length) {
      performanceAudit.startupVisibleMs = Date.now() - performanceAudit.launchStartedAtEpochMs;
    }
  });

  ipcMain.on('pet:context-menu', (event) => {
    const authorized = petFromEvent(event);
    if (!authorized) return;
    if (engine.mode === 'centipede' || engine.mode === 'poopChase') {
      if (engine.mode === 'centipede') engine.toggleCentipede(screen.getCursorScreenPoint());
      else engine.togglePoopChase(screen.getCursorScreenPoint());
      refreshTrayMenu();
      return;
    }
    Menu.buildFromTemplate(menuTemplate()).popup({ window: authorized.entry.win });
  });

  ipcMain.on('pet:drag-start', (event) => {
    const authorized = petFromEvent(event);
    if (!authorized) return;
    const { id } = authorized;
    const pet = engine.pets.find((item) => item.id === id);
    if (!pet || engine.mode === 'centipede' || engine.mode === 'poopChase') return;
    dragStates.set(id, { cursorStart: screen.getCursorScreenPoint(), petStart: { x: pet.x, y: pet.y } });
    engine.setDragging(id, true);
  });

  ipcMain.on('pet:drag-end', (event) => {
    const authorized = petFromEvent(event);
    if (!authorized) return;
    const { id } = authorized;
    dragStates.delete(id);
    engine.setDragging(id, false);
  });
}

async function runSmokeCapture() {
  if (process.env.PET_SMOKE_TEST !== '1') return;
  const output = process.env.PET_SMOKE_OUT || path.join(process.cwd(), 'runtime-window.png');
  const captureAtMs = smokeDelay('PET_SMOKE_CAPTURE_AT_MS', 1800);
  const timeoutMs = smokeDelay('PET_SMOKE_TIMEOUT_MS', Math.max(8000, captureAtMs + 5000), captureAtMs + 1000);
  const finish = () => {
    exitAutomatedTest();
  };
  setTimeout(() => {
    const errorPath = path.join(path.dirname(output), 'runtime-smoke-error.txt');
    fs.mkdirSync(path.dirname(errorPath), { recursive: true });
    if (!fs.existsSync(output) && !fs.existsSync(errorPath)) fs.writeFileSync(errorPath, 'Smoke capture timed out.\n', 'utf8');
    finish();
  }, timeoutMs).unref();
  setTimeout(async () => {
    try {
      const first = petWindows.values().next().value?.win;
      if (!first || first.isDestroyed()) throw new Error('No pet window was available for smoke capture.');
      const image = await Promise.race([
        first.webContents.capturePage(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('capturePage timed out.')), 3000))
      ]);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, image.toPNG());
    } catch (error) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(path.join(path.dirname(output), 'runtime-smoke-error.txt'), `${publicErrorMessage(error)}\n`, 'utf8');
    } finally {
      finish();
    }
  }, captureAtMs);
}

if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  denySessionPermissions(session.defaultSession);
  if (process.platform === 'win32') app.setAppUserModelId(config.app.id);
  engine = new BehaviorEngine({ config, behaviors, manifest, displays: displays() });
  startPerformanceAudit();
  installIpc();
  config.characters.forEach(createPetWindow);
  createTray();
  registerShortcuts();
  startScenarioTest();
  startTicker();
  runSmokeCapture();
  screen.on('display-added', () => engine.setDisplays(displays()));
  screen.on('display-removed', () => engine.setDisplays(displays()));
  screen.on('display-metrics-changed', () => engine.setDisplays(displays()));
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
app.on('will-quit', () => {
  if (ticker) clearTimeout(ticker);
  if (performanceAudit?.metricsTimer) clearInterval(performanceAudit.metricsTimer);
  performanceAudit?.eventLoop?.disable();
  clearDroppingWindows();
  globalShortcut.unregisterAll();
});
