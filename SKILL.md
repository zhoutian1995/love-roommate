---
name: love-roommate
description: Use when a user wants to turn an authorized one-to-eight-person photo into a humorous photorealistic desktop pet on Windows x64 or Apple-silicon macOS.
---

# Love Roommate

Treat this Skill as a method, mode library, and validation harness. Never bundle private photos or generated person artwork in the Skill repository.

## User Conversation

- Speak in the user's language; default to plain Chinese. Ask exactly one question per turn instead of presenting a configuration form.
- The first reply after receiving a photo must include a short usability diagnosis and a left-to-right numbered list with distinguishing features. After that diagnosis, ask only the next missing required question. Never skip the diagnosis, even when the user supplied later answers in advance.
- After diagnosis, describe people as `1号`, `2号`, and so on. Keep `person-N`, `none`, `leader`, `followers`, and mode keys out of user-facing replies.
- Ask authorization first when it is missing: `照片里的人都知道并同意制作桌宠吗？` Explain only in plain language: `我只能记录你的确认，不能替你证明其他人真的同意。` If authorization was already supplied, do not ask it again. Stop immediately if the answer is no or unclear.
- Then ask which numbered person is the user. Accept a number, `N号`, or `不在`; map it internally to `person-N` or `none`. Never infer this answer.
- `本人不在照片里` is an explicit user answer, not a fallback for a missing answer. If the user has not identified self or replied `不在`, keep asking only the self question.
- Present exactly these numbered Chinese choices: `1 普通桌宠`, `2 集体跪喊`, `3 屎追逐`, `4 全部都要`. Keep internal mode keys and role configuration out of user-facing replies; the implementation maps the Chinese choice after it knows whether the user is in the photo.
- Reuse valid choices the user already stated instead of asking again. Do not ask for extra prank exclusions, a leader, followers, or an eating order. Everyone except the explicitly selected self participates in the selected prank.
- Apply the self-aware prank contract automatically. With self present, self stays standing while every other character kneels and shouts; in poop chase, self keeps pooping while every other character chases and eats. With no self selected, every character kneels and shouts; in poop chase, a click-through poop follows the real mouse and every character forms a human centipede that chases it.
- With a one-person photo and self present, group shout and poop chase are both safely skipped; only normal desktop pet remains active. State that whole-mode exception explicitly in the final confirmation. With a one-person photo and no self selected, group shout and cursor-poop chase remain available.
- If an answer is missing or invalid, repeat only that question. Never resend the whole questionnaire.
- Before generating, summarize authorization, self selection, the Chinese mode name, and the resulting self-aware behavior in natural language. Continue only after explicit confirmation.

The required conversation sequence is authorization -> self -> Chinese mode -> confirmation. Do not insert an additional configuration question between these steps.

The user only supplies the photo plus four confirmations: everyone authorized the use, which numbered person is self or `不在`, one Chinese mode, and final confirmation. The user may state several of these in advance; reuse every valid answer and ask only the next missing item. The Skill, not the user, derives who kneels, who shouts, who poops, who chases, and the eating order.

The first reply always diagnoses and numbers the photo before advancing through that sequence. If authorization, self, and mode are already supplied, the first reply proceeds directly from diagnosis and numbering to the final confirmation. Never repeat an answered question merely to preserve the nominal sequence.

## Ordinary User Guidance

Explain the Skill in plain Chinese whenever the user asks what it does or how to use it. Make these two compact flows explicit:

- 对话流程：`上传照片 → 授权 → 本人 → 模式 → 最终确认`
- 制作流程：`身份确认 → 动作确认 → 逐模式搞笑评分 → 构建与真实运行验收`

Tell the user they can start with only: `使用 $love-roommate 处理这张合照。` They may also answer known choices in advance. Say `用户可以一次说完` and give both branch examples: `照片里的人都同意，我是3号，全部都要。` and `照片里的人都同意，我不在照片里，全部都要。` Reuse those valid answers and ask only the next missing question.

State the ambiguity rule in exactly this plain meaning: `没回答本人是谁，不等于本人不在。只有用户明确回复“不在”，才能进入无本人分支。` Never interpret silence, an invalid number, or a skipped answer as `不在`.

When presenting the four choices, attach the description for the already-confirmed self branch so the user does not need to guess what a mode name means:

- `普通桌宠`：所有照片人物在桌面自由活动，可拖拽、暂停和退出。
- `集体跪喊`：有本人时本人站着不跪，其余全员排队跪下，分拍喊“爸爸”“爷爷”；本人不在时，全员排队跪下喊“爸爸”“爷爷”，不虚构站立接收者。两个分支都优先自动排成居中单排，屏幕放不下时才改成不重叠、不裁切的居中多排。
- `屎追逐`（有本人）：本人是唯一且持续拉屎的人，其余全员轮流追吃，吃完归队，身份永不交换。
- `屎追逐`（本人不在）：鼠标控制一坨点击穿透的屎，照片里全员首尾连接成人形蜈蚣追着爬。
- `全部都要`：包含普通桌宠、集体跪喊和与本人状态对应的屎追逐，可在运行时切换。

`集体跪喊`是一个用户选项，但运行与验收包含“爸爸喊”和“爷爷喊”两个独立场景，不再让用户额外二选一。`全部都要`因此包含四个可见场景：普通桌宠、爸爸喊、爷爷喊，以及与本人状态对应的屎追逐。

Do not dump the internal production checklist on a first-time user. After final confirmation, explain only the next visible checkpoint. Pause for identity approval, then action/transparent-edge approval. After those approvals, inspect full-composition runtime evidence yourself, score dad shout, grandpa shout, and the active poop-chase variant separately, optimize every score below 90, then build and manually operate the packaged app before delivery.

Use one of these two behavior summaries in the final confirmation, adapted to the selected mode:

- Self present: `你是N号；跪喊时你站着不跪，其他人全部跪下喊爸爸或爷爷；屎追逐时只有你持续拉，其他人全部轮流追吃。`
- Self absent: `你不在照片里；跪喊时照片里所有人全部跪下喊爸爸或爷爷；屎追逐时鼠标控制一坨屎，所有人连成人形蜈蚣追着爬。`

| 用户模式 | 指定本人在照片里 | 本人不在照片里 |
| --- | --- | --- |
| 普通桌宠 | 所有人正常在桌面活动。 | 所有人正常在桌面活动。 |
| 集体跪喊 | 有本人时本人始终站立不跪；其他角色全部自动排队跪下，分拍喊“爸爸”“爷爷”。屏幕放得下时单排，放不下才用不重叠多排。 | 本人不在时不虚构站立接收者；照片里所有人自动排队跪下，分拍喊“爸爸”“爷爷”。屏幕放得下时单排，放不下才用不重叠多排。 |
| 屎追逐 | 本人始终在追逐队伍前面，是唯一且持续的拉屎者；其他所有人按照片编号循环冲上去追吃，吃完归队，身份与拉屎者永不交换。 | 一坨点击穿透的屎跟随真实鼠标；照片里所有人首尾连接成人形蜈蚣，追着鼠标屎爬。 |
| 全部都要 | 同时包含普通桌宠、本人站立的集体跪喊和本人持续拉的屎追逐。 | 同时包含普通桌宠、全员跪喊和鼠标屎带领的全员人形蜈蚣。 |

The matrix above is the complete public behavior contract. Never invent another role-selection step, never swap the self-poop source, and never exempt a photographed character from a selected prank unless that character is the explicitly selected self.

有本人时，本人持续拉，其他角色全员追吃，并通过轮流冲刺、吃完归队来制造节奏。用户明确回答本人不在时，集体跪喊必须明确表现为全员跪下喊爸爸或爷爷；不能因为没有站立接收者就取消这个模式。屎追逐必须由鼠标控制一坨点击穿透的屎，并让全员组成不断链的人形蜈蚣追着它爬。

## Required Gates

1. Use Codex Desktop. Load workspace dependencies and retain its Node, pnpm, and node_modules paths. Read [references/codex-runtime.md](references/codex-runtime.md).
2. Follow the User Conversation sequence. Require the user to confirm that every depicted person authorized this use. Explain briefly that the Skill records only the user's declaration; it cannot prove legal consent.
3. Diagnose the photo before generation. Accept 1-8 separable people; report ambiguity, occlusion, cropping, low resolution, or clothing that may confuse identities.
4. Number people left-to-right unless the user supplies a mapping. Show only friendly numbered labels. Convert the user's self answer to `none` or one explicit `person-N`; never infer it and never ask for additional prank exclusions.
5. Convert the user's Chinese choice through the current internal mode mapping. The public choices remain `普通桌宠 / 集体跪喊 / 屎追逐 / 全部都要`; never expose or ask the user to configure `leader`, `followers`, relay order, or raw mode keys.
6. Read [references/visual-generation.md](references/visual-generation.md). Generate all final identity, base, and role artwork with Codex image generation under the declared GPT Image 2 policy. Save it only in the user's `preview/`; never in this Skill.
6a. Treat `$CODEX_HOME/generated_images` as a stale generated-images cache unless the file is bound to the current native generation event. If it did not refresh, recover the complete `result` from the current task session JSONL entry for this exact `image_generation_call.id`; validate the decoded PNG signature, dimensions, and SHA-256, and require a unique SHA-256 for every different person or asset. A stale cache is not permission to switch to CLI or `gpt-image-1.5`, and never fabricate a generation manifest.
7. Explain provenance honestly: `generation-manifest.json` is a workflow attestation plus file hash, not an OpenAI-signed model receipt and not resistant to deliberate forgery.
8. Pause for identity approval before processing. Confirm numbering, faces, hair, clothing, self selection, Chinese mode, and the resulting behavior summary.
9. Create the project only with `--consent confirmed`. Validate all inputs before writing and never overwrite an existing output. Use [references/workflow-commands.md](references/workflow-commands.md) for exact commands.
10. Create and approve one photorealistic identity master per person. Generate actions individually or as left/right pairs from that approved master. With self present, self requires poop actions and every other character requires eat actions; with no self selected, every character requires centipede actions. Record master fingerprint, prompt version, action, version, and replacement reason.
10a. Release only clean transparent PNG sprites. White or chroma-key backgrounds are intermediate aids, never final styling. For photorealistic people, forbid global strong despill; preserve skin and clothing, clear RGB in fully transparent pixels, and reject any purple, green, gray, or white halo.
10b. 透明恢复必须有界：每个身份母版最多尝试三次（at most three），每次使用未重复的高对比键色并重新通过身份审批。三次仍失败才进入本地蒙版修正（local mask repair）；服务只监听 `127.0.0.1` 随机端口并使用随机令牌。
10c. 本地修正只发送笔画操作给 loopback 服务，不得上传修正图片（must not upload corrected images）或任何画布像素。修正结果仍须重新通过清边、统计、原分辨率视觉检查和 self-check；残留污染或人物侵蚀必须失败关闭（fail closed），不得继续动作生成。
10d. 若键色与本地蒙版仍无法消除烘焙色边，只能在用户显式授权后启用真透明 fallback：使用 CLI `gpt-image-1.5` 原生透明 PNG，并要求用户在本机设置 `OPENAI_API_KEY`。不得静默切换模型或把它伪装成默认内置路径；结果仍须通过相同的逐图视觉门禁、manifest 血缘和 self-check。
11. Build the contact sheet, validate Manifest V2, run the output privacy audit, and run self-check. V1 projects must use the explicit migration command; never migrate silently.
12. Read [references/self-check.md](references/self-check.md). Open the identity board and action contact sheet with `view_image`; do not mark visual fields passed from JSON alone. Repair only failed characters.
13. Require `self-check-report.json` status `pass` and score at least 90, then pause for the second user approval of identity, action readability, complete bodies, and transparent edges.
13a. Complete a separate 100-point manual humor review for every enabled special prank: dad shout, grandpa shout, and the active poop-chase variant. Bind each entry to current scenario image evidence. Every prank below 90 must fail even when the other pranks and technical self-check pass. Record meaningful deductions, concrete optimizations, and post-change reevaluation before rebuilding.
14. Build only for the current host. Inspect full-composition runtime captures for normal, self-aware poop chase, kneeling dad shout, kneeling grandpa shout, and pause. With self present, dad/grandpa reports must show self as the standing recipient and every other character as a participant; with no self selected, reports must show no recipient and every character as a kneeling participant. Reject per-window screenshots as proof of formation quality.
14a. Windows 性能发布门禁必须保留五窗口 packaged 回归，并对最终八窗口 packaged 候选重新执行一次完整真实审计；两份证据缺一不可。使用 `scripts/run_performance_audit.mjs` 启动对应 `.exe`，每个阶段逐秒记录全部 pet window id、`isVisible` 和 `isDestroyed`；只证明窗口曾经出现过不合格，任一阶段中途少窗、隐藏或销毁都必须失败关闭。随后必须运行 `scripts/validate_performance_release.mjs`，机械核对 5+8 两份报告来自相同候选代码 fingerprint，并分别绑定各自项目 runtime fingerprint、packaged `.exe` SHA-256 和准确人数。最终八窗口 `build_project.mjs` 必须带 `--release-performance-gate` 及全部五窗口证据参数。两种人数使用完全相同的阈值：目标 30 fps、活动帧 p95 不高于 50 ms、非切换长停顿不超过 150 ms、平均总 CPU 不高于 10%、全部窗口 5 秒内可见、total private bytes 不高于 500 MB、10 分钟 private-memory 增长不高于 50 MB、Pause CPU 不高于活动阶段的一半、Pause ticker updates/s 不高于活动阶段的 25%。working set 仅作诊断，因为 Chromium 共享页会被跨进程重复计数。不得静默放宽阈值，也不得以删除人物、动作、慢移排队效果或降低清晰度换取通过。
14b. 五人仅是回归样例（five-person example），不是产品固定形态。必须验证随机 1～8 人项目；跪拜队伍单排放不下时，使用居中多排（multi-row）布局，保持配置顺序、所有窗口完整位于工作区内、互不重叠。有本人时，让站立本人位于整个队形的中心轴上；没有指定本人时，不得虚构站立接收者，全员跪喊。发布证据必须明确记录五窗口回归和最终八窗口 Windows packaged 审计各自的报告 SHA-256、可执行文件 SHA-256、人数、阈值和结论。
15. Complete the runtime review fingerprint, rerun the build, launch the packaged result, and manually check tray pause/quit, drag, right-click, and transparent-pixel click-through.

## Privacy And Supply Chain

- Keep only relative paths in persisted JSON/Markdown. Never persist the original photo hash, size, creation time, username, or host path.
- When `--source` is available, use it only for an in-memory exact-copy scan. Audit the entire output root before release; `project/`, `release/`, and `preview/` must not contain the source, including through symlinks.
- Allow only sprite-manifest-listed raster files inside `project/`. Run `audit_output_privacy.mjs` before packaging.
- Prefer Codex-bundled Sharp. If it cannot load, use the locked Sharp runtime from the approved npm registry automatically.
- Use frozen pnpm lockfiles. Never retry through a third-party registry or Electron mirror unless both the mirror address and `CODEX_ALLOW_THIRD_PARTY_MIRROR=1` are explicit.
- Verify the Electron archive checksum and runtime layout. Preserve macOS framework relative symlinks.

## Runtime Contract

- Keep the real cursor visible. Decorative effects must be permanently click-through.
- Use sprite mouth/rear anchors for human-centipede formation. Each mouth must touch the previous rear within the configured tolerance. When no self is selected, the click-through poop follows the real cursor and the complete human centipede chases it.
- Dad and grandpa commands use `selection.userCharacterId` as the standing recipient when present. Move that recipient gradually to the row's center axis, move every other character into a non-overlapping row, then kneel and play synchronized shout frames `0 -> 1 -> 2`; the recipient remains idle with no phrase. When no self is selected, set no recipient and make every character kneel and shout. If self is the only character, return a safe no-participants no-op.
- In poop chase with self present, keep self visibly in front as the fixed pooping source for the whole sequence. Every other character chases and eats in repeating photo-number order, then returns to the chase line; an eater never becomes the next pooping source. Keep only one readable poop visible at a time. When no self is selected, the mouse-controlled poop is permanently click-through and no photo character is treated as its owner.
- Bind IPC identity to trusted pet WebContents. Reject unknown senders, non-main frames, unexpected local pages, navigation, popups, and permissions.
- Keep effect pages without preload or IPC.
- Treat `pet.config.json`, `behaviors.json`, and `sprites/manifest.json` as supported configuration. Read [references/runtime-config.md](references/runtime-config.md) before changing behavior.
- Read [references/platform-build.md](references/platform-build.md) before claiming platform acceptance.
- Use one shared 30 fps ticker, suppress unchanged window bounds and renderer IPC, create effect windows lazily, and stop high-frequency animation work while paused. Production runs keep performance sampling disabled unless the explicit audit environment is active.

## Manual Humor Gate

Score each selected special prank independently from its current full-composition scenario evidence. `all` therefore needs three reviews: `dad-shout`, `grandpa-shout`, and either `poop-chase` or `cursor-centipede`. The six fields total 100 points:

| 人工评分维度 | 分值 | 通过时应当一眼看出的内容 |
| --- | ---: | --- |
| 角色关系 | 25 | 谁是本人、谁跪、谁拉、谁追吃没有歧义 |
| 荒诞程度 | 20 | 梗直接且出乎意料，不靠堆乱七八糟的效果 |
| 动作与节奏 | 20 | 集合、跪下、喊话、拉和追吃有明确节拍 |
| 队形表现 | 15 | 跪喊整齐，蜈蚣不断链，追逐方向清楚 |
| 屎的可读性 | 10 | 看得清、位置合理，不遮脸、不变成巨大贴纸 |
| 回看欲 | 10 | 有递进、反差或时机感，让人愿意再看一次 |

Visual hard failures override the numeric impression and require a new capture:

- 有本人时，本人与跪拜队的可见距离超过一个人物身高，说明关系像组织结构图而不是现场跪拜，必须判失败并返工。
- 爸爸喊和爷爷喊如果只是换文字、换颜色而没有可见的姿态或节奏升级，两个场景都必须判失败并返工。
- 追吃高潮里，吃的人嘴部没有接触或碰到屎的边缘，只靠“啊呜”气泡解释，必须判失败并返工；屎也不得覆盖整张脸。
- 无本人屎追逐里，人形蜈蚣出现断链、人物各自排队爬或有人脱队，必须判失败并返工。

任一特殊恶搞总分低于 90 必须整体失败；不得用另一个恶搞的高分、技术分、隐私通过或“功能已经能跑”替代搞笑验收。每条审核必须写明 `prankId`，绑定当前该场景的 `evidenceRefs`，记录六项分数、严格求和的总分、有意义的扣分原因、具体优化和重新截图后的复评结果。对象、布尔值、纯空白或零宽字符不算文字。评分契约本身参与 runtime fingerprint；权重、阈值或必填字段变化后旧审核自动失效。普通桌宠模式不要求 humor review。

## Release Gate

Run the unified release check and official Skill validator. The unified gate must explicitly include portrait chroma, transparency repair core, loopback security, mask editor contract, and bounded retry tests on Windows and macOS CI. On Windows, the build must also validate the fresh `preview/performance/windows-performance-report.json` generated by `scripts/run_performance_audit.mjs`. The repository must contain no person raster, generated output, dependency cache, or private path. Windows and Apple-silicon macOS acceptance must use fictional people, and any public report must be redacted JSON without images or host paths.
