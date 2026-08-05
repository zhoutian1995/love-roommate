# Love Roommate Desktop Pet

这是由 Love Roommate Skill 生成的可编辑 Electron 桌宠项目。具体人物、模式、快捷键与恶搞排除规则以 `src/config/` 下的配置为准。

## 运行与控制

- Windows x64 或 Apple Silicon macOS，动画目标固定为 30 fps。
- 托盘菜单提供 **Pause / 暂停** 和 **Quit / 退出**。Pause 会停止高频动画、窗口移动与重复 IPC；Quit 会彻底释放 Electron 进程。
- 当前实现不会通过降低精灵清晰度、减少人物、删除动作或跳过慢移过程来换性能，也没有伪造可调帧率开关。
- 建议至少 8 GB 内存，并避免在系统或显卡已满载时运行多个人物窗口。实际验收以生成项目的最终窗口数为准，不承诺所有电脑在任意后台负载下都绝不卡顿。

## 性能门禁

- 活动场景帧间隔 p95 ≤ 50 ms，非切换阶段最长停顿 ≤ 150 ms。
- 平均总 CPU ≤ 10%，启动到全部人物窗口可见 ≤ 5 秒。
- 内存以全部 Electron 进程的 total **private bytes** 为 fail-closed 指标，≤ 500 MB；10 分钟 soak 增长 ≤ 50 MB。
- working set 求和仅作诊断，因为 Chromium 共享页会在多个进程中重复计数。
- Pause CPU 必须不高于 idle 的一半，ticker updates/s 必须不高于 idle 的 25%；完整报告保存在输出根目录的 `preview/performance/windows-performance-report.json`。

## 开发验证

```powershell
npm test
node tools/validate-project.mjs
```

最终分享前仍需通过 Skill 的项目验证、自检、场景截图、隐私审计、完整性能跑测和 packaged smoke。
