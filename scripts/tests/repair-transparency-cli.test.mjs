import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { composeCorrectionFiles } from '../repair_transparency.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'love-roommate-cli-'));
  const input = path.join(root, 'preview', 'source.png');
  const candidate = path.join(root, 'preview', 'candidate.png');
  const out = path.join(root, 'preview', 'corrections', 'corrected.png');
  const mask = path.join(root, 'preview', 'corrections', 'mask.png');
  const report = path.join(root, 'preview', 'corrections', 'report.json');
  await mkdir(path.dirname(input), { recursive: true });
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(input, 'source-png');
  await writeFile(candidate, 'candidate-png');
  return { root, input, candidate, out, mask, report };
}

test('composition preserves a restored key-colour subject pixel and fully clears erased RGB/alpha', async () => {
  const files = await fixture();
  const sourceRgba = Buffer.from([255, 0, 255, 255, 20, 30, 40, 255]);
  const candidateRgba = Buffer.from([0, 0, 0, 0, 20, 30, 40, 255]);
  const codec = {
    decode: async (file) => ({
      data: Buffer.from(file === files.input ? sourceRgba : candidateRgba),
      width: 2,
      height: 1,
    }),
    encodeRgba: async (rgba) => Buffer.from(rgba),
    encodeMask: async (alpha) => Buffer.from(alpha),
  };

  const result = await composeCorrectionFiles({
    ...files,
    key: '#ff00ff',
    attempt: 3,
    codec,
    payload: {
      key: '#ff00ff',
      attempt: 3,
      edits: [
        { mode: 'restore', x: 0, y: 0, radius: 0, hardness: 1 },
        { mode: 'erase', x: 1, y: 0, radius: 0, hardness: 1 },
      ],
      strokeCounts: { erase: 1, restore: 1 },
    },
  });

  const corrected = await readFile(files.out);
  assert.deepEqual([...corrected], [255, 0, 255, 255, 0, 0, 0, 0]);
  assert.deepEqual([...(await readFile(files.mask))], [255, 0]);
  const report = JSON.parse(await readFile(files.report, 'utf8'));
  assert.equal(report.status, 'saved');
  assert.equal(report.key, '#ff00ff');
  assert.deepEqual(report.strokes, { erase: 1, restore: 1 });
  assert.equal(report.output.sha256, sha256(corrected));
  assert.equal(result.status, 'saved');
});
test('composition rejects key or attempt tampering from the browser payload', async () => {
  const files = await fixture();
  const codec = {
    decode: async () => ({ data: Buffer.alloc(4), width: 1, height: 1 }),
    encodeRgba: async (rgba) => Buffer.from(rgba),
    encodeMask: async (alpha) => Buffer.from(alpha),
  };
  await assert.rejects(composeCorrectionFiles({
    ...files,
    key: '#ff00ff',
    attempt: 2,
    codec,
    payload: { key: '#00ff00', attempt: 2, edits: [], strokeCounts: { erase: 0, restore: 0 } },
  }), /session key/i);
});
