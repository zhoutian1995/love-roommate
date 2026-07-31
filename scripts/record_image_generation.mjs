import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail, parseArgs, readJson, writeJson } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.preview || !args.file || !args.kind) {
  fail('Usage: node record_image_generation.mjs --preview <preview-dir> --file <image> --kind identity|base|role [--character person-1] [--role leader|follower] --model gpt-image-2');
}
if (args.model !== 'gpt-image-2') fail('Final generated artwork must use --model gpt-image-2.');
if (!['identity', 'base', 'role'].includes(args.kind)) fail('--kind must be identity, base, or role.');
if (args.kind !== 'identity' && !args.character) fail('--character is required for base and role assets.');
if (args.kind === 'role' && !['leader', 'follower'].includes(args.role)) fail('--role must be leader or follower for role assets.');

const preview = path.resolve(args.preview);
const file = path.resolve(args.file);
if (!fs.existsSync(file)) fail(`Generated image does not exist: ${file}`);
const relative = path.relative(preview, file);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('Generated image must be stored inside the preview directory.');

const manifestPath = path.join(preview, 'generation-manifest.json');
const manifest = fs.existsSync(manifestPath)
  ? readJson(manifestPath)
  : { schemaVersion: 1, requiredModel: 'gpt-image-2', assets: [] };
if (manifest.schemaVersion !== 1 || manifest.requiredModel !== 'gpt-image-2' || !Array.isArray(manifest.assets)) {
  fail(`Invalid generation manifest: ${manifestPath}`);
}

const key = [args.kind, args.character || '', args.role || ''].join(':');
const entry = {
  key,
  kind: args.kind,
  characterId: args.character || null,
  role: args.role || null,
  model: 'gpt-image-2',
  file: relative.replaceAll('\\', '/'),
  sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  recordedAt: new Date().toISOString()
};
const index = manifest.assets.findIndex((item) => item.key === key);
if (index >= 0) manifest.assets[index] = entry;
else manifest.assets.push(entry);
writeJson(manifestPath, manifest);
console.log(JSON.stringify(entry, null, 2));
