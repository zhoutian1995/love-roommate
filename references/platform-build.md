# Platform build and acceptance

## Windows

- Supported target: Windows 10/11 x64.
- Use the pinned Electron runtime downloaded automatically by the Skill and package it without an installer or system-wide tools.
- Deliver a named portable app folder under `release/windows/` containing the matching `.exe` and Electron runtime files. The user launches that `.exe` directly; no installation or administrator access is required.
- Verify transparent-window rendering, tray menu, drag, right-click hit testing, global shortcuts, and normal clicks through transparent pixels.
- Do not require installation or administrator access.

## macOS

- Supported target: macOS 13+ on Apple silicon.
- Use the pinned Electron runtime downloaded automatically by the Skill and package it directly on an Apple-silicon Mac.
- After installing app resources and updating `Info.plist`, ad-hoc sign the complete `.app` and require `codesign --verify --deep --strict` to pass before reporting packaging success.
- Deliver the locally ad-hoc-signed `.app` under `release/macos/`.
- Do not claim Developer ID signing, notarization, DMG, Intel support, App Store readiness, or general Gatekeeper acceptance.
- Locally built apps normally avoid download quarantine. If a copied app is blocked, tell the user to use Finder's **Open** command or the Privacy & Security panel; do not disable Gatekeeper globally.

## Cross-platform rule

Never treat a Windows-produced macOS directory as a verified `.app`. Preserve the editable project so the same source can be built again on the target operating system.

## Runtime acceptance

- Keep every character inside the nearest display work area and away from the taskbar or Dock.
- Choose the display containing the cursor when a special performance begins, keep the fixed-row shape inside that display's work area, and move the whole formation toward the cursor.
- Keep the decorative poop cursor, dropped poop, and stink effects permanently click-through.
- Right-click the visible character to open recovery controls; clicks outside opaque pixels must reach the underlying app.
- Verify group shout and poop chase are mutually exclusive, Pause freezes both people and the current poop effect, and leaving a prank hides its effect windows.
- With self present, verify self remains visibly in front as the only poop source, exactly one dropping is readable, every other character chases and eats in repeating photo-number order, and eaters never become poop sources. With no self selected, verify the click-through cursor poop follows the real pointer and every human-centipede mouth touches the previous rear while the full connected chain chases it.
- Verify dad and grandpa reports distinguish `recipientId`, `participantIds`, `excludedIds`, and `skippedReason`. When self is present, that recipient moves at the configured speed to the formation center axis, stands in front without overlap, remains idle, and shows no prank bubble while every other character kneels and shouts. When self is absent, `recipientId` is null and every photographed character kneels and shouts; do not create spectators or extra exclusions.
- Use tray Pause and Quit as recovery controls.
- On centipede exit, show only the configured grandpa phrase when `exitShout` is enabled.
