# 第二十轮迭代需求：Multi-Agent / Graph Engineering 原生内置

> 目标版本 **0.1.21**（功能性构建）。
> 用户核心命题：「Prompt/Context/Loop/Multi-Agent/Subagent/Graph Engineering 与 harness 是啥关系，怎么做成内置原生功能」；并要求**先把所有概念搞清楚**，再谈需求。
> 范围：**概念模型 + 需求规划 + 实施方案**（用户指定不展开质量门禁）。

---

## §0 概念模型（先把所有概念搞清楚）

### 0.1 一句话总纲

这六种 Engineering **不是六个并列的同层概念，而是四个嵌套的抽象层级**：内层是"单次调用的输入"（Prompt+Context），中层是"单个 agent 的执行循环"（Loop），外层是"多个 agent 的组织"（Subagent/Multi-Agent），最外层是"整个系统的编排"（Graph）。harness 则是**贯穿全部层级、承载它们运行的执行环境**，它不属于任何一层，而是所有层的容器。

```
┌────────────────────────── harness（运行时外壳：进程/工具桥/状态/审批/事件流）───────────┐
│                                                                                        │
│  ┌── Graph Engineering（系统怎么组成）────────────────────────────────────────────┐   │
│  │   把 agent/工具/状态/判断/人工/循环编排成一张可运行的图（DAG/顺序/分支）              │   │
│  │                                                                                  │   │
│  │   ┌── Multi-Agent（谁来做：一个还是多个分工）──────────────────────────────┐     │   │
│  │   │   Lead 规划 → 多个 Worker 各司其职 → 结果聚合                              │     │   │
│  │   │                                                                          │     │   │
│  │   │   ┌── Subagent（怎么委派：主→子的上下文隔离）────────────────┐         │     │   │
│  │   │   │   主 agent 把边界明确的局部任务委派出去，隔离上下文          │         │     │   │
│  │   │   │                                                          │         │     │   │
│  │   │   │   ┌── Loop（单个 agent 怎么持续行动）────────────┐       │         │     │   │
│  │   │   │   │   思考 → 行动(工具) → 观察(结果) → 再思考     │       │         │     │   │
│  │   │   │   │                                              │       │         │     │   │
│  │   │   │   │   ┌── 单次调用（agent 怎么想/知道什么）──┐   │       │         │     │   │
│  │   │   │   │   │  Prompt(怎么想) + Context(知道什么)  │   │       │         │     │   │
│  │   │   │   │   └─────────────────────────────────────┘   │       │         │     │   │
│  │   │   │   └──────────────────────────────────────────────┘       │         │     │   │
│  │   │   └──────────────────────────────────────────────────────────┘         │     │   │
│  │   └──────────────────────────────────────────────────────────────────────────┘     │   │
│  └────────────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 0.2 四个层级的精确定义与边界

| 层级 | 概念 | 解决 | 粒度 | 边界（管什么 / 不管什么） |
|---|---|---|---|---|
| **L1 输入** | **Prompt Engineering** | Agent 怎么想 | 单次模型调用 | 管：角色/目标/规则/输出格式（节点的"行为定义"）。不管：模型能拿到什么信息 |
| | **Context Engineering** | Agent 知道什么 | 单次模型调用 | 管：喂哪些文件/历史/工具结果/记忆，压缩/隔离/舍弃哪些。不管：模型怎么用这些信息 |
| **L2 循环** | **Loop Engineering** | Agent 怎么持续行动 | 单个 agent | 管：思考-行动-观察的迭代闭环、步骤上限、错误反馈、重试。不管：谁来跑这个 loop、多个 loop 怎么排 |
| **L3 组织** | **Multi-Agent** | 一个任务一个 agent 还是多个分工 | 多个 agent 协作 | 管：Lead 拆解、Worker 分工、结果聚合。**不一定是委派**——也可以平级协作 |
| | **Subagent** | 主 agent 如何委派局部任务 | 主→子委派关系 | 管：主把边界明确的任务交出去，**核心价值是上下文隔离**（子独立探索，只返回结论）。是 Multi-Agent 的一种特定形态（主从委派），而非独立层级 |
| **L4 编排** | **Graph Engineering** | 所有元素如何组成完整系统 | 整个系统 | 管：把 agent/工具/状态/判断/人工操作/循环编排成可运行图（DAG/顺序/分支/聚合）。不管：单个 agent 内部怎么跑 |
| **贯穿** | **harness** | 承载以上所有层运行的环境 | 全系统 | 管：进程、工具桥、状态存储、审批通道、事件流、UI 呈现。是**容器**，不属于任一层 |

### 0.3 关键辨析（易混淆的三对）

1. **Prompt vs Context**：同一层（L1）的两个输入维度。Prompt 定义"怎么想"（行为约束，影响输出质量），Context 定义"知道什么"（信息供给，影响可用信息量）。两者合成一次调用的输入。**示例**：system prompt 说"你是后端工程师"是 Prompt；给它 `backend/models.rs` 的源码是 Context。

2. **Subagent vs Multi-Agent**：Multi-Agent 是"组织"（L3 总称），Subagent 是"委派关系"（L3 的一种主从形态）。**区别在关系**：Subagent 强调"主把任务交出去、隔离上下文、只回结论"；Multi-Agent 还包含平级分工（Lead 规划 + 多个 Worker 并行，聚合回 Lead）。**Subagent 是 Multi-Agent 的特例**，但"委派"这一动作同时承载了上下文隔离这个独特价值，所以值得单列。

3. **Loop vs Graph**：Loop 是"单个 agent 内部"的循环（L2），Graph 是"多个节点之间"的编排（L4）。**Loop 是 Graph 中一个 agent 节点的内部结构**；Graph 把多个 loop（agent 节点）+ 判断（judge）+ 人工（human）+ 聚合（merge）连接起来。**一句话**：Loop 管"一个 agent 怎么转圈"，Graph 管"多个圈怎么连成系统"。

### 0.4 深度调研：E:\Agent 六个项目的多智能体工程（可吸收机制）

**结论先行**：三个成熟多智能体项目（hermes / opencode / grok-build / claude-code-haha）**没有一个是声明式 LangGraph 式 DAG 编排**。业界的成熟实践是「**主循环 + 隐式条件门 + 命令式并行委派 + 审批 checkpoint**」的混合体。这**修正了本轮需求方向**：不做重 DAG 图引擎，做轻量编排 + 强健壮性。

| 项目 | 语言 | 最值得吸收的机制 | yamet 落点 |
|---|---|---|---|
| **grok-build** | Rust | ① `SubagentCoordinator` actor + `ChildRunner` trait + mpsc 驱动并发/取消；② `xai-workflow` **Journal 确定性重放**（request_hash 去重、可 resume）= 可断点续跑工作流；③ `goal_tracker` worker/verify **双轮** + 预停检测 + token 预算；④ worktree 快照 + `snapshot_ref` 会话恢复；⑤ `subagents_max_depth` 防递归 | 后端核心移植：actor + journal + worker/verify |
| **hermes** | Python | ① `IterationBudget{max_total,used,lock}` consume/refund 计数器（父500/子50）；② `SubagentHandle{depth,parent_id,id}` + HMAC 防伪 + 状态枚举（PENDING→…→SUCCEEDED/FAILED/INTERRUPTED）；③ **summary 预算封顶**（`min(剩余/批数, 静态上限)`）+ 落盘指针防主上下文爆炸；④ MoA 并行 reference→聚合器（join_all + 失败降级）；⑤ 上下文四元接口（compress/select_context/on_turn_complete/prune）+ 防抖动门 + 头尾保护区；⑥ **单一共享 git 影子仓 checkpoint**（GIT_DIR 重定向 + 每轮去重） | 状态机 + 预算 + summary 封顶 + checkpoint |
| **opencode** | TS | ① **Agent 即纯配置 schema**（mode: subagent/primary/all + hidden，内置+用户合并）；② **子任务 = 子 Session + parentID 树**（task_id 续跑、天然隔离）；③ agentic loop 健壮退出（`finish≠tool-calls 且无待执行工具`）+ doom-loop 检测；④ **Plan = 受限只读角色 + markdown 文件 + plan_exit 批准移交 build**（无需 DAG）；⑤ 审批三态 once/always/reject + always 级联放行 + RejectedError 反馈纠错 | 前端：agent 配置 schema + plan 模式 + 审批三态 |
| **claude-code-haha** | TS | ① coordinator 模式提示词 + `<task-notification>` 结果 XML 回传；② 后台化 subagent（spawn/resume/fork 上下文）；③ ToolUseConfirm 权限队列 + worker badge + 审批 feedback + 权限持久化 | 前端：审批 UI + worker 结果协议 |

**三条共性铁律（三个项目一致，yamet 必须吸收）**：
1. **上下文隔离是委派的第一价值**——子 agent 永远独立会话/上下文（opencode parentID 树、hermes 独立 AIAgent 实例、grok worktree），只回结论。子任务工具权限 ⊆ 父权限（hermes 工具集交集、opencode deny 递归）。
2. **结果回传必须有预算封顶**——子 summary 超限落盘 + 上下文只留头部 + 文件指针（hermes summary 预算 + opencode `<task_result>` 结构 + grok journal），防主上下文爆炸。
3. **深度/递归必须有上限**——`subagents_max_depth`（grok）/ `subagent_depth`（opencode）/ `max_spawn_depth`（hermes）防无限委派。
4. **审批以"注入指令继续 loop"而非硬阻塞**（hermes nudge 门）+ 三态 + 级联（opencode）。



### 0.5 harness 包含哪些概念（六层工程赖以运行的底座）

harness 不是"一个东西"，而是**七个底层组件的集合**。六层工程（Prompt/Context/Loop/Multi-Agent/Subagent/Graph）全部运行在这些组件之上；反过来，这六个组件让六层工程得以落地。**本轮要做的，是把这些 harness 组件在 yamet 里补齐/强化，使六层工程能原生承载。**

| # | harness 组件 | 定义 | 承载的工程层 | yamet 现状 |
|---|---|---|---|---|
| H1 | **工具桥 Tool Bridge** | 工具注册、参数校验（zod）、结果回传、工具白名单/隔离 | L1/L2/L3 | ✅ `ai/tools/*` + `tool()`，已有白名单/动态审批 |
| H2 | **会话/状态管理 Session & State** | 会话生命周期、消息历史、agent 状态、持久化 | L2/L3 | ⚠️ `chatStore`+`Chat`，单会话，**缺 parentID 树** |
| H3 | **审批通道 Approval** | 工具审批、权限规则、用户确认 | L2/L3/L4 | ⚠️ `approvalResponder` **二元**(approve/deny)，**缺三态+级联+反馈纠错** |
| H4 | **事件流 Event Stream** | LLM/工具事件 → UI 实时流 | L1-L4 | ⚠️ `agentMeta`+`ActivityStrip`，缺统一事件管道 |
| H5 | **预算/上限 Budget** | 迭代预算、token 预算、深度上限、并发上限 | L2/L3 | ❌ 无（只有 stepCountIs(24)） |
| H6 | **checkpoint/恢复 Checkpoint** | 断点续跑、journal 重放、快照回滚 | L4 | ❌ 无 |
| H7 | **记忆 Memory** | 长期/会话/项目记忆的写、检索、隔离、跨会话持久化 | L1/L3 | ⚠️ 读写+注入链路存在但**全量无差别注入/无标记隔离/无自动沉淀** |

**结论**：yamet 已有 H1（工具桥）✅，H2/H3/H4/H7 部分（⚠️ 需强化），H5/H6 完全缺失（❌）。**本轮需求 = 六层工程的缺失部分 + harness 的缺失组件一起融合**，不是只做 agent 编排层。

### 0.6 这些概念如何落进 yamet（harness 映射）

yamet 的 harness = **Tauri 2 + Rust 桌面壳**。它已经提供了 L1/L2/L3-委派 的大部分基础设施，缺的是 L3-组织 和 L4-编排。

| 层级 | yamet 现状 | 缺口 | 本轮动作 |
|---|---|---|---|
| L1 Prompt | ✅ `agents.ts`（5内置agent的systemPrompt）+ `registry.ts`（subagent systemPrompt） | 无 | 不动 |
| L1 Context | ✅ `compact.ts`（压缩/隔离）、`prepareAgentPrompt`（注入）、`agentActivityStore` | 子agent共享主上下文，无独立记忆 | **P1-2**：subagent 定向上下文注入 |
| L2 Loop | ⚠️ 主agent `stepCountIs(24)` 循环（隐式），子agent单次 `generateText` | 无"思考-行动-观察"显式状态机/可见性 | **P1-1**：loop 状态机可视化 |
| L3 Multi-Agent | ❌ 无 | 无 Lead/Worker 分工、无并发、无聚合 | **P0-2**：Lead 规划 + 并行 Worker + 聚合 |
| L3 Subagent | ✅ `run_subagent` 6类型、工具白名单、动态审批、活动卡片 | 只有单发，无并发/聚合 | **P0-2** 复用其工具集 |
| L4 Graph | ❌ 无 | 无节点编排、无 judge/human/merge、无事件流 | **P0-1**：graph 编排引擎 |
| harness | ⚠️ H1✅ H2/3/4/7部分 H5/6❌ | 缺预算/checkpoint/审批三态/事件管道/记忆召回注入 | **P1-4/P2**：harness 组件补齐 |

---

## 需求规划（L1-L4 全层 + harness 组件全融合）

> **融合原则**：不只做 agent 编排层。六层工程（L1-L4）的缺失部分 + harness 组件（H1-H7，含记忆）的缺失部分**一起进入本轮**，形成一张完整的"概念层 × 需求项"矩阵，无遗漏。

### 融合矩阵（确认无缺口）

| 概念层/组件 | 需求项 | 吸收来源 | 参考源文件 |
|---|---|---|---|
| L1 Prompt · agent 定义 | **P1-0** Agent 配置 schema 化 | opencode | `E:/Agent/opencode-dev/packages/opencode/src/agent/agent.ts` (Info schema)
| L1 Context · 压缩强化 | **P2-1** 上下文四元接口 + 防抖动门 | hermes | `E:/Agent/hermes-agent-main/agent/context_engine.py` + `context_compressor.py`
| L2 Loop · 状态机可见 | **P1-1** loop 状态机 + 健壮退出 + doom-loop | opencode/hermes | `E:/Agent/opencode-dev/packages/opencode/src/session/prompt.ts` + `processor.ts`
| L3 Subagent · 独立上下文 | **P0-2** 子任务独立上下文 + 深度上限 | opencode/grok/hermes | `E:/Agent/opencode-dev/packages/opencode/src/tool/task.ts` + `E:/Agent/hermes-agent-main/agent/subagent_lifecycle.py`
| L3 Multi-Agent · 分工并发 | **P0-2** Lead/Worker 并行 + 聚合 + 预算封顶 | grok/hermes | `E:/Agent/grok-build-main/crates/codegen/xai-grok-tools/src/implementations/grok_build/task/coordinator.rs` + `E:/Agent/hermes-agent-main/agent/tools/delegate_tool.py`
| L4 Graph · 轻量编排 | **P0-1** 编排器 + journal 断点续跑 + worker/verify | grok/opencode | `E:/Agent/grok-build-main/crates/codegen/xai-workflow/src/journal.rs` + `xai-grok-shell/src/session/goal_tracker.rs`
| H1 工具桥 | ✅ 已有 | — |
| H2 会话/状态 · parentID 树 | **P2-2** 子会话 parentID 树 | opencode | `E:/Agent/opencode-dev/packages/opencode/src/tool/task.ts` (sessions.create parentID)
| H3 审批通道 · 三态 | **P1-3** once/always/reject + 级联 + 反馈 | opencode/claude | `E:/Agent/opencode-dev/packages/opencode/src/permission/index.ts` + `E:/Agent/claude-code-haha/src/utils/swarm/inProcessRunner.ts`
| H4 事件流 · 统一管道 | **P1-1**（并入 loop 事件管道） | hermes/opencode |
| H7 记忆 · 自动注入 + 记忆图 | **P1-4** 记忆系统重构（召回式注入） | hermes | `E:/Agent/hermes-agent-main/agent/memory_provider.py` + `context_engine.py` + `learning_graph.py`
| skill 自动沉淀 | **P1-5** skill 自动策展维护（curator 式） | hermes | `E:/Agent/hermes-agent-main/agent/curator.py`
| H5 预算/上限 | **P2-3** IterationBudget + 并发/深度上限 | hermes/grok | `E:/Agent/hermes-agent-main/agent/iteration_budget.py`
| H6 checkpoint/恢复 | **P0-1** journal 重放（并入编排器） | grok | `E:/Agent/grok-build-main/crates/codegen/xai-workflow/src/journal.rs`

---

### P0-1【L4 Graph + H6 checkpoint】轻量编排引擎（可断点续跑）
**参考源**：grok `E:/Agent/grok-build-main/crates/codegen/xai-workflow/src/journal.rs`（断点续跑）+ `crates/codegen/xai-grok-shell/src/session/goal_tracker.rs`（worker/verify 双轮）；hermes `E:/Agent/hermes-agent-main/agent/tools/delegate_tool.py`（summary 预算封顶）
业界实践是「主循环 + 隐式条件门 + 命令式并行委派 + 审批 checkpoint」而非重 DAG。L4 原生化为**轻量编排器**：节点序列（顺序/并行）+ 状态机 + 事件流 + **journal 断点续跑**（H6）。

- **输入**：任务清单/序列（[{agent, prompt} | {plan_file} | {human}]），而非完整 DAG
- **核心设计（吸收点）**：
  - **可断点续跑**（grok Journal）：每节点执行前落盘 journal（request_hash 去重），中断后 `resume` 从断点继续 → `graph/mod.rs` + `journal` 子模块
  - **worker/verify 双轮**（grok goal_tracker）：执行后可选 verify 节点（skeptic 质疑），把「做+验」分离
  - **结果预算封顶**（hermes summary 预算）：子 summary 超限落盘 + 上下文只留头部 + 文件指针
- **A/B/C**：A=仅顺序链 / B=顺序+并行扇出+结果聚合 ✅ / C=完整DAG+judge分支（延后）
- **承载**：`graph/mod.rs` Rust 编排器（actor + journal + 预算）+ `agentGraphStore` 事件流 + `GraphRunPanel` 可视化

### P0-2【L3 Multi-Agent + L3 Subagent】Lead/Worker 分工 + 子任务隔离
**参考源**：opencode `E:/Agent/opencode-dev/packages/opencode/src/tool/task.ts`（parentID 树 + task_id 续跑 + 深度守卫）；grok `E:/Agent/grok-build-main/crates/codegen/xai-grok-tools/src/implementations/grok_build/task/coordinator.rs`（actor + ChildRunner trait + mpsc）；hermes `E:/Agent/hermes-agent-main/agent/tools/delegate_tool.py`（`_execute_and_aggregate` 并行聚合）
Lead 规划拆解 → 并行委派多个 Worker → 聚合回 Lead；子任务**独立上下文**（parentID 树）+ **深度上限**。

- **核心设计（吸收点）**：
  - **子任务独立上下文**（opencode parentID 树 / hermes 独立实例）：子只带 goal+定向 context，不共享父历史；`task_id` 续跑
  - **深度上限**（三项目一致）：`max_spawn_depth=3` 防无限委派
  - **结果预算封顶**（hermes）：子 summary 超限落盘 + 上下文只留头部 + 文件指针
- **A/B/C**：A=单Lead顺序 / B=Lead规划+并行Worker+汇总 ✅ / C=多层树
- **承载**：`delegate_many` 工具 + `agentActivityStore`(group/depth/parentId) + Rust 并发

### P1-0【L1 Prompt】Agent 配置 schema 化
**参考源**：opencode `E:/Agent/opencode-dev/packages/opencode/src/agent/agent.ts`（Info schema L35-55 + mode/hidden）+ `packages/core/src/config/agent.ts`（ConfigV2 内置+用户合并）
把 agent 从"代码里硬编码"提升为**纯配置数据**（opencode agent schema）。

- **核心设计（吸收点）**：
  - **Agent 即 schema**（opencode）：`{name, description, mode: subagent|primary|all, hidden, model, prompt, permission, steps}`，内置+用户合并，无类层级
  - **hidden** 双布尔：可运行但不出现在选择器（用于系统内部 agent）
- **A/B/C**：A=仅 subagent 类型 schema 化 / B=全部 agent（内置+自定义）schema 化 ✅ / C=+LLM generate 自动生成 agent
- **承载**：`agents.ts` 重构为数据驱动 + Rust `agent_def` serde 类型

### P1-1【L2 Loop + H4 事件流】循环状态机可视化 + 统一事件管道
**参考源**：opencode `E:/Agent/opencode-dev/packages/opencode/src/session/prompt.ts`（runLoop L1081 健壮退出：finish≠tool-calls 且无待执行工具）+ `packages/opencode/src/session/processor.ts`（doom-loop L356-380）
把 L2 从隐式循环变显式可见，H4 统一事件流。

- **核心设计（吸收点）**：
  - `thinking → calling → observing → done` + 实时步数/工具/耗时
  - **健壮退出**（opencode）：`finish≠tool-calls 且无待执行工具` 才退出（不只信 stop_reason）
  - **doom-loop 检测**（opencode）：最近3条 tool part 同工具同参数 → 询问/终止
  - **统一事件管道**（H4）：LLM/工具/循环事件归一化为单一事件流 → ActivityStrip
- **A/B/C**：A=卡片显示phase / B=A+步数+工具+耗时 ✅ / C=时间线

### P1-2【L1 Context】subagent 定向上下文注入
**参考源**：opencode `E:/Agent/opencode-dev/packages/opencode/src/tool/task.ts`（task_result 结构化输出注入合成 part）
graph 前置节点输出注入后置节点 prompt（L1 Context 强化）。

- **A/B/C**：A=纯prompt / B=A+graph内节点输出注入 ✅ / C=共享只读memory

### P1-3【L4 Graph human + H3 审批通道】人工审批穿插 + 三态审批
**参考源**：opencode `E:/Agent/opencode-dev/packages/opencode/src/permission/index.ts`（Reply{once|always|reject} + Deferred 阻塞 + always 级联 + CorrectedError 反馈）；hermes `E:/Agent/hermes-agent-main/agent/conversation_loop.py`（nudge 门注入指令续 loop）；claude `E:/Agent/claude-code-haha/src/utils/swarm/inProcessRunner.ts`（worker badge + 审批 feedback）
graph human 节点 + **H3 审批通道升级为三态**（opencode/claude）。

- **核心设计（吸收点）**：
  - **审批三态**（opencode）：once=单次 / always=记住+级联放行 / reject=拒绝（可带 message 回传模型纠错）
  - **nudge 门**（hermes）：批准后注入指令消息继续 loop，而非硬阻塞
  - **worker badge + feedback**（claude）：子 agent 审批带来源标识 + 反馈
- **承载**：`approvalResponder` 升级 + `graph/store.ts` + `GraphRunPanel`

### P1-4【H7 记忆】记忆系统重构：召回式注入 + 标记隔离 + 自动沉淀
**参考源**：hermes `E:/Agent/hermes-agent-main/agent/memory_provider.py`（build_memory_context_block + StreamingContextScrubber 标记隔离）+ `agent/context_engine.py`（select_context 召回）+ `agent/learning_graph.py`（记忆图）

> **核查证据**（2026-08-08 源码确认）：yamet 记忆的读/写/注入链路**都存在**——写(`update_project_memory` tools.ts:51)、读(`list_project_memory`)、跨会话检索(`search_memories` tools.ts:52)、注入(`transport.ts:254-257` 调 `formatSessionMemory`→`mergeProjectMemory`)。但注入层有 4 个真实缺陷，用户判断"记忆系统有问题"成立：
> ① **全量无差别注入**：`readYametMd`(YAMET.md 全文) + `formatSessionMemory`(本会话全量) **无条件拼接**进每次请求，无相关性召回 → 记忆膨胀后每次请求灌全量（hermes 用 `select_context` 解决）
> ② **无标记隔离**：注入块无 `[System note: recalled memory]` 包裹，模型回显记忆块无法清洗 → 有被当用户输入的风险
> ③ **无自动沉淀**：只有 agent 主动调工具写，无 hermes `on_turn_complete` 观察钩子自动提炼
> ④ **子 agent 无记忆策略**：subagent 既不继承也不显式隔离记忆

**本轮**：把注入层从"全量拼接"重构为 **召回式 + 标记隔离 + 自动沉淀**（吸收 hermes memory_provider / select_context / on_turn_complete）。

- **核心设计（吸收点）**：
  - **召回式注入**（hermes `select_context`）：请求前按相关性检索记忆，只注入命中的片段（替代全量拼接），防上下文膨胀
  - **记忆上下文块 + 标记隔离**（hermes `build_memory_context_block` + `StreamingContextScrubber`）：注入块包 `[System note: recalled memory context]` 标记，流式清洗模型回显，防被当用户输入
  - **自动沉淀**（hermes `on_turn_complete`）：回合结束观察钩子自动提炼关键结论写入记忆（agent 无需显式调工具）
  - **子任务记忆策略**：子 agent 继承父的只读记忆快照（显式隔离，不共享写）
  - **记忆图**（hermes learning_graph）：记忆/技能节点 + 相关边，可视化 + 检索
- **A/B/C**：A=全量注入（现状，有膨胀/污染风险）/ **B=召回式注入+标记隔离+自动沉淀 ✅** / C=B+记忆图可视化
- **承载**：`transport.ts` 注入层重构 + `memoryStore` 加检索 + `searchMemories` 强化 + 回合钩子

### P1-5【skill 沉淀】skill 自动策展维护（curator 式）
**参考源**：hermes `E:/Agent/hermes-agent-main/agent/curator.py`（后台策展：inactivity-triggered + pin/archive/consolidate + 只动 agent 创建/永不删除/pinned 豁免）

> **核查证据**（2026-08-08 源码确认）：yamet 的 skill **主动创建已有**——`create_skill` 工具（tools.ts:54 注册），agent 完成任务后可主动调它沉淀 skill 到 `<workspace>/skills/<name>/skill.json`。但**无后台自动策展/维护**：grep 不到任何 curator/onTurnComplete/自动沉淀机制。
> **参照澄清**（hermes）：hermes 的 `/learn` 是**主动**提炼（build_learn_prompt → skill_manage 写 SKILL.md），curator 是**后台策展**（aux-model，inactivity-triggered，维护已有 skill 集合：pin/archive/consolidate，**不自动生成新 skill**）。即业界也没有"全自动从对话生成新 skill"，但**后台自动策展维护**是成熟可吸收的。

**本轮**：新增 skill **后台自动策展**（吸收 hermes curator）——维护已有 skill 集合的生命周期，而非自动生成新 skill。

- **核心设计（吸收点）**：
  - **inactivity-triggered 后台任务**（hermes curator）：agent 空闲且距上次运行超时后触发，无 cron daemon；aux-model 后台跑，不影响主会话 prompt cache
  - **生命周期状态机**（hermes curator）：基于 skill 活动时间戳 pin / archive / consolidate / patch
  - **安全约束**（hermes curator）：只动 agent 创建的 skill、永不删除（只 archive，可恢复）、pinned 豁免
- **A/B/C**：A=仅主动 create_skill（现状）/ **B=后台自动策展（pin/archive/consolidate）+ 主动 create_skill ✅** / C=+自动提炼新 skill（业界无成熟先例，高风险）
- **承载**：`createSkill.ts` 保留 + 新增 Rust 后台策展任务 + skill 生命周期状态

### P2-1【L1 Context】上下文压缩四元接口（hermes）
**参考源**：hermes `E:/Agent/hermes-agent-main/agent/context_engine.py`（四元接口 L89）+ `agent/context_compressor.py`（防抖动门 L2296 + protect_first_n=3/protect_last_n=6 L121）
把 `compactModelMessagesDetailed` 单函数升级为**四元接口**（hermes context_engine）。

- **核心设计（吸收点）**：
  - **四元接口**（hermes）：`should_compress / select_context / on_turn_complete / prune_tool_results_only` 解耦
  - **防抖动门**（hermes）：近两次压缩省<10% 则停
  - **头尾保护区**（hermes）：protect_first_n=3 / protect_last_n=6
- **A/B/C**：A=保持单函数 / B=四元接口+防抖动门 ✅ / C=B+头尾保护区

### P2-2【H2 会话/状态】子会话 parentID 树
**参考源**：opencode `E:/Agent/opencode-dev/packages/opencode/src/tool/task.ts`（sessions.create({parentID}) 父子会话树 + subagent_depth 守卫）
会话管理从单会话升级为**父子会话树**（opencode parentID），支撑 P0-2 子任务隔离。

- **A/B/C**：A=仅内存子会话 / B=持久化 parentID 树 ✅ / C=完整会话恢复

### P2-3【H5 预算/上限】IterationBudget
**参考源**：hermes `E:/Agent/hermes-agent-main/agent/iteration_budget.py`（IterationBudget consume/refund + 父500/子50）+ `agent/subagent_lifecycle.py`（SubagentHandle{depth}）
引入迭代预算 + 并发/深度上限（hermes IterationBudget + grok max_depth）。

- **A/B/C**：A=仅步数上限（现状）/ B=IterationBudget(consume/refund) + 并发上限 ✅ / C=B+token 预算

### 范围外
- 不新造协议层（复用 `run_subagent`/工具桥）；不动 docker；不改现有单 agent 行为；不做多进程隔离（harness 内并发即可）；完整 DAG/judge 分支延后

---

## 实施方案

### 依赖序
> **拆批原则**：大任务（P0-1/P0-2/P1-4/P2-2）按「后端先行 → 核心 → 前端消费」拆成 2-3 个批次，每批含若干原子步骤 + 独立门禁（`cargo check`/`tsc` 可验证，单测覆盖），批次内完成即提交、不跨批留半成品。原子步骤粒度 = 一次能 `cargo check`(0.6s) 或 `tsc` 验证的改动。
`P2-2(H2 parentID树) → P0-2(并发Worker, 依赖parentID) → P0-1(Graph引擎+journal) → P1-0(Agent schema) → P1-1(Loop状态机) → P1-2(上下文注入) → P1-4(记忆重构) → P1-5(skill策展) → P1-3(审批三态+human) → P2-3(IterationBudget) → P2-1(四元接口) → 构建`

### P0-1 Graph 编排引擎（大任务 → 拆 3 批，每批原子步骤 + 门禁）

**改动文件**：新建 `src-tauri/src/modules/graph/mod.rs` + `src/modules/ai/graph/store.ts` + `GraphRunPanel.tsx` + `src/modules/ai/tools/graph.ts`；`src-tauri/src/lib.rs` 注册命令

**批次 A · 后端数据模型 + 注册（后端先行）**
1. `graph/mod.rs`：`GraphDef { nodes, edges }` + `GraphNode { id, kind: Agent|Judge|Human|Merge, name?, prompt?, agent? }` serde struct（无执行逻辑）
2. `graph/mod.rs`：`GraphRunState { node_id, status: Pending|Running|Done|Failed|WaitingHuman, output, error }` serde + `journal.rs`（`request_hash` 去重、落盘、`resume` 读回）
3. `lib.rs`：注册 `graph_run` / `graph_cancel` / `graph_get` 到 `generate_handler!` + `.manage(GraphState)`
4. **门禁 A**：`cargo check`(0.6s) → `cargo test graph`（serde 往返 + journal 重放单测）

**批次 B · 执行器 + 并发 + 状态机（核心）**
5. `graph/mod.rs`：`run_graph` 执行器——拓扑排序 + 按边调度；`Agent`→调 `crate::modules::ai::agents::run_subagent_impl`；`Judge`→LLM 判断 `condition` 选边
6. `graph/mod.rs`：并发 `tokio::spawn` 并行无依赖节点 + `Semaphore(4)` 限并发
7. `graph/mod.rs`：状态机流转（Pending→Running→Done/Failed/WaitingHuman），每节点状态变化发 `graph:event` 到前端
8. `graph/mod.rs`：`graph_cancel`（中断：已完成的保留，未完成的标 cancelled）；`graph_get`（全量快照）
9. **门禁 B**：`cargo test graph`（拓扑/并发上限/merge/取消）+ `cargo clippy`

**批次 C · 前端事件流 + 面板 + 工具（消费）**
10. `store.ts`：`useAgentGraphStore` 订阅 `graph:event`（tauri listen），维护 `{nodeId, status, output, error}`
11. `GraphRunPanel.tsx`：节点卡片 + 边箭头 + 状态色 + 进度条（挂在侧栏）
12. `tools/graph.ts`：`run_graph` 工具（schema: graph def JSON，needsApproval=true），主 agent 经它触发
13. **门禁 C**：`npx tsc --noEmit` → `npx vitest run src/modules/ai/graph`（store 事件 + 面板渲染）

**总验证**：`cargo test graph` + `clippy` + `tsc` + `vitest src/modules/ai/graph`

### P0-2 并发 Worker 委派（大任务 → 拆 2 批）

**改动文件**：`tools/subagent.ts`、`graph/mod.rs`、`agentActivityStore`（group/depth/parentId 字段）

**批次 A · 委派能力（后端/纯逻辑）**
1. `runSubagent` 加 `depth` + `parentId` 参数（沿链防无限委派，`max_spawn_depth=3`）；子任务**独立上下文**（只带 goal+定向 context，不共享父历史，opencode parentID 树语义）
2. **结果预算封顶**（hermes summary 预算）：子 summary 超限落盘 + 上下文只留头部 + 文件指针
3. **门禁 A**：`npx vitest run src/modules/ai/agents`（深度上限 + summary 封顶纯函数）

**批次 B · 并行委派 + UI 分组（核心）**
4. `delegate_many` 工具：schema `[{type,prompt}]`，`Promise.allSettled` 并行（上限4），聚合返回 `[{type, summary, ok}]`
5. `agentActivityStore` 加 `group`/`depth`/`parentId` 字段，面板按组显示并发 Worker 树
6. **门禁 B**：`npx vitest run src/modules/ai/tools/subagent`（并发上限 + 聚合）+ `cargo test graph`

**总验证**：`npx vitest run src/modules/ai/tools/subagent src/modules/ai/agents` + `cargo test graph`

### P1-1 Loop 状态机可见
**改动文件**：`agentActivityStore.ts`、`chatStore.ts`（agentMeta.phase）、`agent.ts`、`AgentRunBridge.tsx`/`ActivityStrip`
**实施步骤**：
1. `agentMeta.phase` + setter
2. `agent.ts`：`onToolCallStart`→calling、`onToolCallFinish`→observing、`onFinish`→done
3. **健壮退出**（opencode）：循环退出条件 = `finish≠tool-calls 且无待执行工具`（不只信 stop_reason）
4. **doom-loop 检测**（opencode）：最近3条 tool part 同工具同参数 → 询问/终止
5. `ActivityStrip`：显示 phase + 步数 + 当前工具
6. 测试：phase 断言 + 健壮退出 + doom-loop

**验证**：`npx vitest run src/modules/ai/store src/modules/ai/components`

### P1-2 上下文注入
**改动文件**：`graph/mod.rs`（Agent节点 context 字段）、`runSubagent.ts`（Args.context）
**实施步骤**：
1. `runSubagent` 加 `context`：`prompt = context ? context + "\n\n" + prompt : prompt`
2. Graph 引擎：前置节点输出写入后继 `context`
3. 测试：context 拼接

**验证**：`npx vitest run src/modules/ai/agents`

### P1-3 human 审批节点（吸收 opencode 三态 + hermes nudge 门）
**改动文件**：`graph/mod.rs`、`graph/store.ts`、`GraphRunPanel.tsx`
**实施步骤**：
1. Human 节点：发 `graph:human-request` 事件 + 暂停（pending）
2. **审批三态**（opencode once/always/reject）：once=单次 / always=本会话记住+级联放行 / reject=拒绝（可带 message 回传模型纠错）
3. **nudge 门**（hermes）：批准后注入指令消息继续 loop，而非硬阻塞（状态机友好）
4. 前端监听 → 面板审批 UI（复用 approval 模式）
5. 批准 → `graph_approve(nodeId)` → 继续
6. 测试：human 等待 + 三态 + 批准继续

**验证**：`cargo test graph` + `npx vitest run src/modules/ai/graph`

### P1-4 记忆系统重构：召回式注入 + 标记隔离 + 自动沉淀（H7）（大任务 → 拆 2 批）

**改动文件**：`transport.ts`（注入重构）、`memoryStore.ts`（检索）、`searchMemories.ts`（强化）、`agent.ts`（回合钩子）、新建 `src/modules/ai/memory/MemoryGraphPanel.tsx`

**批次 A · 注入层重构 + 标记隔离（核心）**
1. `memoryStore` 加 `search(query)`：按关键词/相关度检索记忆条目（纯函数 + 单测）
2. `transport.ts`：替换 `readYametMd`+`formatSessionMemory` 全量拼接为 `recallMemory(workspaceRoot, sessionId, query?)`——按相关性只注入命中片段
3. `transport.ts`：注入块包 `[System note: recalled memory context]` + `StreamingContextScrubber` 清洗模型回显（防被当用户输入）
4. **门禁 A**：`npx tsc` → `npx vitest run src/modules/ai/lib src/modules/ai/store`（检索命中 + 注入标记 + 清洗）

**批次 B · 自动沉淀 + 子任务策略 + 可视化**
5. `agent.ts` 加 `onTurnComplete` 钩子：回合结束自动提炼关键结论 `addMemory`（source:"auto"）
6. `runSubagent` 传父只读记忆快照（显式隔离，不共享写）
7. `MemoryGraphPanel.tsx`：记忆节点 + 相关边可视化
8. **门禁 B**：`npx vitest run src/modules/ai/memory src/modules/ai/agents`（自动沉淀 + 子任务隔离）

**总验证**：`npx vitest run src/modules/ai/lib src/modules/ai/store src/modules/ai/memory src/modules/ai/agents`

### P1-5 skill 自动策展维护（H7 派生）
**改动文件**：新建 `src-tauri/src/modules/skill/curator.rs`（后台策展）、`src/modules/ai/lib/skills.ts`（生命周期状态）、`createSkill.ts`（状态标记）
**实施步骤**：
1. `curator.rs`：后台任务，inactivity-triggered（agent 空闲 + 距上次运行超时）；aux-model 跑，仅维护 agent 创建的 skill
2. 生命周期状态机：基于 skill 活动时间戳 pin / archive / consolidate / patch
3. 安全约束：只动 agent 创建、永不删除（只 archive 可恢复）、pinned 豁免
4. `skills.ts` 加状态字段（pinned/archived/activity_ts）
5. `createSkill.ts` 写入时标 `agent_created` + 活动时间戳
6. Rust 侧测试：策展状态转换 + 安全约束

**验证**：`cargo test skill` + `npx vitest run src/modules/ai/lib/skills`

### P1-0 Agent 配置 schema 化
**改动文件**：`src/modules/ai/lib/agents.ts`、新建 `src-tauri/src/modules/agent/def.rs`（serde）、`AgentSwitcher.tsx`
**实施步骤**：
1. 定义 `AgentDef { name, description, mode: subagent|primary|all, hidden, model, prompt, permission, steps }` serde
2. `agents.ts` 重构：内置 agent 从代码数组改为 `AgentDef` 数据 + 用户配置合并（opencode 语义：同名覆盖、`disable` 删除）
3. 补 `hidden` 语义：可运行但不出现在选择器（如 compaction agent）
4. `AgentSwitcher` 读 `mode` 过滤可选 agent
5. 测试：merge 逻辑 + hidden 过滤

**验证**：`npx vitest run src/modules/ai/lib src/modules/ai/components` + `cargo check`

### P2-1 上下文压缩四元接口（hermes）
**改动文件**：`src/modules/ai/lib/compact.ts`（拆接口）、`agent.ts`（接入）
**实施步骤**：
1. `compact.ts` 拆为四元：`shouldCompress / selectContext / onTurnComplete / pruneToolResultsOnly`
2. 加**防抖动门**：近两次压缩省<10% 则跳过一次
3. 加**头尾保护区**：protect_first_n=3 / protect_last_n=6
4. `agent.ts` 每轮调 `shouldCompress`（真实 token）+ 触发时调 `selectContext`
5. 测试：四元各函数 + 防抖动门 + 保护区

**验证**：`npx vitest run src/modules/ai/lib/compact.test.ts`

### P2-2 子会话 parentID 树（H2）
**改动文件**：`src/modules/ai/store/chatStore.ts`、`sessions.ts`、`chatRuntime.ts`
**实施步骤**：
1. session 表加 `parentId` 字段（自引用）
2. `createSubSession(parentId, agentId)`：子会话独立消息历史，继承父的授权/权限
3. `task_id` 续跑：同 task 复用同子会话
4. 会话树视图：parentID 关联展示
5. 测试：树创建 + 续跑 + 隔离

**验证**：`npx vitest run src/modules/ai/store`

### P2-3 IterationBudget（H5）
**改动文件**：`src/modules/ai/lib/budget.ts`（新建）、`agent.ts`、`runSubagent.ts`
**实施步骤**：
1. `IterationBudget { maxTotal, used, lock }` + `consume()->bool` / `refund()`（Rust 侧 `AtomicUsize`+`Mutex`）
2. 主 agent 预算 = 24（现状），子 agent 独立预算 = 8（hermes 父500/子50 缩小版）
3. 并发上限：`Semaphore(4)` 并行委派；深度上限 `max_spawn_depth=3`
4. 预算耗尽 → `budget_exhausted` 终止 + UI 提示
5. 测试：consume/refund + 并发上限 + 深度上限

**验证**：`npx vitest run src/modules/ai/lib/budget.test.ts` + `cargo test graph`

### 构建
- 版本 0.1.20 → 0.1.21（四文件同步）；`npx tauri build`；部署 `C:\Users\Admin\AppData\Local\Yamet\`
- 根目录三文档同步（CHANGELOG/ROADMAP/YAMET）补第20轮

**验收总门禁**：cargo test 全绿（含 graph 单测）+ clippy + tsc 0 错误 + vitest 全绿 + i18n-scan + drift + `npx tauri build` exit 0。
