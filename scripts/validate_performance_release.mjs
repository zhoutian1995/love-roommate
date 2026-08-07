import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, readJson } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const singleValidator = path.join(scriptRoot, 'validate_performance_report.mjs');
const required = ['project', 'report', 'executable', 'packaged-root'];
const groups = [
  { label: 'five', count: 5 },
  { label: 'eight', count: 8 }
];
const errors = [];
if (process.platform !== 'win32') errors.push('Packaged performance release evidence must be validated on Windows.');
if (process.arch !== 'x64') errors.push('Packaged performance release evidence must be validated on Windows x64.');

for (const group of groups) {
  for (const field of required) {
    const key = `${group.label}-${field}`;
    if (typeof args[key] !== 'string' || !args[key]) errors.push(`Missing --${key}.`);
  }
}

if (!errors.length) {
  for (const group of groups) {
    const prefix = group.label;
    const result = spawnSync(process.execPath, [singleValidator,
      '--project', path.resolve(args[`${prefix}-project`]),
      '--report', path.resolve(args[`${prefix}-report`]),
      '--executable', path.resolve(args[`${prefix}-executable`]),
      '--packaged-root', path.resolve(args[`${prefix}-packaged-root`])
    ], { cwd: scriptRoot, encoding: 'utf8', shell: false });
    if (result.status !== 0) errors.push(`${prefix} report failed single-report validation: ${String(result.stderr || result.stdout || '').trim()}`);
  }
}

if (!errors.length) {
  const five = readJson(path.resolve(args['five-report']));
  const eight = readJson(path.resolve(args['eight-report']));
  if (five.platform !== 'win32' || eight.platform !== 'win32') errors.push('Five-window and eight-window reports must both come from Windows.');
  if (five.arch !== 'x64' || eight.arch !== 'x64') errors.push('Five-window and eight-window reports must both use x64.');
  if (five.expectedWindowCount !== 5 || five.windowCount !== 5 || five.expectedPetIds?.length !== 5) errors.push('Five-window report does not prove exactly five pet windows.');
  if (eight.expectedWindowCount !== 8 || eight.windowCount !== 8 || eight.expectedPetIds?.length !== 8) errors.push('Eight-window report does not prove exactly eight pet windows.');
  if (JSON.stringify(five.thresholds) !== JSON.stringify(eight.thresholds)) errors.push('Five-window and eight-window thresholds differ; release thresholds must not be relaxed.');
  if (!/^[a-f0-9]{64}$/.test(five.candidateFingerprint || '') || five.candidateFingerprint !== eight.candidateFingerprint) {
    errors.push('Five-window and eight-window candidate fingerprints must match exactly.');
  }
  if (five.platform !== eight.platform || five.arch !== eight.arch || five.runtime?.electronVersion !== eight.runtime?.electronVersion) {
    errors.push('Five-window and eight-window reports must use the same Windows architecture and Electron runtime.');
  }
}

if (errors.length) {
  console.error(`Packaged performance release evidence invalid:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log('5+8 packaged performance release evidence valid.');
