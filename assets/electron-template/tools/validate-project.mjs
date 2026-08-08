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
if (!['normal', 'group-shout', 'poop-chase', 'all'].includes(selection.mode)) errors.push('Invalid selected mode.');
if (selection.userCharacterId !== null && !ids.includes(selection.userCharacterId)) errors.push('Invalid selected user character.');
const prankExcludedIds = Array.isArray(selection.prankExcludedCharacterIds) ? selection.prankExcludedCharacterIds : [];
if (!Array.isArray(selection.prankExcludedCharacterIds)) errors.push('Invalid prank-excluded character list.');
if (new Set(prankExcludedIds).size !== prankExcludedIds.length || prankExcludedIds.some((id) => !ids.includes(id))) errors.push('Prank-excluded characters must be unique configured characters.');
const expectedPrankExcludedIds = selection.userCharacterId ? [selection.userCharacterId] : [];
if (JSON.stringify(prankExcludedIds) !== JSON.stringify(expectedPrankExcludedIds)) {
  errors.push('Prank-excluded characters must contain only the selected self, or be empty when the user is not depicted.');
}
if (!behaviors.hotkeys?.poopChase) errors.push('Missing poop-chase hotkey.');
const singletonSelf = ids.length === 1 && selection.userCharacterId === ids[0];
const groupShoutSelected = selection.mode === 'group-shout' || selection.mode === 'all';
const expectedGroupShoutSkippedReason = groupShoutSelected && singletonSelf ? 'no-eligible-participants' : null;
const groupShoutEnabled = groupShoutSelected && !expectedGroupShoutSkippedReason;
if ((selection.groupShoutSkippedReason ?? null) !== expectedGroupShoutSkippedReason) errors.push('Selected group-shout skippedReason does not match the mode and participant count.');
if (Boolean(behaviors.groupShout?.enabled) !== groupShoutEnabled) errors.push('Selected mode and group-shout configuration disagree.');
if ((behaviors.groupShout?.skippedReason ?? null) !== expectedGroupShoutSkippedReason) errors.push('groupShout skippedReason does not match the selected no-op state.');
const chaseEnabled = selection.mode === 'poop-chase' || selection.mode === 'all';
const expectedChaseSkippedReason = chaseEnabled && singletonSelf ? 'no-eligible-followers' : null;
const expectedChaseVariant = chaseEnabled && !expectedChaseSkippedReason ? (selection.userCharacterId ? 'self-poop' : 'cursor-centipede') : null;
if ((selection.chaseSkippedReason ?? null) !== expectedChaseSkippedReason) errors.push('Selected chase skippedReason does not match the mode and participant count.');
if ((selection.chaseVariant ?? null) !== expectedChaseVariant) errors.push('Selected mode, self, and chase variant disagree.');
const poopChase = behaviors.poopChase || {};
const poopFollowers = Array.isArray(poopChase.followerIds) ? poopChase.followerIds : [];
if (poopChase.enabled) {
  if (!ids.includes(poopChase.leaderId)) errors.push('Invalid poop-chase leader.');
  if (!poopFollowers.length || new Set(poopFollowers).size !== poopFollowers.length) errors.push('Invalid poop-chase follower order.');
  if (poopFollowers.includes(poopChase.leaderId) || poopFollowers.some((id) => !ids.includes(id))) errors.push('Poop-chase participants must be distinct configured characters.');
  if (poopChase.leaderId !== selection.userCharacterId) errors.push('Poop-chase leader must be the selected self and persistent poop source.');
  const expectedFollowers = ids.filter((id) => id !== selection.userCharacterId);
  if (JSON.stringify(poopFollowers) !== JSON.stringify(expectedFollowers)) {
    errors.push('Poop-chase followers must contain every other character in photo order.');
  }
}
if ((poopChase.skippedReason ?? null) !== expectedChaseSkippedReason) errors.push('poopChase skippedReason does not match the selected no-op state.');
if (expectedChaseSkippedReason && ((poopChase.leaderId ?? null) !== null || !Array.isArray(poopChase.followerIds) || poopChase.followerIds.length)) {
  errors.push('Skipped poopChase must keep leader null and followerIds explicitly empty.');
}
if ((expectedChaseVariant === 'self-poop') !== Boolean(poopChase.enabled)) errors.push('Selected chase variant and poop-chase configuration disagree.');
if ((expectedChaseVariant === 'cursor-centipede') !== Boolean(behaviors.centipede?.enabled)) errors.push('Selected cursor-centipede variant and centipede configuration disagree.');
if (poopChase.maxDroppings !== 1) errors.push('Poop relay must keep exactly one dropping.');

const baseGroups = [
  'crawl_right', 'crawl_left', 'idle_right', 'idle_left',
  'drag'
];
for (const id of ids) {
  const entry = manifest.characters.find((item) => item.id === id);
  if (!entry) { errors.push(`Missing manifest entry: ${id}`); continue; }
  const requiredGroups = [...baseGroups];
  if (groupShoutEnabled && id !== selection.userCharacterId) requiredGroups.push('shout');
  if (expectedChaseVariant === 'cursor-centipede') requiredGroups.push('centipede_right', 'centipede_left');
  if (expectedChaseVariant === 'self-poop') {
    requiredGroups.push(...(id === selection.userCharacterId
      ? ['poop_right', 'poop_left']
      : ['eat_right', 'eat_left']));
  }
  for (const group of requiredGroups) {
    if (!entry.frames?.[group]?.length) errors.push(`Missing ${id} frame group: ${group}`);
  }
  for (const direction of ['right', 'left']) {
    for (const anchorName of ['head', 'mouth', 'rear']) {
      const point = entry.anchors?.[direction]?.[anchorName];
      if (!Array.isArray(point) || point.length !== 2 || point.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
        errors.push(`${id} has invalid ${direction} ${anchorName} anchor.`);
      }
    }
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
