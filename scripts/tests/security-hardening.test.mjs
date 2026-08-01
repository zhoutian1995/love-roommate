import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scripts = path.join(skillRoot, 'scripts');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngFixture(label) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from(label, 'utf8')]);
}

function run(script, args) {
  return spawnSync(process.execPath, [path.join(scripts, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env }
  });
}

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createArgs(root, overrides = {}) {
  const source = path.join(root, 'source.jpg');
  if (!fs.existsSync(source)) fs.writeFileSync(source, 'synthetic source fixture', 'utf8');
  const values = {
    name: 'Test Roommate',
    out: path.join(root, 'output'),
    source,
    people: '3',
    mode: 'all',
    self: 'person-2',
    consent: 'confirmed',
    leader: 'person-1',
    followers: 'person-2,person-3',
    ...overrides
  };
  return Object.entries(values).flatMap(([key, value]) => value === null ? [] : [`--${key}`, value]);
}

function createAuditFixture(root, spriteBytes = pngFixture('generated sprite')) {
  const sprites = path.join(root, 'project', 'src', 'assets', 'sprites');
  const sprite = path.join(sprites, 'person-1', 'idle.png');
  fs.mkdirSync(path.dirname(sprite), { recursive: true });
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
  fs.writeFileSync(path.join(root, 'project-manifest.json'), JSON.stringify({
    schemaVersion: 2,
    paths: { project: 'project', release: 'release', preview: 'preview' },
    consent: { allSubjectsAuthorized: true }
  }, null, 2));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    characters: [{ id: 'person-1', frames: { idle: ['person-1/idle.png'] } }]
  }, null, 2));
  fs.writeFileSync(sprite, spriteBytes);
  return { sprite };
}

test('project creation validates consent and participants before writing output', (t) => {
  const cases = [
    { consent: null },
    { self: 'person-9' },
    { leader: 'person-9' },
    { followers: 'person-2,person-2' },
    { followers: 'person-2,person-9' }
  ];
  for (const [index, overrides] of cases.entries()) {
    const root = workspace(t);
    const output = path.join(root, 'output');
    const result = run('create_project.mjs', createArgs(root, { ...overrides, out: output }));
    assert.notEqual(result.status, 0, `case ${index} unexpectedly succeeded`);
    assert.equal(fs.existsSync(output), false, `case ${index} left a partial output`);
    assert.deepEqual(fs.readdirSync(root).filter((name) => name.includes('.tmp-')), []);
  }
});

test('project creation writes a strict relative Manifest V2', (t) => {
  const root = workspace(t);
  const output = path.join(root, 'output');
  const result = run('create_project.mjs', createArgs(root, { out: output }));
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'project-manifest.json'), 'utf8'));
  assert.deepEqual(manifest, {
    schemaVersion: 2,
    name: 'Test Roommate',
    people: 3,
    paths: { project: 'project', release: 'release', preview: 'preview' },
    selection: {
      mode: 'all',
      userCharacterId: 'person-2',
      leaderId: 'person-1',
      followerIds: ['person-2', 'person-3']
    },
    consent: { allSubjectsAuthorized: true }
  });
  const text = fs.readFileSync(path.join(output, 'project-manifest.json'), 'utf8');
  assert.doesNotMatch(text, /sourcePhoto|createdAt|sha256|[A-Za-z]:[\\/]/);
});

test('image records use fixed workflow attestation and reject --model', (t) => {
  const root = workspace(t);
  const preview = path.join(root, 'preview');
  const file = path.join(preview, 'sources', 'identity.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'synthetic image bytes', 'utf8');
  const rejected = run('record_image_generation.mjs', [
    '--preview', preview, '--file', file, '--kind', 'identity', '--model', 'gpt-image-2'
  ]);
  assert.notEqual(rejected.status, 0);
  const accepted = run('record_image_generation.mjs', [
    '--preview', preview, '--file', file, '--kind', 'identity'
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(preview, 'generation-manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(manifest.provenancePolicy, {
    generator: 'codex-imagegen',
    declaredModelPolicy: 'gpt-image-2',
    evidenceLevel: 'workflow-attested'
  });
  assert.equal(manifest.assets[0].file, 'preview/sources/identity.png');
  assert.equal(Object.hasOwn(manifest.assets[0], 'model'), false);
});

test('V1 migration is explicit, redacts paths, and preserves dry-run behavior', (t) => {
  const root = workspace(t);
  const project = path.join(root, 'project');
  const preview = path.join(root, 'preview');
  const source = path.join(preview, 'sources', 'identity.png');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'synthetic image bytes', 'utf8');
  fs.writeFileSync(path.join(root, 'project-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    name: 'Legacy',
    people: 1,
    project,
    release: path.join(root, 'release'),
    preview,
    sourcePhoto: { path: 'C:\\Users\\private\\roommates.jpg', sha256: 'secret', size: 123 },
    createdAt: '2026-01-01T00:00:00.000Z',
    selection: { mode: 'normal', userCharacterId: null, leaderId: null, followerIds: [] }
  }, null, 2));
  fs.writeFileSync(path.join(preview, 'generation-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    requiredModel: 'gpt-image-2',
    assets: [{ key: 'identity::', kind: 'identity', file: source, sha256: 'abc' }]
  }, null, 2));
  fs.writeFileSync(path.join(preview, 'legacy-report.md'), `Host path: ${project}\n`, 'utf8');

  const dryRun = run('migrate_project_manifest.mjs', ['--root', root, '--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8')).schemaVersion, 1);

  const applyWithoutConsent = run('migrate_project_manifest.mjs', ['--root', root, '--apply']);
  assert.notEqual(applyWithoutConsent.status, 0);
  const applied = run('migrate_project_manifest.mjs', ['--root', root, '--apply', '--consent', 'confirmed']);
  assert.equal(applied.status, 0, applied.stderr);
  const migrated = JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8'));
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.consent.allSubjectsAuthorized, true);
  assert.equal(Object.hasOwn(migrated, 'sourcePhoto'), false);
  const generation = JSON.parse(fs.readFileSync(path.join(preview, 'generation-manifest.json'), 'utf8'));
  assert.equal(generation.assets[0].file, 'preview/sources/identity.png');
  assert.doesNotMatch(fs.readFileSync(path.join(preview, 'legacy-report.md'), 'utf8'), /[A-Za-z]:[\\/]/);
});

test('output privacy audit rejects host paths and unlisted raster files', (t) => {
  const root = workspace(t);
  const sprites = path.join(root, 'project', 'src', 'assets', 'sprites');
  fs.mkdirSync(sprites, { recursive: true });
  fs.writeFileSync(path.join(root, 'project-manifest.json'), JSON.stringify({
    schemaVersion: 2,
    paths: { project: 'project', release: 'release', preview: 'preview' },
    consent: { allSubjectsAuthorized: true }
  }, null, 2));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({ schemaVersion: 1, characters: [] }, null, 2));
  fs.writeFileSync(path.join(root, 'project', 'leak.json'), JSON.stringify({ path: 'C:\\Users\\private\\photo.png' }));
  fs.writeFileSync(path.join(root, 'project', 'unexpected.png'), 'synthetic bytes');
  fs.writeFileSync(path.join(root, 'project', 'unexpected.avif'), 'synthetic avif bytes');
  fs.writeFileSync(path.join(root, 'project', 'renamed-image.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const result = run('audit_output_privacy.mjs', ['--root', root]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected\.avif/);
  assert.match(result.stderr, /renamed-image\.bin/);
});

test('output privacy audit accepts escaped relative Windows paths but rejects real UNC paths', (t) => {
  const root = workspace(t);
  const sprites = path.join(root, 'project', 'src', 'assets', 'sprites');
  fs.mkdirSync(sprites, { recursive: true });
  fs.writeFileSync(path.join(root, 'project-manifest.json'), JSON.stringify({
    schemaVersion: 2,
    paths: { project: 'project', release: 'release', preview: 'preview' },
    consent: { allSubjectsAuthorized: true }
  }, null, 2));
  fs.writeFileSync(path.join(sprites, 'manifest.json'), JSON.stringify({ schemaVersion: 1, characters: [] }, null, 2));
  const runtimeConfig = path.join(root, 'release', 'windows', 'vk_swiftshader_icd.json');
  fs.mkdirSync(path.dirname(runtimeConfig), { recursive: true });
  fs.writeFileSync(runtimeConfig, JSON.stringify({ ICD: { library_path: '.\\vk_swiftshader.dll' } }));

  const accepted = run('audit_output_privacy.mjs', ['--root', root]);
  assert.equal(accepted.status, 0, accepted.stderr);

  const errorLog = path.join(root, 'preview', 'runtime-smoke-error.txt');
  fs.mkdirSync(path.dirname(errorLog), { recursive: true });
  fs.writeFileSync(errorLog, 'Capture failed at C:\\Users\\private\\source.png\n');
  const rejectedLog = run('audit_output_privacy.mjs', ['--root', root]);
  assert.notEqual(rejectedLog.status, 0);
  assert.match(rejectedLog.stderr, /absolute\/private path/);
  fs.rmSync(errorLog);

  fs.writeFileSync(runtimeConfig, JSON.stringify({ ICD: { library_path: '\\\\server\\share\\vk_swiftshader.dll' } }));
  const rejected = run('audit_output_privacy.mjs', ['--root', root]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /absolute\/private path/);
});

test('output privacy audit rejects exact source copies in project, release, and preview', (t) => {
  const workspaceRoot = workspace(t);
  const root = path.join(workspaceRoot, 'output');
  const source = path.join(workspaceRoot, 'source.png');
  const sourceBytes = pngFixture('original source');
  fs.writeFileSync(source, sourceBytes);
  const { sprite } = createAuditFixture(root);
  const targets = [
    sprite,
    path.join(root, 'release', 'source.png'),
    path.join(root, 'preview', 'source.png')
  ];

  for (const target of targets) {
    fs.writeFileSync(target, sourceBytes);
    const result = run('audit_output_privacy.mjs', ['--root', root, '--source', source]);
    assert.notEqual(result.status, 0, `${path.relative(root, target)} unexpectedly passed`);
    assert.match(result.stderr, /Original source photo was copied into output/);
    if (target === sprite) fs.writeFileSync(target, pngFixture('generated sprite'));
    else fs.rmSync(target);
  }
});

test('output privacy audit allows generated sprites and same-name images with different content', (t) => {
  const workspaceRoot = workspace(t);
  const root = path.join(workspaceRoot, 'output');
  const source = path.join(workspaceRoot, 'source.png');
  fs.writeFileSync(source, pngFixture('original source'));
  createAuditFixture(root, pngFixture('generated sprite'));
  fs.writeFileSync(path.join(root, 'release', 'source.png'), pngFixture('different generated image'));

  const result = run('audit_output_privacy.mjs', ['--root', root, '--source', source]);
  assert.equal(result.status, 0, result.stderr);
});

test('output privacy audit resolves symlinks before source comparison', (t) => {
  const workspaceRoot = workspace(t);
  const root = path.join(workspaceRoot, 'output');
  const source = path.join(workspaceRoot, 'source-assets', 'source.png');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, pngFixture('original source'));
  createAuditFixture(root);
  let link = path.join(root, 'preview', 'linked-source.png');
  try {
    fs.symlinkSync(source, link, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      link = path.join(root, 'preview', 'linked-source');
      try {
        fs.symlinkSync(path.dirname(source), link, 'junction');
      } catch (junctionError) {
        t.skip(`Symlink and junction creation are unavailable: ${junctionError.code || error.code}`);
        return;
      }
    } else {
      throw error;
    }
  }

  const result = run('audit_output_privacy.mjs', ['--root', root, '--source', source]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /preview\/linked-source/);
  assert.doesNotMatch(result.stderr, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
