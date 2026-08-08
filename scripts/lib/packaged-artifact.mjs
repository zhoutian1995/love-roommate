import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_ELECTRON_FILES = [
  'icudtl.dat',
  'resources.pak',
  'snapshot_blob.bin',
  'v8_context_snapshot.bin'
];

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function inspectWindowsPe(executable) {
  if (!isFile(executable)) throw new Error('Packaged Windows executable is missing.');
  const descriptor = fs.openSync(executable, 'r');
  try {
    const dos = Buffer.alloc(64);
    if (fs.readSync(descriptor, dos, 0, dos.length, 0) !== dos.length || dos.subarray(0, 2).toString('ascii') !== 'MZ') {
      throw new Error('Packaged executable is not a Windows PE file.');
    }
    const peOffset = dos.readUInt32LE(0x3c);
    if (!Number.isInteger(peOffset) || peOffset < 64 || peOffset > 16 * 1024 * 1024) {
      throw new Error('Packaged executable has an invalid Windows PE header offset.');
    }
    const pe = Buffer.alloc(6);
    if (fs.readSync(descriptor, pe, 0, pe.length, peOffset) !== pe.length || !pe.subarray(0, 4).equals(Buffer.from([0x50, 0x45, 0x00, 0x00]))) {
      throw new Error('Packaged executable is not a Windows PE file.');
    }
    const machine = pe.readUInt16LE(4);
    if (machine !== 0x8664) throw new Error('Packaged executable is not a Windows x64 PE file.');
    return { machine: 'x64', peOffset };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function validateWindowsPortableArtifact(executable, declaredPackagedRoot = null) {
  const resolvedExecutable = path.resolve(executable);
  if (path.extname(resolvedExecutable).toLowerCase() !== '.exe') throw new Error('Packaged Windows executable must use the .exe extension.');
  inspectWindowsPe(resolvedExecutable);
  const artifactRoot = path.dirname(resolvedExecutable);
  const packagedRoot = path.join(artifactRoot, 'resources', 'app');
  if (declaredPackagedRoot && path.resolve(declaredPackagedRoot) !== path.resolve(packagedRoot)) {
    throw new Error('Packaged runtime root must be resources/app derived from the executable.');
  }
  if (!isFile(path.join(packagedRoot, 'runtime-build.json'))) throw new Error('Packaged Electron runtime metadata is missing.');
  for (const relative of REQUIRED_ELECTRON_FILES) {
    if (!isFile(path.join(artifactRoot, relative))) throw new Error(`Electron portable layout is missing ${relative}.`);
  }
  return { artifactRoot, executable: resolvedExecutable, packagedRoot };
}

function hashFileInto(hash, file) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const length = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (!length) break;
      hash.update(buffer.subarray(0, length));
      position += length;
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

export function packagedArtifactFingerprint(artifactRoot) {
  const root = path.resolve(artifactRoot);
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('Windows packaged artifact must not contain symlinks.');
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort().reverse()) stack.push(path.join(current, name));
    } else if (stat.isFile()) files.push(current);
  }
  files.sort((left, right) => path.relative(root, left).replaceAll('\\', '/').localeCompare(path.relative(root, right).replaceAll('\\', '/'), 'en'));
  const hash = crypto.createHash('sha256');
  hash.update('love-roommate-windows-portable-artifact-v1\0');
  for (const file of files) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    hash.update(relative);
    hash.update('\0');
    hash.update(String(fs.statSync(file).size));
    hash.update('\0');
    hashFileInto(hash, file);
    hash.update('\0');
  }
  return hash.digest('hex');
}
