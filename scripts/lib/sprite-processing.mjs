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

export function removeChroma(data, width, height, key, transparentThreshold = 28, opaqueThreshold = 105) {
  const output = Buffer.from(data);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
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
  }
  return output;
}

export function cleanPortraitChromaEdges(data, width, height, key, radius = 20) {
  const source = Buffer.from(data);
  const output = Buffer.from(data);
  const offsetAt = (x, y) => (y * width + x) * 4;
  const isOpaque = (offset) => source[offset + 3] > 12;
  const isKeySpill = (offset) => {
    const red = source[offset];
    const green = source[offset + 1];
    const blue = source[offset + 2];
    if (key[0] > 180 && key[2] > 180 && key[1] < 100) {
      return red > green + 24 && blue > green + 24 && Math.min(red, blue) > 45;
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
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
        if (!isOpaque(offsetAt(nx, ny))) return true;
      }
    }
    return false;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = offsetAt(x, y);
      if (!isOpaque(offset)) {
        output[offset] = 0;
        output[offset + 1] = 0;
        output[offset + 2] = 0;
        continue;
      }
      if (!isKeySpill(offset) || !touchesTransparency(x, y)) continue;
      let best = null;
      for (let distance = 1; distance <= radius && !best; distance += 1) {
        for (let dy = -distance; dy <= distance && !best; dy += 1) {
          for (let dx = -distance; dx <= distance; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== distance) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const candidate = offsetAt(nx, ny);
            if (isOpaque(candidate) && isCleanSubjectColor(candidate)) { best = candidate; break; }
          }
        }
      }
      if (!best) continue;
      for (let channel = 0; channel < 3; channel += 1) output[offset + channel] = source[best + channel];
    }
  }
  return output;
}

export function preparePortraitAlpha(data, width, height, key, transparentThreshold = 28, opaqueThreshold = 105) {
  let hasTransparency = false;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] < 250) { hasTransparency = true; break; }
  }
  const alphaReady = hasTransparency
    ? Buffer.from(data)
    : removeChroma(data, width, height, key, transparentThreshold, opaqueThreshold);
  return cleanPortraitChromaEdges(alphaReady, width, height, key);
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
