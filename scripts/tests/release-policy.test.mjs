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

test('release gate requires independent 90-point technical and humor thresholds', () => {
  const releaseCheck = fs.readFileSync(path.join(skillRoot, 'scripts', 'release_check.mjs'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(releaseCheck, /performance-v2\.test\.mjs/);
  assert.match(releaseCheck, /performance-audit\.test\.mjs/);
  assert.match(releaseCheck, /window-size-regression\.test\.mjs/);
  assert.match(releaseCheck, /utf8-integrity\.test\.mjs/);
  assert.match(readme, /self-check[^\n]*不低于 90/i);
  assert.match(skill, /self-check-report\.json[^\n]*score at least 90/i);
  assert.match(readme, /特殊恶搞[^\n]*低于 90[^\n]*不通过/);
  assert.match(skill, /special prank[^\n]*below 90[^\n]*fail/i);
  assert.match(releaseCheck, /validate-project\.test\.mjs/);
});

test('unified release check runs action-role and full-sequence evidence regressions', () => {
  const releaseCheck = fs.readFileSync(path.join(skillRoot, 'scripts', 'release_check.mjs'), 'utf8');
  assert.match(releaseCheck, /action-contract\.test\.mjs/);
  assert.match(releaseCheck, /scenario-sequence-evidence\.test\.mjs/);
});

test('build refresh can replace stale smoke evidence before the strict runtime gate', () => {
  const build = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');
  const initialGate = build.match(/if \(!runNode\(selfCheckScript, \[(.*?)\]\)\) \{/s)?.[1] || '';
  const runtimeGate = build.match(/if \(!runNode\(selfCheckScript, \['--project', project, '--preview', preview, '--runtime', runtime,(.*?)\]\)\) \{/s)?.[1] || '';

  assert.match(initialGate, /'--warn-only'/, 'pre-capture diagnostics must not block --refresh-smoke on stale runtime evidence');
  assert.doesNotMatch(runtimeGate, /'--warn-only'/, 'post-capture self-check must remain strict before packaging');
});

test('build refresh removes obsolete runtime pictures that can be mistaken for authoritative evidence', () => {
  const build = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');

  assert.match(build, /obsoleteRuntimeEvidenceNames/);
  assert.match(build, /normal-desktop-composite-v3\.png/);
  assert.match(build, /runtime-window-bottom-2x\.png/);
  assert.match(build, /windows-packaged-smoke\.png/);
  assert.match(build, /args\['refresh-smoke'\][\s\S]*fs\.rmSync\(obsoletePath/);
});

test('build refresh removes current runtime authority before capture and surfaces smoke errors', () => {
  const build = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');

  assert.match(build, /const runtimeSmokeError = path\.join\(preview, 'runtime-smoke-error\.txt'\)/);
  assert.match(build, /args\['refresh-smoke'\][\s\S]*for \(const file of \[\.\.\.runtimeEvidenceFiles, runtimeSmokeError\]\)[\s\S]*fs\.rmSync\(file/);
  assert.match(build, /if \(fs\.existsSync\(runtimeSmokeError\)\) fail\(/);
});

test('root Skill installation uses the verified download mode and rejects git-mode copies', () => {
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const installerCommands = [...readme.matchAll(/install-skill-from-github\.py[^\n]+/g)].map((match) => match[0]);
  assert.ok(installerCommands.length >= 2);
  assert.ok(installerCommands.every((command) => command.includes('--method download')));
  assert.match(readme, /不要对仓库根目录使用 `--method git --path \.`/);
  assert.match(readme, /会把临时 clone 的 `\.git` 一并复制/);
});

test('build gate runs and verifies both gradual group-shout scenarios', () => {
  const build = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');
  const main = fs.readFileSync(path.join(skillRoot, 'assets', 'electron-template', 'src', 'main.js'), 'utf8');
  const engine = fs.readFileSync(path.join(skillRoot, 'assets', 'electron-template', 'src', 'behavior-engine.js'), 'utf8');
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
  assert.match(build, /report\.workArea/);
  assert.match(build, /config\.render\.windowSize/);
  assert.match(build, /windowRect/);
  assert.match(build, /row-major order/);
  assert.match(build, /kneeling rows do not share a center axis/);
  assert.match(build, /recipient overlaps a kneeling participant/);
  assert.match(build, /keep facing the recipient throughout shouting/);
  assert.doesNotMatch(build, /3\s*->\s*1\s*->\s*2\s*->\s*4\s*->\s*5/);
  assert.match(build, /PET_SCENARIO_DURATION_MS:\s*String\(scenarioDurationMs\(scenario, config, behaviors\)\)/);
  assert.match(main, /workArea:\s*scenarioTest\?\.workArea\s*\|\|\s*primary\.workArea/);
  assert.match(engine, /const maxColumns = Math\.max\(1, Math\.floor\(\(workArea\.width \+ windowGap\) \/ \(windowSize \+ windowGap\)\)\)/);
  assert.match(engine, /for \(let index = 0; index < participants\.length; index \+= maxColumns\)/);
  assert.match(build, /completed formation characters visibly overlap/);
  assert.match(main, /PET_SCENARIO_WORK_AREA/);
  assert.match(main, /must stay inside the physical primary work area/);
});

test('self-poop scenario duration scales until every follower can eat once', async () => {
  const { scenarioDurationMs } = await import('../lib/scenario-timing.mjs');
  const config = {
    characters: Array.from({ length: 8 }, (_, index) => ({ id: `person-${index + 1}` })),
    selection: { userCharacterId: 'person-6', chaseVariant: 'self-poop' }
  };
  const behaviors = {
    poopChase: {
      initialDropDelayMs: 250,
      dropVisibleBeforeEatMs: 650,
      eatDurationMs: 420,
      consumedDelayMs: 240,
      roundResetDelayMs: 600
    }
  };
  const followerCount = 7;
  const minimumCycleBudget = 250 + followerCount * (650 + 420 + 240 + 600);
  const duration = scenarioDurationMs('poop-chase', config, behaviors);

  assert.ok(duration >= minimumCycleBudget + 4000, `${duration}ms does not leave enough capture margin`);
  assert.equal(duration % 1000, 0, 'capture duration should be rounded to stable whole seconds');
  assert.equal(scenarioDurationMs('dad-shout', config, behaviors), 20000);
  assert.equal(scenarioDurationMs('grandpa-shout', config, behaviors), 20000);
  assert.equal(scenarioDurationMs('centipede', config, behaviors), 6000);

  const build = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');
  assert.match(build, /scenarioDurationMs\(scenario, config, behaviors\)/);
});

test('build gate rejects mislabeled group-shout capture phases', () => {
  const build = fs.readFileSync(path.join(skillRoot, 'scripts', 'build_project.mjs'), 'utf8');

  assert.match(build, /forming-early.*forming-late.*kneeling.*shout-0.*shout-1.*shout-2/s);
  assert.match(build, /capture\.phase\s*!==\s*expectedPhase/);
  assert.match(build, /recorded phase/);
});

test('public workflow asks only for authorization, self, Chinese mode, and confirmation', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const workflow = fs.readFileSync(path.join(skillRoot, 'references', 'workflow-commands.md'), 'utf8');
  const interfaceYaml = fs.readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
  assert.match(skill, /authorization[^\n]*self[^\n]*Chinese mode[^\n]*confirmation/i);
  assert.match(skill, /普通桌宠[^\n]*集体跪喊[^\n]*屎追逐[^\n]*全部都要/);
  assert.doesNotMatch(skill, /which numbered people must not join/i);
  assert.doesNotMatch(skill, /ask separately who starts/i);
  assert.match(readme, /授权、本人、中文模式和最终确认/);
  assert.doesNotMatch(readme, /哪些人不参加“叫爸爸”和“叫爷爷”的恶搞/);
  assert.doesNotMatch(readme, /谁在最前面负责先拉/);
  assert.doesNotMatch(workflow, /--prank-excluded/);
  assert.doesNotMatch(workflow, /--leader|--followers/);
  assert.match(interfaceYaml, /授权[^\n]*本人[^\n]*模式[^\n]*最终确认/);
  assert.doesNotMatch(interfaceYaml, /确认授权、本人、模式和必要的接力顺序|选择(?:领头人|跟随者|吃拉顺序)/);
});

test('first photo reply reuses valid answers already supplied and asks only the next missing item', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');

  assert.match(skill, /first reply[\s\S]*next missing required question/i);
  assert.match(skill, /authorization[^\n]*already supplied[^\n]*do not ask it again/i);
  assert.match(skill, /authorization[^\n]*self[^\n]*mode[^\n]*already[^\n]*final confirmation/i);
  assert.doesNotMatch(skill, /only the authorization question/i);
  assert.match(readme, /首轮[^\n]*诊断[^\n]*编号[^\n]*下一个缺失项/);
  assert.match(readme, /已经说明[^\n]*都同意[^\n]*不得重复询问授权/);
});

test('skill gives ordinary users branch-aware mode copy and the complete delivery flow', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const interfaceYaml = fs.readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');

  for (const text of [skill, readme]) {
    assert.match(text, /没回答本人是谁[^\n]*不等于[^\n]*本人不在/);
    assert.match(text, /明确回复[^\n]*不在/);
    assert.match(text, /普通桌宠[^\n]*自由活动/);
    assert.match(text, /集体跪喊[^\n]*爸爸[^\n]*爷爷/);
    assert.match(text, /屎追逐[^\n]*本人[^\n]*持续拉[^\n]*全员[^\n]*追吃/);
    assert.match(text, /屎追逐[^\n]*鼠标[^\n]*屎[^\n]*人形蜈蚣/);
    assert.match(text, /上传照片[^\n]*(?:→|->)[^\n]*授权[^\n]*(?:→|->)[^\n]*本人[^\n]*(?:→|->)[^\n]*模式[^\n]*(?:→|->)[^\n]*最终确认/);
    assert.match(text, /身份确认[^\n]*(?:→|->)[^\n]*动作确认[^\n]*(?:→|->)[^\n]*逐模式搞笑评分[^\n]*(?:→|->)[^\n]*构建与真实运行验收/);
  }

  assert.match(skill, /用户可以一次说完/);
  assert.match(skill, /都同意，我是3号，全部都要/);
  assert.match(readme, /都同意，我不在照片里，全部都要/);
  assert.doesNotMatch(readme, /没有指定本人时[，,][^\n]*全员跪/);
  assert.match(interfaceYaml, /没回答本人是谁不等于本人不在/);
});

test('ordinary guidance exposes dad and grandpa as separate scenes without adding extra user choices', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');

  for (const text of [skill, readme]) {
    assert.match(text, /集体跪喊[^\n]*一个(?:用户)?选项[^\n]*爸爸[^\n]*爷爷[^\n]*两个独立场景/);
    assert.match(text, /全部都要[^\n]*四个可见场景[^\n]*普通桌宠[^\n]*爸爸[^\n]*爷爷[^\n]*屎追逐/);
  }
  assert.doesNotMatch(skill, /5\s+爸爸喊|6\s+爷爷喊/);
});

test('public mode contract adapts kneeling and poop chase to whether self is present', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const runtime = fs.readFileSync(path.join(skillRoot, 'references', 'runtime-config.md'), 'utf8');

  for (const text of [skill, readme, runtime]) {
    assert.match(text, /本人[^\n]*(?:站立|不跪)[^\n]*(?:其他|其余)[^\n]*(?:全部|全员)[^\n]*跪/);
    assert.match(text, /没有指定本人|本人不在照片/);
    assert.match(text, /全员[^\n]*跪[^\n]*(?:爸爸|爷爷)/);
    assert.match(text, /鼠标[^\n]*(?:控制|跟随)[^\n]*屎/);
    assert.match(text, /点击穿透/);
    assert.match(text, /人形蜈蚣[^\n]*追/);
    assert.match(text, /本人[^\n]*(?:持续拉|负责拉)[^\n]*(?:其他|其余)[^\n]*(?:全部|全员)[^\n]*(?:追吃|追着吃)/);
  }
});

test('one-person photo with self clearly skips both impossible prank modes', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');

  assert.match(skill, /one-person photo and self present[^\n]*group shout and poop chase are both safely skipped[^\n]*only normal desktop pet remains active/i);
  assert.match(readme, /一人照片[^\n]*本人[^\n]*集体跪喊和屎追逐整体安全跳过[^\n]*只保留普通桌宠/);
});

test('one-person photo without self keeps group shout and cursor-poop chase available', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');

  assert.match(skill, /one-person photo and no self selected[^\n]*group shout and cursor-poop chase remain available/i);
  assert.match(readme, /一人照片[^\n]*本人不在[^\n]*全员跪喊[^\n]*鼠标屎追逐[^\n]*仍然可用/);
});

test('ordinary user flow separates identity and action approval before humor optimization and runtime acceptance', () => {
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');

  assert.match(readme, /身份确认[\s\S]*动作确认[\s\S]*逐(?:模式|场景)搞笑评分[\s\S]*构建与真实运行验收/);
  assert.match(readme, /低于 ?90[\s\S]*优化[\s\S]*复评/);
});

test('both self branches explain the automatic single-row and overflow layout', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');

  for (const text of [skill, readme]) {
    assert.match(text, /有本人[^\n]*(?:单排|一排)[^\n]*(?:多排|放不下)/);
    assert.match(text, /本人不在[^\n]*(?:单排|一排)[^\n]*(?:多排|放不下)/);
  }
});

test('built-in image recovery rejects stale cache and preserves the native generation event', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const visual = fs.readFileSync(path.join(skillRoot, 'references', 'visual-generation.md'), 'utf8');

  assert.match(skill, /stale generated-images cache/i);
  assert.match(visual, /generated_images[^\n]*(?:旧缓存|stale)/i);
  assert.match(visual, /image_generation_call[^\n]*(?:id|ig_id)[^\n]*result/i);
  assert.match(visual, /session[^\n]*JSONL/i);
  assert.match(visual, /PNG[^\n]*(?:签名|signature)[^\n]*(?:尺寸|dimensions)[^\n]*SHA-256/i);
  assert.match(visual, /不得[^\n]*(?:仅因|因为)[^\n]*(?:缓存|落盘)[^\n]*(?:CLI|gpt-image-1\.5)/i);
  assert.match(visual, /不同[^\n]*(?:人物|资产)[^\n]*SHA-256[^\n]*(?:唯一|不同)/i);
});

test('manual humor gate records all six weighted dimensions and rejects special pranks below 90', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const selfCheck = fs.readFileSync(path.join(skillRoot, 'references', 'self-check.md'), 'utf8');
  const evidence = fs.readFileSync(path.join(skillRoot, 'docs', 'release-evidence-template.md'), 'utf8');
  const implementation = fs.readFileSync(path.join(skillRoot, 'scripts', 'self_check_project.mjs'), 'utf8');

  for (const text of [skill, readme, selfCheck, evidence]) {
    assert.match(text, /角色关系[^\n]*25/);
    assert.match(text, /荒诞[^\n]*20/);
    assert.match(text, /节奏[^\n]*20/);
    assert.match(text, /队形[^\n]*15/);
    assert.match(text, /屎[^\n]*可读[^\n]*10/);
    assert.match(text, /回看欲[^\n]*10/);
    assert.match(text, /特殊恶搞[^\n]*低于 90[^\n]*(?:不通过|失败)/);
  }
  assert.match(skill, /every enabled special prank: dad shout, grandpa shout, and the active poop-chase variant[^\n]*Every prank below 90 must fail/i);
  assert.match(skill, /Score each selected special prank independently/i);
  assert.match(skill, /dad-shout[^\n]*grandpa-shout[^\n]*(?:poop-chase|cursor-centipede)/i);
  assert.match(readme, /三份独立审核/);
  assert.match(readme, /爸爸喊[^\n]*爷爷喊[^\n]*当前启用的屎追逐变体[^\n]*分别达到 90 分[^\n]*不能取平均分/);
  assert.match(selfCheck, /爸爸喊[^\n]*爷爷喊[^\n]*当前追逐变体[^\n]*逐个打分[^\n]*不能用一份聚合分数/);
  assert.match(selfCheck, /任一条目低于 90 分[^\n]*不能靠其它条目高分弥补/);
  for (const text of [skill, readme]) {
    assert.match(text, /普通桌宠模式不要求[^\n]*(?:humor review|搞笑评分)/i);
  }
  for (const text of [skill, readme, selfCheck, evidence]) {
    assert.match(text, /扣分[^\n]*(?:优化|改动)[^\n]*(?:重新截图|重拍)[^\n]*复评/);
  }
  assert.match(selfCheck, /schemaVersion 3/);
  assert.match(selfCheck, /evidenceRefs/);
  assert.match(evidence, /评分契约 fingerprint/);
  assert.match(implementation, /stableSerialize\(humorContract\)/);
  assert.match(implementation, /humor-contract:\$\{humorContractFingerprint\}/);
  assert.match(implementation, /release-eligible-desktop-compositor-capture/);
  assert.match(implementation, /captureKind:\s*'desktop-compositor'/);
  assert.match(implementation, /releaseEligible:\s*true/);
});

test('manual humor gate fails visually correct-but-unfunny compositions', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');

  for (const text of [skill, readme]) {
    assert.match(text, /本人[^\n]*跪拜队[^\n]*一个人物身高[^\n]*(?:失败|返工)/);
    assert.match(text, /爸爸[^\n]*爷爷[^\n]*(?:只|仅)[^\n]*(?:换字|文字)[^\n]*(?:换色|颜色)[^\n]*(?:失败|返工)/);
    assert.match(text, /吃[^\n]*嘴[^\n]*(?:接触|碰到)[^\n]*屎[^\n]*(?:失败|返工)/);
    assert.match(text, /人形蜈蚣[^\n]*断链[^\n]*(?:失败|返工)/);
  }
});

test('public contract adapts the standing prank recipient to self presence', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const runtime = fs.readFileSync(path.join(skillRoot, 'references', 'runtime-config.md'), 'utf8');
  const platform = fs.readFileSync(path.join(skillRoot, 'references', 'platform-build.md'), 'utf8');

  assert.match(skill, /standing recipient/i);
  assert.match(skill, /no recipient/i);
  assert.match(readme, /站立的“被膜拜者”/);
  assert.match(readme, /本人不在照片时[^\n]*不虚构/);
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

test('public contract treats five people as an example and supports random one-to-eight-person photos', () => {
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');

  assert.match(readme, /任意\s*1[–-]8\s*人/);
  assert.match(readme, /五人[^\n]*示例/);
  assert.match(readme, /空间不足[^\n]*多排/);
  assert.match(readme, /本人位置[^\n]*(?:不固定|任意)/);
  assert.match(skill, /one-to-eight-person photo/i);
  assert.match(skill, /multi-row/i);
  assert.match(skill, /five-person[^\n]*example/i);
});

test('release suite directly exercises every supported one-to-eight-person shout count', () => {
  const behaviorTests = fs.readFileSync(
    path.join(skillRoot, 'assets', 'electron-template', 'tests', 'behavior-engine.test.mjs'),
    'utf8'
  );
  assert.match(behaviorTests, /every supported one-to-eight-person shout count/);
  for (let count = 1; count <= 8; count += 1) {
    assert.match(behaviorTests, new RegExp(`count:\\s*${count}(?:\\D|$)`));
  }
});

test('performance gate directly exercises every supported one-to-eight-person window count', () => {
  const performanceTests = fs.readFileSync(
    path.join(skillRoot, 'scripts', 'tests', 'performance-gate.test.mjs'),
    'utf8'
  );
  assert.match(performanceTests, /every supported one-to-eight-person window count/);
  assert.match(performanceTests, /expectedWindowCount/);
  assert.match(performanceTests, /windowCount/);
  assert.match(performanceTests, /continuouslyVisibleIds/);
  for (let count = 1; count <= 8; count += 1) {
    assert.match(performanceTests, new RegExp(`count:\\s*${count}(?:\\D|$)`));
  }
});

test('release suite locks arbitrary self positions and photos where the user is absent', () => {
  const behaviorTests = fs.readFileSync(
    path.join(skillRoot, 'assets', 'electron-template', 'tests', 'behavior-engine.test.mjs'),
    'utf8'
  );
  assert.match(behaviorTests, /every supported self position remains the standing recipient/);
  assert.match(behaviorTests, /a photo without the user has no standing recipient/);
  assert.match(behaviorTests, /without the user makes every character kneel even when legacy exclusions are present/);
  assert.match(behaviorTests, /selected self as the only source while every other character eats/);
  assert.match(behaviorTests, /without a selected self makes every character a centipede chasing cursor-controlled poop/);
});

test('runtime manual review fingerprint includes scenario captures and reports', () => {
  const selfCheck = fs.readFileSync(path.join(skillRoot, 'scripts', 'self_check_project.mjs'), 'utf8');
  assert.match(selfCheck, /function scenarioEvidenceFiles/);
  assert.match(selfCheck, /path\.join\(preview, 'scenarios'\)/);
  assert.match(selfCheck, /scenarioEvidenceFiles\(scenarioRoot\)/);
  assert.match(selfCheck, /combinedHash\(\[\s*'runtime:manual-review'/s);
  assert.match(selfCheck, /`humor-contract:\$\{humorContractFingerprint\}`/);
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

test('本地与 CI 发布门禁显式运行全部透明恢复测试', () => {
  const releaseCheck = fs.readFileSync(path.join(skillRoot, 'scripts', 'release_check.mjs'), 'utf8');
  const workflow = fs.readFileSync(path.join(skillRoot, '.github', 'workflows', 'release-check.yml'), 'utf8');
  const requiredTests = [
    'portrait-chroma.test.mjs',
    'repair-transparency-cli.test.mjs',
    'transparency-repair.test.mjs',
    'transparency-repair-security.test.mjs',
    'mask-editor-contract.test.mjs',
    'transparency-retry.test.mjs',
    'trusted-corrected-processing.test.mjs'
  ];
  for (const file of requiredTests) {
    assert.match(releaseCheck, new RegExp(file.replaceAll('.', '\\.')),
      `本地发布门禁遗漏 ${file}`);
    assert.match(workflow, new RegExp(file.replaceAll('.', '\\.')),
      `GitHub Actions 遗漏 ${file}`);
  }
});

test('本地与 CI 发布门禁显式验证 macOS Electron framework 链接', () => {
  const releaseCheck = fs.readFileSync(path.join(skillRoot, 'scripts', 'release_check.mjs'), 'utf8');
  const workflow = fs.readFileSync(path.join(skillRoot, '.github', 'workflows', 'release-check.yml'), 'utf8');
  for (const source of [releaseCheck, workflow]) {
    assert.match(source, /macos-electron-runtime\.test\.mjs/);
  }
});

test('第三方说明与根级 MIT 许可证保持一致', () => {
  const license = fs.readFileSync(path.join(skillRoot, 'LICENSE'), 'utf8');
  const notices = fs.readFileSync(path.join(skillRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(notices, /本项目采用 MIT 许可证/);
  assert.doesNotMatch(notices, /没有可验证的根级 `LICENSE`|没有.*许可证/);
});

test('README 和 Skill 说明透明恢复的隐私边界与失败关闭规则', () => {
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');

  for (const phrase of ['远程图像生成', '本地去背', '本地蒙版修正', '不上传修正图片', '最多三次', '失败关闭']) {
    assert.match(readme, new RegExp(phrase), `README 缺少“${phrase}”`);
  }
  assert.match(readme, /--ref/);
  assert.match(readme, /稳定标签/);
  assert.match(readme, /精确 SHA/);

  assert.match(skill, /at most three/i);
  assert.match(skill, /127\.0\.0\.1/);
  assert.match(skill, /local mask repair/i);
  assert.match(skill, /must not upload/i);
  assert.match(skill, /fail closed/i);
});

test('真透明 fallback 必须是显式授权的可选路径', () => {
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const runtime = fs.readFileSync(path.join(skillRoot, 'references', 'codex-runtime.md'), 'utf8');

  for (const document of [readme, skill, runtime]) {
    assert.match(document, /gpt-image-1\.5/i);
    assert.match(document, /OPENAI_API_KEY/);
    assert.match(document, /显式授权/);
    assert.match(document, /真透明/);
  }
  assert.match(skill, /不得静默切换/);
  assert.match(runtime, /默认路径仍使用内置.*imagegen/s);
});

test('第三方说明和发布证据模板覆盖可审计交付项', () => {
  const notices = fs.readFileSync(path.join(skillRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const evidence = fs.readFileSync(path.join(skillRoot, 'docs', 'release-evidence-template.md'), 'utf8');

  assert.match(notices, /Electron 41\.0\.2/);
  assert.match(notices, /MIT/);
  assert.match(notices, /Sharp 0\.34\.5/);
  assert.match(notices, /Apache-2\.0/);
  assert.match(notices, /运行时下载/);
  assert.match(notices, /本项目采用 MIT 许可证/);
  assert.match(notices, /根目录 `LICENSE`/);

  for (const heading of [
    'GitHub 精确版本', 'CI 终态', '官方安装器', '陌生用户 E2E',
    '视觉验收', '性能验收', 'Windows 打包', '隐私审计'
  ]) assert.match(evidence, new RegExp(heading));
  assert.doesNotMatch(evidence, /[A-Za-z]:\\|\/Users\//,
    '公开证据模板不得包含私有绝对路径');
});

test('local and CI release gates include the schema-v4 performance contract suite', () => {
  const releaseCheck = fs.readFileSync(path.join(skillRoot, 'scripts', 'release_check.mjs'), 'utf8');
  const workflow = fs.readFileSync(path.join(skillRoot, '.github', 'workflows', 'release-check.yml'), 'utf8');
  for (const source of [releaseCheck, workflow]) assert.match(source, /performance-contract-v4\.test\.mjs/);
});

test('release README contains an immutable stable tag instead of a placeholder', () => {
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /<stable-tag>/);
  assert.match(readme, /\$ref\s*=\s*"v\d+\.\d+\.\d+"/);
  assert.match(readme, /REF="v\d+\.\d+\.\d+"/);
});
