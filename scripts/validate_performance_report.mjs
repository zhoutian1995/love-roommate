import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs, readJson } from './lib/common.mjs';

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
const packagedRoot = path.resolve(args['packaged-root']);
const errors = [];
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
let buildMetadata = null;
if (!errors.length) {
  try {
    report = readJson(reportPath);
    config = readJson(path.join(project, 'src', 'config', 'pet.config.json'));
    expectedFingerprint = audit.runtimeFingerprintForProject(project);
    packagedFingerprint = audit.runtimeFingerprintForProject(packagedRoot);
    buildMetadata = audit.runtimeBuildMetadataForProject(project);
  } catch (error) {
    errors.push(`Performance report inputs could not be loaded: ${error.message}`);
  }
}

function containsPrivatePath(value) {
  if (typeof value === 'string') {
    return /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(value)
      || /^\\\\/.test(value)
      || /\/(?:Users|home)\/[^/\s]+/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsPrivatePath);
  if (value && typeof value === 'object') return Object.values(value).some(containsPrivatePath);
  return false;
}

if (report && config && expectedFingerprint && packagedFingerprint && buildMetadata) {
  if (report.schemaVersion !== audit.PERFORMANCE_REPORT_SCHEMA_VERSION) errors.push(`Performance report schemaVersion must be ${audit.PERFORMANCE_REPORT_SCHEMA_VERSION}.`);
  if (report.fingerprintSchemaVersion !== audit.PERFORMANCE_FINGERPRINT_SCHEMA_VERSION) errors.push(`Performance fingerprint schemaVersion must be ${audit.PERFORMANCE_FINGERPRINT_SCHEMA_VERSION}.`);
  if (report.status !== 'pass' || report.evaluation?.pass !== true || (report.evaluation?.violations || []).length) errors.push('Performance report status/evaluation is not passing.');
  if (containsPrivatePath(report)) errors.push('Performance report contains a private path.');
  if (JSON.stringify(report.thresholds) !== JSON.stringify(audit.DEFAULT_PERFORMANCE_THRESHOLDS)) errors.push('Performance report thresholds do not match the fail-closed Skill contract.');
  if (expectedFingerprint !== packagedFingerprint || report.runtimeFingerprint !== expectedFingerprint) errors.push('Performance report, project, and packaged runtime fingerprints must match exactly.');
  if (report.platform !== process.platform || report.arch !== process.arch) errors.push('Performance report platform/architecture does not match the validator host.');
  if (report.runtime?.electronVersion !== buildMetadata.electronVersion) errors.push('Performance report Electron version does not match the pinned runtime.');
  const executableSha256 = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
  if (report.runtime?.executableSha256 !== executableSha256) errors.push('Performance report executable SHA-256 does not match the measured executable.');
  if (report.runner?.outerTimeoutMs < 20 * 60 * 1000 || report.runner?.executableExitCode !== 0 || report.runner?.timedOut !== false || report.runner?.crashed !== false || report.runner?.reportState !== 'complete') {
    errors.push('Performance runner did not complete cleanly inside the required outer timeout.');
  }
  const expectedWindowCount = Array.isArray(config.characters) ? config.characters.length : 0;
  if (report.expectedWindowCount !== expectedWindowCount || report.windowCount !== expectedWindowCount) errors.push(`Performance report must cover all ${expectedWindowCount} configured pet windows.`);
  const generatedAt = Date.parse(report.generatedAt);
  const ageMs = Date.now() - generatedAt;
  if (!Number.isFinite(generatedAt) || ageMs < -300000 || ageMs > 86400000) errors.push('Performance report is not fresh within 24 hours.');
  const minimumDurations = { idle: 60000, centipede: 60000, 'poop-chase': 60000, 'dad-shout': 1000, 'grandpa-shout': 1000, soak: 600000, pause: 30000 };
  for (const [name, minimum] of Object.entries(minimumDurations)) {
    const actual = report.phases?.[name]?.durationMs;
    if (!Number.isFinite(actual) || actual < minimum) errors.push(`Performance phase ${name} must run for at least ${minimum}ms.`);
  }
  const evaluation = audit.evaluatePerformanceReport(report, audit.DEFAULT_PERFORMANCE_THRESHOLDS, { expectedRuntimeFingerprint: expectedFingerprint });
  if (!evaluation.pass) for (const violation of evaluation.violations) errors.push(`Performance violation ${violation.code}: ${violation.message}`);
}

if (errors.length) {
  console.error(`Performance report invalid:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Performance report valid: ${path.basename(reportPath)}`);
