import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyCodexRuntimeArgs, ensureElectronRuntime, fail, parseArgs, readJson } from './lib/common.mjs';
import { portableRelative } from './lib/privacy.mjs';
import { scenarioDurationMs } from './lib/scenario-timing.mjs';

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
const runtimeSecond = path.join(preview, 'runtime-window-2.png');
const runtimePaused = path.join(preview, 'runtime-paused.png');
const runtimeSmokeTechnical = path.join(preview, 'runtime-smoke-technical.png');
const runtimeEvidenceManifest = path.join(preview, 'runtime-evidence-manifest.json');
const runtimeSmokeError = path.join(preview, 'runtime-smoke-error.txt');
const obsoleteRuntimeEvidenceNames = [
  'normal-desktop-composite.png',
  'normal-desktop-composite-v2.png',
  'normal-desktop-composite-v3.png',
  'runtime-window-bottom-2x.png',
  'windows-packaged-smoke.png'
];
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
  const captures = Array.isArray(report.captures) ? report.captures : [];
  if (!report.skippedReason) {
    if (!captures.length) fail(`${scenario} scenario is missing release evidence captures.`);
    if (captures.some((capture) => capture.captureKind !== 'desktop-compositor' || capture.releaseEligible !== true)) {
      fail(`${scenario} scenario release evidence must come from the desktop compositor and be explicitly release eligible.`);
    }
  }
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
    const selectedSelfId = typeof config.selection?.userCharacterId === 'string' && config.selection.userCharacterId
      ? config.selection.userCharacterId
      : null;
    const expectedParticipantIds = selectedSelfId
      ? characterIds.filter((id) => id !== selectedSelfId)
      : characterIds;
    const expectedExcludedIds = selectedSelfId ? [selectedSelfId] : [];
    const singletonSelf = Boolean(selectedSelfId) && characterIds.length === 1;
    if (report.skippedReason === 'no-eligible-participants' && !singletonSelf) {
      fail(`${scenario} no-eligible-participants is allowed only for a single selected-self character.`);
    }
    if (recipientId !== selectedSelfId) {
      fail(selectedSelfId
        ? `${scenario} recipient must be the selected self.`
        : `${scenario} project without self must report a null recipient.`);
    }
    if (JSON.stringify(excludedIds) !== JSON.stringify(expectedExcludedIds)) {
      fail(selectedSelfId
        ? `${scenario} excluded ids must contain only the selected self.`
        : `${scenario} project without self must report null recipient and no excluded ids.`);
    }
    if (JSON.stringify(participantIds) !== JSON.stringify(expectedParticipantIds)) {
      fail(`${scenario} participants must contain every character except the selected self, in configured order.`);
    }
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
    const groupEventSamples = samples.filter((sample) => ['forming', 'kneeling', 'shouting'].includes(sample.phase));
    if (samples.some((sample) => participantPets(sample).length !== participantSet.size || excludedPets(sample).length !== excludedSet.size)) {
      fail(`${scenario} samples do not contain the reported participant and excluded characters.`);
    }
    if (recipientId && samples.some((sample) => !recipientPet(sample))) fail(`${scenario} samples do not contain the reported recipient.`);
    if (samples.some((sample) => excludedPets(sample).some((pet) => pet.action === 'shout' || pet.phrase === report.expectedPhrase))) {
      fail(`${scenario} made an excluded character kneel or shout.`);
    }
    const firstExcluded = new Map(spectatorExcluded(groupEventSamples[0] || samples[0]).map((pet) => [pet.id, pet]));
    if (groupEventSamples.some((sample) => spectatorExcluded(sample).some((pet) => {
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
    const eventSamples = groupEventSamples;
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
    const workArea = report.workArea;
    if (!workArea || ![workArea.x, workArea.y, workArea.width, workArea.height].every(Number.isFinite)
      || workArea.width <= 0 || workArea.height <= 0) fail(`${scenario} did not report a valid work area.`);
    const spriteSize = config.render.spriteSize;
    const windowSize = Number.isFinite(config.render.windowSize) && config.render.windowSize >= spriteSize
      ? config.render.windowSize
      : spriteSize;
    const windowPadding = (windowSize - spriteSize) / 2;
    const participants = participantPets(completedRow);
    const windowRect = (pet) => ({
      x: pet.x - windowPadding,
      y: pet.y - windowPadding,
      width: windowSize,
      height: windowSize
    });
    const visibleRect = (pet) => ({
      x: pet.x,
      y: pet.y,
      width: spriteSize,
      height: spriteSize
    });
    const windowCenter = (pet) => {
      const rect = windowRect(pet);
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    };
    const inWorkArea = (pet) => {
      const rect = windowRect(pet);
      return rect.x >= workArea.x - 0.01 && rect.y >= workArea.y - 0.01
        && rect.x + rect.width <= workArea.x + workArea.width + 0.01
        && rect.y + rect.height <= workArea.y + workArea.height + 0.01;
    };
    if (participants.some((pet) => !inWorkArea(pet))) fail(`${scenario} placed a kneeling participant outside the work area.`);
    const overlaps = (left, right) => {
      const leftRect = visibleRect(left);
      const rightRect = visibleRect(right);
      return leftRect.x < rightRect.x + rightRect.width - 0.01 && leftRect.x + leftRect.width > rightRect.x + 0.01
        && leftRect.y < rightRect.y + rightRect.height - 0.01 && leftRect.y + leftRect.height > rightRect.y + 0.01;
    };
    const completedPets = completedRow.pets || [];
    for (let left = 0; left < completedPets.length; left += 1) {
      for (let right = left + 1; right < completedPets.length; right += 1) {
        if (overlaps(completedPets[left], completedPets[right])) fail(`${scenario} completed formation characters visibly overlap.`);
      }
    }
    for (let left = 0; left < participants.length; left += 1) {
      for (let right = left + 1; right < participants.length; right += 1) {
        if (overlaps(participants[left], participants[right])) fail(`${scenario} kneeling participants overlap.`);
      }
    }
    const rows = [];
    for (const pet of [...participants].sort((left, right) => left.y - right.y || left.x - right.x)) {
      const current = rows.at(-1);
      if (!current || Math.abs(current[0].y - pet.y) > 1) rows.push([pet]);
      else current.push(pet);
    }
    for (const row of rows) row.sort((left, right) => left.x - right.x);
    const ordered = rows.flat();
    if (JSON.stringify(ordered.map((pet) => pet.id)) !== JSON.stringify(report.expectedOrder || [])) {
      fail(`${scenario} row-major order does not match the configured participant order.`);
    }
    for (const row of rows) {
      if (Math.max(...row.map((pet) => pet.y)) - Math.min(...row.map((pet) => pet.y)) > 1) fail(`${scenario} row is not horizontally aligned.`);
      const gaps = row.slice(1).map((pet, index) => pet.x - row[index].x);
      if (gaps.length && Math.max(...gaps) - Math.min(...gaps) > 1) fail(`${scenario} row spacing is unstable.`);
    }
    const rowTops = rows.map((row) => row[0].y);
    if (rowTops.slice(1).some((top, index) => top - rowTops[index] < spriteSize - 0.01)) fail(`${scenario} kneeling rows overlap vertically.`);
    const rowGaps = rowTops.slice(1).map((top, index) => top - rowTops[index]);
    if (rowGaps.length > 1 && Math.max(...rowGaps) - Math.min(...rowGaps) > 1) fail(`${scenario} row-to-row spacing is unstable.`);
    const rowCenters = rows.map((row) => {
      const first = windowRect(row[0]);
      const last = windowRect(row.at(-1));
      return (first.x + last.x + last.width) / 2;
    });
    if (Math.max(...rowCenters) - Math.min(...rowCenters) > 1) fail(`${scenario} kneeling rows do not share a center axis.`);
    if (ordered.some((pet) => pet.action !== 'shout' || Math.floor(pet.frame) !== 0 || pet.phrase)) fail(`${scenario} completed rows are not silently kneeling before the shout.`);
    if (recipientId) {
      const recipient = recipientPet(completedRow);
      if (!inWorkArea(recipient)) fail(`${scenario} placed the recipient outside the work area.`);
      if (participants.some((pet) => overlaps(recipient, pet))) fail(`${scenario} recipient overlaps a kneeling participant.`);
      const recipientRect = visibleRect(recipient);
      const recipientCenter = windowCenter(recipient).x;
      const rowCenter = rowCenters.reduce((total, center) => total + center, 0) / rowCenters.length;
      if (Math.abs(recipientCenter - rowCenter) > 1) fail(`${scenario} recipient is not on the kneeling row center axis.`);
      const firstRowTop = Math.min(...rows[0].map((pet) => visibleRect(pet).y));
      if (recipientRect.y + recipientRect.height + 16 > firstRowTop) fail(`${scenario} recipient overlaps the kneeling rows instead of standing in front.`);
      if (ordered.some((pet) => pet.direction !== (windowCenter(pet).x < recipientCenter ? 'right' : 'left'))) {
        fail(`${scenario} participants are not facing the recipient.`);
      }
      for (const sample of shoutingSamples) {
        const shoutingRecipient = recipientPet(sample);
        const shoutingRecipientCenter = windowCenter(shoutingRecipient).x;
        if (participantPets(sample).some((pet) => pet.direction !== (windowCenter(pet).x < shoutingRecipientCenter ? 'right' : 'left'))) {
          fail(`${scenario} participants did not keep facing the recipient throughout shouting.`);
        }
      }
    }
    const capturesByLabel = new Map(captures.map((capture) => [capture.label, capture]));
    const capturePhases = new Map([
      ['forming-early', 'forming'],
      ['forming-late', 'forming'],
      ['kneeling', 'kneeling'],
      ['shout-0', 'shouting'],
      ['shout-1', 'shouting'],
      ['shout-2', 'shouting']
    ]);
    for (const [label, expectedPhase] of capturePhases) {
      const capture = capturesByLabel.get(label);
      if (!capture) fail(`${scenario} is missing the ${label} visual capture.`);
      if (capture.phase !== expectedPhase) fail(`${scenario} capture ${label} recorded phase ${capture.phase || 'missing'} instead of ${expectedPhase}.`);
      const composition = path.join(path.dirname(reportPath), capture.composition || '');
      if (!fs.existsSync(composition)) fail(`${scenario} capture ${label} is missing its composition image.`);
    }
    return;
  }
  const leaders = samples.map((sample) => sample.leader).filter(Boolean);
  if (leaders.length < 2 || Math.hypot(leaders.at(-1).x - leaders[0].x, leaders.at(-1).y - leaders[0].y) < 40) {
    fail(`${scenario} leader did not visibly follow the simulated cursor.`);
  }
  const characterIds = config.characters.map((character) => character.id);
  const requireFullComposition = (capture, description) => {
    const composition = path.join(path.dirname(reportPath), capture?.composition || '');
    if (!capture || !capture.composition || !fs.existsSync(composition)) fail(`${description} is missing its full composition image.`);
    const capturedIds = new Set((capture.frames || []).map((frame) => frame.id));
    if (characterIds.some((id) => !capturedIds.has(id))) fail(`${description} does not contain every character window.`);
  };
  if (scenario === 'centipede') {
    const sequence = captures.filter((capture) => capture.evidence?.kind === 'cursor-centipede');
    if (sequence.length < 2) fail('Centipede evidence must contain two distinct full-composition chase moments.');
    const viewportKey = (capture) => {
      const bounds = capture.compositionBounds;
      if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
        || bounds.width <= 0 || bounds.height <= 0) return null;
      return `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    };
    const fixedViewport = viewportKey(sequence[0]);
    if (!fixedViewport || sequence.some((capture) => viewportKey(capture) !== fixedViewport)) {
      fail('Centipede sequence composition bounds must match one fixed viewport.');
    }
    for (const capture of sequence) {
      requireFullComposition(capture, `Centipede capture ${capture.label || 'unlabeled'}`);
      if (!(capture.effects || []).some((effect) => effect.role === 'cursor-poop' && effect.visible !== false)) {
        fail(`Centipede capture ${capture.label || 'unlabeled'} is missing the visible cursor poop.`);
      }
    }
    const position = (capture) => capture.evidence?.leaderPosition;
    const distinctMoments = sequence.some((capture, index) => sequence.slice(index + 1).some((other) => {
      const left = position(capture);
      const right = position(other);
      return left && right && [left.x, left.y, right.x, right.y].every(Number.isFinite)
        && [capture.evidence?.elapsedMs, other.evidence?.elapsedMs].every(Number.isFinite)
        && Math.abs(other.evidence.elapsedMs - capture.evidence.elapsedMs) >= 300
        && Math.hypot(right.x - left.x, right.y - left.y) >= 40;
    }));
    if (!distinctMoments) fail('Centipede evidence must show two distinct times and chase positions at least 40 pixels apart.');
  }
  if (scenario === 'poop-chase') {
    if (samples.some((sample) => (sample.droppings || []).length !== 1)) fail('Poop relay must keep exactly one dropping in every sampled frame.');
    const sources = new Set(samples.flatMap((sample) => (sample.droppings || []).map((dropping) => dropping.sourceId)).filter(Boolean));
    const expectedSource = config.selection?.userCharacterId;
    if (!expectedSource || sources.size !== 1 || !sources.has(expectedSource)) {
      fail('Poop chase must keep the selected self as the only persistent poop source.');
    }
    const expectedTargets = config.characters.map((character) => character.id).filter((id) => id !== expectedSource);
    const targets = new Set(samples.flatMap((sample) => (sample.droppings || []).map((dropping) => dropping.targetId)).filter(Boolean));
    if (expectedTargets.some((id) => !targets.has(id))) fail('Poop chase did not let every other character eat from the selected self.');
    if (samples.some((sample) => (sample.droppings || []).some((dropping) => dropping.cursorControlled))) {
      fail('Selected-self poop chase unexpectedly used the cursor-controlled poop variant.');
    }
    const expectedEaters = new Set(expectedTargets);
    const eatingCaptures = captures.filter((capture) => capture.evidence?.kind === 'eating-climax');
    const capturedEaters = new Set(eatingCaptures.map((capture) => capture.evidence?.eaterId).filter((id) => expectedEaters.has(id)));
    if (capturedEaters.size < Math.min(2, expectedEaters.size)) fail('Poop chase evidence must show two different eaters at their eating climax.');
    for (const capture of eatingCaptures) requireFullComposition(capture, `Poop chase eating capture ${capture.label || 'unlabeled'}`);
    const handoffCapture = captures.find((capture) => {
      const evidence = capture.evidence;
      return evidence?.kind === 'handoff-return'
        && expectedEaters.has(evidence.returningEaterId)
        && expectedEaters.has(evidence.nextEaterId)
        && evidence.returningEaterId !== evidence.nextEaterId;
    });
    if (!handoffCapture) fail('Poop chase evidence is missing a return handoff composition between different eaters.');
    requireFullComposition(handoffCapture, 'Poop chase return handoff capture');
  }
}

if (args['verify-scenario-report']) {
  if (typeof args.scenario !== 'string' || typeof args.report !== 'string') {
    fail('Usage: node build_project.mjs --project <project> --verify-scenario-report --scenario <name> --report <report.json>');
  }
  verifyScenarioReport(args.scenario, path.resolve(args.report));
  console.log(JSON.stringify({ scenario: args.scenario, report: 'verified' }));
  process.exit(0);
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
const performanceReleaseScript = path.join(skillRoot, 'scripts', 'validate_performance_release.mjs');
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
const stagedDist = path.join(stage, 'dist');
const stagedPackagedArtifact = path.join(stagedDist, 'windows', safeName);
let stagedCandidatePackaged = false;

function packageStagedCandidate() {
  if (stagedCandidatePackaged) return;
  if (!runNode(path.join(stage, 'tools', 'package-current.mjs'), [], stage, { PET_ELECTRON_DIST: electronRuntime.dist })) {
    fail('Current-platform packaging failed.');
  }
  stagedCandidatePackaged = true;
}

function validatePerformanceCandidate(artifact) {
  const executable = path.join(artifact, `${safeName}.exe`);
  const packagedRoot = path.join(artifact, 'resources', 'app');
  if (!runNode(performanceScript, [
    '--project', project,
    '--report', windowsPerformanceReport,
    '--executable', executable,
    '--packaged-root', packagedRoot
  ])) {
    fail('Performance report validation failed. Run the packaged Windows performance audit and keep a fresh passing preview/performance/windows-performance-report.json.');
  }
}
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

const runtimeEvidenceFiles = [runtime, runtimeSecond, runtimePaused, runtimeSmokeTechnical, runtimeEvidenceManifest];
if (args['refresh-smoke']) {
  for (const name of obsoleteRuntimeEvidenceNames) {
    const obsoletePath = path.join(preview, name);
    fs.rmSync(obsoletePath, { force: true });
  }
}
if (!args['skip-smoke'] && (runtimeEvidenceFiles.some((file) => !fs.existsSync(file)) || args['refresh-smoke'])) {
  for (const file of [...runtimeEvidenceFiles, runtimeSmokeError]) {
    fs.rmSync(file, { force: true });
  }
  runElectron(electronExecutable, stage, {
    PET_SMOKE_TEST: '1',
    PET_RUNTIME_OUT: runtime,
    PET_RUNTIME_OUT_2: runtimeSecond,
    PET_RUNTIME_PAUSED_OUT: runtimePaused,
    PET_SMOKE_OUT: runtimeSmokeTechnical,
    PET_RUNTIME_EVIDENCE_MANIFEST: runtimeEvidenceManifest
  });
}
if (fs.existsSync(runtimeSmokeError)) fail(`Runtime evidence capture failed: ${fs.readFileSync(runtimeSmokeError, 'utf8').trim()}`);
if (runtimeEvidenceFiles.some((file) => !fs.existsSync(file))) fail('Runtime product or technical evidence is missing. Run without --skip-smoke.');

if (!args['skip-scenarios']) {
  const scenarios = [];
  if (behaviors.centipede?.enabled) scenarios.push('centipede');
  if (behaviors.poopChase?.enabled) scenarios.push('poop-chase');
  if (behaviors.groupShout?.enabled) scenarios.push('dad-shout', 'grandpa-shout');
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
        PET_SCENARIO_DURATION_MS: String(scenarioDurationMs(scenario, config, behaviors))
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
if (process.platform === 'win32') {
  packageStagedCandidate();
  validatePerformanceCandidate(stagedPackagedArtifact);
}
if (process.platform === 'win32' && args['release-performance-gate']) {
  if (config.characters.length !== 8) fail('The release performance gate must run from the final eight-window candidate project.');
  const fiveArgs = ['five-performance-project', 'five-performance-report', 'five-performance-executable', 'five-performance-packaged-root'];
  if (fiveArgs.some((name) => typeof args[name] !== 'string' || !args[name])) {
    fail('The release performance gate requires the five-window project, report, executable, and packaged root.');
  }
  if (!runNode(performanceReleaseScript, [
    '--five-project', path.resolve(args['five-performance-project']),
    '--five-report', path.resolve(args['five-performance-report']),
    '--five-executable', path.resolve(args['five-performance-executable']),
    '--five-packaged-root', path.resolve(args['five-performance-packaged-root']),
    '--eight-project', project,
    '--eight-report', windowsPerformanceReport,
    '--eight-executable', path.join(stagedPackagedArtifact, `${safeName}.exe`),
    '--eight-packaged-root', path.join(stagedPackagedArtifact, 'resources', 'app')
  ])) fail('The combined five-window plus eight-window packaged performance release gate failed.');
}

if (args['verify-only']) {
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(JSON.stringify({ project: 'project', preview: 'preview', verified: true, packaged: false, platform: `${process.platform}/${process.arch}` }, null, 2));
  process.exit(0);
}

packageStagedCandidate();
const dist = stagedDist;
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
if (process.platform === 'win32') validatePerformanceCandidate(packagedArtifact);
const packagedSmoke = path.join(preview, `${platformFolder}-packaged-smoke.png`);
const packagedSmokeSecond = path.join(preview, `${platformFolder}-packaged-smoke-2.png`);
const packagedPaused = path.join(preview, `${platformFolder}-packaged-paused.png`);
const packagedSmokeTechnical = path.join(preview, `${platformFolder}-packaged-smoke-technical.png`);
const packagedEvidenceManifest = path.join(preview, `${platformFolder}-packaged-evidence-manifest.json`);
runElectron(packagedExecutable, packagedArtifact, {
  PET_SMOKE_TEST: '1',
  PET_RUNTIME_OUT: packagedSmoke,
  PET_RUNTIME_OUT_2: packagedSmokeSecond,
  PET_RUNTIME_PAUSED_OUT: packagedPaused,
  PET_SMOKE_OUT: packagedSmokeTechnical,
  PET_RUNTIME_EVIDENCE_MANIFEST: packagedEvidenceManifest
});
const packagedEvidenceFiles = [packagedSmoke, packagedSmokeSecond, packagedPaused, packagedSmokeTechnical, packagedEvidenceManifest];
if (packagedEvidenceFiles.some((file) => !fs.existsSync(file))) fail(`Packaged runtime evidence is incomplete under: ${portableRelative(outputRoot, preview)}`);
if (process.platform === 'win32') validatePerformanceCandidate(packagedArtifact);
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
  packagedSmokeTechnical: portableRelative(outputRoot, packagedSmokeTechnical),
  platform: `${process.platform}/${process.arch}`
}, null, 2));
