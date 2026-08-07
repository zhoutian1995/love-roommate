import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repairMissingMacFrameworkSymlinks } from '../lib/common.mjs';

test('macOS packaging ad-hoc signs and strictly verifies the app after plist and resource changes', () => {
  const packagerSource = fs.readFileSync(
    new URL('../../assets/electron-template/tools/package-current.mjs', import.meta.url),
    'utf8'
  );
  const installIndex = packagerSource.indexOf("installApp(path.join(contents, 'Resources'))");
  const plistIndex = packagerSource.indexOf("spawnSync('/usr/bin/plutil'");
  const signIndex = packagerSource.indexOf("spawnSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', output]");
  const verifyIndex = packagerSource.indexOf("spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', output]");
  const reportIndex = packagerSource.indexOf("console.log(JSON.stringify({ platform: 'macos'");

  assert.ok(installIndex >= 0, 'macOS packaging must install app resources');
  assert.ok(plistIndex > installIndex, 'macOS packaging must update Info.plist after installing resources');
  assert.ok(signIndex > plistIndex, 'macOS packaging must ad-hoc sign after plist and resource mutations');
  assert.ok(verifyIndex > signIndex, 'macOS packaging must strictly verify after signing');
  assert.ok(reportIndex > verifyIndex, 'macOS packaging must not report success before signature verification');
});

test('repairs only the three pinned macOS framework symlinks when their in-bundle targets exist', (t) => {
  if (process.platform !== 'darwin') return t.skip('macOS-only filesystem semantics');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-electron-links-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const framework = path.join(
    root,
    'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Frameworks',
    'Electron Framework.framework'
  );
  fs.mkdirSync(path.join(framework, 'Versions', 'A', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(framework, 'Versions', 'A', 'Electron Framework'), 'fixture');
  fs.cpSync(path.join(framework, 'Versions', 'A'), path.join(framework, 'Versions', 'Current'), { recursive: true });
  fs.cpSync(path.join(framework, 'Versions', 'A', 'Resources'), path.join(framework, 'Resources'), { recursive: true });
  fs.copyFileSync(
    path.join(framework, 'Versions', 'A', 'Electron Framework'),
    path.join(framework, 'Electron Framework')
  );

  repairMissingMacFrameworkSymlinks(root);

  assert.equal(fs.readlinkSync(path.join(framework, 'Versions', 'Current')), 'A');
  assert.equal(fs.readlinkSync(path.join(framework, 'Resources')), path.join('Versions', 'Current', 'Resources'));
  assert.equal(fs.readlinkSync(path.join(framework, 'Electron Framework')), path.join('Versions', 'Current', 'Electron Framework'));
});

test('does not create a framework symlink when its fixed target is absent', (t) => {
  if (process.platform !== 'darwin') return t.skip('macOS-only filesystem semantics');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-electron-links-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const framework = path.join(
    root,
    'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Frameworks',
    'Electron Framework.framework'
  );
  fs.mkdirSync(framework, { recursive: true });

  repairMissingMacFrameworkSymlinks(root);

  assert.equal(fs.existsSync(path.join(framework, 'Versions', 'Current')), false);
  assert.equal(fs.existsSync(path.join(framework, 'Resources')), false);
  assert.equal(fs.existsSync(path.join(framework, 'Electron Framework')), false);
});
