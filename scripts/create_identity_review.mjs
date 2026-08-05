import fs from 'node:fs';
import path from 'node:path';
import { fail, parseArgs, readJson, writeJson } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.project || !args.preview) fail('Usage: node create_identity_review.mjs --project <project> --preview <preview-dir>');
const project = path.resolve(args.project);
const preview = path.resolve(args.preview);
const config = readJson(path.join(project, 'src', 'config', 'pet.config.json'));
fs.mkdirSync(preview, { recursive: true });
const output = path.join(preview, 'identity-quality-review.json');
if (fs.existsSync(output)) fail('identity-quality-review.json already exists; update it instead of overwriting reviewed scores.');
writeJson(output, {
  schemaVersion: 1,
  rubric: {
    identitySimilarity: 35,
    crossActionConsistency: 20,
    clothingAndAccessories: 15,
    ageSkinBody: 10,
    photorealStyleConsistency: 10,
    bodyEdgesReadability: 10
  },
  thresholds: { total: 90, identitySimilarity: 31, blockersAllowed: 0 },
  characters: config.characters.map((character) => ({
    id: character.id,
    masterFingerprint: null,
    scores: {
      identitySimilarity: null,
      crossActionConsistency: null,
      clothingAndAccessories: null,
      ageSkinBody: null,
      photorealStyleConsistency: null,
      bodyEdgesReadability: null
    },
    blockers: [],
    status: 'pending',
    notes: ''
  }))
});
console.log(output);
