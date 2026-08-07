import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = path.join(root, 'src', 'performance-audit.js');
const available = fs.existsSync(modulePath);
const require = createRequire(import.meta.url);
const audit = available ? require(modulePath) : null;
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

function typedProcesses(pids) {
  return pids.map((pid, index) => ({
    pid,
    creationTime: 1000 + index,
    type: index === 0 ? 'Browser' : index === 1 ? 'GPU' : 'Tab',
    serviceName: '',
    name: index === 0 ? 'Love Roommate' : 'Electron'
  }));
}

function processCoverage(pids, durationMs = 60000) {
  const processes = typedProcesses(pids);
  return {
    metricSource: 'app.getAppMetrics',
    sampleCount: Math.max(1, Math.floor((durationMs / 1000) * 0.9)),
    countMin: pids.length,
    countMax: pids.length,
    peakCount: pids.length,
    observedPids: pids,
    continuouslyObservedPids: pids,
    observedProcesses: processes,
    typePeakCounts: {
      Browser: 1,
      GPU: pids.length > 1 ? 1 : 0,
      Tab: Math.max(0, pids.length - 2)
    },
    pidSets: [{ count: pids.length, pids }],
    peakSnapshots: [{ count: pids.length, pids, processes }]
  };
}

function visiblePetWindowEvidence(ids, durationMs, rendererPid = 3) {
  const sampleCount = Math.max(1, Math.ceil(durationMs / 1000));
  return {
    metricSource: 'BrowserWindow.isVisible/isDestroyed',
    sampleCount,
    countMin: ids.length,
    countMax: ids.length,
    continuouslyVisibleIds: ids,
    samples: Array.from({ length: sampleCount }, (_, index) => ({
      atMs: index * 1000,
      windows: ids.map((id) => ({ id, pid: rendererPid, visible: true, destroyed: false }))
    }))
  };
}

function withProcesses(phase, pids, petIds = []) {
  const durationMs = phase.durationMs;
  const durationSeconds = durationMs / 1000;
  return {
    ...phase,
    tickerUpdatesPerSecond: phase.tickerUpdatesPerSecond ?? 30,
    samples: phase.samples ?? {
      frameIntervals: Math.max(1, Math.floor(durationSeconds * 30 * 0.9)),
      eventLoopDelays: Math.max(1, Math.floor(durationSeconds * 0.9)),
      processMetrics: Math.max(1, Math.floor(durationSeconds * 0.9))
    },
    processes: processCoverage(pids, durationMs),
    petWindows: visiblePetWindowEvidence(petIds, durationMs, pids[2])
  };
}

function v4ReportFields(runtimeFingerprint) {
  return {
    schemaVersion: audit.PERFORMANCE_REPORT_SCHEMA_VERSION,
    fingerprintSchemaVersion: audit.PERFORMANCE_FINGERPRINT_SCHEMA_VERSION,
    runtimeFingerprint,
    candidateFingerprint: 'f'.repeat(64),
    startupMeasurement: {
      start: 'runner-before-executable-spawn',
      end: 'all-pet-windows-presented'
    },
    pauseContext: {
      modeBeforePause: 'poopChase',
      modeDuringPause: 'poopChase',
      visibleEffectWindows: 1,
      stateFingerprintBefore: 'frozen-state',
      stateFingerprintAfter: 'frozen-state'
    }
  };
}

function evaluationContext(report) {
  return { expectedRuntimeFingerprint: report.runtimeFingerprint, expectedCandidateFingerprint: report.candidateFingerprint };
}

function createRuntimeFixture(prefix) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(temp, 'src', 'renderer'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'src', 'main.js'), 'main-runtime', 'utf8');
  fs.writeFileSync(path.join(temp, 'src', 'renderer', 'pet.css'), 'pet-runtime', 'utf8');
  fs.writeFileSync(path.join(temp, 'tools', 'package-current.mjs'), 'packager-runtime', 'utf8');
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({
    name: 'fixture',
    scripts: { test: 'node --test' },
    devDependencies: { electron: '41.0.2' }
  }), 'utf8');
  return temp;
}

function healthyPerformanceReport(windowCount) {
  const phase = {
    durationMs: 60000,
    frameIntervalMs: { p95: 34, max: 46 },
    eventLoopDelayMs: { p95: 12, max: 35 },
    cpuPercent: { average: 6.5, max: 18, longestAboveThresholdSeconds: 2 },
    memoryMb: { workingSetMax: 700, privateMax: 320, max: 320, gateMetric: 'private-bytes' }
  };
  const basePids = Array.from({ length: windowCount + 3 }, (_, index) => 100 + index);
  const centipedePids = [...basePids, 100 + basePids.length];
  const allPids = [...centipedePids, 100 + centipedePids.length];
  const petIds = Array.from({ length: windowCount }, (_, index) => `person-${index + 1}`);
  const report = {
    ...v4ReportFields('a'.repeat(64)),
    expectedWindowCount: windowCount,
    expectedPetIds: petIds,
    windowCount,
    startupVisibleMs: 1700,
    metricSource: audit.PERFORMANCE_METRIC_SOURCE,
    phases: {
      idle: withProcesses(phase, basePids, petIds),
      centipede: withProcesses(phase, centipedePids, petIds),
      'poop-chase': withProcesses(phase, allPids, petIds),
      'dad-shout': withProcesses({ ...phase, durationMs: 9000 }, allPids, petIds),
      'grandpa-shout': withProcesses({ ...phase, durationMs: 9000 }, allPids, petIds),
      soak: withProcesses({ ...phase, durationMs: 600000 }, allPids, petIds),
      pause: withProcesses({ ...phase, cpuPercent: { average: 2, max: 4, longestAboveThresholdSeconds: 0 } }, allPids, petIds)
    },
    processLifecycle: {
      policy: 'reuse-hidden-effect-renderers',
      idlePeak: basePids.length,
      specialModePeak: allPids.length,
      postSpecialPeak: allPids.length,
      additionalPeak: 2,
      retainedAfterSpecial: 2
    },
    soak: { memoryGrowthMb: 18, memoryGrowthMetric: 'private-bytes' },
    pauseComparison: { activePhase: 'poop-chase', activeAverageCpuPercent: 6.5, pausedAverageCpuPercent: 2, ratio: 0.308, tickerRatio: 0.2 }
  };
  return report;
}

test('performance audit module is bundled with every generated project', () => {
  assert.ok(available, 'src/performance-audit.js is required');
});

test('performance thresholds are fail-closed and match the Windows acceptance contract', { skip: !available }, () => {
  assert.deepEqual(audit.DEFAULT_PERFORMANCE_THRESHOLDS, {
    targetFps: 30,
    activeTickerRatioMin: 0.9,
    sampleCoverageRatioMin: 0.9,
    frameIntervalP95Ms: 50,
    longPauseMaxMs: 150,
    averageCpuPercentMax: 10,
    sustainedCpuSecondsMax: 5,
    memoryMbMax: 500,
    soakGrowthMbMax: 50,
    startupVisibleMsMax: 5000,
    pauseCpuRatioMax: 0.5,
    pauseTickerRatioMax: 0.25
  });
});

test('healthy five-window report passes every performance gate', { skip: !available }, () => {
  const report = healthyPerformanceReport(5);

  assert.deepEqual(audit.evaluatePerformanceReport(report, undefined, evaluationContext(report)), { pass: true, violations: [] });
});

test('healthy eight-window report passes the unchanged Windows performance thresholds', { skip: !available }, () => {
  const report = healthyPerformanceReport(8);
  assert.deepEqual(audit.evaluatePerformanceReport(report, undefined, evaluationContext(report)), { pass: true, violations: [] });
});

test('eight visible pet windows may share one continuously observed renderer process', { skip: !available }, () => {
  const report = healthyPerformanceReport(8);
  const sharedPids = [101, 102, 103, 104];
  for (const phase of Object.values(report.phases)) {
    phase.processes = processCoverage(sharedPids, phase.durationMs);
    phase.petWindows = visiblePetWindowEvidence(report.expectedPetIds, phase.durationMs, 103);
  }
  report.processLifecycle = {
    policy: 'reuse-hidden-effect-renderers',
    idlePeak: 4,
    specialModePeak: 4,
    postSpecialPeak: 4,
    additionalPeak: 0,
    retainedAfterSpecial: 0
  };

  assert.deepEqual(audit.evaluatePerformanceReport(report, undefined, evaluationContext(report)), { pass: true, violations: [] });
});

test('shared renderer process model is enabled before Electron becomes ready', () => {
  const switchIndex = mainSource.indexOf("app.commandLine.appendSwitch('process-per-site')");
  const readyIndex = mainSource.indexOf('app.whenReady()');
  assert.ok(switchIndex >= 0, 'main process must enable process-per-site');
  assert.ok(readyIndex >= 0 && switchIndex < readyIndex, 'process-per-site must be configured before app.whenReady');
});

test('eight-window report fails closed when expectedWindowCount is missing', { skip: !available }, () => {
  const report = healthyPerformanceReport(8);
  delete report.expectedWindowCount;
  const result = audit.evaluatePerformanceReport(report, undefined, evaluationContext(report));
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((item) => item.code === 'window-count'));
});

test('eight-window report fails closed when expectedWindowCount is wrong', { skip: !available }, () => {
  const report = healthyPerformanceReport(8);
  report.expectedWindowCount = 5;
  const result = audit.evaluatePerformanceReport(report, undefined, evaluationContext(report));
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((item) => item.code === 'window-count'));
});

test('eight-window report fails closed when one pet window disappears during any phase', { skip: !available }, () => {
  const report = healthyPerformanceReport(8);
  const missing = report.phases.soak.petWindows.samples.at(-1);
  missing.windows = missing.windows.filter((entry) => entry.id !== 'person-8');
  const result = audit.evaluatePerformanceReport(report, undefined, evaluationContext(report));
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((item) => item.code === 'pet-window-coverage'));
});

test('performance evaluation reports every threshold violation instead of silently relaxing limits', { skip: !available }, () => {
  const petIds = ['person-1', 'person-2', 'person-3', 'person-4', 'person-5'];
  const phase = {
    durationMs: 60000,
    frameIntervalMs: { p95: 55, max: 180 },
    eventLoopDelayMs: { p95: 51, max: 181 },
    cpuPercent: { average: 11, max: 30, longestAboveThresholdSeconds: 6 },
    memoryMb: { workingSetMax: 900, privateMax: 501, max: 501, gateMetric: 'private-bytes' }
  };
  const report = {
    ...v4ReportFields('b'.repeat(64)),
    expectedWindowCount: 5,
    expectedPetIds: petIds,
    windowCount: 4,
    startupVisibleMs: 5001,
    metricSource: audit.PERFORMANCE_METRIC_SOURCE,
    phases: {
      idle: withProcesses(phase, [1, 2, 3, 4, 5, 6], petIds),
      centipede: withProcesses(phase, [1, 2, 3, 4, 5, 6, 7], petIds),
      'poop-chase': withProcesses(phase, [1, 2, 3, 4, 5, 6, 7, 8], petIds),
      'dad-shout': withProcesses(phase, [1, 2, 3, 4, 5, 6, 7, 8], petIds),
      'grandpa-shout': withProcesses(phase, [1, 2, 3, 4, 5, 6, 7, 8], petIds),
      soak: withProcesses(phase, [1, 2, 3, 4, 5, 6, 7, 8], petIds),
      pause: withProcesses(phase, [1, 2, 3, 4, 5, 6, 7, 8], petIds)
    },
    processLifecycle: {
      policy: 'reuse-hidden-effect-renderers',
      idlePeak: 6,
      specialModePeak: 8,
      postSpecialPeak: 8,
      additionalPeak: 2,
      retainedAfterSpecial: 2
    },
    soak: { memoryGrowthMb: 51, memoryGrowthMetric: 'private-bytes' },
    pauseComparison: { activePhase: 'poop-chase', activeAverageCpuPercent: 10, pausedAverageCpuPercent: 8, ratio: 0.8, tickerRatio: 0.8 }
  };
  const result = audit.evaluatePerformanceReport(report, undefined, evaluationContext(report));
  assert.equal(result.pass, false);
  assert.deepEqual(new Set(result.violations.map((item) => item.code)), new Set([
    'window-count',
    'startup-visible',
    'frame-p95',
    'long-pause',
    'event-loop-p95',
    'event-loop-long-pause',
    'average-cpu',
    'sustained-cpu',
    'memory-max',
    'soak-growth',
    'pause-cpu-drop',
    'pause-ticker-drop'
  ]));
});

test('runtime fingerprint changes when performance-relevant project code changes', { skip: !available }, () => {
  const temp = createRuntimeFixture('love-roommate-performance-');
  const before = audit.runtimeFingerprintForProject(temp);
  fs.appendFileSync(path.join(temp, 'src', 'main.js'), '\nchanged', 'utf8');
  const after = audit.runtimeFingerprintForProject(temp);
  assert.match(before, /^[a-f0-9]{64}$/);
  assert.match(after, /^[a-f0-9]{64}$/);
  assert.notEqual(after, before);
});

test('runtime fingerprint is stable when portable packaging prunes package metadata', { skip: !available }, () => {
  const temp = createRuntimeFixture('love-roommate-performance-package-');
  fs.writeFileSync(path.join(temp, audit.RUNTIME_BUILD_FILE), JSON.stringify(audit.runtimeBuildMetadataForProject(temp)), 'utf8');
  const before = audit.runtimeFingerprintForProject(temp);
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'fixture', main: 'src/main.js' }), 'utf8');
  const after = audit.runtimeFingerprintForProject(temp);
  assert.equal(after, before, 'packaging-only package.json pruning must not invalidate an otherwise identical runtime');
});

test('candidate fingerprint ignores project-specific people configuration but changes with runtime code', { skip: !available }, () => {
  const temp = createRuntimeFixture('love-roommate-performance-candidate-');
  const configDir = path.join(temp, 'src', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({ characters: [{ id: 'person-1' }] }), 'utf8');
  const before = audit.candidateFingerprintForProject(temp);
  fs.writeFileSync(path.join(configDir, 'pet.config.json'), JSON.stringify({ characters: Array.from({ length: 8 }, (_, index) => ({ id: `person-${index + 1}` })) }), 'utf8');
  const afterConfig = audit.candidateFingerprintForProject(temp);
  fs.appendFileSync(path.join(temp, 'src', 'main.js'), '\nruntime-change', 'utf8');
  const afterCode = audit.candidateFingerprintForProject(temp);
  assert.equal(afterConfig, before);
  assert.notEqual(afterCode, before);
});
test('phase summarizer computes frame, event-loop, CPU, and memory statistics', { skip: !available }, () => {
  const summary = audit.summarizePerformancePhase({
    durationMs: 60000,
    frameIntervalsMs: [33, 34, 35, 40, 48],
    eventLoopDelaysMs: [5, 8, 12, 20, 30],
    processSamples: [
      { atMs: 0, cpuPercent: 6, workingSetMb: 300, privateMemoryMb: 250, processIds: [11, 12, 13] },
      { atMs: 1000, cpuPercent: 12, workingSetMb: 305, privateMemoryMb: 252, processIds: [11, 12, 13, 14] },
      { atMs: 2000, cpuPercent: 13, workingSetMb: 310, privateMemoryMb: 255, processIds: [11, 12, 13, 14] },
      { atMs: 3000, cpuPercent: 7, workingSetMb: 308, privateMemoryMb: 254, processIds: [11, 12, 13] }
    ]
  });

  assert.deepEqual(summary.frameIntervalMs, { p95: 48, max: 48 });
  assert.deepEqual(summary.eventLoopDelayMs, { p95: 30, max: 30 });
  assert.deepEqual(summary.cpuPercent, {
    average: 9.5,
    max: 13,
    longestAboveThresholdSeconds: 2
  });
  assert.equal(summary.tickerUpdatesPerSecond, 0.083);
  assert.deepEqual(summary.memoryMb, {
    workingSetMax: 310,
    privateMax: 255,
    max: 255,
    start: 250,
    end: 254,
    gateMetric: 'private-bytes',
    workingSetStart: 300,
    workingSetEnd: 308
  });
  assert.deepEqual(summary.processes, {
    metricSource: 'app.getAppMetrics',
    sampleCount: 4,
    countMin: 3,
    countMax: 4,
    peakCount: 4,
    observedPids: [11, 12, 13, 14],
    continuouslyObservedPids: [11, 12, 13],
    observedProcesses: [11, 12, 13, 14].map((pid) => ({ pid, creationTime: null, type: 'Unknown', serviceName: '', name: '' })),
    typePeakCounts: { Unknown: 4 },
    pidSets: [
      { count: 3, pids: [11, 12, 13] },
      { count: 4, pids: [11, 12, 13, 14] }
    ],
    peakSnapshots: [{
      count: 4,
      pids: [11, 12, 13, 14],
      processes: [11, 12, 13, 14].map((pid) => ({ pid, creationTime: null, type: 'Unknown', serviceName: '', name: '' }))
    }]
  });
  assert.deepEqual(summary.petWindows, {
    metricSource: 'BrowserWindow.isVisible/isDestroyed',
    sampleCount: 4,
    countMin: 0,
    countMax: 0,
    continuouslyVisibleIds: [],
    samples: [0, 1000, 2000, 3000].map((atMs) => ({ atMs, windows: [] }))
  });
});

test('process coverage is fail-closed and rejects hidden-renderer growth after special modes', { skip: !available }, () => {
  const phase = {
    durationMs: 60000,
    frameIntervalMs: { p95: 34, max: 45 },
    eventLoopDelayMs: { p95: 10, max: 25 },
    cpuPercent: { average: 5, max: 12, longestAboveThresholdSeconds: 1 },
    memoryMb: { workingSetMax: 700, privateMax: 350, max: 350, gateMetric: 'private-bytes' }
  };
  const report = {
    metricSource: audit.PERFORMANCE_METRIC_SOURCE,
    expectedWindowCount: 5,
    windowCount: 5,
    startupVisibleMs: 1500,
    phases: Object.fromEntries(['idle', 'centipede', 'poop-chase', 'dad-shout', 'grandpa-shout', 'soak', 'pause']
      .map((name) => [name, withProcesses(phase, [1, 2, 3, 4, 5, 6, 7, 8])])),
    processLifecycle: {
      policy: 'reuse-hidden-effect-renderers',
      idlePeak: 8,
      specialModePeak: 8,
      postSpecialPeak: 11,
      additionalPeak: 0,
      retainedAfterSpecial: 3
    },
    soak: { memoryGrowthMb: 10, memoryGrowthMetric: 'private-bytes' },
    pauseComparison: { ratio: 0.2, tickerRatio: 0.2 }
  };
  delete report.phases.centipede.processes.observedProcesses;
  report.phases.soak.processes = processCoverage([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], phase.durationMs);
  const result = audit.evaluatePerformanceReport(report);
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((item) => item.code === 'process-coverage'));
  assert.ok(result.violations.some((item) => item.code === 'effect-process-leak'));
});

test('summed working set remains diagnostic while private bytes enforce the 500MB memory gate', { skip: !available }, () => {
  const petIds = ['person-1', 'person-2', 'person-3', 'person-4', 'person-5'];
  const phase = {
    durationMs: 60000,
    frameIntervalMs: { p95: 34, max: 45 },
    eventLoopDelayMs: { p95: 10, max: 25 },
    cpuPercent: { average: 5, max: 12, longestAboveThresholdSeconds: 1 },
    memoryMb: { workingSetMax: 1000, privateMax: 430, max: 430, start: 420, end: 430, gateMetric: 'private-bytes' }
  };
  const report = {
    ...v4ReportFields('d'.repeat(64)),
    expectedWindowCount: 5,
    expectedPetIds: petIds,
    windowCount: 5,
    startupVisibleMs: 1500,
    metricSource: audit.PERFORMANCE_METRIC_SOURCE,
    phases: Object.fromEntries(['idle', 'centipede', 'poop-chase', 'dad-shout', 'grandpa-shout', 'soak', 'pause'].map((name) => [name, withProcesses(phase, [1, 2, 3, 4, 5, 6], petIds)])),
    processLifecycle: {
      policy: 'reuse-hidden-effect-renderers',
      idlePeak: 6,
      specialModePeak: 6,
      postSpecialPeak: 6,
      additionalPeak: 0,
      retainedAfterSpecial: 0
    },
    soak: { memoryGrowthMb: 10, memoryGrowthMetric: 'private-bytes' },
    pauseComparison: { activePhase: 'poop-chase', ratio: 0.2, tickerRatio: 0.2 }
  };
  assert.deepEqual(audit.evaluatePerformanceReport(report, undefined, evaluationContext(report)), { pass: true, violations: [] });
});
test('paused phase may stop the animation ticker without failing active-frame thresholds', { skip: !available }, () => {
  const petIds = ['person-1', 'person-2', 'person-3', 'person-4', 'person-5'];
  const active = {
    durationMs: 60000,
    frameIntervalMs: { p95: 34, max: 45 },
    eventLoopDelayMs: { p95: 10, max: 25 },
    cpuPercent: { average: 5, max: 12, longestAboveThresholdSeconds: 1 },
    memoryMb: { workingSetMax: 650, privateMax: 300, max: 300, gateMetric: 'private-bytes' }
  };
  const report = {
    ...v4ReportFields('c'.repeat(64)),
    expectedWindowCount: 5,
    expectedPetIds: petIds,
    windowCount: 5,
    startupVisibleMs: 1500,
    metricSource: audit.PERFORMANCE_METRIC_SOURCE,
    phases: {
      idle: withProcesses(active, [1, 2, 3, 4, 5, 6], petIds),
      centipede: withProcesses(active, [1, 2, 3, 4, 5, 6, 7], petIds),
      'poop-chase': withProcesses(active, [1, 2, 3, 4, 5, 6, 7, 8], petIds),
      'dad-shout': withProcesses(active, [1, 2, 3, 4, 5, 6, 7, 8], petIds),
      'grandpa-shout': withProcesses(active, [1, 2, 3, 4, 5, 6, 7, 8], petIds),
      soak: withProcesses(active, [1, 2, 3, 4, 5, 6, 7, 8], petIds),
      pause: withProcesses({
        ...active,
        frameIntervalMs: { p95: 500, max: 500 },
        cpuPercent: { average: 1, max: 2, longestAboveThresholdSeconds: 0 }
      }, [1, 2, 3, 4, 5, 6, 7, 8], petIds)
    },
    processLifecycle: {
      policy: 'reuse-hidden-effect-renderers',
      idlePeak: 6,
      specialModePeak: 8,
      postSpecialPeak: 8,
      additionalPeak: 2,
      retainedAfterSpecial: 2
    },
    soak: { memoryGrowthMb: 5, memoryGrowthMetric: 'private-bytes' },
    pauseComparison: { activePhase: 'poop-chase', activeAverageCpuPercent: 5, pausedAverageCpuPercent: 1, ratio: 0.2, tickerRatio: 0.2 }
  };

  assert.deepEqual(audit.evaluatePerformanceReport(report, undefined, evaluationContext(report)), { pass: true, violations: [] });
});

test('runtime performance helpers suppress motion-only IPC and slow the shared ticker while paused', { skip: !available }, () => {
  const state = { action: 'idle_right', frame: 1.2, phrase: '', effect: null, effectSize: 24, direction: 'right', x: 10, y: 20, vx: 3, vy: 4 };
  assert.equal(audit.petRenderKey(state), audit.petRenderKey({ ...state, x: 900, y: 700, vx: -20, vy: 15 }));
  assert.notEqual(audit.petRenderKey(state), audit.petRenderKey({ ...state, frame: 2.1 }));
  assert.notEqual(audit.petRenderKey(state), audit.petRenderKey({ ...state, shoutRecipient: true }));
  assert.equal(audit.nextTickerDelay(false), 33);
  assert.ok(audit.nextTickerDelay(true) >= audit.nextTickerDelay(false) * 5);
});

test('paused pets still process drag positions without resuming animation', () => {
  assert.match(mainSource, /if \(engine\.paused && dragStates\.size === 0\)/);
  assert.match(mainSource, /const snapshot = engine\.paused \? engine\.snapshot\(\) : engine\.update\(dt, cursor\)/);
  assert.match(mainSource, /scheduleTicker\(engine\.paused && dragStates\.size > 0 \? nextTickerDelay\(false\) : undefined\)/);
});

test('main runtime uses the adaptive ticker, state caches, and lazy effect windows', () => {
  assert.match(mainSource, /nextTickerSchedule\(engine\.paused, tickerDeadline, now\)/);
  assert.match(mainSource, /entry\.lastRenderKey/);
  assert.match(mainSource, /entry\.lastBounds/);
  const readyBlock = mainSource.slice(mainSource.indexOf('app.whenReady().then'), mainSource.indexOf("app.on('before-quit'"));
  assert.doesNotMatch(readyBlock, /createCursorPoopWindow\(\)/);
  assert.doesNotMatch(readyBlock, /createDroppingPoopWindow\(\)/);
  assert.match(mainSource, /petWindows:\s*config\.characters\.map[\s\S]*isVisible\(\)[\s\S]*isDestroyed\(\)/);
});

test('inactive effect windows are destroyed while native window updates are safe', () => {
  assert.match(mainSource, /function destroyCursorPoopWindow\(\)[\s\S]*cursorPoopWindow\.destroy\(\)[\s\S]*cursorPoopWindow = null/);
  assert.match(mainSource, /function destroyDroppingPoopWindow\(\)[\s\S]*droppingPoopWindow\.destroy\(\)[\s\S]*droppingPoopWindow = null/);
  assert.match(mainSource, /if \(!dropping\) \{[\s\S]*destroyDroppingPoopWindow\(\)/);
  assert.match(mainSource, /const poopWindow = showPoop && nativeWindowUpdatesAllowed \? ensureCursorPoopWindow\(\) : cursorPoopWindow;[\s\S]*if \(nativeWindowUpdatesAllowed && !showPoop\) destroyCursorPoopWindow\(\)/);
});
