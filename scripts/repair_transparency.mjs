import { createHash, randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyCodexRuntimeArgs, loadSharp, parseArgs } from './lib/common.mjs';
import { cleanPortraitChromaEdges, parseHexColor, zeroHiddenRgb } from './lib/sprite-processing.mjs';
import { applyMaskEdits, createCorrectionReport } from './lib/transparency-repair.mjs';
import { startRepairServer } from './lib/transparency-repair-server.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function portableRelative(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Correction artifacts must stay inside the output root.');
  }
  return relative.replaceAll(path.sep, '/');
}

async function writeNewArtifacts(artifacts) {
  const staged = [];
  const committed = [];
  try {
    for (const [destination, data] of artifacts) {
      const temporary = `${destination}.partial-${process.pid}-${randomBytes(4).toString('hex')}`;
      await writeFile(temporary, data, { flag: 'wx' });
      staged.push([temporary, destination]);
    }
    for (const [temporary, destination] of staged) {
      await rename(temporary, destination);
      committed.push(destination);
    }
  } catch (error) {
    await Promise.allSettled(staged.map(([temporary]) => rm(temporary, { force: true })));
    await Promise.allSettled(committed.map((destination) => rm(destination, { force: true })));
    throw error;
  }
}

export function createSharpCodec(sharp) {
  return {
    async decode(file) {
      const decoded = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data: decoded.data, width: decoded.info.width, height: decoded.info.height };
    },
    encodeRgba(rgba, width, height) {
      return sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
    },
    encodeMask(alpha, width, height) {
      return sharp(alpha, { raw: { width, height, channels: 1 } })
        .toColourspace('b-w')
        .png({ compressionLevel: 9 })
        .toBuffer();
    },
  };
}

export async function composeCorrectionFiles({
  root,
  input,
  candidate,
  out,
  mask,
  report,
  key,
  attempt,
  codec,
  payload,
}) {
  if (String(payload?.key).toLowerCase() !== String(key).toLowerCase()) throw new Error('Browser payload does not match the session key.');
  if (payload?.attempt !== attempt) throw new Error('Browser payload does not match the session attempt.');
  if (!Array.isArray(payload?.edits)) throw new Error('Browser payload edits must be an array.');
  const strokeCounts = payload?.strokeCounts;
  if (!strokeCounts || !Number.isInteger(strokeCounts.erase) || strokeCounts.erase < 0
    || !Number.isInteger(strokeCounts.restore) || strokeCounts.restore < 0) {
    throw new Error('Browser payload strokeCounts are invalid.');
  }

  const [source, automaticCandidate] = await Promise.all([codec.decode(input), codec.decode(candidate)]);
  if (source.width !== automaticCandidate.width || source.height !== automaticCandidate.height) {
    throw new Error('Source and candidate dimensions must match.');
  }
  if (source.width < 1 || source.height < 1 || source.width > 4096 || source.height > 4096) {
    throw new Error('Image dimensions must stay within 4096x4096.');
  }

  const keyRgb = parseHexColor(key);
  const cleanedCandidate = zeroHiddenRgb(cleanPortraitChromaEdges(
    automaticCandidate.data,
    automaticCandidate.width,
    automaticCandidate.height,
    keyRgb,
  ));
  const correctedRgba = zeroHiddenRgb(applyMaskEdits({
    sourceRgba: source.data,
    candidateRgba: cleanedCandidate,
    width: source.width,
    height: source.height,
    edits: payload.edits,
  }));
  const alpha = Buffer.alloc(source.width * source.height);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = correctedRgba[pixel * 4 + 3];

  const [outputPng, maskPng, inputPng, candidatePng] = await Promise.all([
    codec.encodeRgba(correctedRgba, source.width, source.height),
    codec.encodeMask(alpha, source.width, source.height),
    readFile(input),
    readFile(candidate),
  ]);
  const correctionReport = createCorrectionReport({
    status: 'saved',
    key,
    attempt,
    input: { path: portableRelative(root, input), sha256: sha256(inputPng) },
    candidate: { path: portableRelative(root, candidate), sha256: sha256(candidatePng) },
    mask: { path: portableRelative(root, mask), sha256: sha256(maskPng) },
    output: { path: portableRelative(root, out), sha256: sha256(outputPng) },
    strokes: strokeCounts,
  });
  const reportJson = Buffer.from(`${JSON.stringify(correctionReport, null, 2)}\n`, 'utf8');
  await writeNewArtifacts([[out, outputPng], [mask, maskPng], [report, reportJson]]);
  return {
    status: 'saved',
    output: portableRelative(root, out),
    mask: portableRelative(root, mask),
    report: portableRelative(root, report),
  };
}

function requiredPath(args, name) {
  if (typeof args[name] !== 'string') throw new Error(`Missing --${name}.`);
  return path.resolve(args[name]);
}

function inferRoot(out) {
  const corrections = path.dirname(out);
  const preview = path.dirname(corrections);
  if (path.basename(corrections).toLowerCase() !== 'corrections' || path.basename(preview).toLowerCase() !== 'preview') {
    throw new Error('--out must be inside preview/corrections.');
  }
  return path.dirname(preview);
}

export async function runRepairCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const input = requiredPath(args, 'input');
  const candidate = requiredPath(args, 'candidate');
  const out = requiredPath(args, 'out');
  const mask = requiredPath(args, 'mask');
  const report = requiredPath(args, 'report');
  if (typeof args.key !== 'string') throw new Error('Missing --key #RRGGBB.');
  parseHexColor(args.key);
  const attempt = Number(args.attempt);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 3) throw new Error('--attempt must be an integer from 1 to 3.');
  applyCodexRuntimeArgs(args);
  const root = inferRoot(out);

  // Native Sharp is loaded only after all CLI arguments have been parsed and validated.
  const sharp = loadSharp(root);
  sharp.cache(false);
  const codec = createSharpCodec(sharp);
  const sourceMetadata = await sharp(input).metadata();
  const candidateMetadata = await sharp(candidate).metadata();
  if (sourceMetadata.width !== candidateMetadata.width || sourceMetadata.height !== candidateMetadata.height) {
    throw new Error('Source and candidate dimensions must match.');
  }

  const server = await startRepairServer({
    root,
    input,
    candidate,
    out,
    mask,
    report,
    key: args.key,
    attempt,
    width: sourceMetadata.width,
    height: sourceMetadata.height,
    idleTimeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : undefined,
    composeCorrection: (payload) => composeCorrectionFiles({
      root, input, candidate, out, mask, report, key: args.key, attempt, codec, payload,
    }),
  });
  console.log(server.url);

  let interrupted = false;
  const onInterrupt = () => {
    interrupted = true;
    process.exitCode = 130;
    void server.close();
  };
  process.once('SIGINT', onInterrupt);
  try {
    const completion = await server.completion;
    if (!interrupted && completion.status !== 'saved') process.exitCode = 2;
    return completion;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    await server.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runRepairCli().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
