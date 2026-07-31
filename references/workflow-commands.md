# Workflow commands

Replace placeholders with paths returned by `codex_app__load_workspace_dependencies`. Invoke the returned Node executable directly; do not depend on the user's PATH.

## Create

```text
"<codex-node>" "<skill>/scripts/create_project.mjs" --name "<app name>" --out "<output root>" --source "<photo>" --people <1-8> --names "<names>" --mode <normal|centipede|poop-relay|all> --self <none|person-N> --consent confirmed [--leader person-N --followers "person-N,person-N"]
```

## Record and process images

```text
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<output root>/preview" --file "<identity-board.png>" --kind identity
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<output root>/preview" --file "<sheet.png>" --kind base --character person-1
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<output root>/preview" --file "<role-sheet.png>" --kind role --character person-1 --role leader
"<codex-node>" "<skill>/scripts/process_sprites.mjs" --project "<output root>/project" --sheet "<sheet.png>" --character person-1 --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
"<codex-node>" "<skill>/scripts/process_role_sprites.mjs" --project "<output root>/project" --sheet "<role-sheet.png>" --character person-1 --role leader --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
```

`record_image_generation.mjs` intentionally has no `--model` option. It records the fixed `codex-imagegen` / `gpt-image-2` / `workflow-attested` policy and hashes the file.

## Review and validate

```text
"<codex-node>" "<skill>/scripts/make_contact_sheet.mjs" --project "<output root>/project" --out "<output root>/preview/action-contact-sheet.png" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
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
