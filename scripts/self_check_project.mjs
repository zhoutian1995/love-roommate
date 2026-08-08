import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { applyCodexRuntimeArgs, fail, loadSharp, parseArgs, readJson, writeJson } from './lib/common.mjs';
import { actionFrameDescriptor, compareActionContract, deriveActionContract } from './lib/action-contract.mjs';
import { alphaBounds, nearestVisibleAlphaDistance } from './lib/sprite-processing.mjs';
import { isSupportedGeneratedAttestation } from './lib/generation-attestation.mjs';
import { portableRelative, sanitizePersistedValue } from './lib/privacy.mjs';
import { validateCorrectionLineage } from './lib/transparency-retry.mjs';
import { validatePreviewProvenance } from './lib/preview-provenance.mjs';

const args = parseArgs(process.argv.slice(2));
applyCodexRuntimeArgs(args);
if (!args.project) {
  fail('Usage: node self_check_project.mjs --project <project> [--preview <preview-dir>] [--runtime <runtime-window.png>] [--review <self-check-review.json>] [--min-score 90] [--warn-only]');
}

const project = path.resolve(args.project);
const preview = path.resolve(args.preview || path.join(path.dirname(project), 'preview'));
const outputRoot = path.dirname(project);
let projectRelative;
let previewRelative;
try {
  projectRelative = portableRelative(outputRoot, project, 'Project');
  previewRelative = portableRelative(outputRoot, preview, 'Preview');
} catch (error) {
  fail(error.message);
}
if (projectRelative !== 'project' || previewRelative !== 'preview') {
  fail('Self-check requires the standard output layout with project/ and preview/ under one output root.');
}
const configPath = path.join(project, 'src', 'config', 'pet.config.json');
const behaviorsPath = path.join(project, 'src', 'config', 'behaviors.json');
const manifestPath = path.join(project, 'src', 'assets', 'sprites', 'manifest.json');
if (!fs.existsSync(configPath) || !fs.existsSync(behaviorsPath) || !fs.existsSync(manifestPath)) fail(`Not a generated desktop-pet project: ${project}`);

const minScore = Number.parseInt(args['min-score'] || '90', 10);
if (!Number.isInteger(minScore) || minScore < 1 || minScore > 100) fail('--min-score must be an integer from 1 to 100.');

const config = readJson(configPath);
const behaviors = readJson(behaviorsPath);
const manifest = readJson(manifestPath);
const sharp = loadSharp(project);
sharp.cache(false);
fs.mkdirSync(preview, { recursive: true });

const reportPath = path.join(preview, 'self-check-report.json');
const markdownPath = path.join(preview, 'self-check-report.md');
const defaultReviewPath = path.join(preview, 'self-check-review.json');
if (args.runtime === true) fail('--runtime requires an image path.');
if (args.review === true) fail('--review requires a JSON path.');
const runtimePath = args.runtime
  ? path.resolve(args.runtime)
  : fs.existsSync(path.join(preview, 'runtime-window.png'))
    ? path.join(preview, 'runtime-window.png')
    : null;
const runtimeSecondPath = path.join(preview, 'runtime-window-2.png');
const runtimePausedPath = path.join(preview, 'runtime-paused.png');
const runtimeTechnicalPath = path.join(preview, 'runtime-smoke-technical.png');
const runtimeEvidenceManifestPath = path.join(preview, 'runtime-evidence-manifest.json');
const reviewPath = args.review ? path.resolve(args.review) : defaultReviewPath;
let runtimeRelative = null;
let reviewRelative;
try {
  runtimeRelative = runtimePath ? portableRelative(outputRoot, runtimePath, 'Runtime screenshot') : null;
  reviewRelative = portableRelative(outputRoot, reviewPath, 'Manual review');
} catch (error) {
  fail(error.message);
}
const spriteRoot = path.join(project, 'src', 'assets', 'sprites');
const issues = [];
const frameMetrics = [];
const frameBuffers = new Map();
const characterFiles = new Map(config.characters.map((character) => [character.id, []]));
const identityBoardPath = path.join(preview, 'identity-board.png');
const contactSheetPath = path.join(preview, 'action-contact-sheet.png');
const generationManifestPath = path.join(preview, 'generation-manifest.json');
const identityQualityPath = path.join(preview, 'identity-quality-review.json');
const scenarioRoot = path.join(preview, 'scenarios');
const poopChase = behaviors.poopChase || {};
const poopFollowers = Array.isArray(poopChase.followerIds) ? poopChase.followerIds : [];
const actionContract = deriveActionContract(config);

function requiredCharacterChecks(characterId) {
  const checks = ['identityConsistency', 'clothingSeparation', 'actionReadability', 'bodyCompleteness', 'edgeQuality'];
  if (actionContract.rolesByCharacter[characterId]?.chaseRole) {
    checks.push('roleActionReadability');
  }
  return checks;
}

function addIssue(severity, code, message, recommendation, details = {}, penalty) {
  const defaultPenalty = severity === 'error' ? 18 : severity === 'warning' ? 5 : 0;
  issues.push({ severity, code, message, recommendation, penalty: penalty ?? defaultPenalty, ...details });
}

function validateIdentityQuality() {
  if (!fs.existsSync(identityQualityPath)) {
    addIssue('error', 'missing-identity-quality-review', 'Missing identity-quality-review.json.', 'Compare the source photo, identity masters, and action board; then complete the 100-point identity review.', {}, 30);
    return null;
  }
  const data = readJson(identityQualityPath);
  const weights = {
    identitySimilarity: 35,
    crossActionConsistency: 20,
    clothingAndAccessories: 15,
    ageSkinBody: 10,
    photorealStyleConsistency: 10,
    bodyEdgesReadability: 10
  };
  if (data.schemaVersion !== 1 || !Array.isArray(data.characters)) {
    addIssue('error', 'invalid-identity-quality-review', 'identity-quality-review.json has an invalid schema.', 'Regenerate the identity review template and score every person.', {}, 30);
    return data;
  }
  for (const character of config.characters) {
    const review = data.characters.find((item) => item.id === character.id);
    if (!review) {
      addIssue('error', 'missing-identity-score', `Missing identity score for ${character.id}.`, 'Score this person against the original photo and approved master.', { characterId: character.id }, 25);
      continue;
    }
    let total = 0;
    let invalid = false;
    for (const [key, max] of Object.entries(weights)) {
      const value = review.scores?.[key];
      if (!Number.isFinite(value) || value < 0 || value > max) invalid = true;
      else total += value;
    }
    const blockers = Array.isArray(review.blockers) ? review.blockers.filter(Boolean) : [];
    if (invalid || total < 90 || review.scores?.identitySimilarity < 31 || blockers.length || review.status !== 'pass') {
      addIssue('error', 'identity-quality-failed', `${character.id} identity review failed (${total}/100).`, 'Regenerate only the failed master/action from the original photo and approved master; do not lower thresholds.', { characterId: character.id, total, blockers }, 25);
    }
  }
  return data;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function fileHash(file) {
  return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
}

function combinedHash(values) {
  const hash = crypto.createHash('sha256');
  for (const value of values.filter(Boolean)) hash.update(value);
  return hash.digest('hex');
}

function scenarioEvidenceFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(current);
      else if (entry.isFile()) files.push(current);
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function releaseEligibleScenarioEvidencePaths(root) {
  if (!fs.existsSync(root)) return [];
  const references = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const scenarioDirectory = path.join(root, entry.name);
    const reportPath = path.join(scenarioDirectory, 'report.json');
    if (!fs.existsSync(reportPath)) continue;
    let report;
    try {
      report = readJson(reportPath);
    } catch {
      continue;
    }
    for (const capture of Array.isArray(report.captures) ? report.captures : []) {
      if (capture?.captureKind !== 'desktop-compositor' || capture?.releaseEligible !== true || typeof capture?.composition !== 'string') continue;
      const composition = path.resolve(scenarioDirectory, capture.composition);
      const relativeToScenario = path.relative(scenarioDirectory, composition);
      if (!relativeToScenario || relativeToScenario.startsWith('..') || path.isAbsolute(relativeToScenario) || !fs.existsSync(composition)) continue;
      references.push(portableRelative(outputRoot, composition));
    }
  }
  return [...new Set(references)].sort((left, right) => left.localeCompare(right));
}

async function validateGenerationManifest() {
  if (!fs.existsSync(generationManifestPath)) return null;
  const data = readJson(generationManifestPath);
  const policy = data.provenancePolicy || {};
  if (
    ![2, 3].includes(data.schemaVersion) ||
    policy.generator !== 'codex-imagegen' ||
    policy.declaredModelPolicy !== 'gpt-image-2' ||
    policy.evidenceLevel !== 'workflow-attested' ||
    !Array.isArray(data.assets)
  ) {
    addIssue('error', 'generation-manifest-schema', 'The generation manifest does not satisfy the supported image-generation workflow policy.', 'Regenerate the manifest and record the final artwork with record_image_generation.mjs.', {}, 25);
    return data;
  }
  const required = [{ kind: 'identity', characterId: null, role: null }];
  const commonActionNames = [
    'crawl_right_1', 'crawl_right_2', 'crawl_left_1', 'crawl_left_2',
    'idle_right', 'idle_left', 'drag'
  ];
  const groupShoutActionNames = ['kneel_shout_1', 'kneel_shout_2', 'kneel_shout_3'];
  const centipedeActionNames = ['centipede_right', 'centipede_left'];
  const poopActionNames = ['poop_right', 'poop_left'];
  const eatActionNames = ['eat_right', 'eat_left'];
  const actionNames = [
    ...commonActionNames,
    ...groupShoutActionNames,
    ...centipedeActionNames,
    ...poopActionNames,
    ...eatActionNames
  ];
  const allowedActions = new Set(actionNames);
  const horizontalFlipPairs = new Map([
    ['crawl_right_1', 'crawl_left_1'], ['crawl_left_1', 'crawl_right_1'],
    ['crawl_right_2', 'crawl_left_2'], ['crawl_left_2', 'crawl_right_2'],
    ['idle_right', 'idle_left'], ['idle_left', 'idle_right'],
    ['centipede_right', 'centipede_left'], ['centipede_left', 'centipede_right'],
    ['poop_right', 'poop_left'], ['poop_left', 'poop_right'],
    ['eat_right', 'eat_left'], ['eat_left', 'eat_right']
  ]);
  const history = Array.isArray(data.history) ? data.history : [];
  if (data.history !== undefined && !Array.isArray(data.history)) {
    addIssue('error', 'generation-history-schema', 'Generation manifest history must be an array.', 'Record the affected generated assets again with the current recorder.', {}, 20);
  }
  for (const entry of data.assets) {
    if (entry.kind === 'action' && !allowedActions.has(entry.action)) {
      addIssue('error', 'unsupported-generation-action', `Generation manifest contains unsupported action ${entry.action}.`, 'Remove the unsupported record and generate only documented actions.', { action: entry.action }, 20);
    }
    if (data.schemaVersion === 3 && entry.kind === 'action' && !['generated', 'derived'].includes(entry.origin)) {
      addIssue('error', 'missing-action-origin', `Generation manifest action ${entry.action} has no valid origin.`, 'Record the action again as generated or derived.', { action: entry.action }, 20);
    }
  }
  for (const entry of [...history, ...data.assets]) {
    const origin = data.schemaVersion === 2 ? 'generated' : (entry.origin || 'generated');
    if (origin === 'generated' && !isSupportedGeneratedAttestation(entry)) {
      addIssue(
        'error',
        'invalid-image-generation-attestation',
        `${entry.key || entry.file || 'unknown asset'} has an incomplete or unsupported image-generation workflow attestation.`,
        'Record the asset again with a supported image-generation workflow.',
        { asset: entry.key || null, file: entry.file || null },
        25
      );
    }
    if (origin === 'derived' && (
      entry.generator || entry.declaredModelPolicy || entry.evidenceLevel || entry.promptVersion ||
      entry.generationMode || entry.fallbackAuthorization || entry.fallbackReason
    )) {
      addIssue(
        'error',
        'mixed-derived-attestation',
        `${entry.key || entry.file || 'unknown asset'} mixes derived lineage with native generation attestation.`,
        'Record the derived action without native generation fields.',
        { asset: entry.key || null, file: entry.file || null },
        25
      );
    }
    const correctionErrors = validateCorrectionLineage(outputRoot, entry);
    if (correctionErrors.length) {
      addIssue(
        'error',
        'invalid-transparency-correction-lineage',
        `Transparency correction lineage is invalid for ${entry.key || entry.file || 'unknown asset'}: ${correctionErrors.join(' ')}`,
        'Restore the original correction report and all four hashed files, or record a new versioned correction without overwriting prior evidence.',
        { asset: entry.key || null, file: entry.file || null },
        25
      );
    }
  }
  for (const entry of history) {
    let historyFile;
    try {
      historyFile = path.resolve(outputRoot, entry.file || '');
      const relative = portableRelative(outputRoot, historyFile, 'Generation history source');
      if (!relative.startsWith('preview/')) throw new Error('Generation history source must remain inside preview/.');
    } catch {
      addIssue(
        'error',
        'missing-generation-history-source',
        `The recorded replacement history source path is unsafe for ${entry.key || entry.file || 'unknown asset'}.`,
        'Restore the superseded source inside preview/ and record the replacement chain again.',
        { asset: entry.key || null, file: entry.file || null },
        25
      );
      continue;
    }
    if (!fs.existsSync(historyFile) || !fs.statSync(historyFile).isFile()) {
      addIssue(
        'error',
        'missing-generation-history-source',
        `The superseded generation source is missing for ${entry.key || entry.file || 'unknown asset'}.`,
        'Restore the exact superseded source file so the replacement history remains independently auditable.',
        { asset: entry.key || null, file: entry.file || null },
        25
      );
      continue;
    }
    if (fileHash(historyFile) !== entry.sha256) {
      addIssue(
        'error',
        'stale-generation-history-attestation',
        `The superseded generation source changed after attestation for ${entry.key || entry.file || 'unknown asset'}.`,
        'Restore the exact superseded source file or record a new valid replacement chain without overwriting evidence.',
        { asset: entry.key || null, file: entry.file || null },
        25
      );
    }
  }
  for (const character of config.characters) {
    required.push({ kind: 'master', characterId: character.id, role: null, action: null });
    const requiredActions = actionContract.actionsByCharacter[character.id] || [];
    for (const action of requiredActions) required.push({ kind: 'action', characterId: character.id, role: null, action });
  }
  for (const expected of required) {
    const entry = data.assets.find((item) =>
      item.kind === expected.kind &&
      (item.characterId || null) === expected.characterId &&
      (item.role || null) === expected.role &&
      (item.action || null) === (expected.action || null)
    );
    const label = [expected.kind, expected.characterId, expected.role, expected.action].filter(Boolean).join(':');
    if (!entry) {
      addIssue('error', 'missing-image-generation-attestation', `Missing supported image-generation workflow record for ${label}.`, 'Generate the final artwork with Codex image generation and record it with record_image_generation.mjs.', { asset: label }, 20);
      continue;
    }
    const origin = data.schemaVersion === 2 ? 'generated' : (entry.origin || 'generated');
    if (expected.kind === 'action' && (!entry.masterFingerprint || (origin === 'generated' && !entry.promptVersion) || !Number.isInteger(entry.version))) {
      addIssue('error', 'missing-action-lineage', `${label} is missing master fingerprint or version lineage.`, 'Record the action again with its approved master fingerprint, prompt version, and generation version.', { asset: label }, 20);
    }
    if (expected.kind === 'master' && (!entry.promptVersion || !Number.isInteger(entry.version))) {
      addIssue('error', 'missing-master-lineage', `${label} is missing prompt or version lineage.`, 'Record the approved master again with its prompt version and generation version.', { asset: label }, 20);
    }
    if (expected.kind === 'action') {
      const master = data.assets.find((item) => item.kind === 'master' && item.characterId === expected.characterId);
      if (!master?.sha256 || entry.masterFingerprint !== master.sha256) {
        addIssue('error', 'master-fingerprint-mismatch', `${label} does not reference the current approved master.`, 'Regenerate or record the action with the exact approved master fingerprint.', { asset: label }, 25);
      }
    }
    if ((expected.kind === 'master' || expected.kind === 'action') && Number.isInteger(entry.version)) {
      const chain = [...history.filter((item) => item.key === entry.key), entry]
        .sort((left, right) => Number(left.version || 0) - Number(right.version || 0));
      let validChain = chain.length === entry.version;
      for (let index = 0; index < chain.length; index += 1) {
        const item = chain[index];
        if (item.version !== index + 1) validChain = false;
        if (index === 0) {
          if (item.supersedes || item.replacementReason) validChain = false;
        } else {
          const prior = chain[index - 1];
          if (item.supersedes !== prior.file || !String(item.replacementReason || '').trim()) validChain = false;
        }
      }
      if (!validChain) {
        addIssue('error', 'invalid-generation-replacement-chain', `${label} has an incomplete or non-monotonic replacement chain.`, 'Record replacements sequentially and preserve each superseded same-key record.', { asset: label, version: entry.version }, 25);
      }
    }
    let file;
    try {
      file = path.resolve(outputRoot, entry.file || '');
      const relative = portableRelative(outputRoot, file, 'Generation source');
      if (!relative.startsWith('preview/')) throw new Error('Generation source must remain inside preview/.');
    } catch {
      addIssue('error', 'missing-generation-source', `The recorded generation source path is unsafe for ${label}.`, 'Store the generated source inside preview and record it again.', { asset: label, file: entry.file || null }, 20);
      continue;
    }
    if (!fs.existsSync(file)) {
      addIssue('error', 'missing-generation-source', `The recorded generation source is missing for ${label}.`, 'Restore the recorded source inside preview and record it again.', { asset: label, file: entry.file }, 20);
      continue;
    }
    const currentHash = fileHash(file);
    if (currentHash !== entry.sha256) {
      addIssue('error', 'stale-generation-attestation', `The recorded source changed after its workflow attestation for ${label}.`, 'Record the current image-generation output again before processing and review.', { asset: label, file: entry.file }, 20);
    }
    if (expected.kind === 'action' && origin === 'derived') {
      const source = data.assets.find((item) => item.kind === 'action' && item.characterId === expected.characterId && item.action === entry.sourceAction);
      const sourceOrigin = source ? (data.schemaVersion === 2 ? 'generated' : (source.origin || 'generated')) : null;
      if (
        entry.transform !== 'horizontal-flip' ||
        horizontalFlipPairs.get(entry.sourceAction) !== entry.action ||
        !source ||
        sourceOrigin !== 'generated' ||
        source.file !== entry.sourceFile ||
        source.sha256 !== entry.sourceSha
      ) {
        addIssue('error', 'invalid-derived-lineage', `${label} has an invalid source action, character, transform, or derived chain.`, 'Record the derived action from a same-character generated left/right counterpart.', { asset: label }, 25);
        continue;
      }
      if (entry.derivedSha !== entry.sha256 || currentHash !== entry.derivedSha) {
        addIssue('error', 'stale-derived-action', `${label} changed after its derived lineage was recorded.`, 'Recreate the deterministic horizontal flip and record it again.', { asset: label, file: entry.file }, 25);
        continue;
      }
      let sourceFile;
      try {
        sourceFile = path.resolve(outputRoot, entry.sourceFile || '');
        const sourceRelative = portableRelative(outputRoot, sourceFile, 'Derived source');
        if (!sourceRelative.startsWith('preview/')) throw new Error('Derived source must remain inside preview/.');
      } catch {
        addIssue('error', 'invalid-derived-lineage', `${label} has an unsafe derived source path.`, 'Store and record the generated source inside preview/.', { asset: label }, 25);
        continue;
      }
      if (!fs.existsSync(sourceFile) || fileHash(sourceFile) !== entry.sourceSha) {
        addIssue('error', 'stale-derived-source', `${label} references a missing or changed generated source.`, 'Restore the attested generated source before recreating the flip.', { asset: label, sourceFile: entry.sourceFile }, 25);
        continue;
      }
      try {
        const [sourceRaw, derivedRaw] = await Promise.all([
          sharp(sourceFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
          sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        ]);
        let matches = sourceRaw.info.width === derivedRaw.info.width && sourceRaw.info.height === derivedRaw.info.height && sourceRaw.info.channels === 4 && derivedRaw.info.channels === 4;
        const width = sourceRaw.info.width;
        const height = sourceRaw.info.height;
        for (let y = 0; y < height && matches; y += 1) {
          for (let x = 0; x < width && matches; x += 1) {
            const sourceOffset = (y * width + (width - 1 - x)) * 4;
            const derivedOffset = (y * width + x) * 4;
            for (let channel = 0; channel < 4; channel += 1) {
              if (sourceRaw.data[sourceOffset + channel] !== derivedRaw.data[derivedOffset + channel]) {
                matches = false;
                break;
              }
            }
          }
        }
        if (!matches) addIssue('error', 'derived-pixel-mismatch', `${label} is not the deterministic horizontal flip of its source.`, 'Recreate the flip without edits, scaling, recompression, or color changes.', { asset: label }, 25);
      } catch (error) {
        addIssue('error', 'derived-pixel-mismatch', `${label} could not be decoded and compared with its source.`, 'Restore valid PNG files and recreate the deterministic flip.', { asset: label, detail: error.message }, 25);
      }
    }
  }
  for (const provenanceIssue of validatePreviewProvenance({ outputRoot, preview, manifest: data })) {
    addIssue(
      provenanceIssue.severity,
      provenanceIssue.code,
      provenanceIssue.message,
      'Restore the exact fictional source/board inside preview and record a relative SHA-bound lineage sidecar.',
      provenanceIssue,
      25
    );
  }
  return data;
}

const humorWeights = {
  roleClarity: 25,
  absurdity: 20,
  timingEscalation: 20,
  formationReadability: 15,
  poopReadability: 10,
  surpriseRewatch: 10
};

const humorContract = {
  schemaVersion: 1,
  reviewSchemaVersion: 3,
  threshold: 90,
  weights: humorWeights,
  requiredEntryFields: ['prankId', 'evidenceRefs', ...Object.keys(humorWeights), 'total', 'deductions', 'optimizations', 'reevaluationNotes', 'status'],
  requiredTextFields: ['deductions', 'optimizations', 'reevaluationNotes'],
  meaningfulTextMinimum: 4,
  evidence: {
    source: 'release-eligible-desktop-compositor-capture',
    requireImage: true,
    captureKind: 'desktop-compositor',
    releaseEligible: true
  }
};

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const humorContractFingerprint = crypto.createHash('sha256').update(stableSerialize(humorContract)).digest('hex');

function expectedHumorPrankIds() {
  const ids = [];
  const groupShoutSkipped = config.selection?.groupShoutSkippedReason === 'no-eligible-participants';
  const chaseSkipped = config.selection?.chaseSkippedReason === 'no-eligible-followers';
  if (!groupShoutSkipped && (behaviors.groupShout?.enabled || ['group-shout', 'all'].includes(config.selection?.mode))) ids.push('dad-shout', 'grandpa-shout');
  if (!chaseSkipped && (behaviors.poopChase?.enabled || config.selection?.chaseVariant === 'self-poop')) ids.push('poop-chase');
  if (!chaseSkipped && (behaviors.centipede?.enabled || config.selection?.chaseVariant === 'cursor-centipede')) ids.push('cursor-centipede');
  return [...new Set(ids)];
}

function prankScenarioDirectory(prankId) {
  return prankId === 'cursor-centipede' ? 'centipede' : prankId;
}

function prankEvidencePrefix(prankId) {
  return `preview/scenarios/${prankScenarioDirectory(prankId)}/`;
}

function defaultPrankEvidenceRefs(prankId, scenarioEvidencePaths) {
  const prefix = prankEvidencePrefix(prankId);
  return scenarioEvidencePaths.filter((reference) => {
    if (!reference.startsWith(prefix) || !reference.toLowerCase().endsWith('.png')) return false;
    return !reference.slice(prefix.length).includes('/');
  });
}

function meaningfulReviewText(value) {
  if (typeof value !== 'string') return false;
  const visible = value.normalize('NFKC').replace(/[\s\p{Cf}\p{Cc}]+/gu, '');
  return visible.length >= humorContract.meaningfulTextMinimum && /[\p{L}\p{N}]/u.test(visible);
}

function meaningfulReviewList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(meaningfulReviewText);
}

function expectedHumorReview(scenarioEvidencePaths) {
  const prankIds = expectedHumorPrankIds();
  const required = prankIds.length > 0;
  return {
    required,
    contractFingerprint: humorContractFingerprint,
    reviews: prankIds.map((prankId) => ({
      prankId,
      evidenceRefs: defaultPrankEvidenceRefs(prankId, scenarioEvidencePaths),
      ...Object.fromEntries(Object.keys(humorWeights).map((key) => [key, null])),
      total: null,
      deductions: [],
      optimizations: [],
      reevaluationNotes: '',
      status: 'pending'
    })),
    status: required ? 'pending' : 'not-applicable'
  };
}

function expectedReview(characterFingerprints, runtimeFingerprint, scenarioEvidencePaths) {
  return {
    schemaVersion: humorContract.reviewSchemaVersion,
    reviewedAt: null,
    reviewedAssets: {
      identityBoard: 'identity-board.png',
      actionContactSheet: 'action-contact-sheet.png',
      runtimeWindow: runtimePath ? path.basename(runtimePath) : null
    },
    characters: config.characters.map((character) => ({
      id: character.id,
      displayName: character.displayName,
      artifactFingerprint: characterFingerprints[character.id],
      identityConsistency: 'pending',
      clothingSeparation: 'pending',
      actionReadability: 'pending',
      bodyCompleteness: 'pending',
      edgeQuality: 'pending',
      roleActionReadability: requiredCharacterChecks(character.id).includes('roleActionReadability') ? 'pending' : 'not-applicable',
      notes: ''
    })),
    runtime: {
      required: Boolean(runtimePath),
      artifactFingerprint: runtimeFingerprint,
      visible: runtimePath ? 'pending' : 'not-applicable',
      framing: runtimePath ? 'pending' : 'not-applicable',
      transparency: runtimePath ? 'pending' : 'not-applicable',
      humor: expectedHumorReview(scenarioEvidencePaths),
      notes: ''
    },
    overallNotes: ''
  };
}

function reviewStatus(review, characterFingerprints, runtimeFingerprint, scenarioEvidencePaths) {
  const expectedPrankIds = expectedHumorPrankIds();
  const result = {
    provided: Boolean(review),
    complete: true,
    failed: false,
    pending: [],
    humor: {
      required: expectedPrankIds.length > 0,
      contractFingerprint: humorContractFingerprint,
      reviews: [],
      status: expectedPrankIds.length > 0 ? 'pending' : 'not-applicable'
    }
  };
  if (!review) {
    return {
      ...result,
      complete: false,
      pending: config.characters.flatMap((character) => requiredCharacterChecks(character.id).map((check) => `${character.id}:${check}`))
    };
  }
  if (review.schemaVersion !== humorContract.reviewSchemaVersion) {
    addIssue('error', 'review-schema', `Manual review must use schemaVersion ${humorContract.reviewSchemaVersion}.`, 'Regenerate self-check-review.json and review the current assets, including the humor gate.', {}, 20);
    result.failed = true;
  }
  for (const character of config.characters) {
    const entry = Array.isArray(review.characters)
      ? review.characters.find((item) => item.id === character.id)
      : null;
    if (!entry) {
      result.complete = false;
      result.pending.push(`${character.id}:all`);
      continue;
    }
    if (entry.artifactFingerprint !== characterFingerprints[character.id]) {
      result.complete = false;
      result.pending.push(`${character.id}:stale-artifact-fingerprint`);
      continue;
    }
    for (const check of requiredCharacterChecks(character.id)) {
      if (entry[check] === 'fail') {
        result.failed = true;
        addIssue(
          'error',
          `manual-${check}`,
          `${character.id} failed manual review: ${check}.`,
          `Regenerate only ${character.id}'s action sheet, reprocess it, and repeat the review.`,
          { characterId: character.id, note: entry.notes || '' },
          15
        );
      } else if (entry[check] !== 'pass') {
        result.complete = false;
        result.pending.push(`${character.id}:${check}`);
      }
    }
  }
  if (runtimePath) {
    if (review.runtime?.artifactFingerprint !== runtimeFingerprint) {
      result.complete = false;
      result.pending.push('runtime:stale-artifact-fingerprint');
      return result;
    }
    for (const check of ['visible', 'framing', 'transparency']) {
      const value = review.runtime?.[check];
      if (value === 'fail') {
        result.failed = true;
        addIssue(
          'error',
          `manual-runtime-${check}`,
          `Runtime screenshot failed manual review: ${check}.`,
          'Fix the runtime rendering or sprite framing, capture a new runtime screenshot, and repeat the review.',
          { note: review.runtime?.notes || '' },
          18
        );
      } else if (value !== 'pass') {
        result.complete = false;
        result.pending.push(`runtime:${check}`);
      }
    }
  }
  if (result.humor.required) {
    let humorFailed = false;
    let humorComplete = true;
    if (!runtimePath) {
      result.complete = false;
      result.pending.push('runtime:humor-evidence');
      return result;
    }
    const humor = review.runtime?.humor;
    const reviews = Array.isArray(humor?.reviews) ? humor.reviews : [];
    result.humor = humor && typeof humor === 'object'
      ? { ...humor, required: true, reviews }
      : { required: true, contractFingerprint: null, reviews: [], status: 'pending' };
    if (humor?.contractFingerprint !== humorContractFingerprint) {
      result.failed = true;
      humorFailed = true;
      addIssue(
        'error',
        'manual-humor-contract-stale',
        'The manual humor review uses a stale scoring contract.',
        'Regenerate self-check-review.json and repeat every enabled prank review under the current weights, threshold, evidence, and required fields.',
        { expectedContractFingerprint: humorContractFingerprint, reportedContractFingerprint: humor?.contractFingerprint || null },
        20
      );
    }
    const actualPrankIds = reviews.map((entry) => entry?.prankId);
    const exactPrankSet = reviews.length === expectedPrankIds.length
      && new Set(actualPrankIds).size === actualPrankIds.length
      && expectedPrankIds.every((prankId) => actualPrankIds.includes(prankId));
    if (!exactPrankSet) {
      result.failed = true;
      humorFailed = true;
      addIssue(
        'error',
        'manual-humor-invalid',
        'The manual humor review does not contain exactly one entry for every enabled special prank.',
        'Regenerate the review and score dad shout, grandpa shout, and the active poop-chase variant separately.',
        { expectedPrankIds, actualPrankIds },
        20
      );
    }
    const scenarioEvidenceSet = new Set(scenarioEvidencePaths);
    for (const prankId of expectedPrankIds) {
      const entry = reviews.find((candidate) => candidate?.prankId === prankId);
      if (!entry) {
        result.complete = false;
        humorComplete = false;
        result.pending.push(`runtime:humor:${prankId}:all`);
        continue;
      }
      const missingScores = Object.keys(humorWeights).filter((key) => !Number.isFinite(entry[key]));
      if (missingScores.length) {
        result.complete = false;
        humorComplete = false;
        result.pending.push(...missingScores.map((key) => `runtime:humor:${prankId}:${key}`));
        continue;
      }
      const invalidScores = Object.entries(humorWeights).filter(([key, max]) => (
        !Number.isInteger(entry[key]) || entry[key] < 0 || entry[key] > max
      ));
      const calculatedTotal = Object.keys(humorWeights).reduce((sum, key) => sum + entry[key], 0);
      const evidenceRefs = Array.isArray(entry.evidenceRefs) ? entry.evidenceRefs : [];
      const evidencePrefix = prankEvidencePrefix(prankId);
      const evidenceValid = evidenceRefs.length > 0
        && new Set(evidenceRefs).size === evidenceRefs.length
        && evidenceRefs.every((reference) => typeof reference === 'string'
          && reference.startsWith(evidencePrefix)
          && scenarioEvidenceSet.has(reference))
        && evidenceRefs.some((reference) => reference.toLowerCase().endsWith('.png'));
      const deductionsValid = meaningfulReviewList(entry.deductions);
      const optimizationsValid = meaningfulReviewList(entry.optimizations);
      const reevaluationValid = meaningfulReviewText(entry.reevaluationNotes);
      if (invalidScores.length || !Number.isInteger(entry.total) || entry.total !== calculatedTotal || !evidenceValid || !deductionsValid || !optimizationsValid || !reevaluationValid) {
        result.failed = true;
        humorFailed = true;
        addIssue(
          'error',
          'manual-humor-invalid',
          `The ${prankId} humor review is incomplete, stale, or internally inconsistent.`,
          'Use current scenario image evidence, score all six weighted dimensions, make total equal their sum, and write meaningful deductions, optimizations, and reevaluation notes.',
          {
            prankId,
            calculatedTotal,
            reportedTotal: entry.total,
            invalidDimensions: invalidScores.map(([key]) => key),
            evidenceRefs,
            evidenceValid,
            deductionsValid,
            optimizationsValid,
            reevaluationValid
          },
          20
        );
      } else if (entry.total < humorContract.threshold || entry.status === 'fail') {
        result.failed = true;
        humorFailed = true;
        addIssue(
          'error',
          'manual-humor-below-threshold',
          `${prankId} humor review failed (${entry.total}/100; required: ${humorContract.threshold}).`,
          'Apply the recorded optimizations, capture this prank again, and repeat its six-dimension humor review.',
          { prankId, total: entry.total, deductions: entry.deductions, optimizations: entry.optimizations, reevaluationNotes: entry.reevaluationNotes },
          20
        );
      } else if (entry.status !== 'pass') {
        result.complete = false;
        humorComplete = false;
        result.pending.push(`runtime:humor:${prankId}:status`);
      }
    }
    result.humor.status = humorFailed
      ? 'fail'
      : humorComplete && expectedPrankIds.every((prankId) => reviews.find((entry) => entry?.prankId === prankId)?.status === 'pass')
        ? 'pass'
        : 'pending';
  }
  return result;
}

function frameSimilarity(first, second) {
  if (!first || !second || first.length !== second.length) return 0;
  let difference = 0;
  for (let offset = 0; offset < first.length; offset += 4) {
    const alphaA = first[offset + 3] / 255;
    const alphaB = second[offset + 3] / 255;
    difference += Math.abs(first[offset] * alphaA - second[offset] * alphaB);
    difference += Math.abs(first[offset + 1] * alphaA - second[offset + 1] * alphaB);
    difference += Math.abs(first[offset + 2] * alphaA - second[offset + 2] * alphaB);
    difference += Math.abs(first[offset + 3] - second[offset + 3]);
  }
  return Math.max(0, 1 - difference / (first.length * 255));
}

function actionFromRelative(relative) {
  return path.basename(relative, path.extname(relative));
}

function processingKey(characterId, action) {
  const reports = ['processing-report.json', 'role-processing-report.json'];
  for (const report of reports) {
    const processingReport = path.join(spriteRoot, characterId, report);
    if (!fs.existsSync(processingReport)) continue;
    const data = readJson(processingReport);
    const cell = data.cells?.find((item) => item.action === action);
    if (/^#[0-9a-f]{6}$/i.test(cell?.key || '')) {
      return [1, 3, 5].map((offset) => Number.parseInt(cell.key.slice(offset, offset + 2), 16));
    }
  }
  return null;
}

const uniqueFrames = new Map();
const generationManifest = await validateGenerationManifest();
const identityQuality = validateIdentityQuality();
const actionDrift = compareActionContract(actionContract, manifest);
for (const id of actionDrift.duplicateCharacterIds) addIssue('error', 'duplicate-character', `Duplicate manifest character: ${id}.`, 'Regenerate the sprite manifest from the canonical project character list.', { characterId: id }, 25);
for (const id of actionDrift.unexpectedCharacterIds) addIssue('error', 'unexpected-character', `Unexpected manifest character: ${id}.`, 'Remove characters that are not in pet.config.json.', { characterId: id }, 25);
for (const { characterId, action } of actionDrift.missingActions) addIssue('error', 'missing-canonical-action', `${characterId} is missing canonical action ${action}.`, 'Generate and process the action required by the selected mode and role.', { characterId, action }, 20);
for (const { characterId, action } of actionDrift.unexpectedActions) addIssue('error', 'unexpected-role-action', `${characterId} has unexpected role action ${action}.`, 'Remove role actions that do not belong to this character in the selected mode.', { characterId, action }, 20);
for (const [artifact, label] of [[identityBoardPath, 'identity board'], [contactSheetPath, 'action contact sheet']]) {
  if (!fs.existsSync(artifact)) {
    addIssue('error', 'missing-review-artifact', `Missing ${label}: ${artifact}`, `Create ${path.basename(artifact)} before visual self-review.`, { artifact }, 20);
  }
}
for (const character of config.characters) {
  const entry = manifest.characters.find((item) => item.id === character.id);
  if (!entry) {
    addIssue('error', 'missing-character', `Manifest is missing ${character.id}.`, `Reprocess ${character.id}'s action sheet.`, { characterId: character.id }, 25);
    continue;
  }
  const expectedFrameCounts = {};
  for (const action of actionContract.actionsByCharacter[character.id] || []) {
    const descriptor = actionFrameDescriptor(action, character.id);
    expectedFrameCounts[descriptor.group] = Math.max(expectedFrameCounts[descriptor.group] || 0, descriptor.index + 1);
  }
  for (const [group, expectedCount] of Object.entries(expectedFrameCounts)) {
    const actualCount = entry.frames?.[group]?.length || 0;
    if (actualCount < expectedCount) {
      addIssue(
        'error',
        'insufficient-animation-frames',
        `${character.id} ${group} has ${actualCount} frame(s); expected at least ${expectedCount}.`,
        `Process a complete 4x3 action sheet for ${character.id}.`,
        { characterId: character.id, group, actualCount, expectedCount },
        16
      );
    }
  }
  const expectsShout = actionContract.rolesByCharacter[character.id]?.groupShoutParticipant;
  const expectedShoutFrames = expectsShout ? [1, 2, 3].map((frame) => `${character.id}/shout_${frame}.png`) : [];
  if (expectsShout && JSON.stringify(entry.frames?.shout || []) !== JSON.stringify(expectedShoutFrames)) {
    addIssue(
      'error',
      'invalid-kneel-shout-runtime-mapping',
      `${character.id} shout frames do not map exactly to shout_1.png, shout_2.png, and shout_3.png in order.`,
      `Process kneel_shout_1, kneel_shout_2, and kneel_shout_3 again for ${character.id}.`,
      { characterId: character.id, actual: entry.frames?.shout || [], expected: expectedShoutFrames },
      20
    );
  }
  const chaseRole = actionContract.rolesByCharacter[character.id]?.chaseRole;
  const roleGroups = chaseRole === 'poop'
    ? ['poop_right', 'poop_left']
    : chaseRole === 'eat'
      ? ['eat_right', 'eat_left']
      : chaseRole === 'centipede'
        ? ['centipede_right', 'centipede_left']
        : [];
  for (const group of roleGroups) {
    const actualCount = entry.frames?.[group]?.length || 0;
    if (actualCount < 1) {
      addIssue(
        'error',
        'missing-poop-chase-action',
        `${character.id} is missing required poop-chase action ${group}.`,
        `Generate and process a 2x1 ${character.id} role action sheet before review.`,
        { characterId: character.id, group },
        20
      );
    }
  }
  for (const [group, relatives] of Object.entries(entry.frames || {})) {
    for (const relative of relatives || []) {
      const usages = uniqueFrames.get(relative) || [];
      usages.push({ characterId: character.id, group });
      uniqueFrames.set(relative, usages);
      characterFiles.get(character.id)?.push(path.join(spriteRoot, relative));
    }
  }
  if (chaseRole === 'centipede') for (const direction of ['right', 'left']) {
    const anchors = entry.anchors?.[direction];
    const head = anchors?.head;
    const mouth = anchors?.mouth;
    const rear = anchors?.rear;
    if (!head || !mouth || !rear) {
      addIssue(
        'error',
        'missing-centipede-anchors',
        `${character.id} ${direction} is missing explicit head, mouth, or rear anchors.`,
        `Reprocess ${character.id}'s centipede_${direction} sprite with explicit mouth and rear anchors.`,
        { characterId: character.id, direction },
        18
      );
      continue;
    }
    const correctOrder = direction === 'right' ? mouth[0] > rear[0] : mouth[0] < rear[0];
    if (!correctOrder) {
      addIssue(
        'error',
        'anchor-direction',
        `${character.id} ${direction} anchors point in the wrong direction.`,
        `Correct ${character.id}'s ${direction} head/rear anchors before building.`,
        { characterId: character.id, direction },
        18
      );
    }
  }
}

for (const [relative, usages] of uniqueFrames) {
  const characterIds = [...new Set(usages.map((usage) => usage.characterId))];
  if (path.basename(relative).toLowerCase().includes('placeholder') || path.extname(relative).toLowerCase() !== '.png') {
    addIssue(
      'error',
      'placeholder-frame',
      `${relative} is a placeholder or non-generated sprite.`,
      `Process the complete action sheet for ${characterIds.join(', ')} before review.`,
      { frame: relative, characterIds },
      25
    );
  }
  if (characterIds.length > 1) {
    addIssue(
      'error',
      'shared-character-frame',
      `${relative} is shared by multiple characters: ${characterIds.join(', ')}.`,
      'Process a separate approved action sheet for every character.',
      { frame: relative, characterIds },
      25
    );
  }
  for (const characterId of characterIds) {
    const groups = [...new Set(usages.filter((usage) => usage.characterId === characterId).map((usage) => usage.group))];
    if (groups.length > 1) {
      addIssue(
        'error',
        'reused-action-frame',
        `${characterId} reuses ${relative} across action groups: ${groups.join(', ')}.`,
        `Process ${characterId}'s full action sheet so each requested action has its own frame.`,
        { characterId, frame: relative, groups },
        20
      );
    }
  }
}

const existingSpriteFiles = [...new Set([...characterFiles.values()].flat())].filter((file) => fs.existsSync(file));
const newestSpriteTime = existingSpriteFiles.length
  ? Math.max(...existingSpriteFiles.map((file) => fs.statSync(file).mtimeMs))
  : 0;
if (fs.existsSync(contactSheetPath) && fs.statSync(contactSheetPath).mtimeMs < newestSpriteTime) {
  addIssue(
    'error',
    'stale-contact-sheet',
    'The action contact sheet is older than the current sprite frames.',
    'Rebuild action-contact-sheet.png, inspect it, and update the affected character review.',
    { artifact: contactSheetPath },
    18
  );
}

for (const [relative, usages] of uniqueFrames) {
  const file = path.join(spriteRoot, relative);
  const primary = usages[0];
  if (!fs.existsSync(file)) {
    addIssue('error', 'missing-frame', `Missing sprite frame: ${relative}.`, `Reprocess ${primary.characterId}'s action sheet.`, { ...primary, frame: relative }, 25);
    continue;
  }
  try {
    const metadata = await sharp(file).metadata();
    const raw = await sharp(file)
      .ensureAlpha()
      .resize(config.render.spriteSize, config.render.spriteSize, { fit: 'contain' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bounds = alphaBounds(raw.data, raw.info.width, raw.info.height);
    if (!bounds) {
      addIssue('error', 'empty-frame', `${relative} has no visible pixels.`, `Regenerate and reprocess ${primary.characterId}'s sheet.`, { ...primary, frame: relative }, 25);
      continue;
    }

    const width = raw.info.width;
    const height = raw.info.height;
    const centerX = (bounds.left + bounds.width / 2) / width;
    const centerY = (bounds.top + bounds.height / 2) / height;
    const maxExtent = Math.max(bounds.width / width, bounds.height / height);
    let edgePixels = 0;
    let semiTransparent = 0;
    let visiblePixels = 0;
    let keyLikePixels = 0;
    let opaqueBoundaryKeyLikePixels = 0;
    const action = actionFromRelative(relative);
    const key = processingKey(primary.characterId, action);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const alpha = raw.data[offset + 3];
        if (alpha <= 12) continue;
        visiblePixels += 1;
        if (alpha < 243) semiTransparent += 1;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edgePixels += 1;
        if (key) {
          const distance = Math.hypot(raw.data[offset] - key[0], raw.data[offset + 1] - key[1], raw.data[offset + 2] - key[2]);
          if (distance < 48) {
            keyLikePixels += 1;
            if (alpha >= 192) {
              let touchesTransparency = false;
              for (let dy = -1; dy <= 1 && !touchesTransparency; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                  if (dx === 0 && dy === 0) continue;
                  const neighborX = x + dx;
                  const neighborY = y + dy;
                  if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) continue;
                  if (raw.data[(neighborY * width + neighborX) * 4 + 3] <= 12) {
                    touchesTransparency = true;
                    break;
                  }
                }
              }
              if (touchesTransparency) opaqueBoundaryKeyLikePixels += 1;
            }
          }
        }
      }
    }

    const metric = {
      characterId: primary.characterId,
      groups: usages.map((usage) => usage.group),
      frame: relative,
      sourceDimensions: [metadata.width || null, metadata.height || null],
      coverage: round(bounds.coverage),
      bounds: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        centerX: round(centerX),
        centerY: round(centerY),
        maxExtent: round(maxExtent)
      },
      semiTransparentRatio: round(semiTransparent / Math.max(1, visiblePixels)),
      edgePixels,
      keySpillRatio: round(keyLikePixels / Math.max(1, visiblePixels)),
      opaqueBoundaryKeySpillRatio: round(opaqueBoundaryKeyLikePixels / Math.max(1, visiblePixels))
    };
    frameMetrics.push(metric);
    frameBuffers.set(relative, raw.data);

    if (metadata.width !== config.render.spriteSize || metadata.height !== config.render.spriteSize) {
      addIssue('warning', 'frame-dimensions', `${relative} is ${metadata.width}x${metadata.height}; expected ${config.render.spriteSize}x${config.render.spriteSize}.`, `Reprocess ${primary.characterId}'s action sheet at the configured sprite size.`, { ...primary, frame: relative }, 6);
    }
    if (edgePixels > 0) {
      addIssue('error', 'opaque-edge', `${relative} touches the canvas edge (${edgePixels} visible edge pixels).`, `Regenerate or recrop ${primary.characterId}'s sheet with more padding.`, { ...primary, frame: relative }, 12);
    }
    if (maxExtent < 0.55) {
      addIssue('warning', 'subject-too-small', `${relative} uses only ${(maxExtent * 100).toFixed(1)}% of the sprite extent.`, `Regenerate ${primary.characterId}'s sheet at a larger, consistent character scale.`, { ...primary, frame: relative }, 5);
    }
    if (Math.hypot(centerX - 0.5, centerY - 0.5) > 0.19) {
      addIssue('warning', 'subject-off-center', `${relative} is strongly off-center.`, `Regenerate or recrop ${primary.characterId}'s sheet with consistent centering.`, { ...primary, frame: relative }, 4);
    }
    const keySpillRatio = keyLikePixels / Math.max(1, visiblePixels);
    const opaqueBoundaryKeySpillRatio = opaqueBoundaryKeyLikePixels / Math.max(1, visiblePixels);
    if (opaqueBoundaryKeyLikePixels >= 8 && opaqueBoundaryKeySpillRatio > 0.01) {
      addIssue('error', 'chroma-spill', `${relative} has a clearly visible opaque key-colour fringe along its transparent boundary (${(opaqueBoundaryKeySpillRatio * 100).toFixed(1)}%).`, `Regenerate or repair ${primary.characterId}'s sheet until the opaque key-colour fringe is removed.`, { ...primary, frame: relative, opaqueBoundaryKeyLikePixels }, 18);
    } else if (keySpillRatio > 0.025) {
      addIssue('warning', 'chroma-spill', `${relative} retains ${(keySpillRatio * 100).toFixed(1)}% key-like visible pixels.`, `Regenerate ${primary.characterId}'s sheet with cleaner flat-key separation or adjust key removal.`, { ...primary, frame: relative }, 6);
    }
  } catch (error) {
    addIssue('error', 'unreadable-frame', `Could not inspect ${relative}: ${error.message}`, `Reprocess ${primary.characterId}'s action sheet.`, { ...primary, frame: relative }, 25);
  }
}

for (const character of config.characters) {
  if (actionContract.rolesByCharacter[character.id]?.chaseRole !== 'centipede') continue;
  const entry = manifest.characters.find((item) => item.id === character.id);
  if (!entry) continue;
  for (const direction of ['right', 'left']) {
    const relative = entry.frames?.[`centipede_${direction}`]?.[0];
    const pixels = relative ? frameBuffers.get(relative) : null;
    if (!pixels) continue;
    const anchors = entry.anchors?.[direction];
    if (!anchors?.head || !anchors?.mouth || !anchors?.rear) continue;
    const maximumDistance = Math.max(4, config.render.spriteSize * 0.1);
    for (const label of ['head', 'mouth', 'rear']) {
      let distance = Number.POSITIVE_INFINITY;
      try {
        distance = nearestVisibleAlphaDistance(pixels, config.render.spriteSize, config.render.spriteSize, anchors[label]);
      } catch {}
      if (!Number.isFinite(distance) || distance > maximumDistance) {
        addIssue(
          'error',
          'detached-centipede-anchor',
          `${character.id} ${direction} ${label} anchor is detached from visible alpha.`,
          `Reprocess ${character.id}'s centipede_${direction} sprite with ${label} placed on the visible subject.`,
          { characterId: character.id, direction, anchor: label, distance: round(distance) },
          18
        );
      }
    }
  }
}

for (const character of config.characters) {
  const entry = manifest.characters.find((item) => item.id === character.id);
  if (!entry) continue;
  for (const group of ['crawl_right', 'crawl_left', 'shout']) {
    const frames = entry.frames?.[group] || [];
    if (frames.length < 2) continue;
    const metrics = frames.map((relative) => frameMetrics.find((item) => item.frame === relative)).filter(Boolean);
    const heights = metrics.map((item) => item.bounds.height);
    const centersX = metrics.map((item) => item.bounds.centerX);
    const centersY = metrics.map((item) => item.bounds.centerY);
    if (heights.length >= 2 && Math.max(...heights) / Math.max(1, Math.min(...heights)) > 1.32) {
      addIssue('warning', 'animation-scale-drift', `${character.id} ${group} changes scale too much between frames.`, `Regenerate only ${character.id}'s sheet with one fixed character scale.`, { characterId: character.id, group }, 6);
    }
    if (centersX.length >= 2 && (Math.max(...centersX) - Math.min(...centersX) > 0.16 || Math.max(...centersY) - Math.min(...centersY) > 0.16)) {
      addIssue('warning', 'animation-position-drift', `${character.id} ${group} jumps position between frames.`, `Regenerate only ${character.id}'s sheet with consistent cell centering.`, { characterId: character.id, group }, 6);
    }
    for (let index = 1; index < frames.length; index += 1) {
      const similarity = frameSimilarity(frameBuffers.get(frames[index - 1]), frameBuffers.get(frames[index]));
      if (similarity > 0.992) {
        addIssue('warning', 'duplicate-animation', `${character.id} ${group} frames ${index} and ${index + 1} are nearly identical (${(similarity * 100).toFixed(1)}%).`, `Regenerate only ${character.id}'s sheet with a readable motion change for ${group}.`, { characterId: character.id, group, similarity: round(similarity) }, 7);
      }
    }
  }
}

if (config.characters.length > 1) {
  const characterExtents = config.characters.map((character) => {
    const values = frameMetrics
      .filter((item) => item.characterId === character.id && !item.groups.some((group) => group.startsWith('centipede')))
      .map((item) => item.bounds.maxExtent);
    return { characterId: character.id, extent: median(values) };
  }).filter((item) => item.extent > 0);
  const groupMedian = median(characterExtents.map((item) => item.extent));
  for (const item of characterExtents) {
    if (item.extent < groupMedian * 0.78 || item.extent > groupMedian * 1.28) {
      addIssue('warning', 'character-scale-mismatch', `${item.characterId} has a noticeably different readable scale from the group.`, `Regenerate only ${item.characterId}'s sheet at the group's median scale.`, { characterId: item.characterId }, 6);
    }
  }
}

let runtimeMetrics = null;
let runtimeEvidence = null;
const runtimeEvidenceCandidates = [runtimePath, runtimeSecondPath, runtimePausedPath, runtimeTechnicalPath, runtimeEvidenceManifestPath].filter(Boolean);
const hasAnyRuntimeEvidence = runtimeEvidenceCandidates.some((file) => fs.existsSync(file));
if (hasAnyRuntimeEvidence) {
  if (!fs.existsSync(runtimeEvidenceManifestPath)) {
    addIssue('error', 'runtime-product-evidence-missing', 'Runtime evidence manifest is missing, so technical smoke cannot prove the normal desktop experience.', 'Refresh runtime evidence to create two live desktop frames, technical smoke, and the manifest.', {}, 25);
  } else {
    try {
      runtimeEvidence = readJson(runtimeEvidenceManifestPath);
      const expectedKinds = new Map([
        ['normal-live-1', runtimePath || path.join(preview, 'runtime-window.png')],
        ['normal-live-2', runtimeSecondPath],
        ['normal-paused', runtimePausedPath],
        ['technical-window-count', runtimeTechnicalPath]
      ]);
      const entries = Array.isArray(runtimeEvidence.evidence) ? runtimeEvidence.evidence : [];
      const byKind = new Map(entries.map((entry) => [entry?.kind, entry]));
      const expectedIds = config.characters.map((character) => character.id);
      if (JSON.stringify(runtimeEvidence.expectedCharacterIds || []) !== JSON.stringify(expectedIds)) {
        addIssue('error', 'runtime-evidence-character-mismatch', 'Runtime evidence does not cover the current configured character order.', 'Refresh runtime evidence from the current project.', {}, 20);
      }
      const display = runtimeEvidence.display;
      if (!display || ![display.width, display.height, display.scaleFactor].every(Number.isFinite) || display.width <= 0 || display.height <= 0 || display.scaleFactor <= 0) {
        addIssue('error', 'runtime-evidence-display-invalid', 'Runtime evidence does not declare a valid captured display.', 'Refresh runtime evidence on a supported desktop.', {}, 20);
      }
      const captureArea = runtimeEvidence.captureArea;
      const captureAreaValid = captureArea && [captureArea.x, captureArea.y, captureArea.width, captureArea.height].every(Number.isFinite)
        && captureArea.x >= 0 && captureArea.y >= 0 && captureArea.width > 0 && captureArea.height > 0
        && display && captureArea.x + captureArea.width <= display.width && captureArea.y + captureArea.height <= display.height;
      if (!captureAreaValid) {
        addIssue('error', 'runtime-product-evidence-area-invalid', 'Runtime product evidence does not declare a safe compositor crop inside the captured display.', 'Refresh runtime evidence from the controlled validation surface.', {}, 20);
      }
      const surface = runtimeEvidence.surface;
      if (!surface || surface.kind !== 'controlled-validation' || surface.containsUserDesktopContent !== false) {
        addIssue('error', 'runtime-product-evidence-surface-invalid', 'Runtime product evidence does not attest the controlled private validation surface.', 'Refresh runtime evidence without exposing the user desktop or other applications.', {}, 25);
      }
      for (const [kind, expectedFile] of expectedKinds) {
        const entry = byKind.get(kind);
        if (!entry) {
          addIssue('error', 'runtime-product-evidence-missing', `Runtime evidence is missing ${kind}.`, 'Refresh the complete runtime evidence set.', { kind }, 25);
          continue;
        }
        if (kind === 'normal-paused' && entry.paused !== true) {
          addIssue('error', 'runtime-paused-state-invalid', 'The paused runtime composition is not explicitly recorded as paused.', 'Refresh runtime evidence while the behavior engine is paused.', { kind }, 25);
        }
        if (typeof entry.file !== 'string' || path.isAbsolute(entry.file) || entry.file.includes('..')) {
          addIssue('error', 'runtime-evidence-path-invalid', `Runtime evidence ${kind} uses an unsafe file path.`, 'Refresh runtime evidence with relative preview paths only.', { kind }, 20);
          continue;
        }
        const resolved = path.resolve(path.dirname(runtimeEvidenceManifestPath), entry.file);
        if (resolved !== path.resolve(expectedFile)) {
          addIssue('error', 'runtime-evidence-file-mismatch', `Runtime evidence ${kind} points to the wrong file.`, 'Refresh runtime evidence without renaming or substituting captures.', { kind }, 20);
          continue;
        }
        if (!fs.existsSync(resolved)) {
          addIssue('error', 'runtime-product-evidence-missing', `Runtime evidence file is missing for ${kind}.`, 'Refresh the complete runtime evidence set.', { kind }, 25);
          continue;
        }
        if (fileHash(resolved) !== entry.sha256) {
          addIssue('error', 'runtime-evidence-hash-mismatch', `Runtime evidence file changed after capture: ${kind}.`, 'Refresh runtime evidence and repeat manual review.', { kind }, 25);
        }
        if (fs.statSync(resolved).mtimeMs < newestSpriteTime) {
          addIssue('error', 'stale-runtime', `Runtime evidence ${kind} is older than the current sprite frames.`, 'Refresh all runtime evidence from the current project.', { kind }, 18);
        }
        const metadata = await sharp(resolved).metadata();
        if (metadata.width !== entry.width || metadata.height !== entry.height) {
          addIssue('error', 'runtime-evidence-dimension-mismatch', `Runtime evidence dimensions changed after capture: ${kind}.`, 'Refresh runtime evidence from the current project.', { kind }, 18);
        }
        if (kind.startsWith('normal-') && captureAreaValid && display) {
          const expectedWidth = Math.round(captureArea.width * display.scaleFactor);
          const expectedHeight = Math.round(captureArea.height * display.scaleFactor);
          if (Math.abs(metadata.width - expectedWidth) > 1 || Math.abs(metadata.height - expectedHeight) > 1) {
            addIssue('error', 'runtime-product-evidence-area-mismatch', `${kind} dimensions do not match the declared controlled compositor crop.`, 'Refresh runtime evidence without resizing, substituting, or recropping the product frames.', { kind }, 20);
          }
        }
        if (kind === 'technical-window-count' && (metadata.width < config.render.windowSize || metadata.height < config.render.windowSize)) {
          addIssue('error', 'runtime-technical-evidence-small', 'Technical smoke is too small to prove a readable live pet window.', 'Refresh the deterministic multi-window technical smoke.', { kind }, 15);
        }
        const characterEvidence = Array.isArray(entry.characters) ? entry.characters : [];
        const evidenceIds = characterEvidence.map((character) => character?.id).filter((id) => typeof id === 'string' && id);
        const evidenceIdSet = new Set(evidenceIds);
        const missingIds = expectedIds.filter((id) => !evidenceIdSet.has(id));
        const duplicateIds = evidenceIds.filter((id, index) => evidenceIds.indexOf(id) !== index);
        const unreadableIds = characterEvidence.filter((character) => {
          if (!character || character.visible !== true) return true;
          if (!character.bounds || ![character.bounds.x, character.bounds.y, character.bounds.width, character.bounds.height].every(Number.isFinite)) return true;
          if (character.bounds.width <= 0 || character.bounds.height <= 0) return true;
          if (kind.startsWith('normal-')) {
            return !Number.isFinite(character.desktopForegroundRatio) || character.desktopForegroundRatio < 0.005;
          }
          if (kind === 'technical-window-count') {
            return !Number.isFinite(character.alphaCoverage) || character.alphaCoverage < 0.001;
          }
          return false;
        }).map((character) => character?.id || 'unknown');
        if (
          characterEvidence.length !== expectedIds.length ||
          evidenceIdSet.size !== expectedIds.length ||
          missingIds.length || duplicateIds.length || unreadableIds.length
        ) {
          addIssue(
            'error',
            'runtime-evidence-character-coverage',
            `Runtime evidence ${kind} does not prove every configured pet window is visible and readable.`,
            'Refresh the complete multi-window runtime evidence; per-window or incomplete captures are not accepted.',
            { kind, missingIds, duplicateIds: [...new Set(duplicateIds)], unreadableIds },
            25
          );
        }
      }
      const first = byKind.get('normal-live-1');
      const second = byKind.get('normal-live-2');
      if (first?.sha256 && second?.sha256 && first.sha256 === second.sha256) {
        addIssue('error', 'runtime-product-evidence-frozen', 'The two normal-mode desktop frames are byte-identical and do not prove live motion.', 'Capture two distinct live normal-mode moments before deterministic staging.', {}, 25);
      }
      if (byKind.size !== entries.length) {
        addIssue('error', 'runtime-evidence-duplicate-kind', 'Runtime evidence repeats a capture kind.', 'Refresh the evidence manifest from the runtime.', {}, 18);
      }
    } catch (error) {
      addIssue('error', 'runtime-evidence-unreadable', `Could not validate runtime evidence: ${error.message}`, 'Refresh the complete runtime evidence set.', {}, 25);
    }
  }
}
if (runtimePath) {
  if (!fs.existsSync(runtimePath)) {
    addIssue('error', 'missing-runtime', `Runtime screenshot does not exist: ${runtimeRelative}`, 'Run the smoke capture again before delivery.', {}, 25);
  } else {
    try {
      if (fs.statSync(runtimePath).mtimeMs < newestSpriteTime) {
        addIssue('error', 'stale-runtime', 'The runtime screenshot is older than the current sprite frames.', 'Run the app and capture a new runtime-window.png.', {}, 18);
      }
      const raw = await sharp(runtimePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const bounds = alphaBounds(raw.data, raw.info.width, raw.info.height, 4);
      let channelMin = 255;
      let channelMax = 0;
      for (let offset = 0; offset < raw.data.length; offset += 4) {
        channelMin = Math.min(channelMin, raw.data[offset], raw.data[offset + 1], raw.data[offset + 2]);
        channelMax = Math.max(channelMax, raw.data[offset], raw.data[offset + 1], raw.data[offset + 2]);
      }
      runtimeMetrics = {
        path: runtimeRelative,
        dimensions: [raw.info.width, raw.info.height],
        visibleCoverage: round(bounds?.coverage || 0),
        colorRange: channelMax - channelMin
      };
      if (!bounds || bounds.coverage < 0.01 || channelMax - channelMin < 8) {
        addIssue('error', 'blank-runtime', 'Runtime screenshot is blank or contains no readable pet.', 'Fix runtime rendering and capture a new runtime-window.png.', {}, 25);
      }
      if (raw.info.width < config.render.windowSize || raw.info.height < config.render.windowSize) {
        addIssue('warning', 'runtime-dimensions', `Runtime screenshot is ${raw.info.width}x${raw.info.height}; expected a readable composition at least ${config.render.windowSize}x${config.render.windowSize}.`, 'Repeat the smoke capture with every generated pet window visible.', {}, 5);
      }
    } catch (error) {
      addIssue('error', 'unreadable-runtime', `Could not inspect runtime screenshot: ${error.message}`, 'Repeat the runtime smoke capture.', {}, 25);
    }
  }
}

const identityFingerprint = fileHash(identityBoardPath);
const contactSheetFingerprint = fileHash(contactSheetPath);
const characterFingerprints = Object.fromEntries(config.characters.map((character) => [
  character.id,
  combinedHash([
    identityFingerprint,
    ...[...new Set(characterFiles.get(character.id) || [])].sort().map(fileHash)
  ])
]));
const scenarioEvidence = scenarioEvidenceFiles(scenarioRoot);
const scenarioEvidencePaths = scenarioEvidence.map((file) => portableRelative(outputRoot, file));
const releaseEligibleHumorEvidencePaths = releaseEligibleScenarioEvidencePaths(scenarioRoot);
const runtimeFingerprint = hasAnyRuntimeEvidence ? combinedHash([
  'runtime:manual-review',
  `humor-contract:${humorContractFingerprint}`,
  ...runtimeEvidenceCandidates.filter((file) => fs.existsSync(file)).map((file) => `${portableRelative(outputRoot, file)}:${fileHash(file)}`),
  ...scenarioEvidence.map((file, index) => `${scenarioEvidencePaths[index]}:${fileHash(file)}`)
]) : null;
const reviewExisted = fs.existsSync(reviewPath);
if (!reviewExisted) writeJson(reviewPath, expectedReview(characterFingerprints, runtimeFingerprint, releaseEligibleHumorEvidencePaths));
const review = readJson(reviewPath);
const manual = reviewStatus(review, characterFingerprints, runtimeFingerprint, releaseEligibleHumorEvidencePaths);
const totalPenalty = issues.reduce((sum, issue) => sum + issue.penalty, 0);
const overallScore = Math.max(0, 100 - totalPenalty);
const hasErrors = issues.some((issue) => issue.severity === 'error');
let status = 'needs-review';
if (hasErrors || manual.failed) status = 'fail';
else if (manual.complete && overallScore >= minScore) status = 'pass';
else if (manual.complete) status = 'warn';

const persistedIssues = sanitizePersistedValue(issues, outputRoot);
const recommendedActions = [...new Set(persistedIssues.map((issue) => issue.recommendation).filter(Boolean))];
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  project: projectRelative,
  preview: previewRelative,
  status,
  overallScore,
  minScore,
  automated: {
    framesInspected: frameMetrics.length,
    charactersInspected: config.characters.length,
    runtimeInspected: Boolean(runtimePath),
    issues: issues.length
  },
  manualReview: {
    path: reviewRelative,
    provided: manual.provided,
    complete: manual.complete,
    pending: manual.pending,
    failed: manual.failed,
    humor: manual.humor
  },
  artifacts: {
    identityBoard: { path: portableRelative(outputRoot, identityBoardPath), fingerprint: identityFingerprint },
    actionContactSheet: { path: portableRelative(outputRoot, contactSheetPath), fingerprint: contactSheetFingerprint },
    characters: characterFingerprints,
    runtimeWindow: runtimePath ? { path: runtimeRelative, fingerprint: runtimeFingerprint } : null,
    runtimeEvidence: runtimeEvidence ? {
      path: portableRelative(outputRoot, runtimeEvidenceManifestPath),
      files: runtimeEvidenceCandidates.filter((file) => fs.existsSync(file)).map((file) => portableRelative(outputRoot, file)),
      fingerprint: runtimeFingerprint
    } : null,
    scenarioEvidence: scenarioEvidence.map((file) => ({ path: portableRelative(outputRoot, file), fingerprint: fileHash(file) })),
    generationManifest: generationManifest ? { path: portableRelative(outputRoot, generationManifestPath), fingerprint: fileHash(generationManifestPath) } : null
    ,identityQualityReview: identityQuality ? { path: portableRelative(outputRoot, identityQualityPath), fingerprint: fileHash(identityQualityPath) } : null
  },
  issues: persistedIssues,
  recommendedActions,
  frameMetrics,
  runtimeMetrics
};
writeJson(reportPath, sanitizePersistedValue(report, outputRoot));

const issueLines = persistedIssues.length
  ? persistedIssues.map((issue) => `- [${issue.severity.toUpperCase()}] ${issue.message} Action: ${issue.recommendation}`)
  : ['- No automated issues found.'];
const pendingLines = manual.pending.length ? manual.pending.map((item) => `- ${item}`) : ['- None.'];
const markdown = [
  '# Desktop Pet Self-check',
  '',
  `- Status: ${status}`,
  `- Score: ${overallScore}/100 (required: ${minScore})`,
  `- Frames inspected: ${frameMetrics.length}`,
  `- Runtime inspected: ${runtimePath ? 'yes' : 'no'}`,
  '',
  '## Issues',
  '',
  ...issueLines,
  '',
  '## Pending manual checks',
  '',
  ...pendingLines,
  '',
  '## Gate',
  '',
  status === 'pass'
    ? '- Passed. Continue to the next approval or delivery step.'
    : status === 'needs-review'
      ? `- Inspect the identity board, contact sheet${runtimePath ? ', and runtime screenshot' : ''}; fill ${reviewRelative}; then rerun this command.`
      : '- Blocked. Apply the recommended actions and rerun the complete self-check.'
].join('\n');
fs.writeFileSync(markdownPath, `${markdown}\n`, 'utf8');

console.log(JSON.stringify({
  status,
  overallScore,
  minScore,
  report: portableRelative(outputRoot, reportPath),
  review: portableRelative(outputRoot, reviewPath),
  markdown: portableRelative(outputRoot, markdownPath)
}, null, 2));
if (!args['warn-only'] && (status !== 'pass' || !manual.complete)) process.exit(1);
