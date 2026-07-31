import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  approvedInstallEnvironment,
  electronArchiveSpec,
  loadSharpFromNodeModules,
  verifyElectronArchive
} from '../lib/common.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-runtime-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function fakeSharp(root, source) {
  const sharpRoot = path.join(root, 'node_modules', 'sharp');
  fs.mkdirSync(sharpRoot, { recursive: true });
  fs.writeFileSync(path.join(sharpRoot, 'package.json'), JSON.stringify({
    name: 'sharp', version: '0.34.5', main: 'index.js'
  }));
  fs.writeFileSync(path.join(sharpRoot, 'index.js'), source, 'utf8');
  return path.join(root, 'node_modules');
}

test('Sharp diagnostics preserve missing dependency details', (t) => {
  const root = workspace(t);
  const nodeModules = fakeSharp(root, "module.exports = require('detect-libc');\n");
  assert.throws(() => loadSharpFromNodeModules(nodeModules), /detect-libc|Cannot find module/);
});

test('Sharp diagnostics expose missing platform binary details', (t) => {
  const root = workspace(t);
  const nodeModules = fakeSharp(root, "module.exports = require('@img/sharp-win32-x64');\n");
  assert.throws(() => loadSharpFromNodeModules(nodeModules), /@img\/sharp-win32-x64|Cannot find module/);
});

test('bundled Codex Sharp loads from the node_modules root when available', (t) => {
  const inferred = path.resolve(path.dirname(process.execPath), '..', 'node_modules');
  const nodeModules = process.env.CODEX_NODE_MODULES || inferred;
  if (!fs.existsSync(path.join(nodeModules, 'sharp', 'package.json'))) {
    t.skip('Codex bundled Sharp is not exposed in this test environment.');
    return;
  }
  const sharp = loadSharpFromNodeModules(nodeModules);
  assert.equal(sharp.versions.sharp, '0.34.5');
});

test('runtime lockfiles pin Sharp and Electron with integrity metadata', () => {
  const sharpPackage = JSON.parse(fs.readFileSync(path.join(skillRoot, 'assets', 'runtime-locks', 'sharp', 'package.json'), 'utf8'));
  const electronPackage = JSON.parse(fs.readFileSync(path.join(skillRoot, 'assets', 'runtime-locks', 'electron', 'package.json'), 'utf8'));
  assert.equal(sharpPackage.dependencies.sharp, '0.34.5');
  assert.equal(electronPackage.devDependencies.electron, '41.0.2');
  for (const kind of ['sharp', 'electron']) {
    const lock = fs.readFileSync(path.join(skillRoot, 'assets', 'runtime-locks', kind, 'pnpm-lock.yaml'), 'utf8');
    assert.match(lock, /integrity:/);
  }
});

test('third-party mirrors require explicit opt-in', () => {
  assert.throws(() => approvedInstallEnvironment(true, {
    CODEX_NPM_REGISTRY: 'https://registry.example.test',
    ELECTRON_MIRROR: 'https://mirror.example.test/electron/'
  }), /disabled/);
  const approved = approvedInstallEnvironment(true, {
    CODEX_ALLOW_THIRD_PARTY_MIRROR: '1',
    CODEX_NPM_REGISTRY: 'https://registry.example.test',
    ELECTRON_MIRROR: 'https://mirror.example.test/electron/'
  });
  assert.equal(approved.registry, 'https://registry.example.test');
  assert.equal(approved.env.ELECTRON_MIRROR, 'https://mirror.example.test/electron/');
});

test('Electron archive specs and checksums are exact', (t) => {
  assert.deepEqual(electronArchiveSpec('win32', 'x64'), {
    filename: 'electron-v41.0.2-win32-x64.zip',
    sha256: 'dcd36396a606a5ae2f5651b4ee6bb463a624dbf15f786eda57cee2cc361c138c'
  });
  assert.deepEqual(electronArchiveSpec('darwin', 'arm64'), {
    filename: 'electron-v41.0.2-darwin-arm64.zip',
    sha256: '8e18ef53da62bca6132508721c1f94e06b5773b48d366b95e593479892f0a2fe'
  });
  assert.throws(() => electronArchiveSpec('linux', 'x64'), /No trusted Electron archive/);
  const root = workspace(t);
  const archive = path.join(root, 'archive.zip');
  fs.writeFileSync(archive, 'verified archive fixture');
  const expected = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  assert.equal(verifyElectronArchive(archive, expected), expected);
  assert.throws(() => verifyElectronArchive(archive, '0'.repeat(64)), /checksum mismatch/);
});

test('locked Sharp fallback installs and loads when explicitly enabled', { skip: process.env.LOVE_ROOMMATE_TEST_SHARP_FALLBACK !== '1' }, (t) => {
  const root = workspace(t);
  const runtimeRoot = path.join(root, 'sharp-runtime');
  const pnpm = process.env.CODEX_PNPM;
  assert.ok(pnpm && fs.existsSync(pnpm), 'CODEX_PNPM must point to the Codex pnpm executable.');
  const moduleUrl = pathToFileURL(path.join(skillRoot, 'scripts', 'lib', 'common.mjs')).href;
  const script = `import { loadSharp } from ${JSON.stringify(moduleUrl)}; console.log(loadSharp('.').versions.sharp);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_NODE_MODULES: path.join(root, 'missing-node-modules'),
      CODEX_SHARP_RUNTIME_ROOT: runtimeRoot
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0\.34\.5/);
  assert.equal(fs.existsSync(path.join(runtimeRoot, 'pnpm-lock.yaml')), true);
});
