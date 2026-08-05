import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyCodexRuntimeArgs, ensureElectronRuntime, fail, parseArgs, readJson } from './lib/common.mjs';
import { portableRelative } from './lib/privacy.mjs';

const args = parseArgs(process.argv.slice(2));
applyCodexRuntimeArgs(args);
if (!args.project) fail('Usage: node build_project.mjs --project <project> [--source <original-photo>] [--pnpm <codex-pnpm>] [--node-modules <codex-node-modules>] [--refresh-smoke] [--skip-smoke] [--skip-scenarios] [--verify-only]');
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
const productName = config.app?.name || 'Love Roommate';
const safeName = productName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'Love Roommate';
const nodeArgs = process.env.CODEX_NODE_MODULES ? ['--node-modules', process.env.CODEX_NODE_MODULES] : [];

function verifyScenarioReport(scenario, reportPath) {
  if (!fs.existsSync(reportPath)) fail(`Scenario report is missing: ${reportPath}`);
  const report = readJson(reportPath);
  const samples = Array.isArray(report.samples) ? report.samples : [];
  if (samples.length < 10) fail(`${scenario} scenario produced too few samples.`);
  for (const sample of samples) {
    for (const pet of sample.pets || []) {
      if (![pet.x, pet.y, pet.vx, pet.vy, pet.frame].every(Number.isFinite)) fail(`${scenario} produced non-finite pet state.`);
    }
  }
  const groupShout = scenario === 'dad-shout' || scenario === 'grandpa-shout';
  if (groupShout) {
    const recipientId = typeof report.recipientId === 'string' && report.recipientId ? report.recipientId : null;
    const participantIds = Array.isArray(report.participantIds) ? report.participantIds : [];
    const excludedIds = Array.isArray(report.excludedIds) ? report.excludedIds : [];
    const participantSet = new Set(participantIds);
    const excludedSet = new Set(excludedIds);
    const characterIds = config.characters.map((character) => character.id);
    const characterSet = new Set(characterIds);
    if (participantSet.size !== participantIds.length || excludedSet.size !== excludedIds.length) {
      fail(`${scenario} reported duplicate participant or excluded ids.`);
    }
    if ([...participantSet].some((id) => excludedSet.has(id))) fail(`${scenario} participant and excluded ids overlap.`);
    if ([...participantSet, ...excludedSet].some((id) => !characterSet.has(id))) fail(`${scenario} reported an unknown character id.`);
    if (recipientId && !characterSet.has(recipientId)) fail(`${scenario} reported an unknown recipient id.`);
    if (recipientId && participantSet.has(recipientId)) fail(`${scenario} included the recipient in the kneeling participants.`);
    if (recipientId && !excludedSet.has(recipientId)) fail(`${scenario} recipient is not protected by the excluded set.`);
    if (characterIds.some((id) => !participantSet.has(id) && !excludedSet.has(id))) fail(`${scenario} did not classify every character.`);
    if (JSON.stringify(report.expectedOrder || []) !== JSON.stringify(participantIds)) {
      fail(`${scenario} expected order does not match its participant ids.`);
    }
    const participantPets = (sample) => (sample.pets || []).filter((pet) => participantSet.has(pet.id));
    const excludedPets = (sample) => (sample.pets || []).filter((pet) => excludedSet.has(pet.id));
    const recipientPet = (sample) => recipientId ? (sample.pets || []).find((pet) => pet.id === recipientId) || null : null;
    const spectatorExcluded = (sample) => excludedPets(sample).filter((pet) => pet.id !== recipientId);
    if (samples.some((sample) => participantPets(sample).length !== participantSet.size || excludedPets(sample).length !== excludedSet.size)) {
      fail(`${scenario} samples do not contain the reported participant and excluded characters.`);
    }
    if (recipientId && samples.some((sample) => !recipientPet(sample))) fail(`${scenario} samples do not contain the reported recipient.`);
    if (samples.some((sample) => excludedPets(sample).some((pet) => pet.action === 'shout' || pet.phrase === report.expectedPhrase))) {
      fail(`${scenario} made an excluded character kneel or shout.`);
    }
    const firstExcluded = new Map(spectatorExcluded(samples[0]).map((pet) => [pet.id, pet]));
    if (samples.some((sample) => spectatorExcluded(sample).some((pet) => {
      const initial = firstExcluded.get(pet.id);
      return !initial || Math.abs(pet.x - initial.x) > 0.01 || Math.abs(pet.y - initial.y) > 0.01 || pet.action !== initial.action || pet.phrase !== initial.phrase;
    }))) {
      fail(`${scenario} changed an excluded character during the prank sequence.`);
    }
    if (report.skippedReason === 'no-eligible-participants') {
      if (participantIds.length || excludedSet.size !== characterSet.size) fail(`${scenario} returned an invalid no-participant result.`);
      if (samples.some((sample) => (sample.pets || []).some((pet) => pet.action === 'shout' || pet.phrase === report.expectedPhrase))) {
        fail(`${scenario} did not remain a safe no-op when every character was excluded.`);
      }
      const firstPets = new Map((samples[0].pets || []).map((pet) => [pet.id, pet]));
      if (samples.some((sample) => (sample.pets || []).some((pet) => {
        const initial = firstPets.get(pet.id);
        return !initial || Math.abs(pet.x - initial.x) > 0.01 || Math.abs(pet.y - initial.y) > 0.01 || pet.action !== initial.action || pet.phrase !== initial.phrase;
      }))) fail(`${scenario} moved a character during the no-participant event.`);
      return;
    }
    if (report.skippedReason !== null || !participantIds.length) fail(`${scenario} did not report an active participant set.`);
    const formingSamples = samples.filter((sample) => sample.phase === 'forming');
    const kneelingSamples = samples.filter((sample) => sample.phase === 'kneeling');
    const shoutingSamples = samples.filter((sample) => sample.phase === 'shouting');
    if (formingSamples.length < 3) fail(`${scenario} did not record multiple visible forming positions.`);
    if (!kneelingSamples.length) fail(`${scenario} skipped the kneeling phase.`);
    if (shoutingSamples.length < 3) fail(`${scenario} did not record the synchronized shout phase.`);
    if ([...formingSamples, ...kneelingSamples].some((sample) => participantPets(sample).some((pet) => pet.phrase || (pet.action === 'shout' && sample.phase === 'forming')))) {
      fail(`${scenario} shouted before the row was formed and kneeling.`);
    }
    const gatherSpeed = behaviors.groupShout?.gatherSpeed || 180;
    for (const sample of formingSamples) {
      for (const pet of participantPets(sample)) {
        if (Math.hypot(pet.vx, pet.vy) > gatherSpeed + 1) fail(`${scenario} exceeded the configured gather speed.`);
      }
      const recipient = recipientPet(sample);
      if (recipient && Math.hypot(recipient.vx, recipient.vy) > gatherSpeed + 1) fail(`${scenario} recipient exceeded the configured gather speed.`);
    }
    const eventSamples = [...formingSamples, ...kneelingSamples, ...shoutingSamples];
    if (recipientId && samples.some((sample) => {
      const recipient = recipientPet(sample);
      return !recipient || recipient.action === 'shout' || recipient.phrase;
    })) fail(`${scenario} recipient knelt, shouted, or displayed a prank bubble.`);
    if (recipientId && eventSamples.some((sample) => !/^idle_(left|right)$/.test(recipientPet(sample)?.action || ''))) {
      fail(`${scenario} recipient was not standing idle during the prank event.`);
    }
    if (recipientId) {
      const recipientPositions = new Set(formingSamples.map((sample) => {
        const recipient = recipientPet(sample);
        return `${recipient.x.toFixed(2)},${recipient.y.toFixed(2)}`;
      }));
      if (recipientPositions.size < 3) fail(`${scenario} recipient did not record multiple visible forming positions.`);
    }
    const frames = new Set(shoutingSamples.flatMap((sample) => participantPets(sample).map((pet) => Math.floor(pet.frame))));
    if (![0, 1, 2].every((frame) => frames.has(frame))) fail(`${scenario} did not play shout frames 0 -> 1 -> 2.`);
    if (shoutingSamples.some((sample) => participantPets(sample).some((pet) => pet.phrase !== report.expectedPhrase))) {
      fail(`${scenario} used the wrong or unsynchronized phrase.`);
    }
    const completedRow = kneelingSamples[0];
    const row = participantPets(completedRow).sort((a, b) => a.x - b.x);
    if (JSON.stringify(row.map((pet) => pet.id)) !== JSON.stringify(report.expectedOrder || [])) {
      fail(`${scenario} row order does not match the configured 3 -> 1 -> 2 -> 4 -> 5 sequence.`);
    }
    if (Math.max(...row.map((pet) => pet.y)) - Math.min(...row.map((pet) => pet.y)) > 1) fail(`${scenario} row is not horizontally aligned.`);
    const gaps = row.slice(1).map((pet, index) => pet.x - row[index].x);
    if (gaps.length && Math.max(...gaps) - Math.min(...gaps) > 1) fail(`${scenario} row spacing is unstable.`);
    if (row.some((pet) => pet.action !== 'shout' || Math.floor(pet.frame) !== 0 || pet.phrase)) fail(`${scenario} completed row is not silently kneeling before the shout.`);
    if (recipientId) {
      const recipient = recipientPet(completedRow);
      const size = config.render.spriteSize;
      const recipientCenter = recipient.x + size / 2;
      const rowCenter = (row[0].x + row.at(-1).x + size) / 2;
      if (Math.abs(recipientCenter - rowCenter) > 1) fail(`${scenario} recipient is not on the kneeling row center axis.`);
      if (recipient.y + size + 16 > row[0].y) fail(`${scenario} recipient overlaps the kneeling row instead of standing in front.`);
      if (row.some((pet) => pet.direction !== (pet.x + size / 2 < recipientCenter ? 'right' : 'left'))) {
        fail(`${scenario} participants are not facing the recipient.`);
      }
    }
    const captures = new Map((report.captures || []).map((capture) => [capture.label, capture]));
    for (const label of ['forming-early', 'forming-late', 'kneeling', 'shout-0', 'shout-1', 'shout-2']) {
      const capture = captures.get(label);
      if (!capture) fail(`${scenario} is missing the ${label} visual capture.`);
      const composition = path.join(path.dirname(reportPath), capture.composition || '');
      if (!fs.existsSync(composition)) fail(`${scenario} capture ${label} is missing its composition image.`);
    }
    return;
  }
  const leaders = samples.map((sample) => sample.leader).filter(Boolean);
  if (leaders.length < 2 || Math.hypot(leaders.at(-1).x - leaders[0].x, leaders.at(-1).y - leaders[0].y) < 40) {
    fail(`${scenario} leader did not visibly follow the simulated cursor.`);
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
const privacyScript = path.join(skillRoot, 'scripts', 'audit_output_privacy.mjs');
const performanceScript = path.join(skillRoot, 'scripts', 'validate_performance_report.mjs');
const windowsPerformanceReport = path.join(preview, 'performance', 'windows-performance-report.json');
const sourceArgs = typeof args.source === 'string' ? ['--source', path.resolve(args.source)] : [];
if (!runNode(validateScript, ['--project', project, ...sourceArgs, ...nodeArgs])) fail('Project validation failed.');
if (!runNode(selfCheckScript, ['--project', project, '--preview', preview, '--warn-only', ...nodeArgs])) {
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

const electronRuntime = ensureElectronRuntime(stage);
const electronExecutable = electronRuntime.executable;
if (!runNode('--test', [
  'tests/behavior-engine.test.mjs',
  'tests/performance-v2.test.mjs',
  'tests/performance-audit.test.mjs',
  'tests/config.test.mjs',
  'tests/security.test.mjs',
  'tests/scenario-capture.test.mjs',
  'tests/window-size-regression.test.mjs'
], stage)) fail('Generated project tests failed.');
fs.mkdirSync(preview, { recursive: true });

if (!args['skip-smoke'] && (!fs.existsSync(runtime) || args['refresh-smoke'])) {
  runElectron(electronExecutable, stage, { PET_SMOKE_TEST: '1', PET_SMOKE_OUT: runtime });
}
if (!fs.existsSync(runtime)) fail('Runtime screenshot is missing. Run without --skip-smoke.');

if (!args['skip-scenarios']) {
  const scenarios = [];
  if (behaviors.centipede?.enabled) scenarios.push('centipede');
  if (behaviors.poopChase?.enabled) scenarios.push('poop-chase');
  scenarios.push('dad-shout', 'grandpa-shout');
  for (const scenario of scenarios) {
    const scenarioDir = path.join(preview, 'scenarios', scenario);
    const reportPath = path.join(scenarioDir, 'report.json');
    const refreshScenario = args['refresh-smoke'] || !fs.existsSync(reportPath);
    if (refreshScenario) {
      fs.rmSync(scenarioDir, { recursive: true, force: true });
      fs.mkdirSync(scenarioDir, { recursive: true });
      runElectron(electronExecutable, stage, {
        PET_SCENARIO_TEST: scenario,
        PET_SCENARIO_OUT: reportPath,
        PET_SCENARIO_CAPTURE_DIR: scenarioDir,
        PET_SCENARIO_DURATION_MS: scenario.endsWith('-shout') ? '12000' : '6000'
      });
    }
    verifyScenarioReport(scenario, reportPath);
  }
}

if (!runNode(selfCheckScript, ['--project', project, '--preview', preview, '--runtime', runtime, ...nodeArgs])) {
  fail('Runtime review is incomplete. Inspect runtime-window.png and scenario captures, complete self-check-review.json, then rerun this command without --refresh-smoke.');
}
if (!runNode(privacyScript, ['--root', outputRoot, ...sourceArgs])) {
  fail('Output privacy audit failed. Remove host paths, unlisted raster files, or copied source photos before packaging.');
}
if (process.platform === 'win32' && !runNode(performanceScript, ['--project', project, '--report', windowsPerformanceReport])) {
  fail('Performance report validation failed. Run the packaged Windows performance audit and keep a fresh passing preview/performance/windows-performance-report.json.');
}

if (args['verify-only']) {
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(JSON.stringify({ project: 'project', preview: 'preview', verified: true, packaged: false, platform: `${process.platform}/${process.arch}` }, null, 2));
  process.exit(0);
}

if (!runNode(path.join(stage, 'tools', 'package-current.mjs'), [], stage, { PET_ELECTRON_DIST: electronRuntime.dist })) {
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

if (copied.length !== 1) fail(`Expected exactly one packaged application, received ${copied.length}.`);
const packagedArtifact = copied[0];
const packagedExecutable = process.platform === 'win32'
  ? path.join(packagedArtifact, `${safeName}.exe`)
  : path.join(packagedArtifact, 'Contents', 'MacOS', safeName);
if (!fs.existsSync(packagedExecutable)) fail(`Packaged executable is missing: ${portableRelative(outputRoot, packagedExecutable)}`);
const packagedSmoke = path.join(preview, `${platformFolder}-packaged-smoke.png`);
runElectron(packagedExecutable, packagedArtifact, {
  PET_SMOKE_TEST: '1',
  PET_SMOKE_OUT: packagedSmoke
});
if (!fs.existsSync(packagedSmoke)) fail(`Packaged smoke screenshot is missing: ${portableRelative(outputRoot, packagedSmoke)}`);
if (!runNode(privacyScript, ['--root', outputRoot, ...sourceArgs])) {
  fail('Post-package privacy audit failed. Remove host paths, unlisted raster files, copied source photos, or unsanitized error logs.');
}

fs.rmSync(stage, { recursive: true, force: true });
console.log(JSON.stringify({
  project: 'project',
  preview: 'preview',
  release: portableRelative(outputRoot, release),
  artifacts: copied.map((artifact) => portableRelative(outputRoot, artifact)),
  packagedSmoke: portableRelative(outputRoot, packagedSmoke),
  platform: `${process.platform}/${process.arch}`
}, null, 2));
