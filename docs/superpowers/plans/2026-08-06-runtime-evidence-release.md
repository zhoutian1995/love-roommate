# Runtime Evidence Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the misleading staged normal screenshot with separate technical and real desktop evidence, repair weak scenario presentation, then package and publish the Skill from one verified exact commit.

**Architecture:** The Electron runtime will capture two evidence classes: live desktop frames before any staging and a deterministic multi-window technical composition after staging. The project validator will require both classes and will prevent structural evidence from satisfying manual product review. Existing scenario and performance systems remain authoritative for behavior, timing, window lifecycle, and release thresholds.

**Tech Stack:** Electron 41.0.2, Node.js test runner, Sharp 0.34.5, PowerShell on Windows, GitHub Actions, Codex Skill validator.

## Global Constraints

- Never publish private photos, private person artwork, or private runtime screenshots.
- Preserve all current uncommitted work; do not reset or overwrite unrelated changes.
- Use the bundled Node, pnpm, Sharp, Python, and Git paths returned by Codex Desktop.
- Write a failing regression test before each production-code change.
- Keep 30 fps, active-frame p95 <= 50 ms, average total CPU <= 10%, startup visibility <= 5 seconds, total private bytes <= 500 MB, 10-minute private-memory growth <= 50 MB, paused CPU <= half of idle, and paused ticker updates <= 25% of idle.
- Do not relax identity, transparency, action, privacy, performance, or exact-ref gates.
- Do not commit private generated output.

---

### Task 1: Separate product and technical runtime evidence

**Files:**
- Modify: `assets/electron-template/src/main.js`
- Modify: `assets/electron-template/tests/scenario-capture.test.mjs`
- Modify: `scripts/build_project.mjs`
- Test: `scripts/tests/security-hardening.test.mjs`

**Interfaces:**
- Consumes: `PET_SMOKE_OUT`, primary-display work area, live `petWindows`.
- Produces: `runtime-window.png`, `runtime-window-2.png`, `runtime-smoke-technical.png`, and `runtime-evidence-manifest.json`.

- [ ] **Step 1: Write failing tests for evidence ordering and separation**

```js
test('product frames are captured before deterministic smoke staging', () => {
  const source = fs.readFileSync(mainFile, 'utf8');
  const smoke = source.slice(source.indexOf('async function runSmokeCapture()'));
  assert.match(smoke, /captureDesktopWithPets[\s\S]*stageSmokeLayout\(\)/);
  assert.match(smoke, /runtime-smoke-technical\.png/);
});

test('build keeps product runtime evidence separate from structural smoke', () => {
  const source = fs.readFileSync(buildFile, 'utf8');
  assert.match(source, /runtime-window\.png/);
  assert.match(source, /runtime-smoke-technical\.png/);
  assert.doesNotMatch(source, /PET_SMOKE_OUT:\s*runtime\b/);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
$env:NODE_PATH='C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test assets/electron-template/tests/scenario-capture.test.mjs scripts/tests/security-hardening.test.mjs
```

Expected: FAIL because desktop product capture and the separate technical filename are absent.

- [ ] **Step 3: Implement desktop capture before staging**

Add `desktopCapturer` to the Electron imports and implement:

```js
async function captureDesktopWithPets(display) {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
  });
  const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('Primary display capture was unavailable.');
  return source.thumbnail.toPNG();
}
```

Capture two live frames with a bounded delay, then call `stageSmokeLayout()` and write the deterministic composition to `runtime-smoke-technical.png`. Write a relative-path manifest containing capture kind, filenames, timestamps, expected character ids, and SHA-256 values.

- [ ] **Step 4: Update build paths and run focused tests GREEN**

Run the Step 2 command. Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add assets/electron-template/src/main.js assets/electron-template/tests/scenario-capture.test.mjs scripts/build_project.mjs scripts/tests/security-hardening.test.mjs
git commit -m "fix: separate product and structural runtime evidence"
```

### Task 2: Enforce the revised visual evidence contract

**Files:**
- Modify: `scripts/self_check_project.mjs`
- Modify: `references/self-check.md`
- Modify: `scripts/tests/security-hardening.test.mjs`

**Interfaces:**
- Consumes: the four evidence files from Task 1 and existing `self-check-review.json`.
- Produces: explicit `runtime-product-evidence-*` errors and a fingerprint covering both product frames plus technical evidence.

- [ ] **Step 1: Write failing validation tests**

```js
test('self-check rejects a technical strip used as product evidence', async () => {
  const fixture = createReadableRuntimeFixture(t);
  fs.writeFileSync(path.join(fixture.preview, 'runtime-smoke-technical.png'), rgbaPng(48, 24, () => true));
  const result = run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'runtime-product-evidence-missing'));
});

test('self-check rejects identical normal-mode frames', async () => {
  const fixture = createReadableRuntimeFixture(t);
  const frame = rgbaPng(48, 24, (x, y) => x >= 4 && x <= 12 && y >= 5 && y <= 19);
  fs.writeFileSync(path.join(fixture.preview, 'runtime-window.png'), frame);
  fs.writeFileSync(path.join(fixture.preview, 'runtime-window-2.png'), frame);
  const result = run('self_check_project.mjs', ['--project', fixture.project, '--preview', fixture.preview, '--warn-only']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(fixture.preview, 'self-check-report.json'), 'utf8'));
  assert.ok(report.issues.some((issue) => issue.code === 'runtime-product-evidence-frozen'));
});
```

Extract the setup already used by `self-check accepts a readable multi-window runtime composition` into `createReadableRuntimeFixture(t)`, returning `{ root, project, preview }`; keep all file creation inside the test workspace.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test scripts/tests/security-hardening.test.mjs
```

Expected: FAIL because the new errors are not emitted.

- [ ] **Step 3: Implement evidence validation**

Require:

```js
const requiredKinds = new Set(['normal-live-1', 'normal-live-2', 'technical-window-count']);
```

Reject missing files, stale files, absolute manifest paths, identical product SHA-256 values, product dimensions smaller than the primary work area declared by the manifest, and a manual review fingerprint that does not cover all evidence files. Treat per-window alpha captures as transparency evidence and desktop frames as product-composition evidence; neither substitutes for the other.

- [ ] **Step 4: Update documentation and run focused tests GREEN**

Run the Step 2 command. Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add scripts/self_check_project.mjs scripts/tests/security-hardening.test.mjs references/self-check.md
git commit -m "fix: require live runtime visual evidence"
```

### Task 3: Repair dad/grandpa spacing and relay effect placement

**Files:**
- Modify: `assets/electron-template/src/behavior-engine.js`
- Modify: `assets/electron-template/tests/behavior-engine.test.mjs`
- Modify: `assets/electron-template/src/main.js`

**Interfaces:**
- Consumes: `spriteSize`, `windowSize`, participant ids, recipient id, and sprite anchors.
- Produces: compact participant target centers, a separated centered recipient target, and a dropping position behind the active source without torso overlap.

- [ ] **Step 1: Write failing geometry tests**

```js
test('group shout visible bodies use sprite-sized spacing while windows remain in bounds', () => {
  const engine = makeEngine({ people: 5, self: 3 });
  engine.callDad();
  const targets = [...engine.shoutSequence.targets.values()];
  const centers = targets.map((target) => target.x + engine.config.render.spriteSize / 2);
  for (let index = 1; index < centers.length; index += 1) {
    assert.ok(centers[index] - centers[index - 1] <= engine.config.render.spriteSize * 1.35);
  }
});

test('relay dropping is outside the active source torso bounds', () => {
  const engine = makeRelayEngine();
  const { settings, participants } = engine.poopChaseParticipants();
  engine.poopRelay = { sourceIndex: 0, stage: 'source-poop', stageStartedAt: 0, droppingId: null };
  engine.createRelayDropping(settings, participants);
  const dropping = engine.droppings.at(-1);
  const source = participants[0];
  assert.ok(dropping.x < source.x || dropping.x > source.x + engine.config.render.spriteSize);
});
```

- [ ] **Step 2: Run behavior tests and confirm RED**

Run:

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test assets/electron-template/tests/behavior-engine.test.mjs
```

Expected: FAIL on current window-sized row spacing and current dropping placement.

- [ ] **Step 3: Implement compact target geometry**

Compute visible-body centers using `spriteSize + max(12, spriteSize * 0.12)` while validating the full `windowSize` bounds. Keep the recipient on the same center axis with at least `max(24, spriteSize * 0.22)` visible separation from the row. Derive relay dropping positions from the source rear anchor plus a side offset of at least `effectSize / 2`, clamped to the active display.

- [ ] **Step 4: Run behavior and scenario tests GREEN**

Run:

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test assets/electron-template/tests/behavior-engine.test.mjs assets/electron-template/tests/scenario-capture.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add assets/electron-template/src/behavior-engine.js assets/electron-template/tests/behavior-engine.test.mjs assets/electron-template/src/main.js
git commit -m "fix: improve group and relay scene composition"
```

### Task 4: Rebuild and visually approve the private five-person candidate

**Files:**
- Update generated private project under the active workspace only.
- Do not add generated files to the Skill repository.

**Interfaces:**
- Consumes: current Skill working tree and the approved private sprites.
- Produces: revised normal, centipede, relay, dad, grandpa, pause, packaged, privacy, and performance evidence.

- [ ] **Step 1: Run the complete repository test suite**

```powershell
$env:NODE_PATH='C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test assets/electron-template/tests/*.test.mjs scripts/tests/*.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Refresh the private project runtime from the working tree**

Use `scripts/build_project.mjs --refresh-smoke` with bundled `--pnpm` and `--node-modules`, then run the normal, centipede, relay, dad, grandpa, and pause scenario capture commands documented in `references/workflow-commands.md`.

- [ ] **Step 3: Inspect every required image with `view_image`**

Fail the review if normal frames are frozen or unreadable, centipede anchors are visually detached, relay has more than one dropping or torso overlap, the recipient kneels or receives a bubble, participants overlap, or any composition is clipped.

- [ ] **Step 4: Complete the fresh visual fingerprint and verify-only build**

Run `scripts/self_check_project.mjs`, update `self-check-review.json` only from inspected images, then run `scripts/build_project.mjs --verify-only`.

- [ ] **Step 5: Run the full Windows performance audit sequentially**

```powershell
$privateRoot='C:\Users\admin\Documents\Codex\2026-08-06\019fc889-4b28-7792-b8ab-ebf45324281d\work\private-five-latest-runtime'
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/run_performance_audit.mjs --project (Join-Path $privateRoot 'project') --executable (Join-Path $privateRoot 'project\dist\windows\Five Friends Desktop Pet\Five Friends Desktop Pet.exe') --report (Join-Path $privateRoot 'preview\performance\windows-performance-report.json')
```

Expected: all thresholds pass, every expected pet window remains present and visible through all phases, and the report candidate fingerprint matches the packaged candidate.

### Task 5: Public release candidates and repository release gates

**Files:**
- Update public fictional fixture outputs outside the repository.
- Modify repository files only for defects found by the gates.

**Interfaces:**
- Consumes: the same Skill commit candidate used by the private project.
- Produces: fictional five- and eight-person Windows reports with matching code fingerprints.

- [ ] **Step 1: Build fictional five- and eight-person candidates sequentially**

Use the documented fixture generator and build commands. Do not run the two full performance audits concurrently.

- [ ] **Step 2: Run both full packaged performance audits**

Validate them together with:

```powershell
$fiveRoot=Join-Path $env:TEMP 'love-roommate-release-five'
$eightRoot=Join-Path $env:TEMP 'love-roommate-release-eight'
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/validate_performance_release.mjs `
  --five-project (Join-Path $fiveRoot 'project') `
  --five-report (Join-Path $fiveRoot 'preview\performance\windows-performance-report.json') `
  --five-executable (Join-Path $fiveRoot 'project\dist\windows\Fictional Five Desktop Pet\Fictional Five Desktop Pet.exe') `
  --five-packaged-root (Join-Path $fiveRoot 'project\dist\windows\Fictional Five Desktop Pet\resources\app') `
  --eight-project (Join-Path $eightRoot 'project') `
  --eight-report (Join-Path $eightRoot 'preview\performance\windows-performance-report.json') `
  --eight-executable (Join-Path $eightRoot 'project\dist\windows\Fictional Eight Desktop Pet\Fictional Eight Desktop Pet.exe') `
  --eight-packaged-root (Join-Path $eightRoot 'project\dist\windows\Fictional Eight Desktop Pet\resources\app')
```

Expected: pass with identical candidate code fingerprints and exact window counts 5 and 8.

- [ ] **Step 3: Run privacy, unified release, validator, and diff gates**

Run `scripts/audit_skill_release.mjs`, `scripts/release_check.mjs`, the official Skill validator, and `git diff --check`. Expected: zero failures, zero private paths, and zero raster person files.

- [ ] **Step 4: Independent code review and fixes**

Review every changed source and test file for correctness, security, privacy, portability, and over-broad release claims. Apply fixes with new failing tests and rerun all gates.

- [ ] **Step 5: Commit the final release candidate**

Stage only intended repository files and use Conventional Commits. Confirm the worktree is clean before pushing.

### Task 6: Publish and exact-ref verification

**Files:**
- Create user deliverables only under the active thread `outputs/` directory.
- Do not write long-term generated assets into the Skill repository.

**Interfaces:**
- Consumes: one clean 40-character Git commit.
- Produces: GitHub tag/release, green CI, exact-ref installs, Windows and Apple-silicon builds, and final private Windows deliverables.

- [ ] **Step 1: Push the branch and publish the stable tag**

Push the audited commit, create the release tag, and publish the GitHub release. Record the exact commit and tree SHA.

- [ ] **Step 2: Wait for all GitHub Actions jobs**

Require final success for Windows release-check, macOS release-check, and official Skill validator.

- [ ] **Step 3: Verify official installer download mode**

Set `$releaseSha = (& git rev-parse HEAD).Trim()` and install from `--method download --ref $releaseSha` into an isolated directory. Compare tracked file count, missing files, extra files, and every SHA-256 against the Git tree; require zero mismatches and no `.git` directory.

- [ ] **Step 4: Rebuild on Windows and Mac mini from the exact ref**

Use the exact-ref clean clone on Windows and SSH to the Apple-silicon Mac mini. Verify Windows portable startup and macOS arm64 app startup plus framework relative symlinks.

- [ ] **Step 5: Refresh the private project from the exact ref and deliver**

Build the final Windows portable directory and ZIP, rerun privacy and packaged smoke checks, and copy only user-facing deliverables and the redacted acceptance report into `outputs/`.

- [ ] **Step 6: Final completion audit**

Re-read the design, this plan, `SKILL.md`, and the release checklist. For every requirement, point to fresh direct evidence. Mark the goal complete only when no item is missing, indirect, stale, or failed.
