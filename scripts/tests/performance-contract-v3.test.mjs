import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const templateRoot = path.join(skillRoot, 'assets', 'electron-template');
const require = createRequire(import.meta.url);
const audit = require(path.join(templateRoot, 'src', 'performance-audit.js'));
const mainSource = fs.readFileSync(path.join(templateRoot, 'src', 'main.js'), 'utf8');
const runnerSource = fs.readFileSync(path.join(skillRoot, 'scripts', 'run_performance_audit.mjs'), 'utf8');
const packagerSource = fs.readFileSync(path.join(templateRoot, 'tools', 'package-current.mjs'), 'utf8');

function syntheticProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-fingerprint-v3-'));
  fs.cpSync(path.join(templateRoot, 'src'), path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'package-current.mjs'), packagerSource, 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'synthetic-pet',
    version: '1.0.0',
    main: 'src/main.js',
    devDependencies: { electron: '41.0.2' }
  }), 'utf8');
  const png = path.join(root, 'src', 'assets', 'sprites', 'person-1', 'idle.png');
  fs.mkdirSync(path.dirname(png), { recursive: true });
  fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
  return { root, png };
}

test('performance report v3 is fail-closed on schema, fingerprint, durations, samples, and active ticker rate', () => {
  assert.equal(audit.PERFORMANCE_REPORT_SCHEMA_VERSION, 3);
  assert.equal(audit.PERFORMANCE_FINGERPRINT_SCHEMA_VERSION, 3);
  assert.ok(audit.DEFAULT_PERFORMANCE_THRESHOLDS.activeTickerRatioMin >= 0.85);
  const result = audit.evaluatePerformanceReport({
    schemaVersion: 2,
    fingerprintSchemaVersion: 2,
    runtimeFingerprint: '0'.repeat(64),
    expectedWindowCount: 5,
    windowCount: 5,
    phases: Object.fromEntries(['idle', 'centipede', 'poop-chase', 'dad-shout', 'grandpa-shout', 'soak', 'pause']
      .map((name) => [name, { durationMs: 0, tickerUpdatesPerSecond: 0, samples: { frameIntervals: 0, eventLoopDelays: 0, processMetrics: 0 } }]))
  }, audit.DEFAULT_PERFORMANCE_THRESHOLDS, { expectedRuntimeFingerprint: 'f'.repeat(64) });
  const codes = new Set(result.violations.map((item) => item.code));
  for (const code of ['report-schema', 'fingerprint-schema', 'runtime-fingerprint', 'phase-duration', 'sample-coverage', 'active-ticker']) {
    assert.ok(codes.has(code), `missing fail-closed violation ${code}`);
  }
});

test('runtime fingerprint covers every src byte plus Electron version and the packager, while matching packaged metadata', () => {
  const { root, png } = syntheticProject();
  const original = audit.runtimeFingerprintForProject(root);

  fs.appendFileSync(path.join(root, 'src', 'renderer', 'effect.css'), '\n/* fingerprint */', 'utf8');
  const cssChanged = audit.runtimeFingerprintForProject(root);
  assert.notEqual(cssChanged, original);
  fs.appendFileSync(png, Buffer.from([5]));
  const pngChanged = audit.runtimeFingerprintForProject(root);
  assert.notEqual(pngChanged, cssChanged);
  fs.appendFileSync(path.join(root, 'tools', 'package-current.mjs'), '\n// fingerprint', 'utf8');
  const packagerChanged = audit.runtimeFingerprintForProject(root);
  assert.notEqual(packagerChanged, pngChanged);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  pkg.devDependencies.electron = '41.0.3';
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg), 'utf8');
  const electronChanged = audit.runtimeFingerprintForProject(root);
  assert.notEqual(electronChanged, packagerChanged);

  const packaged = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-packaged-v3-'));
  fs.cpSync(path.join(root, 'src'), path.join(packaged, 'src'), { recursive: true });
  fs.mkdirSync(path.join(packaged, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tools', 'package-current.mjs'), path.join(packaged, 'tools', 'package-current.mjs'));
  fs.writeFileSync(path.join(packaged, 'package.json'), JSON.stringify({ name: 'synthetic-pet', version: '1.0.0', main: 'src/main.js' }), 'utf8');
  fs.writeFileSync(path.join(packaged, 'runtime-build.json'), `${JSON.stringify(audit.runtimeBuildMetadataForProject(root), null, 2)}\n`, 'utf8');
  assert.equal(audit.runtimeFingerprintForProject(packaged), electronChanged);
});

test('ticker compensates frame work and Pause is measured while a special effect mode remains active', () => {
  assert.equal(audit.compensatedTickerDelay(false, 14), 19);
  assert.equal(audit.compensatedTickerDelay(false, 40), 0);
  assert.equal(audit.compensatedTickerDelay(true, 20), 230);
  assert.deepEqual(audit.nextTickerSchedule(false, 1033, 1048), { deadlineMs: 1066, delayMs: 18 });
  assert.deepEqual(audit.nextTickerSchedule(true, 1000, 1020), { deadlineMs: 1250, delayMs: 230 });
  assert.match(mainSource, /pauseContext/);
  assert.match(mainSource, /modeBeforePause:\s*engine\.mode/);
  assert.match(mainSource, /visibleEffectWindows/);
  assert.match(mainSource, /stateFingerprint/);
  assert.match(mainSource, /nextTickerSchedule/);
  assert.match(mainSource, /togglePause\(\);\s*pauseContext\.modeDuringPause = engine\.mode;\s*await waitForPerformance\(1000\);\s*beginPerformancePhase\('pause'\)/);
});

test('runner and report retain real bootstrap timing, process types, terminal exit state, and partial failures', () => {
  assert.match(runnerSource, /PET_PERFORMANCE_LAUNCHED_AT_MS/);
  assert.match(runnerSource, /outerTimeoutMs/);
  assert.match(runnerSource, /executableExitCode/);
  assert.match(runnerSource, /partialReport/);
  assert.match(runnerSource, /status === 'running'/);
  assert.match(mainSource, /runner-before-executable-spawn/);
  assert.match(mainSource, /all-pet-windows-presented/);
  assert.match(mainSource, /metric\.type/);
  assert.match(mainSource, /serviceName/);
});
