import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { packagedArtifactFingerprint } from '../lib/packaged-artifact.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const templateRoot = path.join(skillRoot, 'assets', 'electron-template');
const validator = path.join(skillRoot, 'scripts', 'validate_performance_report.mjs');
const releaseValidator = path.join(skillRoot, 'scripts', 'validate_performance_release.mjs');
const runner = path.join(skillRoot, 'scripts', 'run_performance_audit.mjs');
const validatorIncluded = fs.existsSync(validator);
const available = validatorIncluded && process.platform === 'win32' && process.arch === 'x64';
const require = createRequire(import.meta.url);
const audit = require(path.join(templateRoot, 'src', 'performance-audit.js'));

function syntheticWindowsPath(...segments) {
  return ['C:', ...segments].join(path.win32.sep);
}

function syntheticElectronPe() {
  const peOffset = 128;
  const optionalHeaderSize = 240;
  const sections = [
    { name: '.text', rawOffset: 512, rawSize: 1024 },
    { name: '.rdata', rawOffset: 1536, rawSize: 1024 },
    { name: '.data', rawOffset: 2560, rawSize: 1024 }
  ];
  const pe = Buffer.alloc(4096);
  pe.write('MZ', 0, 'ascii');
  pe.writeUInt32LE(peOffset, 0x3c);
  pe.write('PE\0\0', peOffset, 'binary');
  pe.writeUInt16LE(0x8664, peOffset + 4);
  pe.writeUInt16LE(sections.length, peOffset + 6);
  pe.writeUInt16LE(optionalHeaderSize, peOffset + 20);
  pe.writeUInt16LE(0x0022, peOffset + 22);
  const optionalOffset = peOffset + 24;
  pe.writeUInt16LE(0x20b, optionalOffset);
  pe.writeUInt32LE(0x1000, optionalOffset + 16);
  pe.writeUInt32LE(0x1000, optionalOffset + 32);
  pe.writeUInt32LE(0x0200, optionalOffset + 36);
  pe.writeUInt32LE(0x5000, optionalOffset + 56);
  pe.writeUInt32LE(0x0200, optionalOffset + 60);
  pe.writeUInt16LE(2, optionalOffset + 68);
  const sectionOffset = optionalOffset + optionalHeaderSize;
  for (const [index, section] of sections.entries()) {
    const offset = sectionOffset + index * 40;
    pe.write(section.name, offset, 'ascii');
    pe.writeUInt32LE(section.rawSize, offset + 16);
    pe.writeUInt32LE(section.rawOffset, offset + 20);
    pe.fill(index + 1, section.rawOffset, section.rawOffset + section.rawSize);
  }
  return pe;
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
    continuouslyObservedPids: pids,
    observedProcesses: entries,
    typePeakCounts,
    pidSets: [{ count: pids.length, pids }],
    peakSnapshots: [{ count: pids.length, pids, processes: entries }]
  };
}

function visiblePetWindowEvidence(ids, durationMs, pids) {
  const sampleCount = Math.max(2, Math.ceil(durationMs / 1000) + 1);
  const rendererPid = pids[1];
  return {
    metricSource: 'BrowserWindow.isVisible/isDestroyed',
    sampleCount,
    countMin: ids.length,
    countMax: ids.length,
    continuouslyVisibleIds: ids,
    samples: Array.from({ length: sampleCount }, (_, index) => ({
      atMs: Math.min(durationMs, index * 1000),
      windows: ids.map((id) => ({ id, visible: true, destroyed: false, pid: rendererPid }))
    }))
  };
}

function phase(durationMs, pids, tickerUpdatesPerSecond = 30, petIds = []) {
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
    processes: evidence,
    petWindows: visiblePetWindowEvidence(petIds, durationMs, pids)
  };
}

function fixture(windowCount = 5) {
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
  config.characters = Array.from({ length: windowCount }, (_, index) => ({ id: `person-${index + 1}`, displayName: `P${index + 1}` }));
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');

  fs.cpSync(path.join(project, 'src'), path.join(packagedRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(packagedRoot, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(project, 'tools', 'package-current.mjs'), path.join(packagedRoot, 'tools', 'package-current.mjs'));
  fs.writeFileSync(path.join(packagedRoot, 'package.json'), JSON.stringify({ name: 'synthetic-pet', version: '1.0.0', main: 'src/main.js' }), 'utf8');
  fs.writeFileSync(path.join(packagedRoot, 'runtime-build.json'), JSON.stringify(audit.runtimeBuildMetadataForProject(project)), 'utf8');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, syntheticElectronPe());
  for (const relative of ['icudtl.dat', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin']) {
    fs.writeFileSync(path.join(path.dirname(executable), relative), Buffer.from(`electron fixture ${relative}`));
  }

  const basePids = Array.from({ length: windowCount + 3 }, (_, index) => 100 + index);
  const centipedePids = [...basePids, 100 + basePids.length];
  const allPids = [...centipedePids, 100 + centipedePids.length];
  const petIds = config.characters.map((entry) => entry.id);
  const phases = {
    idle: phase(60000, basePids, 30, petIds),
    centipede: phase(60000, centipedePids, 30, petIds),
    'poop-chase': phase(60000, allPids, 30, petIds),
    'dad-shout': phase(9000, allPids, 30, petIds),
    'grandpa-shout': phase(9000, allPids, 30, petIds),
    soak: phase(600000, allPids, 30, petIds),
    pause: phase(30000, allPids, 4, petIds)
  };
  const runtimeFingerprint = audit.runtimeFingerprintForProject(project);
  const candidateFingerprint = audit.candidateFingerprintForProject(project);
  const executableSha256 = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
  const runnerCompletedAt = Date.now();
  const runnerLaunchedAt = runnerCompletedAt - 900000;
  const report = {
    schemaVersion: audit.PERFORMANCE_REPORT_SCHEMA_VERSION,
    fingerprintSchemaVersion: audit.PERFORMANCE_FINGERPRINT_SCHEMA_VERSION,
    generatedAt: new Date(runnerCompletedAt).toISOString(),
    status: 'pending',
    platform: process.platform,
    arch: process.arch,
    runtime: {
      electronVersion: '41.0.2',
      executableSha256,
      artifactFingerprintSha256: packagedArtifactFingerprint(path.dirname(executable))
    },
    metricSource: audit.PERFORMANCE_METRIC_SOURCE,
    runtimeFingerprint,
    candidateFingerprint,
    thresholds: audit.DEFAULT_PERFORMANCE_THRESHOLDS,
    startupMeasurement: { start: 'runner-before-executable-spawn', end: 'all-pet-windows-presented' },
    startupVisibleMs: 1500,
    expectedWindowCount: windowCount,
    expectedPetIds: petIds,
    windowCount,
    phases,
    processLifecycle: audit.summarizeProcessLifecycle(phases),
    pauseContext: { modeBeforePause: 'poopChase', modeDuringPause: 'poopChase', visibleEffectWindows: 1, stateFingerprintBefore: 'a'.repeat(64), stateFingerprintAfter: 'a'.repeat(64) },
    soak: { memoryGrowthMb: 10, memoryGrowthMetric: 'private-bytes' },
    pauseComparison: { activePhase: 'poop-chase', activeAverageCpuPercent: 5, pausedAverageCpuPercent: 1, ratio: 0.2, activeTickerUpdatesPerSecond: 30, pausedTickerUpdatesPerSecond: 4, tickerRatio: 0.133 },
    runner: {
      outerTimeoutMs: 1500000,
      launchedAt: new Date(runnerLaunchedAt).toISOString(),
      completedAt: new Date(runnerCompletedAt).toISOString(),
      elapsedMs: runnerCompletedAt - runnerLaunchedAt,
      executableExitCode: 0,
      exitSignal: null,
      timedOut: false,
      crashed: false,
      reportState: 'complete'
    }
  };
  report.evaluation = audit.evaluatePerformanceReport(report, audit.DEFAULT_PERFORMANCE_THRESHOLDS, { expectedRuntimeFingerprint: runtimeFingerprint, expectedCandidateFingerprint: candidateFingerprint });
  report.status = report.evaluation.pass ? 'pass' : 'fail';
  const reportPath = path.join(root, 'windows-performance-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report), 'utf8');
  return { project, packagedRoot, executable, reportPath, report };
}

function runValidator(project, reportPath, executable, packagedRoot) {
  return spawnSync(process.execPath, [validator, '--project', project, '--report', reportPath, '--executable', executable, '--packaged-root', packagedRoot], { cwd: skillRoot, encoding: 'utf8', shell: false });
}

function runReleaseValidator(five, eight) {
  return spawnSync(process.execPath, [releaseValidator,
    '--five-project', five.project, '--five-report', five.reportPath, '--five-executable', five.executable, '--five-packaged-root', five.packagedRoot,
    '--eight-project', eight.project, '--eight-report', eight.reportPath, '--eight-executable', eight.executable, '--eight-packaged-root', eight.packagedRoot
  ], { cwd: skillRoot, encoding: 'utf8', shell: false });
}

test('performance report validator is included in the Skill', () => assert.ok(validatorIncluded));

test('five-plus-eight packaged release validator is included in the Skill', () => assert.ok(fs.existsSync(releaseValidator)));

test('release validator is explicitly Windows x64 only', () => {
  const source = fs.readFileSync(releaseValidator, 'utf8');
  assert.match(source, /process\.platform\s*!==\s*'win32'/);
  assert.match(source, /process\.arch\s*!==\s*'x64'/);
  assert.match(source, /five\.platform\s*!==\s*'win32'/);
  assert.match(source, /five\.arch\s*!==\s*'x64'/);
});

test('packaged performance runner records launch, partial, exit, and total-deadline evidence before validation', () => {
  const source = fs.readFileSync(runner, 'utf8');
  assert.match(source, /PET_PERFORMANCE_LAUNCHED_AT_MS/);
  assert.match(source, /partialReport/);
  assert.match(source, /executableExitCode/);
  assert.match(source, /minimumFullTimeoutMs/);
  assert.match(source, /validate_performance_report\.mjs/);
});

test('build verification passes the measured packaged executable and runtime root to the performance validator', () => {
  const source = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');
  assert.match(source, /function packageStagedCandidate/);
  assert.match(source, /packageStagedCandidate\(\);[\s\S]*validatePerformanceCandidate\(stagedPackagedArtifact\)/);
  assert.match(source, /validatePerformanceCandidate\(packagedArtifact\)/);
  assert.match(source, /release-performance-gate/);
  assert.match(source, /validate_performance_release\.mjs/);
  assert.match(source, /five-performance-project[\s\S]*five-performance-report[\s\S]*five-performance-executable[\s\S]*five-performance-packaged-root/);
});

test('final Windows release artifact is revalidated after packaged smoke capture', () => {
  const source = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');
  const packagedSmokeStart = source.indexOf('runElectron(packagedExecutable, packagedArtifact');
  const packagedEvidenceComplete = source.indexOf('if (packagedEvidenceFiles.some', packagedSmokeStart);
  const finalValidation = source.indexOf('validatePerformanceCandidate(packagedArtifact)', packagedEvidenceComplete);
  assert.ok(packagedSmokeStart >= 0, 'packaged smoke capture must run against the copied release artifact');
  assert.ok(packagedEvidenceComplete > packagedSmokeStart, 'packaged smoke evidence must be complete before final validation');
  assert.ok(finalValidation > packagedEvidenceComplete, 'the final copied artifact must be fingerprint-validated after packaged smoke capture');
});

test('validator accepts a fresh complete passing report', { skip: !available }, () => {
  const fixtureValue = fixture();
  const result = runValidator(fixtureValue.project, fixtureValue.reportPath, fixtureValue.executable, fixtureValue.packagedRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Performance report valid/);
});

test('validator rejects a non-PE file even when its hash matches the report', { skip: !available }, () => {
  const value = fixture();
  fs.writeFileSync(value.executable, Buffer.from('not a PE executable'));
  value.report.runtime.executableSha256 = crypto.createHash('sha256').update(fs.readFileSync(value.executable)).digest('hex');
  value.report.runtime.artifactFingerprintSha256 = packagedArtifactFingerprint(path.dirname(value.executable));
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Windows PE|Electron portable/i);
});

test('validator rejects a header-only fake PE even when report hashes match it', { skip: !available }, () => {
  const value = fixture();
  const fakePe = Buffer.alloc(128);
  fakePe.write('MZ', 0, 'ascii');
  fakePe.writeUInt32LE(64, 0x3c);
  fakePe.write('PE\0\0', 64, 'binary');
  fakePe.writeUInt16LE(0x8664, 68);
  fs.writeFileSync(value.executable, fakePe);
  value.report.runtime.executableSha256 = crypto.createHash('sha256').update(fakePe).digest('hex');
  value.report.runtime.artifactFingerprintSha256 = packagedArtifactFingerprint(path.dirname(value.executable));
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /executable structure|optional header|section table|\.text/i);
});

test('validator rejects an unrelated packaged root with identical app contents', { skip: !available }, () => {
  const value = fixture();
  const unrelatedRoot = path.join(path.dirname(value.packagedRoot), 'unrelated-app');
  fs.cpSync(value.packagedRoot, unrelatedRoot, { recursive: true });
  const result = runValidator(value.project, value.reportPath, value.executable, unrelatedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /resources[\\/]app|derived from the executable/i);
});

test('validator rejects a fabricated complete-artifact fingerprint', { skip: !available }, () => {
  const value = fixture();
  value.report.runtime.artifactFingerprintSha256 = '0'.repeat(64);
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /artifact fingerprint/i);
});

test('validator rejects runner timing that cannot contain the measured phases', { skip: !available }, () => {
  const value = fixture();
  value.report.runner.elapsedMs = 1000;
  value.report.runner.launchedAt = new Date(Date.now() - 1000).toISOString();
  value.report.runner.completedAt = new Date().toISOString();
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runner timing|phase durations/i);
});

test('validator rejects duplicate pet-window timestamps that do not span each phase', { skip: !available }, () => {
  const value = fixture();
  for (const phaseValue of Object.values(value.report.phases)) {
    for (const sample of phaseValue.petWindows.samples) sample.atMs = 0;
  }
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /full phase|pet-window-coverage/i);
});

test('validator rejects macOS volume and file URL paths in persisted evidence', { skip: !available }, () => {
  const value = fixture();
  value.report.runner.diagnostic = ['file://', '/Volumes', '/PrivateSSD/project/source.png'].join('');
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private path/i);
});

test('validator accepts every supported one-to-eight-person window count with exactly the configured pets visible', { skip: !available }, () => {
  const cases = [
    { count: 1 },
    { count: 2 },
    { count: 3 },
    { count: 4 },
    { count: 5 },
    { count: 6 },
    { count: 7 },
    { count: 8 }
  ];

  for (const { count } of cases) {
    const value = fixture(count);
    const expectedPetIds = Array.from({ length: count }, (_, index) => `person-${index + 1}`);
    assert.equal(value.report.expectedWindowCount, count);
    assert.equal(value.report.windowCount, count);
    assert.deepEqual(value.report.expectedPetIds, expectedPetIds);

    for (const phaseValue of Object.values(value.report.phases)) {
      assert.equal(phaseValue.petWindows.countMin, count);
      assert.equal(phaseValue.petWindows.countMax, count);
      assert.deepEqual(phaseValue.petWindows.continuouslyVisibleIds, expectedPetIds);
      for (const sample of phaseValue.petWindows.samples) {
        assert.deepEqual(sample.windows.map((entry) => entry.id), expectedPetIds);
        assert.ok(sample.windows.every((entry) => entry.visible && !entry.destroyed));
      }
    }

    const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
    assert.equal(result.status, 0, `count ${count}: ${result.stderr}`);
    assert.match(result.stdout, /Performance report valid/);
  }
});

test('validator accepts the final eight-window Windows packaged candidate without relaxing thresholds', { skip: !available }, () => {
  const value = fixture(8);
  const config = JSON.parse(fs.readFileSync(path.join(value.project, 'src', 'config', 'pet.config.json'), 'utf8'));
  assert.equal(config.characters.length, 8);
  assert.equal(value.report.expectedWindowCount, 8);
  assert.equal(value.report.windowCount, 8);
  assert.deepEqual(value.report.thresholds, audit.DEFAULT_PERFORMANCE_THRESHOLDS);
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Performance report valid/);
});

test('validator rejects an eight-window report with missing expectedWindowCount', { skip: !available }, () => {
  const value = fixture(8);
  delete value.report.expectedWindowCount;
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cover all 8 configured pet windows/i);
});

test('validator rejects an eight-window report with the wrong expectedWindowCount', { skip: !available }, () => {
  const value = fixture(8);
  value.report.expectedWindowCount = 5;
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cover all 8 configured pet windows/i);
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

test('validator rejects an eight-window report when one pet is hidden in the middle of a measured phase', { skip: !available }, () => {
  const value = fixture(8);
  const sample = value.report.phases['grandpa-shout'].petWindows.samples.at(-1);
  sample.windows.find((entry) => entry.id === 'person-6').visible = false;
  fs.writeFileSync(value.reportPath, JSON.stringify(value.report), 'utf8');
  const result = runValidator(value.project, value.reportPath, value.executable, value.packagedRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pet-window-coverage/i);
});

test('release validator requires one healthy five-window and one healthy eight-window packaged report from the same code candidate', { skip: !available }, () => {
  const five = fixture(5);
  const eight = fixture(8);
  const result = runReleaseValidator(five, eight);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /5\+8 packaged performance release evidence valid/i);
});

test('release validator rejects five and eight reports from different code candidates', { skip: !available }, () => {
  const five = fixture(5);
  const eight = fixture(8);
  fs.appendFileSync(path.join(eight.project, 'src', 'main.js'), '\ndifferent-release-candidate', 'utf8');
  const result = runReleaseValidator(five, eight);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /candidate fingerprint/i);
});

test('release validator rejects a report bound to the wrong packaged executable SHA', { skip: !available }, () => {
  const five = fixture(5);
  const eight = fixture(8);
  eight.report.runtime.executableSha256 = '0'.repeat(64);
  fs.writeFileSync(eight.reportPath, JSON.stringify(eight.report), 'utf8');
  const result = runReleaseValidator(five, eight);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /executable SHA-256/i);
});
