# 工作流命令

把占位符替换为 `codex_app__load_workspace_dependencies` 返回的路径。直接调用返回的 Node 可执行文件，不依赖用户的 `PATH`。

## 创建项目

```text
"<codex-node>" "<skill>/scripts/create_project.mjs" --name "<应用名>" --out "<输出根目录>" --source "<照片>" --people <1-8> --names "<姓名列表>" --mode <normal|group-shout|poop-chase|all> --self <none|person-N> --consent confirmed
```

用户只需依次确认授权、本人、中文模式和最终效果。禁止再询问恶搞排除者、领头人、跟随者或吃拉顺序，也不要向用户展示命令行键。中文入口映射为：`普通桌宠 -> normal`、`集体跪喊 -> group-shout`、`屎追逐 -> poop-chase`、`全部都要 -> all`。

创建器根据 `--self` 自动派生屎追逐变体：非 `none` 为 `self-poop`，本人持续拉、其余全员追吃；`none` 为 `cursor-centipede`，鼠标控制点击穿透的屎、全员组成不断链的人形蜈蚣追随。跪喊同样自适应：有本人时本人站立不跪、其他全员跪喊；本人不在照片时全员跪喊，不创建站立接收者。

## 记录和处理图片

记录动作前，先用系统图片助手按硬边界键色去背（`--auto-key border --tolerance 24 --edge-contract 1`）。写实人物禁止使用 `--soft-matte` 或全局 `--despill`。随后运行：

```text
"<codex-node>" "<skill>/scripts/cleanup_portrait_chroma.mjs" --input "<透明动作.png>" --out "<清理后透明动作.png>" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>" --key "<#选定键色>"
```

只有清理后的透明文件才能交给 `record_image_generation.mjs` 和 `process_action_sprite.mjs`。仅在白色与主体不冲突时允许生成白底；最终文件仍必须透明且无色边。

```text
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<输出根目录>/preview" --file "<identity-board.png>" --kind identity
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<输出根目录>/preview" --file "<person-1-master.png>" --kind master --character person-1 --prompt-version identity-v1 --version 1
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<输出根目录>/preview" --file "<person-1-crawl-right-1.png>" --kind action --character person-1 --action crawl_right_1 --master-fingerprint "<已批准母版-sha256>" --prompt-version action-v1 --version 1
"<codex-node>" "<skill>/scripts/process_action_sprite.mjs" --project "<输出根目录>/project" --file "<person-1-crawl-right-1.png>" --character person-1 --action crawl_right_1 --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
```

`record_image_generation.mjs` 故意不提供 `--model`。它记录固定的 `codex-imagegen` / `gpt-image-2` / `workflow-attested` 策略并计算文件哈希。

为每个必需动作重复 `action` 记录和 `process_action_sprite.mjs`。每条动作记录必须使用该人物当前已批准母版的指纹。替换失败生成时，必须同时提供 `--supersedes`、`--reason` 和递增后的 `--version`。新 V2 素材禁止使用旧式多动作 `base` / `role` 图表命令；它们仅保留给明确的旧项目恢复。

每个人的动作清单为：`crawl_right_1`、`crawl_right_2`、`crawl_left_1`、`crawl_left_2`、`idle_right`、`idle_left`、`centipede_right`、`centipede_left`、`kneel_shout_1`、`kneel_shout_2`、`kneel_shout_3`、`drag`、`poop_right`、`poop_left`、`eat_right`、`eat_left`。

## 自动重试与本地修正

从主体代表色计算确定性键色序列。同一身份最多三次自动生成：第 1、2、3 次必须使用不同键色；候选一旦通过就停止。三次都失败时，状态必须变为 `manual-repair-required`，禁止产生第 4 次。

启动纯本地修正页：

```text
"<codex-node>" "<skill>/scripts/repair_transparency.mjs" --root "<输出根目录>" --input "<键色源图.png>" --candidate "<自动透明候选.png>" --out "<preview/corrections/版本化修正图.png>" --report "<preview/corrections/修正报告.json>" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
```

修正后记录母版或动作时，附加恢复元数据：

```text
--transparency-attempt 3 --transparency-key "#0066ff" --rejection-reason automatic-attempts-exhausted --correction-report "preview/corrections/修正报告.json"
```

`--transparency-attempt` 只能是 1 到 3；键色必须是 `#RRGGBB`。修正报告路径必须相对输出根目录且位于 `preview/`。记录器会保存报告 SHA-256；self-check 会重新校验报告、输入、候选、蒙版、输出四个文件的 SHA-256，并确认报告输出就是当前母版/动作指纹。

修正产物必须使用新文件名，禁止覆盖输入、自动候选或旧版修正证据。若修正仍留下真实前景内部的颜色污染，必须关闭门禁并重新生成或换照片；不得继续动作生产。

替换示例：

```text
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<输出根目录>/preview" --file "<preview/corrections/person-1-master-v2-corrected.png>" --kind master --character person-1 --prompt-version identity-v1 --version 2 --supersedes "preview/person-1-master-v1.png" --reason "automatic-transparency-failed-manual-mask-approved" --transparency-attempt 3 --transparency-key "#0066ff" --rejection-reason automatic-attempts-exhausted --correction-report "preview/corrections/person-1-master-v2-correction-report.json"
```

## 真透明 fallback

只有同时满足以下条件，才允许离开默认的内置 GPT Image 2 键色路线：

- 三次有界键色尝试均失败，并且本地蒙版修正仍无法消除烘焙进人物内部的色边；
- 用户已经明确授权使用真透明 fallback；
- 本机已设置 `OPENAI_API_KEY`；
- 使用系统 `imagegen` CLI 固定调用 `gpt-image-1.5`，直接生成原生透明 PNG。

不得把此路径设为默认、静默切换模型或恢复任意 `--model` 参数。不得在命令、日志、manifest、修正报告、聊天或公开验收材料中写入或回显 `OPENAI_API_KEY`；只允许检查环境变量是“已设置”还是“缺失”。

真透明母版和动作必须使用封闭布尔标志登记。该标志不接受值，也不能与键色修正元数据同时使用：

```text
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<输出根目录>/preview" --file "<person-1-master-native-transparent-v1.png>" --kind master --character person-1 --prompt-version identity-native-transparent-v1 --version 1 --authorized-native-transparency-fallback
"<codex-node>" "<skill>/scripts/record_image_generation.mjs" --preview "<输出根目录>/preview" --file "<person-1-crawl-right-1-native-transparent-v1.png>" --kind action --character person-1 --action crawl_right_1 --master-fingerprint "<已批准真透明母版-sha256>" --prompt-version action-native-transparent-v1 --version 1 --authorized-native-transparency-fallback
```

登记器会固定写入 `gpt-image-1.5`、用户显式授权和键色门禁已耗尽的来源证明，并拒绝不含透明像素的文件。登记前仍须逐图打开原分辨率 PNG，检查身份一致、完整身体、动作相位、透明边缘和隐藏 RGB；登记后仍须依次运行 `process_action_sprite.mjs`、生成联系表、核验 generation/sprite manifest，并通过 self-check。真透明 fallback 只替代失败的透明生成方式，不降低任何视觉或发布门禁。

## 审核和验证

```text
"<codex-node>" "<skill>/scripts/make_contact_sheet.mjs" --project "<输出根目录>/project" --out "<输出根目录>/preview/action-contact-sheet.png" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
"<codex-node>" "<skill>/scripts/create_identity_review.mjs" --project "<输出根目录>/project" --preview "<输出根目录>/preview"
"<codex-node>" "<skill>/scripts/validate_project.mjs" --project "<输出根目录>/project" --source "<照片>" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
"<codex-node>" "<skill>/scripts/self_check_project.mjs" --project "<输出根目录>/project" --preview "<输出根目录>/preview" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>"
"<codex-node>" "<skill>/scripts/audit_output_privacy.mjs" --root "<输出根目录>" --source "<照片>"
```

第一次 self-check 会创建 `self-check-review.json`；在完成人工视觉审核前，它通常会以非零状态退出。

## 构建

```text
"<codex-node>" "<skill>/scripts/build_project.mjs" --project "<输出根目录>/project" --source "<照片>" --pnpm "<codex-pnpm>" --node-modules "<codex-node-modules>" [--verify-only]
```

先运行一次以采集运行窗口和场景证据；打开图片完成审核并更新运行时审核指纹后，再次运行以打包。第二次运行会自动启动复制后的最终 `.exe` 或 `.app`，生成 `preview/<platform>-packaged-smoke.png`，并对打包输出重复执行隐私审计。

剩余托盘、拖拽、右键和点击穿透检查需要直接启动复制后的产物：

```text
Windows: "<输出根目录>/release/windows/<应用>/<应用>.exe"
macOS:   "<输出根目录>/release/macos/<应用>.app/Contents/MacOS/<应用>"
```

## 发布检查

```text
"<codex-node>" "<skill>/scripts/release_check.mjs"
```

把 `CODEX_PNPM` 设置为 Codex 的 pnpm 路径。官方验证器或带 PyYAML 的 Python 不可用时，检查必须关闭放行；只有明确的本地临时豁免才可设置 `SKIP_OFFICIAL_VALIDATOR=1`。

## 明确迁移 V1

```text
"<codex-node>" "<skill>/scripts/migrate_project_manifest.mjs" --root "<输出根目录>" --dry-run
"<codex-node>" "<skill>/scripts/migrate_project_manifest.mjs" --root "<输出根目录>" --apply --consent confirmed
```

## 镜像源须主动选择

默认安装使用 npm 官方仓库和 Electron 官方发布源。只有 Codex 同时提供明确的第三方地址并设置 `CODEX_ALLOW_THIRD_PARTY_MIRROR=1` 时才能使用第三方源；继续前必须展示安全警告。
