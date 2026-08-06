# Runtime evidence and visual acceptance design

## Problem

The current smoke capture proves that all pet windows can be captured, but it forces them into a paused horizontal row and composites them onto an opaque light background. That technical artifact was incorrectly treated as evidence of the normal desktop experience and transparency. The dad/grandpa and relay captures also remain structurally testable while being visually weak.

## Approved direction

Keep deterministic automation for structural checks, but separate it from user-facing visual evidence. A release may proceed only when both evidence classes pass independently.

## Evidence classes

### Structural smoke evidence

- Deterministically stages every live pet window.
- May pause animation to make window-count and sprite-presence checks stable.
- Is stored and labelled as technical evidence only.
- Must not satisfy normal-mode framing, transparency, desktop integration, motion, or interaction review.

### Product visual evidence

- Captures the actual desktop composition instead of a synthetic strip.
- Preserves real screen context and the natural runtime positions of all pets.
- Shows a readable pet scale and at least two distinct normal-mode moments so a frozen row cannot pass.
- Uses full-composition captures for centipede, relay, dad, grandpa, and pause.
- Keeps per-window transparent captures only as supporting alpha evidence.

## Runtime presentation corrections

- Normal mode must not be replaced by the deterministic smoke layout.
- Dad/grandpa participants form a compact non-overlapping row, visually oriented toward the centered standing recipient. The recipient stays standing, has no phrase bubble, and is separated from the kneeling row.
- Relay evidence must show exactly one dropping at the correct source-to-eater handoff location; the effect must not overlap a participant's torso.
- Product captures must retain enough surrounding desktop context to judge scale without making the characters unreadably small.

## Validation changes

- Add regression tests that reject a single-window capture, an opaque synthetic composition as transparency proof, a frozen deterministic row as normal-mode product evidence, and incomplete product capture sets.
- Keep existing window-count, scenario-order, pause, performance, privacy, and supply-chain gates.
- Manual review must inspect the product captures and per-window alpha evidence separately. Automated scores cannot overwrite a manual visual failure.

## Release acceptance

Before packaging and publishing:

1. The private five-person project passes the revised visual review and full Windows performance audit.
2. Fictional public five- and eight-person candidates pass the same code revision and release thresholds.
3. Packaged smoke, tray pause/quit, right-click, drag, and transparent-pixel click-through are checked on the packaged candidate.
4. Privacy audit, unified release check, official validator, CI, exact-ref install, Windows rebuild, and Apple-silicon macOS rebuild all pass from the same 40-character commit.

## Non-goals

- Do not publish private person artwork or private runtime images.
- Do not relax performance, identity, transparency, action, or privacy thresholds to make the release pass.
- Do not use the deterministic smoke strip as a product screenshot.
