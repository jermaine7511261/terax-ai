# 会话可靠性

## 三层会话架构

```
┌───────────────────────────────────────────────┐
│  Layer 3: AI Agent 会话                       │
│  ├─ Rust Harness (AiSessionState)            │
│  ├─ 子代理隔离 (parentID tree)               │
│  ├─ Graph 编排 (journal checkpoint)          │
│  └─ 记忆隔离 (session/workspace/global)      │
├───────────────────────────────────────────────┤
│  Layer 2: MCP / Gateway 会话                  │
│  ├─ MCP Client (stdio/SSE 连接管理)          │
│  ├─ Gateway (IM 会话 + 认证)                  │
│  └─ LSP/DAP (子进程 + 分帧)                  │
├───────────────────────────────────────────────┤
│  Layer 1: PTY 终端会话                        │
│  ├─ portable-pty (ConPTY / unix pty)         │
│  ├─ Helper 常驻进程 (跨重启重连)              │
│  ├─ Buffer 快照 (snapshot replay)            │
│  └─ Job Object / process_group (进程树回收)   │
└───────────────────────────────────────────────┘
```

## PTY 会话可靠性

### Helper 进程模型

```
┌─────────────┐     IPC (socket/pipe)     ┌──────────────┐
│  主进程      │ ◄──────────────────────► │  Helper 进程  │
│  (Tauri)    │     cmd + event stream    │  (常驻)      │
│             │                           │              │
│  webview    │                           │  PTY 1: bash │
│  PTY 前端壳  │                           │  PTY 2: zsh  │
└─────────────┘                           │  PTY 3: ...  │
                                          └──────────────┘
```

- **启动探测**：主进程启动时探测 helper，有则 attach，无则 spawn
- **跨重启**：主进程崩溃/helper 存活 → 新主进程 attach 到同一 helper
- **会话恢复**：helper 不可用时回放 `~/.yamet/sessions/<id>.snap`

### ConPTY 特殊处理（Windows）

| 机制 | 说明 |
|---|---|
| SPAWN_LOCK | Mutex 包住 openpty+spawn，并发 spawn 导致管道停滞 |
| openpty 超时 | 5s 超时兜底（ConPTY 未初始化不挂死） |
| child.wait() | try_wait() 轮询（防无限挂起） |
| teardown 分阶段 | drop writer → drain reader(超时) → drop master(后台线程+2s 超时) |
| Job Object | KILL_ON_JOB_CLOSE 杀整棵进程树 |

### 进程树回收

| 平台 | 机制 |
|---|---|
| Windows | `Job Object` + `KILL_ON_JOB_CLOSE` + `terminate()` |
| Unix | `process_group(0)` + `SIGTERM → SIGKILL` 超时 |
| 开发环境 | `cargo run` 被 Ctrl-C 时析构不触发，可能有孤儿（可接受） |

## AI 会话可靠性

### Rust Harness 状态机

```
Created → Running → Idle ↔ Running → Stopped
                   ↓
                 Failed(error)
```

### 关键机制

| 机制 | 说明 |
|---|---|
| 健壮退出 | `finish≠tool-calls 且无 pending tool` 才退出 |
| Doom-loop | 连续 3 次相同 tool+args → 自动停止 |
| 子代理超时 | 每 worker 7 分钟 Promise.race |
| 子代理 budget | MAX_SPAWN_DEPTH=3 + SUBAGENT_SUMMARY_CAP=4000 |
| IterationBudget | consume/refund 计数器（主 agent 24，子 agent 8） |
| 记忆隔离 | 子代理独立 session 记忆，不共享父 agent |

### Checkpoint/Resume

基于 Flock 的 SQLite checkpoint：

1. 每步执行前落盘 journal（`hash_graph_def` request_hash 去重）
2. 中断后 `engine.resume(session_id)` 从断点恢复
3. Checkpointer: `SqliteSaver` 或 `InMemorySaver`（测试用）

## Graph 编排可靠性

### Journal 断点续跑

```
graph run → 每节点完成 → snapshot(requestHash) → 落盘 JSON
graph resume → 读 JSON → 跳过已完成节点 → 从断点继续
```

### 状态机

```rust
enum GraphNodeStatus {
    Pending,
    Running,
    Done,
    Failed,
    WaitingHuman,  // 人工审批暂停
}
```

### 并发调度

- `Semaphore(4)` 限最大并行节点数
- `tokio::spawn` 并行无依赖节点
- `judge` 节点：LLM 判定 → 条件边选择后续路径
- `human` 节点：暂停 + `graph:human-request` 事件 + 用户审批

### 审批三态

```typescript
// once: 本次允许
// always: 本会话记住（级联放行同类工具）
// reject: 拒绝（可带 message 回传模型纠错）
```

## 记忆系统可靠性

### 三层记忆

| 层 | 持久化 | 可召回 | 写入方式 |
|---|---|---|---|
| session | 内存 | 本会话内 | 自动（`source: "auto"`） |
| workspace | `<workspace>/.yamet/memory.json` | 所有会话 | `update_project_memory` |
| global | `~/.yamet/ai-memory.json` | 所有会话 | `update_project_memory` |

### 召回机制

```
query → tokenize → TF-IDF 评分 → × time_decay × source_weight
      → filter(min_score) → sort → MMR rerank(λ=0.7) → top-N
```

### 标记隔离

注入块包裹 `[System note: recalled memory context]`，流式清洗模型回显，防被当用户输入。

### 去重

`is_near_duplicate` 检查双向 bigram 相似度，阈值 0.8 视为重复不写入。
