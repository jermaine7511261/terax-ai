# YaMet 文档系统

## 文档层次

```
docs/
├── index.md                          # 本文件：文档导航
├── architecture/                     # 架构设计文档
│   ├── multi-platform-access.md      # 多端接入架构
│   ├── session-reliability.md        # 会话可靠性
│   ├── extension-ecosystem.md        # 扩展生态
│   ├── security-model.md             # 安全模型
│   ├── ai-subsystem.md               # AI 子系统
│   ├── dap-protocol.md               # DAP 协议
│   ├── mcp-protocol.md               # MCP 协议
│   ├── pty-shell-integration.md      # PTY/Shell 集成
│   ├── terminal-renderer-pool.md     # 终端渲染池
│   └── two-process-model.md          # 双进程模型
├── contributing/                     # 贡献指南
├── yamet-需求迭代-第*轮-*.md         # 迭代需求文档（按轮次）
├── yamet-测试覆盖率迭代-*.md         # 覆盖率迭代文档
├── *.png                             # 架构图
├── e2e-smoke.md                      # E2E 测试方案
├── release-verification.md           # 发布验证 checklist
└── webui-capability-matrix.md        # WebUI 能力矩阵
```

## 根级文档

| 文件 | 职责 | 必读场景 |
|---|---|---|
| `YaMet.md` | 活架构文档（agent 记忆） | 任何代码改动前 |
| `AGENTS.md` | Agent 系统 + 多端接入 + 扩展 + Rust 规范 | Agent 相关开发 |
| `CLAUDE.md` | DTO 边界 + 映射规则 + 验证门禁 + 回复格式 | 任何代码改动前 |
| `CHANGELOG.md` | 每轮变更记录 | 版本发布前 |
| `ROADMAP.md` | 战略方向 + 已交付/规划中 | 规划新功能 |
| `CONTRIBUTING.md` | 贡献流程 | 新贡献者入门 |

## 迭代文档索引

| 轮次 | 版本 | 核心交付 | 文档 |
|---|---|---|---|
| 第三轮 | 0.1.4 | AI 工具面初建 | `yamet-需求迭代-第三轮-2026-08-03.md` |
| 第四轮 | 0.1.5 | 文件浏览器 + 编辑器 | `yamet-需求迭代-第四轮-2026-08-04.md` |
| 第五轮 | 0.1.6 | 源码管理 | `yamet-需求迭代-第五轮-2026-08-04.md` |
| 第六轮 | 0.1.7 | MCP 集成 | `yamet-需求迭代-第六轮-2026-08-04.md` |
| 第七轮 | 0.1.8 | 基础功能补全 | `yamet-需求迭代-第七轮-2026-08-04.md` |
| 第八轮 | 0.1.9 | AI 增强 | `yamet-需求迭代-第八轮-2026-08-05.md` |
| 第九轮 | 0.1.10 | SSH/Remote | `yamet-需求迭代-第九轮-2026-08-05.md` |
| 第十一轮 | 0.1.12 | LSP + PTY + DAP | `yamet-需求迭代-第十一轮-LSP-PTY-DAP-2026-08-05.md` |
| 第十二轮 | 0.1.13 | 测试覆盖 + 漂移门禁 | `yamet-需求迭代-第十二轮-测试覆盖与漂移更新-2026-08-05.md` |
| 第十三轮 | 0.1.14 | 产品成熟度 | `yamet-需求迭代-第十三轮-产品成熟度与引导闭环-2026-08-06.md` |
| 第十四轮 | 0.1.15 | 原生能力深化 | `yamet-需求迭代-第十四轮-原生能力深化-2026-08-06.md` |
| 第十五轮 | 0.1.16 | AI 迷你窗增强 | `yamet-需求迭代-第十五轮-AI迷你窗浮窗增强-2026-08-07.md` |
| 第十六轮 | 0.1.17 | 平台抽象层迁移 | `yamet-需求迭代-第十六轮-平台抽象层迁移-2026-08-07.md` |
| 第十七轮 | 0.1.18 | AI 文件安全模型 | `yamet-需求迭代-第十七轮-AI文件安全模型收紧-2026-08-07.md` |
| 第十九轮 | 0.1.20 | 模型/智能体分离 | `yamet-需求迭代-第十九轮-模型智能体分离与状态栏增强-2026-08-07.md` |
| 第二十轮 | 0.1.21 | Multi-Agent + Graph 原生化 | `yamet-需求迭代-第二十轮-MultiAgent与Graph原生化-2026-08-07.md` |
| 第二十一轮 | 0.1.22 | Grok 网络工具移植 | `yamet-需求迭代-第二十一轮-网络工具移植-Grok-2026-08-08.md` |
| 第二十二轮 | 0.1.23 | Harness/工具/底座打磨 | `yamet-需求迭代-第二十二轮-底座打磨-harness工具-2026-08-08.md` |
| 第二十三轮 | 0.1.24 | 基础功能打磨增强 | `yamet-需求迭代-第二十三轮-基础功能打磨增强-2026-08-08.md` |
| 第二十四轮 | 0.1.25 | Office 套件内置 | `yamet-需求迭代-第二十四轮-Office套件内置-2026-08-08.md` |
| 第二十五轮 | 0.1.26 | AI 子系统全原生内置 | `yamet-需求迭代-第二十五轮-AI子系统全原生-2026-08-09.md` |
| 第二十六轮 | 0.1.26 | （需求轮，未独立成文） | — |
| 第二十七轮 | 0.1.27 | 基础功能加厚深度调研 | `yamet-需求迭代-第二十七轮-基础功能加厚深度调研-2026-08-10.md` |
| 第二十八轮 | 0.1.28 | AI Agent 引擎平台 | `yamet-需求迭代-第二十八轮-AI-Agent引擎平台-深度调研-2026-08-11.md` |
| 第二十九轮 | 0.1.29 | 27 项目横向对比能力补齐 | `yamet-需求迭代-第二十九轮-27项目横向对比-能力补齐-2026-08-11.md` |
| 第三十轮 | 0.1.30 | v0.1.29 验收修复与半接线收尾 | `yamet-需求迭代-第三十轮-验收修复-半接线收尾-2026-08-12.md` |
| 第三十一轮 | — | 工作区选择器深度调研 | `yamet-需求迭代-第三十一轮-工作区选择器-深度调研-2026-08-12.md` |
| 第三十二轮 | 0.1.32 | 多智能体编排 + 多 provider 搜索 + capability 路由 | `yamet-需求迭代-第三十二轮-多智能体编排与多provider搜索-2026-08-10.md` |

## 设计文档阅读顺序

### 新贡献者

1. `YaMet.md`（项目概况 + 质量门槛 + 约定）
2. `AGENTS.md`（Agent 系统 + 多端接入）
3. `CLAUDE.md`（编码规范 + DTO 规则）
4. `docs/architecture/two-process-model.md`（理解双进程）
5. `docs/architecture/security-model.md`（安全边界）

### Agent 平台开发

1. `AGENTS.md`（Agent Runtime Layer 架构）
2. `docs/architecture/multi-platform-access.md`（端间映射）
3. `docs/architecture/session-reliability.md`（会话可靠性）
4. `docs/architecture/extension-ecosystem.md`（扩展机制）
5. `docs/yamet-需求迭代-第二十八轮-AI-Agent引擎平台-深度调研-2026-08-11.md`（最新需求）

### 安全审计

1. `docs/architecture/security-model.md`（安全模型）
2. `AGENTS.md` 铁律 + 验证门禁
3. `CLAUDE.md` 安全拒绝格式
4. `scripts/check-doc-drift.mjs`（漂移检查）
