import path from 'node:path';

import { zeroHiddenRgb } from './sprite-processing.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HEX_COLOR_PATTERN = /^#[a-f0-9]{6}$/i;

function assertRgbaBuffer(value, name, expectedLength) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError(`${name} must be a Buffer or Uint8Array.`);
  }
  if (value.length !== expectedLength) {
    throw new RangeError(`${name} must contain exactly ${expectedLength} RGBA bytes.`);
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function brushWeight(distance, radius, hardness) {
  if (radius === 0) return distance === 0 ? 1 : 0;
  if (distance > radius) return 0;
  const hardRadius = radius * hardness;
  if (distance <= hardRadius) return 1;
  if (hardRadius === radius) return 1;
  return 1 - ((distance - hardRadius) / (radius - hardRadius));
}

export function applyMaskEdits({ sourceRgba, candidateRgba, width, height, edits = [] }) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('width and height must be positive integers.');
  }
  const expectedLength = width * height * 4;
  assertRgbaBuffer(sourceRgba, 'sourceRgba', expectedLength);
  assertRgbaBuffer(candidateRgba, 'candidateRgba', expectedLength);
  if (!Array.isArray(edits)) throw new TypeError('edits must be an array.');

  const output = Buffer.from(candidateRgba);
  for (const edit of edits) {
    if (edit?.mode !== 'erase' && edit?.mode !== 'restore') {
      throw new TypeError('edit mode must be erase or restore.');
    }
    const x = Number(edit.x);
    const y = Number(edit.y);
    const radius = Number(edit.radius);
    const hardness = Number(edit.hardness);
    if (![x, y, radius, hardness].every(Number.isFinite) || radius < 0 || hardness < 0 || hardness > 1) {
      throw new RangeError('edit coordinates, radius, and hardness must be finite and in range.');
    }

    const left = Math.max(0, Math.ceil(x - radius));
    const right = Math.min(width - 1, Math.floor(x + radius));
    const top = Math.max(0, Math.ceil(y - radius));
    const bottom = Math.min(height - 1, Math.floor(y + radius));
    for (let pixelY = top; pixelY <= bottom; pixelY += 1) {
      for (let pixelX = left; pixelX <= right; pixelX += 1) {
        const weight = brushWeight(Math.hypot(pixelX - x, pixelY - y), radius, hardness);
        if (weight <= 0) continue;
        const offset = (pixelY * width + pixelX) * 4;
        if (edit.mode === 'erase') {
          output[offset + 3] = Math.round(output[offset + 3] * (1 - weight));
          continue;
        }
        for (let channel = 0; channel < 4; channel += 1) {
          output[offset + channel] = Math.round(
            output[offset + channel] + ((sourceRgba[offset + channel] - output[offset + channel]) * weight)
          );
        }
      }
    }
  }
  return zeroHiddenRgb(output);
}

export function interpolateStroke(from, to, spacing = 2) {
  const start = { x: Number(from?.x), y: Number(from?.y) };
  const end = { x: Number(to?.x), y: Number(to?.y) };
  const normalizedSpacing = Number(spacing);
  if (![start.x, start.y, end.x, end.y, normalizedSpacing].every(Number.isFinite) || normalizedSpacing <= 0) {
    throw new RangeError('Stroke points and spacing must contain finite values, and spacing must be positive.');
  }
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / normalizedSpacing));
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: start.x + ((end.x - start.x) * index) / steps,
    y: start.y + ((end.y - start.y) * index) / steps
  }));
}

function portableFile(value, fieldName) {
  if (!value || typeof value.path !== 'string' || typeof value.sha256 !== 'string') {
    throw new TypeError(`${fieldName} must contain path and sha256.`);
  }
  const rawPath = value.path;
  if (path.win32.isAbsolute(rawPath) || path.posix.isAbsolute(rawPath)) {
    throw new Error(`${fieldName} path must be a relative path.`);
  }
  const portablePath = rawPath.replaceAll('\\', '/');
  const normalized = path.posix.normalize(portablePath);
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') {
    throw new Error(`${fieldName} path must be a confined relative path.`);
  }
  if (!SHA256_PATTERN.test(value.sha256)) {
    throw new Error(`${fieldName} sha256 must be a lowercase SHA-256 hash.`);
  }
  return { path: normalized, sha256: value.sha256 };
}

export function createCorrectionReport(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Correction report input is required.');
  if (input.status !== 'saved') throw new TypeError('status must be saved.');
  if (!HEX_COLOR_PATTERN.test(input.key ?? '')) throw new TypeError('key must be a #RRGGBB color.');
  if (!Number.isInteger(input.attempt) || input.attempt < 1) throw new RangeError('attempt must be a positive integer.');
  if (!input.strokes || !Number.isInteger(input.strokes.erase) || input.strokes.erase < 0
    || !Number.isInteger(input.strokes.restore) || input.strokes.restore < 0) {
    throw new RangeError('strokes must contain non-negative integer erase and restore counts.');
  }

  return {
    schemaVersion: 1,
    toolVersion: '1.0.0',
    status: input.status,
    key: input.key.toLowerCase(),
    attempt: input.attempt,
    input: portableFile(input.input, 'input'),
    candidate: portableFile(input.candidate, 'candidate'),
    mask: portableFile(input.mask, 'mask'),
    output: portableFile(input.output, 'output'),
    strokes: { erase: input.strokes.erase, restore: input.strokes.restore }
  };
}

export { zeroHiddenRgb };
