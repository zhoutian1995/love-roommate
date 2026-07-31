import fs from 'node:fs';
import path from 'node:path';
import { applyCodexRuntimeArgs, escapeXml, fail, loadSharp, parseArgs, readJson } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
applyCodexRuntimeArgs(args);
if (!args.project || !args.out) fail('Usage: node make_contact_sheet.mjs --project <project> --out <contact-sheet.png>');
const project = path.resolve(args.project);
const output = path.resolve(args.out);
const config = readJson(path.join(project, 'src', 'config', 'pet.config.json'));
const manifest = readJson(path.join(project, 'src', 'assets', 'sprites', 'manifest.json'));
const sharp = loadSharp(project);
sharp.cache(false);

const baseColumns = [
  ['右爬 A', 'crawl_right', 0], ['右爬 B', 'crawl_right', 1],
  ['左爬 A', 'crawl_left', 0], ['左爬 B', 'crawl_left', 1],
  ['右待机', 'idle_right', 0], ['左待机', 'idle_left', 0],
  ['蜈蚣右', 'centipede_right', 0], ['蜈蚣左', 'centipede_left', 0],
  ['喊上', 'shout', 0], ['喊下', 'shout', 1], ['挥手', 'shout', 2], ['拖动', 'drag', 0]
];
const roleColumns = [
  ['拉屎右', 'poop_right', 0], ['拉屎左', 'poop_left', 0],
  ['吞食右', 'eat_right', 0], ['吞食左', 'eat_left', 0]
];
const hasRoleFrames = manifest.characters.some((entry) => roleColumns.some(([, group]) => entry.frames?.[group]?.length));
const columns = hasRoleFrames ? [...baseColumns, ...roleColumns] : baseColumns;
const labels = columns.map(([label]) => label);
function frameList(entry) {
  return columns.map(([, group, index]) => entry.frames?.[group]?.[index] || entry.frames?.[group]?.[0] || null);
}

const cellWidth = 128;
const cellHeight = 140;
const width = labels.length * cellWidth;
const height = config.characters.length * cellHeight;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#f4f3f5"/><rect width="8" height="8" fill="#dedce2"/><rect x="8" y="8" width="8" height="8" fill="#dedce2"/></pattern></defs><rect width="100%" height="100%" fill="#22202a"/>`;
for (let row = 0; row < config.characters.length; row += 1) {
  for (let column = 0; column < labels.length; column += 1) {
    const x = column * cellWidth + 3;
    const y = row * cellHeight + 3;
    svg += `<rect x="${x}" y="${y}" width="122" height="134" rx="8" fill="url(#checker)" stroke="#625e6b"/>`;
    svg += `<text x="${x + 7}" y="${y + 16}" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#2b2731">${escapeXml(labels[column])}</text>`;
    if (column === 0) svg += `<text x="${x + 7}" y="${y + 130}" font-family="Arial, sans-serif" font-size="11" fill="#2b2731">${escapeXml(config.characters[row].displayName)}</text>`;
  }
}
svg += '</svg>';

const composites = [];
for (let row = 0; row < config.characters.length; row += 1) {
  const entry = manifest.characters.find((item) => item.id === config.characters[row].id);
  if (!entry) fail(`Manifest is missing ${config.characters[row].id}.`);
  const frames = frameList(entry);
  for (let column = 0; column < frames.length; column += 1) {
    if (!frames[column]) continue;
    const framePath = path.join(project, 'src', 'assets', 'sprites', frames[column]);
    if (!fs.existsSync(framePath)) fail(`Missing sprite: ${framePath}`);
    const image = await sharp(framePath).resize(108, 104, { fit: 'contain' }).png().toBuffer();
    composites.push({ input: image, left: column * cellWidth + 10, top: row * cellHeight + 24 });
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
await sharp(Buffer.from(svg)).composite(composites).png({ compressionLevel: 9 }).toFile(output);
console.log(`Contact sheet: ${output}`);
