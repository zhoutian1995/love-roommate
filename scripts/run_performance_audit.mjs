import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.project || !args.executable) {
  console.error('Usage: node run_performance_audit.mjs --project <project> --executable <packaged-executable> [--report <json>] [--measure-only] [--quick]');
  process.exit(1);
}

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptRoot, '..');
const require = createRequire(import.meta.url);
const trustedAudit = require(path.join(skillRoot, 'assets', 'electron-template', 'src', 'performance-audit.js'));
const project = path.resolve(args.project);
const executable = path.resolve(args.executable);
const packagedRoot = path.join(path.dirname(executable), 'resources', 'app');
const outputRoot = path.dirname(project);
const report = path.resolve(args.report || path.join(outputRoot, 'preview', 'performance', 'windows-performance-report.json'));
const validator = path.join(scriptRoot, 'validate_performance_report.mjs');
const outerTimeoutMs = Number.isFinite(Number(args['timeout-ms'])) ? Number(args['timeout-ms']) : 25 * 60 * 1000;
const minimumFullTimeoutMs = 20 * 60 * 1000;

if (!fs.existsSync(path.join(project, 'package.json'))) throw new Error('Performance project package.json is missing.');
if (!fs.existsSync(executable)) throw new Error('Packaged performance executable is missing.');
if (!fs.existsSync(path.join(packagedRoot, 'runtime-build.json'))) throw new Error('Packaged runtime build metadata is missing.');
if (path.extname(report).toLowerCase() !== '.json') throw new Error('Performance report must be a JSON file.');
if (!args.quick && outerTimeoutMs < minimumFullTimeoutMs) throw new Error(`Full performance audit timeout must be at least ${minimumFullTimeoutMs}ms.`);

const projectFingerprint = trustedAudit.runtimeFingerprintForProject(project);
const packagedFingerprint = trustedAudit.runtimeFingerprintForProject(packagedRoot);
if (projectFingerprint !== packagedFingerprint) throw new Error('Project and packaged runtime fingerprints do not match.');
const executableSha256 = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');

function publicMessage(error) {
  return String(error?.message || error || 'unknown error')
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'`<>]*/g, '[redacted-path]')
    .replace(/\\\\[^\s"'`<>]+/g, '[redacted-path]');
}

function writeJson(value) {
  fs.mkdirSync(path.dirname(report), { recursive: true });
  const temporary = `${report}.runner.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.rmSync(report, { force: true });
  fs.renameSync(temporary, report);
}

function parseReport() {
  if (!fs.existsSync(report)) return null;
  try {
    return JSON.parse(fs.readFileSync(report, 'utf8'));
  } catch {
    return null;
  }
}

function terminateTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGKILL');
}

fs.mkdirSync(path.dirname(report), { recursive: true });
fs.rmSync(report, { force: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-performance-'));
const quickEnv = args.quick ? {
  PET_PERF_IDLE_MS: '5000',
  PET_PERF_CENTIPEDE_MS: '5000',
  PET_PERF_POOP_CHASE_MS: '5000',
  PET_PERF_PAUSE_MS: '5000',
  PET_PERF_SOAK_MS: '5000'
} : {};

const launchedAtEpochMs = Date.now();
let launchError = null;
let exited = false;
let exitCode = null;
let exitSignal = null;
const child = spawn(executable, [`--user-data-dir=${userData}`], {
  cwd: path.dirname(executable),
  env: {
    ...process.env,
    ...quickEnv,
    PET_PERFORMANCE_TEST: '1',
    PET_PERFORMANCE_OUT: report,
    PET_PERFORMANCE_LAUNCHED_AT_MS: String(launchedAtEpochMs),
    PET_PERFORMANCE_EXECUTABLE_SHA256: executableSha256
  },
  shell: false,
  stdio: 'ignore',
  windowsHide: true
});
child.once('error', (error) => { launchError = error; });
child.once('exit', (code, signal) => {
  exited = true;
  exitCode = code;
  exitSignal = signal;
});

const deadline = launchedAtEpochMs + outerTimeoutMs;
let lastParsed = null;
let terminalReport = null;
while (Date.now() < deadline) {
  const parsed = parseReport();
  if (parsed) {
    lastParsed = parsed;
    if (parsed.status === 'running') lastParsed = parsed;
    else terminalReport = parsed;
  }
  if (launchError || exited) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const timedOut = !exited && !launchError && Date.now() >= deadline;
if (timedOut) terminateTree(child);
for (let attempt = 0; attempt < 20 && !exited; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
const finalParsed = parseReport();
if (finalParsed) {
  lastParsed = finalParsed;
  if (finalParsed.status === 'running') lastParsed = finalParsed;
  else terminalReport = finalParsed;
}

const runner = {
  outerTimeoutMs,
  elapsedMs: Date.now() - launchedAtEpochMs,
  executableExitCode: exitCode,
  exitSignal,
  timedOut,
  crashed: Boolean(launchError || exitSignal || (exitCode !== null && exitCode !== 0)),
  reportState: terminalReport ? 'complete' : lastParsed ? 'partial' : 'missing'
};

const runnerFailed = launchError || timedOut || !exited || exitCode !== 0 || !terminalReport;
if (runnerFailed) {
  writeJson({
    schemaVersion: trustedAudit.PERFORMANCE_REPORT_SCHEMA_VERSION,
    fingerprintSchemaVersion: trustedAudit.PERFORMANCE_FINGERPRINT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: 'error',
    error: publicMessage(launchError || (timedOut ? 'Performance audit exceeded the outer timeout.' : `Performance executable exited before a valid terminal report (code ${exitCode}, signal ${exitSignal || 'none'}).`)),
    runtimeFingerprint: projectFingerprint,
    runner,
    partialReport: lastParsed
  });
  fs.rmSync(userData, { recursive: true, force: true });
  console.error('Performance audit did not complete cleanly; diagnostic report preserved.');
  process.exit(2);
}

terminalReport.runner = runner;
terminalReport.runtime = {
  ...terminalReport.runtime,
  executableSha256
};
writeJson(terminalReport);
fs.rmSync(userData, { recursive: true, force: true });

if (terminalReport.status !== 'pass') {
  console.error(`Performance report produced with status ${terminalReport.status}.`);
  process.exit(2);
}
console.log(`Performance report produced: ${path.basename(report)} (pass)`);
if (args.quick || args['measure-only']) process.exit(0);

const remainingMs = deadline - Date.now();
if (remainingMs <= 0) {
  console.error('Performance validator had no time remaining inside the outer timeout.');
  process.exit(2);
}
const validation = spawnSync(process.execPath, [validator, '--project', project, '--report', report, '--executable', executable, '--packaged-root', packagedRoot], {
  cwd: scriptRoot,
  encoding: 'utf8',
  shell: false,
  timeout: remainingMs
});
if (validation.stdout) process.stdout.write(validation.stdout);
if (validation.stderr) process.stderr.write(validation.stderr);
if (validation.error) console.error(publicMessage(validation.error));
process.exit(validation.status ?? 2);
