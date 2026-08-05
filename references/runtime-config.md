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
- `selection.userCharacterId`: `null` when the user is not in the photo, otherwise the explicitly selected character id. For dad/grandpa events this character is the standing recipient: it moves gradually to the center in front of the kneeling row, remains idle, and never shouts. This does not determine relay order.
- `selection.prankExcludedCharacterIds`: unique character ids that never kneel, shout, or show dad/grandpa bubbles. It must contain `selection.userCharacterId` whenever the latter is non-null; that one id remains the named standing recipient, while other excluded ids are spectators. Ordinary pet, centipede, relay, eating, pooping, and dragging behavior remain available.
- `packaging.windowsTarget`: `portable` in v1.
- `packaging.macTarget`: `dir` in v1.
- `packaging.macArch`: `arm64` in v1.

## `src/config/behaviors.json`

- `phrases.dad`, `phrases.grandpa`: dynamic bubble strings.
- `hotkeys`: Electron accelerators. Failure to register a shortcut must not stop startup.
- `randomDad.enabled`, `minDelayMs`, `maxDelayMs`: control only when the eligible-participant dad sequence begins; participant count is never random.
- `groupShout.gatherSpeed`, `kneelDelayMs`, `frameDurationMs`: cap visible movement for both the standing recipient and eligible row participants, hold the completed kneeling row, then time synchronized shout frames `0 -> 1 -> 2`.
- `centipede.enabled`, `maxSpeed`, `followStrength`, `connectionTolerance`, `flies`, and `exitShout`. The connected row keeps its fixed shape while moving as one unit toward the cursor.
- `poopChase.enabled`, `leaderId`, ordered `followerIds`, `maxSpeed`, `followStrength`, `deadZone`, `gap`, `initialDropDelayMs`, `dropVisibleBeforeEatMs`, `poopDurationMs`, `eatRadius`, `eatDurationMs`, `consumedDelayMs`, `roundResetDelayMs`, `droppingTtlMs`, `poopSize`, and `stinkSize`.
- `poopChase.maxDroppings`: fixed at `1`. The relay is `leader poops -> next person eats -> that eater poops -> ... -> tail poops -> reset`.
- `freeRoam.speedMin`, `speedMax`, `turnIntervalMs`.
- `prankEffects.enabled`: master switch for poop, flies, slime, and stink visuals.

## `src/assets/sprites/manifest.json`

Each character entry contains:

- `id`: matches `pet.config.json`.
- `frames`: arrays for crawl, idle, centipede, drag, eat, and poop actions. The runtime `shout` array contains the three processed `kneel_shout_1/2/3` frames in order.
- Every relay participant requires `poop_right/left` and `eat_right/left`.
- `anchors.<direction>.mouth` and `anchors.<direction>.rear`: normalized connection points used to form the human centipede.

Paths are relative to `src/assets/sprites/`. Do not use absolute paths or reference the source photo.

## Compatibility

Keep unknown future keys intact when editing a config. Reject unsupported `schemaVersion` values with a clear error. Do not add arbitrary JavaScript snippets or commands to JSON configuration.
