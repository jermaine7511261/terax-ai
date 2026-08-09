# 第二十二轮迭代需求：Harness / 工具 / 底座打磨

> 目标版本 **0.1.23**（功能性构建）。
> 用户命题：「harness、工具、等底座打磨，迭代需求」。含义：对测试基础设施（harness）、AI 工具层、构建链路三大底座做系统性打磨——补测试缺口、抽可测纯函数、提覆盖率阈值、清理 CI 门禁。
> 范围：**概念模型 + 调研盘点 + 需求规划 + 实施方案**。

---

## §0 概念模型（先把底座现状搞清楚）

### 0.1 一句话总纲

底座 = 三块支撑：**harness**（测试基础设施）、**tools**（AI 工具层）、**build**（构建/CI 门禁）。这三块决定"能不能放心改代码"。现状：CI 门禁已很完整（audit/lint/test/coverage/build/size/knip/cargo audit/clippy/machete/nextest/llvm-cov 全在），但**测试覆盖有结构性缺口**——platform 层近零测试、三个核心工具缺测试、coverage 阈值偏低。打磨的本质 = **补缺口 + 抽纯函数 + 提门槛**。

```
┌────────────────────────────── 底座（三大支柱）──────────────────────────────┐
│                                                                            │
│  harness（测试基础设施）      tools（AI 工具层）          build（构建/CI）  │
│  ├─ vitest 190文件/1848测试   ├─ 21 个工具文件           ├─ CI 门禁完整 ✅   │
│  ├─ retry:2 testTimeout:10s  ├─ 18/21 有测试            │  audit/lint/test │
│  ├─ coverage 33/29/27/33 ⚠️  ├─ ❌ graph/mcp 缺测试      │  coverage/size/  │
│  └─ ❌ platform 层近零测试     └─ ❌ tools.ts 注册面缺测  │  knip/clippy/    │
│      (tauri 16 + web 16 文件)   │ mcp/formatMcpResult     │  machete/nextest│
│                               │  可抽纯函数              │  llvm-cov 50% ✅ │
│                               └─ platform/web 纯逻辑可测 │                  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 0.2 深度盘点：三块现状（已核实代码）

#### 0.2.1 harness（测试基础设施）

| 项 | 现状 | 评估 |
|---|---|---|
| 测试文件/源文件 | **190 / 486（39%）** | ⚠️ 前端覆盖率偏低 |
| vitest retry | `retry: 2`（vite.config.ts:164） | ✅ |
| vitest testTimeout | `testTimeout: 10_000`（:165） | ✅ |
| coverage 阈值 | **33/29/27/33**（:184） | ⚠️ 可再提（实测 34.35/29.98/28.05/35.34，余量小） |
| **platform 层测试** | **仅 1 个**（web/server/registry.test） | 🔴 **最大缺口** |
| platform/tauri | 16 源文件，0 测试 | 🔴 但依赖 @tauri-apps，难测 |
| platform/web | 16 源文件（path/events/os/clipboard 纯逻辑） | 🔴 **可测但零测试** |
| Rust 测试 | 438 测试 / 94 源文件 | ✅ 良好 |
| Rust coverage 门禁 | `cargo-llvm-cov --fail-under-lines 50`（ci.yml:168） | ✅ |

**核心缺口**：前端 platform 层近零测试 + coverage 阈值偏低 + 3 个核心工具缺测试。

#### 0.2.2 tools（AI 工具层）

| 工具 | 有测试? | 纯逻辑可抽 |
|---|---|---|
| fs / git / edit / search / shell / subagent / delegateMany / memory / net / deepSearch / todo / createSkill / searchMemories / externalAgent / terminal | ✅ 18 个 | — |
| **graph.ts**（`run_graph`） | ❌ | JSON 解析、graph id 派生（`g-${name}-${ts}`）可测 |
| **mcp.ts**（MCP 工具注册） | ❌ | `sanitizeToolName`（字符清洗）、`formatMcpResult`（内容格式化）是纯函数 |
| **tools.ts**（buildTools 注册面） | ❌ | 注册面完整性（所有子 build 挂载）可测 |
| **context.ts** | ❌ | ToolContext 解析可测 |

**核心打磨点**：`mcp.ts` 的 `sanitizeToolName`/`formatMcpResult`、`graph.ts` 的 JSON 解析是现成的纯函数，抽出来测；工具注册面补一个完整性测试（锁死所有工具挂载，防止漏注册）。

#### 0.2.3 build（构建/CI 门禁）

| 门禁 | 现状 | 评估 |
|---|---|---|
| pnpm audit | `--prod --audit-level high` | ✅ |
| cargo audit | `--deny warnings` | ✅ |
| lint / tsc / test / coverage | ✅ | ✅ |
| build / size / knip | ✅ | ✅ |
| cargo clippy / machete / nextest | ✅ | ✅ |
| cargo llvm-cov | `--fail-under-lines 50` | ✅ |

**构建链路已很完整**，本轮只需小幅增强（无需大改）。

### 0.3 关键辨析

1. **为什么 platform/web 该测而 tauri 难测**：web 层是纯逻辑（path.join、事件、os、clipboard 的浏览器实现），node 环境直接测；tauri 层依赖 `@tauri-apps/api`（invoke/事件），需 mock 或跳过。打磨聚焦 web 层可测部分。
2. **coverage 阈值提升要谨慎**：实测余量小（statements 34.35 仅超阈值 33 约 1.3pp），提太多会误杀 CI。建议小幅提到 35/30/28/35，配合补测试后验证。
3. **"抽纯函数"是 YaMet 架构铁律**：`mcp.ts` 的 `sanitizeToolName`/`formatMcpResult` 是纯函数式核心，抽出来可测；tauri 命令/组件保持薄壳。这正好符合"新逻辑放纯函数、少依赖"的质量门槛。

---

## 需求规划（底座打磨三项）

### 融合矩阵

| 缺口 | 动作 | 优先级 |
|---|---|---|
| platform 层零测试 | 补 platform/web 纯逻辑测试（path/events/os） | **P0** |
| graph.ts 缺测试 | 抽 graph JSON 解析 + id 派生纯函数测 | **P0** |
| mcp.ts 缺测试 | 抽 `sanitizeToolName`/`formatMcpResult` 测 | **P0** |
| tools.ts 注册面缺测试 | 补注册面完整性测试（锁死工具挂载） | **P1** |
| coverage 阈值偏低 | 33/29/27/33 → 35/30/28/35（配合补测后验证） | **P1** |
| CI 门禁 | 已完整，确认即可 | P2 |

### P0-1【platform/web】补 platform 层纯逻辑测试

- **目标**：`platform/web/` 的纯逻辑适配器补 vitest 测试。
- **抽纯函数**：把 `webPath.join`（路径拼接）、`webEvents` 事件、`webOs` 等浏览器实现的纯逻辑抽成可测模块（若未抽）。
- **测试**：`platform/web/path.test.ts`（join 的各种 case：空/绝对路径/分隔符）、`os.test.ts`、`events.test.ts`。
- **验证**：vitest 全绿。

### P0-2【tools/mcp】抽 sanitizeToolName + formatMcpResult 测

- **目标**：`mcp.ts` 的两个纯函数抽成 `lib/mcpFormat.ts`（leaf 模块）并测试。
- **`sanitizeToolName`**：字符清洗（`mcp_${server}_${tool}` → 小写、非法字符→`_`、去重下划线、截断 60、空→跳过）。
- **`formatMcpResult`**：MCP content 数组 → 文本（text/image/resource/isError 各分支）。
- **测试**：`mcpFormat.test.ts`（各分支 case）。
- **验证**：vitest 全绿 + tsc。

### P0-3【tools/graph】抽 graph 解析 + id 派生测

- **目标**：`graph.ts` 的 JSON 解析、`g-${name}-${ts}` id 派生抽纯函数测。
- **测试**：graph 解析（非法 JSON、缺 nodes/edges、自动 id）+ 工具 execute 的验证路径（mock buildHooks 后 run_graph 调用）。
- **验证**：vitest 全绿。

### P1-0【tools/tools.ts】注册面完整性测试

- **目标**：锁死 buildTools 的挂载面——所有子 build（fs/git/edit/search/shell/subagent/delegateMany/externalAgent/terminal/todo/memory/searchMemories/net/deepSearch/graph）必须出现在返回对象里，防漏注册。
- **测试**：`tools.test.ts` 断言 buildTools(ctx) 的 key 集合包含全部期望工具。
- **验证**：vitest 全绿。

### P1-1【coverage】阈值提升

- 33/29/27/33 → **35/30/28/35**（先补测试，跑全量 coverage 确认实测超阈值，再提）。
- **验证**：`pnpm test:coverage` 通过。

### P2-0【build】CI 门禁确认

- CI 门禁已完整（audit/lint/test/coverage/build/size/knip/cargo audit/clippy/machete/nextest/llvm-cov）。本轮不改，仅确认。

### 范围外

- platform/tauri 层测试（依赖 @tauri-apps，需 mock 框架，价值低）
- Rust coverage 提升（已 50% 门禁，Rust 侧健康）
- 新增 E2E 框架（文档提到但非本轮）

---

## 实施方案

### 依赖序

```
P0-1 platform/web 测试 → P0-2 mcp 纯函数测试 → P0-3 graph 纯函数测试
→ P1-0 tools 注册面测试 → P1-1 coverage 阈值提升
→ P2-0 CI 确认 → 构建
```

### P0-1 platform/web 测试（小任务 → 2 批）

**批次 A（抽纯函数）**
1. 检查 `platform/web/path.ts` 的 join 是否已是纯函数；若不是，抽 `lib/webPath.ts`。
2. 检查 `os.ts`/`events.ts` 是否有可测逻辑。

**批次 B（测试）**
3. 写 `platform/web/path.test.ts`（join 各 case）、`os.test.ts`、`events.test.ts`。
4. 门禁：vitest + tsc。

### P0-2 mcp 纯函数测试（小任务 → 1 批）

1. `mcp.ts` 抽 `sanitizeToolName`/`formatMcpResult` 到 `lib/mcpFormat.ts`。
2. 写 `mcpFormat.test.ts`（sanitize 各分支 + formatMcpResult 各 content 类型）。
3. 门禁：vitest + tsc。

### P0-3 graph 纯函数测试（小任务 → 1 批）

1. `graph.ts` 抽 graph JSON 解析 + id 派生纯函数到 `lib/graphParse.ts`。
2. 写 `graphParse.test.ts`（非法 JSON/缺字段/自动 id）+ graph execute 验证路径。
3. 门禁：vitest + tsc。

### P1-0 tools 注册面测试（小任务 → 1 批）

1. 写 `tools.test.ts`：buildTools(ctx) 返回 key 集合包含全部期望工具。
2. 门禁：vitest + tsc。

### P1-1 coverage 阈值提升

1. 跑全量 coverage，确认实测 statements/branches/functions/lines。
2. 提阈值到 35/30/28/35（或按实测保守调整）。
3. 门禁：`pnpm test:coverage`。

### 构建

- 版本 0.1.22 → 0.1.23，四文件同步。
- CHANGELOG / ROADMAP / YaMet 三文档同步。
- 验证：tsc 0、vitest 全绿、`pnpm build`、size budget、cargo test。
