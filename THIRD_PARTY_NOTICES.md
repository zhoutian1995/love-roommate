# 第三方组件说明

本文件记录本 Skill 固定或调用的主要运行时组件。版本与许可证信息在发布前通过锁文件和 npm 包元数据核实；完整许可证正文以各上游项目发布内容为准。

## Electron 41.0.2

- 用途：构建和运行透明桌宠窗口。
- 来源：Electron 官方项目，<https://github.com/electron/electron>。
- 许可证：MIT。
- 分发方式：Electron 不随 Skill 仓库打包；构建时从官方发布源运行时下载，并校验压缩包哈希和布局。

## Sharp 0.34.5

- 用途：本地图像读取、缩放、透明通道处理和 PNG 输出。
- 来源：Sharp 官方项目，<https://github.com/lovell/sharp>。
- 许可证：Apache-2.0。
- 分发方式：优先使用 Codex 工作区提供的 Sharp；不可用时，按冻结锁文件从批准的 npm registry 运行时下载。依赖缓存不随 Skill 发布。

## Node.js 与 Codex 运行环境

- 用途：执行 Skill 脚本、测试和本地 loopback 修正服务。
- 分发方式：由用户现有的 Codex Desktop 工作区提供，本仓库不重新分发 Node.js 或 Codex Desktop。
- 许可证：取决于用户实际安装的运行环境；本说明不替上游许可证文件作出额外授权。

## 本项目许可证状态

本项目采用 MIT 许可证，完整条款见仓库根目录 `LICENSE`。Electron 和 Sharp 等第三方组件仍分别遵循各自的上游许可证；本项目的 MIT 许可证不会替代或缩减这些第三方条款。
