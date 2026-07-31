# Codex-only runtime

The user-facing requirement is: install Codex Desktop and keep it online during the first build. Do not ask the user to install a programming toolchain.

## Required behavior

1. Call `codex_app__load_workspace_dependencies` before running project scripts.
2. Use the returned Node executable for every `.mjs` script.
3. Pass the returned package paths through `--pnpm <path>` and `--node-modules <path>`. The scripts translate these arguments internally, so the same commands work from PowerShell, zsh, or bash.
4. Reuse Codex's bundled `sharp` package for image processing. If its dependency tree cannot load, let the Skill install the pinned Sharp 0.34.5 fallback from the approved registry with a frozen lockfile.
5. Let the scripts cache the pinned Electron runtime under the operating-system temp directory; generated projects and the published Skill do not contain dependency caches.
6. Use built-in `$imagegen`; do not request `OPENAI_API_KEY` for the normal path.

Do not depend on `node`, `npm`, `pnpm`, or `python` being present on the user's normal PATH. Do not modify the system PATH.

## Network failures

Image generation and the first runtime downloads require network access. If a download is interrupted, retry with the same project; the package manager cache should resume or reuse completed content.

Use only the official npm registry and Electron release source by default. A third-party registry or Electron mirror requires both an explicit address and `CODEX_ALLOW_THIRD_PARTY_MIRROR=1`. Display the security warning before continuing; never switch mirrors silently.

Builds run from a short directory under the operating-system temp folder to avoid Windows path-length failures. Electron 41.0.2 archives are checked against the pinned platform SHA-256 before use, then key files and macOS framework symlinks are validated. After the runtime is cached, verification and portable-directory packaging need no additional developer tools or electron-builder.
