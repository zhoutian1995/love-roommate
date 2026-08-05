import { spawnSync } from 'node:child_process';

export function defaultPythonCandidates(env = process.env, platform = process.platform) {
  const candidates = [];
  const add = (label, command, prefixArgs = []) => {
    if (command && !candidates.some((candidate) => candidate.command === command && candidate.prefixArgs.join('\0') === prefixArgs.join('\0'))) {
      candidates.push({ label, command, prefixArgs });
    }
  };
  add('CODEX_PYTHON', env.CODEX_PYTHON);
  add('PYTHON', env.PYTHON);
  if (env.VIRTUAL_ENV) add('active virtual environment', `${env.VIRTUAL_ENV}${platform === 'win32' ? '\\Scripts\\python.exe' : '/bin/python'}`);
  if (platform === 'win32') add('Python launcher', 'py.exe', ['-3']);
  add(platform === 'win32' ? 'python.exe' : 'python3', platform === 'win32' ? 'python.exe' : 'python3');
  add('python', 'python');
  return candidates;
}

export function probePythonCandidates(candidates, runner = (command, args) => spawnSync(command, args, { encoding: 'utf8', shell: false })) {
  const missingPyYaml = [];
  for (const candidate of candidates) {
    const version = runner(candidate.command, [...candidate.prefixArgs, '-c', 'import sys; print(sys.version)']);
    if (version.status !== 0) continue;
    const versionLabel = String(version.stdout || '').trim().split(/\s+/)[0] || 'unknown version';
    const yaml = runner(candidate.command, [...candidate.prefixArgs, '-c', 'import yaml; print(yaml.__version__)']);
    if (yaml.status === 0) return { python: candidate, missingPyYaml, message: null };
    missingPyYaml.push(`${candidate.label} (${versionLabel})`);
  }
  const message = missingPyYaml.length
    ? `Python was found, but PyYAML is missing in: ${missingPyYaml.join(', ')}. Install it with that interpreter (for example: python -m pip install PyYAML==6.0.2), set CODEX_PYTHON to an interpreter that has PyYAML, or set SKIP_OFFICIAL_VALIDATOR=1 only for non-release local checks.`
    : 'No usable Python 3 interpreter was found. Install Python 3 with PyYAML, set CODEX_PYTHON, or set SKIP_OFFICIAL_VALIDATOR=1 only for non-release local checks.';
  return { python: null, missingPyYaml, message };
}
