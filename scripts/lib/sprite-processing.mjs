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
