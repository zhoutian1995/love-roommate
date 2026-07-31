import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fail, parseArgs, readJson, slugify, writeJson } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.name || !args.out || !args.people || !args.source || !args.mode || !args.self) {
  fail('Usage: node create_project.mjs --name "App Name" --out <output-root> --source <photo> --people <1-8> --mode <normal|centipede|poop-relay|all> --self <none|person-N> [--names "A,B"] [--leader person-N --followers "person-N,person-N"]');
}

const people = Number.parseInt(args.people, 10);
if (!Number.isInteger(people) || people < 1 || people > 8) fail('--people must be an integer from 1 to 8.');
const source = path.resolve(args.source);
if (!fs.existsSync(source) || !fs.statSync(source).isFile()) fail(`Source photo does not exist: ${source}`);
const mode = String(args.mode);
if (!['normal', 'centipede', 'poop-relay', 'all'].includes(mode)) fail('--mode must be normal, centipede, poop-relay, or all.');

const outputRoot = path.resolve(args.out);
if (fs.existsSync(outputRoot)) fail(`Refusing to overwrite existing output: ${outputRoot}`);

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = path.join(skillRoot, 'assets', 'electron-template');
const project = path.join(outputRoot, 'project');
const release = path.join(outputRoot, 'release');
const preview = path.join(outputRoot, 'preview');

fs.mkdirSync(outputRoot, { recursive: false });
fs.cpSync(template, project, { recursive: true, errorOnExist: true });
fs.mkdirSync(release, { recursive: true });
fs.mkdirSync(path.join(preview, 'sources'), { recursive: true });
writeJson(path.join(preview, 'generation-manifest.json'), {
  schemaVersion: 1,
  requiredModel: 'gpt-image-2',
  assets: []
});

const names = String(args.names || '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const hues = [0, 34, 72, 118, 168, 216, 270, 318];
const characters = Array.from({ length: people }, (_, index) => ({
  id: `person-${index + 1}`,
  displayName: names[index] || `人物 ${index + 1}`,
  hueRotate: hues[index]
}));
const ids = characters.map((character) => character.id);
const userCharacterId = args.self === 'none' ? null : String(args.self);
if (userCharacterId && !ids.includes(userCharacterId)) fail('--self must be none or one of the generated person-N ids.');
const poopRelayEnabled = mode === 'poop-relay' || mode === 'all';
const poopLeader = args.leader ? String(args.leader) : null;
const poopFollowers = String(args.followers || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
if (poopRelayEnabled) {
  if (people < 2) fail('poop-relay mode requires at least two people.');
  if (!ids.includes(poopLeader)) fail('--leader must identify one generated character when poop-relay is enabled.');
  if (!poopFollowers.length) fail('--followers must contain at least one ordered character when poop-relay is enabled.');
  if (new Set(poopFollowers).size !== poopFollowers.length) fail('--followers must not contain duplicates.');
  if (poopFollowers.includes(poopLeader)) fail('The poop-relay leader cannot also be a follower.');
  for (const id of poopFollowers) if (!ids.includes(id)) fail(`Unknown poop-relay follower: ${id}`);
}

const slug = slugify(args.name);
const appId = `com.codex.${slug.replaceAll('-', '.')}`;
const configPath = path.join(project, 'src', 'config', 'pet.config.json');
const config = readJson(configPath);
config.app = { name: args.name, id: appId, version: '1.0.0' };
config.characters = characters;
config.selection = { mode, userCharacterId };
writeJson(configPath, config);

const behaviorsPath = path.join(project, 'src', 'config', 'behaviors.json');
const behaviors = readJson(behaviorsPath);
behaviors.centipede.enabled = mode === 'centipede' || mode === 'all';
behaviors.poopChase.enabled = poopRelayEnabled;
behaviors.poopChase.leaderId = poopLeader || characters[0].id;
behaviors.poopChase.followerIds = poopRelayEnabled ? poopFollowers : [];
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
packageJson.description = `${args.name} desktop pet`;
packageJson.petBuild = { appId, productName: args.name };
writeJson(packagePath, packageJson);

writeJson(path.join(outputRoot, 'project-manifest.json'), {
  schemaVersion: 1,
  name: args.name,
  people,
  project,
  release,
  preview,
  selection: {
    mode,
    userCharacterId,
    leaderId: poopRelayEnabled ? poopLeader : null,
    followerIds: poopRelayEnabled ? poopFollowers : []
  },
  sourcePhoto: {
    sha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
    size: fs.statSync(source).size
  },
  createdAt: new Date().toISOString()
});

console.log(JSON.stringify({ outputRoot, project, release, preview, people }, null, 2));
