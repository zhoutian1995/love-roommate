import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_TRANSPARENCY_ATTEMPTS = 3;
export const DEFAULT_KEY_PALETTE = Object.freeze(['#ff00ff', '#00ff00', '#0066ff']);

const HEX = /^#[0-9a-f]{6}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function parseHex(value) {
  if (!HEX.test(String(value))) throw new TypeError(`无效的键色：${value}`);
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(value) {
  const [r, g, b] = parseHex(value).map(srgbToLinear);
  const x = ((r * 0.4124564) + (g * 0.3575761) + (b * 0.1804375)) / 0.95047;
  const y = ((r * 0.2126729) + (g * 0.7151522) + (b * 0.0721750));
  const z = ((r * 0.0193339) + (g * 0.1191920) + (b * 0.9503041)) / 1.08883;
  const f = (component) => component > 216 / 24389
    ? Math.cbrt(component)
    : ((24389 / 27) * component + 16) / 116;
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [(116 * fy) - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

export function selectKeySequence(subjectColors, palette = DEFAULT_KEY_PALETTE) {
  if (!Array.isArray(subjectColors) || subjectColors.length === 0) {
    throw new TypeError('subjectColors 必须至少包含一种 #RRGGBB 颜色。');
  }
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new TypeError('palette 必须至少包含一种 #RRGGBB 颜色。');
  }
  const subjects = subjectColors.map(rgbToLab);
  const unique = [...new Set(palette.map((color) => {
    if (!HEX.test(String(color))) throw new TypeError(`无效的键色：${color}`);
    return String(color).toLowerCase();
  }))];
  return unique
    .map((key, index) => ({
      key,
      index,
      score: Math.min(...subjects.map((subject) => deltaE(rgbToLab(key), subject)))
    }))
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))
    .map(({ key }) => key);
}

export function nextTransparencyAttempt(history, maxAttempts = MAX_TRANSPARENCY_ATTEMPTS, keySequence = DEFAULT_KEY_PALETTE) {
  if (!Array.isArray(history)) throw new TypeError('history 必须是数组。');
  const limit = Math.min(MAX_TRANSPARENCY_ATTEMPTS, Number(maxAttempts));
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('maxAttempts 必须是 1 到 3 的整数。');
  const accepted = history.find((item) => item?.status === 'accepted');
  if (accepted) return { status: 'accepted', attempt: accepted.attempt, key: accepted.key };
  const completed = history.filter((item) => item?.status === 'rejected');
  if (completed.length >= limit) return { status: 'manual-repair-required', attempt: limit, key: null };
  const usedKeys = new Set(history.map((item) => String(item?.key || '').toLowerCase()).filter(Boolean));
  const key = keySequence.map((item) => String(item).toLowerCase()).find((item) => !usedKeys.has(item));
  if (!key) return { status: 'manual-repair-required', attempt: completed.length, key: null };
  return { status: 'generate', attempt: completed.length + 1, key };
}

function fileSha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function resolvePortableFile(outputRoot, relative, label, errors) {
  if (typeof relative !== 'string' || !relative || path.win32.isAbsolute(relative) || path.posix.isAbsolute(relative)) {
    errors.push(`${label}必须是相对路径。`);
    return null;
  }
  const normalized = relative.replaceAll('\\', '/');
  if (normalized !== relative || normalized.split('/').includes('..') || !normalized.startsWith('preview/')) {
    errors.push(`${label}必须是 preview/ 内的可移植相对路径。`);
    return null;
  }
  const resolved = path.resolve(outputRoot, ...normalized.split('/'));
  const root = path.resolve(outputRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    errors.push(`${label}超出输出目录。`);
    return null;
  }
  return resolved;
}

export function validateCorrectionLineage(outputRoot, entry) {
  const errors = [];
  const recovery = entry?.transparencyRecovery;
  if (!recovery) return errors;
  if (!Number.isInteger(recovery.attempt) || recovery.attempt < 1 || recovery.attempt > MAX_TRANSPARENCY_ATTEMPTS) {
    errors.push('透明恢复 attempt 必须是 1 到 3。');
  }
  if (!HEX.test(String(recovery.key || ''))) errors.push('透明恢复 key 必须是 #RRGGBB。');
  if (!recovery.correctionReport) return errors;
  if (!SHA256.test(String(recovery.correctionReportSha256 || ''))) errors.push('修正报告 SHA-256 格式无效。');
  const reportFile = resolvePortableFile(outputRoot, recovery.correctionReport, '修正报告路径', errors);
  if (!reportFile || !fs.existsSync(reportFile) || !fs.statSync(reportFile).isFile()) {
    if (reportFile) errors.push('修正报告不存在。');
    return errors;
  }
  if (fileSha(reportFile) !== recovery.correctionReportSha256) errors.push('修正报告 SHA-256 不匹配。');
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  } catch {
    errors.push('修正报告不是有效 JSON。');
    return errors;
  }
  if (report.schemaVersion !== 1 || report.status !== 'saved' || report.toolVersion !== '1.0.0') errors.push('修正报告 schema 无效。');
  if (report.attempt !== recovery.attempt || String(report.key || '').toLowerCase() !== String(recovery.key || '').toLowerCase()) {
    errors.push('修正报告的 attempt/key 与 generation manifest 不一致。');
  }
  for (const field of ['input', 'candidate', 'mask', 'output']) {
    const item = report[field];
    if (!item || !SHA256.test(String(item.sha256 || ''))) {
      errors.push(`修正报告 ${field} SHA-256 格式无效。`);
      continue;
    }
    const file = resolvePortableFile(outputRoot, item.path, `修正报告 ${field} 路径`, errors);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (file) errors.push(`修正报告 ${field} 文件不存在。`);
      continue;
    }
    if (fileSha(file) !== item.sha256) errors.push(`修正报告 ${field} SHA-256 不匹配。`);
  }
  if (report.output?.path !== entry.file || report.output?.sha256 !== entry.sha256) {
    errors.push('修正报告最终输出与当前母版/动作 fingerprint 不一致。');
  }
  return errors;
}
