'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PERFORMANCE_REPORT_SCHEMA_VERSION = 3;
const PERFORMANCE_FINGERPRINT_SCHEMA_VERSION = 3;
const RUNTIME_BUILD_FILE = 'runtime-build.json';

const DEFAULT_PERFORMANCE_THRESHOLDS = Object.freeze({
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

const PERFORMANCE_METRIC_SOURCE = Object.freeze({
  api: 'app.getAppMetrics',
  scope: 'all-current-electron-app-processes',
  aggregation: 'sum-per-sample'
});

function addViolation(violations, code, message) {
  violations.push({ code, message });
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return round(sorted[index]);
}

function nextTickerDelay(paused) {
  return paused ? 250 : 33;
}

function compensatedTickerDelay(paused, frameWorkMs) {
  return Math.max(0, nextTickerDelay(paused) - Math.max(0, Number(frameWorkMs) || 0));
}

function nextTickerSchedule(paused, previousDeadlineMs, nowMs) {
  const intervalMs = nextTickerDelay(paused);
  const now = Number(nowMs) || 0;
  let deadlineMs = Number.isFinite(previousDeadlineMs) ? previousDeadlineMs + intervalMs : now + intervalMs;
  if (deadlineMs < now - intervalMs) deadlineMs = now + intervalMs;
  return {
    deadlineMs,
    delayMs: Math.max(0, deadlineMs - now)
  };
}

function petRenderKey(state) {
  return JSON.stringify([
    state?.action || '',
    Math.floor(Number(state?.frame) || 0),
    state?.phrase || '',
    state?.effect || '',
    Number(state?.effectSize) || 0,
    state?.direction || '',
    Boolean(state?.paused)
  ]);
}

function normalizeProcessEntry(metric) {
  const pid = Number(metric?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const creationTime = Number(metric?.creationTime);
  return {
    pid,
    creationTime: Number.isFinite(creationTime) ? round(creationTime) : null,
    type: String(metric?.type || 'Unknown'),
    serviceName: String(metric?.serviceName || ''),
    name: String(metric?.name || '')
  };
}

function processesForSample(sample) {
  if (Array.isArray(sample?.processes)) {
    return sample.processes.map(normalizeProcessEntry).filter(Boolean).sort((left, right) => left.pid - right.pid);
  }
  return [...new Set((sample?.processIds || []).filter((pid) => Number.isInteger(pid) && pid > 0))]
    .sort((left, right) => left - right)
    .map((pid) => ({ pid, creationTime: null, type: 'Unknown', serviceName: '', name: '' }));
}

function summarizePerformancePhase({ durationMs, frameIntervalsMs = [], eventLoopDelaysMs = [], processSamples = [] }, thresholds = DEFAULT_PERFORMANCE_THRESHOLDS) {
  const cpuValues = processSamples.map((sample) => sample.cpuPercent).filter(Number.isFinite);
  const workingSets = processSamples.map((sample) => sample.workingSetMb).filter(Number.isFinite);
  const privateMemory = processSamples.map((sample) => sample.privateMemoryMb).filter(Number.isFinite);
  let currentHighSeconds = 0;
  let longestHighSeconds = 0;
  processSamples.forEach((sample, index) => {
    if (sample.cpuPercent > thresholds.averageCpuPercentMax) {
      const previousAt = index > 0 ? processSamples[index - 1].atMs : sample.atMs - 1000;
      currentHighSeconds += Math.max(0, sample.atMs - previousAt) / 1000;
      longestHighSeconds = Math.max(longestHighSeconds, currentHighSeconds);
    } else {
      currentHighSeconds = 0;
    }
  });

  const snapshots = [];
  const seenSnapshots = new Set();
  const observed = new Map();
  const typePeakCounts = {};
  for (const sample of processSamples) {
    const processes = processesForSample(sample);
    const key = JSON.stringify(processes);
    for (const process of processes) observed.set(`${process.pid}:${process.creationTime ?? 'unknown'}`, process);
    const counts = {};
    for (const process of processes) counts[process.type] = (counts[process.type] || 0) + 1;
    for (const [type, count] of Object.entries(counts)) typePeakCounts[type] = Math.max(typePeakCounts[type] || 0, count);
    if (!seenSnapshots.has(key)) {
      seenSnapshots.add(key);
      snapshots.push({ count: processes.length, pids: processes.map((process) => process.pid), processes });
    }
  }
  const processCounts = processSamples.map((sample) => processesForSample(sample).length);
  const processCountMax = processCounts.length ? Math.max(...processCounts) : 0;
  const observedProcesses = [...observed.values()].sort((left, right) => left.pid - right.pid);
  const peakSnapshots = snapshots.filter((entry) => entry.count === processCountMax);
  const workingSetMax = workingSets.length ? Math.max(...workingSets) : 0;
  const privateMax = privateMemory.length ? Math.max(...privateMemory) : 0;

  return {
    durationMs: round(durationMs),
    tickerUpdatesPerSecond: durationMs > 0 ? round(frameIntervalsMs.length / (durationMs / 1000)) : 0,
    samples: {
      frameIntervals: frameIntervalsMs.length,
      eventLoopDelays: eventLoopDelaysMs.length,
      processMetrics: processSamples.length
    },
    frameIntervalMs: {
      p95: percentile(frameIntervalsMs, 0.95),
      max: frameIntervalsMs.length ? round(Math.max(...frameIntervalsMs)) : 0
    },
    eventLoopDelayMs: {
      p95: percentile(eventLoopDelaysMs, 0.95),
      max: eventLoopDelaysMs.length ? round(Math.max(...eventLoopDelaysMs)) : 0
    },
    cpuPercent: {
      average: cpuValues.length ? round(cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length) : 0,
      max: cpuValues.length ? round(Math.max(...cpuValues)) : 0,
      longestAboveThresholdSeconds: round(longestHighSeconds)
    },
    memoryMb: {
      workingSetMax: round(workingSetMax),
      privateMax: round(privateMax),
      max: round(privateMax),
      start: round(privateMemory[0] || 0),
      end: round(privateMemory.at(-1) || 0),
      gateMetric: 'private-bytes',
      workingSetStart: round(workingSets[0] || 0),
      workingSetEnd: round(workingSets.at(-1) || 0)
    },
    processes: {
      metricSource: PERFORMANCE_METRIC_SOURCE.api,
      sampleCount: processSamples.length,
      countMin: processCounts.length ? Math.min(...processCounts) : 0,
      countMax: processCountMax,
      peakCount: processCountMax,
      observedPids: observedProcesses.map((process) => process.pid),
      observedProcesses,
      typePeakCounts,
      pidSets: snapshots.map(({ count, pids }) => ({ count, pids })),
      peakSnapshots
    }
  };
}

function summarizeProcessLifecycle(phases) {
  const peak = (name) => Number(phases?.[name]?.processes?.peakCount) || 0;
  const idlePeak = peak('idle');
  const specialModePeak = Math.max(peak('centipede'), peak('poop-chase'));
  const postSpecialPeak = Math.max(peak('dad-shout'), peak('grandpa-shout'), peak('pause'), peak('soak'));
  return {
    policy: 'reuse-hidden-effect-renderers',
    idlePeak,
    specialModePeak,
    postSpecialPeak,
    additionalPeak: specialModePeak - idlePeak,
    retainedAfterSpecial: postSpecialPeak - idlePeak
  };
}

function validProcessCoverage(processes, minimumCount, requiredSamples) {
  if (processes?.metricSource !== PERFORMANCE_METRIC_SOURCE.api) return false;
  if (!Number.isInteger(processes.sampleCount) || processes.sampleCount < requiredSamples) return false;
  if (!Number.isInteger(processes.countMin) || !Number.isInteger(processes.countMax) || !Number.isInteger(processes.peakCount)) return false;
  if (processes.countMin < minimumCount || processes.countMax < processes.countMin || processes.peakCount !== processes.countMax) return false;
  if (!Array.isArray(processes.observedProcesses) || !processes.observedProcesses.length) return false;
  if (!processes.observedProcesses.every((entry) => normalizeProcessEntry(entry))) return false;
  if (!Array.isArray(processes.peakSnapshots) || !processes.peakSnapshots.length) return false;
  if (!processes.peakSnapshots.every((entry) => entry.count === processes.peakCount && Array.isArray(entry.processes) && entry.processes.length === entry.count)) return false;
  return true;
}

function evaluatePerformanceReport(report, thresholds = DEFAULT_PERFORMANCE_THRESHOLDS, context = {}) {
  const violations = [];
  const expectedWindowCount = Number.isInteger(report?.expectedWindowCount) ? report.expectedWindowCount : null;
  const expectedFingerprint = context.expectedRuntimeFingerprint;
  if (report?.schemaVersion !== PERFORMANCE_REPORT_SCHEMA_VERSION) {
    addViolation(violations, 'report-schema', `Performance report schemaVersion must be ${PERFORMANCE_REPORT_SCHEMA_VERSION}.`);
  }
  if (report?.fingerprintSchemaVersion !== PERFORMANCE_FINGERPRINT_SCHEMA_VERSION) {
    addViolation(violations, 'fingerprint-schema', `Performance fingerprint schemaVersion must be ${PERFORMANCE_FINGERPRINT_SCHEMA_VERSION}.`);
  }
  if (!/^[a-f0-9]{64}$/.test(report?.runtimeFingerprint || '') || !/^[a-f0-9]{64}$/.test(expectedFingerprint || '') || report.runtimeFingerprint !== expectedFingerprint) {
    addViolation(violations, 'runtime-fingerprint', 'Performance report runtime fingerprint does not match the independently computed runtime.');
  }
  if (JSON.stringify(report?.metricSource) !== JSON.stringify(PERFORMANCE_METRIC_SOURCE)) {
    addViolation(violations, 'metric-source', 'Performance metrics must come from app.getAppMetrics across all current Electron app processes.');
  }
  if (!expectedWindowCount || report.windowCount !== expectedWindowCount) {
    addViolation(violations, 'window-count', `Expected ${expectedWindowCount || 'the configured number of'} visible pet windows, got ${report?.windowCount ?? 'unknown'}.`);
  }
  if (report?.startupMeasurement?.start !== 'runner-before-executable-spawn' || report?.startupMeasurement?.end !== 'all-pet-windows-presented') {
    addViolation(violations, 'startup-measurement', 'Startup timing must cover executable spawn through all pet windows being presented.');
  }
  if (!Number.isFinite(report?.startupVisibleMs) || report.startupVisibleMs <= 0 || report.startupVisibleMs > thresholds.startupVisibleMsMax) {
    addViolation(violations, 'startup-visible', `Startup-to-visible must be positive and no more than ${thresholds.startupVisibleMsMax}ms.`);
  }

  const requiredPhases = ['idle', 'centipede', 'poop-chase', 'dad-shout', 'grandpa-shout', 'soak', 'pause'];
  for (const name of requiredPhases) {
    const phase = report?.phases?.[name];
    if (!phase) {
      addViolation(violations, 'missing-phase', `Missing required performance phase: ${name}.`);
      continue;
    }
    const durationMs = Number(phase.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      addViolation(violations, 'phase-duration', `${name} must have a positive measured duration.`);
    }
    const durationSeconds = Math.max(0, durationMs / 1000);
    const requiredProcessSamples = Math.max(1, Math.floor(durationSeconds * thresholds.sampleCoverageRatioMin));
    const requiredFrameSamples = Math.max(1, Math.floor(durationSeconds * thresholds.targetFps * thresholds.activeTickerRatioMin));
    if (!Number.isInteger(phase.samples?.frameIntervals) || !Number.isInteger(phase.samples?.eventLoopDelays) || !Number.isInteger(phase.samples?.processMetrics)
      || phase.samples.frameIntervals < (name === 'pause' ? 1 : requiredFrameSamples)
      || phase.samples.eventLoopDelays < requiredProcessSamples
      || phase.samples.processMetrics < requiredProcessSamples) {
      addViolation(violations, 'sample-coverage', `${name} does not contain enough frame, event-loop, and process samples for its duration.`);
    }
    if (!validProcessCoverage(phase.processes, (expectedWindowCount || 0) + 1, requiredProcessSamples)) {
      addViolation(violations, 'process-coverage', `${name} does not record complete typed Electron process evidence.`);
    }
    if (name !== 'pause') {
      const minimumTicker = thresholds.targetFps * thresholds.activeTickerRatioMin;
      if (!Number.isFinite(phase.tickerUpdatesPerSecond) || phase.tickerUpdatesPerSecond < minimumTicker) {
        addViolation(violations, 'active-ticker', `${name} ticker rate fell below ${minimumTicker} updates/s for the ${thresholds.targetFps}fps target.`);
      }
      if (!Number.isFinite(phase.frameIntervalMs?.p95) || phase.frameIntervalMs.p95 > thresholds.frameIntervalP95Ms) {
        addViolation(violations, 'frame-p95', `${name} frame interval p95 exceeded ${thresholds.frameIntervalP95Ms}ms.`);
      }
      if (!Number.isFinite(phase.frameIntervalMs?.max) || phase.frameIntervalMs.max > thresholds.longPauseMaxMs) {
        addViolation(violations, 'long-pause', `${name} had a frame pause above ${thresholds.longPauseMaxMs}ms.`);
      }
    }
    if (!Number.isFinite(phase.eventLoopDelayMs?.p95) || phase.eventLoopDelayMs.p95 > thresholds.frameIntervalP95Ms) {
      addViolation(violations, 'event-loop-p95', `${name} event-loop delay p95 exceeded ${thresholds.frameIntervalP95Ms}ms.`);
    }
    if (!Number.isFinite(phase.eventLoopDelayMs?.max) || phase.eventLoopDelayMs.max > thresholds.longPauseMaxMs) {
      addViolation(violations, 'event-loop-long-pause', `${name} had an event-loop pause above ${thresholds.longPauseMaxMs}ms.`);
    }
    if (!Number.isFinite(phase.cpuPercent?.average) || phase.cpuPercent.average > thresholds.averageCpuPercentMax) {
      addViolation(violations, 'average-cpu', `${name} average CPU exceeded ${thresholds.averageCpuPercentMax}%.`);
    }
    if (!Number.isFinite(phase.cpuPercent?.longestAboveThresholdSeconds) || phase.cpuPercent.longestAboveThresholdSeconds > thresholds.sustainedCpuSecondsMax) {
      addViolation(violations, 'sustained-cpu', `${name} sustained high CPU exceeded ${thresholds.sustainedCpuSecondsMax}s.`);
    }
    if (phase.memoryMb?.gateMetric !== 'private-bytes' || !Number.isFinite(phase.memoryMb?.privateMax) || phase.memoryMb.privateMax > thresholds.memoryMbMax) {
      addViolation(violations, 'memory-max', `${name} total private memory exceeded ${thresholds.memoryMbMax}MB or used an unverified metric.`);
    }
  }

  if (report?.soak?.memoryGrowthMetric !== 'private-bytes' || !Number.isFinite(report?.soak?.memoryGrowthMb) || report.soak.memoryGrowthMb > thresholds.soakGrowthMbMax) {
    addViolation(violations, 'soak-growth', `Soak private-memory growth exceeded ${thresholds.soakGrowthMbMax}MB or used an unverified metric.`);
  }
  if (report?.pauseContext?.modeBeforePause !== 'poopChase' || report.pauseContext.modeDuringPause !== 'poopChase'
    || report.pauseContext.visibleEffectWindows < 1 || report.pauseContext.stateFingerprintBefore !== report.pauseContext.stateFingerprintAfter) {
    addViolation(violations, 'pause-special-mode', 'Pause must freeze an active poop-chase effect state instead of measuring idle mode.');
  }
  if (report?.pauseComparison?.activePhase !== 'poop-chase' || !Number.isFinite(report.pauseComparison.ratio) || report.pauseComparison.ratio > thresholds.pauseCpuRatioMax) {
    addViolation(violations, 'pause-cpu-drop', `Pause CPU ratio exceeded ${thresholds.pauseCpuRatioMax} or did not use the active poop-chase phase.`);
  }
  if (!Number.isFinite(report?.pauseComparison?.tickerRatio) || report.pauseComparison.tickerRatio > thresholds.pauseTickerRatioMax) {
    addViolation(violations, 'pause-ticker-drop', `Pause ticker activity ratio exceeded ${thresholds.pauseTickerRatioMax}.`);
  }
  const expectedLifecycle = summarizeProcessLifecycle(report?.phases);
  if (JSON.stringify(report?.processLifecycle) !== JSON.stringify(expectedLifecycle)) {
    addViolation(violations, 'process-lifecycle', 'Process lifecycle summary does not match the per-phase Electron process evidence.');
  }
  if (expectedLifecycle.additionalPeak < 0 || expectedLifecycle.additionalPeak > 2) {
    addViolation(violations, 'effect-process-growth', 'Special modes created more than the two reusable effect renderers allowed by the runtime contract.');
  }
  if (expectedLifecycle.postSpecialPeak > expectedLifecycle.specialModePeak) {
    addViolation(violations, 'effect-process-leak', 'Electron process count continued growing after all lazy effect renderers had been created.');
  }
  return { pass: violations.length === 0, violations };
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runtimeBuildMetadataForProject(projectRoot) {
  const attestationPath = path.join(projectRoot, RUNTIME_BUILD_FILE);
  if (fs.existsSync(attestationPath)) {
    const metadata = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
    if (metadata.schemaVersion !== PERFORMANCE_FINGERPRINT_SCHEMA_VERSION) throw new Error('Packaged runtime build metadata schema is stale.');
    return metadata;
  }
  const packagePath = path.join(projectRoot, 'package.json');
  const packagerPath = path.join(projectRoot, 'tools', 'package-current.mjs');
  if (!fs.existsSync(packagePath) || !fs.existsSync(packagerPath)) throw new Error('Performance runtime build metadata inputs are missing.');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const electronVersion = packageJson.devDependencies?.electron;
  if (typeof electronVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(electronVersion)) throw new Error('Pinned Electron version is missing from package.json.');
  return {
    schemaVersion: PERFORMANCE_FINGERPRINT_SCHEMA_VERSION,
    electronVersion,
    platform: process.platform,
    arch: process.arch,
    packageCurrentSha256: sha256File(packagerPath)
  };
}

function runtimeFiles(projectRoot) {
  const roots = [path.join(projectRoot, 'src'), path.join(projectRoot, 'tools', 'package-current.mjs')];
  const files = [];
  function visit(fullPath) {
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) throw new Error(`Performance fingerprint input must not be a symlink: ${path.relative(projectRoot, fullPath)}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(fullPath).sort()) visit(path.join(fullPath, name));
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  }
  for (const root of roots) {
    if (!fs.existsSync(root)) throw new Error(`Performance fingerprint input is missing: ${path.relative(projectRoot, root)}`);
    visit(root);
  }
  return files.sort((left, right) => path.relative(projectRoot, left).replaceAll('\\', '/').localeCompare(path.relative(projectRoot, right).replaceAll('\\', '/'), 'en'));
}

function runtimeFingerprintForProject(projectRoot) {
  const hash = crypto.createHash('sha256');
  hash.update(`love-roommate-performance-runtime-v${PERFORMANCE_FINGERPRINT_SCHEMA_VERSION}\0`);
  hash.update(`runtime\0${JSON.stringify(runtimeBuildMetadataForProject(projectRoot))}\0`);
  for (const file of runtimeFiles(projectRoot)) {
    const relative = path.relative(projectRoot, file).replaceAll('\\', '/');
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

module.exports = {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  PERFORMANCE_FINGERPRINT_SCHEMA_VERSION,
  PERFORMANCE_METRIC_SOURCE,
  PERFORMANCE_REPORT_SCHEMA_VERSION,
  RUNTIME_BUILD_FILE,
  compensatedTickerDelay,
  evaluatePerformanceReport,
  nextTickerSchedule,
  nextTickerDelay,
  petRenderKey,
  runtimeBuildMetadataForProject,
  runtimeFingerprintForProject,
  summarizePerformancePhase,
  summarizeProcessLifecycle
};
