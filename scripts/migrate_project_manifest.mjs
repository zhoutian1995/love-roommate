import fs from 'node:fs';
import path from 'node:path';
import { fail, parseArgs, readJson, writeJson } from './lib/common.mjs';
import { auditTextFilesForSensitivePaths, portableRelative, resolvePortable, sanitizePersistedValue } from './lib/privacy.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.root || (!args['dry-run'] && !args.apply) || (args['dry-run'] && args.apply)) {
  fail('Usage: node migrate_project_manifest.mjs --root <output-root> (--dry-run | --apply --consent confirmed)');
}
if (args.apply && args.consent !== 'confirmed') fail('--apply requires --consent confirmed.');

const root = path.resolve(args.root);
const manifestPath = path.join(root, 'project-manifest.json');
if (!fs.existsSync(manifestPath)) fail(`Missing project manifest: ${manifestPath}`);
const original = readJson(manifestPath);
if (![1, 2].includes(original.schemaVersion)) fail(`Unsupported project manifest schemaVersion: ${original.schemaVersion}`);

const migratedManifest = {
  schemaVersion: 2,
  name: original.name,
  people: original.people,
  paths: { project: 'project', release: 'release', preview: 'preview' },
  selection: original.selection,
  consent: { allSubjectsAuthorized: true }
};

const changes = [{ file: 'project-manifest.json', value: migratedManifest }];
const generationPath = path.join(root, 'preview', 'generation-manifest.json');
if (fs.existsSync(generationPath)) {
  const generation = readJson(generationPath);
  const assets = (generation.assets || []).map((entry) => {
    const oldFile = String(entry.file || '');
    let file;
    try {
      file = path.isAbsolute(oldFile)
        ? portableRelative(root, oldFile, 'Generation source')
        : oldFile.replaceAll('\\', '/').startsWith('preview/')
          ? oldFile.replaceAll('\\', '/')
          : `preview/${oldFile.replaceAll('\\', '/')}`;
      resolvePortable(root, file, 'Generation source');
      if (!file.startsWith('preview/')) throw new Error('Generation source must remain inside preview/.');
    } catch (error) {
      fail(`Cannot migrate generation source ${oldFile || '(missing)'}: ${error.message}`);
    }
    return {
      key: entry.key,
      kind: entry.kind,
      characterId: entry.characterId || null,
      role: entry.role || null,
      generator: 'codex-imagegen',
      declaredModelPolicy: 'gpt-image-2',
      evidenceLevel: 'workflow-attested',
      file,
      sha256: entry.sha256
    };
  });
  changes.push({
    file: portableRelative(root, generationPath),
    value: {
      schemaVersion: 2,
      provenancePolicy: {
        generator: 'codex-imagegen',
        declaredModelPolicy: 'gpt-image-2',
        evidenceLevel: 'workflow-attested'
      },
      assets
    }
  });
}

const knownReports = [];
const stack = [path.join(root, 'project'), path.join(root, 'preview')];
while (stack.length) {
  const current = stack.pop();
  if (!fs.existsSync(current)) continue;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist'].includes(entry.name)) stack.push(full);
    else if (entry.isFile() && ['.json', '.md'].includes(path.extname(entry.name).toLowerCase()) && full !== generationPath) knownReports.push(full);
  }
}
for (const file of knownReports) {
  const relative = portableRelative(root, file);
  if (path.extname(file).toLowerCase() === '.json') {
    const value = readJson(file);
    const sanitized = sanitizePersistedValue(value, root);
    if (JSON.stringify(value) !== JSON.stringify(sanitized)) changes.push({ file: relative, value: sanitized, format: 'json' });
  } else {
    const value = fs.readFileSync(file, 'utf8');
    const sanitized = sanitizePersistedValue(value, root);
    if (value !== sanitized) changes.push({ file: relative, value: sanitized, format: 'text' });
  }
}

const summary = {
  root,
  mode: args.apply ? 'apply' : 'dry-run',
  sourceSchemaVersion: original.schemaVersion,
  targetSchemaVersion: 2,
  files: changes.map((change) => change.file)
};
if (!args.apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

for (const change of changes) {
  const target = path.join(root, change.file);
  if (change.format === 'text') fs.writeFileSync(target, change.value, 'utf8');
  else writeJson(target, change.value);
}
const remaining = auditTextFilesForSensitivePaths(root);
if (remaining.length) fail(`Migration left sensitive paths in: ${remaining.map((item) => item.file).join(', ')}`);
console.log(JSON.stringify({ ...summary, migrated: true }, null, 2));
