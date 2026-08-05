import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const templateRoot = path.join(skillRoot, 'assets', 'electron-template');
const validator = path.join(skillRoot, 'scripts', 'validate_performance_report.mjs');
const runner = path.join(skillRoot, 'scripts', 'run_performance_audit.mjs');
const available = fs.existsSync(validator);
const require = createRequire(import.meta.url);
const audit = require(path.join(templateRoot, 'src', 'performance-audit.js'));

function syntheticWindowsPath(...segments) {
  return ['C:', ...segments].join(path.win32.sep);
}

function processes(pids) {
  const entries = pids.map((pid, index) => ({
    pid,
    creationTime: 1000 + index,
    type: index === 0 ? 'Browser' : index <= 5 ? 'Tab' : index === 6 ? 'GPU' : 'Utility',
    serviceName: index > 6 ? 'network.mojom.NetworkService' : '',
    name: ''
  }));
  const typePeakCounts = {};
  for (const entry of entries) typePeakCounts[entry.type] = (typePeakCounts[entry.type] || 0) + 1;
  return {
    metricSource: audit.PERFORMANCE_METRIC_SOURCE.api,
    sampleCount: 60,
    countMin: pids.length,
    countMax: pids.length,
    peakCount: pids.length,
    observedPids: pids,
    observedProcesses: entries,
    typePeakCounts,
    pidSets: [{ count: pids.length, pids }],
    peakSnapshots: [{ count: pids.length, pids, processes: entries }]
  };
}

function phase(durationMs, pids, tickerUpdatesPerSecond = 30) {
  const seconds = durationMs / 1000;
  const sampleCount = Math.max(1, Math.ceil(seconds));
  const evidence = processes(pids);
  evidence.sampleCount = sampleCount;
  return {
    durationMs,
    tickerUpdatesPerSecond,
    samples: { frameIntervals: Math.max(1, Math.ceil(seconds * tickerUpdatesPerSecond)), eventLoopDelays: sampleCount, processMetrics: sampleCount },
    frameIntervalMs: { p95: 34, max: 45 },
    eventLoopDelayMs: { p95: 10, max: 25 },
    cpuPercent: { average: 5, max: 12, longestAboveThresholdSeconds: 1 },
    memoryMb: { workingSetMax: 700, privateMax: 350, max: 350, start: 340, end: 350, gateMetric: 'private-bytes' },
    processes: evidence
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-performance-gate-v3-'));
  const project = path.join(root, 'project');
  const packagedRoot = path.join(root, 'packaged', 'resources', 'app');
  const executable = path.join(root, 'packaged', 'Synthetic Pet.exe');
  fs.cpSync(path.join(templateRoot, 'src'), path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(path.join(project, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(templateRoot, 'tools', 'package-current.mjs'), path.join(project, 'tools', 'package-current.mjs'));
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'synthetic-pet', version: '1.0.0', main: 'src/main.js', devDependencies: { electron: '41.0.2' } }), 'utf8');
  const configPath = path.join(project, 'src', 'config', 'pet.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.characters = Array.from({ length: 5 }, (_, index) => ({ id: `person-${index + 1}`, displayName: `P${index + 1}` }));
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');

  fs.cpSync(path.join(project, 'src'), path.join(packagedRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(packagedRoot, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(project, 'tools', 'package-current.mjs'), path.join(packagedRoot, 'tools', 'package-current.mjs'));
  fs.writeFileSync(path.join(packagedRoot, 'package.json'), JSON.stringify({ name: 'synthetic-pet', version: '1.0.0', main: 'src/main.js' }), 'utf8');
  fs.writeFileSync(path.join(packagedRoot, 'runtime-build.json'), JSON.stringify(audit.runtimeBuildMetadataForProject(project)), 'utf8');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, Buffer.from('synthetic executable'));

  const basePids = [100, 101, 102, 103, 104, 105, 106, 107];
  const centipedePids = [...basePids, 108];
  const allPids = [...centipedePids, 109];
  const phases = {
    idle: phase(60000, basePids),
    centipede: phase(60000, centipedePids),
    'poop-chase': phase(60000, allPids),
    'dad-shout': phase(9000, allPids),
    'grandpa-shout': phase(9000, allPids),
    soak: phase(600000, allPids),
    pause: phase(30000, allPids, 4)
  };
  const runtimeFingerprint = audit.runtimeFingerprintForProject(project);
  const executableSha256 = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
  const report = {
    schemaVersion: audit.PERFORMANCE_REPORT_SCHEMA_VERSION,
    fingerprintSchemaVersion: audit.PERFORMANCE_FINGERPRINT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: 'pending',
    platform: process.platform,
    arch: process.arch,
    runtime: { electronVersion: '41.0.2', executableSha256 },
    metricSource: audit.PERFORMANCE_METRIC_SOURCE,
    runtimeFingerprint,
    thresholds: audit.DEFAULT_PERFORMANCE_THRESHOLDS,
    startupMeasurement: { start: 'runner-before-executable-spawn', end: 'all-pet-windows-presented' },
    startupVisibleMs: 1500,
    expectedWindowCount: 5,
    windowCount: 5,
    phases,
    processLifecycle: audit.summarizeProcessLifecycle(phases),
    pauseContext: { modeBeforePause: 'poopChase', modeDuringPause: 'poopChase', visibleEffectWindows: 1, stateFingerprintBefore: 'a'.repeat(64), stateFingerprintAfter: 'a'.repeat(64) },
    soak: { memoryGrowthMb: 10, memoryGrowthMetric: 'private-bytes' },
    pauseComparison: { activePhase: 'poop-chase', activeAverageCpuPercent: 5, pausedAverageCpuPercent: 1, ratio: 0.2, activeTickerUpdatesPerSecond: 30, pausedTickerUpdatesPerSecond: 4, tickerRatio: 0.133 },
    runner: { outerTimeoutMs: 1500000, elapsedMs: 900000, executableExitCode: 0, exitSignal: null, timedOut: false, crashed: false, reportState: 'complete' }
  };
  report.evaluation = audit.evaluatePerformanceReport(report, audit.DEFAULT_PERFORMANCE_THRESHOLDS, { expectedRuntimeFingerprint: runtimeFingerprint });
  report.status = report.evaluation.pass ? 'pass' : 'fail';
  const reportPath = path.join(root, 'windows-performance-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report), 'utf8');
  return { project, packagedRoot, executable, reportPath, report };
}

function runValidator(project, reportPath, executable, packagedRoot) {
  return spawnSync(process.execPath, [validator, '--project', project, '--report', reportPath, '--executable', executable, '--packaged-root', packagedRoot], { cwd: skillRoot, encoding: 'utf8', shell: false });
}

test('performance report validator is included in the Skill', () => assert.ok(available));

test('packaged performance runner records launch, partial, exit, and total-deadline evidence before validation', () => {
  const source = fs.readFileSync(runner, 'utf8');
  assert.match(source, /PET_PERFORMANCE_LAUNCHED_AT_MS/);
  assert.match(source, /partialReport/);
  assert.match(source, /executableExitCode/);
  assert.match(source, /minimumFullTimeoutMs/);
  assert.match(source, /validate_performance_report\.mjs/);
});

test('validator accepts a fresh complete passing report', { skip: !available }, () => {
  const fixtureValue = fixture();
  const result = runValidator(fixtureValue.project, fixtureValue.reportPath, fixtureValue.executable, fixtureValue.packagedRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Performance report valid/);
});

test('validator rejects stale fingerprints and private paths', { skip: !available }, () => {
  const value = fixture();
  fs.appendFileSync(path.join(value.project, 'src', 'main.js'), '\nchanged', 'utf8');
  let result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fingerprint/i);
  value.report.note = syntheticWindowsPath('Users', 'sample', 'photo.png');
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.match(result.stderr, /private path/i);
});

test('validator rejects shortened samples even when report status says pass', { skip: !available }, () => {
  const value = fixture();
  value.report.phases.idle.durationMs = 59000;
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /idle.*60000/i);
});

test('validator rejects reports that omit typed Electron process evidence', { skip: !available }, () => {
  const value = fixture();
  delete value.report.phases['poop-chase'].processes.peakSnapshots;
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /process-coverage/i);
});
