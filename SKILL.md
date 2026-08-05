---
name: love-roommate
description: Use when Codex needs to turn an authorized one-to-eight-person photo into a configurable photorealistic Love Roommate desktop pet with normal, fixed-row human-centipede, ordered eat-poop relay, kneeling group shouts, or combined modes on Windows x64 or Apple-silicon macOS.
---

# Love Roommate

Treat this Skill as a method, mode library, and validation harness. Never bundle private photos or generated person artwork in the Skill repository.

## User Conversation

- Speak in the user's language; default to plain Chinese. Ask exactly one question per turn instead of presenting a configuration form.
- The first reply after receiving a photo must include a short usability diagnosis, a left-to-right numbered list with distinguishing features, and only the authorization question. Never skip the diagnosis.
- After diagnosis, describe people as `1号`, `2号`, and so on. Keep `person-N`, `none`, `leader`, `followers`, and mode keys out of user-facing replies.
- Ask authorization first: `照片里的人都知道并同意制作桌宠吗？` Explain only in plain language: `我只能记录你的确认，不能替你证明其他人真的同意。` Stop immediately if the answer is no or unclear.
- Then ask which numbered person is the user. Accept a number, `N号`, or `不在`; map it internally to `person-N` or `none`.
- Present modes as numbered Chinese choices: `1 普通桌宠`, `2 人体蜈蚣`, `3 轮流吃拉接力`, `4 全部都要`. Map them internally to the supported mode keys.
- Reuse valid choices the user already stated instead of asking again. With a one-person photo, never offer relay choices; describe mouse following as a single pet rather than a queue.
- For choices 3 or 4, ask separately who starts, then ask the remaining order. Explain plainly: the first person poops, the next person kneels to eat, then that eater poops for the next person. The tail poops once before the loop resets.
- If an answer is missing or invalid, repeat only that question. Never resend the whole questionnaire.
- Before generating, summarize the user's identity, Chinese mode name, and relay order in natural language. Continue only after explicit confirmation.

## Required Gates

1. Use Codex Desktop. Load workspace dependencies and retain its Node, pnpm, and node_modules paths. Read [references/codex-runtime.md](references/codex-runtime.md).
2. Follow the User Conversation sequence. Require the user to confirm that every depicted person authorized this use. Explain briefly that the Skill records only the user's declaration; it cannot prove legal consent.
3. Diagnose the photo before generation. Accept 1-8 separable people; report ambiguity, occlusion, cropping, low resolution, or clothing that may confuse identities.
4. Number people left-to-right unless the user supplies a mapping. Show only friendly numbered labels, then convert the user's answer to `none` or one explicit `person-N`; never infer it.
5. Convert the user's numbered Chinese mode choice to `normal`, `centipede`, `poop-relay`, or `all`. For relay modes, internally require one leader and an ordered, unique follower list. Do not make the user's character leader automatically.
6. Read [references/visual-generation.md](references/visual-generation.md). Generate all final identity, base, and role artwork with Codex image generation under the declared GPT Image 2 policy. Save it only in the user's `preview/`; never in this Skill.
7. Explain provenance honestly: `generation-manifest.json` is a workflow attestation plus file hash, not an OpenAI-signed model receipt and not resistant to deliberate forgery.
8. Pause for identity approval before processing. Confirm numbering, faces, hair, clothing, self selection, mode, leader, and relay order.
9. Create the project only with `--consent confirmed`. Validate all inputs before writing and never overwrite an existing output. Use [references/workflow-commands.md](references/workflow-commands.md) for exact commands.
10. Create and approve one photorealistic identity master per person. Generate actions individually or as left/right pairs from that approved master. Every relay participant requires both eat and poop actions. Record master fingerprint, prompt version, action, version, and replacement reason.
10a. Release only clean transparent PNG sprites. White or chroma-key backgrounds are intermediate aids, never final styling. For photorealistic people, forbid global strong despill; preserve skin and clothing, clear RGB in fully transparent pixels, and reject any purple, green, gray, or white halo.
11. Build the contact sheet, validate Manifest V2, run the output privacy audit, and run self-check. V1 projects must use the explicit migration command; never migrate silently.
12. Read [references/self-check.md](references/self-check.md). Open the identity board and action contact sheet with `view_image`; do not mark visual fields passed from JSON alone. Repair only failed characters.
13. Require `self-check-report.json` status `pass` and score at least 90, then pause for the second user approval of identity, action readability, complete bodies, and transparent edges.
14. Build only for the current host. Inspect full-composition runtime captures for normal, fixed-row human-centipede, eat-poop relay, kneeling dad shout, kneeling grandpa shout, and pause. Reject per-window screenshots as proof of formation quality.
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
- Use sprite mouth/rear anchors for human-centipede formation. Each mouth must touch the previous rear within the configured tolerance.
- Bind IPC identity to trusted pet WebContents. Reject unknown senders, non-main frames, unexpected local pages, navigation, popups, and permissions.
- Keep effect pages without preload or IPC.
- Treat `pet.config.json`, `behaviors.json`, and `sprites/manifest.json` as supported configuration. Read [references/runtime-config.md](references/runtime-config.md) before changing behavior.
- Read [references/platform-build.md](references/platform-build.md) before claiming platform acceptance.

## Release Gate

Run the unified release check and official Skill validator. The repository must contain no person raster, generated output, dependency cache, or private path. Windows and Apple-silicon macOS acceptance must use fictional people, and any public report must be redacted JSON without images or host paths.
