# 第三十二轮迭代需求：多智能体编排 + 多 provider 搜索 + capability 路由

> 目标版本 **0.1.32**。
> 命题：用户指定三条借鉴路径——swarms-rs 的 swarm 编排模式、opencode 的 Exa/Parallel MCP 搜索 provider、hermes 的 provider 注册表 + capability 路由——以「提取设计模式、Rust/TS 重写」方式并入 yamet。
> 调研方式：3 个并行只读子代理深挖三参考源源码（全部结论引文件:行号）+ 主会话对 yamet 现状做源码级盘点（`web_search/{mod,provider,ddg}.rs`、`web_fetch/url_safety.rs`、`net.ts`、`runSubagent.ts`、`registry.ts`、`deepSearch.ts`、`delegateMany.ts` 全读 + 逐条核验）。
> 输出：本需求文档（现状 + 三源模式提取 + 缺口总表 + P0/P1/P2 Sprint 落地清单 + 验收标准）。

---

## §0 现状盘点（源码实证）

### 0.1 搜索侧：trait 骨架已建、provider 只有 DDG、无选择无 failover

| 项 | 位置 | 状态 |
|---|---|---|
| `SearchProvider` trait（name / is_configured / search） | `src-tauri/src/modules/net/web_search/provider.rs:58-63` | ✅ 已建 |
| `FailureCategory`（Auth/Quota/RateLimited/Timeout/Network/Server/Parse/Internal） | `provider.rs:14-23` | ✅ 已建 |
| `SearchError{degraded, retry_after}` | `provider.rs:25-41` | ✅ 已建 |
| `PROVIDER_MODES` 声明 4 provider（duckduckgo/exa/brave/parallel） | `provider.rs:68` | ⚠️ 只声明未实现 |
| DDG provider 实现（含缓存/重试变体/词汇重排） | `web_search/ddg.rs`（全 500+ 行） | ✅ 完整 |
| **provider 选择**：`get_provider()` 硬编码返回 `DdgProvider`，从不扫描 `PROVIDER_MODES` / 从不读 `is_configured` | `web_search/mod.rs:37-44` | ❌ 缺口 |
| **failover 降级链**：DDG 失败直接返回 error，不切备用 | `mod.rs:102-123` | ❌ 缺口 |
| **FailureCategory 跨 Tauri 透传**：命令层只传 `degraded: bool`，category 丢弃 | `mod.rs:115-123` + `net.ts:109-114` | ❌ 缺口 |
| DDG 追踪链接解包（uddg） | `ddg.rs:381-405` `resolve_search_url` | ✅ 已修（历史缺陷闭合） |
| DDG 假成功检测（anomaly 页） | `ddg.rs:292-320` `detect_fake_success` | ✅ 已修（历史缺陷闭合） |
| Exa / Brave / Parallel 实现 | — | ❌ 仅 PROVIDER_MODES 一行声明 |
| key 管理 | `src-tauri/src/modules/secrets.rs`（keyring）+ `native.ts:868` | ✅ 已有，可给 Exa/Parallel 用 |

### 0.2 安全侧：参数名黑名单已有、vendor 前缀闸缺失（核验确认）

| 项 | 位置 | 状态 |
|---|---|---|
| 敏感 query 参数名黑名单（api_key/token/secret/password/sas/sig…） | `web_fetch/url_safety.rs:13-40` | ✅ 已有 |
| 四路检测（raw/unquote/normalized/unquote-normalized） | `url_safety.rs:43-51` `candidate_forms` | ✅ 已有 |
| **vendor 前缀 token 闸**（`sk-`/`ghp_`/`AIza`/`AKIA`/`tvly-`/`fc-`/`xai-`… 扫全 URL） | `url_safety.rs` 全文 | ❌ **缺失**（只查 query，`parsed.query()?` 早退，path/fragment/无 query URL 全漏） |
| 词边界锚定 | `url_safety.rs` | ❌ 无（hermes `_PREFIX_RE` 有 lookbehind/lookahead） |
| SSRF / 域名白名单 | `web_fetch/ssrf.rs` + `domain.rs` | ✅ 已有 |

**绕过路径（现状会漏）**：密钥放 path（`/sk-ant-xxx`）、放非敏感参数名（`?ref=ghp_xxx`）、放 fragment（`#sk-...`）、URL 无 query。

### 0.3 编排侧：delegateMany 波次并行已好、缺声明式编排与完成门

| 项 | 位置 | 状态 |
|---|---|---|
| 并行 fan-out（wave=4、depth 护栏、sub-session 树） | `tools/delegateMany.ts`（MAX_PARALLEL_WORKERS=4） | ✅ 已有 |
| 子代理运行器（角色白名单、fallback、超时、空文本兜底总结） | `agents/runSubagent.ts` | ✅ 已有 |
| 角色注册表（explore/code-review/security/general/code/executor；general 已含 WEB_TOOLS） | `agents/registry.ts:55-104` | ✅ 已有（研究离线缺口已闭合） |
| deep_search 四阶段（Plan→Research→Verify→Report） | `tools/deepSearch.ts` | ⚠️ **研究阶段单 agent 处理全部问题**（`deepSearch.ts:166-179` 一次 runSubagent 带全部 questions），文档注释宣称「parallel」名不副实 |
| 图编排引擎 | `graph/engine.ts`（467 行） | ⚠️ 无条件/变换/多上游聚合语义 |
| 任务完成门（LLM 自主声明完成） | `runSubagent.ts`（只有 `stopWhen: stepCountIs`） | ❌ 缺口 |
| 上游→下游接力、结构化聚合策略、任务去重、编排级追踪契约 | `delegateMany.ts` / `graph/engine.ts` | ❌ 缺口 |

### 0.4 provider/fallback 侧：熔断+fallback 已强、缺「先自愈主链路」与「切换后复位」

| 项 | 位置 | 状态 |
|---|---|---|
| `generateTextWithFallback` + `isRetryableModelError` | `ai/lib/resilience.ts:18,44` | ✅ 已有 |
| Rust 电路熔断（record_provider_success/failure + is_provider_available + BreakerSnapshot） | `src-tauri/src/modules/ai/resilience.rs:36` | ✅ 已有（比 hermes 先进） |
| ProviderFallbackChain 设置 UI（拖拽排序 + 断路器状态点） | `settings/sections/ProviderFallbackChain.tsx` | ✅ 已有 |
| 「先自愈主链路（重建连接）再切 provider」 | — | ❌ 缺口（hermes `conversation_loop.py:5028-5040`） |
| fallback 切换后复位 retry/context 计数 | — | ❌ 缺口（hermes `:5047-5049`） |
---

## §1 三源设计模式提取（子代理深挖，引文件:行号）

### 1.1 swarms-rs — 多智能体编排（8 模式）

调研对象：`E:\Agent\swarms-rs-main\swarms-rs-main\swarms-rs\src`（SwarmsAgent run 循环 1793 行 + structs/ 下 8 个编排模块）。

| # | 模式 | swarms-rs 出处 | 价值 | 移植难度 | yamet 落点 |
|---|---|---|---|---|---|
| S1 | **任务评估器停止门**：内置 task_evaluator 工具返回 Complete/Incomplete{context}，Complete 提前 break、Incomplete context 注入下一轮 prompt | `agent/swarms_agent.rs:1340-1397,1717-1785,1255-1260` | ⭐⭐⭐⭐⭐ | 中 | `agents/runSubagent.ts` |
| S2 | **Flow 编排 DSL**：字符串 `"researcher, analyst -> reviewer -> summarizer"` 表达顺序/并行/人工(H)/聚合，避免硬编码状态机；输出聚合 All/Final/List/Dict | `structs/rearrange.rs:470-475,551-592,595-625` | ⭐⭐⭐⭐⭐ | 中 | 新增 `tools/swarmFlow.ts` + `graph/engine.ts` |
| S3 | **DAG 边条件/变换/多上游聚合**：边带 condition/transform；所有入边就绪才执行目标节点，多上游输入拼 `[From src]...` | `structs/graph_workflow.rs:83-131,262-396`（condition :305-315、transform :329-332、聚合 :357-371） | ⭐⭐⭐⭐⭐ | 中 | `graph/engine.ts` + `graph/types.ts` |
| S4 | **顺序流水线接力**：上游输出作下游输入 | `structs/sequential_workflow.rs:97-104` | ⭐⭐⭐⭐ | 低 | `graph/engine.ts` 线性子图快捷 |
| S5 | **结构化结果聚合策略**：All/Final/List/Dict 可配置聚合 | `structs/rearrange.rs:595-625` | ⭐⭐⭐⭐ | 低 | `tools/delegateMany.ts` 返回选项 |
| S6 | **Agent 配置即声明**：停止词/重试/缓存/评估器开关收敛为可序列化 config | `structs/agent.rs:147-169` | ⭐⭐⭐ | 低 | `runSubagent.ts` 顶部常量收敛 |
| S7 | **编排元数据 schema**：run_id/agent_name/task/output/start/end/duration | `structs/swarm.rs:44-52` + `structs/utils.rs:9-30` | ⭐⭐⭐ | 低 | `store/agentActivityStore.ts` |
| S8 | **动态并发池 + 任务去重**：`buffer_unordered(max_concurrent)` 真并发池（默认 8）+ DashSet 去重 | `structs/execute_agent_batch.rs:92-187` + `concurrent_workflow.rs:109` | ⭐⭐⭐ | 中 | `tools/delegateMany.ts`（wave→并发池） |

**能力差距结论**（swarms 有、yamet delegateMany/subagent 没有）：① 声明式 flow DSL ② 上游→下游接力与多上游聚合 ③ 边条件/变换 ④ 结构化聚合策略 ⑤ 任务去重 ⑥ 动态并发池 ⑦ 编排级追踪契约 ⑧ task_evaluator 完成门。

**yamet 已强于 swarms-rs 的（无需照搬）**：重试/降级（`generateTextWithFallback`）、worker 超时 + 部分进度透明化（`delegateMany.ts:210-246`）、预算/step 上限、深度护栏（MAX_SPAWN_DEPTH=3）。

### 1.2 opencode — 多 provider 搜索抽象（9 缺口映射）

调研对象：`packages/opencode/src/tool/websearch.ts`、`mcp-websearch.ts`、`packages/core/src/tool/websearch.ts`、`runtime-flags.ts`、`registry.ts`。

关键事实（子代理更正）：**opencode 无真正 failover**（每请求选单 provider：env 覆盖 > 开关 > 会话 hash 均摊），真实价值是选择优先级链、config 集中化、Exa/Parallel 两套 key 注入范式 + 轻量 HTTP MCP `tools/call`（无 handshake）+ JSON/SSE 双格式响应解析 + typed 错误 + 限长。

| # | yamet 缺口 | opencode 模式（文件:行） | 落点 |
|---|---|---|---|
| G1 | 无多 provider 选择（get_provider 固定 DDG） | `selectWebSearchProvider` 优先级链（`websearch.ts:30-37`）/ `selectProvider`（`core:88-97`） | `web_search/mod.rs` |
| G2 | 无 failover 降级链 | typed 错误 + 可换 provider（`core:248`） | `mod.rs` 命令层 |
| G3 | FailureCategory 丢在 Tauri 边界 | `Effect.mapError→ToolFailure`（`core:248`） | `mod.rs` + `net.ts`/`native.ts` |
| G4 | 无 Exa 接入 | key 进 URL query（`mcp-websearch.ts:4-6`/`core:145-150`）+ `McpRequest` POST（`:58-96`） | 新 `web_search/exa.rs` |
| G5 | 无 Parallel 接入 | Authorization Bearer header + 匿名降级（`websearch.ts:54-58`/`core:241`） | 新 `web_search/parallel.rs` |
| G6 | 无 MCP 响应解析器 | `McpResult` schema + JSON/SSE 直扫（`mcp-websearch.ts:9-41`/`core:99-123`） | 新 `web_search/mcp_parse.rs` |
| G7 | 无响应字节截断 | `MAX_RESPONSE_BYTES=256KB` + `collectBoundedResponseBody`（`core:22-24,173-177`） | mcp_parse.rs body 读取处 |
| G8 | 无按 query 权限询问 | `ctx.ask({permission:"websearch"})`（`websearch.ts:119-131`） | `net.ts` / Tauri 命令层 |
| G9 | key 管理（yaMet 比 opencode 更优：keyring 而非 env） | `Config`+`defaultConfigLayer`（`core:62-84`） | `secrets.rs` + 新配置 |

**设计决策（opencode 不可照抄处）**：① 保留 yamet 结构化 `SearchHit{title,url,snippet,position}`（ddg.rs:110-118）为统一 schema，不用 opencode 的 text blob（`core:205`）；② Exa key 存 keyring 而非 env；③ failover 语义：`FailureCategory ∈ {RateLimited,Quota,Timeout,Server,Network}` 才降级，`Auth/Parse/Internal` 直接返回（避免把配置错当限流打空）。

### 1.3 hermes — provider 注册表 / capability 路由 / 安全网络层（6 模式）

调研对象：`providers/base.py`、`agent/web_search_{registry,provider}.py`、`agent/redact.py`、`tools/url_safety.py`、`tools/web_tools.py`、`agent/conversation_loop.py`。

| # | 模式 | hermes 出处 | 价值 | 移植难度 | yamet 落点 |
|---|---|---|---|---|---|
| H1 | **声明式 ProviderProfile + 惰性插件注册表**（last-writer-wins、别名解析、models_url 解析链、UA 绕过 WAF） | `providers/base.py:38-233` + `providers/__init__.py:43-62,140-191` | ⭐⭐⭐⭐⭐ | 中 | `ai/lib/providerModels.ts` |
| H2 | **Capability 感知注册表**（search/extract 分离；`is_available()` 纯本地禁网络；解析优先级：显式配置→单候选→legacy 偏好序） | `agent/web_search_provider.py:89-211` + `web_search_registry.py:133-219` | ⭐⭐⭐⭐⭐ | 中 | `tools/net.ts` + `registry.ts` |
| H3 | **search/extract 能力探测**（supports_search 默认 True / supports_extract 默认 False；多能力单类声明） | `web_search_provider.py:125-140` | ⭐⭐⭐⭐ | 低 | `web_search/provider.rs` |
| H4 | **secret-in-URL 前缀闸**（30+ vendor 前缀 + 词边界 + 四路检测；参数名黑名单刻意排除 code/key/auth 防误杀） | `agent/redact.py:72-114,400-402` + `tools/web_tools.py:796-818` | ⭐⭐⭐⭐⭐ | 低（yaMet 已有参数名单闸，只缺前缀闸） | `web_fetch/url_safety.rs` |
| H5 | **硬超时一次性子进程**（SIGTERM→5s→SIGKILL 进程树强杀 + 防管道死锁滚动缓冲） | `tools/code_execution_tool.py:1418-1523,1645-1692` | ⭐⭐⭐⭐ | 中 | `web_fetch/client.rs` per-URL 超时 + shell 子进程 |
| H6 | **Provider fallback 链**（先自愈主链路再切；FailoverReason.billing 非重试直接终结；切换后同步 failover 提示词 + 复位计数） | `agent/agent_init.py:1358-1381` + `conversation_loop.py:5023-5050` | ⭐⭐⭐⭐ | 低（yaMet 已有雏形） | `ai/lib/resilience.ts` + `transport.ts` |

**专项结论（子代理 Q1 核验）**：yaMet `web_fetch::validate_url` 缺的是「vendor 前缀 token 检测闸」——hermes 是两道闸（前缀闸 + 参数名闸），yaMet 只有第二道。前缀闸需扫**整个 URL 字符串**（path/fragment/无 query 都拦），带词边界，四路形式复用现有 `candidate_forms`。
---

## §2 缺口总表（合并三源，去重后 15 项）

| ID | 缺口 | 来源 | 模块 | 优先级 |
|---|---|---|---|---|
| G1 | 无多 provider 选择（get_provider 固定 DDG） | opencode G1 | Rust web_search | P0 |
| G2 | 无 failover 降级链（按 FailureCategory 切） | opencode G2 + hermes H6 | Rust web_search | P0 |
| G3 | FailureCategory 不跨 Tauri 透传 | opencode G3 | Rust+TS | P0 |
| G4 | Exa provider 未实现 | opencode G4 | Rust web_search | P0 |
| G5 | Parallel provider 未实现 | opencode G5 | Rust web_search | P0 |
| G6 | MCP 响应解析器（JSON/SSE）+ 字节截断 | opencode G6/G7 | Rust web_search | P0 |
| G7 | 搜索 provider key 走 keyring + 设置页状态 | opencode G9 + hermes H1 | Rust+TS | P0 |
| G8 | secret-in-URL 前缀闸（vendor token） | hermes H4 | Rust web_fetch | P1 |
| G9 | deep_search 研究阶段未并行（单 agent 全问） | swarms S1-S8 对照 | TS tools | P1 |
| G10 | 编排元数据契约（runId/durationMs） | swarms S7 | TS store | P1 |
| G11 | fallback 先自愈主链路 + 切换后复位 | hermes H6 | TS resilience | P1 |
| G12 | Flow 编排 DSL（顺序/并行/人工/聚合） | swarms S2 | TS tools | P2 |
| G13 | DAG 边 condition/transform/多上游聚合 | swarms S3 | TS graph | P2 |
| G14 | task_evaluator 完成门 | swarms S1 | TS runSubagent | P2 |
| G15 | 动态并发池 + 任务去重 + 聚合策略 | swarms S5/S8 | TS delegateMany | P2 |

---

## §3 推荐与 Sprint 落地清单

> 本轮交付 P0（搜索多 provider 全链）+ P1（安全前缀闸 + 编排补强 + fallback 增强）；P2 三项（flow DSL / DAG 边语义 / 完成门）为架构级增强，单列下一轮。全部可独立验证、可回滚。

### P0-1 多 provider 选择器（G1）｜`web_search/mod.rs`

**改动**：`get_provider()` 改为 `get_providers()` 返回有序 `Vec<Arc<dyn SearchProvider>>`（按 `PROVIDER_MODES` 顺序 + `is_configured()==true` 过滤；DDG 恒可用垫底）。状态从 `Option<Arc<dyn>>` 升级为 `Vec<Arc<dyn>>`（懒构建 + RwLock）。

```rust
fn get_providers(state: &WebSearchState) -> Vec<Arc<dyn SearchProvider + Send + Sync>> {
    let mut cached = state.client.read().clone();
    if cached.is_empty() {
        let mut v: Vec<Arc<dyn SearchProvider + Send + Sync>> = Vec::new();
        for (name, _mode) in PROVIDER_MODES {
            match *name {
                "duckduckgo" => v.push(Arc::new(ddg::DdgProvider)),
                "exa" => v.push(Arc::new(exa::ExaProvider::new(secrets::read_key("EXA_API_KEY")))),
                "parallel" => v.push(Arc::new(parallel::ParallelProvider::new(secrets::read_key("PARALLEL_API_KEY")))),
                "brave" => {} // 未实现前跳过
                _ => {}
            }
        }
        cached = v.into_iter().filter(|p| p.is_configured()).collect();
        *state.client.write() = cached.clone();
    }
    cached
}
```

**验证**：`cargo test --lib`（新增选择器单测：无 key 时只剩 DDG；有 key 时 Exa 优先）+ `cargo check`。

### P0-2 failover 降级链（G2）｜`mod.rs` 命令层

**改动**：`web_search` 命令遍历 `get_providers()`，逐个 `search`；失败时仅 `FailureCategory ∈ {RateLimited,Quota,Timeout,Server,Network}` 降级下一 provider 并聚合 `degraded=true` + 首错 message；`Auth/Parse/Internal` 立即返回。全失败返回聚合错误（category 取首个非降级错误，否则 RateLimited）。

```rust
let mut degraded = false;
let mut last_err: Option<SearchError> = None;
for p in get_providers(&state) {
    match p.search(&request).await {
        Ok(hits) => {
            let ranked = rerank::rerank(hits, &query, max);
            return Ok(WebSearchCommandResult { ok: true, results: ranked,
                truncated: ranked.len() >= max, degraded, category: None, error: None, .. });
        }
        Err(e) => {
            degraded |= e.degraded;
            match e.category {
                FailureCategory::Auth | FailureCategory::Parse | FailureCategory::Internal => {
                    return Ok(WebSearchCommandResult { ok: false, degraded, category: Some(e.category), error: Some(e.message), .. });
                }
                _ => { last_err = Some(e); } // 继续降级
            }
        }
    }
}
```

**验证**：单测覆盖 4 分支（全成功 / Auth 即停 / 限流降级成功 / 全失败聚合）。

### P0-3 category 透传（G3）｜`mod.rs` + `native.ts` + `net.ts`

**改动**：`WebSearchCommandResult` 加 `category: Option<FailureCategory>`（serde 序列化为小写字符串）；`native.ts` webSearch 返回类型加 `category?: string | null`；`net.ts` web_search 透传 `category` 字段。**验证**：`npx tsc --noEmit` + 既有 net.test.ts 回归。

### P0-4/P0-5 Exa + Parallel provider（G4/G5）｜新 `web_search/exa.rs`、`web_search/parallel.rs`

**改动**（两文件同构，仿 opencode 轻量 HTTP MCP `tools/call`，**无 handshake**，复用 `ddg.rs:243` 的 `safe_client_for_url` SSRF 客户端）：

- 构造：`ExaProvider::new(key: Option<String>)`；`is_configured()` = key 非空（Parallel 额外支持匿名降级：无 key 时也 configured，只带 `User-Agent`）。
- 请求：POST `https://api.exa.ai/mcp?exaApiKey=<key>`（Exa，key 进 URL query）；`https://parallel.that.ai/mcp`（Parallel，`Authorization: Bearer <key>` header）。Body = `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}`，Exa 工具名 `web_search`（args: query/type/numResults）、Parallel 工具名 `web_search`（args: objective/search_queries/session_id/model_name）。
- 响应：经 P0-6 `mcp_parse.rs` 解析 → 映射 `Vec<SearchHit>`（Exa 从 `result.content[].text` 的 JSON `results[]` 取 title/url/snippet；Parallel 取 structured results）。URL 过一遍 `validate_url` 式 SSRF 检查再入 SearchHit。
- 超时：`tokio::time::timeout(30s, ...)`（对齐 `ddg.rs:246,272`）。

**验证**：`cargo test --lib`（解析纯函数单测用夹具 JSON，不发网络）+ `cargo check`。**风险**：两 provider 端点/返回结构可能漂移——夹具先行、`degraded` 标志兜底。

### P0-6 MCP 响应解析器（G6）｜新 `web_search/mcp_parse.rs`

**改动**：`parse_mcp_response(body: &[u8]) -> Result<Vec<McpText>, McpParseError>`——先试直接 JSON，再逐行扫 `data: ` SSE 帧（非 `{` 开头跳过）；取 `result.content[].text`；body 读入前 `MAX_RESPONSE_BYTES = 256 * 1024` 截断（仿 `core:173-177`）。`McpText` → 各 provider 映射 `SearchHit`。**验证**：JSON/SSE/截断三组夹具单测。

### P0-7 key + 设置页状态（G7）｜`secrets.rs` + `ProviderKeyCard`/`ModelsSection`

**改动**：keyring 已支持任意 account（`KEYRING_SERVICE="YaMet-ai"`），新增 `exa` / `parallel` ProviderId（ProviderIcon/ProviderKeyCard 加图标与 account 名）；`ProviderFallbackChain` 附近加搜索 provider 状态区（is_configured 徽标：🟢 就绪 / ⚪ 无 key）。**验证**：`pnpm i18n-scan`（新文案补 zh/en）+ `pnpm lint` + `pnpm test`。
### P1-1 secret-in-URL 前缀闸（G8）｜`web_fetch/url_safety.rs` + `client.rs:validate_url`

**改动**（hermes H4，风险低收益大）：

1. 新增 `PREFIX_PATTERNS` 常量（30+ vendor 前缀，从 hermes `redact.py:72-114` 提取并补 yamet 生态：`sk-`、`sk-ant-`、`ghp_`/`github_pat_`/`gho_`/`ghu_`/`ghs_`/`ghr_`、`xapp-`/`xox`、`AIza`、`AKIA`、`pplx-`、`fal_`、`fc-`、`sk_live_`/`sk_test_`/`rk_live_`、`SG.`、`hf_`、`tvly-`、`exa_`、`gsk_`、`xai-`、`fw-`/`fw_`/`fpk_`、`gAAAA`）。
2. 编译期合成一条 alternation 正则（`regex` crate 已在依赖树，ddg.rs:374 已用）：`(?<![A-Za-z0-9_-])(?:sk-|ghp_|...)(?![A-Za-z0-9_-])`。
3. 新增 `pub fn detect_secret_prefix_in_url(url: &Url) -> Option<&'static str>`：对四路 `candidate_forms` 各跑一次 `is_match`（**扫全 URL 字符串**，非仅 query——覆盖 path/fragment/无 query 绕过）。
4. `client.rs:validate_url`（:242-249）在 `CredentialsInUrl` 检查后、现有 `SecretInUrl` 前插入前缀闸调用；命中返回与现有拦截一致的错误文案。

**注意**：现有参数名黑名单收得比 hermes 宽（含裸 `key`/`sig`/`pwd`/`sas`，`url_safety.rs:35-40`）——保留（激进方向一致），前缀闸只增不删。

**验证**：新增单测 8+ 条：path 密钥（`/sk-ant-xxx`）、非敏感参数名（`?ref=ghp_xxx`）、fragment（`#sk-...`）、无 query、双重编码、词边界（`foskey` 不误杀）、合法 URL 通过。**回滚**：单文件 revert。

### P1-2 deep_search 研究阶段并行化（G9）｜`tools/deepSearch.ts`

**改动**：Phase 2 从「单 runSubagent 带全部 questions」改为「per-question `delegateMany`」（复用 `MAX_PARALLEL_WORKERS=4` 波次 + 每 worker `general` 角色 + 各自 claims JSON 输出），问题数 ≤ breadth ≤ 6 时天然适配 wave=4。保留 coverageNotes 合并与 MAX_VERIFIED_CLAIMS 截断；每 worker 结果经既有 `parseJsonOutput` 校验后并入 `candidateClaims`（worker 失败记 coverageNote 不拖垮整体——对齐 swarms `concurrent_workflow.rs:126-134` 单点失败不终止语义）。

**验证**：`deepSearch.test.ts` 补并行路径回归（mock runner：断言每问独立 runSubagent 调用 + 失败 worker 容错）。**风险**：并发下模型延迟增大（YaMet.md 已记录 ai_http_stream 空闲超时现象）——保留 SUBAGENT_TOTAL_TIMEOUT_MS=5min 上限，失败降级为单 agent 全问路径。

### P1-3 编排元数据契约（G10）｜`store/agentActivityStore.ts`

**改动**：activity 条目补 `runId: string`（`newActivityId()` 已生成可复用）与 `durationMs`（finish 时 `Date.now() - startedAt` 自动计算），对齐 swarms `AgentOutputSchema`（`swarm.rs:44-52`）。UI（ActivityStrip）不变，仅补字段供日志/后续 flow 编排消费。**验证**：store 单测断言 finish 后 durationMs 非负 + runId 存在。

### P1-4 fallback 先自愈 + 切换后复位（G11）｜`ai/lib/resilience.ts` + `transport.ts`

**改动**（hermes H6）：
1. `generateTextWithFallback` 循环内：主 provider 失败且 retryable 时，**先整体重试主链路一次**（等同重建连接，仿 `conversation_loop.py:5028-5040` 的一次性 `_try_recover_primary_transport`）——recover 语义 = 等待一个短 backoff 后重试同一 provider；仍失败才推进 fallback 链。
2. 切换 provider 成功后**复位 retry/step 计数**（防上次失败状态污染新请求，仿 `:5047-5049`）；保留 Rust circuit breaker 记忆（yaMet 独有优势，不删）。
3. 非 retryable（billing 等）立即终止不消耗 fallback（`resilience.ts:18` 已有 `isRetryableModelError`，只需确认调用点全部走它）。

**验证**：`resilience.test.ts` 补 3 用例：主链路 recover 成功不换 provider / recover 失败切 fallback / 切换后计数复位。**回滚**：函数级 revert。

---

### P2（下一轮候选：架构级编排增强，本轮不实施）

| ID | 项 | 落点 | 要点 |
|---|---|---|---|
| P2-1 | Flow 编排 DSL | 新增 `tools/swarmFlow.ts` | 解析 `"A, B -> C -> D"`（`,`并行/`->`顺序/`H`人工）；主 agent 一次描述流水线，内部映射 delegateMany + 接力上下文；聚合策略 All/Final/List/Dict |
| P2-2 | DAG 边 condition/transform/多上游聚合 | `graph/engine.ts` + `graph/types.ts` | Edge{condition?, transform?}；入边全就绪才执行；多上游拼 `[From src]` 输入 |
| P2-3 | task_evaluator 完成门 | `agents/runSubagent.ts` | 新增 `task_evaluator` 工具（Complete/Incomplete{context}）；替代「空文本强制总结」兜底（:188-215）为结构化完成门 |
| P2-4 | 动态并发池 + 任务去重 + 聚合策略 | `tools/delegateMany.ts` | wave→`buffer_unordered(maxConcurrent)` 真并发池；task hash（`xxhash(prompt)`）去重；results 聚合选项 |
| P2-5 | ProviderProfile 声明式注册表 | `ai/lib/providerModels.ts` | profile + 注册表双结构、models_url 解析链、别名（hermes H1）——与 P0-7 设置页联动 |

## §4 验收标准（全部可勾选）

**P0（搜索多 provider）**
- [ ] `cargo test --lib` 全绿：选择器（无 key 只剩 DDG）、failover 4 分支、mcp_parse 三夹具、exa/parallel 映射纯函数
- [ ] `cargo check` 0 error；`cargo clippy` 0 warning
- [ ] 无 key 时行为与现状完全一致（DDG 单 provider，回归安全）
- [ ] 设置页 ModelsSection 出现 exa/parallel key 卡片；keyring 读写往返通过
- [ ] `pnpm i18n-scan` 通过（新文案双语齐）
- [ ] `pnpm check-drift` 通过（新命令/参数登记）

**P1**
- [ ] `url_safety.rs` 前缀闸单测 8+ 全绿（含 path/fragment/无 query/双重编码/词边界）
- [ ] `deepSearch.test.ts` 并行路径回归全绿；失败 worker 容错
- [ ] `agentActivityStore` 单测断言 runId/durationMs
- [ ] `resilience.test.ts` 新增 3 用例全绿
- [ ] `npx tsc --noEmit` 0 error；`pnpm test` 0 fail；`pnpm lint` 0 warning

## §5 来源与交叉引用

- 子代理调研报告（本会话 deleg_8c68c2a9，已存档）：
  - swarms-rs 8 模式：`C:\Users\Admin\AppData\Local\hermes\cache\delegation\subagent-summary-0-20260810_220851_991593.txt`
  - opencode 9 缺口：`subagent-summary-1-20260810_220851_993193.txt`
  - hermes 6 模式 + 3 专项：`subagent-summary-2-20260810_220851_996370.txt`
- 主会话核验：`web_search/{mod,provider,ddg}.rs`、`web_fetch/url_safety.rs`（前缀闸缺失实锤）、`runSubagent.ts`、`registry.ts`、`deepSearch.ts`、`delegateMany.ts` 源码通读
- 参考源码：`E:\Agent\swarms-rs-main`、`E:\Agent\opencode-dev\opencode-dev\packages\{opencode,core}\src\tool\websearch*.ts`、`E:\Agent\hermes-agent-main\hermes-agent-main\agent\{redact,web_search_registry,web_search_provider,conversation_loop}.py`
- 相关文档：`docs/yamet-项目说明书-操作SOP-2026-08-11.md`（§二 命令注册链 / §六 配置 SOP）、`docs/yamet-网络搜索功能深度调研-2026-08-08.md`（旧缺口基线，本轮部分闭合）、YaMet.md 项目记忆
