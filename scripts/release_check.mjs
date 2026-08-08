import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnPnpm } from './lib/common.mjs';
import { defaultPythonCandidates, probePythonCandidates } from './lib/official-validator.mjs';
import { auditTextFilesForSensitivePaths } from './lib/privacy.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: skillRoot, stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) failures.push(`${label} failed with exit code ${result.status}.`);
}

function runPnpm(label, args, options = {}) {
  const result = spawnPnpm(args, { cwd: skillRoot, stdio: 'inherit', ...options });
  if (result.status !== 0) failures.push(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
}

function filesUnder(root, predicate) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && predicate(full)) files.push(full);
    }
  }
  return files;
}

for (const file of filesUnder(skillRoot, (file) => ['.js', '.mjs'].includes(path.extname(file)))) {
  run(`Syntax check ${path.relative(skillRoot, file)}`, process.execPath, ['--check', file]);
}
run('Skill repository privacy audit', process.execPath, [path.join(skillRoot, 'scripts', 'audit_skill_release.mjs')]);
const lockRoots = ['sharp', 'electron'].map((kind) => path.join(skillRoot, 'assets', 'runtime-locks', kind));
for (const lockRoot of lockRoots) {
  if (!fs.existsSync(path.join(lockRoot, 'pnpm-lock.yaml'))) failures.push(`Missing lockfile: ${path.relative(skillRoot, lockRoot)}`);
}
const pnpmAvailable = spawnPnpm(['--version'], { stdio: 'ignore' }).status === 0;
if (!pnpmAvailable) failures.push('pnpm is required to validate frozen runtime lockfiles. Pass --pnpm through CODEX_PNPM or install the pinned CI pnpm.');
else {
  for (const lockRoot of lockRoots) runPnpm(
    `Frozen lockfile ${path.basename(lockRoot)}`,
    ['install', '--lockfile-only', '--frozen-lockfile', '--registry', 'https://registry.npmjs.org'],
    { cwd: lockRoot }
  );
}
run('Security hardening tests', process.execPath, ['--test', path.join(skillRoot, 'scripts', 'tests', 'security-hardening.test.mjs'), path.join(skillRoot, 'scripts', 'tests', 'runtime-security.test.mjs')]);
run('Portrait chroma and transparency recovery tests', process.execPath, ['--test',
  path.join(skillRoot, 'scripts', 'tests', 'portrait-chroma.test.mjs'),
  path.join(skillRoot, 'scripts', 'tests', 'repair-transparency-cli.test.mjs'),
  path.join(skillRoot, 'scripts', 'tests', 'transparency-repair.test.mjs'),
  path.join(skillRoot, 'scripts', 'tests', 'transparency-repair-security.test.mjs'),
  path.join(skillRoot, 'scripts', 'tests', 'mask-editor-contract.test.mjs'),
  path.join(skillRoot, 'scripts', 'tests', 'transparency-retry.test.mjs'),
  path.join(skillRoot, 'scripts', 'tests', 'trusted-corrected-processing.test.mjs')
]);
run('Template unit tests', process.execPath, ['--test', path.join(skillRoot, 'assets', 'electron-template', 'tests', 'behavior-engine.test.mjs'), path.join(skillRoot, 'assets', 'electron-template', 'tests', 'performance-v2.test.mjs'), path.join(skillRoot, 'assets', 'electron-template', 'tests', 'performance-audit.test.mjs'), path.join(skillRoot, 'assets', 'electron-template', 'tests', 'config.test.mjs'), path.join(skillRoot, 'assets', 'electron-template', 'tests', 'security.test.mjs'), path.join(skillRoot, 'assets', 'electron-template', 'tests', 'scenario-capture.test.mjs'), path.join(skillRoot, 'assets', 'electron-template', 'tests', 'window-size-regression.test.mjs'), path.join(skillRoot, 'assets', 'electron-template', 'tests', 'validate-project.test.mjs')]);
run('Release policy tests', process.execPath, ['--test',
  path.join(skillRoot, 'scripts', 'tests', 'release-policy.test.mjs'),
  path.join(skillRoot, 'scripts', 'tests', 'action-contract.test.mjs'),
  path.join(skillRoot, 'scripts', 'tests', 'scenario-sequence-evidence.test.mjs'),
  path.join(skillRoot, 'scripts', 'tests', 'performance-gate.test.mjs'),
  path.join(skillRoot, 'scripts', 'tests', 'performance-contract-v4.test.mjs'),
  path.join(skillRoot, 'scripts', 'tests', 'utf8-integrity.test.mjs')
]);
run('macOS Electron runtime layout tests', process.execPath, ['--test', path.join(skillRoot, 'scripts', 'tests', 'macos-electron-runtime.test.mjs')]);
for (const issue of auditTextFilesForSensitivePaths(skillRoot, new Set(['.json', '.md', '.yaml', '.yml', '.txt']))) {
  failures.push(`${issue.file} contains absolute/private path text.`);
}

if (process.env.SKIP_OFFICIAL_VALIDATOR !== '1') {
  const probe = probePythonCandidates(defaultPythonCandidates());
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const validator = process.env.OFFICIAL_VALIDATOR_PATH
    ? path.resolve(process.env.OFFICIAL_VALIDATOR_PATH)
    : path.join(codexHome, 'skills', '.system', 'skill-creator', 'scripts', 'quick_validate.py');
  if (!probe.python) failures.push(probe.message);
  else if (fs.existsSync(validator)) run('Official Skill validation', probe.python.command, [...probe.python.prefixArgs, '-X', 'utf8', validator, '.']);
  else failures.push(`Official validator not found at ${validator}. Set OFFICIAL_VALIDATOR_PATH or explicitly opt out with SKIP_OFFICIAL_VALIDATOR=1.`);
}

if (failures.length) {
  console.error('Release check failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Release check passed.');
