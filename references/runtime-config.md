# Runtime configuration

## `src/config/pet.config.json`

- `schemaVersion`: must be `1`.
- `app.name`, `app.id`, `app.version`: package metadata.
- `render.spriteSize`: visible character box in device-independent pixels; default `112`, supported `72-160`.
- `render.windowSize`: transparent BrowserWindow size; must exceed the sprite size so bubbles fit.
- `render.effectSize`: prank-effect size; default `32`, supported `16-48`.
- `render.alwaysOnTop`: keep pets above ordinary windows.
- `characters`: 1-8 entries with unique `id`, `displayName`, and optional `hueRotate` used only by placeholder art.
- `selection.mode`: `normal`, `centipede`, `poop-relay`, or `all`, chosen by the user before generation.
- `selection.userCharacterId`: `null` when the user is not in the photo, otherwise the explicitly selected character id. This does not determine relay order.
- `packaging.windowsTarget`: `portable` in v1.
- `packaging.macTarget`: `dir` in v1.
- `packaging.macArch`: `arm64` in v1.

## `src/config/behaviors.json`

- `phrases.dad`, `phrases.grandpa`: dynamic bubble strings.
- `hotkeys`: Electron accelerators. Failure to register a shortcut must not stop startup.
- `randomDad.enabled`, `minDelayMs`, `maxDelayMs`, `groupChance`, `durationMs`.
- `centipede.enabled`, `maxSpeed`, `followStrength`, `gap`, `poopCursor`, `flies`, `slime`, `exitShout`.
- `poopChase.enabled`, `leaderId`, ordered `followerIds`, `maxSpeed`, `followStrength`, `deadZone`, `gap`, `initialDropDelayMs`, `dropVisibleBeforeEatMs`, `poopDurationMs`, `eatRadius`, `eatDurationMs`, `consumedDelayMs`, `roundResetDelayMs`, `droppingTtlMs`, `poopSize`, and `stinkSize`.
- `poopChase.maxDroppings`: fixed at `1` in v1. The relay is `leader -> follower 1 -> ... -> tail drop -> reset`; a follower must finish eating before becoming the next source.
- `freeRoam.speedMin`, `speedMax`, `turnIntervalMs`.
- `prankEffects.enabled`: master switch for poop, flies, slime, and stink visuals.

## `src/assets/sprites/manifest.json`

Each character entry contains:

- `id`: matches `pet.config.json`.
- `frames`: arrays for `crawl_right`, `crawl_left`, `idle_right`, `idle_left`, `centipede_right`, `centipede_left`, `shout`, and `drag`.
- When poop chase is enabled, its leader also requires `poop_right` and `poop_left`; every follower requires `eat_right` and `eat_left`.
- `anchors.right.head` / `anchors.right.rear`: normalized `[x,y]` points for right-facing centipede frames.
- `anchors.left.head` / `anchors.left.rear`: mirrored normalized points for left-facing frames.

Paths are relative to `src/assets/sprites/`. Do not use absolute paths or reference the source photo.

## Compatibility

Keep unknown future keys intact when editing a config. Reject unsupported `schemaVersion` values with a clear error. Do not add arbitrary JavaScript snippets or commands to JSON configuration.
