---
name: love-roommate
description: Diagnose a photo containing one to eight people, let the user identify themselves and choose normal, mouse-centipede, sequential poop-relay, or combined behavior, then guide their own image generation, validate the assets, and build a configurable cross-platform Electron desktop-pet project. Use for photo/group-photo desktop pets, crawling swarms, identity/action-sheet methods, transparent sprite checking, mouse-following formations, ordered eat-then-drop relays, portable Windows app folders, or unsigned Apple-silicon macOS apps.
---

# Love Roommate

Operate as a reusable method, mode library, and validation harness, not as a bundled character-asset pack. Diagnose the input, offer supported modes, guide the current user through generating and approving their own assets, process those assets, validate the result, and package an editable project. The published Skill contains no person's photo or generated character art.

## Required workflow

1. In Codex Desktop, call `codex_app__load_workspace_dependencies` and use its bundled Node and pnpm paths. Read [references/codex-runtime.md](references/codex-runtime.md). Never ask the user to install Node, npm, pnpm, Python, PyInstaller, Electron, or an image API key.
2. Read [references/visual-generation.md](references/visual-generation.md) before generating character art.
3. Diagnose the input before generation. Validate that it contains 1-8 separable people, number them left-to-right unless the user supplies another mapping, and report ambiguous faces, occlusion, duplicate clothing, cropping, or low resolution.
4. Show the numbered mapping and require the user to choose whether they appear in the photo. Record `none` or the selected `person-N`; never infer this silently.
5. Require a behavior choice before generation: `normal`, `centipede`, `poop-relay`, or `all`. For `poop-relay`/`all`, separately require one leader and an ordered follower list. The user's own character does not automatically become the leader.
6. Tell the user that the reference photo is sent to the image-generation tool but is represented in the project only by a SHA-256 fingerprint and is never bundled into the app.
7. Guide the current user to generate an identity board with `$imagegen` from their own uploaded photo and save it only under `<output root>/preview/identity-board.png`. Final user-project artwork in this workflow must use GPT Image 2 exclusively. Never store generated person art inside the Skill directory.
8. Pause for the first approval. Require confirmation of face, hair, clothing, numbering, person separation, self selection, selected mode, and relay order.
9. Create the output without overwriting an existing directory. Invoke the bundled Node executable directly on either Windows or macOS; add `--leader` and ordered `--followers` only for `poop-relay`/`all`:
   ```text
   "<codex-node>" "<skill>/scripts/create_project.mjs" --name "<app name>" --out "<output root>" --source "<photo>" --people <1-8> --names "<comma-separated names>" --mode <normal|centipede|poop-relay|all> --self <none|person-N> [--leader person-N --followers "person-N,person-N"]
   ```
10. Generate one fixed 4x3 action sheet per approved character using the identity board as the identity reference, then process it. Pass Codex's bundled module path as an argument; do not install Sharp into the project:
   ```text
   "<codex-node>" "<skill>/scripts/process_sprites.mjs" --project "<output root>/project" --sheet "<sheet.png>" --character person-1 --node-modules "<codex-node-modules>"
   ```
   Before processing each final identity, base, or role sheet, record its GPT Image 2 provenance. The recorder rejects every other model and fingerprints the exact file:
   ```text
   "<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<output root>/preview" --file "<sheet.png>" --kind base --character person-1 --model gpt-image-2
   ```
   When `poopChase.enabled` is true, also generate and process one 2x1 role sheet per participant. Use `--role leader` for `poop_right`/`poop_left` and `--role follower` for `eat_right`/`eat_left`:
   ```text
   "<codex-node>" "<skill>/scripts/process_role_sprites.mjs" --project "<output root>/project" --sheet "<role-sheet.png>" --character person-1 --role leader --node-modules "<codex-node-modules>"
   ```
11. Build the contact sheet, run asset/privacy validation, and prepare the self-check report. The first self-check intentionally exits nonzero after creating a pending review file:
   ```text
   "<codex-node>" "<skill>/scripts/make_contact_sheet.mjs" --project "<output root>/project" --out "<output root>/preview/action-contact-sheet.png" --node-modules "<codex-node-modules>"
   "<codex-node>" "<skill>/scripts/validate_project.mjs" --project "<output root>/project" --node-modules "<codex-node-modules>"
   "<codex-node>" "<skill>/scripts/self_check_project.mjs" --project "<output root>/project" --preview "<output root>/preview" --node-modules "<codex-node-modules>"
   ```
12. Read [references/self-check.md](references/self-check.md). Use `view_image` to inspect `identity-board.png` and `action-contact-sheet.png`, fill every character field in `preview/self-check-review.json`, then rerun `self_check_project.mjs`. Regenerate only failed character sheets until `self-check-report.json` says `status: pass` with score 85 or higher.
13. Pause for the second approval. Show the contact sheet and report the self-check score plus any repaired characters. Require confirmation of every person's identity, actions, complete body, and transparent edges.
14. Build only on the current operating system. The build uses a short temporary staging path, runs tests, captures the normal runtime and every selected mouse-following scenario, then stops before packaging until runtime review is complete:
   ```text
   "<codex-node>" "<skill>/scripts/build_project.mjs" --project "<output root>/project" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
   ```
   Add `--verify-only` when the user wants method/configuration validation without producing a release artifact.
15. Use `view_image` to inspect `preview/runtime-window.png` and every image under `preview/scenarios/`. Confirm that centipede and relay leaders follow the simulated cursor, the formation remains connected, exactly one dropping is visible, and each kneeling follower eats before the next dropping appears. Complete the runtime fields and current fingerprint in `self-check-review.json`.
16. Rerun the same `build_project.mjs` command without `--refresh-smoke`. It rechecks the approved fingerprint and packages only after the gate passes.
17. Launch the result, verify real mouse interaction, tray pause/quit, dragging, and click-through behavior, then report the project, release, preview, self-check report, scenario reports, and configuration paths.

Do not claim that a macOS app was built on Windows. Build a portable Windows folder containing the named `.exe` on Windows and an unsigned arm64 `.app` bundle on Apple-silicon macOS. The user only installs Codex; the Skill reuses Codex's Node, pnpm, Python, Sharp, and image-generation capabilities, then downloads only the pinned Electron runtime on first use while online.

## Output contract

Create this structure next to the user's work:

```text
<slug>-desktop-pet/
├── project/   # editable Electron source, generated sprites, and config
├── release/   # packaged artifact for the current OS
└── preview/   # identity board, action contact sheet, and runtime screenshot
```

Never copy the original photo into `project/` or `release/`. Keep temporary generation sources in `preview/sources/` only when the user wants them retained.
The Skill repository/package itself must contain no raster person image, identity board, action sheet, processed person sprite, preview, release, or project-specific fixture. Only generic code, instructions, configuration templates, SVG placeholders, and non-person SVG effects may be published.

## Runtime contract

- Keep the default prank preset enabled: free crawl, random/group "爸爸！", group "爷爷！", mouse centipede, small poop cursor marker, flies, slime, dragging, pause, respawn, tray menu, and quit.
- Support a configured sequential `poopChase` preset: the leader and all followers move with the cursor; exactly one click-through dropping exists; each kneeling follower finishes eating before becoming the source of the next dropping; the tail drops once, then the round resets.
- Keep the real system cursor visible and functional. Decorative cursor effects must always ignore mouse events.
- Make transparent pixels click-through and opaque character pixels interactive.
- Use `headAnchor` and `rearAnchor` from `sprites/manifest.json`; do not approximate the centipede by overlapping window centers.
- Keep speech text dynamic in HTML/CSS. Do not rasterize "爸爸！" or "爷爷！" into image assets.
- Treat `pet.config.json`, `behaviors.json`, and `sprites/manifest.json` as the supported configuration interfaces. Read [references/runtime-config.md](references/runtime-config.md) before changing them.
- Use preset behavior configuration only. Do not generate arbitrary executable behavior code in v1.

## Quality gates

- Require `preview/self-check-report.json` to contain `status: pass` and `overallScore >= 85` before the second approval and final delivery.
- Never mark visual-review fields as passed without opening the corresponding image. Automated checks cannot establish face likeness, clothing separation, body completeness, or action readability.
- Require a complete `preview/generation-manifest.json`. Missing, stale, or non-`gpt-image-2` identity/base/role artwork blocks self-check.
- Regenerate only the failed character sheet when identity or action consistency fails.
- Reject sprite frames with opaque corners, severe chroma fringe, missing body parts, cell bleed, or subject coverage outside 3%-90%.
- Verify the tray can pause and quit even if global shortcut registration fails.
- Verify right-click works only over the visible character and normal desktop clicks pass through elsewhere.
- Verify the original reference photo is absent from the package.
- Verify every selected scenario produces a movement report and screenshots; relay samples must keep exactly one dropping and advance to at least a second source.
- Before publishing the Skill, run `scripts/audit_skill_release.mjs`; any bundled raster image or generated output directory is a release blocker.
- Read [references/platform-build.md](references/platform-build.md) for platform-specific acceptance checks.

## Resources

- `assets/electron-template/`: reusable Electron desktop-pet runtime.
- `scripts/create_project.mjs`: create a non-overwriting project/output skeleton.
- `scripts/process_sprites.mjs`: split, chroma-key, trim, normalize, and register a 4x3 character sheet.
- `scripts/process_role_sprites.mjs`: split and register a 2x1 leader or follower role-action sheet.
- `scripts/record_image_generation.mjs`: enforce and fingerprint GPT Image 2 provenance for final generated artwork.
- `scripts/make_contact_sheet.mjs`: render all registered frames for visual approval.
- `scripts/validate_project.mjs`: validate config, assets, alpha, and privacy boundaries.
- `scripts/self_check_project.mjs`: score sprite/runtime quality and enforce structured visual review.
- `scripts/build_project.mjs`: re-enforce validation/self-check, install, test, and package the current platform.
- `scripts/audit_skill_release.mjs`: block publication when raster/person assets or generated output directories leak into the Skill package.
- `references/visual-generation.md`: identity and action-sheet prompts.
- `references/runtime-config.md`: supported configuration schema.
- `references/platform-build.md`: Windows/macOS build behavior and limitations.
- `references/codex-runtime.md`: use Codex-bundled runtimes without manual developer setup.
- `references/self-check.md`: mandatory automated and visual quality gate plus targeted repair loop.
