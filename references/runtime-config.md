# Runtime configuration

## `src/config/pet.config.json`

- `schemaVersion`: must be `1`.
- `app.name`, `app.id`, `app.version`: package metadata.
- `render.spriteSize`: visible character box in device-independent pixels; default `112`, supported `72-160`.
- `render.windowSize`: transparent BrowserWindow size; must exceed the sprite size so bubbles fit.
- `render.effectSize`: prank-effect size; default `32`, supported `16-48`.
- `render.alwaysOnTop`: keep pets above ordinary windows.
- `characters`: 1-8 entries with unique `id`, `displayName`, and optional `hueRotate` used only by placeholder art.
- `selection.mode`: `normal`, `group-shout`, `poop-chase`, or `all`, derived from the user's Chinese choice `普通桌宠 / 集体跪喊 / 屎追逐 / 全部都要`.
- `selection.userCharacterId`: `null` when the user says they are not in the photo, otherwise the explicitly selected character id. The selected character is the standing recipient for group shout; null means there is no recipient. Never infer it from position or appearance.
- `selection.chaseVariant`: derived rather than asked. `self-poop` when `selection.userCharacterId` is non-null; `cursor-centipede` when it is null. Raw mode keys and this variant stay internal.
- 跪喊规则：有本人时，本人站立不跪，其他角色全部跪下喊爸爸或爷爷；没有指定本人时，不得虚构接收者，全员跪下喊爸爸或爷爷。
- 屎追逐规则：有本人时，本人负责持续拉，其他角色全员追吃；本人不在照片时，鼠标控制一坨点击穿透的屎，所有角色组成不断链的人形蜈蚣追着它移动。
- `packaging.windowsTarget`: `portable` in v1.
- `packaging.macTarget`: `dir` in v1.
- `packaging.macArch`: `arm64` in v1.

## `src/config/behaviors.json`

- `phrases.dad`, `phrases.grandpa`: dynamic bubble strings.
- `hotkeys`: Electron accelerators. Failure to register a shortcut must not stop startup.
- `randomDad.enabled`, `minDelayMs`, `maxDelayMs`: control only when the eligible-participant dad sequence begins; participant count is never random. The shipped default is `enabled: false` so startup stays non-intrusive. Dad/grandpa hotkeys and tray commands remain available when automatic triggering is disabled.
- `groupShout.gatherSpeed`, `kneelDelayMs`, `frameDurationMs`: cap visible movement for both the standing recipient and eligible row participants, hold the completed kneeling row, then time synchronized shout frames `0 -> 1 -> 2`.
- `centipede.enabled`, `maxSpeed`, `followStrength`, `connectionTolerance`, `flies`, and `exitShout`. The connected row keeps its fixed shape while moving as one unit toward the cursor.
- `poopChase.enabled`, `variant`, `sourceId`, `participantIds`, `maxSpeed`, `followStrength`, `deadZone`, `gap`, `initialDropDelayMs`, `dropVisibleBeforeEatMs`, `poopDurationMs`, `eatRadius`, `eatDurationMs`, `consumedDelayMs`, `roundResetDelayMs`, `droppingTtlMs`, `poopSize`, and `stinkSize`.
- `poopChase.maxDroppings`: fixed at `1`. For `self-poop`, `sourceId` remains the selected self and eaters never become the pooping source. For `cursor-centipede`, `sourceId` is null and the click-through effect follows the real cursor.
- `freeRoam.speedMin`, `speedMax`, `turnIntervalMs`.
- `prankEffects.enabled`: master switch for poop, flies, slime, and stink visuals.

## `src/assets/sprites/manifest.json`

Each character entry contains:

- `id`: matches `pet.config.json`.
- `frames`: arrays for crawl, idle, centipede, drag, eat, and poop actions. The runtime `shout` array contains the three processed `kneel_shout_1/2/3` frames in order.
- For `self-poop`, the selected self requires `poop_right/left` and every other character requires `eat_right/left`; for `cursor-centipede`, every character requires `centipede_right/left`.
- `anchors.<direction>.mouth` and `anchors.<direction>.rear`: normalized connection points used to form the human centipede.

Paths are relative to `src/assets/sprites/`. Do not use absolute paths or reference the source photo.

## Compatibility

Keep unknown future keys intact when editing a config. Reject unsupported `schemaVersion` values with a clear error. Do not add arbitrary JavaScript snippets or commands to JSON configuration.

## Capture-only validation surface

The controlled validation surface is not product configuration or product UI. The runtime may create it only while an explicit smoke/scenario capture environment is active, solely to produce privacy-safe multi-window compositor evidence. A normal packaged launch must create only transparent pet windows.
