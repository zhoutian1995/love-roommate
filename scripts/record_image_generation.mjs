import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail, parseArgs, readJson, writeJson } from './lib/common.mjs';
import { portableRelative } from './lib/privacy.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.preview || !args.file || !args.kind) {
  fail('Usage: node record_image_generation.mjs --preview <preview-dir> --file <image> --kind identity|base|role [--character person-1] [--role leader|follower]');
}
if (Object.hasOwn(args, 'model')) fail('--model is no longer accepted. The Skill records a fixed workflow attestation because local PNG files do not contain verifiable model metadata.');
if (!['identity', 'base', 'role'].includes(args.kind)) fail('--kind must be identity, base, or role.');
if (args.kind !== 'identity' && !args.character) fail('--character is required for base and role assets.');
if (args.kind === 'identity' && (args.character || args.role)) fail('identity records must not include --character or --role.');
if (args.kind === 'base' && args.role) fail('base records must not include --role.');
if (args.kind === 'role' && !['leader', 'follower'].includes(args.role)) fail('--role must be leader or follower for role assets.');

const preview = path.resolve(args.preview);
const outputRoot = path.dirname(preview);
const file = path.resolve(args.file);
if (!fs.existsSync(file)) fail(`Generated image does not exist: ${file}`);
if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(file).toLowerCase())) fail('Generated image must be PNG, JPEG, or WebP.');
let relative;
try {
  relative = portableRelative(outputRoot, file, 'Generated image');
} catch (error) {
  fail(error.message);
}
if (!relative.startsWith('preview/')) fail('Generated image must be stored inside the preview directory.');

const manifestPath = path.join(preview, 'generation-manifest.json');
const manifest = fs.existsSync(manifestPath)
  ? readJson(manifestPath)
  : {
      schemaVersion: 2,
      provenancePolicy: {
        generator: 'codex-imagegen',
        declaredModelPolicy: 'gpt-image-2',
        evidenceLevel: 'workflow-attested'
      },
      assets: []
    };
const policy = manifest.provenancePolicy || {};
if (manifest.schemaVersion !== 2 || policy.generator !== 'codex-imagegen' || policy.declaredModelPolicy !== 'gpt-image-2' || policy.evidenceLevel !== 'workflow-attested' || !Array.isArray(manifest.assets)) {
  fail(`Invalid generation manifest: ${manifestPath}`);
}

const key = [args.kind, args.character || '', args.role || ''].join(':');
const entry = {
  key,
  kind: args.kind,
  characterId: args.character || null,
  role: args.role || null,
  generator: 'codex-imagegen',
  declaredModelPolicy: 'gpt-image-2',
  evidenceLevel: 'workflow-attested',
  file: relative,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
};
const index = manifest.assets.findIndex((item) => item.key === key);
if (index >= 0) manifest.assets[index] = entry;
else manifest.assets.push(entry);
writeJson(manifestPath, manifest);
console.log(JSON.stringify(entry, null, 2));
