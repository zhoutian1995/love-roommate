# Workflow commands

Replace placeholders with paths returned by `codex_app__load_workspace_dependencies`. Invoke the returned Node executable directly; do not depend on the user's PATH.

## Create

```text
"<codex-node>" "<skill>/scripts/create_project.mjs" --name "<app name>" --out "<output root>" --source "<photo>" --people <1-8> --names "<names>" --mode <normal|centipede|poop-relay|all> --self <none|person-N> --prank-excluded <none|person-N,person-N> --consent confirmed [--leader person-N --followers "person-N,person-N"]
```

Collect `--self` and `--prank-excluded` in separate user questions. Never infer either value. The creator automatically adds a non-`none` self character to the exclusion list and validators reject attempts to omit it. Runtime treats that selected self as the standing dad/grandpa recipient; additional excluded ids remain spectators.

## Record and process images

Before recording an action, remove its flat background with the system image helper using hard border-key removal (`--auto-key border --tolerance 24 --edge-contract 1`). Do not use `--soft-matte` or global `--despill` for photorealistic people. Then run:

```text
"<codex-node>" "<skill>/scripts/cleanup_portrait_chroma.mjs" --input "<transparent-action.png>" --out "<clean-transparent-action.png>" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>" --key "<#selected-key>"
```

The clean transparent file is the one to record and pass to `process_action_sprite.mjs`. White-background generation is permitted only when white does not collide with the subject; the final file must still be transparent and halo-free.

```text
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<output root>/preview" --file "<identity-board.png>" --kind identity
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<output root>/preview" --file "<person-1-master.png>" --kind master --character person-1 --prompt-version identity-v1 --version 1
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<output root>/preview" --file "<person-1-crawl-right-1.png>" --kind action --character person-1 --action crawl_right_1 --master-fingerprint "<approved-master-sha256>" --prompt-version action-v1 --version 1
"<codex-node>" "<skill>/scripts/process_action_sprite.mjs" --project "<output root>/project" --file "<person-1-crawl-right-1.png>" --character person-1 --action crawl_right_1 --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
```

`record_image_generation.mjs` intentionally has no `--model` option. It records the fixed `codex-imagegen` / `gpt-image-2` / `workflow-attested` policy and hashes the file.

Repeat the `action` record and `process_action_sprite.mjs` commands for every required action. Every action record must use the fingerprint of that character's approved master. Use `--supersedes`, `--reason`, and an incremented `--version` when replacing a failed generation. Do not use the legacy multi-action `base` / `role` sheet commands for new V2 artwork; they remain available only for explicit legacy recovery.

Required actions per character are `crawl_right_1`, `crawl_right_2`, `crawl_left_1`, `crawl_left_2`, `idle_right`, `idle_left`, `centipede_right`, `centipede_left`, `kneel_shout_1`, `kneel_shout_2`, `kneel_shout_3`, `drag`, `poop_right`, `poop_left`, `eat_right`, and `eat_left`.

## Review and validate

```text
"<codex-node>" "<skill>/scripts/make_contact_sheet.mjs" --project "<output root>/project" --out "<output root>/preview/action-contact-sheet.png" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
"<codex-node>" "<skill>/scripts/create_identity_review.mjs" --project "<output root>/project" --preview "<output root>/preview"
"<codex-node>" "<skill>/scripts/validate_project.mjs" --project "<output root>/project" --source "<photo>" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
"<codex-node>" "<skill>/scripts/self_check_project.mjs" --project "<output root>/project" --preview "<output root>/preview" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
"<codex-node>" "<skill>/scripts/audit_output_privacy.mjs" --root "<output root>" --source "<photo>"
```

The first self-check creates `self-check-review.json` and normally exits nonzero until visual review is complete.

## Build

```text
"<codex-node>" "<skill>/scripts/build_project.mjs" --project "<output root>/project" --source "<photo>" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>" [--verify-only]
```

Run it once to capture runtime/scenario evidence, update the runtime review fingerprint after opening the images, then rerun to package.
The second run launches the copied final `.exe` or `.app` automatically, writes `preview/<platform>-packaged-smoke.png`, and repeats the privacy audit against the packaged output.

For the remaining manual tray, drag, right-click, and click-through checks, launch the copied artifact directly:

```text
Windows: "<output root>/release/windows/<app>/<app>.exe"
macOS:   "<output root>/release/macos/<app>.app/Contents/MacOS/<app>"
```

## Release check

```text
"<codex-node>" "<skill>/scripts/release_check.mjs"
```

Set `CODEX_PNPM` to the Codex pnpm path. The check is fail-closed when the official validator or a Python with PyYAML is unavailable, unless `SKIP_OFFICIAL_VALIDATOR=1` is an explicit local opt-out.

## Migrate V1 explicitly

```text
"<codex-node>" "<skill>/scripts/migrate_project_manifest.mjs" --root "<output root>" --dry-run
"<codex-node>" "<skill>/scripts/migrate_project_manifest.mjs" --root "<output root>" --apply --consent confirmed
```

## Mirror opt-in

Default installs use the official npm registry and Electron release source. A third-party source is accepted only when Codex sets both its explicit address and `CODEX_ALLOW_THIRD_PARTY_MIRROR=1`; always display the security warning before continuing.
