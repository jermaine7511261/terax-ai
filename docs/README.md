# Yamet 贡献者文档

本目录存放长文贡献者与维护者指南。仓库根目录的 `YAMET.md` 是活架构文档与事实来源；这些指南在特定领域展开说明，不复述它。

若某指南与 `YAMET.md` 冲突，以 `YAMET.md` 为准。

## 入门

- [YAMET.md](../YAMET.md)：架构事实来源，先读这个
- [CONTRIBUTING.md](../CONTRIBUTING.md)：如何贡献、质量门槛、项目布局

## 架构指南

- [双进程模型与 IPC 命令参考](architecture/two-process-model.md)：Rust 持有全部 OS 访问；webview 经 `invoke()` 通信。命令目录与如何新增命令。
- [PTY shell 集成](architecture/pty-shell-integration.md)：PTY 会话、shell 初始化脚本、OSC 7 / 133、ConPTY、SPAWN_LOCK、作业对象、WSL。
- [安全模型](architecture/security-model.md)：拒绝名单、SSRF 守卫、工作区授权、AI 工具审批、IPC 白名单、OSC 信任、钥匙串处理。
- [AI 子系统](architecture/ai-subsystem.md)：提供商、agent、子 agent、会话、composer、工具、编辑 diff、实时上下文桥。含新增提供商的走查。
- [终端渲染池](architecture/terminal-renderer-pool.md)：槽位池化、DormantRing，以及"绝不序列化命令中途的叶子"不变量。

## 贡献指南

- [测试](contributing/testing.md)：测试契约、如何跑检查、什么构成好的核心子系统测试。
