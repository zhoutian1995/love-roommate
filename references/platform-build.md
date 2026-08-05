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
- Deliver an unsigned `.app` under `release/macos/`.
- Do not claim signing, notarization, DMG, Intel support, or App Store readiness.
- Locally built apps normally avoid download quarantine. If an unsigned copied app is blocked, tell the user to use Finder's **Open** command or the Privacy & Security panel; do not disable Gatekeeper globally.

## Cross-platform rule

Never treat a Windows-produced macOS directory as a verified `.app`. Preserve the editable project so the same source can be built again on the target operating system.

## Runtime acceptance

- Keep every character inside the nearest display work area and away from the taskbar or Dock.
- Choose the display containing the cursor when a special performance begins, keep the fixed-row shape inside that display's work area, and move the whole formation toward the cursor.
- Keep the decorative poop cursor, dropped poop, and stink effects permanently click-through.
- Right-click the visible character to open recovery controls; clicks outside opaque pixels must reach the underlying app.
- Verify poop relay and ordinary centipede are mutually exclusive, pause freezes both people and the current dropping, and exiting relay mode hides the persistent dropped-effect window.
- Verify every human-centipede mouth touches the previous rear. Verify relay keeps exactly one dropping and every eater becomes the next poop source only after eating finishes.
- Verify dad and grandpa commands gather everyone into one kneeling row, play three synchronized shout beats, and return to free mode.
- Use tray Pause and Quit as recovery controls.
- On centipede exit, show only the configured grandpa phrase when `exitShout` is enabled.
