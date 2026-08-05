import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const auditScript = path.join(skillRoot, 'scripts', 'audit_skill_release.mjs');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'love-roommate-release-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createPublishableFixture(root) {
  const placeholder = path.join(root, 'assets', 'electron-template', 'src', 'assets', 'sprites', 'placeholder.svg');
  fs.mkdirSync(path.dirname(placeholder), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(placeholder, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(root, 'README.md'), '# Generic Skill\nInstall from https://github.com/example/love-roommate.\n');
  fs.writeFileSync(path.join(root, 'scripts', 'tests', 'fixture.mjs'), "const ids = ['person-1', 'person-2'];\n");
}

test('Skill release audit rejects labeled identity, account, email, and private host paths', (t) => {
  const root = workspace(t);
  createPublishableFixture(root);
  fs.writeFileSync(path.join(root, 'private-notes.md'), [
    '姓名：张三',
    '微信号：wille_private_2026',
    'Email: private.person@realmail.cn',
    'Source: C:\\Users\\private\\roommates.png'
  ].join('\n'));

  const result = spawnSync(process.execPath, [auditScript, '--root', root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /personal name/i);
  assert.match(result.stderr, /account identifier/i);
  assert.match(result.stderr, /email address/i);
  assert.match(result.stderr, /private path/i);
});

test('Skill release audit allows generic character fixtures and reserved example contacts', (t) => {
  const root = workspace(t);
  createPublishableFixture(root);
  fs.writeFileSync(path.join(root, 'CONTRIBUTING.md'), 'Contact: maintainer@example.com\n');

  const result = spawnSync(process.execPath, [auditScript, '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('official validator probe distinguishes missing PyYAML from missing Python', async () => {
  const { probePythonCandidates } = await import('../lib/official-validator.mjs');
  const candidates = [
    { label: 'Python A', command: 'python-a', prefixArgs: [] },
    { label: 'Python B', command: 'python-b', prefixArgs: ['-3'] }
  ];
  const runner = (command, args) => {
    if (args.at(-1) === 'import sys; print(sys.version)') {
      return command === 'python-a' ? { status: 0, stdout: '3.12.1\n', stderr: '' } : { status: 1, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'ModuleNotFoundError: yaml' };
  };

  const result = probePythonCandidates(candidates, runner);
  assert.equal(result.python, null);
  assert.deepEqual(result.missingPyYaml, ['Python A (3.12.1)']);
  assert.match(result.message, /PyYAML is missing/i);
});

test('release gate includes the performance-v2 template tests and a 90-point threshold', () => {
  const releaseCheck = fs.readFileSync(path.join(skillRoot, 'scripts', 'release_check.mjs'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(releaseCheck, /performance-v2\.test\.mjs/);
  assert.match(readme, /不低于 90/);
  assert.doesNotMatch(readme, /不低于 85/);
  assert.match(skill, /score at least 90/);
  assert.doesNotMatch(skill, /score at least 85/);
});

test('build refresh can replace stale smoke evidence before the strict runtime gate', () => {
  const build = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');
  const initialGate = build.match(/if \(!runNode\(selfCheckScript, \[(.*?)\]\)\) \{/s)?.[1] || '';
  const runtimeGate = build.match(/if \(!runNode\(selfCheckScript, \['--project', project, '--preview', preview, '--runtime', runtime,(.*?)\]\)\) \{/s)?.[1] || '';

  assert.match(initialGate, /'--warn-only'/, 'pre-capture diagnostics must not block --refresh-smoke on stale runtime evidence');
  assert.doesNotMatch(runtimeGate, /'--warn-only'/, 'post-capture self-check must remain strict before packaging');
});
