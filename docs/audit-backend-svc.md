# yamet Rust 后端 AI/服务子系统深度审计报告

> 审计范围（只读）：`src-tauri/src/modules/{agent.rs, dap/, lsp/, mcp/, mcp_server/, gateway/, git/, history/}`
> 审计方式：源码逐文件 + 协议正确性核对 + 命令面比对（后端 `generate_handler!` vs 前端 `invoke`）
> 结论口径：只列真实问题（带【文件:行号 证据】），未列空壳/推测项。整体工程质量**很高**，多数子系统已具备完善的锁中毒处理、超时、分帧上限与路径沙箱（见文末「做得好的地方」）。

---

## 优先级摘要

| 级别 | 数量 | 一句话 |
|------|------|--------|
| P0 | 0 | 未发现可直接导致崩溃/数据损坏/被利用的致命项 |
| P1 | 2 | ① 反向 MCP server 请求-响应 id 配对错误；② 微信私聊默认 auto-approve 安全缺口 |
| P2 | 5 | ③ DAP/MCP 同步阻塞 tokio worker；④ LSP/DAP/MCP 会话状态存放与生命周期；⑤ gateway 凭证 Unix 明文存储；⑥ history 全量重写；⑦ MCP 通知被错误应答 |

---

## P1 问题

### P1-1 反向 MCP server 对 `initialize` 的响应 id 硬编码为 1，忽略请求 id（请求-响应配对错误）

`mcp_server` 是 yamet 作为 MCP **服务端**向外部 agent（Claude Code/OpenCode）暴露只读能力的 stdio JSON-RPC 入口。外部客户端发送 `initialize` 时携带自己的 `id`，但服务端**固定回 `id=1`**，且 `ServerRequest::Initialize` 枚举变体根本不捕获请求的 `id` 字段——若客户端 initialize 使用 `id != 1`（例如 `id=0`），响应 id 与请求 id 不匹配，客户端将无法关联，严格实现会直接报协议错误。

【mcp_server/mod.rs:83-95 证据】
```rust
ServerRequest::Initialize { params: _ } => {
    let resp = serde_json::json!({
        "protocolVersion": "2024-11-05",   // 硬编码，未与客户端协商
        ...
    });
    JsonRpcResponse::success(serde_json::json!(1), resp)  // ← id 固定为 1，忽略请求 id
}
```

【mcp_server/protocol.rs:18-22 证据】`Initialize` 变体只有 `params`，**没有 `id` 字段**，天然丢失客户端请求 id：
```rust
#[serde(rename = "initialize")]
Initialize {
    #[serde(default)]
    params: InitializeParams,
},
```
对比同一文件里 `ToolsList`/`ToolsCall`/`Ping` 都正确捕获了 `id`（protocol.rs:30-47），唯独 `initialize` 遗漏——这是明显的疏漏。同时 `protocolVersion` 硬编码为 `2024-11-05`，而 yamet 的 **MCP 客户端**用的是 `2025-06-18`（mcp/protocol.rs:9），服务端没有按规范回显/协商客户端版本。

**修复方向**：`ServerRequest::Initialize` 增加 `id` 字段；`handle_request` 用请求的真实 `id` 构造响应；`protocolVersion` 从 `InitializeParams.protocol_version` 中取或协商（可回退到服务端支持的版本）。

### P1-2 gateway：微信 iLink 私聊消息默认 auto-approve，未授权会话可直接驱动 agent

`GatewayRegistry` 的入站事件循环里，对 `PlatformId::Weixin` 且 `ChatType::Dm` 的消息**无条件调用 `approve()` 加入白名单**，绕过了默认-拒绝的授权门。后果：任何能向用户微信私聊（而不止用户本人）的人，一旦该消息进入 gateway，就被视为已授权会话，可直接驱动 agent（触发工具/读取上下文），且无需用户在设置界面点「授权」。

【gateway/registry.rs:280-284 证据】
```rust
let auto_trust = ev.platform == PlatformId::Weixin && ev.chat_type == ChatType::Dm;
if auto_trust {
    this.inner.sessions.approve(&sk);   // ← 任何微信私聊即自动授权
}
let authorized = auto_trust || this.inner.sessions.is_authorized(&sk);
```

虽然代码注释说明这是「镜像 Hermes dm_policy（扫码登录已认证账号身份）」，但**「认证了账号」≠「认证了发起私聊的人」**：微信账号可能被陌生人/爬虫/营销号私聊，或用户账号在另一设备被登录。默认-拒绝才是安全基线，对私聊也宜先进入 pending 审批（或至少限制为「仅自己给自己发/仅白名单联系人」）。

**修复方向**：去掉 `auto_trust` 对 `Dm` 的自动 approve，或改为「仅当 sender_id 与账号自身 id 一致」才自动信任；其余私聊统一走 `request_approval`。

---

## P2 问题

### P2-3 `dap_request_send` / `mcp_tool_call` 在 async command 内同步阻塞 tokio worker（最长 60s / 30s）

`dap_request_send` 是 `#[tauri::command] pub async fn`，但函数体直接调用 `session.send_request()`，其内部走 `mpsc::Receiver::recv_timeout(REQUEST_TIMEOUT=60s)` **阻塞当前线程**。Tauri async command 运行在 tokio 多线程 worker 上，一旦某请求超时/适配器卡住，会占死一个 worker 线程长达 60 秒。MCP 侧同理（`mcp_tool_call`/`mcp_resource_read` 调 `session.request()` → `recv_timeout(30s)`）。对比同模块的 `connect` 都正确用了 `spawn_blocking`，唯独工具调用路径漏了。

【dap/session.rs:158-164 证据】
```rust
match rx.recv_timeout(timeout) {   // ← 阻塞 60s（REQUEST_TIMEOUT，session.rs:26）
    Ok(Ok(resp)) => Ok(resp),
    ...
```
【dap/session.rs:484-492 证据】`#[tauri::command] pub async fn dap_request_send(...)` 直接 `session.send_request(&command, arguments)`，未包 `spawn_blocking`。

【mcp/session.rs:317-324 证据】`rx.recv_timeout(timeout)`（REQUEST_TIMEOUT=30s）。
【mcp/server.rs:274-282 证据】`#[tauri::command] pub async fn mcp_tool_call(...)` 直接 `session.call_tool(...)`。

**影响**：调试器/工具调用较慢或失联时拖垮 tokio worker 池，可能导致整个应用的其他异步命令（pty/fs）延迟。**修复方向**：给这两个 command 的请求-等待段套 `tauri::async_runtime::spawn_blocking`（对齐 `connect` 的写法）。

### P2-4 gateway 凭证文件存储：Unix 上为明文（仅 0700/0600 权限），DPAPI 仅 Windows

`persist_creds_to_file` 把平台凭证（token、webhook secret、app_secret 等）以 JSON 写入 `gateway-creds/<platform>.json`。Windows 用 DPAPI 加密，但 **Unix 上是明文**，仅靠 owner-only 权限保护。代码注释也直白承认「Unix 不加密，依赖 0700/0600」——在共享/备份/容器/root 场景下明文 token 可被读取。

【gateway/adapters/creds_encrypt.rs:12-23 证据】
```rust
pub fn encrypt(plain: &[u8]) -> Vec<u8> {
    #[cfg(target_os = "windows")] { dpapi::protect(plain) }
    #[cfg(not(target_os = "windows"))] { let _ = plain; plain.to_vec() }  // ← Unix 明文
}
```
【gateway/adapters/mod.rs:41-46 证据】注释：`At rest the file is encrypted with DPAPI on Windows ... and protected by owner-only 0700/0600 permissions on Unix`。

**说明**：这是「Windows keyring 不可靠时用文件兜底」的刻意设计（Linux 惯例也是明文 key 文件），非 P1 漏洞；但既然 gateway 已经接了 `secrets`（keychain），建议 Unix 也优先走系统 keyring（`libsecret`/`Keychain`），文件兜底仅作 fallback。

### P2-5 history：每次 `history_record` 都全量重写持久化文件

`history_record` 每次接受命令都会调 `write_persisted`，而后者把 `entries` 全量排序后整文件重写 `~/.yamet/history`。高频输入/agent 自动执行命令时产生无谓的磁盘写放大（无原子写、无节流）。

【history/mod.rs:64-78 证据】`write_persisted` 整文件 `std::fs::write`。
【history/mod.rs:216-239 证据】`history_record` 每次命中都 `sort_recent` + `write_persisted`。

**修复方向**：批量（例如缓冲 10s 或积累 N 条）再落盘；落盘用「tmp + rename」原子写。

### P2-6 mcp_server 对 `notifications/initialized`（无 id 通知）错误地回发一条 id=null 的响应

JSON-RPC 2.0 规范：**通知（无 id）绝不能收到响应**。但 `mcp_server` 的 `handle_request` 对 `ServerRequest::Initialized`（通知）返回一个 `JsonRpcResponse`，`run_server` 主循环对每个请求都统一 `serialize_response` 写出——于是对这条通知回发了一行 `{"id":null,"result":null}`。严格客户端会把「对通知的响应」判为协议违规。

【mcp_server/mod.rs:96-101 证据】
```rust
ServerRequest::Initialized => {
    JsonRpcResponse::success(serde_json::Value::Null, serde_json::json!(null))
}
```
【mcp_server/mod.rs:65-67 证据】`let response = handle_request(request, workdir); let line = serialize_response(&response);` —— 通知也被写响应。

**修复方向**：`handle_request` 返回 `Option<JsonRpcResponse>`，通知返回 `None`；`run_server` 仅对 `Some` 写行。

### P2-7 dap/lsp/mcp 会话线程采用「detach + 内存态」，进程退出清理依赖 RunEvent（低风险，但需知悉）

LSP 的 `memwatch`/`waiter`/`reader`/`stderr` 线程、DAP/MCP 的 reader 线程都是 `thread::Builder::spawn`（detach，不 join），会话状态存 Tauri managed `RwLock<HashMap>`（非 fresh-store-per-call，这点是好的）。清理只在 `RunEvent::Exit` 时 `kill_all`/`shutdown_all`（lib.rs:520-526）。正常路径没问题；但**若进程被强杀/崩溃**，这些子进程（LSP server、debug adapter、MCP server）会成孤儿。属平台级普遍现象，列 P2 供知悉。

【lib.rs:520-526 证据】Exit 时 kill lsp/mcp；DAP 会话的清理见 dap/session.rs `close_all`（模块内 state），但 lib.rs Exit 分支未显式调用 `DapSessionState::close_all`（仅 lsp/mcp）——DAP 会话在异常退出时可能残留 debug adapter 子进程。核对 lib.rs:516-526 可见 Exit 分支只处理了 `lsp::LspState` 与 `mcp::McpServerState`，**未处理 `dap::DapSessionState`**。

---

## 做得好的地方（值得保持）

- **锁中毒防护全面**：几乎所有 `Mutex`/`RwLock` 都用 `unwrap_or_else(|e| e.into_inner())`，仅少数 `.unwrap()`（如 dap/session.rs:227、mcp/transport.rs:245）集中在 reader 线程短暂持锁路径，风险可控。
- **分帧/上限规范**：LSP/DAP 共用的 `FrameDecoder` 有 64MiB Content-Length 上限、增量解析、UTF-8 校验（lsp/framing.rs:6,51-87），测试覆盖字节级切分/跨 chunk/坏头（framing.rs:129-242）；MCP LineReader 有 16MiB 行上限（mcp/transport.rs:41）；mcp_server 响应有 32MiB 截断（mcp_server/mod.rs:19,70）。
- **请求-响应配对正确（客户端侧）**：`DapSession`（dap/session.rs:144-165）与 `McpSession`（mcp/session.rs:308-324）都用自增 seq/id + `pending` map 配对，超时/失败会从 map 移除并 drain，无泄漏。
- **超时与子进程回收**：LSP 有 RSS 内存看门狗 + 默认 4GiB 预算 + 120s 启动宽限（lsp/session.rs:230-266）；git 所有命令带超时、kill、输出上限、auth 错误分类（git/process.rs:245-303,354-370）；git 丢弃/提交都先 `authorized_repo_root` 授权 + `pathspec_from_input` 路径校验（git/operations.rs:353-405）。
- **WSL 注入防护**：WSL 走 `wsl.exe -d <distro> --exec git`，distro 名过 `validate_wsl_distro_name`（git/process.rs:310-321）；LSP WSL root 解析每层 `wsl test -e` 无 shell 注入面（lsp/mod.rs:145-164）。
- **路径沙箱**：mcp_server 工具 `resolve_safe` canonicalize 后前缀校验，拒绝逃逸 + read_file 1MiB 上限（mcp_server/tools.rs:103-122）；fs 层同理。
- **凭证双写**：gateway 凭证写 OS keychain（`secrets_set`）+ DPAPI 文件兜底，重登 token 也即时落盘（gateway/commands.rs:19-38,247-277）；会话授权白名单持久化到 JSON，重启不丢（gateway/session.rs:88-137）。
- **命令面一致**：后端 `generate_handler!`（lib.rs:366-513）注册的 DAP/MCP/LSP/git/gateway/history 命令与前端 bridge（`@/platform` 的 `invoke<...>`）一一对应，未发现漂移；`dap_session_*`/`mcp_server_*` 前端封装齐全。
- **agent.rs 钩子注入工程质量高**：幂等 merge、原子写、foreign-file 拒绝覆盖、Windows CONOUT$ 路径统一，测试覆盖迁移/幂等/符号链接（agent.rs:232-287,346-554）。
