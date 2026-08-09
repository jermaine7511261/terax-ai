# 第二十八轮迭代需求：从 ADE → AI Agent 工作台/引擎平台 — 多项目深度调研

> 目标版本 **0.1.28**（架构性构建）。
> 用户命题：「向 AI Agent 工作台/Agent 引擎平台跨越，深度调研迭代需求」。
> 调研方式：对 `E:\Agent\` 下 **9 个参考项目**做源码级调研，提取 Agent 平台模式，与 YaMet 现状对比，输出细化需求文档。
> 调研规模：9 项目 × 多文件源码级审计。

---

## §0 调研基线

### 0.1 YaMet 现状（v0.1.27，HEAD 4afce4f）

| 维度 | 数据 |
|---|---|
| 代码量 | Rust ≈35.5 万行（17 模块），TS ≈10 万行（26 模块，707 文件） |
| AI 工具 | 46 个注册工具（TOOL_REGISTRY），跨 18 个 builder 模块 |
| Agent 能力 | run_subagent / delegate_many / run_graph / run_external_agent |
| 记忆系统 | 三层（session/global/workspace）+ 召回式注入 + 自动沉淀 |
| 技能系统 | create_skill + 后台策展（pin/archive/consolidate） |
| 安全评级 | 9/10（SSRF 纵深 + AI 读写双门 + keyring + Job Object） |
| 总体评分 | 8.0/10（深度测评报告 08-07） |

### 0.2 调研的 9 个参考项目

| 项目 | 语言 | 定位 | 核心 Agent 模式 |
|---|---|---|---|
| **PraisonAI** | Python | 多 Agent 编排框架 | Agent schema 60+ 字段 / Team 编排 / Handoff / GoalLoop / Hooks |
| **Flock** | Rust | AI 编码 Agent（类 Claude Code） | LangGraph 状态图 / Tool trait / SubAgent Spawner / Skills |
| **Swarms-rs** | Rust | Swarms 框架 Rust 实现 | Agent 重排 / 并行 swarm / LLM 工厂 |
| **Terminator** | Rust | AI 桌面自动化 | MCP tool_router / Workflow 引擎 / Elicitation / KV store |
| **OpenCode** | TS | 编码 Agent | Agent schema（mode/hidden/model）/ parentID 树 / Plan 模式 |
| **Hermes** | Python | Agent 框架 | IterationBudget / SubagentState 状态机 / 记忆四元接口 |
| **Grok-build** | Rust | xAI 编码引擎 | SubagentCoordinator actor / Journal 断点续跑 / goal_tracker |
| **Claude-code-haha** | TS | Claude Code 参考实现 | Coordinator 模式 / 审批三态 / worker badge |
| **oh-my-pi** | Rust+TS | 终端 Agent | PTY+DAP 最优范本 / 事件驱动 wait |

---

## §1 Agent 定义 Schema 跨项目对比（核心发现）

### 1.1 六项目 Agent Schema 字段矩阵

> **铁律：Agent Definition 是 Agent 平台的第一性原理——它决定了平台能承载多复杂的 Agent 行为。**

| 字段类别 | PraisonAI | Flock | OpenCode | Hermes | Claude-code | Grok | **YaMet 现状** |
|---|---|---|---|---|---|---|---|
| **身份** | `name`, `role`, `goal`, `backstory` | (无独立 schema，config 驱动) | `id`, `name`, `description` | `session_id`, `_subagent_id` | `agentType`, `whenToUse` | `AgentDef {name, type}` | `type: string`（仅名称） |
| **系统提示** | `instructions` | `system_prompt` (Builder) | `system`, `prompt` (.md body) | `system_prompt.py` 模块 | `getSystemPrompt()` 闭包 | AgentDef prompt | 硬编码在 `agents.ts` |
| **模型** | `llm`/`model` (LLMConfig) | `provider: Arc<dyn BaseChatModel>` | `model: {modelID, providerID}` | `model: str` | `model?: string` | AgentDef model | 全局 model，无 per-agent |
| **工具权限** | `tools`, `toolsets`, `handoffs` | ToolRegistry + `allow_list` | `Permission.Ruleset`（细粒度） | `enabled_toolsets/disabled_toolsets` | `tools[], disallowedTools[]` | AgentDef tools | `toolAllowlist`（白名单） |
| **执行控制** | `execution: ExecutionConfig` | `max_turns, thinking` | `steps` | `max_iterations=500` + `IterationBudget` | `maxTurns` | AgentDef steps | `stepCountIs(24)` 硬编码 |
| **记忆** | `memory: MemoryConfig` | (无独立 memory) | (无) | `memory_provider` | (无) | AgentDef memory | 三层记忆（无 per-agent） |
| **知识** | `knowledge: KnowledgeConfig` | (无) | (无) | `rag` + `knowledge` | (无) | (无) | knowledge_base（全局） |
| **规划** | `planning: PlanningConfig` | `plan_mode_active` | Plan 模式（受限只读） | (无) | (无) | GoalLoop plan | plan_mode（前端） |
| **反思** | `reflection: ReflectionConfig` | (无) | (无) | (无) | (无) | (无) | ❌ 无 |
| **守卫** | `guardrails: GuardrailConfig` | Middleware chain | Permission rules | `ToolCallGuardrailController` | Permission rules | AgentDef guard | security.ts（全局） |
| **自主度** | `autonomy: AutonomyConfig` | (无) | (无) | (无) | (无) | (无) | ❌ 无 |
| **生命周期** | (隐式) | (隐式) | (隐式) | `SubagentState` 状态机 ✅ | (隐式) | (隐式) | ❌ 无 |
| **颜色/UI** | (无) | (无) | `color: Color` | (无) | `color: AgentColorName` | (无) | ❌ 无 |
| **模板** | `from_template()` | (无) | (无) | (无) | (无) | (无) | ❌ 无 |

### 1.2 关键发现

**发现 1：PraisonAI 的 Agent Schema 最完整（60+ 字段），但太重**
- `__init__` 参数 30+ 个，每个都支持 `bool/str/Config` 三态
- Mixin 继承链 10 层：`GoalLoopMixin → SteeringMixin → SandboxMixin → ... → MemoryMixin`
- **优点**：功能完备，一个 Agent 几乎可以做任何事
- **缺点**：复杂度爆炸，学习曲线陡峭，Python 动态类型不安全

**发现 2：Flock 的 Rust Agent Engine 最值得 YaMet 吸收**
- `AgentEngine` struct：30+ 字段，但**每个字段类型明确**（Rust 编译期保证）
- LangGraph 状态图：`START → compaction → llm → tools → (loop or END)`
- `AgentState` 用 `#[langgraph_state]` 宏 + `#[channel]` 属性声明式定义
- **核心优势**：Rust 原生、类型安全、与 YaMet 技术栈同构

**发现 3：Hermes 是唯一有显式生命周期状态机的**
- `SubagentState: PENDING → STARTING → RUNNING → SUCCEEDED | FAILED | INTERRUPTED`
- `SubagentHandle { depth, parent_id, id }` + HMAC 防伪
- **核心优势**：可观测性基础

**发现 4：所有项目的共同最小集（Agent Schema 必备字段）**

```rust
// 七项目交集 = YaMet AgentDef 最小集
pub struct AgentDef {
    // 身份
    pub id: AgentId,              // 唯一标识
    pub name: String,             // 显示名
    pub description: String,      // 用途描述（何时使用）
    
    // 模型
    pub model: Option<String>,    // 模型覆盖（None=继承主 agent）
    
    // 工具
    pub tools: ToolScope,         // 工具可见范围
    
    // 执行
    pub max_steps: Option<u32>,   // 步数上限（None=默认）
    pub system_prompt: String,    // 系统提示
    
    // 控制
    pub mode: AgentMode,          // subagent | primary | hidden
    pub enabled: bool,            // 是否启用
}
```

---

## §2 Agent 生命周期管理跨项目对比

### 2.1 六项目生命周期模式

| 项目 | 生命周期模型 | 状态枚举 | 持久化 | 可恢复 |
|---|---|---|---|---|
| **Hermes** | 显式状态机 | `PENDING→STARTING→RUNNING→SUCCEEDED/FAILED/INTERRUPTED` | `SubagentHandle` 序列化 | ✅ |
| **Grok** | Journal 确定性重放 | request_hash 去重 + 断点续跑 | Journal 文件 | ✅ |
| **Flock** | LangGraph checkpoint | SQLite `BaseCheckpointSaver` | thread_id → state snapshot | ✅ |
| **OpenCode** | parentID 树 | session → sub-session | session 持久化 | ✅ |
| **PraisonAI** | (隐式) | 无显式状态枚举 | session 持久化 | ⚠️ 部分 |
| **Claude-code** | (隐式) | 无显式状态枚举 | (无) | ❌ |
| **YaMet** | (隐式) | **完全无状态** | ❌ 无 | ❌ 无 |

### 2.2 核心发现

**发现 5：YaMet 的 Agent 是「即用即毁」的——这是最大的平台差距**

YaMet 当前的 Agent 使用模式：
```
用户请求 → run_subagent(prompt) → 创建新 session → 执行 → 返回 summary → session 销毁
```

问题：
1. **无状态持久化**：Agent 执行过程中间结果丢失
2. **无执行历史**：无法回溯"这个 Agent 做了什么"
3. **无复用**：同一个 Agent 配置不能重复执行
4. **无观测**：不知道 Agent 在做什么、做了多久、花了多少 token

**发现 6：Flock 的 LangGraph checkpoint 模式最适合 YaMet**

```rust
// Flock: SQLite-backed checkpoint，每步自动保存
checkpointer: Arc<dyn BaseCheckpointSaver>,  // SqliteSaver or InMemorySaver
graph.astream(&initial_json, &config, ...).await;  // thread_id = session_id
// 中断后可通过 engine.resume(session_id) 恢复
```

**发现 7：Hermes 的 SubagentState 状态机 + SubagentHandle 是可观测性基础**

```python
class SubagentState(Enum):
    PENDING = "pending"
    STARTING = "starting"  
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    INTERRUPTED = "interrupted"

@dataclass
class SubagentHandle:
    depth: int
    parent_id: str
    id: str           # HMAC 签名防伪
    state: SubagentState
    started_at: datetime
    finished_at: Optional[datetime]
    result: Optional[SubagentResult]
```

---

## §3 Agent 编排模式跨项目对比

### 3.1 七项目编排模式矩阵

| 模式 | PraisonAI | Flock | Grok | Hermes | OpenCode | Claude-code | YaMet |
|---|---|---|---|---|---|---|---|
| **单 Agent** | ✅ `agent.start()` | ✅ `engine.run()` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Handoff（移交）** | ✅ `handoffs=[agent_b]` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Delegation（委派）** | ❌ (deprecated) | ❌ | ✅ `SubagentCoordinator` | ✅ `delegate_tool` | ✅ `TaskTool` | ✅ `AgentTool` | ✅ `run_subagent` |
| **并行委派** | ✅ `Team(start_method="sequential")` | ✅ `spawn_parallel()` | ✅ `mpsc` 并发 | ✅ `join_all` | ❌ | ❌ | ✅ `delegate_many` |
| **状态图** | ❌ | ✅ **LangGraph** | ❌ | ❌ | ❌ | ❌ | ✅ `run_graph`（轻量） |
| **Goal Loop** | ✅ `GoalLoopMixin` | ✅ (graph loop) | ✅ `goal_tracker` | ✅ `conversation_loop` | ✅ (session loop) | ✅ | ⚠️ 隐式 |
| **Plan 模式** | ✅ `planning` | ✅ `plan_mode_active` | ✅ GoalLoop plan | ❌ | ✅ (受限只读) | ❌ | ⚠️ 前端有，后端无 |
| **Fork（技能派生）** | ❌ | ✅ `spawn_fork()` | ❌ | ❌ | ❌ | ❌ | ❌ |

### 3.2 核心发现

**发现 8：PraisonAI 的 Handoff 模式是独有能力——Agent 间直接移交控制权**

```python
# PraisonAI: Agent A 执行中可以 handoff 给 Agent B
agent_a = Agent(
    name="Researcher",
    handoffs=[agent_b],  # 可以移交给 agent_b
    ...
)
```

这是比 delegation 更高级的模式——delegation 是"我把任务交给你，你做完告诉我"，handoff 是"我现在把控制权转给你，你继续执行"。

**发现 9：Flock 的 LangGraph 状态图是编排的最优解**

```
START → compaction → llm ─┬─► tools ─► (back to compaction)
                          └─► END
```

- `AgentState` 用宏声明式定义字段 + channel 属性
- `conditional_edges!` 宏声明路由条件
- `FlockToolNode` 内部调用 `interrupt()` 实现人机交互
- Checkpoint 每步自动保存，支持 `resume`

**发现 10：YaMet 的 `run_graph` 比 Flock 更轻量，但缺少状态持久化**

YaMet 的 graph 编排器已经实现了拓扑排序 + 并发执行 + journal 断点续跑，但：
- Journal 是内存态的 `RwLock<HashMap>`，app 重启丢失
- 无 SQLite checkpoint
- 无 LangGraph 的条件边（conditional edges）

---

## §4 工具系统跨项目对比

### 4.1 七项目工具注册模式

| 项目 | 工具定义 | 注册方式 | 过滤 | 并发安全声明 |
|---|---|---|---|---|
| **Flock** | `trait Tool`（Rust） | `ToolRegistry` (Vec\<Box\<dyn Tool\>\>) | `allow_list` per-agent | `is_concurrency_safe()` |
| **Terminator** | `#[tool]` 宏（rmcp） | `#[tool_router]` 声明式 | MCP 标准 | 无 |
| **Swarms-rs** | `Agent.tools: Vec<String>` | Agent 持有工具名列表 | 无 | 无 |
| **PraisonAI** | 函数 + MCP | `Agent.tools: List[Any]` | `toolsets` 命名组 | 无 |
| **OpenCode** | Tool API + MCP | 统一 ToolPool | `Permission.Ruleset` | 无 |
| **Hermes** | Toolset 命名组 | `enabled_toolsets/disabled_toolsets` | `ToolCallGuardrailController` | 无 |
| **YaMet** | `tool()` 函数 | `buildTools(ctx)` → 统一对象 | `toolAllowlist` 白名单 | 无显式声明 |

### 4.2 核心发现

**发现 11：Flock 的 `Tool::is_concurrency_safe()` 是 YaMet 缺失的关键能力**

```rust
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> JsonSchema;
    fn is_concurrency_safe(&self, input: &Value) -> bool;  // 关键！
    async fn execute(&self, input: Value) -> ToolResult;
    fn category(&self) -> ToolCategory;
}
```

YaMet 的 46 个工具中，有些是并发安全的（read_file, grep, glob），有些不是（write_file, bash_run）。但当前没有声明机制，delegate_many 的并行 worker 可能同时调用不安全的工具。

**发现 12：Flock 的 `ContextModifier` 是工具对 Agent 行为的动态影响机制**

```rust
pub struct ContextModifier {
    pub model: Option<String>,
    pub effort: Option<EffortLevel>,
    pub allowed_tools: Vec<String>,
    pub plan_mode_transition: Option<PlanModeTransition>,
    pub promoted_tools: Vec<String>,  // 延迟加载的工具 schema
}
```

工具不仅可以执行，还可以**动态修改 Agent 的行为**——切换模型、调整推理深度、进入/退出 Plan 模式、加载延迟工具。YaMet 完全没有这个能力。

---

## §5 记忆/知识系统跨项目对比

### 5.1 五项目记忆模式

| 项目 | 记忆类型 | 检索方式 | 自动沉淀 | 持久化 |
|---|---|---|---|---|
| **PraisonAI** | `MemoryConfig` (Docker/local/Memory0) | 关键词 + 向量 | ✅ `self_improve` | ✅ |
| **Hermes** | 四元接口 `select_context/on_turn_complete` | 召回式注入 + 标记隔离 | ✅ `on_turn_complete` | ✅ |
| **Flock** | (无独立 memory) | (无) | ❌ | ❌ |
| **OpenCode** | CLAUDE.md 一级 | 全量注入 | ❌ | ✅ |
| **Grok** | AgentDef memory 字段 | (简单) | ❌ | ✅ |
| **YaMet** | 三层记忆（session/global/workspace） | CJK 2-gram 打分 | ✅ `source:"auto"` | ✅ |

### 5.2 核心发现

**发现 13：YaMet 的记忆系统已经是最先进的之一**

YaMet 已实现：
- 三层记忆（session/global/workspace）✅
- 召回式注入（按相关性检索，非全量拼接）✅
- 标记隔离（`[System note: recalled memory context]`）✅
- 自动沉淀（`source:"auto"`）✅
- 跨会话搜索（`search_memories`）✅

唯一差距是**语义检索**（当前用 CJK 2-gram 打分，非向量相似度），但这在第二十七轮已识别为 G5。

**发现 14：PraisonAI 的 Knowledge 系统值得借鉴**

PraisonAI 支持：
- 文件路径、URL、文本内容混合输入
- KnowledgeConfig 配置化
- 与 Agent 绑定（per-agent knowledge）

YaMet 的 `knowledge_base` 是全局的，没有 per-agent 隔离。

---

## §6 可观测性/调试跨项目对比

### 6.1 四项目可观测性模式

| 项目 | Trace | Metrics | Debug | Replay |
|---|---|---|---|---|
| **Terminator** | `ProgressCallback` 实时步骤报告 | (无) | (无) | `WorkflowRecorder` 录制→回放 |
| **Hermes** | `SubagentStatus` + `SubagentResult` | `IterationBudget` 消耗追踪 | (无) | (无) |
| **Grok** | Journal 确定性重放 | `session_metrics` | (无) | ✅ Journal resume |
| **Flock** | LangGraph stream updates | Token accounting in state | (无) | ✅ Checkpoint resume |
| **YaMet** | ❌ 无 | ❌ 无 | ❌ 无 | ❌ 无 |

### 6.2 核心发现

**发现 15：YaMet 的可观测性是零——这是从 ADE 到 Agent 平台的最大鸿沟**

当前 YaMet Agent 执行是黑盒：
- 不知道 Agent 调了哪些工具
- 不知道每步花了多少 token
- 不知道执行了多长时间
- 不知道为什么失败
- 无法重现失败场景

**发现 16：Terminator 的 `ProgressCallback` + `WorkflowRecorder` 模式最适合桌面 Agent**

```rust
// Terminator: 实时步骤报告
pub type ProgressCallback = Box<dyn Fn(&ComputerUseStep) + Send + Sync>;

// Terminator: 工作流录制→回放
// records human interactions into replayable workflows
```

---

## §7 安全/审批跨项目对比

### 7.1 五项目审批模式

| 项目 | 审批模型 | 粒度 | 持久化 | 级联 |
|---|---|---|---|---|
| **OpenCode** | `once/always/reject` 三态 | per-tool + resource pattern | ✅ 规则持久化 | ✅ always 级联 |
| **Hermes** | `nudge` 门（注入指令续 loop） | per-call | ❌ | ❌ |
| **Claude-code** | `ToolUseConfirm` 权限队列 | per-tool | ✅ 权限持久化 | ❌ |
| **Flock** | `ToolApprovalManager` | per-tool | ❌ | ❌ |
| **YaMet** | `needsApproval` 二元 | per-tool（静态） | ❌ | ❌ |

### 7.2 核心发现

**发现 17：YaMet 的审批是二元的（approve/deny），缺三态 + 级联 + 持久化**

OpenCode 的审批模型是最成熟的：
- `once`：本次允许
- `always`：本会话记住（级联放行同类工具）
- `reject`：拒绝（可带 message 回传模型纠错）
- 规则持久化到 `.opencode/permissions.json`

---

## §8 需求规划（融合矩阵）

### 8.1 完整需求列表

| # | 需求 | 来源项目 | 优先级 | 工作量 | 具体任务 |
|---|---|---|---|---|---|
| 1 | **AgentDef Schema 统一** | PraisonAI/Flock/OpenCode 交集 | **P0** | 3 天 | Rust `AgentDef` serde + 前端 schema + 设置 UI |
| 2 | **Agent Registry** | PraisonAI ServerRegistry / Flock ToolRegistry | **P0** | 2 天 | AgentDef 注册表（内存+持久化），按 id 查找/过滤 |
| 3 | **Agent Lifecycle State Machine** | Hermes SubagentState | **P0** | 3 天 | `Created→Running→Idle→Paused→Stopped` + 前端状态展示 |
| 4 | **Agent Observability (Trace)** | Terminator ProgressCallback / Grok session_metrics | **P0** | 4 天 | Trace tree + token/cost 追踪 + timeline 面板 |
| 5 | **Tool Concurrency Safety** | Flock `is_concurrency_safe()` | **P0** | 1 天 | 46 个工具标注并发安全属性 |
| 6 | **Agent Checkpoint/Resume** | Flock SQLite checkpoint / Grok journal | **P1** | 4 天 | 每步自动 checkpoint + 从断点恢复 |
| 7 | **Handoff 模式** | PraisonAI `handoffs` | **P1** | 3 天 | Agent 间直接移交控制权（非 delegation） |
| 8 | **ContextModifier** | Flock ContextModifier | **P1** | 2 天 | 工具可动态修改 Agent 行为（模型/推理深度/工具集） |
| 9 | **Agent Workspace Panel** | 无直接参考（原创） | **P1** | 5 天 | Agent 独立文件沙箱 + 终端 + 上下文面板 |
| 10 | **Approval 三态升级** | OpenCode once/always/reject | **P1** | 2 天 | 审批三态 + 级联 + 持久化规则 |
| 11 | **Agent Cost Dashboard** | Hermes IterationBudget | **P1** | 2 天 | per-agent token/cost 追踪 + budget cap |
| 12 | **Agent Template System** | PraisonAI `from_template()` | **P2** | 2 天 | Agent 模板库（内置+用户+社区），一键克隆 |
| 13 | **Agent Skill Fork** | Flock `spawn_fork()` | **P2** | 2 天 | Skill 执行时派生独立子 Agent（model/effort/tools 覆盖） |
| 14 | **Agent Debug Replay** | Grok Journal / Terminator WorkflowRecorder | **P2** | 3 天 | 从 trace 重建执行过程，逐帧回放 |
| 15 | **Per-Agent Knowledge** | PraisonAI `knowledge: KnowledgeConfig` | **P2** | 2 天 | Agent 级知识源绑定（非全局） |
| 16 | **Message Steering** | PraisonAI `MessageSteeringProtocol` | **P2** | 2 天 | 执行中实时调整 Agent 行为方向 |

### 8.2 需求依赖图

```
Phase 1（Agent 引擎地基，~16 天）：
  #1 AgentDef Schema
  → #2 Agent Registry
  → #3 Lifecycle State Machine
  → #4 Observability (Trace)
  → #5 Tool Concurrency Safety

Phase 2（Agent 工作台，~18 天）：
  → #6 Checkpoint/Resume（依赖 #3）
  → #7 Handoff（依赖 #2）
  → #8 ContextModifier（依赖 #2）
  → #9 Agent Workspace Panel（依赖 #3, #4）
  → #10 Approval 三态（独立）
  → #11 Cost Dashboard（依赖 #4）

Phase 3（Agent 生态，~11 天）：
  → #12 Template System（依赖 #2）
  → #13 Skill Fork（依赖 #2, #5）
  → #14 Debug Replay（依赖 #4, #6）
  → #15 Per-Agent Knowledge（依赖 #2）
  → #16 Message Steering（依赖 #3）
```

---

## §9 细化实施方案

### 9.1 #1 AgentDef Schema（P0，3 天）

**参考源**：Flock `AgentEngine`（30+ 字段 Rust struct）+ PraisonAI `Agent.__init__`（60+ Python 参数）+ OpenCode `AgentV2.Info`（TypeScript schema）

**设计决策**：取 PraisonAI 的功能完备性 + Flock 的 Rust 类型安全 + OpenCode 的简洁 schema

```rust
// src-tauri/src/modules/ai/agents/schema.rs

/// Agent 定义——Agent 平台的第一性原理
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDef {
    // === 身份 ===
    pub id: AgentId,                        // 唯一标识（"code-reviewer" / UUID）
    pub name: String,                       // 显示名（"Code Reviewer"）
    pub description: String,                // 用途描述（何时使用此 agent）
    
    // === 模型 ===
    pub model: Option<String>,              // 模型覆盖（None = 继承主 agent）
    pub reasoning_effort: Option<String>,   // 推理深度（"low"/"medium"/"high"）
    
    // === 提示 ===
    pub system_prompt: String,              // 系统提示（必须）
    
    // === 工具 ===
    pub tools: ToolScope,                   // 工具可见范围
    
    // === 执行 ===
    pub max_steps: Option<u32>,             // 步数上限（None = 默认 24）
    pub max_tokens: Option<u32>,            // token 上限
    pub budget_cap: Option<f64>,            // 成本上限（美元）
    
    // === 控制 ===
    pub mode: AgentMode,                    // subagent | primary | hidden
    pub enabled: bool,                      // 是否启用
    
    // === 可选高级功能 ===
    pub memory: Option<AgentMemoryConfig>,  // 记忆配置
    pub knowledge: Option<String>,          // 知识源（workspace 路径）
    pub plan_mode: bool,                    // 是否启用 Plan 模式
    pub approval: Option<ApprovalPolicy>,   // 审批策略
    pub hooks: Option<AgentHooks>,          // 生命周期钩子
    
    // === UI ===
    pub color: Option<String>,              // 颜色标识
    pub icon: Option<String>,               // 图标
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentMode {
    Subagent,   // 可被委派（默认）
    Primary,    // 可作为主 agent
    Hidden,     // 可运行但不出现在选择器
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ToolScope {
    All,                        // 所有工具
    AllowList(Vec<String>),     // 白名单
    DenyList(Vec<String>),      // 黑名单（继承全集后排除）
    Named(String),              // 引用命名工具集
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMemoryConfig {
    pub recall: bool,            // 是否启用记忆召回
    pub auto_save: bool,         // 是否自动沉淀
    pub scope: MemoryScope,      // session | workspace | global
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentHooks {
    pub on_start: Option<String>,    // 启动时执行的 hook
    pub on_end: Option<String>,      // 结束时执行的 hook
    pub on_error: Option<String>,    // 出错时执行的 hook
}
```

**改动文件**：
- 新建 `src-tauri/src/modules/ai/agents/schema.rs`（Rust 定义）
- 修改 `src/modules/ai/lib/agents.ts`（TS 前端同步）
- 新建 `src/settings/components/AgentsSection.tsx`（设置 UI）

**验证**：`cargo check` + `tsc` + serde 往返测试

---

### 9.2 #2 Agent Registry（P0，2 天）

**参考源**：PraisonAI `ServerRegistry`（线程安全注册表）+ Flock `ToolRegistry`（Vec\<Box\<dyn Tool\>\>）

```rust
// src-tauri/src/modules/ai/agents/registry.rs

/// Agent 注册表——管理所有已定义的 Agent
pub struct AgentRegistry {
    agents: RwLock<HashMap<AgentId, AgentDef>>,
    source_map: RwLock<HashMap<AgentId, AgentSource>>,  // 来源追踪
}

pub enum AgentSource {
    BuiltIn,                      // 内置（YaMet 自带）
    Workspace(PathBuf),           // workspace/.yamet/agents/
    User(PathBuf),                // ~/.yamet/agents/
    SkillDerived(AgentId),        // 从 Skill 派生
}

impl AgentRegistry {
    /// 从多源加载（内置 + workspace + 用户），优先级递增
    pub fn load_all(workspace_root: &Path) -> Self;
    
    /// 查找 Agent
    pub fn get(&self, id: &AgentId) -> Option<AgentDef>;
    
    /// 列出可委派的 Agent（mode != Hidden）
    pub fn list_delegatable(&self) -> Vec<AgentDef>;
    
    /// 注册/覆盖（用户创建的 Agent）
    pub fn register(&self, def: AgentDef, source: AgentSource) -> Result<()>;
    
    /// 合并：内置 + 用户自定义（同 id 用户覆盖内置）
    pub fn merge(built_in: Vec<AgentDef>, user: Vec<AgentDef>) -> Vec<AgentDef>;
    
    /// 持久化到 .yamet/agents/<id>.json
    pub fn persist(&self, id: &AgentId) -> Result<()>;
}
```

**改动文件**：
- 新建 `src-tauri/src/modules/ai/agents/registry.rs`
- 修改 `agents/mod.rs`（暴露 Registry）
- 前端：Agent 列表面板

---

### 9.3 #3 Agent Lifecycle State Machine（P0，3 天）

**参考源**：Hermes `SubagentState` + `SubagentHandle`

```rust
// src-tauri/src/modules/ai/agents/lifecycle.rs

/// Agent 实例状态机
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentState {
    Created,        // 已创建，未执行
    Running,        // 正在执行
    Idle,           // 执行完毕，等待新输入
    Paused,         // 已暂停（人工审批/中断）
    Stopped,        // 已停止
    Failed(String), // 执行失败
}

/// Agent 实例——运行时状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInstance {
    pub id: String,                      // 实例 ID（UUID）
    pub def_id: AgentId,                 // 引用的 AgentDef
    pub state: AgentState,
    pub session_id: String,              // 关联的 AI session
    pub parent_id: Option<String>,       // 父 Agent 实例 ID（委派链）
    pub depth: u32,                      // 委派深度（0 = 主 agent）
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub step_count: u32,
    pub token_usage: TokenUsage,
    pub cost_usd: f64,
    pub error: Option<String>,
}

/// 生命周期管理器
pub struct AgentLifecycleManager {
    instances: RwLock<HashMap<String, AgentInstance>>,
    history: RwLock<Vec<AgentRunRecord>>,  // 执行历史
}

/// 执行记录——可观测性基础
pub struct AgentRunRecord {
    pub instance_id: String,
    pub def_id: AgentId,
    pub input: String,
    pub output: Option<String>,
    pub state: AgentState,
    pub steps: Vec<StepRecord>,
    pub duration_ms: u64,
    pub token_usage: TokenUsage,
    pub cost_usd: f64,
}

pub struct StepRecord {
    pub step: u32,
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,
    pub tool_output: Option<String>,
    pub duration_ms: u64,
    pub token_delta: TokenUsage,
}
```

**改动文件**：
- 新建 `src-tauri/src/modules/ai/agents/lifecycle.rs`
- 新建 `src-tauri/src/modules/ai/agents/history.rs`（执行历史持久化）
- 前端：Agent 状态指示器 + 执行历史面板

---

### 9.4 #4 Agent Observability（P0，4 天）

**参考源**：Terminator `ProgressCallback` + Grok `session_metrics` + Flock token accounting in `AgentState`

```rust
// src-tauri/src/modules/ai/agents/trace.rs

/// Trace span——Agent 执行的最小可观测单元
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceSpan {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: SpanKind,
    pub name: String,
    pub start_ms: u64,
    pub end_ms: Option<u64>,
    pub status: SpanStatus,
    pub metadata: HashMap<String, serde_json::Value>,
}

pub enum SpanKind {
    LlmCall,          // LLM 调用
    ToolCall,         // 工具调用
    Reasoning,        // 推理步骤
    SubagentSpawn,    // 子 Agent 派生
    WaitApproval,     // 等待审批
}

pub enum SpanStatus {
    Running,
    Completed,
    Failed(String),
}

/// Trace tree——完整的 Agent 执行轨迹
pub struct AgentTrace {
    pub root_id: String,
    pub spans: Vec<TraceSpan>,
    pub total_tokens: TokenUsage,
    pub total_cost_usd: f64,
    pub total_duration_ms: u64,
}
```

**前端**：
- `TraceTimeline.tsx`：时间线面板，展示 span 树
- `TokenCostDashboard.tsx`：token/cost 聚合面板
- 与 `ActivityStrip` 集成：实时显示当前步骤

---

### 9.5 #5 Tool Concurrency Safety（P0，1 天）

**参考源**：Flock `Tool::is_concurrency_safe()`

```rust
// 在 YaMet 现有 tool() 函数基础上扩展

pub struct ToolMeta {
    pub name: String,
    pub description: String,
    pub needs_approval: bool,
    pub is_read_only: bool,
    pub is_concurrency_safe: bool,  // 新增
}

// 46 个工具的并发安全标注：
// ✅ 并发安全：read_file, list_directory, grep, glob, git_status, git_diff,
//    search_memories, list_project_memory, todo_write, web_search, fetch_url
// ⚠️ 条件安全：write_file (mtime CAS), edit (mtime CAS)
// ❌ 不安全：bash_run, bash_background, create_directory, delete_file,
//    rename_file, git_stage, git_commit, run_subagent, delegate_many
```

---

## §10 版本节奏

| 版本 | 内容 | 预估 |
|---|---|---|
| **0.1.28a** | Phase 1：#1 Schema + #2 Registry + #3 Lifecycle + #5 Concurrency Safety | ~9 天 |
| **0.1.28b** | Phase 1 续：#4 Observability + Phase 2 部分 | ~9 天 |
| **0.1.28** | Phase 2：#6 Checkpoint + #7 Handoff + #8 ContextModifier + #9 Workspace + #10 Approval + #11 Cost | ~18 天 |
| **0.1.29** | Phase 3：#12-#16 高级能力 | ~11 天 |

---

## §11 跨项目可复用模式速查表

| 模式 | 最佳参考 | YaMet 落点 | 复杂度 |
|---|---|---|---|
| **Agent Schema** | PraisonAI `Agent.__init__` + Flock `AgentEngine` | `agents/schema.rs` | 中 |
| **Tool Trait** | Flock `trait Tool` + `ToolRegistry` | 扩展现有 `tool()` 函数 | 低 |
| **状态图执行** | Flock LangGraph `build_agent_graph` | 扩展现有 `run_graph` | 高 |
| **Checkpoint** | Flock `SqliteSaver` + `thread_id` | 新建 `checkpoint.rs` | 中 |
| **状态机** | Hermes `SubagentState` | 新建 `lifecycle.rs` | 低 |
| **审批三态** | OpenCode `once/always/reject` | 扩展 `approvalResponder` | 低 |
| **Handoff** | PraisonAI `handoffs=[agent]` | 新建 `handoff.rs` | 中 |
| **ContextModifier** | Flock `ContextModifier` | 扩展 `ToolResult` | 中 |
| **ProgressCallback** | Terminator `ProgressCallback` | 新建 `trace.rs` | 中 |
| **WorkflowRecorder** | Terminator `terminator-workflow-recorder` | 新建 `replay.rs` | 高 |
| **IterationBudget** | Hermes `IterationBudget` | 新建 `budget.rs` | 低 |
| **Knowledge** | PraisonAI `KnowledgeConfig` | 扩展 `knowledge_base` | 低 |
| **Template** | PraisonAI `from_template()` | 新建 `template.rs` | 低 |

---

## §12 一句话总结

> **YaMet 已经拥有 46 个工具 + 多 Agent 编排 + 记忆/技能系统的能力底座，但缺少「Agent 作为一等公民」的平台层：Schema 定义 → 注册表 → 生命周期状态机 → 可观测性 → Checkpoint → 审批三态。补齐 Phase 1（#1-#5，~9 天）后，YaMet 从 ADE 跃迁为 Agent 引擎；补齐 Phase 2（#6-#11，~18 天）后，成为真正的 AI Agent 工作台。参考项目的最优模式：Flock（Rust AgentEngine + LangGraph）、PraisonAI（60 字段 Schema + Handoff）、Hermes（状态机 + 预算）、OpenCode（审批三态 + parentID）。**
