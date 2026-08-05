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
const mainSource = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

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
  assert.ok(Array.isArray(config.selection.prankExcludedCharacterIds));
  assert.equal(new Set(config.selection.prankExcludedCharacterIds).size, config.selection.prankExcludedCharacterIds.length);
  assert.ok(config.selection.prankExcludedCharacterIds.every((id) => ids.includes(id)));
  if (config.selection.userCharacterId !== null) {
    assert.ok(config.selection.prankExcludedCharacterIds.includes(config.selection.userCharacterId));
  }
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

test('runtime manifest exposes one shout group without unused kneel action keys', () => {
  for (const character of manifest.characters) {
    assert.ok(Array.isArray(character.frames.shout) && character.frames.shout.length > 0);
    assert.equal(character.frames.kneel_shout_1, undefined);
    assert.equal(character.frames.kneel_shout_2, undefined);
    assert.equal(character.frames.kneel_shout_3, undefined);
  }
});

test('group shout configuration cannot select a random single dad', () => {
  assert.equal(behaviors.randomDad.groupChance, undefined);
  assert.equal(behaviors.randomDad.durationMs, undefined);
  assert.equal(behaviors.groupShout.gatherSpeed, 180);
  assert.ok(behaviors.groupShout.kneelDelayMs >= 300);
  assert.equal(behaviors.groupShout.frameDurationMs, 1400);
});

test('Electron scenario harness records the complete dad and grandpa phase sequence', () => {
  assert.match(mainSource, /dad-shout/);
  assert.match(mainSource, /grandpa-shout/);
  assert.match(mainSource, /shoutPhase/);
  assert.match(mainSource, /frame:\s*Number\(/);
  assert.match(mainSource, /phrase:\s*pet\.phrase/);
  assert.match(mainSource, /forming/);
  assert.match(mainSource, /kneeling/);
  assert.match(mainSource, /shouting/);
  assert.match(mainSource, /recipientId/);
  assert.match(mainSource, /participantIds/);
  assert.match(mainSource, /excludedIds/);
  assert.match(mainSource, /skippedReason/);
});

test('scenario compositions crop to a readable all-window bounding box', () => {
  assert.match(mainSource, /function scenarioCompositionBounds/);
  assert.match(mainSource, /const margin = 48/);
  assert.match(mainSource, /compositeScenarioImages\(compositeItems, scenarioCompositionBounds/);
});
test('Electron performance harness records process, memory, frame, and event-loop metrics', () => {
  assert.match(mainSource, /PET_PERFORMANCE_TEST/);
  assert.match(mainSource, /app\.getAppMetrics\(\)/);
  assert.match(mainSource, /monitorEventLoopDelay/);
  assert.match(mainSource, /runtimeFingerprintForProject/);
  assert.match(mainSource, /pauseComparison/);
  assert.doesNotMatch(mainSource, /\n\+\nfunction performanceDuration/);
});

test('generated project README documents measured performance controls', () => {
  const readmePath = path.join(root, 'README.md');
  assert.ok(fs.existsSync(readmePath));
  const readme = fs.readFileSync(readmePath, 'utf8');
  assert.match(readme, /30\s*fps/i);
  assert.match(readme, /private bytes/i);
  assert.match(readme, /Pause|暂停/i);
  assert.match(readme, /Quit|退出/i);
  assert.match(readme, /ticker[^\n]*(?:25%|0\.25)/i);
  assert.match(readme, /不承诺[^\n]*不卡顿/);
});
