import fs from 'node:fs';
import path from 'node:path';
import { applyCodexRuntimeArgs, fail, loadSharp, parseArgs, readJson, writeJson } from './lib/common.mjs';
import { alphaBounds, inferBorderKey, parseHexColor, removeChroma } from './lib/sprite-processing.mjs';

const args = parseArgs(process.argv.slice(2));
applyCodexRuntimeArgs(args);
if (!args.project || !args.sheet || !args.character || !args.role) {
  fail('Usage: node process_role_sprites.mjs --project <project> --sheet <sheet.png> --character person-1 --role leader|follower [--key auto|#ff00ff] [--size 112]');
}

const project = path.resolve(args.project);
const sheet = path.resolve(args.sheet);
const characterId = args.character;
const role = String(args.role).toLowerCase();
if (!['leader', 'follower'].includes(role)) fail('--role must be leader or follower.');
if (!fs.existsSync(path.join(project, 'package.json'))) fail(`Not a generated project: ${project}`);
if (!fs.existsSync(sheet)) fail(`Role action sheet does not exist: ${sheet}`);

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
const layout = role === 'leader' ? ['poop_right', 'poop_left'] : ['eat_right', 'eat_left'];

const sheetMeta = await sharp(sheet).metadata();
if (!sheetMeta.width || !sheetMeta.height) fail('Could not read role action-sheet dimensions.');
const cellWidth = Math.floor(sheetMeta.width / 2);
if (cellWidth < 64 || sheetMeta.height < 64) fail('Role action sheet is too small for a 2x1 grid.');

const outputDir = path.join(project, 'src', 'assets', 'sprites', characterId);
fs.mkdirSync(outputDir, { recursive: true });
const report = [];

for (let index = 0; index < layout.length; index += 1) {
  const width = index === 1 ? sheetMeta.width - cellWidth : cellWidth;
  const extracted = await sharp(sheet)
    .extract({ left: index * cellWidth, top: 0, width, height: sheetMeta.height })
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

  const cropped = await sharp(cleaned, { raw: { width: extracted.info.width, height: extracted.info.height, channels: 4 } })
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
  report.push({ action: layout[index], key: `#${key.map((part) => part.toString(16).padStart(2, '0')).join('')}`, coverage: bounds.coverage });
}

const manifestEntry = manifest.characters.find((character) => character.id === characterId);
manifestEntry.frames ||= {};
for (const action of layout) manifestEntry.frames[action] = [`${characterId}/${action}.png`];
manifest.spriteSize = spriteSize;
writeJson(manifestPath, manifest);
writeJson(path.join(outputDir, 'role-processing-report.json'), { characterId, role, sheet, spriteSize, cells: report });

console.log(`Processed ${characterId} ${role} role actions: ${outputDir}`);
