import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validatePreviewProvenance } from '../lib/preview-provenance.mjs';

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fixture() {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-provenance-'));
  const preview = path.join(outputRoot, 'preview');
  const actions = path.join(preview, 'generated-actions');
  const sources = path.join(preview, 'sources');
  fs.mkdirSync(actions, { recursive: true });
  fs.mkdirSync(sources, { recursive: true });
  const source = path.join(sources, 'person-1-master-source.png');
  const master = path.join(actions, 'person-1-master.png');
  const board = path.join(actions, 'person-1-action-board-source.png');
  const action = path.join(actions, 'person-1-crawl_right_1.png');
  fs.writeFileSync(source, 'fictional-source');
  fs.writeFileSync(master, 'transparent-master');
  fs.writeFileSync(board, 'generated-board');
  fs.writeFileSync(action, 'action-frame');
  const manifest = {
    schemaVersion: 3,
    assets: [
      { kind: 'master', characterId: 'person-1', file: 'preview/generated-actions/person-1-master.png', sha256: sha(master) },
      { kind: 'action', characterId: 'person-1', action: 'crawl_right_1', origin: 'generated', file: 'preview/generated-actions/person-1-crawl_right_1.png', sha256: sha(action), imageGenerationId: 'ig_fixture' }
    ]
  };
  return { outputRoot, preview, actions, source, master, board, action, manifest };
}

test('rejects a master lineage whose relative source cannot be resolved', () => {
  const data = fixture();
  fs.writeFileSync(path.join(data.actions, 'person-1-master-lineage.json'), JSON.stringify({
    sourceFile: '../sources/missing.png',
    sourceSha256: sha(data.source),
    transparentMasterSha256: sha(data.master)
  }));
  fs.writeFileSync(path.join(data.actions, 'person-1-crawl_right_1-lineage.json'), JSON.stringify({
    imageGenerationId: 'ig_fixture',
    boardSource: 'person-1-action-board-source.png',
    action: 'crawl_right_1',
    sha256: sha(data.action)
  }));

  const issues = validatePreviewProvenance(data);
  assert.ok(issues.some((issue) => issue.code === 'missing-master-source'));
});

test('accepts an auditable fictional replacement and generated board lineage', () => {
  const data = fixture();
  fs.writeFileSync(path.join(data.actions, 'person-1-master-lineage.json'), JSON.stringify({
    sourceFile: '../sources/person-1-master-source.png',
    sourceSha256: sha(data.source),
    transparentMasterSha256: sha(data.master),
    fixtureReplacement: true,
    replacementReason: 'fictional fixture identity replacement; no continuity claim to the discarded source',
    identityContinuityClaim: false
  }));
  fs.writeFileSync(path.join(data.actions, 'person-1-crawl_right_1-lineage.json'), JSON.stringify({
    imageGenerationId: 'ig_fixture',
    boardSource: 'person-1-action-board-source.png',
    action: 'crawl_right_1',
    sha256: sha(data.action)
  }));

  assert.deepEqual(validatePreviewProvenance(data), []);
});
