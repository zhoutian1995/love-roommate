import fs from 'node:fs';
import path from 'node:path';
import { applyCodexRuntimeArgs, fail, loadSharp, parseArgs } from './lib/common.mjs';
import { cleanPortraitChromaEdges, parseHexColor } from './lib/sprite-processing.mjs';

const args = parseArgs(process.argv.slice(2));
applyCodexRuntimeArgs(args);
if (!args.input || !args.out) {
  fail('Usage: node cleanup_portrait_chroma.mjs --input <transparent.png> --out <clean.png> --pnpm <codex-pnpm> [--node-modules <path>]');
}
const input = path.resolve(args.input);
const output = path.resolve(args.out);
if (!fs.existsSync(input)) fail(`Input does not exist: ${input}`);
if (input === output) fail('Refusing to overwrite the input; use a versioned output file.');

const sharp = loadSharp(path.dirname(input));
sharp.cache(false);
const loaded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const key = parseHexColor(args.key || '#ff00ff');
const cleaned = cleanPortraitChromaEdges(loaded.data, loaded.info.width, loaded.info.height, key);
await sharp(cleaned, { raw: loaded.info }).png({ compressionLevel: 9 }).toFile(output);
console.log(JSON.stringify({
  input: path.basename(input),
  output: path.basename(output),
  key: `#${key.map((part) => part.toString(16).padStart(2, '0')).join('')}`
}, null, 2));
