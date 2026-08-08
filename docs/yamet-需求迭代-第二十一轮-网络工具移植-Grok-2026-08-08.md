# 第二十一轮迭代需求：Grok 网络工具移植（grok-build 源码 → yamet 原生）

> 目标版本 **0.1.22**（功能性构建）。
> 用户核心命题：「grok 也是 rust，功能整体移植过来」。**实指**：本地 `E:\Agent\grok-build-main` 是 **Grok 开源的 agentic coding 引擎**（GitHub grok-build，Rust），其 `xai-grok-tools` crate 里有完整、可直接移植的 `web_fetch` / `web_search` / `search_tool` 实现。用户要求把这套**网络工具整体移植**到 yamet（同为 Rust/Tauri）的 agent 工具面。
> 范围：**概念模型 + 深度源码调研 + 需求规划 + 实施方案**。

---

## §0 概念模型（先把 Grok 网络工具 vs yamet 现状搞清楚）

### 0.1 一句话总纲

Grok 的「网络工具」不是一组并列函数，而是**三个能力层次的嵌套**：L1 单点获取（`web_fetch` 读一个 URL）、L2 实时检索（`web_search` 搜全网）、L3 多步调研（**`deep-research` 工作流**：Rhai 脚本编排，Plan→Research→Verify→Report 四阶段）。**关键发现：Grok 的这三层在 grok-build 里都是完整开源实现，与 yamet 同为 Rust——不是「复刻」，是「全功能移植源码 + 适配 yamet 栈」。**

```
┌────────────────────────────── Grok 网络能力（grok-build 源码）──────────────┐
│                                                                            │
│  ┌── L3 deep-research 工作流（Rhai 脚本 583 行，4 阶段）────────────────┐   │
│  │    Plan(拆解) → Research(parallel 并行) → Verify(交叉验证 shard)      │   │
│  │    → Report(合成+引用校验)                                           │   │
│  │    └── 依赖 L1+L2 作为研究节点                                        │   │
│  │                                                                      │   │
│  │   ┌── L2 web_search（Responses API + web_search tool）──────────┐   │   │
│  │   │    input{query, allowed_domains} → output{content, citations} │   │   │
│  │   │                                                              │   │   │
│  │   │   ┌── L1 web_fetch（reqwest + htmd + SSRF）────────────┐    │   │   │
│  │   │   │  input{url} → output{url, content(md), status,     │    │   │   │
│  │   │   │  content_type, bytes, source_artifact}             │    │   │   │
│  │   │   └───────────────────────────────────────────────────┘    │   │   │
│  │   └──────────────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

### 0.2 深度调研：Grok 网络工具源码逐文件剖析（grok-build-main，已核实）

#### 0.2.1 `web_fetch`（`crates/codegen/xai-grok-tools/src/implementations/grok_build/web_fetch/`）

**这是核心移植对象，9 个文件，安全设计极扎实：**

| 文件 | 职责 | 关键实现 |
|---|---|---|
| `mod.rs` | 工具定义 | `WebFetchTool`（ToolKind::WebFetch）+ `WebFetchInput{url}` + `WebFetchConfig`（Disabled/Enabled） |
| `client.rs` | 核心抓取 | `WebFetchClient::fetch()`：validate_url → HTTPS 升级 → SSRF 检查 → HTTP GET（同主机重定向，逐跳复检 SSRF）→ 按 content-type 分发（PDF/图片/视频落盘、HTML→markdown、binary 拒绝）→ 截断 → 缓存 |
| `ssrf.rs` | **SSRF 防护** | 完整特殊地址分类（IPv4 RFC1918/CGNAT/TEST-NET/loopback/link-local/multicast + IPv6 ULA/link-local/mapped）、DNS 双门控（`is_blocked_for_host(ip, host, allow_local)`）、rebinding 防护、`allow_local` 仅限显式 loopback 主机 |
| `config.rs` | 配置 | `WebFetchParams`（全部可选，带默认）+ `DEFAULT_ALLOWED_DOMAINS`（约 90 个开发文档域名白名单） |
| `domain.rs` | 域名白名单 | `DomainMatcher`（HashMap host → AnyPath/PathPrefixes，O(1) 查找，www/尾点/大小写规范化） |
| `http.rs` | HTTP 客户端 | reqwest 连接池 + `ArcSwapOption` 原子失效（传输错误时重建池防中毒）、超时 60s/connect 10s、重定向手动、gzip/brotli/deflate、代理 |
| `cache.rs` | 缓存 | TTL 900s / 128 条 / LRU 淘汰 |
| `overflow.rs` | 截断 | 上下文窗口 3% 预算、超长落盘 artifact + inline fallback |
| `error.rs` | 错误 | 细分错误（SSRF/域名/重定向/超长/内容类型） |

**`WebFetchParams` 全部字段（默认值）：**
- `cache_ttl_secs=900`、`max_cache_entries=128`、`timeout_secs=60`、`max_content_length=10MB`、`max_markdown_length=100_000`、`context_window_tokens=128_000`（web 内容 ≤3%）、`allowed_domains=默认白名单`、`proxy_endpoint=None`、`allow_local=false`（fail-closed）
- 安全常量不可配置：`MAX_URL_LENGTH=2000`、`MAX_REDIRECTS=10`、`USER_AGENT="Mozilla/5.0 (compatible; grok-agent/1.0; +https://x.ai)"`

**`WebFetchOutput`（serde）：**
```rust
enum WebFetchOutput {
  Content(WebFetchContent{ url, content, content_type, status_code, bytes, source_artifact?, inline_fallback?, output_location? }),
  DomainNotAllowed(String),
  CrossHostRedirect{ original_host, redirect_url },
  Error{ url?, message },
}
```

**抓取流程（client.rs 精确顺序）：**
1. `validate_url`：≤2000 字符、仅 http/https、无 URL 内凭证、非单标签主机（`localhost` 除外）
2. `upgrade_to_https`：`http://`→`https://`（显式 loopback 主机除外，本地 dev 服务器保留 http）
3. SSRF 检查（DNS 解析全部地址，任一非公共地址即阻断）
4. HTTP GET（同主机重定向手动跟随，每跳**重新复检 SSRF** 防 rebinding，≤10 跳）
5. content-type 分发：PDF/图片/视频 → magic bytes 校验 + 落盘；HTML → `htmd` 转 markdown（跳 script/style/svg/iframe）；binary → 拒绝
6. 截断：>3% 上下文窗口 → 落盘 artifact + 返回 inline 摘要
7. 缓存写入

#### 0.2.2 `web_search`（`implementations/grok_build/web_search/` + `implementations/web_search/client.rs`）

**Grok 的 web_search 不是独立搜索 API，而是调用 xAI Responses API 的 `web_search` 工具：**

- `WebSearchInput{query, allowed_domains?}`
- `WebSearchClient::search()`：POST `{base_url}/responses`，body 含 `model + input(query) + tools[WebSearchTool{filters{allowed_domains}}] + temperature 0.1 + top_p 0.95 + max_output_tokens 8192 + store:false`
- 返回 `(content, citations)`：`content` 是模型合成文本，`citations` 是提取的 URL 数组（从 `output.message.content[].output_text.annotations[].url_citation.url`，去重保序）
- `search_with_titles()`：额外提取 `(title, url)` 对（供 Cursor 兼容渲染 `Links:` 列表）
- 401 处理：`record_401_attribution`（回调 + 截断 bearer 前缀，不泄露完整 key）
- `WebSearchConfig{Disabled | Enabled{api_key, base_url, model, extra_headers, alpha_test_key}}`，带 `redacted()` 脱敏
- **依赖**：xAI Responses API（OpenAI 兼容），需 `api_key`/`base_url`/`model`

#### 0.2.3 `search_tool`（`implementations/search_tool/`）— 非网络

**澄清：`search_tool` 是「工具发现」工具（BM25 关键词搜本地 MCP 工具清单），不联网。** 与 `web_search` 完全无关。移植时**不包含**它（yamet 已有类似工具注册）。

#### 0.2.4 工具注册链路（`registry/types.rs:689-690`）

```rust
b.register::<grok_build::WebSearchTool>();                       // 无条件注册
b.register_with_params::<grok_build::WebFetchTool, WebFetchParams>(); // 带配置
```

- 工具实现 `xai_tool_runtime::Tool` trait：`Args`/`Output`/`id`/`description`/`capabilities{is_read_only:true, tool_scope:Read}`/`run()`
- `WebFetchClient`/`WebSearchClient` 通过 `Resources` 注入（`register_resource!`），`run()` 时从共享资源取
- `ToolKind` 31 种分类含 `WebSearch`/`WebFetch`/`SearchTool`
- 网络工具均 `is_read_only:true, tool_scope:Read`（只读，不触写路径）

### 0.3 深度调研：yamet 现状（已核实代码）

| 组件 | 现状 | 与 Grok 对应 |
|---|---|---|
| `net.rs` `ai_http_request` | ✅ 安全 HTTP：SSRF 防护、URL 校验、header 消毒、配额、超时 | ⚠️ 通道接近，但**无**域名白名单/HTTPS 升级/HTML→md/缓存/内容分发 |
| `tools/search.ts` | ❌ 是 grep+glob 本地搜索，非网络 | 无关 |
| `tools/tools.ts` buildTools | ✅ 统一注册面 | 对应 registry/types.rs |
| `tools/context.ts` ToolContext | ✅ ctx 齐全 | 对应 Resources 注入 |
| subagent | ❌ 全部只读代码探索 | 无网络子代理 |
| 网络 agent 工具 | **0 个** | 差距核心 |
| keyring | ✅ | 可存 api_key |

**结论**：Grok 的 `web_fetch`/`web_search` 是**完整、可移植的 Rust 实现**。yamet 的 `ai_http_request` 只覆盖了 Grok `web_fetch` 的一部分（SSRF 通道），缺域名白名单/内容分发/缓存/HTTPS 升级。移植 = **把 grok-build 的 web_fetch/web_search 适配进 yamet 的 net.rs + tools 层**。

### 0.4 移植策略（关键决策）

**两条路径，按此优先级：**

1. **P0-1 直接移植 Grok web_fetch 到 Rust**（推荐）：把 `web_fetch/{client,ssrf,config,domain,http,cache,overflow,error}.rs` 移植进 `src-tauri/src/modules/net/`，暴露一个 `web_fetch` Tauri 命令（带完整 SSRF+域名白名单）。这是"整体移植"最忠实的方式，且 Grok 实现已高度打磨。
   - 依赖：`reqwest`（已有）、`htmd`（新增，HTML→markdown）、`scraper`（已有?）、`parking_lot`、`arc-swap`（新增）
2. **P0-2 前端 `fetch_url` 工具**：`native.ts` 封装 `web_fetch` 命令 + `tools/net.ts` 注册 `fetch_url` 工具（入参 url/max_chars）。

**不采用**：复用 `ai_http_request` 做简化版——那会丢失 Grok 的域名白名单/内容分发/HTTPS 升级，且重复造轮子。

---

## 需求规划（Grok 网络工具整体移植）

### 融合矩阵（Grok 源码 → yamet）

| Grok 源码 | yamet 对应 | 状态 |
|---|---|---|
| `web_fetch/` 全部 9 文件 | `net.rs`/`modules/net/` | **移植（P0）** |
| `web_fetch` SSRF（ssrf.rs） | `net.rs` SSRF 升级 | 移植（P0） |
| `web_fetch` 域名白名单（domain.rs+config.rs） | 新增 | 移植（P0） |
| `web_fetch` 内容分发（PDF/图片/HTML→md） | 新增 | 移植（P0） |
| `web_fetch` 缓存（cache.rs） | 新增 | 移植（P0） |
| `web_fetch` HTTPS 升级 | 新增 | 移植（P0） |
| `web_search`（Responses API client.rs） | `web_search` 工具 | **移植（P1，需 xAI key）** |
| `deep_research.rhai` + workflow 引擎 | `deep_search` 工具 + workflow 运行时 | **移植（P2）** |
| `search_tool`（工具发现） | yamet 已有工具注册 | **不移植**（重复） |

### P0-1【Rust】移植 Grok web_fetch 到 net 模块

- **目标**：`src-tauri/src/modules/net/` 下新增 `web_fetch.rs`（或把 grok-build 的 web_fetch 目录搬入），暴露 Tauri 命令 `web_fetch(url, max_chars?) → {status, content_type, content, final_url, bytes, truncated}`。
- **完整保留**：SSRF 双门控、域名白名单（`DEFAULT_ALLOWED_DOMAINS` 直接搬）、HTTPS 升级、PDF/图片/视频 magic bytes 校验 + 落盘、HTML→markdown（htmd）、缓存 TTL 900s、超时 60s、连接池原子失效。
- **Cargo 依赖**：`htmd`（HTML→markdown，新）、`arc-swap`（新）、`parking_lot`（新，若未用）、`url`（已有）。reqwest 已有。
- **验证**：cargo test（移植 Grok 的 ssrf/domain/http 测试，它们非常完整）+ 真实 fetch 回显。

### P0-2【前端】fetch_url agent 工具

- `native.ts`：封装 `webFetch(url, opts)`（invoke `web_fetch`）。
- `tools/net.ts`：`buildNetTools(ctx)` → `fetch_url` 工具（schema：url/max_chars）。`is_read_only` 语义（Grok capabilities）。
- `tools.ts`：注册 `buildNetTools(ctx)`（对应 Grok `b.register::<WebFetchTool>`）。
- `context.ts`：`getNetConfig?()` 返回 allowed_domains 配置（可空）。
- **验证**：单测（mock native.webFetch）+ 真实 fetch_url 回显。

### P1-0【Rust+前端】web_search 工具（Responses API）

- **Rust**：移植 Grok `web_search/client.rs` 的 Responses API 调用，暴露 `web_search(query, allowed_domains?, max_results?) → {content, citations[]}` 命令。SSRF 复用 net 模块。
- **配置**：`WebSearchConfig{Enabled{api_key, base_url, model}}`，key 存 keyring，base_url 默认 `https://api.x.ai/v1`。
- **前端**：`tools/net.ts` 加 `web_search` 工具（query/max_results），返回 citations 列表。
- **未配置**：明确错误「未配置 web_search（需 xAI API key + base_url + model）」。
- **验证**：单测（mock 响应解析 + citations 提取）+ 真实调用（若用户有 key）。

### P1-1 网络工具上下文与安全边界

- `fetch_url`/`web_search` 只读（Grok `capabilities{is_read_only:true, tool_scope:Read}`），不进写路径。
- SSRF + 域名白名单由 Rust 层兜底，agent 无法翻越。
- 文档（YAMET.md + CHANGELOG）注明安全边界。

### P2-1【L3 调研】移植 Grok deep-research 工作流（全功能）

**这是 L3 的真身**：Grok 的多步调研不是简单 graph，而是一个 **Rhai 脚本编排的工作流**（`workflows/deep_research.rhai`，583 行，4 阶段）。全功能移植它，而不是简化成 graph。

- **Rust**：移植 Grok 的 workflow 引擎（`xai-workflow` crate）+ `WorkflowTool`（Rhack 脚本执行、`agent()`/`parallel()`/`phase()`/`pause()`/`complete()`/`write_scratch_file()` 内建函数）+ `deep_research.rhai` 脚本。
- **编排逻辑（完整保留）**：
  - **Plan**：`agent(research-planner)` 把 query 拆成 ≤breadth(默认4) 个独立问题（JSON schema 约束）
  - **Research**：`parallel(jobs)` 每个问题一个 `researcher-N`（read-only, web_search/fetch 可用），返回结构化 claims（≤6/问题，含 evidence/source/confidence）
  - **Verify**：claims 按 `claim_id % verifier_count` 分 shard，每个 `evidence-verifier-N` 独立交叉验证，**严格 claim-ID 一对一校验**（缺失/重复/越界即整 shard 废弃）
  - **Report**：`report-synthesizer` 合成正文，**强制引用校验**（每个 [S#] marker 必须出现、编号合法、禁止 Sources/References 节），失败回退确定性 findings 列表；最后拼 Sources + Coverage 段
- **前端**：`deep_search` 工具触发 workflow；报告落盘 `report.md`（write_scratch_file）。
- **依赖**：P0-2 fetch_url + P1-0 web_search + workflow 引擎。
- **验证**：单测（workflow 引擎 agent/parallel/phase mock）+ 端到端（给定问题，返回带引用校验的报告）。

### 范围外

- 实时 X/Twitter 数据（xAI 专有授权）
- 图像生成 / App SDK / 视频生成（超出 ADE 定位，且依赖 xAI 平台）
- `search_tool` 工具发现（yamet 已有工具注册，重复）
- `workflow` 通用脚本能力（deep-research 移植时顺带的基础，但通用 workflow 面不扩）
- 完整浏览器（ROADMAP 明言"不是浏览器"）

---

## 实施方案

### 依赖序

```
P0-1 移植 web_fetch 到 Rust（cargo test 全绿）
→ P0-2 fetch_url 前端工具（tsc + vitest）
→ P1-0 web_search（需 xAI key，可后置）
→ P1-1 安全边界文档
→ P2-1 deep-research 工作流（依赖 P0-2+P1-0+workflow 引擎）
```

### P0-1 移植 Grok web_fetch 到 Rust（大任务 → 拆 3 批）

**批次 A（搬运 + 编译）**
1. `src-tauri/src/modules/net/` 建 `web_fetch/` 子模块，搬运 grok-build 的 `client.rs`/`ssrf.rs`/`config.rs`/`domain.rs`/`http.rs`/`cache.rs`/`overflow.rs`/`error.rs`。
2. 适配：grok 的 `xai_tool_runtime::ToolError`/`Resources` → yamet 的 `Result<_, String>`/状态；`SessionFileWriter` → 简化/去掉。
3. **错误枚举映射**（`WebFetchError` 16 种 → yamet String）：`UnsupportedScheme`/`CredentialsInUrl`/`SingleLabelHost`/`InvalidUrl`/`SsrfBlocked{host,ip}`/`DnsResolution`/`DnsEmpty`/`ClientBuildError`/`HttpRequest`/`InvalidRedirect`/`TooManyRedirects{max=10}`/`ResponseTooLarge{max}`/`ProxyConfigError`/`IoError`/`UnsupportedContentType`/`ContentTypeMismatch`。**保留 Grok 的智能提示**：SSRF 拦截时若 host 含 "github" 且 `gh` 在 PATH，追加"改用 gh CLI 取数据"。
4. Cargo.toml 加 `htmd`/`arc-swap`/`parking_lot`。
5. `mod.rs` 注册 `web_fetch` Tauri 命令 + `generate_handler!`。
6. 门禁：`cargo check` + `cargo test`（移植 Grok 的 ssrf/domain/http 测试，应全绿）。

**批次 B（命令 + 真实调用）**
6. 调通 `web_fetch(url)` 命令，真实抓取 MDN/docs.rs 回显。
7. 验证 HTTPS 升级 / 域名白名单 / SSRF 阻断（私网 URL 报错）。

**批次 C（web 层 + 收尾）**
8. web/server registry 加 `web_fetch`（web 模式用原生 fetch）。
9. 门禁：cargo test + tsc + 一次真实回显。

### P0-2 fetch_url 前端工具（小任务 → 2 批）

**批次 A（native 封装）**
1. `native.ts` 加 `webFetch` + `HttpResponse` 类型。
2. 单测（mock）。

**批次 B（工具 + 注册）**
3. `tools/net.ts` `buildNetTools(ctx)` → `fetch_url`。
4. `tools.ts` 注册。
5. 单测 `tools/net.test.ts`（mock native.webFetch）。
6. 门禁：tsc + vitest + 真实回显。

### P1-0 web_search 工具（中任务 → 2 批）

**批次 A（Rust）**
1. 移植 `web_search/client.rs` Responses API 调用 → `web_search` 命令。
2. 配置（keyring/base_url/model）+ `redacted()`。

**批次 B（前端 + 设置）**
3. `tools/net.ts` 加 `web_search` 工具。
4. 设置 UI「Web 搜索」段（base_url/model/key）。
5. 单测 + 真实调用（若有 key）。
6. 门禁：tsc + vitest + cargo test。

### P1-1 安全边界文档
1. YAMET.md + CHANGELOG 注明只读/SSRF/域名白名单/keyring。
2. 单测固化（SSRF 阻断用例从 Grok 移植）。

### P2-1 移植 deep-research 工作流（大任务 → 拆 3 批）

**批次 A（workflow 引擎）**
1. 移植 Grok `xai-workflow` crate 的运行时：`agent()`/`parallel()`/`phase()`/`pause()`/`complete()`/`write_scratch_file()` 内建函数 + Rhai 脚本执行。
2. 适配：`agent()` → yamet subagent（runSubagent）；`parallel()` → delegate_many；`write_scratch_file` → 工作区临时目录。
3. Cargo.toml 加 `rhai`。
4. 门禁：cargo test（workflow 引擎单测，mock agent/parallel）。

**批次 B（deep_research.rhai 脚本）**
5. 搬运 `deep_research.rhai`(583 行)，配置内置。
6. 单测（Plan/Research/Verify/Report 各阶段 mock 驱动）。
7. 门禁：cargo test + tsc。

**批次 C（前端 + 端到端）**
8. `tools/net.ts` 加 `deep_search` 工具触发 workflow；报告落盘 + 回显。
9. 端到端（给定问题，返回带引用校验的报告）。
10. 门禁：tsc + vitest + 端到端。

### 构建
- 版本 0.1.21 → 0.1.22，四文件同步。
- CHANGELOG / ROADMAP / YAMET 三文档同步。
- 验证：tsc 0、vitest 全绿、cargo test（含移植的 SSRF 测试）、pnpm build、size budget。
