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
    ['姓名', '：', '合成甲'].join(''),
    ['微信号', '：', 'synthetic_private_id'].join(''),
    ['Email: synthetic.contact', '@', 'invalid.example'].join(''),
    ['Source: /', 'Users', '/sample/fixture.png'].join('')
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

test('Skill release audit scans JavaScript modules for private identity data', (t) => {
  const root = workspace(t);
  createPublishableFixture(root);
  const privateModule = [
    ['姓名', '：', '合成甲'].join(''),
    ['账号', '：', 'synthetic_private_id'].join(''),
    ['Email: synthetic.contact', '@', 'invalid.example'].join(''),
    ['Source: /', 'Users', '/sample/fixture.png'].join('')
  ].join('\n');
  fs.writeFileSync(path.join(root, 'scripts', 'private-fixture.mjs'), privateModule);

  const result = spawnSync(process.execPath, [auditScript, '--root', root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private-fixture\.mjs/);
  assert.match(result.stderr, /personal name/i);
  assert.match(result.stderr, /account identifier/i);
  assert.match(result.stderr, /email address/i);
  assert.match(result.stderr, /private path/i);
});

test('Skill release audit allows JavaScript path sanitizers and fixed system executables', (t) => {
  const root = workspace(t);
  createPublishableFixture(root);
  fs.writeFileSync(path.join(root, 'scripts', 'safe-path-code.mjs'), [
    String.raw`const sanitizer = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>]*/g;`,
    String.raw`const virtualPython = envRoot + '\\Scripts\\python.exe';`,
    String.raw`const command = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';`
  ].join('\n'));

  const result = spawnSync(process.execPath, [auditScript, '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('Skill release audit rejects private superpowers planning documents', (t) => {
  const root = workspace(t);
  createPublishableFixture(root);
  const privatePlan = path.join(root, 'docs', 'superpowers', 'plans', 'private-plan.md');
  fs.mkdirSync(path.dirname(privatePlan), { recursive: true });
  fs.writeFileSync(privatePlan, '# Project-specific private plan\n');

  const result = spawnSync(process.execPath, [auditScript, '--root', root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private planning document/i);
});

test('README describes identity masters and per-action generation without legacy action sheets', () => {
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /基础动作表|接力角色动作表/);
  assert.match(readme, /身份母版/);
  assert.match(readme, /逐动作|左右成对动作/);
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
  assert.match(releaseCheck, /performance-audit\.test\.mjs/);
  assert.match(releaseCheck, /window-size-regression\.test\.mjs/);
  assert.match(releaseCheck, /utf8-integrity\.test\.mjs/);
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

test('build gate runs and verifies both gradual group-shout scenarios', () => {
  const build = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');
  assert.match(build, /scenarios\.push\('dad-shout', 'grandpa-shout'\)/);
  assert.match(build, /formingSamples/);
  assert.match(build, /kneelingSamples/);
  assert.match(build, /shoutingSamples/);
  assert.match(build, /expectedOrder/);
  assert.match(build, /recipientId/);
  assert.match(build, /recipientCenter/);
  assert.match(build, /spectatorExcluded/);
  assert.match(build, /participantIds/);
  assert.match(build, /excludedIds/);
  assert.match(build, /skippedReason/);
  assert.match(build, /participantSet/);
  assert.match(build, /excludedSet/);
  assert.match(build, /12000/);
});

test('public workflow asks for self and additional prank exclusions without guessing', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const workflow = fs.readFileSync(path.join(skillRoot, 'references', 'workflow-commands.md'), 'utf8');
  const runtime = fs.readFileSync(path.join(skillRoot, 'references', 'runtime-config.md'), 'utf8');

  assert.match(skill, /which numbered people must not join dad or grandpa pranks/i);
  assert.match(skill, /must automatically remain excluded/i);
  assert.match(skill, /Never infer either answer/i);
  assert.match(readme, /哪些人不参加“叫爸爸”和“叫爷爷”的恶搞/);
  assert.match(readme, /本人会被自动加入且不能移除/);
  assert.match(workflow, /--prank-excluded <none\|person-N,person-N>/);
  assert.match(runtime, /selection\.prankExcludedCharacterIds/);
  assert.match(runtime, /must contain `selection\.userCharacterId`/);
});

test('public contract makes the selected self the standing prank recipient', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const runtime = fs.readFileSync(path.join(skillRoot, 'references', 'runtime-config.md'), 'utf8');
  const platform = fs.readFileSync(path.join(skillRoot, 'references', 'platform-build.md'), 'utf8');

  assert.match(skill, /standing recipient/i);
  assert.match(skill, /recipientId/);
  assert.match(readme, /站立的“被膜拜者”/);
  assert.match(readme, /本人也会慢慢移动到队列正前方的中心位置/);
  assert.match(runtime, /standing recipient/i);
  assert.match(platform, /recipientId/);
});

test('public performance contract is measurable and exposes real Pause and Quit controls', () => {
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  for (const text of [readme, skill]) {
    assert.match(text, /30\s*fps/i);
    assert.match(text, /p95[^\n]*50\s*ms/i);
    assert.match(text, /10[^\n]*(?:分钟|minute)[^\n]*50\s*MB/i);
    assert.match(text, /ticker[^\n]*(?:25%|0\.25)/i);
  }
  assert.match(readme, /Pause|暂停/i);
  assert.match(readme, /Quit|退出/i);
  assert.match(readme, /private bytes/i);
  assert.match(readme, /working set[^\n]*(?:诊断|diagnostic)/i);
  assert.match(skill, /run_performance_audit\.mjs/);
});

test('runtime manual review fingerprint includes scenario captures and reports', () => {
  const selfCheck = fs.readFileSync(path.join(skillRoot, 'scripts', 'self_check_project.mjs'), 'utf8');
  assert.match(selfCheck, /function scenarioEvidenceFiles/);
  assert.match(selfCheck, /path\.join\(preview, 'scenarios'\)/);
  assert.match(selfCheck, /scenarioEvidenceFiles\(scenarioRoot\)/);
  assert.match(selfCheck, /combinedHash\(\[\s*`runtime:/s);
});

test('build reuses reviewed scenario evidence unless refresh is requested', () => {
  const build = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');
  assert.match(build, /const refreshScenario = args\['refresh-smoke'\] \|\| !fs\.existsSync\(reportPath\)/);
  assert.match(build, /if \(refreshScenario\) \{[\s\S]*runElectron/);
  assert.match(build, /\}\s*verifyScenarioReport\(scenario, reportPath\)/);
});
test('build fails closed on a missing or stale Windows performance report', () => {
  const build = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');
  assert.match(build, /performance-audit\.test\.mjs/);
  assert.match(build, /window-size-regression\.test\.mjs/);
  assert.match(build, /validate_performance_report\.mjs/);
  assert.match(build, /windows-performance-report\.json/);
  assert.match(build, /Performance report validation failed/);
});
