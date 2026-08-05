import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyCodexRuntimeArgs, fail, loadSharp, parseArgs, readJson } from './lib/common.mjs';
import { alphaBounds } from './lib/sprite-processing.mjs';
import { auditTextFilesForSensitivePaths, isRasterFile, portableRelative } from './lib/privacy.mjs';

const args = parseArgs(process.argv.slice(2));
applyCodexRuntimeArgs(args);
if (!args.project) fail('Usage: node validate_project.mjs --project <project> --pnpm <codex-pnpm> [--node-modules <codex-node-modules>] [--source <original-photo>]');
const project = path.resolve(args.project);
const projectManifestPath = path.join(path.dirname(project), 'project-manifest.json');
const configPath = path.join(project, 'src', 'config', 'pet.config.json');
const behaviorsPath = path.join(project, 'src', 'config', 'behaviors.json');
const manifestPath = path.join(project, 'src', 'assets', 'sprites', 'manifest.json');
for (const file of [configPath, behaviorsPath, manifestPath, path.join(project, 'package.json')]) {
  if (!fs.existsSync(file)) fail(`Missing required file: ${file}`);
}

const config = readJson(configPath);
const behaviors = readJson(behaviorsPath);
const manifest = readJson(manifestPath);
const errors = [];
let projectManifest = null;
if (!fs.existsSync(projectManifestPath)) errors.push('project-manifest.json is required.');
else {
  projectManifest = readJson(projectManifestPath);
  if (projectManifest.schemaVersion !== 2) errors.push('project-manifest.json must use schemaVersion 2. Run migrate_project_manifest.mjs before validation or building.');
  if (projectManifest.consent?.allSubjectsAuthorized !== true) errors.push('The project is missing the required all-subjects authorization attestation.');
  for (const [key, expected] of Object.entries({ project: 'project', release: 'release', preview: 'preview' })) {
    if (projectManifest.paths?.[key] !== expected) errors.push(`project-manifest paths.${key} must be ${expected}.`);
  }
  if (projectManifest.sourcePhoto || projectManifest.createdAt || projectManifest.project || projectManifest.release || projectManifest.preview) {
    errors.push('project-manifest.json contains deprecated source fingerprints, timestamps, or absolute path fields. Run the V2 migration.');
  }
  const allowedKeys = new Set(['schemaVersion', 'name', 'people', 'paths', 'selection', 'consent']);
  for (const key of Object.keys(projectManifest)) if (!allowedKeys.has(key)) errors.push(`project-manifest.json contains unsupported field: ${key}.`);
}
if (config.schemaVersion !== 1 || behaviors.schemaVersion !== 1 || manifest.schemaVersion !== 1) errors.push('All schemaVersion values must be 1.');
if (!Array.isArray(config.characters) || config.characters.length < 1 || config.characters.length > 8) errors.push('pet.config.json must contain 1-8 characters.');
const ids = config.characters.map((character) => character.id);
if (new Set(ids).size !== ids.length) errors.push('Character ids must be unique.');
if (config.render.spriteSize < 72 || config.render.spriteSize > 160) errors.push('render.spriteSize must be 72-160.');
if (config.render.effectSize < 16 || config.render.effectSize > 48) errors.push('render.effectSize must be 16-48.');
if (config.render.windowSize <= config.render.spriteSize) errors.push('render.windowSize must exceed render.spriteSize.');
if (config.packaging.windowsTarget !== 'portable') errors.push('Windows target must be portable in v1.');
if (config.packaging.macTarget !== 'dir' || config.packaging.macArch !== 'arm64') errors.push('macOS target must be unsigned arm64 dir in v1.');
const selection = config.selection || {};
if (!['normal', 'centipede', 'poop-relay', 'all'].includes(selection.mode)) errors.push('selection.mode must be normal, centipede, poop-relay, or all.');
if (selection.userCharacterId !== null && !ids.includes(selection.userCharacterId)) errors.push('selection.userCharacterId must be null or a configured character id.');
const prankExcludedIds = Array.isArray(selection.prankExcludedCharacterIds) ? selection.prankExcludedCharacterIds : [];
if (!Array.isArray(selection.prankExcludedCharacterIds)) errors.push('selection.prankExcludedCharacterIds must be an array.');
if (new Set(prankExcludedIds).size !== prankExcludedIds.length) errors.push('selection.prankExcludedCharacterIds must be unique.');
for (const id of prankExcludedIds) if (!ids.includes(id)) errors.push(`Unknown prank-excluded character: ${id}.`);
if (selection.userCharacterId !== null && !prankExcludedIds.includes(selection.userCharacterId)) errors.push('selection.userCharacterId must be included in selection.prankExcludedCharacterIds.');
if (!behaviors.hotkeys?.dad || !behaviors.hotkeys?.grandpa || !behaviors.hotkeys?.centipede || !behaviors.hotkeys?.poopChase || !behaviors.hotkeys?.pause) errors.push('All default hotkeys must be configured.');

const poopChase = behaviors.poopChase || {};
const numericRules = [
  ['maxSpeed', 50, 2000], ['followStrength', 0.1, 30], ['gap', 0, 80],
  ['deadZone', 0, 200], ['dropDistance', 20, 500], ['minDropIntervalMs', 100, 10000],
  ['initialDropDelayMs', 0, 10000], ['dropVisibleBeforeEatMs', 0, 10000], ['poopDurationMs', 100, 5000],
  ['eatRadius', 8, 160], ['eatDurationMs', 100, 5000], ['consumedDelayMs', 0, 5000],
  ['roundResetDelayMs', 0, 10000], ['maxDroppings', 1, 1], ['droppingTtlMs', 1000, 120000], ['poopSize', 16, 48], ['stinkSize', 16, 48]
];
for (const [key, min, max] of numericRules) {
  if (!Number.isFinite(poopChase[key]) || poopChase[key] < min || poopChase[key] > max) {
    errors.push(`poopChase.${key} must be ${min}-${max}.`);
  }
}
let poopLeader = null;
let poopFollowers = [];
if (poopChase.enabled) {
  poopLeader = poopChase.leaderId;
  poopFollowers = Array.isArray(poopChase.followerIds) ? poopChase.followerIds : [];
  if (!ids.includes(poopLeader)) errors.push('poopChase.leaderId must match a configured character.');
  if (!poopFollowers.length) errors.push('poopChase.followerIds must contain at least one character.');
  if (new Set(poopFollowers).size !== poopFollowers.length) errors.push('poopChase.followerIds must be unique.');
  if (poopFollowers.includes(poopLeader)) errors.push('poopChase leader cannot also be a follower.');
  for (const id of poopFollowers) if (!ids.includes(id)) errors.push(`Unknown poopChase follower: ${id}.`);
}
if ((selection.mode === 'poop-relay' || selection.mode === 'all') !== Boolean(poopChase.enabled)) errors.push('selection.mode and poopChase.enabled disagree.');
if ((selection.mode === 'centipede' || selection.mode === 'all') !== Boolean(behaviors.centipede?.enabled)) errors.push('selection.mode and centipede.enabled disagree.');
if (projectManifest) {
  if (projectManifest.name !== config.app?.name) errors.push('project-manifest name must match pet.config.json app.name.');
  if (projectManifest.people !== config.characters.length) errors.push('project-manifest people must match the configured character count.');
  const declared = projectManifest.selection || {};
  if (declared.mode !== selection.mode || (declared.userCharacterId ?? null) !== (selection.userCharacterId ?? null)) {
    errors.push('project-manifest selection must match pet.config.json.');
  }
  if (JSON.stringify(declared.prankExcludedCharacterIds || []) !== JSON.stringify(prankExcludedIds)) errors.push('project-manifest prankExcludedCharacterIds must match pet.config.json in order.');
  if ((declared.leaderId ?? null) !== (poopChase.enabled ? poopLeader : null)) errors.push('project-manifest leaderId must match behaviors.json.');
  if (JSON.stringify(declared.followerIds || []) !== JSON.stringify(poopChase.enabled ? poopFollowers : [])) errors.push('project-manifest followerIds must match behaviors.json in order.');
}

const sharp = loadSharp(project);
sharp.cache(false);
const spriteRoot = path.join(project, 'src', 'assets', 'sprites');
const expectedGroups = ['crawl_right', 'crawl_left', 'idle_right', 'idle_left', 'centipede_right', 'centipede_left', 'shout', 'drag'];
const uniqueFiles = new Set();

for (const id of ids) {
  const entry = manifest.characters.find((character) => character.id === id);
  if (!entry) { errors.push(`Manifest is missing ${id}.`); continue; }
  for (const group of expectedGroups) {
    if (!Array.isArray(entry.frames?.[group]) || !entry.frames[group].length) {
      errors.push(`${id} is missing frame group ${group}.`);
      continue;
    }
    for (const relative of entry.frames[group]) {
      if (path.isAbsolute(relative) || relative.includes('..') || relative.includes(':')) {
        errors.push(`${id} has unsafe sprite path: ${relative}`);
        continue;
      }
      uniqueFiles.add(relative);
    }
  }
  const expectedShoutFrames = [1, 2, 3].map((frame) => `${id}/shout_${frame}.png`);
  if (JSON.stringify(entry.frames?.shout || []) !== JSON.stringify(expectedShoutFrames)) {
    errors.push(`${id} shout must contain exactly shout_1.png, shout_2.png, and shout_3.png in order.`);
  }
  const relayParticipants = new Set([poopLeader, ...poopFollowers].filter(Boolean));
  const roleGroups = poopChase.enabled && relayParticipants.has(id)
    ? ['poop_right', 'poop_left', 'eat_right', 'eat_left']
    : [];
  for (const group of roleGroups) {
    if (!Array.isArray(entry.frames?.[group]) || !entry.frames[group].length) {
      errors.push(`${id} is missing poop-chase frame group ${group}.`);
      continue;
    }
    for (const relative of entry.frames[group]) {
      if (path.isAbsolute(relative) || relative.includes('..') || relative.includes(':')) errors.push(`${id} has unsafe sprite path: ${relative}`);
      else uniqueFiles.add(relative);
    }
  }
  for (const direction of ['right', 'left']) {
    const head = entry.anchors?.[direction]?.head;
    const mouth = entry.anchors?.[direction]?.mouth;
    const rear = entry.anchors?.[direction]?.rear;
    if (![head, mouth, rear].every((point) => Array.isArray(point) && point.length === 2 && point.every((value) => value >= 0 && value <= 1))) {
      errors.push(`${id} has invalid ${direction} head/mouth/rear anchors.`);
    } else if (Math.abs(head[0] - rear[0]) < 0.4) {
      errors.push(`${id} ${direction} head and rear anchors are too close.`);
    }
  }
}

for (const relative of uniqueFiles) {
  const file = path.join(spriteRoot, relative);
  if (!fs.existsSync(file)) { errors.push(`Missing sprite file: ${relative}`); continue; }
  try {
    const raw = await sharp(file).ensureAlpha().resize(config.render.spriteSize, config.render.spriteSize, { fit: 'contain' }).raw().toBuffer({ resolveWithObject: true });
    const bounds = alphaBounds(raw.data, raw.info.width, raw.info.height);
    if (!bounds) errors.push(`${relative} has no visible pixels.`);
    else if (bounds.coverage < 0.03 || bounds.coverage > 0.9) errors.push(`${relative} coverage ${(bounds.coverage * 100).toFixed(1)}% is outside 3%-90%.`);
    const corners = [0, raw.info.width - 1, (raw.info.height - 1) * raw.info.width, raw.info.height * raw.info.width - 1];
    if (corners.some((pixel) => raw.data[pixel * 4 + 3] > 12)) errors.push(`${relative} has an opaque corner.`);
  } catch (error) {
    errors.push(`Could not inspect ${relative}: ${error.message}`);
  }
}

if (args.source) {
  const source = path.resolve(args.source);
  if (!fs.existsSync(source)) errors.push(`Source photo does not exist: ${source}`);
  else {
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const sourceSize = fs.statSync(source).size;
    const stack = [project];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && fs.statSync(full).size === sourceSize) {
          const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
          if (hash === sourceHash) errors.push(`Original source photo was copied into the project: ${portableRelative(path.dirname(project), full)}`);
        }
      }
    }
  }
}

const allowedRaster = new Set([...uniqueFiles].map((relative) => path.resolve(spriteRoot, relative)));
const projectStack = [project];
while (projectStack.length) {
  const current = projectStack.pop();
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (['node_modules', 'dist'].includes(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) projectStack.push(full);
    else if (entry.isFile() && isRasterFile(full) && !allowedRaster.has(path.resolve(full))) {
      errors.push(`Unexpected raster file in project: ${portableRelative(path.dirname(project), full)}`);
    }
  }
}
for (const issue of auditTextFilesForSensitivePaths(path.dirname(project))) {
  errors.push(`${issue.file} contains an absolute/private path.`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log(`Project valid: ${project} (${ids.length} character(s), ${uniqueFiles.size} unique sprite file(s))`);
