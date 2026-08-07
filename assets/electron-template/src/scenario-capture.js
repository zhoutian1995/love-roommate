'use strict';

async function boundedCaptureRetry(capture, { attempts = 3, delayMs = 60 } = {}) {
  const limit = Math.max(1, Math.min(3, Math.trunc(Number(attempts)) || 1));
  let lastError;
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    try {
      return await capture();
    } catch (error) {
      lastError = error;
      if (attempt < limit && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

function fitCaptureToLogicalBounds(image, bounds) {
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  const current = image.getSize();
  if (current.width === width && current.height === height) return image;
  return image.resize({ width, height, quality: 'best' });
}

function desktopPixelMatchRatio(frameImage, bounds, desktopImage, workArea) {
  if (!frameImage || !desktopImage || !bounds || !workArea) return 0;
  const frameSize = frameImage.getSize();
  const desktopSize = desktopImage.getSize();
  if (!frameSize.width || !frameSize.height || !desktopSize.width || !desktopSize.height) return 0;
  const frame = frameImage.toBitmap();
  const desktop = desktopImage.toBitmap();
  const frameScaleX = frameSize.width / Math.max(1, bounds.width);
  const frameScaleY = frameSize.height / Math.max(1, bounds.height);
  const desktopScaleX = desktopSize.width / Math.max(1, workArea.width);
  const desktopScaleY = desktopSize.height / Math.max(1, workArea.height);
  const stride = Math.max(1, Math.floor(Math.min(frameSize.width, frameSize.height) / 70));
  const samples = [];

  for (let y = 0; y < frameSize.height; y += stride) {
    for (let x = 0; x < frameSize.width; x += stride) {
      const sourceOffset = (y * frameSize.width + x) * 4;
      if (frame[sourceOffset + 3] < 240) continue;
      const logicalX = bounds.x - workArea.x + x / frameScaleX;
      const logicalY = bounds.y - workArea.y + y / frameScaleY;
      samples.push({
        sourceOffset,
        desktopX: Math.round(logicalX * desktopScaleX),
        desktopY: Math.round(logicalY * desktopScaleY)
      });
    }
  }
  if (!samples.length) return 0;

  const score = (offsetX, offsetY) => {
    let matched = 0;
    for (const sample of samples) {
      const desktopX = sample.desktopX + offsetX;
      const desktopY = sample.desktopY + offsetY;
      if (desktopX < 0 || desktopY < 0 || desktopX >= desktopSize.width || desktopY >= desktopSize.height) continue;
      const desktopOffset = (desktopY * desktopSize.width + desktopX) * 4;
      const channelDelta = Math.max(
        Math.abs(frame[sample.sourceOffset] - desktop[desktopOffset]),
        Math.abs(frame[sample.sourceOffset + 1] - desktop[desktopOffset + 1]),
        Math.abs(frame[sample.sourceOffset + 2] - desktop[desktopOffset + 2])
      );
      if (channelDelta <= 36) matched += 1;
    }
    return matched / samples.length;
  };

  const searchRadius = Math.max(1, Math.round(Math.min(frameSize.width, frameSize.height) * 0.15));
  const coarseStep = Math.max(1, Math.round(searchRadius / 6));
  let best = { x: 0, y: 0, ratio: score(0, 0) };
  for (let y = -searchRadius; y <= searchRadius; y += coarseStep) {
    for (let x = -searchRadius; x <= searchRadius; x += coarseStep) {
      const ratio = score(x, y);
      if (ratio > best.ratio) best = { x, y, ratio };
    }
  }
  const refineRadius = Math.max(1, coarseStep - 1);
  for (let y = best.y - refineRadius; y <= best.y + refineRadius; y += 1) {
    for (let x = best.x - refineRadius; x <= best.x + refineRadius; x += 1) {
      const ratio = score(x, y);
      if (ratio > best.ratio) best = { x, y, ratio };
    }
  }
  return best.ratio;
}

function desktopSurfaceMatchRatio(surfaceImage, bounds, desktopImage, workArea) {
  if (!surfaceImage || !desktopImage || !bounds || !workArea) return 0;
  const surfaceSize = surfaceImage.getSize();
  const desktopSize = desktopImage.getSize();
  if (!surfaceSize.width || !surfaceSize.height || !desktopSize.width || !desktopSize.height) return 0;
  const surface = surfaceImage.toBitmap();
  const desktop = desktopImage.toBitmap();
  const surfaceScaleX = surfaceSize.width / Math.max(1, bounds.width);
  const surfaceScaleY = surfaceSize.height / Math.max(1, bounds.height);
  const desktopScaleX = desktopSize.width / Math.max(1, workArea.width);
  const desktopScaleY = desktopSize.height / Math.max(1, workArea.height);
  const stride = Math.max(1, Math.floor(Math.min(surfaceSize.width, surfaceSize.height) / 120));
  let sampled = 0;
  let matched = 0;
  let desktopBrightness = 0;
  for (let y = 0; y < surfaceSize.height; y += stride) {
    for (let x = 0; x < surfaceSize.width; x += stride) {
      const sourceOffset = (y * surfaceSize.width + x) * 4;
      if (surface[sourceOffset + 3] < 240) continue;
      const logicalX = bounds.x - workArea.x + x / surfaceScaleX;
      const logicalY = bounds.y - workArea.y + y / surfaceScaleY;
      const desktopX = Math.round(logicalX * desktopScaleX);
      const desktopY = Math.round(logicalY * desktopScaleY);
      if (desktopX < 0 || desktopY < 0 || desktopX >= desktopSize.width || desktopY >= desktopSize.height) continue;
      const desktopOffset = (desktopY * desktopSize.width + desktopX) * 4;
      sampled += 1;
      desktopBrightness += Math.max(
        desktop[desktopOffset],
        desktop[desktopOffset + 1],
        desktop[desktopOffset + 2]
      );
      const channelDelta = Math.max(
        Math.abs(surface[sourceOffset] - desktop[desktopOffset]),
        Math.abs(surface[sourceOffset + 1] - desktop[desktopOffset + 1]),
        Math.abs(surface[sourceOffset + 2] - desktop[desktopOffset + 2])
      );
      if (channelDelta <= 24) matched += 1;
    }
  }
  if (sampled && desktopBrightness / sampled < 16) return 0;
  return sampled ? matched / sampled : 0;
}

function desktopForegroundRatio(bounds, desktopImage, surfaceImage, surfaceBounds, workArea) {
  if (!bounds || !desktopImage || !surfaceImage || !surfaceBounds || !workArea) return 0;
  const desktopSize = desktopImage.getSize();
  const surfaceSize = surfaceImage.getSize();
  if (!desktopSize.width || !desktopSize.height || !surfaceSize.width || !surfaceSize.height) return 0;
  const desktop = desktopImage.toBitmap();
  const surface = surfaceImage.toBitmap();
  const left = Math.max(workArea.x, bounds.x);
  const top = Math.max(workArea.y, bounds.y);
  const right = Math.min(workArea.x + workArea.width, bounds.x + bounds.width);
  const bottom = Math.min(workArea.y + workArea.height, bounds.y + bounds.height);
  if (right <= left || bottom <= top) return 0;
  const desktopScaleX = desktopSize.width / Math.max(1, workArea.width);
  const desktopScaleY = desktopSize.height / Math.max(1, workArea.height);
  const surfaceScaleX = surfaceSize.width / Math.max(1, surfaceBounds.width);
  const surfaceScaleY = surfaceSize.height / Math.max(1, surfaceBounds.height);
  const pixelWidth = Math.max(1, Math.round((right - left) * desktopScaleX));
  const pixelHeight = Math.max(1, Math.round((bottom - top) * desktopScaleY));
  const stride = Math.max(1, Math.floor(Math.min(pixelWidth, pixelHeight) / 90));
  let sampled = 0;
  let foreground = 0;
  for (let y = 0; y < pixelHeight; y += stride) {
    for (let x = 0; x < pixelWidth; x += stride) {
      const logicalX = left + x / desktopScaleX;
      const logicalY = top + y / desktopScaleY;
      const desktopX = Math.round((logicalX - workArea.x) * desktopScaleX);
      const desktopY = Math.round((logicalY - workArea.y) * desktopScaleY);
      const surfaceX = Math.round((logicalX - surfaceBounds.x) * surfaceScaleX);
      const surfaceY = Math.round((logicalY - surfaceBounds.y) * surfaceScaleY);
      if (desktopX < 0 || desktopY < 0 || desktopX >= desktopSize.width || desktopY >= desktopSize.height) continue;
      if (surfaceX < 0 || surfaceY < 0 || surfaceX >= surfaceSize.width || surfaceY >= surfaceSize.height) continue;
      const desktopOffset = (desktopY * desktopSize.width + desktopX) * 4;
      const surfaceOffset = (surfaceY * surfaceSize.width + surfaceX) * 4;
      sampled += 1;
      const channelDelta = Math.max(
        Math.abs(desktop[desktopOffset] - surface[surfaceOffset]),
        Math.abs(desktop[desktopOffset + 1] - surface[surfaceOffset + 1]),
        Math.abs(desktop[desktopOffset + 2] - surface[surfaceOffset + 2])
      );
      if (channelDelta > 24) foreground += 1;
    }
  }
  return sampled ? foreground / sampled : 0;
}

function presentAlwaysOnTopWindow(win, alwaysOnTop) {
  if (!win || win.isDestroyed()) return false;
  win.showInactive();
  if (alwaysOnTop) {
    win.setAlwaysOnTop(true, 'floating');
    if (typeof win.moveTop === 'function') win.moveTop();
  }
  return true;
}

const topmostReassertedAt = new WeakMap();

function createNativeWindowUpdateGate(powerMonitor, onUnlock = () => {}) {
  let locked = false;
  try {
    locked = powerMonitor?.getSystemIdleState?.(1) === 'locked';
  } catch {
    locked = false;
  }
  if (typeof powerMonitor?.on === 'function') {
    powerMonitor.on('lock-screen', () => { locked = true; });
    powerMonitor.on('unlock-screen', () => {
      const wasLocked = locked;
      locked = false;
      if (wasLocked) onUnlock();
    });
  }
  return { allowed: () => !locked };
}

function createBoundedWindowUpdater(defaultIntervalMs = 100) {
  const updatedAt = new WeakMap();
  return (win, update, options = {}) => {
    if (!win || win.isDestroyed()) return { attempted: false, succeeded: false };
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const intervalMs = Math.max(
      0,
      Number.isFinite(options.intervalMs) ? options.intervalMs : defaultIntervalMs
    );
    const last = updatedAt.get(win);
    if (options.force !== true && Number.isFinite(last) && now - last < intervalMs) {
      return { attempted: false, succeeded: true };
    }
    const succeeded = typeof update === 'function' && update() !== false;
    if (succeeded) updatedAt.set(win, now);
    return { attempted: true, succeeded };
  };
}

function presentAlwaysOnTopWindowBounded(win, alwaysOnTop, options = {}) {
  if (!win || win.isDestroyed()) return false;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const intervalMs = Math.max(0, Number.isFinite(options.intervalMs) ? options.intervalMs : 5000);
  const force = options.force === true;
  const visible = typeof win.isVisible === 'function' && win.isVisible();
  const last = topmostReassertedAt.get(win);
  if (!force && visible && Number.isFinite(last) && now - last < intervalMs) return false;
  if (!presentAlwaysOnTopWindow(win, alwaysOnTop)) return false;
  topmostReassertedAt.set(win, now);
  return true;
}

function presentValidationSurfaceBehindPets(surface, petWindows = []) {
  if (!presentAlwaysOnTopWindow(surface, true)) return false;
  for (const win of petWindows) {
    if (!win || win.isDestroyed()) continue;
    if (typeof win.isVisible === 'function' && !win.isVisible()) continue;
    presentAlwaysOnTopWindow(win, true);
  }
  return true;
}

function runtimeValidationArea(workArea, spriteSize, characterCount) {
  const safeCount = Math.max(1, Math.min(8, Math.round(characterCount || 1)));
  const safeSpriteSize = Math.max(1, Number(spriteSize) || 1);
  const preferredWidth = Math.min(1440, Math.max(960, safeCount * 192 + 360));
  const preferredHeight = Math.max(600, Math.min(720, Math.round(safeSpriteSize * 6.5)));
  const width = Math.max(1, Math.min(Math.round(workArea.width), preferredWidth));
  const height = Math.max(1, Math.min(Math.round(workArea.height), preferredHeight));
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  };
}

function runtimeEvidenceLayout(workArea, characterCount, spriteSize, windowSize) {
  const safeCount = Math.max(1, Math.min(8, Math.round(characterCount || 1)));
  const safeSpriteSize = Math.max(1, Number(spriteSize) || 1);
  const safeWindowSize = Math.max(safeSpriteSize, Number(windowSize) || safeSpriteSize);
  const area = runtimeValidationArea(workArea, safeSpriteSize, safeCount);
  const windowPadding = (safeWindowSize - safeSpriteSize) / 2;
  const horizontalInset = Math.max(48, Math.round(safeWindowSize * 0.35));
  const minX = area.x + horizontalInset + windowPadding;
  const maxX = area.x + area.width - horizontalInset - safeWindowSize + windowPadding;
  const minY = area.y + Math.max(150, Math.round(area.height * 0.34)) + windowPadding;
  const maxY = area.y + area.height - Math.max(36, Math.round(safeWindowSize * 0.2)) - safeWindowSize + windowPadding;
  const verticalPattern = [0.7, 0.15, 0.9, 0.35, 0.62, 0.02, 0.82, 0.47];
  let points = Array.from({ length: safeCount }, (_, index) => {
    const ratio = safeCount === 1 ? 0.5 : index / (safeCount - 1);
    const verticalRatio = verticalPattern[index % verticalPattern.length];
    return {
      x: Math.round(minX + Math.max(0, maxX - minX) * ratio),
      y: Math.round(minY + Math.max(0, maxY - minY) * verticalRatio)
    };
  });
  const horizontalStep = safeCount > 1 ? (maxX - minX) / (safeCount - 1) : safeWindowSize;
  if (safeCount > 1 && horizontalStep < safeWindowSize + 12) {
    const gap = 12;
    const maxColumns = Math.max(1, Math.floor((area.width - horizontalInset * 2 + gap) / (safeWindowSize + gap)));
    const columns = Math.max(1, Math.min(maxColumns, Math.ceil(safeCount / 2)));
    const rows = Math.ceil(safeCount / columns);
    const top = area.y + Math.max(96, Math.round(area.height * 0.18));
    const bottom = area.y + area.height - Math.max(24, Math.round(safeWindowSize * 0.14)) - safeWindowSize;
    const verticalStep = rows > 1 ? (bottom - top) / (rows - 1) : 0;
    points = Array.from({ length: safeCount }, (_, index) => {
      const row = Math.floor(index / columns);
      const rowStart = row * columns;
      const rowCount = Math.min(columns, safeCount - rowStart);
      const rowWidth = rowCount * safeWindowSize + Math.max(0, rowCount - 1) * gap;
      const windowX = area.x + (area.width - rowWidth) / 2 + (index - rowStart) * (safeWindowSize + gap);
      const windowY = top + row * verticalStep;
      return {
        x: Math.round(windowX + windowPadding),
        y: Math.round(windowY + windowPadding)
      };
    });
  }
  return { area, points };
}

function runtimeEvidenceMotion(points, captureArea, spriteSize, windowSize, horizonMs = 2000) {
  const safePoints = Array.isArray(points) ? points : [];
  if (!safePoints.length) return [];
  const safeSpriteSize = Math.max(1, Number(spriteSize) || 1);
  const safeWindowSize = Math.max(safeSpriteSize, Number(windowSize) || safeSpriteSize);
  const windowPadding = (safeWindowSize - safeSpriteSize) / 2;
  const leftRoom = Math.min(...safePoints.map((point) => point.x - windowPadding - captureArea.x));
  const rightEdge = captureArea.x + captureArea.width;
  const rightRoom = Math.min(...safePoints.map((point) => rightEdge - (point.x - windowPadding + safeWindowSize)));
  const direction = leftRoom >= rightRoom ? -1 : 1;
  const availableRoom = Math.max(0, direction < 0 ? leftRoom : rightRoom);
  const horizonSeconds = Math.max(0.25, Number(horizonMs) / 1000 || 2);
  const edgeBuffer = Math.max(8, Math.round(safeWindowSize * 0.05));
  const preferredSpeed = Math.max(12, Math.min(24, safeSpriteSize * 0.18));
  const speed = Math.max(0, Math.min(preferredSpeed, (availableRoom - edgeBuffer) / horizonSeconds));
  return safePoints.map(() => ({
    vx: direction * speed,
    vy: 0,
    direction: direction < 0 ? 'left' : 'right'
  }));
}

function runtimeEvidenceCoverage(expectedIds, frames, captureArea, options = {}) {
  const issues = [];
  const minimumForegroundRatio = Number.isFinite(options.minimumForegroundRatio)
    ? Math.max(0, options.minimumForegroundRatio)
    : 0.005;
  const expected = Array.isArray(expectedIds) ? expectedIds : [];
  const evidence = Array.isArray(frames) ? frames : [];
  const byId = new Map();
  for (const frame of evidence) {
    if (!frame || typeof frame.id !== 'string' || !frame.id) continue;
    if (byId.has(frame.id)) issues.push(`duplicate evidence for ${frame.id}`);
    else byId.set(frame.id, frame);
  }

  const within = (bounds) => (
    bounds && captureArea &&
    [bounds.x, bounds.y, bounds.width, bounds.height, captureArea.x, captureArea.y, captureArea.width, captureArea.height].every(Number.isFinite) &&
    bounds.width > 0 && bounds.height > 0 && captureArea.width > 0 && captureArea.height > 0 &&
    bounds.x >= captureArea.x && bounds.y >= captureArea.y &&
    bounds.x + bounds.width <= captureArea.x + captureArea.width &&
    bounds.y + bounds.height <= captureArea.y + captureArea.height
  );
  const overlaps = (left, right) => (
    left.x < right.x + right.width && left.x + left.width > right.x &&
    left.y < right.y + right.height && left.y + left.height > right.y
  );

  const accepted = [];
  for (const id of expected) {
    const frame = byId.get(id);
    if (!frame) {
      issues.push(`missing ${id}`);
      continue;
    }
    if (frame.visible !== true) issues.push(`${id} is not visible`);
    if (!Number.isFinite(frame.desktopForegroundRatio) || frame.desktopForegroundRatio < minimumForegroundRatio) {
      issues.push(`${id} has no readable compositor foreground`);
    }
    if (!within(frame.bounds)) issues.push(`${id} is outside the capture area`);
    else accepted.push(frame);
  }
  for (let left = 0; left < accepted.length; left += 1) {
    for (let right = left + 1; right < accepted.length; right += 1) {
      if (overlaps(accepted[left].bounds, accepted[right].bounds)) {
        issues.push(`${accepted[left].id} overlaps ${accepted[right].id}`);
      }
    }
  }
  return issues;
}

function cropDesktopCapture(image, display, logicalArea) {
  const displayBounds = display?.bounds || display?.workArea || display?.size;
  if (!displayBounds || !logicalArea) return image;
  const imageSize = image.getSize();
  const scaleX = imageSize.width / Math.max(1, displayBounds.width);
  const scaleY = imageSize.height / Math.max(1, displayBounds.height);
  const x = Math.max(0, Math.round((logicalArea.x - (displayBounds.x || 0)) * scaleX));
  const y = Math.max(0, Math.round((logicalArea.y - (displayBounds.y || 0)) * scaleY));
  const width = Math.max(1, Math.min(imageSize.width - x, Math.round(logicalArea.width * scaleX)));
  const height = Math.max(1, Math.min(imageSize.height - y, Math.round(logicalArea.height * scaleY)));
  return image.crop({ x, y, width, height });
}

function cursorEffectBounds(cursor, effectSize, avoidRects = [], workArea = null) {
  const size = Math.max(1, Math.round(Number(effectSize) || 1));
  const safeCursor = {
    x: Number.isFinite(cursor?.x) ? cursor.x : 0,
    y: Number.isFinite(cursor?.y) ? cursor.y : 0
  };
  const area = workArea || { x: -1000000, y: -1000000, width: 2000000, height: 2000000 };
  const areaRight = area.x + Math.max(size, Number(area.width) || size);
  const areaBottom = area.y + Math.max(size, Number(area.height) || size);
  const clampCandidate = (candidate) => ({
    x: Math.round(Math.max(area.x, Math.min(areaRight - size, candidate.x))),
    y: Math.round(Math.max(area.y, Math.min(areaBottom - size, candidate.y))),
    width: size,
    height: size
  });
  const overlaps = (left, right) => (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
  const obstacles = avoidRects
    .filter((rect) => [rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite))
    .map((rect) => ({ x: rect.x, y: rect.y, width: Math.max(0, rect.width), height: Math.max(0, rect.height) }));
  const preferred = clampCandidate({ x: safeCursor.x + 10, y: safeCursor.y + 10 });
  if (obstacles.every((rect) => !overlaps(preferred, rect))) return preferred;

  const union = obstacles.reduce((bounds, rect) => ({
    x: Math.min(bounds.x, rect.x),
    y: Math.min(bounds.y, rect.y),
    right: Math.max(bounds.right, rect.x + rect.width),
    bottom: Math.max(bounds.bottom, rect.y + rect.height)
  }), {
    x: Number.POSITIVE_INFINITY,
    y: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY
  });
  const gap = 8;
  const candidates = [
    { x: union.right + gap, y: safeCursor.y - size / 2 },
    { x: safeCursor.x - size / 2, y: union.y - size - gap },
    { x: safeCursor.x - size / 2, y: union.bottom + gap },
    { x: union.x - size - gap, y: safeCursor.y - size / 2 },
    { x: area.x, y: area.y },
    { x: areaRight - size, y: area.y },
    { x: area.x, y: areaBottom - size },
    { x: areaRight - size, y: areaBottom - size }
  ]
    .map(clampCandidate)
    .filter((candidate, index, all) => all.findIndex((item) => item.x === candidate.x && item.y === candidate.y) === index)
    .filter((candidate) => obstacles.every((rect) => !overlaps(candidate, rect)))
    .sort((left, right) => (
      Math.hypot(left.x - preferred.x, left.y - preferred.y) -
      Math.hypot(right.x - preferred.x, right.y - preferred.y)
    ));

  return candidates[0] || preferred;
}

function cursorPoopSize(effectSize) {
  return Math.max(45, Math.min(50, Math.round((Number(effectSize) || 0) * 1.5)));
}

function groupShoutEvidenceLayout(targets, workArea, spriteSize) {
  if (!Array.isArray(targets) || !targets.length) return [];
  const size = Math.max(1, Number(spriteSize) || 1);
  const area = workArea || { x: 0, y: 0, width: 1280, height: 720 };
  const right = area.x + Math.max(size, Number(area.width) || size);
  const bottom = area.y + Math.max(size, Number(area.height) || size);
  const minX = Math.min(...targets.map((target) => target.x));
  const minY = Math.min(...targets.map((target) => target.y));
  const maxRight = Math.max(...targets.map((target) => target.x + size));
  const maxBottom = Math.max(...targets.map((target) => target.y + size));
  const horizontal = Math.min(Math.max(size, area.width * 0.18), size * 2.25);
  const vertical = Math.min(Math.max(size, area.height * 0.24), size * 2);
  const left = Math.max(0, Math.min(horizontal, minX - area.x));
  const up = Math.max(0, Math.min(vertical, minY - area.y));
  const moveRight = Math.max(0, Math.min(horizontal, right - maxRight));
  const down = Math.max(0, Math.min(vertical, bottom - maxBottom));
  const vectors = [
    { x: -left, y: -up },
    { x: moveRight, y: -up },
    { x: -left, y: down },
    { x: moveRight, y: down },
    { x: -left, y: 0 },
    { x: moveRight, y: 0 },
    { x: 0, y: -up },
    { x: 0, y: down }
  ].sort((first, second) => Math.hypot(second.x, second.y) - Math.hypot(first.x, first.y));
  const vector = vectors[0] || { x: 0, y: 0 };
  return targets.map((target) => ({
    id: target.id,
    x: target.x + vector.x,
    y: target.y + vector.y
  }));
}

function centeredFormationOffset(frames, workArea, targetRatio = { x: 0.5, y: 0.5 }) {
  if (!Array.isArray(frames) || !frames.length || !workArea) return { x: 0, y: 0 };
  const area = {
    x: Number(workArea.x),
    y: Number(workArea.y),
    width: Number(workArea.width),
    height: Number(workArea.height)
  };
  if (![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.width <= 0 || area.height <= 0) {
    return { x: 0, y: 0 };
  }
  const normalized = frames.map((frame) => ({
    x: Number(frame?.x),
    y: Number(frame?.y),
    width: Number(frame?.width),
    height: Number(frame?.height)
  }));
  if (normalized.some((frame) => (
    ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) ||
    frame.width < 0 || frame.height < 0
  ))) return { x: 0, y: 0 };

  const left = Math.min(...normalized.map((frame) => frame.x));
  const top = Math.min(...normalized.map((frame) => frame.y));
  const right = Math.max(...normalized.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...normalized.map((frame) => frame.y + frame.height));
  if (right - left > area.width || bottom - top > area.height) return { x: 0, y: 0 };

  const ratioX = Math.max(0, Math.min(1, Number(targetRatio?.x) || 0));
  const ratioY = Math.max(0, Math.min(1, Number(targetRatio?.y) || 0));
  const desiredX = area.x + area.width * ratioX - (left + right) / 2;
  const desiredY = area.y + area.height * ratioY - (top + bottom) / 2;
  return {
    x: Math.max(area.x - left, Math.min(area.x + area.width - right, desiredX)),
    y: Math.max(area.y - top, Math.min(area.y + area.height - bottom, desiredY))
  };
}

function scenarioCapturePolicy({ desktopAvailable, developmentFallbackRequested }) {
  if (desktopAvailable) {
    return { captureKind: 'desktop-compositor', releaseEligible: true };
  }
  if (developmentFallbackRequested) {
    return { captureKind: 'synthetic-development', releaseEligible: false };
  }
  throw new Error('Desktop compositor capture is required for release evidence.');
}

module.exports = {
  boundedCaptureRetry,
  centeredFormationOffset,
  createNativeWindowUpdateGate,
  createBoundedWindowUpdater,
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
};
