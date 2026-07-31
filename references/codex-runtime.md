# Codex-only runtime

The user-facing requirement is: install Codex Desktop and keep it online during the first build. Do not ask the user to install a programming toolchain.

## Required behavior

1. Call `codex_app__load_workspace_dependencies` before running project scripts.
2. Use the returned Node executable for every `.mjs` script.
3. Pass the returned package paths through `--pnpm <path>` and `--node-modules <path>`. The scripts translate these arguments internally, so the same commands work from PowerShell, zsh, or bash.
4. Reuse Codex's bundled `sharp` package for image processing. Let the scripts cache only the pinned `electron` runtime under the operating-system temp directory; generated projects and the published Skill do not contain dependency caches.
5. Use built-in `$imagegen`; do not request `OPENAI_API_KEY` for the normal path.

Do not depend on `node`, `npm`, `pnpm`, or `python` being present on the user's normal PATH. Do not modify the system PATH.

## Network failures

Image generation and the first Electron download require network access. If an Electron download is interrupted, retry with the same project; the package manager cache should resume or reuse completed content. On networks that block GitHub assets, set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` for that build attempt. Do not present this environment variable as a manual prerequisite; Codex should set it when needed.

Builds run from a short directory under the operating-system temp folder to avoid Windows path-length failures. After Electron is cached there, verification and portable-directory packaging need no additional developer tools or electron-builder.
