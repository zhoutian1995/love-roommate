import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { applyCodexRuntimeArgs, fail, loadSharp, parseArgs, readJson, writeJson } from './lib/common.mjs';
import { alphaBounds } from './lib/sprite-processing.mjs';

const args = parseArgs(process.argv.slice(2));
applyCodexRuntimeArgs(args);
if (!args.project) {
  fail('Usage: node self_check_project.mjs --project <project> [--preview <preview-dir>] [--runtime <runtime-window.png>] [--review <self-check-review.json>] [--min-score 85] [--warn-only]');
}

const project = path.resolve(args.project);
const preview = path.resolve(args.preview || path.join(path.dirname(project), 'preview'));
const configPath = path.join(project, 'src', 'config', 'pet.config.json');
const behaviorsPath = path.join(project, 'src', 'config', 'behaviors.json');
const manifestPath = path.join(project, 'src', 'assets', 'sprites', 'manifest.json');
if (!fs.existsSync(configPath) || !fs.existsSync(behaviorsPath) || !fs.existsSync(manifestPath)) fail(`Not a generated desktop-pet project: ${project}`);

const minScore = Number.parseInt(args['min-score'] || '85', 10);
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
const reviewPath = args.review ? path.resolve(args.review) : defaultReviewPath;
const spriteRoot = path.join(project, 'src', 'assets', 'sprites');
const issues = [];
const frameMetrics = [];
const frameBuffers = new Map();
const characterFiles = new Map(config.characters.map((character) => [character.id, []]));
const identityBoardPath = path.join(preview, 'identity-board.png');
const contactSheetPath = path.join(preview, 'action-contact-sheet.png');
const generationManifestPath = path.join(preview, 'generation-manifest.json');
const poopChase = behaviors.poopChase || {};
const poopFollowers = Array.isArray(poopChase.followerIds) ? poopChase.followerIds : [];

function requiredCharacterChecks(characterId) {
  const checks = ['identityConsistency', 'clothingSeparation', 'actionReadability', 'bodyCompleteness', 'edgeQuality'];
  if (poopChase.enabled && (characterId === poopChase.leaderId || poopFollowers.includes(characterId))) {
    checks.push('roleActionReadability');
  }
  return checks;
}

function addIssue(severity, code, message, recommendation, details = {}, penalty) {
  const defaultPenalty = severity === 'error' ? 18 : severity === 'warning' ? 5 : 0;
  issues.push({ severity, code, message, recommendation, penalty: penalty ?? defaultPenalty, ...details });
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

function validateGenerationManifest() {
  if (!fs.existsSync(generationManifestPath)) return null;
  const data = readJson(generationManifestPath);
  if (data.schemaVersion !== 1 || data.requiredModel !== 'gpt-image-2' || !Array.isArray(data.assets)) {
    addIssue('error', 'generation-manifest-schema', 'The generation manifest is invalid or does not require gpt-image-2.', 'Regenerate the manifest and record only GPT Image 2 final artwork.', {}, 25);
    return data;
  }
  const required = [{ kind: 'identity', characterId: null, role: null }];
  for (const character of config.characters) required.push({ kind: 'base', characterId: character.id, role: null });
  if (poopChase.enabled) {
    required.push({ kind: 'role', characterId: poopChase.leaderId, role: 'leader' });
    for (const characterId of poopFollowers) required.push({ kind: 'role', characterId, role: 'follower' });
  }
  for (const expected of required) {
    const entry = data.assets.find((item) =>
      item.kind === expected.kind &&
      (item.characterId || null) === expected.characterId &&
      (item.role || null) === expected.role
    );
    const label = [expected.kind, expected.characterId, expected.role].filter(Boolean).join(':');
    if (!entry) {
      addIssue('error', 'missing-gpt-image-2-provenance', `Missing GPT Image 2 generation record for ${label}.`, 'Generate the final artwork with GPT Image 2 and record it with record_image_generation.mjs.', { asset: label }, 20);
      continue;
    }
    if (entry.model !== 'gpt-image-2') {
      addIssue('error', 'wrong-generation-model', `${label} was recorded with ${entry.model || 'an unknown model'}, not gpt-image-2.`, 'Regenerate this artwork with GPT Image 2.', { asset: label, model: entry.model }, 25);
      continue;
    }
    const file = path.resolve(preview, entry.file || '');
    const safe = file.startsWith(`${preview}${path.sep}`);
    if (!safe || !fs.existsSync(file)) {
      addIssue('error', 'missing-generation-source', `Recorded GPT Image 2 source is missing or unsafe for ${label}.`, 'Restore the recorded source inside preview and record it again.', { asset: label, file }, 20);
      continue;
    }
    const currentHash = fileHash(file);
    if (currentHash !== entry.sha256) {
      addIssue('error', 'stale-generation-provenance', `Recorded GPT Image 2 source changed after approval for ${label}.`, 'Record the current GPT Image 2 output again before processing and review.', { asset: label, file }, 20);
    }
  }
  return data;
}

function expectedReview(characterFingerprints, runtimeFingerprint) {
  return {
    schemaVersion: 1,
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
      notes: ''
    },
    overallNotes: ''
  };
}

function reviewStatus(review, characterFingerprints, runtimeFingerprint) {
  const result = { provided: Boolean(review), complete: true, failed: false, pending: [] };
  if (!review) {
    return {
      ...result,
      complete: false,
      pending: config.characters.flatMap((character) => requiredCharacterChecks(character.id).map((check) => `${character.id}:${check}`))
    };
  }
  if (review.schemaVersion !== 1) {
    addIssue('error', 'review-schema', 'Manual review must use schemaVersion 1.', 'Regenerate self-check-review.json and review the current assets.', {}, 20);
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
const generationManifest = validateGenerationManifest();
const expectedFrameCounts = {
  crawl_right: 2,
  crawl_left: 2,
  idle_right: 1,
  idle_left: 1,
  centipede_right: 1,
  centipede_left: 1,
  shout: 3,
  drag: 1
};
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
  const roleGroups = poopChase.enabled
    ? character.id === poopChase.leaderId
      ? ['poop_right', 'poop_left']
      : poopFollowers.includes(character.id)
        ? ['eat_right', 'eat_left']
        : []
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
  for (const direction of ['right', 'left']) {
    const anchors = entry.anchors?.[direction];
    const head = anchors?.head;
    const rear = anchors?.rear;
    if (!head || !rear) continue;
    const correctOrder = direction === 'right' ? head[0] > rear[0] : head[0] < rear[0];
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
          if (distance < 48) keyLikePixels += 1;
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
      keySpillRatio: round(keyLikePixels / Math.max(1, visiblePixels))
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
    if (keyLikePixels / Math.max(1, visiblePixels) > 0.025) {
      addIssue('warning', 'chroma-spill', `${relative} retains ${(keyLikePixels / visiblePixels * 100).toFixed(1)}% key-like visible pixels.`, `Regenerate ${primary.characterId}'s sheet with cleaner flat-key separation or adjust key removal.`, { ...primary, frame: relative }, 6);
    }
  } catch (error) {
    addIssue('error', 'unreadable-frame', `Could not inspect ${relative}: ${error.message}`, `Reprocess ${primary.characterId}'s action sheet.`, { ...primary, frame: relative }, 25);
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
if (runtimePath) {
  if (!fs.existsSync(runtimePath)) {
    addIssue('error', 'missing-runtime', `Runtime screenshot does not exist: ${runtimePath}`, 'Run the smoke capture again before delivery.', {}, 25);
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
        path: runtimePath,
        dimensions: [raw.info.width, raw.info.height],
        visibleCoverage: round(bounds?.coverage || 0),
        colorRange: channelMax - channelMin
      };
      if (!bounds || bounds.coverage < 0.01 || channelMax - channelMin < 8) {
        addIssue('error', 'blank-runtime', 'Runtime screenshot is blank or contains no readable pet.', 'Fix runtime rendering and capture a new runtime-window.png.', {}, 25);
      }
      if (raw.info.width !== config.render.windowSize || raw.info.height !== config.render.windowSize) {
        addIssue('warning', 'runtime-dimensions', `Runtime screenshot is ${raw.info.width}x${raw.info.height}; expected ${config.render.windowSize}x${config.render.windowSize}.`, 'Repeat the smoke capture with the generated pet window.', {}, 5);
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
const runtimeFingerprint = runtimePath ? fileHash(runtimePath) : null;
const reviewExisted = fs.existsSync(reviewPath);
if (!reviewExisted) writeJson(reviewPath, expectedReview(characterFingerprints, runtimeFingerprint));
const review = readJson(reviewPath);
const manual = reviewStatus(review, characterFingerprints, runtimeFingerprint);
const totalPenalty = issues.reduce((sum, issue) => sum + issue.penalty, 0);
const overallScore = Math.max(0, 100 - totalPenalty);
const hasErrors = issues.some((issue) => issue.severity === 'error');
let status = 'needs-review';
if (hasErrors || manual.failed) status = 'fail';
else if (manual.complete && overallScore >= minScore) status = 'pass';
else if (manual.complete) status = 'warn';

const recommendedActions = [...new Set(issues.map((issue) => issue.recommendation).filter(Boolean))];
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  project,
  preview,
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
    path: reviewPath,
    provided: manual.provided,
    complete: manual.complete,
    pending: manual.pending,
    failed: manual.failed
  },
  artifacts: {
    identityBoard: { path: identityBoardPath, fingerprint: identityFingerprint },
    actionContactSheet: { path: contactSheetPath, fingerprint: contactSheetFingerprint },
    characters: characterFingerprints,
    runtimeWindow: runtimePath ? { path: runtimePath, fingerprint: runtimeFingerprint } : null
    ,generationManifest: generationManifest ? { path: generationManifestPath, fingerprint: fileHash(generationManifestPath) } : null
  },
  issues,
  recommendedActions,
  frameMetrics,
  runtimeMetrics
};
writeJson(reportPath, report);

const issueLines = issues.length
  ? issues.map((issue) => `- [${issue.severity.toUpperCase()}] ${issue.message} Action: ${issue.recommendation}`)
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
      ? `- Inspect the identity board, contact sheet${runtimePath ? ', and runtime screenshot' : ''}; fill ${reviewPath}; then rerun this command.`
      : '- Blocked. Apply the recommended actions and rerun the complete self-check.'
].join('\n');
fs.writeFileSync(markdownPath, `${markdown}\n`, 'utf8');

console.log(JSON.stringify({ status, overallScore, minScore, report: reportPath, review: reviewPath, markdown: markdownPath }, null, 2));
if (!args['warn-only'] && (status !== 'pass' || !manual.complete)) process.exit(1);
