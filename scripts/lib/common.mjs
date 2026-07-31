import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org';
const OFFICIAL_ELECTRON_MIRROR = 'https://github.com/electron/electron/releases/download/';
const PINNED_ELECTRON_VERSION = '41.0.2';
const PINNED_SHARP_VERSION = '0.34.5';
const ELECTRON_ARCHIVE_HASHES = {
  'win32-x64': 'dcd36396a606a5ae2f5651b4ee6bb463a624dbf15f786eda57cee2cc361c138c',
  'darwin-arm64': '8e18ef53da62bca6132508721c1f94e06b5773b48d366b95e593479892f0a2fe'
};

export function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

export function applyCodexRuntimeArgs(args) {
  if (typeof args.pnpm === 'string') process.env.CODEX_PNPM = path.resolve(args.pnpm);
  if (typeof args['node-modules'] === 'string') process.env.CODEX_NODE_MODULES = path.resolve(args['node-modules']);
}

export function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function slugify(value) {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'love-roommate';
}

function normalizedUrl(value) {
  return String(value || '').replace(/\/+$/, '').toLowerCase();
}

export function approvedInstallEnvironment(includeElectronMirror = false, environment = process.env) {
  const registry = environment.CODEX_NPM_REGISTRY || OFFICIAL_NPM_REGISTRY;
  const mirror = includeElectronMirror && environment.ELECTRON_MIRROR
    ? environment.ELECTRON_MIRROR
    : null;
  const thirdPartyRegistry = normalizedUrl(registry) !== normalizedUrl(OFFICIAL_NPM_REGISTRY);
  const thirdPartyMirror = mirror && !normalizedUrl(mirror).startsWith(normalizedUrl(OFFICIAL_ELECTRON_MIRROR));
  if ((thirdPartyRegistry || thirdPartyMirror) && environment.CODEX_ALLOW_THIRD_PARTY_MIRROR !== '1') {
    throw new Error('Third-party package mirrors are disabled. Set CODEX_ALLOW_THIRD_PARTY_MIRROR=1 together with the explicit mirror address to opt in.');
  }
  if (thirdPartyRegistry || thirdPartyMirror) {
    console.warn('SECURITY WARNING: using an explicitly authorized third-party package mirror. Package and Electron archive integrity checks remain enabled.');
  }
  const env = {
    ...environment,
    npm_config_registry: registry,
    NPM_CONFIG_REGISTRY: registry
  };
  if (mirror) env.ELECTRON_MIRROR = mirror;
  else delete env.ELECTRON_MIRROR;
  return { env, registry };
}

function installPinnedRuntime(kind, destination) {
  const lockRoot = path.join(skillRoot, 'assets', 'runtime-locks', kind);
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    if (!fs.existsSync(path.join(lockRoot, file))) throw new Error(`Pinned ${kind} runtime is missing ${file}.`);
  }
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  const runtimePath = `${path.dirname(process.execPath)}${path.delimiter}${process.env[pathKey] || ''}`;
  const manager = packageManager();
  const partial = `${destination}.partial-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.rmSync(partial, { recursive: true, force: true });
  fs.mkdirSync(partial, { recursive: true });
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    fs.copyFileSync(path.join(lockRoot, file), path.join(partial, file));
  }
  const installConfig = approvedInstallEnvironment(kind === 'electron');
  const result = spawnSync(manager.command, [...manager.installArgs, '--registry', installConfig.registry], {
    cwd: partial,
    stdio: 'inherit',
    shell: process.platform === 'win32' && manager.command.toLowerCase().endsWith('.cmd'),
    env: { ...installConfig.env, [pathKey]: runtimePath }
  });
  if (result.status !== 0) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw new Error(`Pinned ${kind} runtime installation failed with exit code ${result.status ?? 'unknown'}.`);
  }
  return partial;
}

function electronRuntimeLayout(runtimeRoot) {
  const dist = path.join(runtimeRoot, 'node_modules', 'electron', 'dist');
  if (process.platform === 'win32') {
    return {
      dist,
      executable: path.join(dist, 'electron.exe'),
      requiredFiles: [
        path.join(dist, 'electron.exe'),
        path.join(dist, 'icudtl.dat'),
        path.join(dist, 'resources.pak'),
        path.join(dist, 'snapshot_blob.bin'),
        path.join(dist, 'v8_context_snapshot.bin'),
        path.join(dist, 'ffmpeg.dll'),
        path.join(dist, 'libEGL.dll'),
        path.join(dist, 'libGLESv2.dll'),
        path.join(dist, 'resources', 'default_app.asar'),
        path.join(dist, 'locales', 'en-US.pak')
      ],
      relativeLinks: []
    };
  }

  const app = path.join(dist, 'Electron.app');
  const framework = path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework');
  return {
    dist,
    executable: path.join(app, 'Contents', 'MacOS', 'Electron'),
    requiredFiles: [
      path.join(app, 'Contents', 'MacOS', 'Electron'),
      path.join(framework, 'Versions', 'A', 'Electron Framework'),
      path.join(framework, 'Versions', 'A', 'Resources', 'icudtl.dat'),
      path.join(app, 'Contents', 'Resources', 'default_app.asar'),
      path.join(app, 'Contents', 'Frameworks', 'Electron Helper.app', 'Contents', 'MacOS', 'Electron Helper')
    ],
    relativeLinks: [
      [path.join(framework, 'Versions', 'Current'), 'A'],
      [path.join(framework, 'Resources'), path.join('Versions', 'Current', 'Resources')],
      [path.join(framework, 'Electron Framework'), path.join('Versions', 'Current', 'Electron Framework')]
    ]
  };
}

function electronRuntimeProblems(runtimeRoot) {
  const layout = electronRuntimeLayout(runtimeRoot);
  const problems = layout.requiredFiles
    .filter((file) => !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0)
    .map((file) => `missing or empty: ${path.relative(runtimeRoot, file)}`);
  for (const [link, expected] of layout.relativeLinks) {
    let actual = null;
    try {
      if (fs.lstatSync(link).isSymbolicLink()) actual = fs.readlinkSync(link);
    } catch {
      // Report the missing link below.
    }
    if (actual !== expected) {
      problems.push(`invalid relative symlink: ${path.relative(runtimeRoot, link)} -> ${actual || '(missing)'}`);
    }
  }
  return { ...layout, problems };
}

export function electronArchiveSpec(platform = process.platform, arch = process.arch, version = PINNED_ELECTRON_VERSION) {
  const key = `${platform}-${arch}`;
  const sha256 = ELECTRON_ARCHIVE_HASHES[key];
  if (version !== PINNED_ELECTRON_VERSION || !sha256) {
    throw new Error(`No trusted Electron archive is configured for ${version} ${key}.`);
  }
  const platformName = platform === 'win32' ? 'win32' : 'darwin';
  return { filename: `electron-v${version}-${platformName}-${arch}.zip`, sha256 };
}

export function verifyElectronArchive(file, expectedSha256) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Electron archive is missing: ${file}`);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== expectedSha256) throw new Error(`Electron archive checksum mismatch: expected ${expectedSha256}, received ${actual}.`);
  return actual;
}

function findFile(root, filename) {
  if (!root || !fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name === filename) return full;
    }
  }
  return null;
}

function verifyInstalledElectronArchive(runtimeRoot) {
  const spec = electronArchiveSpec();
  const markerPath = path.join(runtimeRoot, 'electron-archive.sha256.json');
  if (fs.existsSync(markerPath)) {
    const marker = readJson(markerPath);
    if (marker.filename === spec.filename && marker.sha256 === spec.sha256) return;
  }
  const roots = [
    process.env.ELECTRON_CACHE,
    process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'electron', 'Cache') : null,
    process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'electron') : null,
    path.join(os.homedir(), '.cache', 'electron')
  ].filter(Boolean);
  const archive = roots.map((root) => findFile(root, spec.filename)).find(Boolean);
  if (!archive) throw new Error(`Downloaded Electron archive ${spec.filename} was not found in the Electron cache for checksum verification.`);
  verifyElectronArchive(archive, spec.sha256);
  writeJson(markerPath, { filename: spec.filename, sha256: spec.sha256 });
}

export function ensureElectronRuntime(project) {
  const packageJson = readJson(path.join(project, 'package.json'));
  const version = packageJson.devDependencies?.electron || packageJson.dependencies?.electron;
  if (version !== PINNED_ELECTRON_VERSION) fail(`The generated project must pin Electron exactly to ${PINNED_ELECTRON_VERSION}.`);
  const runtimeRoot = path.join(os.tmpdir(), 'codex-electron-runtime', `${version}-${process.platform}-${process.arch}`);
  let status = electronRuntimeProblems(runtimeRoot);
  if (!status.problems.length) {
    try {
      verifyInstalledElectronArchive(runtimeRoot);
      return { executable: status.executable, dist: status.dist };
    } catch (error) {
      status.problems.push(error.message);
    }
  }
  if (status.problems.length) console.warn(`Refreshing the pinned Electron runtime:\n- ${status.problems.join('\n- ')}`);
  let partial;
  try {
    partial = installPinnedRuntime('electron', runtimeRoot);
    const partialStatus = electronRuntimeProblems(partial);
    if (partialStatus.problems.length) throw new Error(`Installed Electron runtime is incomplete:\n- ${partialStatus.problems.join('\n- ')}`);
    verifyInstalledElectronArchive(partial);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.renameSync(partial, runtimeRoot);
  } catch (error) {
    if (partial) fs.rmSync(partial, { recursive: true, force: true });
    fail(`Automatic Electron runtime install failed. Keep Codex online and retry. ${error.message}`);
  }
  status = electronRuntimeProblems(runtimeRoot);
  return { executable: status.executable, dist: path.join(runtimeRoot, 'node_modules', 'electron', 'dist') };
}

function errorChain(error) {
  const messages = [];
  let current = error;
  while (current && !messages.includes(current.message)) {
    messages.push(`${current.code ? `${current.code}: ` : ''}${current.message || String(current)}`);
    current = current.cause;
  }
  return messages.join(' <- ');
}

export function loadSharpFromNodeModules(nodeModulesRoot) {
  const root = path.resolve(nodeModulesRoot);
  const requireFromRoot = createRequire(path.join(path.dirname(root), 'package.json'));
  const packagePath = requireFromRoot.resolve('sharp/package.json');
  const packageJson = readJson(packagePath);
  if (packageJson.version !== PINNED_SHARP_VERSION) throw new Error(`Expected Sharp ${PINNED_SHARP_VERSION}, found ${packageJson.version}.`);
  return requireFromRoot('sharp');
}

function ensureSharpRuntime() {
  const runtimeRoot = process.env.CODEX_SHARP_RUNTIME_ROOT
    ? path.resolve(process.env.CODEX_SHARP_RUNTIME_ROOT)
    : path.join(os.tmpdir(), 'codex-sharp-runtime', `${PINNED_SHARP_VERSION}-${process.platform}-${process.arch}`);
  try {
    return loadSharpFromNodeModules(path.join(runtimeRoot, 'node_modules'));
  } catch {
    let partial;
    try {
      partial = installPinnedRuntime('sharp', runtimeRoot);
      const sharp = loadSharpFromNodeModules(path.join(partial, 'node_modules'));
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
      fs.renameSync(partial, runtimeRoot);
      return sharp;
    } catch (error) {
      if (partial) fs.rmSync(partial, { recursive: true, force: true });
      throw error;
    }
  }
}

export function loadSharp(project) {
  const inferred = path.resolve(path.dirname(process.execPath), '..', 'node_modules');
  const configuredRoot = process.env.CODEX_NODE_MODULES;
  const roots = [path.resolve(configuredRoot || inferred)];
  const failures = [];
  for (const root of roots) {
    try {
      return loadSharpFromNodeModules(root);
    } catch (error) {
      failures.push(`Codex node_modules ${root}: ${errorChain(error)}`);
    }
  }
  try {
    console.warn('Codex bundled Sharp could not be loaded; installing the locked Sharp 0.34.5 runtime from the approved npm registry.');
    return ensureSharpRuntime();
  } catch (error) {
    failures.push(`Locked Sharp fallback: ${errorChain(error)}`);
  }
  fail(`Sharp runtime unavailable for ${process.platform}/${process.arch}. Project: ${path.resolve(project)}\n- ${failures.join('\n- ')}`);
}

export function packageManager() {
  const command = process.env.CODEX_PNPM || (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  return {
    command,
    installArgs: ['install', '--frozen-lockfile'],
    runArgs: (args) => args
  };
}

export function runPackage(args, cwd, extraEnv = {}) {
  const manager = packageManager();
  const result = spawnSync(manager.command, manager.runArgs(args), {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && manager.command.toLowerCase().endsWith('.cmd'),
    env: { ...process.env, ...extraEnv }
  });
  if (result.status !== 0) fail(`${path.basename(manager.command)} ${args.join(' ')} failed with exit code ${result.status}.`);
}

export function run(command, args, cwd, extraEnv = {}) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const result = spawnSync(executable, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extraEnv }
  });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
