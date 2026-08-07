import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  nextTransparencyAttempt,
  selectKeySequence,
  validateCorrectionLineage
} from '../lib/transparency-retry.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('selectKeySequence 按与主体颜色的最小 Lab 距离降序选择且结果确定', () => {
  const palette = ['#ff0000', '#00ff00', '#0000ff'];
  const first = selectKeySequence(['#ff1010'], palette);
  const second = selectKeySequence(['#ff1010'], palette);

  assert.deepEqual(first, second);
  assert.deepEqual(new Set(first).size, 3);
  assert.equal(first.at(-1), '#ff0000');
  assert.deepEqual([...first].sort(), [...palette].sort());
});

test('nextTransparencyAttempt 最多产生三次且键色不重复', () => {
  const keys = ['#ff00ff', '#00ff00', '#0066ff'];
  assert.deepEqual(nextTransparencyAttempt([], 3, keys), {
    status: 'generate', attempt: 1, key: '#ff00ff'
  });
  assert.deepEqual(nextTransparencyAttempt([
    { attempt: 1, key: '#ff00ff', status: 'rejected', rejectionReason: 'visible-spill' }
  ], 3, keys), { status: 'generate', attempt: 2, key: '#00ff00' });
  assert.deepEqual(nextTransparencyAttempt([
    { attempt: 1, key: '#ff00ff', status: 'rejected', rejectionReason: 'visible-spill' },
    { attempt: 2, key: '#00ff00', status: 'rejected', rejectionReason: 'foreground-damage' }
  ], 3, keys), { status: 'generate', attempt: 3, key: '#0066ff' });
  assert.deepEqual(nextTransparencyAttempt([
    { attempt: 1, key: '#ff00ff', status: 'rejected', rejectionReason: 'visible-spill' },
    { attempt: 2, key: '#00ff00', status: 'rejected', rejectionReason: 'foreground-damage' },
    { attempt: 3, key: '#0066ff', status: 'rejected', rejectionReason: 'visible-spill' }
  ], 3, keys), { status: 'manual-repair-required', attempt: 3, key: null });
});

test('nextTransparencyAttempt 遇到已接受候选立即停止', () => {
  assert.deepEqual(nextTransparencyAttempt([
    { attempt: 1, key: '#ff00ff', status: 'rejected', rejectionReason: 'visible-spill' },
    { attempt: 2, key: '#00ff00', status: 'accepted' }
  ]), { status: 'accepted', attempt: 2, key: '#00ff00' });
});

test('validateCorrectionLineage 校验报告哈希、相对路径、四个文件哈希和最终指纹', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-lineage-'));
  try {
    const names = ['input.png', 'candidate.png', 'mask.png', 'output.png'];
    const files = Object.fromEntries(names.map((name) => {
      const relative = `preview/corrections/${name}`;
      const absolute = path.join(root, ...relative.split('/'));
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const bytes = Buffer.from(`fixture:${name}`);
      fs.writeFileSync(absolute, bytes);
      return [name.replace('.png', ''), { path: relative, sha256: hash(bytes) }];
    }));
    const report = {
      schemaVersion: 1,
      toolVersion: '1.0.0',
      status: 'saved',
      key: '#ff00ff',
      attempt: 3,
      input: files.input,
      candidate: files.candidate,
      mask: files.mask,
      output: files.output,
      strokes: { erase: 2, restore: 1 }
    };
    const reportRelative = 'preview/corrections/report.json';
    const reportAbsolute = path.join(root, ...reportRelative.split('/'));
    fs.writeFileSync(reportAbsolute, `${JSON.stringify(report, null, 2)}\n`);
    const entry = {
      file: files.output.path,
      sha256: files.output.sha256,
      transparencyRecovery: {
        attempt: 3,
        key: '#ff00ff',
        correctionReport: reportRelative,
        correctionReportSha256: hash(fs.readFileSync(reportAbsolute))
      }
    };

    assert.deepEqual(validateCorrectionLineage(root, entry), []);
    fs.appendFileSync(reportAbsolute, ' ');
    assert.match(validateCorrectionLineage(root, entry).join('\n'), /报告 SHA-256 不匹配/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validateCorrectionLineage 拒绝绝对报告路径和不一致的最终输出', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-lineage-'));
  try {
    const entry = {
      file: 'preview/current.png',
      sha256: 'a'.repeat(64),
      transparencyRecovery: {
        attempt: 2,
        key: '#00ff00',
        correctionReport: path.join(root, 'report.json'),
        correctionReportSha256: 'b'.repeat(64)
      }
    };
    assert.match(validateCorrectionLineage(root, entry).join('\n'), /必须是相对路径/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('record_image_generation 记录修正报告相对路径、哈希和有限尝试元数据', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-record-'));
  try {
    const preview = path.join(root, 'preview');
    const correctionDir = path.join(preview, 'corrections');
    fs.mkdirSync(correctionDir, { recursive: true });
    const files = {};
    for (const name of ['input', 'candidate', 'mask', 'output']) {
      const absolute = path.join(correctionDir, `${name}.png`);
      fs.writeFileSync(absolute, Buffer.from(`fixture:${name}`));
      files[name] = {
        path: `preview/corrections/${name}.png`,
        sha256: hash(fs.readFileSync(absolute))
      };
    }
    const report = {
      schemaVersion: 1, toolVersion: '1.0.0', status: 'saved', key: '#0066ff', attempt: 3,
      input: files.input, candidate: files.candidate, mask: files.mask, output: files.output,
      strokes: { erase: 1, restore: 1 }
    };
    const reportPath = path.join(correctionDir, 'report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    const script = path.resolve('scripts/record_image_generation.mjs');
    const result = spawnSync(process.execPath, [
      script, '--preview', preview, '--file', path.join(correctionDir, 'output.png'),
      '--kind', 'master', '--character', 'person-1', '--prompt-version', 'v1', '--version', '1',
      '--transparency-attempt', '3', '--transparency-key', '#0066ff',
      '--rejection-reason', 'automatic-attempts-exhausted',
      '--correction-report', 'preview/corrections/report.json'
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(preview, 'generation-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.assets[0].transparencyRecovery, {
      attempt: 3,
      key: '#0066ff',
      rejectionReason: 'automatic-attempts-exhausted',
      correctionReport: 'preview/corrections/report.json',
      correctionReportSha256: hash(fs.readFileSync(reportPath))
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('record_image_generation 拒绝第 4 次透明恢复', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-record-'));
  try {
    const preview = path.join(root, 'preview');
    fs.mkdirSync(preview, { recursive: true });
    const file = path.join(preview, 'master.png');
    fs.writeFileSync(file, 'fixture');
    const result = spawnSync(process.execPath, [
      path.resolve('scripts/record_image_generation.mjs'), '--preview', preview, '--file', file,
      '--kind', 'master', '--character', 'person-1', '--prompt-version', 'v1', '--version', '1',
      '--transparency-attempt', '4', '--transparency-key', '#ff00ff'
    ], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /1\.\.3|1 到 3/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('self_check_project 将修正链路错误升级为 error 门禁', () => {
  const source = fs.readFileSync(path.resolve('scripts/self_check_project.mjs'), 'utf8');
  assert.match(source, /validateCorrectionLineage/);
  assert.match(source, /invalid-transparency-correction-lineage/);
  assert.match(source, /addIssue\('error'/);
});
