'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
let previousTick = Date.now();
let quitting = false;
let scenarioTest = null;
const petWindows = new Map();
const droppingWindows = new Map();
const dragStates = new Map();
const positionWarnings = new Map();
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

function safeSetPosition(win, x, y, label) {
  if (!win || win.isDestroyed()) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    warnPosition(label, `Skipped non-finite coordinates x=${x}, y=${y}`);
    return false;
  }
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  if (roundedX < MIN_WINDOW_COORDINATE || roundedX > MAX_WINDOW_COORDINATE || roundedY < MIN_WINDOW_COORDINATE || roundedY > MAX_WINDOW_COORDINATE) {
    warnPosition(label, `Skipped out-of-range coordinates x=${roundedX}, y=${roundedY}`);
    return false;
  }
  try {
    win.setPosition(roundedX, roundedY, false);
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

function exitAutomatedTest() {
  if (quitting) return;
  quitting = true;
  if (ticker) clearInterval(ticker);
  globalShortcut.unregisterAll();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }
  app.exit(0);
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
  };
  win.once('ready-to-show', showWindow);
  win.webContents.once('did-finish-load', showWindow);
  win.loadFile(PET_PAGE);
  win.on('closed', () => petWindows.delete(character.id));
  petWindows.set(character.id, { win, interactive: false });
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
  if (!safeSetPosition(win, dropping.x - size / 2, dropping.y - size / 2, `dropping:${dropping.id}`)) {
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

function menuTemplate() {
  return [
    { label: '全员叫爸爸', accelerator: behaviors.hotkeys.dad, click: () => engine.callDad(true) },
    { label: '全员叫爷爷', accelerator: behaviors.hotkeys.grandpa, click: () => engine.callGrandpa() },
    { type: 'separator' },
    { label: engine.mode === 'centipede' ? '退出人体蜈蚣模式' : '人体蜈蚣模式', accelerator: behaviors.hotkeys.centipede, click: toggleCentipede },
    {
      label: engine.mode === 'poopChase' ? '退出接力模式' : '接力模式',
      accelerator: behaviors.hotkeys.poopChase,
      enabled: Boolean(behaviors.poopChase?.enabled),
      click: togglePoopChase
    },
    { label: engine.paused ? '继续' : '暂停', accelerator: behaviors.hotkeys.pause, click: () => { engine.togglePause(); refreshTrayMenu(); } },
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
  tray.on('click', () => engine.togglePause());
}

function registerShortcuts() {
  const registrations = [
    [behaviors.hotkeys.dad, () => engine.callDad(true)],
    [behaviors.hotkeys.grandpa, () => engine.callGrandpa()],
    [behaviors.hotkeys.centipede, toggleCentipede],
    [behaviors.hotkeys.poopChase, togglePoopChase],
    [behaviors.hotkeys.pause, () => { engine.togglePause(); refreshTrayMenu(); }]
  ];
  for (const [accelerator, callback] of registrations) {
    if (!accelerator) continue;
    if (!globalShortcut.register(accelerator, callback)) console.warn(`Global shortcut unavailable: ${accelerator}`);
  }
}

function startScenarioTest() {
  const scenario = process.env.PET_SCENARIO_TEST;
  if (scenario !== 'poop-chase' && scenario !== 'centipede') return;
  const poopParticipants = scenario === 'poop-chase' ? engine.poopChaseParticipants() : null;
  const leader = scenario === 'poop-chase' ? poopParticipants.leader : engine.pets[0];
  const followers = scenario === 'poop-chase' ? poopParticipants.followers : engine.pets.slice(1);
  if (!leader || !followers.length || (scenario === 'poop-chase' && !poopParticipants.settings.enabled)) return;
  const direction = process.env.PET_SCENARIO_DIRECTION === 'left' ? 'left' : 'right';
  const primary = screen.getPrimaryDisplay();
  const size = config.render.spriteSize;
  const rightHead = engine.anchorsFor(leader, 'right').head;
  const leftHead = engine.anchorsFor(leader, 'left').head;
  const followAnchor = { x: (rightHead[0] + leftHead[0]) / 2, y: (rightHead[1] + leftHead[1]) / 2 };
  leader.x = primary.workArea.x + Math.min(520, primary.workArea.width * 0.48);
  leader.y = primary.workArea.y + primary.workArea.height * 0.48;
  leader.direction = direction;
  const initialCursor = { x: leader.x + followAnchor.x * size, y: leader.y + followAnchor.y * size };
  if (scenario === 'poop-chase') engine.togglePoopChase(initialCursor);
  else engine.toggleCentipede(initialCursor);
  const originCursor = { x: leader.x + followAnchor.x * size, y: leader.y + followAnchor.y * size };
  const targetCursor = {
    x: direction === 'left'
      ? Math.max(primary.workArea.x + 140, originCursor.x - 360)
      : Math.min(primary.workArea.x + primary.workArea.width - 140, originCursor.x + 360),
    y: originCursor.y
  };
  scenarioTest = {
    scenario,
    leaderId: leader.id,
    startedAt: Date.now(),
    lastSampleAt: Number.NEGATIVE_INFINITY,
    direction,
    originCursor,
    targetCursor,
    samples: []
  };
  const captureAtMs = Math.max(500, Number.parseInt(process.env.PET_SCENARIO_CAPTURE_AT_MS || '2500', 10));
  if (process.env.PET_SCENARIO_CAPTURE_DIR) {
    setTimeout(() => captureScenarioWindows().catch((error) => {
      const outputDir = process.env.PET_SCENARIO_CAPTURE_DIR;
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'capture-error.txt'), `${publicErrorMessage(error)}\n`, 'utf8');
    }), captureAtMs).unref();
  }
  const durationMs = Math.max(3000, Number.parseInt(process.env.PET_SCENARIO_DURATION_MS || '6000', 10));
  setTimeout(() => {
    const output = process.env.PET_SCENARIO_OUT;
    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify({ scenario, direction, originCursor, targetCursor, samples: scenarioTest?.samples || [] }, null, 2)}\n`, 'utf8');
    }
    exitAutomatedTest();
  }, durationMs).unref();
}

function scenarioCursor() {
  if (!scenarioTest) return null;
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
    cursor: { x: Math.round(cursor.x), y: Math.round(cursor.y) },
    leader: leader ? { x: Number(leader.x.toFixed(2)), y: Number(leader.y.toFixed(2)), vx: Number(leader.vx.toFixed(2)), direction: leader.direction, action: leader.action } : null,
    pets: snapshot.pets.map((pet) => ({ id: pet.id, x: Number(pet.x.toFixed(2)), direction: pet.direction, action: pet.action })),
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

async function captureScenarioWindows() {
  const outputDir = process.env.PET_SCENARIO_CAPTURE_DIR;
  if (!outputDir) return;
  fs.mkdirSync(outputDir, { recursive: true });
  const frames = [];
  for (const [id, entry] of petWindows) {
    if (entry.win.isDestroyed()) continue;
    const image = await entry.win.webContents.capturePage();
    const file = `${id}.png`;
    fs.writeFileSync(path.join(outputDir, file), image.toPNG());
    frames.push({ id, file, bounds: entry.win.getBounds(), visible: entry.win.isVisible() });
  }
  const droppings = [];
  for (const [id, win] of [...droppingWindows]) {
    if (win.isDestroyed()) continue;
    const image = await win.webContents.capturePage();
    const file = `dropping-${id}.png`;
    fs.writeFileSync(path.join(outputDir, file), image.toPNG());
    droppings.push({ id, file, bounds: win.getBounds(), visible: win.isVisible() });
  }
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify({ direction: scenarioTest?.direction, capturedAt: Date.now(), frames, droppings }, null, 2)}\n`, 'utf8');
}

function startTicker() {
  ticker = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.08, Math.max(0.001, (now - previousTick) / 1000));
    previousTick = now;
    const cursor = scenarioCursor() || screen.getCursorScreenPoint();

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
      safeSetPosition(entry.win, pet.x - padding, pet.y - padding, `pet:${pet.id}`);
      entry.win.webContents.send('pet:state', pet);
    });

    if (snapshot.mode === 'poopChase' && behaviors.prankEffects.enabled) {
      reconcileDroppingWindows(snapshot.droppings);
    } else {
      clearDroppingWindows();
    }

    const showPoop = snapshot.mode === 'centipede' && behaviors.centipede.poopCursor && behaviors.prankEffects.enabled;
    if (showPoop && cursorPoopWindow && !cursorPoopWindow.isDestroyed()) {
      if (safeSetPosition(cursorPoopWindow, cursor.x + 10, cursor.y + 10, 'cursor-poop')) {
        if (!cursorPoopWindow.isVisible()) cursorPoopWindow.showInactive();
      } else if (cursorPoopWindow.isVisible()) cursorPoopWindow.hide();
    } else if (cursorPoopWindow?.isVisible()) {
      cursorPoopWindow.hide();
    }
    recordScenarioSample(snapshot, cursor);
  }, 33);
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
  installIpc();
  config.characters.forEach(createPetWindow);
  createCursorPoopWindow();
  createDroppingPoopWindow();
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
  if (ticker) clearInterval(ticker);
  clearDroppingWindows();
  globalShortcut.unregisterAll();
});
