import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

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

function installWithFallback(manager, project, options = {}) {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  const runtimePath = `${path.dirname(process.execPath)}${path.delimiter}${process.env[pathKey] || ''}`;
  const install = (extraArgs = [], extraEnv = {}) => spawnSync(manager.command, [...manager.installArgs, ...extraArgs], {
    cwd: project,
    stdio: 'inherit',
    shell: process.platform === 'win32' && manager.command.toLowerCase().endsWith('.cmd'),
    env: { ...process.env, [pathKey]: runtimePath, ...extraEnv }
  });
  let result = install();
  const incomplete = typeof options.isComplete === 'function' && !options.isComplete();
  if (result.status !== 0 || incomplete) {
    console.warn(incomplete
      ? 'Primary package install left an incomplete Electron runtime; cleaning it and retrying once with the configured mirror fallback...'
      : 'Primary package download failed; cleaning it and retrying once with the configured mirror fallback...');
    if (typeof options.beforeRetry === 'function') options.beforeRetry();
    const registry = process.env.CODEX_NPM_REGISTRY || 'https://registry.npmmirror.com';
    result = install(['--registry', registry], {
      npm_config_registry: process.env.CODEX_NPM_REGISTRY || 'https://registry.npmmirror.com',
      NPM_CONFIG_REGISTRY: process.env.CODEX_NPM_REGISTRY || 'https://registry.npmmirror.com',
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/'
    });
  }
  return result;
}

function electronRuntimeLayout(runtimeRoot) {
  const dist = path.join(runtimeRoot, 'node_modules', 'electron', 'dist');
  if (process.platform === 'win32') {
    return {
      executable: path.join(dist, 'electron.exe'),
      requiredFiles: [
        path.join(dist, 'electron.exe'),
        path.join(dist, 'icudtl.dat'),
        path.join(dist, 'resources', 'default_app.asar'),
        path.join(dist, 'locales', 'en-US.pak')
      ],
      relativeLinks: []
    };
  }

  const app = path.join(dist, 'Electron.app');
  const framework = path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework');
  return {
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

function cleanElectronRuntimeInstall(runtimeRoot) {
  const cacheRoot = path.resolve(path.join(os.tmpdir(), 'codex-electron-runtime'));
  const resolvedRoot = path.resolve(runtimeRoot);
  if (path.dirname(resolvedRoot) !== cacheRoot) fail(`Refusing to clean an unexpected Electron cache path: ${resolvedRoot}`);
  for (const name of ['node_modules', 'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json']) {
    fs.rmSync(path.join(resolvedRoot, name), { recursive: true, force: true });
  }
}

export function ensureElectronRuntime(project) {
  const packageJson = readJson(path.join(project, 'package.json'));
  const version = packageJson.devDependencies?.electron || packageJson.dependencies?.electron;
  if (!version) fail('The generated project does not pin an Electron version.');
  const runtimeRoot = path.join(os.tmpdir(), 'codex-electron-runtime', `${version}-${process.platform}-${process.arch}`);
  let status = electronRuntimeProblems(runtimeRoot);
  if (!status.problems.length) return status.executable;
  if (fs.existsSync(path.join(runtimeRoot, 'node_modules'))) {
    console.warn(`Discarding an incomplete Electron cache:\n- ${status.problems.join('\n- ')}`);
    cleanElectronRuntimeInstall(runtimeRoot);
  }
  fs.mkdirSync(runtimeRoot, { recursive: true });
  writeJson(path.join(runtimeRoot, 'package.json'), {
    name: 'codex-electron-runtime',
    private: true,
    devDependencies: { electron: version }
  });
  fs.writeFileSync(path.join(runtimeRoot, 'pnpm-workspace.yaml'), 'allowBuilds:\n  electron: true\n', 'utf8');
  const manager = packageManager();
  console.log(`Installing the pinned Electron runtime with ${path.basename(manager.command)}...`);
  const result = installWithFallback(manager, runtimeRoot, {
    beforeRetry: () => cleanElectronRuntimeInstall(runtimeRoot),
    isComplete: () => !electronRuntimeProblems(runtimeRoot).problems.length
  });
  status = electronRuntimeProblems(runtimeRoot);
  if (result.status !== 0 || status.problems.length) {
    fail(`Automatic Electron runtime install failed. Keep Codex online and retry. Runtime issues:\n- ${status.problems.join('\n- ')}`);
  }
  return status.executable;
}

export function loadSharp(project) {
  const requireFromProject = createRequire(path.join(project, 'package.json'));
  try {
    return requireFromProject('sharp');
  } catch {
    if (process.env.CODEX_NODE_MODULES) {
      const bundled = path.join(process.env.CODEX_NODE_MODULES, 'sharp');
      if (fs.existsSync(bundled)) return createRequire(import.meta.url)(bundled);
    }
  }
  fail('Codex bundled Sharp runtime was not found. Reload workspace dependencies and pass CODEX_NODE_MODULES.');
}

export function packageManager() {
  if (process.env.CODEX_PNPM) {
    return {
      command: process.env.CODEX_PNPM,
      installArgs: ['install', '--no-frozen-lockfile'],
      runArgs: (args) => args
    };
  }
  const bundledNpm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const programFilesNpm = process.env.ProgramFiles
    ? path.join(process.env.ProgramFiles, 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : '';
  const npmCli = [bundledNpm, programFilesNpm].find((candidate) => candidate && fs.existsSync(candidate));
  if (npmCli) {
    return {
      command: process.execPath,
      installArgs: [npmCli, 'install', '--no-audit', '--no-fund'],
      runArgs: (args) => [npmCli, ...args]
    };
  }
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return {
    command,
    installArgs: ['install', '--no-audit', '--no-fund'],
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
