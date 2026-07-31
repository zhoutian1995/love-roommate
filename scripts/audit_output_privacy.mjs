import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail, parseArgs, readJson } from './lib/common.mjs';
import { auditTextFilesForSensitivePaths, isRasterFile, portableRelative, resolvePortable } from './lib/privacy.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.root) fail('Usage: node audit_output_privacy.mjs --root <output-root> [--source <original-photo>]');

const root = path.resolve(args.root);
const project = path.join(root, 'project');
const projectManifestPath = path.join(root, 'project-manifest.json');
const spriteManifestPath = path.join(project, 'src', 'assets', 'sprites', 'manifest.json');
const errors = [];
if (!fs.existsSync(projectManifestPath)) errors.push('project-manifest.json is missing.');
if (!fs.existsSync(spriteManifestPath)) errors.push('Sprite manifest is missing.');

if (!errors.length) {
  const projectManifest = readJson(projectManifestPath);
  if (projectManifest.schemaVersion !== 2) errors.push('Project manifest must use schemaVersion 2. Run migrate_project_manifest.mjs first.');
  if (projectManifest.consent?.allSubjectsAuthorized !== true) errors.push('Project manifest is missing the required consent attestation.');
  for (const [key, expected] of Object.entries({ project: 'project', release: 'release', preview: 'preview' })) {
    if (projectManifest.paths?.[key] !== expected) errors.push(`project-manifest paths.${key} must be ${expected}.`);
    else {
      try { resolvePortable(root, expected, `paths.${key}`); } catch (error) { errors.push(error.message); }
    }
  }
  const allowedKeys = new Set(['schemaVersion', 'name', 'people', 'paths', 'selection', 'consent']);
  for (const key of Object.keys(projectManifest)) if (!allowedKeys.has(key)) errors.push(`project-manifest.json contains unsupported field: ${key}.`);

  const spriteManifest = readJson(spriteManifestPath);
  const allowedRaster = new Set();
  for (const character of spriteManifest.characters || []) {
    for (const relatives of Object.values(character.frames || {})) {
      for (const relative of relatives || []) {
        allowedRaster.add(path.resolve(project, 'src', 'assets', 'sprites', relative));
      }
    }
  }
  const stack = [project];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['node_modules', 'dist'].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && isRasterFile(full) && !allowedRaster.has(path.resolve(full))) {
        errors.push(`Unexpected raster file in project: ${portableRelative(root, full)}`);
      }
    }
  }
}

for (const issue of auditTextFilesForSensitivePaths(root)) {
  errors.push(`${issue.file} contains absolute/private path text: ${issue.matches.join(', ')}`);
}

if (args.source) {
  const source = path.resolve(args.source);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) errors.push(`Source photo does not exist: ${source}`);
  else if (fs.existsSync(project)) {
    const sourceSize = fs.statSync(source).size;
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const stack = [project];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (['node_modules', 'dist'].includes(entry.name)) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && fs.statSync(full).size === sourceSize) {
          const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
          if (hash === sourceHash) errors.push(`Original source photo was copied into project: ${portableRelative(root, full)}`);
        }
      }
    }
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log(`Output privacy audit passed: ${root}`);
