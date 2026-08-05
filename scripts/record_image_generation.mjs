import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyCodexRuntimeArgs, fail, loadSharp, parseArgs, readJson, writeJson } from './lib/common.mjs';
import { portableRelative } from './lib/privacy.mjs';

const args = parseArgs(process.argv.slice(2));
applyCodexRuntimeArgs(args);
if (!args.preview || !args.file || !args.kind) {
  fail('Usage: node record_image_generation.mjs --preview <preview-dir> --file <image> --kind identity|master|action|base|role [--character person-1] [--action <name>] [--role leader|follower] [--master-fingerprint <sha256>] [--prompt-version v1] [--version 1] [--image-generation-id ig_<50-hex>] [--origin generated|derived] [--derived-from-action <name> --transform horizontal-flip] [--supersedes <relative-file>] [--reason <text>]');
}
if (Object.hasOwn(args, 'model')) fail('--model is no longer accepted. The Skill records a fixed workflow attestation because local PNG files do not contain verifiable model metadata.');
if (!['identity', 'master', 'action', 'base', 'role'].includes(args.kind)) fail('--kind must be identity, master, action, base, or role.');
if (args.kind !== 'identity' && !args.character) fail('--character is required for non-identity assets.');
if (args.kind === 'identity' && (args.character || args.role)) fail('identity records must not include --character or --role.');
if (args.kind === 'base' && args.role) fail('base records must not include --role.');
if (args.kind === 'role' && !['leader', 'follower'].includes(args.role)) fail('--role must be leader or follower for role assets.');
if (args.kind === 'master' && (args.role || args.action)) fail('master records cannot include role or action.');
if (args.kind === 'action' && !args.action) fail('--action is required for action assets.');
const origin = args.origin || 'generated';
if (!['generated', 'derived'].includes(origin)) fail('--origin must be generated or derived.');
if (origin === 'derived' && args.kind !== 'action') fail('Only action assets may use --origin derived.');
if (args.kind === 'action' && origin === 'generated' && (!args['master-fingerprint'] || !args['prompt-version'] || !args.version)) fail('generated action records require --master-fingerprint, --prompt-version, and --version.');
if (args['image-generation-id'] && (args.kind !== 'action' || origin !== 'generated')) fail('--image-generation-id is accepted only for generated action records.');
if (args['image-generation-id'] && !/^ig_[0-9a-f]{50}$/i.test(String(args['image-generation-id']))) fail('--image-generation-id must be an image generation id in the form ig_<50-hex>.');
if (args.kind === 'action' && origin === 'derived' && (!args['derived-from-action'] || args.transform !== 'horizontal-flip' || !args.version)) fail('derived action records require --derived-from-action, --transform horizontal-flip, and --version.');
if (origin === 'derived' && (args['master-fingerprint'] || args['prompt-version'] || args.model)) fail('derived action records must not include native generation attestation arguments.');
if (args.kind === 'master' && (!args['prompt-version'] || !args.version)) fail('master records require --prompt-version and --version.');
const allowedActions = new Set([
  'crawl_right_1', 'crawl_right_2', 'crawl_left_1', 'crawl_left_2',
  'idle_right', 'idle_left', 'centipede_right', 'centipede_left',
  'kneel_shout_1', 'kneel_shout_2', 'kneel_shout_3', 'drag',
  'poop_right', 'poop_left', 'eat_right', 'eat_left'
]);
const horizontalFlipPairs = new Map([
  ['crawl_right_1', 'crawl_left_1'], ['crawl_left_1', 'crawl_right_1'],
  ['crawl_right_2', 'crawl_left_2'], ['crawl_left_2', 'crawl_right_2'],
  ['idle_right', 'idle_left'], ['idle_left', 'idle_right'],
  ['centipede_right', 'centipede_left'], ['centipede_left', 'centipede_right'],
  ['poop_right', 'poop_left'], ['poop_left', 'poop_right'],
  ['eat_right', 'eat_left'], ['eat_left', 'eat_right']
]);
if (args.kind === 'action' && !allowedActions.has(String(args.action))) fail(`Unsupported action: ${args.action}`);
const version = args.version ? Number(args.version) : null;
if (version !== null && (!Number.isInteger(version) || version < 1)) fail('--version must be a positive integer.');

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
const fileSha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const manifestPath = path.join(preview, 'generation-manifest.json');
const manifest = fs.existsSync(manifestPath)
  ? readJson(manifestPath)
  : {
      schemaVersion: 3,
      provenancePolicy: {
        generator: 'codex-imagegen',
        declaredModelPolicy: 'gpt-image-2',
        evidenceLevel: 'workflow-attested'
      },
      assets: []
    };
const policy = manifest.provenancePolicy || {};
if (![2, 3].includes(manifest.schemaVersion) || policy.generator !== 'codex-imagegen' || policy.declaredModelPolicy !== 'gpt-image-2' || policy.evidenceLevel !== 'workflow-attested' || !Array.isArray(manifest.assets)) {
  fail(`Invalid generation manifest: ${manifestPath}`);
}
if (manifest.schemaVersion === 2) {
  const safeLegacy = manifest.assets.every((item) => !item.origin && !item.sourceAction && !item.sourceFile && !item.sourceSha && !item.transform && !item.derivedSha);
  if (!safeLegacy) fail(`Schema v2 manifest contains unsupported derived lineage: ${manifestPath}`);
  manifest.schemaVersion = 3;
  manifest.assets = manifest.assets.map((item) => ({ ...item, origin: 'generated' }));
  if (Array.isArray(manifest.history)) manifest.history = manifest.history.map((item) => ({ ...item, origin: 'generated' }));
}

const key = [args.kind, args.character || '', args.role || '', args.action || ''].join(':');
const index = manifest.assets.findIndex((item) => item.key === key);
const previous = index >= 0 ? manifest.assets[index] : null;
const isImageGenerationIdAugmentation = Boolean(
  previous
  && args.kind === 'action'
  && origin === 'generated'
  && args['image-generation-id']
  && !Object.hasOwn(previous, 'imageGenerationId')
  && (previous.origin || 'generated') === 'generated'
  && previous.generator === 'codex-imagegen'
  && previous.declaredModelPolicy === 'gpt-image-2'
  && previous.evidenceLevel === 'workflow-attested'
  && version === previous.version
  && relative === previous.file
  && fileSha === previous.sha256
  && args['master-fingerprint'] === previous.masterFingerprint
  && args['prompt-version'] === previous.promptVersion
  && !args.supersedes
  && !args.reason
);
if (args.kind === 'master' || args.kind === 'action') {
  if (!previous && version !== 1) fail(`The first ${args.kind} record for ${key} must use --version 1.`);
  if (previous && !isImageGenerationIdAugmentation) {
    if (version !== previous.version + 1) fail(`Replacement version must increment from ${previous.version} to ${previous.version + 1}.`);
    if (!String(args.reason || '').trim() || !String(args.supersedes || '').trim()) fail('Replacement records require both --supersedes and --reason.');
    if (args.supersedes !== previous.file) fail(`--supersedes must match the current same-key file: ${previous.file}`);
    if (relative === previous.file) fail('Replacement records must use a distinct file so the superseded evidence remains intact.');
    const previousFile = path.resolve(outputRoot, previous.file);
    if (!fs.existsSync(previousFile) || !fs.statSync(previousFile).isFile()) fail(`Superseded file is missing: ${previous.file}`);
    const previousHash = crypto.createHash('sha256').update(fs.readFileSync(previousFile)).digest('hex');
    if (previousHash !== previous.sha256) fail(`Superseded file changed after its workflow attestation: ${previous.file}`);
  } else if (args.supersedes || args.reason) {
    fail('Initial version 1 records cannot include --supersedes or --reason.');
  }
}
let derivedSource = null;
if (args.kind === 'action' && origin === 'generated') {
  const master = manifest.assets.find((item) => item.kind === 'master' && item.characterId === args.character);
  if (!master || !/^[0-9a-f]{64}$/i.test(master.sha256 || '') || args['master-fingerprint'] !== master.sha256) {
    fail(`Action record must use the approved master fingerprint for ${args.character}.`);
  }
  const masterFile = path.resolve(outputRoot, master.file || '');
  let masterRelative;
  try {
    masterRelative = portableRelative(outputRoot, masterFile, 'Approved master');
  } catch (error) {
    fail(error.message);
  }
  if (!masterRelative.startsWith('preview/') || !fs.existsSync(masterFile) || !fs.statSync(masterFile).isFile()) {
    fail(`Approved master file is missing or unsafe for ${args.character}.`);
  }
  const currentMasterHash = crypto.createHash('sha256').update(fs.readFileSync(masterFile)).digest('hex');
  if (currentMasterHash !== master.sha256) fail(`Approved master file changed after its workflow attestation for ${args.character}.`);
}
if (isImageGenerationIdAugmentation) {
  manifest.history ||= [];
  if (!Array.isArray(manifest.history)) fail(`Invalid generation manifest history: ${manifestPath}`);
  const augmented = { ...previous, imageGenerationId: String(args['image-generation-id']) };
  manifest.assets[index] = augmented;
  writeJson(manifestPath, manifest);
  console.log(JSON.stringify(augmented, null, 2));
  process.exit(0);
}
if (args.kind === 'action' && origin === 'derived') {
  const sourceAction = String(args['derived-from-action']);
  if (!allowedActions.has(sourceAction) || horizontalFlipPairs.get(sourceAction) !== args.action) {
    fail(`Invalid horizontal-flip action mapping: ${sourceAction} -> ${args.action}.`);
  }
  derivedSource = manifest.assets.find((item) => item.kind === 'action' && item.characterId === args.character && item.action === sourceAction);
  if (!derivedSource) fail(`Derived action requires a recorded source action for the same character: ${sourceAction}.`);
  if ((derivedSource.origin || 'generated') !== 'generated') fail('Derived action chains are forbidden; the source must be a generated source action.');
  if (derivedSource.generator !== 'codex-imagegen' || derivedSource.declaredModelPolicy !== 'gpt-image-2' || derivedSource.evidenceLevel !== 'workflow-attested') {
    fail('Derived action source is missing its native generation workflow attestation.');
  }
  const sourceFile = path.resolve(outputRoot, derivedSource.file || '');
  let sourceRelative;
  try {
    sourceRelative = portableRelative(outputRoot, sourceFile, 'Derived source action');
  } catch (error) {
    fail(error.message);
  }
  if (!sourceRelative.startsWith('preview/') || !fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) fail(`Derived source action is missing or unsafe: ${derivedSource.file || sourceAction}.`);
  const sourceSha = crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex');
  if (sourceSha !== derivedSource.sha256) fail(`Derived source action changed after its workflow attestation: ${derivedSource.file}.`);
  const sharp = loadSharp(outputRoot);
  const [sourceRaw, derivedRaw] = await Promise.all([
    sharp(sourceFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (sourceRaw.info.width !== derivedRaw.info.width || sourceRaw.info.height !== derivedRaw.info.height || sourceRaw.info.channels !== 4 || derivedRaw.info.channels !== 4) {
    fail('Derived horizontal-flip dimensions or channels do not match the source action.');
  }
  const width = sourceRaw.info.width;
  const height = sourceRaw.info.height;
  let matches = true;
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
  if (!matches) fail('Derived action pixels do not equal the deterministic horizontal-flip of the source action.');
}
const entry = {
  key,
  kind: args.kind,
  characterId: args.character || null,
  role: args.role || null,
  action: args.action || null,
  origin,
  masterFingerprint: origin === 'derived' ? derivedSource.masterFingerprint : (args['master-fingerprint'] || null),
  promptVersion: origin === 'generated' ? (args['prompt-version'] || null) : null,
  version,
  supersedes: args.supersedes || null,
  replacementReason: args.reason || null,
  file: relative,
  sha256: fileSha
};
if (origin === 'generated') Object.assign(entry, {
  ...(args['image-generation-id'] ? { imageGenerationId: String(args['image-generation-id']) } : {}),
  generator: 'codex-imagegen',
  declaredModelPolicy: 'gpt-image-2',
  evidenceLevel: 'workflow-attested'
});
else Object.assign(entry, {
  sourceAction: derivedSource.action,
  sourceFile: derivedSource.file,
  sourceSha: derivedSource.sha256,
  transform: 'horizontal-flip',
  derivedSha: fileSha
});
manifest.history ||= [];
if (!Array.isArray(manifest.history)) fail(`Invalid generation manifest history: ${manifestPath}`);
if (index >= 0) {
  manifest.history.push(previous);
  manifest.assets[index] = entry;
}
else manifest.assets.push(entry);
writeJson(manifestPath, manifest);
console.log(JSON.stringify(entry, null, 2));
