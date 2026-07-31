import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const config = readJson('src/config/pet.config.json');
const behaviors = readJson('src/config/behaviors.json');
const manifest = readJson('src/assets/sprites/manifest.json');
const errors = [];

if (config.schemaVersion !== 1 || behaviors.schemaVersion !== 1 || manifest.schemaVersion !== 1) errors.push('Unsupported schemaVersion.');
if (!Array.isArray(config.characters) || config.characters.length < 1 || config.characters.length > 8) errors.push('Expected 1-8 characters.');
const ids = config.characters.map((item) => item.id);
if (new Set(ids).size !== ids.length) errors.push('Character ids must be unique.');
const selection = config.selection || {};
if (!['normal', 'centipede', 'poop-relay', 'all'].includes(selection.mode)) errors.push('Invalid selected mode.');
if (selection.userCharacterId !== null && !ids.includes(selection.userCharacterId)) errors.push('Invalid selected user character.');
if (!behaviors.hotkeys?.poopChase) errors.push('Missing poop-chase hotkey.');
const poopChase = behaviors.poopChase || {};
const poopFollowers = Array.isArray(poopChase.followerIds) ? poopChase.followerIds : [];
if (poopChase.enabled) {
  if (!ids.includes(poopChase.leaderId)) errors.push('Invalid poop-chase leader.');
  if (!poopFollowers.length || new Set(poopFollowers).size !== poopFollowers.length) errors.push('Invalid poop-chase follower order.');
  if (poopFollowers.includes(poopChase.leaderId) || poopFollowers.some((id) => !ids.includes(id))) errors.push('Poop-chase participants must be distinct configured characters.');
}
if ((selection.mode === 'poop-relay' || selection.mode === 'all') !== Boolean(poopChase.enabled)) errors.push('Selected mode and poop-chase configuration disagree.');
if ((selection.mode === 'centipede' || selection.mode === 'all') !== Boolean(behaviors.centipede?.enabled)) errors.push('Selected mode and centipede configuration disagree.');
if (poopChase.maxDroppings !== 1) errors.push('Poop relay must keep exactly one dropping.');

for (const id of ids) {
  const entry = manifest.characters.find((item) => item.id === id);
  if (!entry) { errors.push(`Missing manifest entry: ${id}`); continue; }
  const requiredRoleGroups = poopChase.enabled
    ? id === poopChase.leaderId ? ['poop_right', 'poop_left'] : poopFollowers.includes(id) ? ['eat_right', 'eat_left'] : []
    : [];
  for (const group of requiredRoleGroups) {
    if (!entry.frames?.[group]?.length) errors.push(`Missing ${id} role frame group: ${group}`);
  }
  for (const frames of Object.values(entry.frames || {})) {
    for (const relative of frames) {
      if (path.isAbsolute(relative) || relative.includes('..') || relative.includes(':')) errors.push(`Unsafe sprite path: ${relative}`);
      else if (!fs.existsSync(path.join(root, 'src', 'assets', 'sprites', relative))) errors.push(`Missing sprite: ${relative}`);
    }
  }
}

if (errors.length) {
  console.error(errors.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log(`Configuration valid: ${ids.length} character(s)`);
