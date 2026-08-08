import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs, readJson } from './lib/common.mjs';
import { packagedArtifactFingerprint, validateWindowsPortableArtifact } from './lib/packaged-artifact.mjs';
import { sensitivePathMatches } from './lib/privacy.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.project || !args.report || !args.executable || !args['packaged-root']) {
  console.error('Usage: node validate_performance_report.mjs --project <project> --report <report> --executable <exe> --packaged-root <resources/app>');
  process.exit(1);
}

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const audit = require(path.join(skillRoot, 'assets', 'electron-template', 'src', 'performance-audit.js'));
const project = path.resolve(args.project);
const reportPath = path.resolve(args.report);
const executable = path.resolve(args.executable);
const declaredPackagedRoot = path.resolve(args['packaged-root']);
const errors = [];
if (process.platform !== 'win32' || process.arch !== 'x64') errors.push('Windows performance reports must be validated on a Windows x64 host.');

function validateElectronExecutableStructure(file) {
  const stat = fs.statSync(file);
  if (stat.size < 4096) throw new Error('Packaged executable structure is incomplete.');
  const descriptor = fs.openSync(file, 'r');
  try {
    const dos = Buffer.alloc(64);
    if (fs.readSync(descriptor, dos, 0, dos.length, 0) !== dos.length) throw new Error('Packaged executable structure is incomplete.');
    const peOffset = dos.readUInt32LE(0x3c);
    const coff = Buffer.alloc(24);
    if (fs.readSync(descriptor, coff, 0, coff.length, peOffset) !== coff.length) throw new Error('Packaged executable COFF header is incomplete.');
    const sectionCount = coff.readUInt16LE(6);
    const optionalHeaderSize = coff.readUInt16LE(20);
    const characteristics = coff.readUInt16LE(22);
    if (sectionCount < 1 || sectionCount > 96 || optionalHeaderSize < 240 || (characteristics & 0x0002) === 0) {
      throw new Error('Packaged executable structure has an invalid COFF header.');
    }
    const optional = Buffer.alloc(optionalHeaderSize);
    const optionalOffset = peOffset + coff.length;
    if (fs.readSync(descriptor, optional, 0, optional.length, optionalOffset) !== optional.length
      || optional.readUInt16LE(0) !== 0x20b
      || optional.readUInt32LE(16) === 0
      || optional.readUInt32LE(56) === 0
      || optional.readUInt16LE(68) !== 2) {
      throw new Error('Packaged executable has an invalid Windows x64 GUI optional header.');
    }
    const sectionTable = Buffer.alloc(sectionCount * 40);
    const sectionOffset = optionalOffset + optionalHeaderSize;
    if (fs.readSync(descriptor, sectionTable, 0, sectionTable.length, sectionOffset) !== sectionTable.length) {
      throw new Error('Packaged executable section table is incomplete.');
    }
    let validTextSection = false;
    for (let index = 0; index < sectionCount; index += 1) {
      const offset = index * 40;
      const name = sectionTable.subarray(offset, offset + 8).toString('ascii').replace(/\0+$/, '');
      const rawSize = sectionTable.readUInt32LE(offset + 16);
      const rawOffset = sectionTable.readUInt32LE(offset + 20);
      if (rawSize > 0 && (rawOffset < sectionOffset + sectionTable.length || rawOffset + rawSize > stat.size)) {
        throw new Error('Packaged executable section table points outside the executable.');
      }
      if (name === '.text' && rawSize > 0) validTextSection = true;
    }
    if (!validTextSection) throw new Error('Packaged executable is missing a valid .text section.');
  } finally {
    fs.closeSync(descriptor);
  }
}

let portableArtifact = null;
try {
  portableArtifact = validateWindowsPortableArtifact(executable, declaredPackagedRoot);
  validateElectronExecutableStructure(executable);
} catch (error) {
  errors.push(error.message);
}
const packagedRoot = portableArtifact?.packagedRoot || declaredPackagedRoot;
for (const [label, file] of [
  ['Project package.json', path.join(project, 'package.json')],
  ['Performance report', reportPath],
  ['Packaged executable', executable],
  ['Packaged runtime metadata', path.join(packagedRoot, 'runtime-build.json')]
]) if (!fs.existsSync(file)) errors.push(`${label} is missing.`);

let report = null;
let config = null;
let expectedFingerprint = null;
let packagedFingerprint = null;
let expectedCandidateFingerprint = null;
let packagedCandidateFingerprint = null;
let buildMetadata = null;
let artifactFingerprintSha256 = null;
if (!errors.length) {
  try {
    report = readJson(reportPath);
    config = readJson(path.join(project, 'src', 'config', 'pet.config.json'));
    expectedFingerprint = audit.runtimeFingerprintForProject(project);
    packagedFingerprint = audit.runtimeFingerprintForProject(packagedRoot);
    expectedCandidateFingerprint = audit.candidateFingerprintForProject(project);
    packagedCandidateFingerprint = audit.candidateFingerprintForProject(packagedRoot);
    buildMetadata = audit.runtimeBuildMetadataForProject(project);
    artifactFingerprintSha256 = packagedArtifactFingerprint(portableArtifact.artifactRoot);
  } catch (error) {
    errors.push(`Performance report inputs could not be loaded: ${error.message}`);
  }
}

function containsPrivatePath(value) {
  if (typeof value === 'string') return sensitivePathMatches(value).length > 0;
  if (Array.isArray(value)) return value.some(containsPrivatePath);
  if (value && typeof value === 'object') return Object.values(value).some(containsPrivatePath);
  return false;
}

if (report && config && expectedFingerprint && packagedFingerprint && expectedCandidateFingerprint && packagedCandidateFingerprint && buildMetadata && artifactFingerprintSha256) {
  if (report.schemaVersion !== audit.PERFORMANCE_REPORT_SCHEMA_VERSION) errors.push(`Performance report schemaVersion must be ${audit.PERFORMANCE_REPORT_SCHEMA_VERSION}.`);
  if (report.fingerprintSchemaVersion !== audit.PERFORMANCE_FINGERPRINT_SCHEMA_VERSION) errors.push(`Performance fingerprint schemaVersion must be ${audit.PERFORMANCE_FINGERPRINT_SCHEMA_VERSION}.`);
  if (report.status !== 'pass' || report.evaluation?.pass !== true || (report.evaluation?.violations || []).length) errors.push('Performance report status/evaluation is not passing.');
  if (containsPrivatePath(report)) errors.push('Performance report contains a private path.');
  if (JSON.stringify(report.thresholds) !== JSON.stringify(audit.DEFAULT_PERFORMANCE_THRESHOLDS)) errors.push('Performance report thresholds do not match the fail-closed Skill contract.');
  if (expectedFingerprint !== packagedFingerprint || report.runtimeFingerprint !== expectedFingerprint) errors.push('Performance report, project, and packaged runtime fingerprints must match exactly.');
  if (expectedCandidateFingerprint !== packagedCandidateFingerprint || report.candidateFingerprint !== expectedCandidateFingerprint) errors.push('Performance report, project, and packaged candidate fingerprints must match exactly.');
  if (report.platform !== process.platform || report.arch !== process.arch) errors.push('Performance report platform/architecture does not match the validator host.');
  if (report.runtime?.electronVersion !== buildMetadata.electronVersion) errors.push('Performance report Electron version does not match the pinned runtime.');
  const executableSha256 = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
  if (report.runtime?.executableSha256 !== executableSha256) errors.push('Performance report executable SHA-256 does not match the measured executable.');
  if (report.runtime?.artifactFingerprintSha256 !== artifactFingerprintSha256) errors.push('Performance report artifact fingerprint does not match the complete Electron portable directory.');
  if (report.runner?.outerTimeoutMs < 20 * 60 * 1000 || report.runner?.executableExitCode !== 0 || report.runner?.timedOut !== false || report.runner?.crashed !== false || report.runner?.reportState !== 'complete') {
    errors.push('Performance runner did not complete cleanly inside the required outer timeout.');
  }
  const runnerLaunchedAt = Date.parse(report.runner?.launchedAt);
  const runnerCompletedAt = Date.parse(report.runner?.completedAt);
  const runnerElapsedMs = Number(report.runner?.elapsedMs);
  const runnerClockElapsedMs = runnerCompletedAt - runnerLaunchedAt;
  const measuredPhaseMs = Object.values(report.phases || {}).reduce((total, phase) => total + (Number(phase?.durationMs) || 0), 0);
  if (!Number.isFinite(runnerLaunchedAt) || !Number.isFinite(runnerCompletedAt) || !Number.isFinite(runnerElapsedMs)
    || runnerElapsedMs <= 0 || runnerCompletedAt < runnerLaunchedAt
    || Math.abs(runnerClockElapsedMs - runnerElapsedMs) > 5000
    || runnerElapsedMs > report.runner.outerTimeoutMs + 5000
    || measuredPhaseMs > runnerElapsedMs + 5000) {
    errors.push('Performance runner timing cannot contain the measured phase durations.');
  }
  const expectedWindowCount = Array.isArray(config.characters) ? config.characters.length : 0;
  const expectedPetIds = Array.isArray(config.characters) ? config.characters.map((entry) => entry.id) : [];
  if (report.expectedWindowCount !== expectedWindowCount || report.windowCount !== expectedWindowCount) errors.push(`Performance report must cover all ${expectedWindowCount} configured pet windows.`);
  if (JSON.stringify(report.expectedPetIds) !== JSON.stringify(expectedPetIds)) errors.push('Performance report expectedPetIds must exactly match configured pet ids in order.');
  const generatedAt = Date.parse(report.generatedAt);
  const ageMs = Date.now() - generatedAt;
  if (!Number.isFinite(generatedAt) || ageMs < -300000 || ageMs > 86400000) errors.push('Performance report is not fresh within 24 hours.');
  if (Number.isFinite(generatedAt) && Number.isFinite(runnerLaunchedAt) && Number.isFinite(runnerCompletedAt)
    && (generatedAt < runnerLaunchedAt - 5000 || generatedAt > runnerCompletedAt + 5000)) {
    errors.push('Performance report generation time is outside the runner interval.');
  }
  const minimumDurations = { idle: 60000, centipede: 60000, 'poop-chase': 60000, 'dad-shout': 1000, 'grandpa-shout': 1000, soak: 600000, pause: 30000 };
  for (const [name, minimum] of Object.entries(minimumDurations)) {
    const actual = report.phases?.[name]?.durationMs;
    if (!Number.isFinite(actual) || actual < minimum) errors.push(`Performance phase ${name} must run for at least ${minimum}ms.`);
  }
  const evaluation = audit.evaluatePerformanceReport(report, audit.DEFAULT_PERFORMANCE_THRESHOLDS, {
    expectedRuntimeFingerprint: expectedFingerprint,
    expectedCandidateFingerprint
  });
  if (!evaluation.pass) for (const violation of evaluation.violations) errors.push(`Performance violation ${violation.code}: ${violation.message}`);
}

if (errors.length) {
  console.error(`Performance report invalid:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Performance report valid: ${path.basename(reportPath)}`);
