# Self-check and repair loop

Run self-check twice: after generating the action contact sheet and after capturing the runtime window plus selected scenario captures. A passing structural validator is not evidence that the character still looks right.

## Automated pass

Run `scripts/self_check_project.mjs`. It writes these files under `preview/`:

- `self-check-report.json`: score, machine-readable findings, frame metrics, and repair actions.
- `self-check-report.md`: short gate summary.
- `self-check-review.json`: manual visual-review form. It is created once and never overwritten. Each character and runtime section contains an artifact fingerprint; copy the current fingerprint from the report after viewing changed assets so stale approvals cannot survive regeneration.

The automated checks cover the GPT Image 2 workflow attestation and generated-file hashes, placeholders, incomplete base or configured role-action groups, frames shared across people or actions, stale contact/runtime screenshots, empty or clipped frames, opaque edges, weak readable scale, centering and animation drift, nearly duplicate animation frames, chroma spill, incorrect centipede anchor direction, cross-character scale mismatch, and blank runtime screenshots. The attestation is not an OpenAI-signed model receipt.

## Visual pass

Use `view_image` to inspect `identity-board.png`, `action-contact-sheet.png`, `runtime-window.png`, and every selected image under `preview/scenarios/`. Fill every required field in `self-check-review.json` with `pass` or `fail`; do not leave `pending` fields before an approval or delivery.

Fail a character when any of these are visible:

- The face, hair, glasses, clothing, or accessories no longer match the approved identity.
- Clothing or identity traits migrated between people.
- A limb, hand, foot, face, or major clothing region is missing, duplicated, fused, or clipped.
- Left/right crawl, centipede, shout, or drag poses are unreadable at contact-sheet size.
- A configured leader's left/right poop pose is not readable without drawing poop into the person sprite.
- A configured follower's left/right lowered-head, open-mouth eating action is not readable, or becomes graphic/realistic.
- Key-color fringe, dirty transparency, cell bleed, inconsistent scale, or large position jumps remain.

Fail runtime review when the pet is blank, clipped, too small to read, surrounded by an opaque rectangle, or rendered outside the transparent window as expected.

Fail a scenario when a human-centipede mouth is detached from the previous rear, a special formation does not visibly follow the cursor, its fixed-row offsets break while moving, the relay leaves its row, more than one dropping appears, an eater does not become the next poop source, or kneeling shouts are not synchronized.

## Repair rule

Require `status: pass`, project score 90 or higher, every identity score 90 or higher, and identity similarity at least 31/35. Regenerate only the failed person/action from the approved master. Never lower thresholds to force a pass.
