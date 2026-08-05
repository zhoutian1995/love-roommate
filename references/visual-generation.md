# Visual generation V3

## Non-negotiable style

Use the authorized source photo as the identity reference. Final people must be photorealistic and recognizably the same subjects: preserve face shape, facial features, approximate age, hairstyle, skin tone, body build, clothing colors, glasses, and accessories. Do not use chibi proportions, cartoon faces, beautification, age reduction, costume replacement, or photographic-head compositing.

All selected master and action artwork must use Codex image generation under the declared GPT Image 2 workflow policy.

## Identity-master gate

Create one independent full-body identity master per person before any action artwork.

- One person only, neutral standing pose, full body visible, fixed camera height and scale.
- Use the source photo directly as identity reference; never derive a new master from an old generated action sheet.
- Prefer a flat removable key that does not occur in the person. Keep generous padding and no shadows, props, text, scenery, or neighboring people.
- Build an original-photo / master comparison board and complete the 100-point identity review.
- Require total score >= 90 and identity similarity >= 31/35 with no blocker before action generation.

## Per-action generation

Do not generate a 4x3 or other large multi-action sheet. Generate each action, or at most a mirrored left/right pair, using the approved identity master plus the original photo as references.

Required actions:

- crawl right A/B and crawl left A/B
- idle right/left
- centipede right/left
- kneel shout 1/2/3
- dragged/limp
- poop right/left
- eat right/left

Every participant receives both poop and eat actions. Kneel-shout frames keep the same kneeling body pose and vary only the mouth/arms. Centipede frames must expose a readable mouth point and rear point for physical mouth-to-rear connection.

Each accepted action record must contain the approved master fingerprint, prompt version, action name, generation version, and optional superseded-file/rejection reason.

## Transparency

The released sprite must be a clean transparent PNG. A white or chroma-key background is only an intermediate production aid and must never remain visible in the desktop pet.

- White is allowed when it stays clearly separated from hair, skin, clothing, shoes, and highlights. Do not use naive white removal when the subject contains white or pale-gray areas.
- Otherwise choose one flat removable key that does not occur in the person. The key color is not part of the visual design.
- For photorealistic people, prefer hard background removal (`border` auto-key, tolerance 24, edge contraction 1) followed by portrait-edge cleanup. Do not apply global strong despill or soft-matte color replacement to faces, skin, hair, or clothing.
- Fully transparent pixels must have RGB `0,0,0`; hidden magenta/green/white RGB is a failure because resizing can reveal a colored halo.
- Reject any visible purple, green, gray, or white fringe, semi-transparent rectangle, opaque corner, background gradient, damaged skin tone, or transparent holes in faces and hands.

## Quality gate

Review source photo -> identity master -> every action side by side. Fail on:

- face or age drift, beautification, body-build changes, clothing/accessory changes;
- cross-person identity migration;
- chibi/cartoon rendering or inconsistent realism;
- missing/fused/clipped body parts;
- action scale or camera changes;
- chroma fringe or dirty transparency.

Do not lower thresholds to release an asset. Regenerate only the failed person/action from the approved master.
