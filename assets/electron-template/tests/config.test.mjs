import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'src/config/pet.config.json'), 'utf8'));
const behaviors = JSON.parse(fs.readFileSync(path.join(root, 'src/config/behaviors.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/sprites/manifest.json'), 'utf8'));

test('default template uses the Love Roommate brand', () => {
  const expectedSlug = config.app.name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'love-roommate';
  assert.equal(packageJson.name, expectedSlug);
  assert.equal(packageJson.petBuild.productName, config.app.name);
  assert.equal(packageJson.petBuild.appId, config.app.id);
  assert.match(config.app.id, /^com\.codex\.[a-z0-9.-]+$/);
});

test('public configuration stays inside v1 contract', () => {
  assert.equal(config.schemaVersion, 1);
  assert.equal(behaviors.schemaVersion, 1);
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(config.characters.length >= 1 && config.characters.length <= 8);
  assert.ok(['normal', 'centipede', 'poop-relay', 'all'].includes(config.selection.mode));
  const ids = config.characters.map((character) => character.id);
  assert.ok(config.selection.userCharacterId === null || ids.includes(config.selection.userCharacterId));
  assert.equal(config.packaging.windowsTarget, 'portable');
  assert.equal(config.packaging.macTarget, 'dir');
  assert.equal(config.packaging.macArch, 'arm64');
  assert.ok(config.render.spriteSize >= 72 && config.render.spriteSize <= 160);
  assert.ok(config.render.effectSize >= 16 && config.render.effectSize <= 48);
  assert.equal(behaviors.hotkeys.poopChase, 'CommandOrControl+Alt+E');
  assert.equal(typeof behaviors.poopChase.enabled, 'boolean');
  assert.equal(behaviors.poopChase.maxDroppings, 1);
  assert.ok(behaviors.poopChase.dropVisibleBeforeEatMs >= 0);
  assert.ok(behaviors.poopChase.roundResetDelayMs >= 0);
  assert.equal(behaviors.poopChase.enabled, ['poop-relay', 'all'].includes(config.selection.mode));
  assert.equal(behaviors.centipede.enabled, ['centipede', 'all'].includes(config.selection.mode));
});
