export function parseHexColor(value) {
  const normalized = value.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new Error(`Invalid color: ${value}`);
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

export function inferBorderKey(data, width, height, channels = 4) {
  const samples = [[], [], []];
  const push = (x, y) => {
    const offset = (y * width + x) * channels;
    if (channels === 4 && data[offset + 3] < 16) return;
    samples[0].push(data[offset]);
    samples[1].push(data[offset + 1]);
    samples[2].push(data[offset + 2]);
  };
  const stepX = Math.max(1, Math.floor(width / 64));
  const stepY = Math.max(1, Math.floor(height / 64));
  for (let x = 0; x < width; x += stepX) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += stepY) { push(0, y); push(width - 1, y); }
  return samples.map((values) => {
    if (!values.length) return 0;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
}

function connectedChromaMask(data, width, height, key, threshold, { seedFromTransparency = false } = {}) {
  const pixelCount = width * height;
  const candidates = new Uint8Array(pixelCount);
  const connected = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueLength = 0;
  const distanceAt = (pixel) => {
    const offset = pixel * 4;
    return Math.hypot(data[offset] - key[0], data[offset + 1] - key[1], data[offset + 2] - key[2]);
  };
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (data[pixel * 4 + 3] > 12 && distanceAt(pixel) <= threshold) candidates[pixel] = 1;
  }
  const enqueue = (pixel) => {
    if (!candidates[pixel] || connected[pixel]) return;
    connected[pixel] = 1;
    queue[queueLength] = pixel;
    queueLength += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  if (seedFromTransparency) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if (!candidates[pixel]) continue;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height
              || data[(ny * width + nx) * 4 + 3] <= 12) enqueue(pixel);
          }
        }
      }
    }
  }
  for (let cursor = 0; cursor < queueLength; cursor += 1) {
    const pixel = queue[cursor];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) enqueue(ny * width + nx);
      }
    }
  }
  return connected;
}

export function removeChroma(data, width, height, key, transparentThreshold = 28, opaqueThreshold = 105) {
  const output = Buffer.from(data);
  const connected = connectedChromaMask(data, width, height, key, opaqueThreshold);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (!connected[pixel]) continue;
    const offset = pixel * 4;
    const red = output[offset];
    const green = output[offset + 1];
    const blue = output[offset + 2];
    const originalAlpha = output[offset + 3];
    const colorDistance = Math.hypot(red - key[0], green - key[1], blue - key[2]);
    const matte = Math.max(0, Math.min(1, (colorDistance - transparentThreshold) / (opaqueThreshold - transparentThreshold)));
    output[offset + 3] = Math.round(originalAlpha * matte);
    if (matte < 1 && key[0] > 180 && key[2] > 180 && key[1] < 100) {
      const spill = Math.max(0, Math.min(red, blue) - green);
      output[offset] = Math.max(0, Math.round(red - spill * (1 - matte) * 0.75));
      output[offset + 2] = Math.max(0, Math.round(blue - spill * (1 - matte) * 0.75));
    } else if (matte < 1 && key[1] > 180 && key[0] < 120 && key[2] < 120) {
      const spill = Math.max(0, green - Math.max(red, blue));
      output[offset + 1] = Math.max(0, Math.round(green - spill * (1 - matte) * 0.8));
    }
    if (output[offset + 3] === 0) output.fill(0, offset, offset + 3);
  }
  return output;
}

export function cleanPortraitChromaEdges(data, width, height, key, radius = 20) {
  const source = Buffer.from(data);
  const output = Buffer.from(data);
  const offsetAt = (x, y) => (y * width + x) * 4;
  const keyDistance = (offset) => Math.hypot(
    source[offset] - key[0],
    source[offset + 1] - key[1],
    source[offset + 2] - key[2]
  );
  const isHighConfidenceKey = (offset) => source[offset + 3] > 12 && keyDistance(offset) <= 28;
  const connectedKey = connectedChromaMask(source, width, height, key, 28, { seedFromTransparency: true });
  const isConnectedKey = (offset) => connectedKey[offset / 4] === 1;
  const isOpaque = (offset) => source[offset + 3] > 12 && !isConnectedKey(offset);
  const isKeySpill = (offset) => {
    const red = source[offset];
    const green = source[offset + 1];
    const blue = source[offset + 2];
    if (key[0] > 180 && key[2] > 180 && key[1] < 100) {
      const redDominance = red - green;
      const blueDominance = blue - green;
      return Math.min(red, blue) > 45
        && (keyDistance(offset) <= 80 || (redDominance > 48 && blueDominance > 48));
    }
    if (key[1] > 180 && key[0] < 120 && key[2] < 120) {
      return green > red + 24 && green > blue + 24 && green > 105;
    }
    return false;
  };
  const isCleanSubjectColor = (offset) => {
    const red = source[offset];
    const green = source[offset + 1];
    const blue = source[offset + 2];
    if (key[0] > 180 && key[2] > 180 && key[1] < 100) {
      return !(red > green + 12 && blue > green + 12);
    }
    if (key[1] > 180 && key[0] < 120 && key[2] < 120) {
      return green <= Math.max(red, blue) + 12;
    }
    return true;
  };
  const touchesTransparency = (x, y) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
        const neighbor = offsetAt(nx, ny);
        if (source[neighbor + 3] <= 12 || isConnectedKey(neighbor)) return true;
      }
    }
    return false;
  };
  const keyMixFit = (offset, reference) => {
    let numerator = 0;
    let denominator = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const direction = key[channel] - source[reference + channel];
      numerator += (source[offset + channel] - source[reference + channel]) * direction;
      denominator += direction * direction;
    }
    if (denominator < 1) return null;
    const amount = numerator / denominator;
    if (amount < 0.06 || amount > 0.7) return null;
    let residualSquared = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const expected = source[reference + channel] * (1 - amount) + key[channel] * amount;
      residualSquared += (source[offset + channel] - expected) ** 2;
    }
    const residual = Math.sqrt(residualSquared);
    return residual <= 18 ? { amount, residual } : null;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = offsetAt(x, y);
      if (isHighConfidenceKey(offset) && isConnectedKey(offset)) {
        output.fill(0, offset, offset + 4);
        continue;
      }
      if (!isOpaque(offset)) {
        output[offset] = 0;
        output[offset + 1] = 0;
        output[offset + 2] = 0;
        continue;
      }
      if (!touchesTransparency(x, y)) continue;
      let best = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let distance = 1; distance <= radius; distance += 1) {
        for (let dy = -distance; dy <= distance; dy += 1) {
          for (let dx = -distance; dx <= distance; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== distance) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const candidate = offsetAt(nx, ny);
            if (!isOpaque(candidate) || !isCleanSubjectColor(candidate)) continue;
            const fit = keyMixFit(offset, candidate);
            if (!fit && !isKeySpill(offset)) continue;
            const score = (fit?.residual ?? 18) + distance * 0.75;
            if (score < bestScore) {
              best = candidate;
              bestScore = score;
            }
          }
        }
      }
      if (!best) continue;
      for (let channel = 0; channel < 3; channel += 1) output[offset + channel] = source[best + channel];
    }
  }
  return output;
}

export function zeroHiddenRgb(rgba) {
  const output = Buffer.from(rgba);
  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] === 0) output.fill(0, offset, offset + 3);
  }
  return output;
}

export function preparePortraitAlpha(data, width, height, key, transparentThreshold = 28, opaqueThreshold = 105, options = {}) {
  if (options?.trustedCorrected === true) return zeroHiddenRgb(data);
  let hasTransparency = false;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] < 250) { hasTransparency = true; break; }
  }
  const effectiveKey = hasTransparency ? key : inferBorderKey(data, width, height);
  const alphaReady = hasTransparency
    ? Buffer.from(data)
    : removeChroma(data, width, height, effectiveKey, transparentThreshold, opaqueThreshold);
  return zeroHiddenRgb(cleanPortraitChromaEdges(alphaReady, width, height, effectiveKey));
}

export function alphaBounds(data, width, height, threshold = 12) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let opaquePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue;
      opaquePixels += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    coverage: opaquePixels / (width * height)
  };
}

export function nearestVisibleAlphaDistance(data, width, height, point, threshold = 12) {
  const targetX = Math.round(Number(point?.[0]) * (width - 1));
  const targetY = Math.round(Number(point?.[1]) * (height - 1));
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) {
    throw new Error('Anchor point must contain normalized x,y values.');
  }
  let nearest = Number.POSITIVE_INFINITY;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue;
      nearest = Math.min(nearest, Math.hypot(x - targetX, y - targetY));
    }
  }
  return nearest;
}
