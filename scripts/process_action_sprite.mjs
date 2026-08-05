import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyCodexRuntimeArgs, fail, loadSharp, parseArgs, readJson, writeJson } from './lib/common.mjs';
import { alphaBounds, inferBorderKey, nearestVisibleAlphaDistance, parseHexColor, preparePortraitAlpha } from './lib/sprite-processing.mjs';
import { portableRelative } from './lib/privacy.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.project || !args.file || !args.character || !args.action) {
  fail('Usage: node process_action_sprite.mjs --project <project> --file <image> --character person-1 --action <action> --pnpm <codex-pnpm> [--node-modules <path>] [--key auto|#ff00ff] [--head x,y --mouth x,y --rear x,y]');
}
applyCodexRuntimeArgs(args);
const project = path.resolve(args.project);
const file = path.resolve(args.file);
const characterId = String(args.character);
const action = String(args.action);
const allowed = new Set([
  'crawl_right_1', 'crawl_right_2', 'crawl_left_1', 'crawl_left_2',
  'idle_right', 'idle_left', 'centipede_right', 'centipede_left',
  'kneel_shout_1', 'kneel_shout_2', 'kneel_shout_3', 'drag',
  'poop_right', 'poop_left', 'eat_right', 'eat_left'
]);
if (!allowed.has(action)) fail(`Unsupported action: ${action}`);
if (!fs.existsSync(file)) fail(`Generated action image does not exist: ${file}`);
if (action.startsWith('centipede_') && (!args.head || !args.mouth || !args.rear)) fail('Centipede actions require --head, --mouth, and --rear anchors.');
const outputRoot = path.dirname(project);
const relative = portableRelative(outputRoot, file, 'Generated action image');
if (!relative.startsWith('preview/')) fail('Generated action image must remain inside preview/.');

let derivedRecord = null;
const generationManifestPath = path.join(outputRoot, 'preview', 'generation-manifest.json');
if (fs.existsSync(generationManifestPath)) {
  const generationManifest = readJson(generationManifestPath);
  const generationRecord = generationManifest.schemaVersion === 3 && Array.isArray(generationManifest.assets)
    ? generationManifest.assets.find((item) => item.kind === 'action' && item.characterId === characterId && item.action === action)
    : null;
  if (generationRecord?.origin === 'derived') {
    const fileSha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (generationRecord.file !== relative || generationRecord.derivedSha !== fileSha || generationRecord.sha256 !== fileSha || generationRecord.transform !== 'horizontal-flip') {
      fail(`Derived action processing does not match its schema v3 generation record: ${action}.`);
    }
    derivedRecord = generationRecord;
  }
}

const configPath = path.join(project, 'src', 'config', 'pet.config.json');
const manifestPath = path.join(project, 'src', 'assets', 'sprites', 'manifest.json');
const config = readJson(configPath);
const manifest = readJson(manifestPath);
if (!config.characters.some((character) => character.id === characterId)) fail(`Unknown character id: ${characterId}`);
const sharp = loadSharp(project);
sharp.cache(false);
const spriteSize = Number.parseInt(args.size || config.render.spriteSize || manifest.spriteSize, 10);
const input = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const key = !args.key || args.key === 'auto' ? inferBorderKey(input.data, input.info.width, input.info.height, 4) : parseHexColor(args.key);
const cleaned = preparePortraitAlpha(input.data, input.info.width, input.info.height, key, Number(args.threshold || 28), Number(args.opaque || 105));
const bounds = alphaBounds(cleaned, input.info.width, input.info.height);
if (!bounds || bounds.coverage < 0.03 || bounds.coverage > 0.9) fail(`${action} has invalid visible coverage.`);
const cropped = await sharp(cleaned, { raw: { width: input.info.width, height: input.info.height, channels: 4 } })
  .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
  .resize(spriteSize - 12, spriteSize - 12, { fit: 'inside' })
  .png()
  .toBuffer({ resolveWithObject: true });
const left = Math.floor((spriteSize - cropped.info.width) / 2);
const top = Math.floor((spriteSize - cropped.info.height) / 2);
const outputDir = path.join(project, 'src', 'assets', 'sprites', characterId);
fs.mkdirSync(outputDir, { recursive: true });
const runtimeAction = action.startsWith('kneel_shout_') ? action.replace('kneel_shout_', 'shout_') : action;
const output = path.join(outputDir, `${runtimeAction}.png`);
let outputBuffer;
if (derivedRecord) {
  const sourceSprite = path.join(outputDir, `${derivedRecord.sourceAction}.png`);
  const sourceReportPath = path.join(outputDir, `${derivedRecord.sourceAction}-processing-report.json`);
  if (!fs.existsSync(sourceSprite) || !fs.existsSync(sourceReportPath)) fail(`Derived action requires an already processed source sprite: ${derivedRecord.sourceAction}.`);
  const sourceReport = readJson(sourceReportPath);
  if (sourceReport.source !== derivedRecord.sourceFile || sourceReport.spriteSize !== spriteSize) fail(`Derived action source processing report does not match its generation lineage: ${derivedRecord.sourceAction}.`);
  const sourceMetadata = await sharp(sourceSprite).metadata();
  if (sourceMetadata.width !== spriteSize || sourceMetadata.height !== spriteSize) fail(`Derived action source sprite must be ${spriteSize}x${spriteSize}.`);
  outputBuffer = await sharp(sourceSprite).flop().png({ compressionLevel: 9 }).toBuffer();
} else {
  outputBuffer = await sharp({ create: { width: spriteSize, height: spriteSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: cropped.data, left, top }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const entry = manifest.characters.find((character) => character.id === characterId);
entry.frames ||= {};
const aliases = {
  crawl_right_1: 'crawl_right', crawl_right_2: 'crawl_right',
  crawl_left_1: 'crawl_left', crawl_left_2: 'crawl_left'
};
const group = aliases[action] || action;
const spriteRelative = `${characterId}/${runtimeAction}.png`;
if (aliases[action]) {
  const pair = action.endsWith('_1') ? [spriteRelative, `${characterId}/${action.replace('_1', '_2')}.png`] : [`${characterId}/${action.replace('_2', '_1')}.png`, spriteRelative];
  entry.frames[group] = pair.filter((item) => fs.existsSync(path.join(project, 'src', 'assets', 'sprites', item)));
} else if (action.startsWith('kneel_shout_')) {
  entry.frames.shout = [1, 2, 3]
    .map((frame) => `${characterId}/shout_${frame}.png`)
    .filter((item) => fs.existsSync(path.join(project, 'src', 'assets', 'sprites', item)) || item === spriteRelative);
  delete entry.frames[action];
} else entry.frames[group] = [spriteRelative];

function point(value, label) {
  const parts = String(value || '').split(',').map(Number);
  if (parts.length !== 2 || parts.some((item) => !Number.isFinite(item) || item < 0 || item > 1)) fail(`--${label} must be normalized x,y values`);
  return parts;
}
if (action.startsWith('centipede_')) {
  const direction = action.endsWith('_left') ? 'left' : 'right';
  entry.anchors ||= {};
  entry.anchors[direction] ||= {};
  const head = point(args.head, 'head');
  const mouth = point(args.mouth, 'mouth');
  const rear = point(args.rear, 'rear');
  const outputPixels = await sharp(outputBuffer).ensureAlpha().raw().toBuffer();
  const maximumDistance = Math.max(4, spriteSize * 0.1);
  for (const [label, anchor] of [['head', head], ['mouth', mouth], ['rear', rear]]) {
    const distance = nearestVisibleAlphaDistance(outputPixels, spriteSize, spriteSize, anchor);
    if (!Number.isFinite(distance) || distance > maximumDistance) {
      fail(`--${label} anchor is detached from the visible subject (${distance.toFixed(1)}px; maximum ${maximumDistance.toFixed(1)}px).`);
    }
  }
  const outward = direction === 'right' ? mouth[0] > 0.5 && rear[0] < 0.5 : mouth[0] < 0.5 && rear[0] > 0.5;
  if (!outward) fail(`Centipede ${direction} anchors must place mouth and rear on opposite outward halves of the sprite.`);
  entry.anchors[direction] = { ...entry.anchors[direction], head, mouth, rear };
}
fs.writeFileSync(output, outputBuffer);
if (runtimeAction !== action) {
  const staleOutput = path.join(outputDir, `${action}.png`);
  if (fs.existsSync(staleOutput)) fs.rmSync(staleOutput);
}
manifest.spriteSize = spriteSize;
writeJson(manifestPath, manifest);
writeJson(path.join(outputDir, `${action}-processing-report.json`), {
  characterId, action, source: relative, spriteSize,
  key: `#${key.map((part) => part.toString(16).padStart(2, '0')).join('')}`,
  coverage: bounds.coverage,
  ...(derivedRecord ? { derivedFrom: { action: derivedRecord.sourceAction, transform: 'horizontal-flip' } } : {}),
  anchors: action.startsWith('centipede_') ? {
    explicit: true,
    direction: action.endsWith('_left') ? 'left' : 'right',
    head: point(args.head, 'head'),
    mouth: point(args.mouth, 'mouth'),
    rear: point(args.rear, 'rear')
  } : null
});
console.log(output);
