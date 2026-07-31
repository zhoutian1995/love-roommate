# Visual generation

## Model gate

All final identity boards, 4x3 base action sheets, and 2x1 role action sheets must be generated with GPT Image 2. Do not accept another model, local pose synthesis, photo compositing, or deterministic drawing as final character art. Local scripts may only crop, chroma-key, normalize, fingerprint, and arrange GPT Image 2 outputs. Record every selected final source with `scripts/record_image_generation.mjs`; self-check rejects missing, stale, or non-GPT-Image-2 provenance.

## Identity board

Use the uploaded photo as an identity reference, not as an edit target. Preserve each person's face shape, hairstyle, approximate age, skin tone, glasses, and clothing colors. Redraw the complete body; never composite a real photographic head onto an illustrated body.

Generate one numbered full-body lineup on a flat `#ff00ff` background. Put people in the agreed order with generous separation and no overlap. Use a polished 2D desktop-game sprite style with bold clean outlines and readable silhouettes at about 112 px. Include no text except simple person numbers above the figures.

Approval checklist:

- Every person is present exactly once.
- Faces and hairstyles remain distinguishable at small size.
- Clothing colors and major accessories do not migrate between people.
- No limbs, clothing, or hair overlap neighboring people.
- No photoreal head cutouts, watermarks, scenery, floor, or shadows.

## Per-character action sheet

After identity approval, generate one separate 4-column by 3-row sheet per person. Use the approved identity board and the original photo as references. Keep one consistent scale, costume, outline, face, and lighting across all twelve cells.

Use this exact cell order:

| Row | Column 1 | Column 2 | Column 3 | Column 4 |
|---|---|---|---|---|
| 1 | crawl right A | crawl right B | crawl left A | crawl left B |
| 2 | idle right | idle left | centipede right | centipede left |
| 3 | shout up | shout down | shout wave | dragged/limp |

Prompt requirements:

- Perfectly flat solid `#ff00ff` background, no grid lines, shadow, text, scenery, props, slime, poop, or speech bubbles.
- Each cell contains exactly one complete character with padding and no cell bleed.
- Centipede poses are comedic crawling/kneeling poses with a clear head end and rear end; keep them non-graphic.
- Shout frames use one consistent body pose with only arms/mouth changing.
- Keep the character opaque with crisp edges and avoid `#ff00ff` in clothes or skin.

If a character wears strong magenta, switch the key to `#00ff00` and pass `--key #00ff00` to `process_sprites.mjs`.

## Poop-chase role sheet

When `poopChase.enabled` is true, generate a separate 2-column by 1-row role sheet for every participant, at the same scale and in the same costume as the approved 4x3 sheet.

- Leader cell order: `poop right`, `poop left`. Show a readable comedic squatting/straining pose, but do not draw poop inside the character cell; runtime renders it separately.
- Follower cell order: `eat right`, `eat left`. Show a lowered head, open mouth, and forward bite. Keep it exaggerated, non-graphic, and free of blood or realistic bodily detail.
- Keep the same flat chroma key, generous padding, complete body, no grid, no text, no props, no shadows, and exactly one character per cell.
- Process with `scripts/process_role_sprites.mjs --role leader|follower`.

## Transparency policy

Use built-in `$imagegen` first with a flat chroma-key background. Do not silently switch to CLI or request an API key. The supplied Node processor removes ordinary flat keys. If hair, glass, translucent material, or severe spill cannot be cleaned, explain that native transparency requires the imagegen CLI fallback and explicit user approval before using it.
