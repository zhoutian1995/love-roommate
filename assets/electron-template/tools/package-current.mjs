import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const packagerFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(packagerFile), '..');
const require = createRequire(import.meta.url);
const { PERFORMANCE_FINGERPRINT_SCHEMA_VERSION } = require(path.join(root, 'src', 'performance-audit.js'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'src', 'config', 'pet.config.json'), 'utf8'));
const electronDist = path.resolve(process.env.PET_ELECTRON_DIST || path.join(root, 'node_modules', 'electron', 'dist'));
if (!fs.existsSync(electronDist)) {
  console.error('Electron runtime is missing. Run the Skill build command while Codex is online.');
  process.exit(1);
}
const pinnedElectronVersion = packageJson.devDependencies?.electron;
const actualElectronVersion = fs.readFileSync(path.join(electronDist, 'version'), 'utf8').trim();
if (actualElectronVersion !== pinnedElectronVersion) {
  throw new Error(`Electron runtime version ${actualElectronVersion} does not match pinned ${pinnedElectronVersion}.`);
}
const runtimeBuild = {
  schemaVersion: PERFORMANCE_FINGERPRINT_SCHEMA_VERSION,
  electronVersion: actualElectronVersion,
  platform: process.platform,
  arch: process.arch,
  packageCurrentSha256: crypto.createHash('sha256').update(fs.readFileSync(packagerFile)).digest('hex')
};

const productName = packageJson.petBuild?.productName || config.app.name;
const safeName = productName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'Love Roommate';
const appId = packageJson.petBuild?.appId || config.app.id;
const distRoot = path.join(root, 'dist');

function relativeOutput(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function prepareOutput(output) {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(output), { recursive: true });
}

function installApp(resourcesDir) {
  const appDir = path.join(resourcesDir, 'app');
  fs.rmSync(path.join(resourcesDir, 'default_app.asar'), { force: true });
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.cpSync(path.join(root, 'src'), path.join(appDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'tools'), { recursive: true });
  fs.copyFileSync(packagerFile, path.join(appDir, 'tools', 'package-current.mjs'));
  fs.writeFileSync(path.join(appDir, 'package.json'), `${JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    private: true,
    main: 'src/main.js'
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(appDir, 'runtime-build.json'), `${JSON.stringify(runtimeBuild, null, 2)}\n`, 'utf8');
}

if (process.platform === 'win32' && process.arch === 'x64') {
  const output = path.join(distRoot, 'windows', safeName);
  prepareOutput(output);
  fs.cpSync(electronDist, output, { recursive: true });
  const originalExecutable = path.join(output, 'electron.exe');
  const executable = path.join(output, `${safeName}.exe`);
  if (!fs.existsSync(originalExecutable)) throw new Error(`Electron executable is missing: ${originalExecutable}`);
  fs.renameSync(originalExecutable, executable);
  installApp(path.join(output, 'resources'));
  console.log(JSON.stringify({ platform: 'windows', output: relativeOutput(output), executable: relativeOutput(executable) }, null, 2));
} else if (process.platform === 'darwin' && process.arch === 'arm64') {
  const sourceApp = path.join(electronDist, 'Electron.app');
  const output = path.join(distRoot, 'macos', `${safeName}.app`);
  if (!fs.existsSync(sourceApp)) throw new Error(`Electron.app is missing: ${sourceApp}`);
  prepareOutput(output);
  fs.cpSync(sourceApp, output, { recursive: true, verbatimSymlinks: true });
  const contents = path.join(output, 'Contents');
  const macosDir = path.join(contents, 'MacOS');
  const originalExecutable = path.join(macosDir, 'Electron');
  const executable = path.join(macosDir, safeName);
  fs.renameSync(originalExecutable, executable);
  installApp(path.join(contents, 'Resources'));
  const plist = path.join(contents, 'Info.plist');
  for (const [key, value] of [
    ['CFBundleDisplayName', productName],
    ['CFBundleName', productName],
    ['CFBundleIdentifier', appId],
    ['CFBundleExecutable', safeName]
  ]) {
    const result = spawnSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Could not update ${key} in ${plist}`);
  }
  const signResult = spawnSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', output], { stdio: 'inherit' });
  if (signResult.status !== 0) throw new Error(`Could not ad-hoc sign ${output}`);
  const verifyResult = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', output], { stdio: 'inherit' });
  if (verifyResult.status !== 0) throw new Error(`Could not verify the ad-hoc signature for ${output}`);
  console.log(JSON.stringify({ platform: 'macos', output: relativeOutput(output), executable: relativeOutput(executable) }, null, 2));
} else {
  console.error(`Unsupported package host: ${process.platform}/${process.arch}. Use Windows x64 or Apple-silicon macOS.`);
  process.exit(1);
}
