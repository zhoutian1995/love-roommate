import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyMaskEdits,
  createCorrectionReport,
  interpolateStroke,
  zeroHiddenRgb
} from '../lib/transparency-repair.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

test('erase clears alpha and RGB while restore uses source RGBA without mutating inputs', () => {
  const source = Buffer.from([250, 190, 170, 255, 30, 40, 50, 255]);
  const candidate = Buffer.from(source);
  const sourceBefore = Buffer.from(source);
  const candidateBefore = Buffer.from(candidate);

  const erased = applyMaskEdits({
    sourceRgba: source,
    candidateRgba: candidate,
    width: 2,
    height: 1,
    edits: [{ mode: 'erase', x: 0, y: 0, radius: 0, hardness: 1 }]
  });
  assert.deepEqual([...erased.subarray(0, 4)], [0, 0, 0, 0]);

  const restored = applyMaskEdits({
    sourceRgba: source,
    candidateRgba: erased,
    width: 2,
    height: 1,
    edits: [{ mode: 'restore', x: 0, y: 0, radius: 0, hardness: 1 }]
  });
  assert.deepEqual([...restored.subarray(0, 4)], [250, 190, 170, 255]);
  assert.deepEqual(source, sourceBefore);
  assert.deepEqual(candidate, candidateBefore);
});

test('soft brush applies full weight in the hard core and falls off toward the radius', () => {
  const source = Buffer.from([
    10, 20, 30, 255,
    10, 20, 30, 255,
    10, 20, 30, 255,
    10, 20, 30, 255,
    10, 20, 30, 255
  ]);
  const output = applyMaskEdits({
    sourceRgba: source,
    candidateRgba: source,
    width: 5,
    height: 1,
    edits: [{ mode: 'erase', x: 2, y: 0, radius: 2, hardness: 0.5 }]
  });

  assert.equal(output[2 * 4 + 3], 0);
  assert.equal(output[1 * 4 + 3], 0);
  assert.equal(output[0 * 4 + 3], 255);
  assert.equal(output[4 * 4 + 3], 255);
});

test('interpolateStroke includes endpoints and has no gap larger than spacing', () => {
  const points = interpolateStroke({ x: 0, y: 0 }, { x: 20, y: 0 }, 3);
  assert.deepEqual(points[0], { x: 0, y: 0 });
  assert.deepEqual(points.at(-1), { x: 20, y: 0 });
  for (let index = 1; index < points.length; index += 1) {
    assert.ok(Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y
    ) <= 3);
  }
});

test('zeroHiddenRgb clears only RGB of fully transparent pixels and does not mutate input', () => {
  const input = Buffer.from([99, 88, 77, 0, 11, 22, 33, 1]);
  const before = Buffer.from(input);
  const output = zeroHiddenRgb(input);
  assert.deepEqual([...output], [0, 0, 0, 0, 11, 22, 33, 1]);
  assert.deepEqual(input, before);
});

test('createCorrectionReport returns a portable deterministic allowlisted report', () => {
  const report = createCorrectionReport({
    status: 'saved',
    key: '#ff00ff',
    attempt: 2,
    input: { path: 'preview/person-2-master-v2.png', sha256: SHA_A },
    candidate: { path: 'preview/person-2-master-v2-transparent.png', sha256: SHA_B },
    mask: { path: 'preview/corrections/person-2-master-v2-mask.png', sha256: SHA_C },
    output: { path: 'preview/corrections/person-2-master-v2-corrected.png', sha256: SHA_D },
    strokes: { erase: 4, restore: 2 },
    hostname: 'must-not-leak',
    createdAt: '2026-08-05T00:00:00.000Z'
  });

  assert.deepEqual(Object.keys(report), [
    'schemaVersion', 'toolVersion', 'status', 'key', 'attempt',
    'input', 'candidate', 'mask', 'output', 'strokes'
  ]);
  assert.equal(report.input.path, 'preview/person-2-master-v2.png');
  for (const file of [report.input, report.candidate, report.mask, report.output]) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(file.path, /\\/);
    assert.equal(file.path.startsWith('/'), false);
  }
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /must-not-leak|2026-08-05T/);
});

test('createCorrectionReport rejects absolute paths and malformed hashes', () => {
  const base = {
    status: 'saved',
    key: '#ff00ff',
    attempt: 1,
    input: { path: 'preview/input.png', sha256: SHA_A },
    candidate: { path: 'preview/candidate.png', sha256: SHA_B },
    mask: { path: 'preview/corrections/mask.png', sha256: SHA_C },
    output: { path: 'preview/corrections/output.png', sha256: SHA_D },
    strokes: { erase: 1, restore: 0 }
  };

  assert.throws(
    () => createCorrectionReport({
      ...base,
      input: {
        ...base.input,
        path: ['X:', 'fixture', 'input.png'].join(String.fromCharCode(92))
      }
    }),
    /relative path/i
  );
  assert.throws(
    () => createCorrectionReport({ ...base, output: { ...base.output, sha256: 'not-a-hash' } }),
    /sha-256/i
  );
  assert.throws(
    () => createCorrectionReport({ ...base, status: '2026-08-05T00:00:00.000Z' }),
    /status/i
  );
});
