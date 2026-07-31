import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditTextFilesForSensitivePaths } from './lib/privacy.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: skillRoot, stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd'), ...options });
  if (result.status !== 0) failures.push(`${label} failed with exit code ${result.status}.`);
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
const pnpmCandidates = [process.env.CODEX_PNPM, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'].filter(Boolean);
const pnpm = pnpmCandidates.find((candidate) => spawnSync(candidate, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' && candidate.endsWith('.cmd') }).status === 0);
if (!pnpm) failures.push('pnpm is required to validate frozen runtime lockfiles. Pass --pnpm through CODEX_PNPM or install the pinned CI pnpm.');
else {
  for (const lockRoot of lockRoots) run(`Frozen lockfile ${path.basename(lockRoot)}`, pnpm, ['install', '--lockfile-only', '--frozen-lockfile', '--registry', 'https://registry.npmjs.org'], { cwd: lockRoot });
}
run('Security hardening tests', process.execPath, ['--test', path.join(skillRoot, 'scripts', 'tests', 'security-hardening.test.mjs'), path.join(skillRoot, 'scripts', 'tests', 'runtime-security.test.mjs')]);
run('Template unit tests', process.execPath, ['--test', path.join(skillRoot, 'assets', 'electron-template', 'tests', 'behavior-engine.test.mjs'), path.join(skillRoot, 'assets', 'electron-template', 'tests', 'config.test.mjs'), path.join(skillRoot, 'assets', 'electron-template', 'tests', 'security.test.mjs')]);
for (const issue of auditTextFilesForSensitivePaths(skillRoot, new Set(['.json', '.md', '.yaml', '.yml', '.txt']))) {
  failures.push(`${issue.file} contains absolute/private path text.`);
}

if (process.env.SKIP_OFFICIAL_VALIDATOR !== '1') {
  const candidates = [
    process.env.CODEX_PYTHON,
    process.platform === 'win32' ? 'python.exe' : 'python3',
    'python'
  ].filter(Boolean);
  const python = candidates.find((candidate) => {
    const result = spawnSync(candidate, ['-c', 'import yaml'], { stdio: 'ignore' });
    return result.status === 0;
  });
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const validator = process.env.OFFICIAL_VALIDATOR_PATH
    ? path.resolve(process.env.OFFICIAL_VALIDATOR_PATH)
    : path.join(codexHome, 'skills', '.system', 'skill-creator', 'scripts', 'quick_validate.py');
  if (!python) failures.push('No Python with PyYAML found for official Skill validation. Install PyYAML or set SKIP_OFFICIAL_VALIDATOR=1 if you only need repo-level checks.');
  else if (fs.existsSync(validator)) run('Official Skill validation', python, [validator, '.']);
  else failures.push(`Official validator not found at ${validator}. Set OFFICIAL_VALIDATOR_PATH or explicitly opt out with SKIP_OFFICIAL_VALIDATOR=1.`);
}

if (failures.length) {
  console.error('Release check failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Release check passed.');
