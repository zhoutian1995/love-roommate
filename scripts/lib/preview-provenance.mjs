import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function relativeInside(root, fromFile, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const resolved = path.resolve(path.dirname(fromFile), relativePath);
  const rel = path.relative(root, resolved);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? resolved : null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function lineagePathForAction(outputRoot, entry) {
  const actionFile = path.resolve(outputRoot, entry.file || '');
  return actionFile.replace(/\.png$/i, '-lineage.json');
}

function issue(code, message, details = {}) {
  return { severity: 'error', code, message, ...details };
}

export function validatePreviewProvenance({ outputRoot, preview, manifest }) {
  const issues = [];
  const masters = (manifest?.assets || []).filter((entry) => entry.kind === 'master');
  const actions = (manifest?.assets || []).filter((entry) => entry.kind === 'action');
  const lineageRoot = path.join(preview, 'generated-actions');

  for (const master of masters) {
    const lineageFile = path.join(lineageRoot, `${master.characterId}-master-lineage.json`);
    const lineage = fs.existsSync(lineageFile) ? readJson(lineageFile) : null;
    if (!lineage) {
      issues.push(issue('missing-master-provenance', `${master.characterId} is missing a readable master lineage sidecar.`, { characterId: master.characterId }));
      continue;
    }
    const source = relativeInside(preview, lineageFile, lineage.sourceFile);
    if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
      issues.push(issue('missing-master-source', `${master.characterId} master lineage source cannot be resolved inside preview/.`, { characterId: master.characterId, sourceFile: lineage.sourceFile || null }));
    } else if (hash(source) !== String(lineage.sourceSha256 || '').toLowerCase()) {
      issues.push(issue('stale-master-source', `${master.characterId} master source SHA-256 does not match its lineage.`, { characterId: master.characterId, sourceFile: lineage.sourceFile }));
    }
    if (lineage.transparentMasterSha256 !== master.sha256) {
      issues.push(issue('master-lineage-fingerprint-mismatch', `${master.characterId} lineage does not bind the current manifest master.`, { characterId: master.characterId }));
    }
    if (lineage.fixtureReplacement === true && (!String(lineage.replacementReason || '').trim() || lineage.identityContinuityClaim !== false)) {
      issues.push(issue('ambiguous-fixture-replacement', `${master.characterId} fictional fixture replacement must explicitly deny identity continuity and state a reason.`, { characterId: master.characterId }));
    }
  }

  for (const action of actions) {
    const lineageFile = lineagePathForAction(outputRoot, action);
    const lineage = fs.existsSync(lineageFile) ? readJson(lineageFile) : null;
    if (!lineage) {
      issues.push(issue('missing-action-provenance', `${action.characterId}:${action.action} is missing a readable action lineage sidecar.`, { characterId: action.characterId, action: action.action }));
      continue;
    }
    if (lineage.sha256 !== action.sha256) {
      issues.push(issue('action-lineage-fingerprint-mismatch', `${action.characterId}:${action.action} lineage does not bind the current manifest action.`, { characterId: action.characterId, action: action.action }));
    }
    if (action.origin === 'derived') {
      if (lineage.origin !== 'derived' || lineage.sourceAction !== action.sourceAction || lineage.transform !== action.transform) {
        issues.push(issue('invalid-derived-action-sidecar', `${action.characterId}:${action.action} sidecar does not describe the manifest derivation.`, { characterId: action.characterId, action: action.action }));
      }
      continue;
    }
    if (action.imageGenerationId) {
      const board = relativeInside(preview, lineageFile, lineage.boardSource);
      if (!board || !fs.existsSync(board) || !fs.statSync(board).isFile()) {
        issues.push(issue('missing-action-board-source', `${action.characterId}:${action.action} board source cannot be resolved inside preview/.`, { characterId: action.characterId, action: action.action, boardSource: lineage.boardSource || null }));
      }
      if (lineage.imageGenerationId !== action.imageGenerationId || lineage.action !== action.action) {
        issues.push(issue('action-generation-lineage-mismatch', `${action.characterId}:${action.action} sidecar does not bind its generation event.`, { characterId: action.characterId, action: action.action }));
      }
    } else {
      const source = relativeInside(preview, lineageFile, lineage.sourceFile);
      if (!source || !fs.existsSync(source) || hash(source) !== String(lineage.sourceSha256 || '').toLowerCase()) {
        issues.push(issue('missing-action-source', `${action.characterId}:${action.action} copied action source cannot be verified.`, { characterId: action.characterId, action: action.action }));
      }
    }
  }

  if (fs.existsSync(lineageRoot)) {
    for (const entry of fs.readdirSync(lineageRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('-generation.json')) continue;
      const sidecarFile = path.join(lineageRoot, entry.name);
      const sidecar = readJson(sidecarFile);
      if (!sidecar) {
        issues.push(issue('invalid-generation-sidecar', `${entry.name} is not valid JSON.`, { file: entry.name }));
        continue;
      }
      const source = relativeInside(preview, sidecarFile, sidecar.sourceFile);
      if (!source || !fs.existsSync(source) || hash(source) !== String(sidecar.sha256 || '').toLowerCase()) {
        issues.push(issue('unverified-generation-sidecar', `${entry.name} does not bind an existing source file and SHA-256.`, { file: entry.name }));
      } else if (sidecar.status !== 'completed') {
        issues.push(issue('unfinished-generation-sidecar', `${entry.name} still reports ${sidecar.status || 'no status'} despite verified output evidence.`, { file: entry.name, status: sidecar.status || null }));
      }
    }
  }

  return issues;
}
