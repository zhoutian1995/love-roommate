---
name: love-roommate
description: Use when Codex needs to turn an authorized one-to-eight-person photo into a configurable Love Roommate desktop pet with normal, mouse-following centipede, ordered poop-relay, or combined modes on Windows x64 or Apple-silicon macOS.
---

# Love Roommate

Treat this Skill as a method, mode library, and validation harness. Never bundle private photos or generated person artwork in the Skill repository.

## Required Gates

1. Use Codex Desktop. Load workspace dependencies and retain its Node, pnpm, and node_modules paths. Read [references/codex-runtime.md](references/codex-runtime.md).
2. Require the user to confirm that every depicted person authorized this use. Explain that the Skill records only the user's declaration; it cannot prove legal consent.
3. Diagnose the photo before generation. Accept 1-8 separable people; report ambiguity, occlusion, cropping, low resolution, or clothing that may confuse identities.
4. Number people left-to-right unless the user supplies a mapping. Ask whether the user appears and record `none` or one explicit `person-N`; never infer it.
5. Require one mode: `normal`, `centipede`, `poop-relay`, or `all`. For relay modes, require one leader and an ordered, unique follower list. Do not make the user's character leader automatically.
6. Read [references/visual-generation.md](references/visual-generation.md). Generate all final identity, base, and role artwork with Codex image generation under the declared GPT Image 2 policy. Save it only in the user's `preview/`; never in this Skill.
7. Explain provenance honestly: `generation-manifest.json` is a workflow attestation plus file hash, not an OpenAI-signed model receipt and not resistant to deliberate forgery.
8. Pause for identity approval before processing. Confirm numbering, faces, hair, clothing, self selection, mode, leader, and relay order.
9. Create the project only with `--consent confirmed`. Validate all inputs before writing and never overwrite an existing output. Use [references/workflow-commands.md](references/workflow-commands.md) for exact commands.
10. Record each generated image, process one 4x3 base sheet per person, and process 2x1 leader/follower role sheets when relay is enabled. Pass Codex pnpm and node_modules arguments to every image-processing command.
11. Build the contact sheet, validate Manifest V2, run the output privacy audit, and run self-check. V1 projects must use the explicit migration command; never migrate silently.
12. Read [references/self-check.md](references/self-check.md). Open the identity board and action contact sheet with `view_image`; do not mark visual fields passed from JSON alone. Repair only failed characters.
13. Require `self-check-report.json` status `pass` and score at least 85, then pause for the second user approval of identity, action readability, complete bodies, and transparent edges.
14. Build only for the current host. Inspect the runtime and scenario captures. Confirm both special modes follow the cursor, the formation remains coherent, relay keeps exactly one dropping, and each follower finishes eating before becoming the next source.
15. Complete the runtime review fingerprint, rerun the build, launch the packaged result, and manually check tray pause/quit, drag, right-click, and transparent-pixel click-through.

## Privacy And Supply Chain

- Keep only relative paths in persisted JSON/Markdown. Never persist the original photo hash, size, creation time, username, or host path.
- When `--source` is available, use it only for an in-memory exact-copy scan. Audit the entire output root before release; `project/`, `release/`, and `preview/` must not contain the source, including through symlinks.
- Allow only sprite-manifest-listed raster files inside `project/`. Run `audit_output_privacy.mjs` before packaging.
- Prefer Codex-bundled Sharp. If it cannot load, use the locked Sharp runtime from the approved npm registry automatically.
- Use frozen pnpm lockfiles. Never retry through a third-party registry or Electron mirror unless both the mirror address and `CODEX_ALLOW_THIRD_PARTY_MIRROR=1` are explicit.
- Verify the Electron archive checksum and runtime layout. Preserve macOS framework relative symlinks.

## Runtime Contract

- Keep the real cursor visible. Decorative effects must be permanently click-through.
- Use sprite head/rear anchors for formations; do not overlap window centers as a substitute.
- Bind IPC identity to trusted pet WebContents. Reject unknown senders, non-main frames, unexpected local pages, navigation, popups, and permissions.
- Keep effect pages without preload or IPC.
- Treat `pet.config.json`, `behaviors.json`, and `sprites/manifest.json` as supported configuration. Read [references/runtime-config.md](references/runtime-config.md) before changing behavior.
- Read [references/platform-build.md](references/platform-build.md) before claiming platform acceptance.

## Release Gate

Run the unified release check and official Skill validator. The repository must contain no person raster, generated output, dependency cache, or private path. Windows and Apple-silicon macOS acceptance must use fictional people, and any public report must be redacted JSON without images or host paths.
