import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fail, parseArgs, readJson, slugify, writeJson } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.name || !args.out || !args.people || !args.source || !args.mode || !args.self || !args.consent) {
  fail('Usage: node create_project.mjs --name "App Name" --out <output-root> --source <photo> --people <1-8> --mode <normal|group-shout|poop-chase|all> --self <none|person-N> --consent confirmed [--names "A,B"]');
}
for (const deprecated of ['prank-excluded', 'leader', 'followers']) {
  if (args[deprecated] !== undefined) fail(`--${deprecated} is no longer accepted; prank roles are derived from --self and the selected mode.`);
}

const appName = String(args.name).trim();
if (!appName) fail('--name must contain a visible application name.');
if (args.consent !== 'confirmed') fail('--consent confirmed is required to attest that every depicted person authorized this use.');
const people = Number.parseInt(args.people, 10);
if (!Number.isInteger(people) || people < 1 || people > 8) fail('--people must be an integer from 1 to 8.');
const source = path.resolve(args.source);
if (!fs.existsSync(source) || !fs.statSync(source).isFile()) fail(`Source photo does not exist: ${source}`);
const mode = String(args.mode);
if (!['normal', 'group-shout', 'poop-chase', 'all'].includes(mode)) fail('--mode must be normal, group-shout, poop-chase, or all.');

const names = String(args.names || '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const characters = Array.from({ length: people }, (_, index) => ({
  id: `person-${index + 1}`,
  displayName: names[index] || `人物 ${index + 1}`,
  hueRotate: 0
}));
const ids = characters.map((character) => character.id);
const userCharacterId = args.self === 'none' ? null : String(args.self);
if (userCharacterId && !ids.includes(userCharacterId)) fail('--self must be none or one of the generated person-N ids.');
const prankExcludedCharacterIds = userCharacterId ? [userCharacterId] : [];
const groupShoutSelected = mode === 'group-shout' || mode === 'all';
const chaseEnabled = mode === 'poop-chase' || mode === 'all';
const singletonSelf = people === 1 && userCharacterId === ids[0];
const groupShoutSkippedReason = groupShoutSelected && singletonSelf ? 'no-eligible-participants' : null;
const chaseSkippedReason = chaseEnabled && singletonSelf ? 'no-eligible-followers' : null;
const groupShoutEnabled = groupShoutSelected && !groupShoutSkippedReason;
const chaseVariant = chaseEnabled && !chaseSkippedReason ? (userCharacterId ? 'self-poop' : 'cursor-centipede') : null;
const poopLeader = chaseVariant === 'self-poop' ? userCharacterId : null;
const poopFollowers = poopLeader ? ids.filter((id) => id !== poopLeader) : [];

const outputRoot = path.resolve(args.out);
if (fs.existsSync(outputRoot)) fail(`Refusing to overwrite existing output: ${outputRoot}`);
const outputParent = path.dirname(outputRoot);
if (!fs.existsSync(outputParent) || !fs.statSync(outputParent).isDirectory()) fail(`Output parent does not exist: ${outputParent}`);

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = path.join(skillRoot, 'assets', 'electron-template');
const temporaryRoot = path.join(outputParent, `.${path.basename(outputRoot)}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
const project = path.join(temporaryRoot, 'project');
const release = path.join(temporaryRoot, 'release');
const preview = path.join(temporaryRoot, 'preview');
const slug = slugify(appName);
const appId = `com.codex.${slug.replaceAll('-', '.')}`;

try {
  fs.mkdirSync(temporaryRoot, { recursive: false });
  fs.cpSync(template, project, { recursive: true, errorOnExist: true });
  fs.mkdirSync(release, { recursive: true });
  fs.mkdirSync(path.join(preview, 'sources'), { recursive: true });
  writeJson(path.join(preview, 'generation-manifest.json'), {
    schemaVersion: 3,
    provenancePolicy: {
      generator: 'codex-imagegen',
      declaredModelPolicy: 'gpt-image-2',
      evidenceLevel: 'workflow-attested'
    },
    assets: []
  });

  const configPath = path.join(project, 'src', 'config', 'pet.config.json');
  const config = readJson(configPath);
  config.app = { name: appName, id: appId, version: '1.0.0' };
  config.characters = characters;
  config.selection = {
    mode,
    userCharacterId,
    prankExcludedCharacterIds,
    chaseVariant,
    groupShoutSkippedReason,
    chaseSkippedReason
  };
  writeJson(configPath, config);

  const behaviorsPath = path.join(project, 'src', 'config', 'behaviors.json');
  const behaviors = readJson(behaviorsPath);
  behaviors.groupShout = { ...behaviors.groupShout, enabled: groupShoutEnabled, skippedReason: groupShoutSkippedReason };
  behaviors.centipede.enabled = chaseVariant === 'cursor-centipede';
  behaviors.poopChase.enabled = chaseVariant === 'self-poop';
  behaviors.poopChase.leaderId = poopLeader;
  behaviors.poopChase.followerIds = poopFollowers;
  behaviors.poopChase.skippedReason = chaseSkippedReason;
  writeJson(behaviorsPath, behaviors);

  const manifestPath = path.join(project, 'src', 'assets', 'sprites', 'manifest.json');
  const manifest = readJson(manifestPath);
  const placeholder = manifest.characters[0];
  manifest.characters = characters.map((character) => ({
    id: character.id,
    frames: structuredClone(placeholder.frames),
    anchors: structuredClone(placeholder.anchors)
  }));
  writeJson(manifestPath, manifest);

  const packagePath = path.join(project, 'package.json');
  const packageJson = readJson(packagePath);
  packageJson.name = slug;
  packageJson.description = `${appName} desktop pet`;
  packageJson.petBuild = { appId, productName: appName };
  writeJson(packagePath, packageJson);

  writeJson(path.join(temporaryRoot, 'project-manifest.json'), {
    schemaVersion: 2,
    name: appName,
    people,
    paths: { project: 'project', release: 'release', preview: 'preview' },
    selection: {
      mode,
      userCharacterId,
      prankExcludedCharacterIds,
      chaseVariant,
      groupShoutSkippedReason,
      chaseSkippedReason,
      leaderId: poopLeader,
      followerIds: poopFollowers
    },
    consent: { allSubjectsAuthorized: true }
  });
  fs.renameSync(temporaryRoot, outputRoot);
} catch (error) {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  fail(`Project creation failed without leaving a partial output: ${error.message}`);
}

console.log(JSON.stringify({
  outputRoot,
  project: path.join(outputRoot, 'project'),
  release: path.join(outputRoot, 'release'),
  preview: path.join(outputRoot, 'preview'),
  people
}, null, 2));
