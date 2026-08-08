import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { composeCorrectionFiles } from '../repair_transparency.mjs';
import { preparePortraitAlpha } from '../lib/sprite-processing.mjs';

test('修正输出再次进入 trusted processing 后仍保留人工恢复的 exact/near-key 主体', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'love-roommate-trusted-'));
  const input = path.join(root, 'preview', 'source.png');
  const candidate = path.join(root, 'preview', 'candidate.png');
  const corrections = path.join(root, 'preview', 'corrections');
  const out = path.join(corrections, 'corrected.png');
  const mask = path.join(corrections, 'mask.png');
  const report = path.join(corrections, 'report.json');
  await mkdir(corrections, { recursive: true });
  await writeFile(input, 'source');
  await writeFile(candidate, 'candidate');
  const sourceRgba = Buffer.from([255, 0, 255, 255, 240, 8, 240, 255, 20, 30, 40, 255]);
  const candidateRgba = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 20, 30, 40, 255]);
  const codec = {
    decode: async file => ({ data: Buffer.from(file === input ? sourceRgba : candidateRgba), width: 3, height: 1 }),
    encodeRgba: async rgba => Buffer.from(rgba),
    encodeMask: async alpha => Buffer.from(alpha)
  };

  await composeCorrectionFiles({
    root, input, candidate, out, mask, report, key: '#ff00ff', attempt: 3, codec,
    payload: {
      key: '#ff00ff', attempt: 3,
      edits: [
        { mode: 'restore', x: 0, y: 0, radius: 0, hardness: 1 },
        { mode: 'restore', x: 1, y: 0, radius: 0, hardness: 1 }
      ],
      strokeCounts: { erase: 0, restore: 2 }
    }
  });

  const corrected = await readFile(out);
  const processed = preparePortraitAlpha(corrected, 3, 1, [255, 0, 255], 28, 105, { trustedCorrected: true });
  assert.deepEqual([...processed.subarray(0, 4)], [255, 0, 255, 255]);
  assert.deepEqual([...processed.subarray(4, 8)], [240, 8, 240, 255]);
});

test('动作处理器只对有 correctionReport 血缘的生成记录启用 trusted corrected 模式', async () => {
  const script = await readFile(new URL('../process_action_sprite.mjs', import.meta.url), 'utf8');
  assert.match(script, /transparencyRecovery\?\.correctionReport/);
  assert.match(script, /validateCorrectionLineage/);
  assert.match(script, /trustedCorrected/);
  assert.match(script, /preparePortraitAlpha\([\s\S]*trustedCorrected/);
});
