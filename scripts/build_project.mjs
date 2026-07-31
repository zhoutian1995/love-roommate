import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyCodexRuntimeArgs, ensureElectronRuntime, fail, parseArgs, readJson } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
applyCodexRuntimeArgs(args);
if (!args.project) fail('Usage: node build_project.mjs --project <project> [--pnpm <codex-pnpm>] [--node-modules <codex-node-modules>] [--refresh-smoke] [--skip-smoke] [--skip-scenarios] [--verify-only]');
const project = path.resolve(args.project);
if (!fs.existsSync(path.join(project, 'package.json'))) fail(`Not a generated project: ${project}`);
if (process.platform !== 'win32' && !(process.platform === 'darwin' && process.arch === 'arm64')) {
  fail(`Unsupported build host: ${process.platform}/${process.arch}. Build on Windows x64 or Apple-silicon macOS.`);
}

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.dirname(project);
const preview = path.join(outputRoot, 'preview');
const runtime = path.join(preview, 'runtime-window.png');
const config = readJson(path.join(project, 'src', 'config', 'pet.config.json'));
const behaviors = readJson(path.join(project, 'src', 'config', 'behaviors.json'));
const nodeArgs = process.env.CODEX_NODE_MODULES ? ['--node-modules', process.env.CODEX_NODE_MODULES] : [];

function verifyScenarioReport(scenario, reportPath) {
  if (!fs.existsSync(reportPath)) fail(`Scenario report is missing: ${reportPath}`);
  const report = readJson(reportPath);
  const samples = Array.isArray(report.samples) ? report.samples : [];
  if (samples.length < 10) fail(`${scenario} scenario produced too few samples.`);
  const leaders = samples.map((sample) => sample.leader).filter(Boolean);
  if (leaders.length < 2 || Math.hypot(leaders.at(-1).x - leaders[0].x, leaders.at(-1).y - leaders[0].y) < 40) {
    fail(`${scenario} leader did not visibly follow the simulated cursor.`);
  }
  for (const sample of samples) {
    for (const pet of sample.pets || []) {
      if (!Number.isFinite(pet.x)) fail(`${scenario} produced a non-finite pet position.`);
    }
  }
  if (scenario === 'poop-chase') {
    if (samples.some((sample) => (sample.droppings || []).length !== 1)) fail('Poop relay must keep exactly one dropping in every sampled frame.');
    const sources = new Set(samples.flatMap((sample) => (sample.droppings || []).map((dropping) => dropping.sourceId)).filter(Boolean));
    if (sources.size < 2) fail('Poop relay did not advance to a second participant during the scenario test.');
  }
}

function runNode(script, scriptArgs, cwd = project, extraEnv = {}) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extraEnv }
  });
  return result.status === 0;
}

function runElectron(executable, cwd, extraEnv) {
  const result = spawnSync(executable, [cwd], {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extraEnv }
  });
  if (result.status !== 0) fail(`Electron runtime test failed with exit code ${result.status}.`);
}

const validateScript = path.join(skillRoot, 'scripts', 'validate_project.mjs');
const selfCheckScript = path.join(skillRoot, 'scripts', 'self_check_project.mjs');
if (!runNode(validateScript, ['--project', project, ...nodeArgs])) fail('Project validation failed.');
if (!runNode(selfCheckScript, ['--project', project, '--preview', preview, ...nodeArgs])) {
  fail('Asset self-check is incomplete. Review the generated identity/contact artifacts before building.');
}

const stageRoot = path.join(os.tmpdir(), 'codex-pet-build');
const stageName = crypto.createHash('sha256').update(project).digest('hex').slice(0, 12);
const stage = path.join(stageRoot, stageName);
fs.mkdirSync(stageRoot, { recursive: true });
if (path.dirname(stage) !== stageRoot) fail(`Unsafe staging path: ${stage}`);
fs.rmSync(stage, { recursive: true, force: true });
fs.cpSync(project, stage, {
  recursive: true,
  filter: (source) => !['node_modules', 'dist'].includes(path.basename(source))
});

const electronExecutable = ensureElectronRuntime(stage);
if (!runNode('--test', ['tests/behavior-engine.test.mjs', 'tests/config.test.mjs'], stage)) fail('Generated project tests failed.');
fs.mkdirSync(preview, { recursive: true });

if (!args['skip-smoke'] && (!fs.existsSync(runtime) || args['refresh-smoke'])) {
  runElectron(electronExecutable, stage, { PET_SMOKE_TEST: '1', PET_SMOKE_OUT: runtime });
}
if (!fs.existsSync(runtime)) fail('Runtime screenshot is missing. Run without --skip-smoke.');

if (!args['skip-scenarios']) {
  const scenarios = [];
  if (behaviors.centipede?.enabled) scenarios.push('centipede');
  if (behaviors.poopChase?.enabled) scenarios.push('poop-chase');
  for (const scenario of scenarios) {
    const scenarioDir = path.join(preview, 'scenarios', scenario);
    const reportPath = path.join(scenarioDir, 'report.json');
    fs.mkdirSync(scenarioDir, { recursive: true });
    runElectron(electronExecutable, stage, {
      PET_SCENARIO_TEST: scenario,
      PET_SCENARIO_OUT: reportPath,
      PET_SCENARIO_CAPTURE_DIR: scenarioDir,
      PET_SCENARIO_DURATION_MS: '6000'
    });
    verifyScenarioReport(scenario, reportPath);
  }
}

if (!runNode(selfCheckScript, ['--project', project, '--preview', preview, '--runtime', runtime, ...nodeArgs])) {
  fail('Runtime review is incomplete. Inspect runtime-window.png and scenario captures, complete self-check-review.json, then rerun this command without --refresh-smoke.');
}

if (args['verify-only']) {
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(JSON.stringify({ project, preview, verified: true, packaged: false, platform: `${process.platform}/${process.arch}` }, null, 2));
  process.exit(0);
}

if (!runNode(path.join(stage, 'tools', 'package-current.mjs'), [], stage, { PET_ELECTRON_DIST: path.dirname(electronExecutable) })) {
  fail('Current-platform packaging failed.');
}
const dist = path.join(stage, 'dist');
const platformFolder = process.platform === 'win32' ? 'windows' : 'macos';
const release = path.join(outputRoot, 'release', platformFolder);
fs.mkdirSync(release, { recursive: true });

function uniquePath(target) {
  if (!fs.existsSync(target)) return target;
  const extension = path.extname(target);
  const base = target.slice(0, target.length - extension.length);
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}${extension}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  fail(`Could not create a non-overwriting artifact path for ${target}`);
}

const copied = [];
if (process.platform === 'win32') {
  const sourceRoot = path.join(dist, 'windows');
  const appDirectories = fs.existsSync(sourceRoot)
    ? fs.readdirSync(sourceRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(sourceRoot, entry.name))
    : [];
  if (!appDirectories.length) fail(`No portable Windows app directory found under ${sourceRoot}`);
  for (const appDirectory of appDirectories) {
    const destination = uniquePath(path.join(release, path.basename(appDirectory)));
    fs.cpSync(appDirectory, destination, { recursive: true, errorOnExist: true });
    copied.push(destination);
  }
} else {
  const appBundles = [];
  const stack = [path.join(dist, 'macos')];
  while (stack.length) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name.endsWith('.app')) appBundles.push(full);
      else if (entry.isDirectory()) stack.push(full);
    }
  }
  if (!appBundles.length) fail(`No macOS app bundle found under ${dist}`);
  for (const bundle of appBundles) {
    const destination = uniquePath(path.join(release, path.basename(bundle)));
    fs.cpSync(bundle, destination, { recursive: true, errorOnExist: true, verbatimSymlinks: true });
    copied.push(destination);
  }
}

fs.rmSync(stage, { recursive: true, force: true });
console.log(JSON.stringify({ project, preview, release, artifacts: copied, platform: `${process.platform}/${process.arch}` }, null, 2));
