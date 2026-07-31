import fs from 'node:fs';
import path from 'node:path';
import {
  fail,
  applyCodexRuntimeArgs,
  loadSharp,
  parseArgs,
  readJson,
  writeJson
} from './lib/common.mjs';
import { portableRelative } from './lib/privacy.mjs';
import {
  alphaBounds,
  inferBorderKey,
  parseHexColor,
  removeChroma
} from './lib/sprite-processing.mjs';

const args = parseArgs(process.argv.slice(2));
applyCodexRuntimeArgs(args);
if (!args.project || !args.sheet || !args.character) {
  fail('Usage: node process_sprites.mjs --project <project> --sheet <sheet.png> --character person-1 --pnpm <codex-pnpm> [--node-modules <codex-node-modules>] [--key auto|#ff00ff] [--size 112]');
}

const project = path.resolve(args.project);
const sheet = path.resolve(args.sheet);
const characterId = args.character;
if (!fs.existsSync(path.join(project, 'package.json'))) fail(`Not a generated project: ${project}`);
if (!fs.existsSync(sheet)) fail(`Action sheet does not exist: ${sheet}`);
const outputRoot = path.dirname(project);
let sheetRelative;
try {
  sheetRelative = portableRelative(outputRoot, sheet, 'Action sheet');
} catch (error) {
  fail(error.message);
}
if (!sheetRelative.startsWith('preview/')) fail('Action sheet must be stored under the project preview directory.');

const configPath = path.join(project, 'src', 'config', 'pet.config.json');
const manifestPath = path.join(project, 'src', 'assets', 'sprites', 'manifest.json');
const config = readJson(configPath);
const manifest = readJson(manifestPath);
if (!config.characters.some((character) => character.id === characterId)) fail(`Unknown character id: ${characterId}`);

const sharp = loadSharp(project);
sharp.cache(false);

const spriteSize = Number.parseInt(args.size || config.render.spriteSize || manifest.spriteSize, 10);
if (!Number.isInteger(spriteSize) || spriteSize < 72 || spriteSize > 160) fail('--size must be an integer from 72 to 160.');
const transparentThreshold = Number.parseInt(args.threshold || '28', 10);
const opaqueThreshold = Number.parseInt(args.opaque || '105', 10);
const layout = [
  'crawl_right_1', 'crawl_right_2', 'crawl_left_1', 'crawl_left_2',
  'idle_right', 'idle_left', 'centipede_right', 'centipede_left',
  'shout_1', 'shout_2', 'shout_3', 'drag'
];

const sheetMeta = await sharp(sheet).metadata();
if (!sheetMeta.width || !sheetMeta.height) fail('Could not read action-sheet dimensions.');
const cellWidth = Math.floor(sheetMeta.width / 4);
const cellHeight = Math.floor(sheetMeta.height / 3);
if (cellWidth < 64 || cellHeight < 64) fail('Action sheet is too small for a 4x3 grid.');

const outputDir = path.join(project, 'src', 'assets', 'sprites', characterId);
fs.mkdirSync(outputDir, { recursive: true });
const report = [];
const composedBounds = new Map();

for (let index = 0; index < layout.length; index += 1) {
  const row = Math.floor(index / 4);
  const column = index % 4;
  const width = column === 3 ? sheetMeta.width - column * cellWidth : cellWidth;
  const height = row === 2 ? sheetMeta.height - row * cellHeight : cellHeight;
  const extracted = await sharp(sheet)
    .extract({ left: column * cellWidth, top: row * cellHeight, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const key = !args.key || args.key === 'auto'
    ? inferBorderKey(extracted.data, extracted.info.width, extracted.info.height, 4)
    : parseHexColor(args.key);
  const cleaned = removeChroma(
    extracted.data,
    extracted.info.width,
    extracted.info.height,
    key,
    transparentThreshold,
    opaqueThreshold
  );
  const bounds = alphaBounds(cleaned, extracted.info.width, extracted.info.height);
  if (!bounds) fail(`${layout[index]} contains no visible subject after key removal.`);
  if (bounds.coverage < 0.03 || bounds.coverage > 0.9) {
    fail(`${layout[index]} subject coverage ${(bounds.coverage * 100).toFixed(1)}% is outside 3%-90%.`);
  }

  const cropped = await sharp(cleaned, {
    raw: { width: extracted.info.width, height: extracted.info.height, channels: 4 }
  })
    .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
    .resize(spriteSize - 8, spriteSize - 8, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.floor((spriteSize - cropped.info.width) / 2);
  const top = Math.floor((spriteSize - cropped.info.height) / 2);
  const filename = `${layout[index]}.png`;
  await sharp({
    create: { width: spriteSize, height: spriteSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: cropped.data, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, filename));
  const frameBounds = {
    left,
    top,
    right: left + cropped.info.width - 1,
    bottom: top + cropped.info.height - 1,
    width: cropped.info.width,
    height: cropped.info.height
  };
  composedBounds.set(layout[index], frameBounds);
  report.push({ action: layout[index], key: `#${key.map((part) => part.toString(16).padStart(2, '0')).join('')}`, coverage: bounds.coverage, frameBounds });
}

const frames = {
  crawl_right: [`${characterId}/crawl_right_1.png`, `${characterId}/crawl_right_2.png`],
  crawl_left: [`${characterId}/crawl_left_1.png`, `${characterId}/crawl_left_2.png`],
  idle_right: [`${characterId}/idle_right.png`],
  idle_left: [`${characterId}/idle_left.png`],
  centipede_right: [`${characterId}/centipede_right.png`],
  centipede_left: [`${characterId}/centipede_left.png`],
  shout: [`${characterId}/shout_1.png`, `${characterId}/shout_2.png`, `${characterId}/shout_3.png`],
  drag: [`${characterId}/drag.png`]
};
const manifestEntry = manifest.characters.find((character) => character.id === characterId);
const roleFrames = Object.fromEntries(Object.entries(manifestEntry.frames || {}).filter(([group]) => group.startsWith('poop_') || group.startsWith('eat_')));
manifestEntry.frames = { ...frames, ...roleFrames };
const anchorFromBounds = (bounds, direction) => {
  const inset = bounds.width * 0.08;
  const frontX = direction === 'right' ? bounds.right - inset : bounds.left + inset;
  const rearX = direction === 'right' ? bounds.left + inset : bounds.right - inset;
  return {
    head: [frontX / spriteSize, (bounds.top + bounds.height * 0.38) / spriteSize],
    rear: [rearX / spriteSize, (bounds.top + bounds.height * 0.62) / spriteSize]
  };
};
manifestEntry.anchors = {
  right: anchorFromBounds(composedBounds.get('centipede_right'), 'right'),
  left: anchorFromBounds(composedBounds.get('centipede_left'), 'left')
};
manifest.spriteSize = spriteSize;
writeJson(manifestPath, manifest);
writeJson(path.join(outputDir, 'processing-report.json'), { characterId, sheet: sheetRelative, spriteSize, cells: report });

console.log(`Processed ${characterId}: ${outputDir}`);
