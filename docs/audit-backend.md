# Yamet Rust 后端代码审查报告

- 审查对象：`E:/Agent/yamet/src-tauri/`（82 个 .rs，约 26K 行；Tauri 2，tokio，portable-pty，reqwest）
- 审查身份：资深后端 / Rust 工程师
- 日期：2026-08-06
- 审查角度：命令面完整性、安全模型执行、正确性与健壮性、死代码/空壳、测试覆盖、前端命令接线

> 所有关键结论均附 `file:line` 证据。`file` 均指 `src-tauri/src/...`，除非另有注明。

---

## ⏱ 修复状态（2026-08-06 全量修复后更新）

以下原报告发现已在「深度审查全量修复」中处理完毕，**旧结论仅作历史背景，勿据此误判安全基线**：

| 原发现 | 严重度 | 修复状态 | 修复提交 |
|---|---|---|---|
| P0-1 后端读面零门禁 | P0 | ✅ 已修复 | `e0acc9e`（`fs/policy.rs` 拒绝名单 + 6 读命令 `source` 门禁 + `native.ts` 读路径带 `source:"ai"`） |
| P0-3 helper PTY 绕过 cwd 授权 | P0 | ✅ 已修复 | `fec941b`（`pty_helper/client.rs` `pty_helper_open` 走 `user_spawn_cwd_or_home`） |
| P2-2 shutdown_helper 死代码 | P2 | ✅ 已修复 | `c891a01`（`lib.rs` `RunEvent::Exit` 调用） |
| pty_helper/protocol.rs `expect`（release abort 面） | 中低 | ✅ 已修复 | `b2d22d5`（8 处 `serde_json::to_vec(...).expect` → `Result`；现存 `expect` 均仅限 `#[cfg(test)]`） |
| pty/mod.rs 线程 spawn `expect` | 中低 | ✅ 已修复 | `b2d22d5`（3 处 → `if let Err` 记日志） |
| 死依赖 `@ai-sdk/{openai,anthropic,...}` | 低 | ✅ 已修复 | 此前轮次移除，仅剩两个活依赖（`openai-compatible`/`react`） |

| P0-2 gateway 凭据明文落盘 | P0 | ✅ 已修复 | `creds_encrypt.rs`（Windows DPAPI `CryptProtectData` + 旧明文降级，Unix 0700/0600）；`adapters/mod.rs` 加密读写；`security-model.md` 同步 |

---

## 一、安全模型执行：文档声明 vs 真实实现（核心发现）

### P0-1　后端"读面"完全无门禁，拒绝名单只在前端、读路径被完全绕过

【证据】
- 声明：`docs/architecture/security-model.md:19`「拒绝名单**读写两侧**都生效，绝不可绕过」；`:85`「security.ts 的拒绝名单在读写两侧都生效。绝不绕过。」；`YAMET.md` 同样宣称纵深防御。
- 实现（后端读命令，全部**没有**拒绝名单、**没有**工作区授权、**没有** source 区分）：
  - `modules/fs/file.rs:63-71` `fs_read_file` → `read_file_sync`，无任何守卫；`fs_stat`(:216)、`fs_canonicalize`(:205) 同理。
  - `modules/fs/search.rs:47-54` `fs_search(root, query, …)` 直接以 `root` 为根扫描；`modules/fs/grep.rs` `fs_grep`、`fs_glob` 同理。
  - `modules/fs/tree.rs` `fs_read_dir` / `fs_list_files` 同理。
- 拒绝名单实际只存在于前端 `src/modules/ai/lib/security.ts`（`checkReadableCanonical`/`checkWritableCanonical`）。
- 关键接线：AI 读文件工具 `src/modules/ai/tools/fs.ts:48-54` 先过 `checkReadableCanonical` 再 `native.readFile(abs)`；而 `src/modules/ai/lib/native.ts:174-178` 的 `readFile` 调用 `fs_read_file` 时**不带任何 source / 授权标记**（对比 `writeFile` 带 `source:"ai"`，native.ts:179-185）。
- 架构根因：Tauri 2 中自定义 `#[tauri::command]` 经 `invoke_handler` 注册，**不受 `capabilities/*.json` 门控**（`capabilities/default.json` 只授权 core/插件命令）。因此主窗口 WebView 内任何 JS 都能直接 `invoke("fs_read_file", {path:"~/.ssh/id_rsa"})`，绕过整套拒绝名单与工作区注册表。

【现状】文档承诺的"读侧拒绝名单 + 纵深防御"实际**只有前端一层**；后端读命令是裸的任意文件读。

【问题/风险】这是整个安全模型里最不匹配的点：
- 一旦渲染进程被 XSS / 事件载荷 / 第三方依赖攻破（gateway 会把外部 IM 消息交给前端驱动 agent，见 `lib.rs:276-278`），攻击者可无声读取 `~/.ssh/id_rsa`、`.env*`、`/etc/passwd`、以及下文 P0-3 的明文 gateway 凭据文件。
- 写侧虽然后端用 `source=="ai"` 做了工作区授权门禁，但**读侧零门禁**，与"读写两侧"的承诺直接矛盾。

【改进建议】
1. 在 `fs_read_file`/`fs_stat`/`fs_search`/`fs_grep`/`fs_glob`/`fs_read_dir`/`fs_list_files`/`fs_canonicalize` 后端入口统一加一道权威守卫（拒绝名单 + 工作区授权），把前端 `security.ts` 的判定逻辑（路径归一化、保护目录/前缀、basename 模式）下沉/镜像到 Rust。
2. 读路径也引入 `source`（`editor` / `ai`）概念：`ai` 源强制工作区授权 + 拒绝名单；这样即使前端被绕过，后端仍守得住。
3. 若短期无法全量下沉，至少在文档中如实降级声明（不要写"绝不可绕过"），并为核心读命令加单元测试锁定行为。

---

### P0-2　gateway 凭据明文落盘，直接违反"密钥绝不着盘"契约

【证据】
- 声明：`modules/gateway/commands.rs:12-14`（`gateway_configure` 注释）「persists the credentials to the OS keychain … **without touching disk**」；`security-model.md:71`「密钥除钥匙串 / Linux 密钥文件外**绝不着盘**」。
- 实现：`gateway_configure`（commands.rs:16-35）在 `secrets_set`（钥匙串）之后立即调用 `super::adapters::persist_creds_to_file(&app, id, &config_json)`。
- `modules/gateway/adapters/mod.rs:40-46` `persist_creds_to_file`：`std::fs::write(creds_file(...), config_json)`，其中 `creds_file` = `app_local_data_dir/gateway-creds/<platform>.json`（明文，无权限加固）。
- `restore_from_keychain`（adapters/mod.rs:100-120）实际**只从明文文件读**（`read_creds_from_file`），注释却写「credentials never touch disk unencrypted」（:97-99）。

【现状】微信/钉钉/飞书/企微等平台的 bot token、base_url 以明文 JSON 存在数据目录；重启恢复也依赖这份明文，钥匙串写入形同虚设。

【问题/风险】配合 P0-1（后端读面无门禁），一个被攻破的渲染进程即可把这些明文凭据直接读走。与文档承诺严重不符，是"密钥绝不落盘"不变量的事实性违约。

【改进建议】去掉 `persist_creds_to_file` 明文兜底，或改为 OS 级加密（Windows DPAPI / macOS Keychain / Linux 走密钥环并失败降级但不明文）。至少把 `restore_from_keychain` 真正从钥匙串恢复，并给 `gateway-creds` 目录加权限（0600/0700）。同步修正三处误导性注释。

---

### P0-3　默认 PTY 路径（分离 helper）绕过 cwd 工作区授权

【证据】
- 门禁路径：`modules/pty/mod.rs:59` `pty_open` 先 `user_spawn_cwd_or_home(&registry, cwd, …)` 做工作区授权登记。
- 绕过路径：`modules/pty_helper/client.rs:174-221` `pty_helper_open` 把 `cwd` **原样**塞进 `OpenReq` 转发给 helper，全程不碰 `WorkspaceRegistry`；helper 进程内 `server.rs:290` `session::spawn_with_sink(…, req.cwd, …)` 直接 spawn，helper 没有注册表可查。
- 前端默认走 helper：`src/modules/terminal/lib/pty-bridge.ts:30-32` `openPty` 无 SSH 时**先**尝试 `openPtyViaHelper`（即 `pty_helper_open`），失败才回退 in-process。
- 文档：`security-model.md:36`「`authorize_spawn_cwd` 拒绝授权根之外的 spawn cwd」、`:40`「任何 spawn shell … 都必须与此注册表交互」。

【现状】文档承诺的"PTY spawn 必须过工作区授权注册表"在**默认路径（helper）上不生效**：渲染进程可对任意 cwd 起 shell。

【问题/风险】cwd 授权本意是约束 AI/shell 的工作目录边界；helper 路径让这个边界形同虚设。注意该 helper 只有主进程经 token 转发，所以"攻击面"仍是渲染进程，但这是文档不变量的一条真实旁路。

【改进建议】在 `pty_helper_open`（主进程侧，client.rs）对 `cwd` 走与 `pty_open` 相同的 `user_spawn_cwd_or_home` 门禁，再把已校验的 cwd 下发；或让 helper 每次 `Open` 由主进程代为判定。补一个"helper 打开路径同样拒绝工作区外 cwd"的测试。

---

## 二、命令面完整性

- 所有 `lib.rs:366-511` `generate_handler!` 中注册的命令均有对应实现，未发现"只注册未实现/空壳"的命令。
- 内部自调用命令（前端不直接调用、由 Rust 侧调用）：
  - `pty_helper_start`：注册于 `lib.rs:382`，前端从不 invoke；实际由 `client.rs:56` `ensure_client` 内部调用（`super::pty_helper_start()`）。**非死命令**，属正常 Rust↔Rust 命令。
- 前端确实 invoke 的命令核对（`native.ts` / `pty-bridge.ts` / `proxyFetch.ts` / `scheduler.ts` / `lsp/transport.ts` / `dap/lib/api.ts` 等）与后端命令面基本对齐。
- 以下命令需复核是否仍有前端调用方（本审查未见直接 invoke，仅个别在 `.test.ts` 中出现）：
  - `scheduler_toggle`（见 `scheduler_upsert` 在 `ai/lib/scheduler.ts:35`，`scheduler_list` 在 :31，但 `toggle` 未见生产调用）。
  - `pty_helper_list`（`client.rs:299`）前端未见直接 invoke。
  - `mcp_*`、`dap_*`、`lsp_*` 属 AI 子系统内部透传，归属正常。
- 结论：命令面完整，无空壳；极少数命令疑似无前端生产调用（P2，建议加死代码检查或文档标注）。

---

## 三、正确性与健壮性

### 3.1 unwrap / expect 滥用（非测试路径）
- 非测试路径 `.unwrap()` / `.expect(` 共 **46 处**（脚本统计，已剔除 `#[cfg(test)]` / `mod tests` 块）。重点：
  - `modules/pty_helper/protocol.rs:143-167` `encode()` 内 8 处 `serde_json::to_vec(...).expect("json")`——对固定结构体编码几乎不会失败，但这是**编码即 panic** 的写法，且 `Cargo.toml:131` release 用 `panic = "abort"`，任何一次触发即整进程 abort。
  - `modules/pty/mod.rs:89,189,293` `.expect("spawn pty drop thread")`——线程 spawn 失败即 panic。
  - `modules/pty/session.rs` 非测试 1 unwrap + 4 expect。
  - `modules/agent.rs` 非测试 5 处 `unwrap`：均在 `merge_hooks` 内对刚构造的 JSON 对象 `as_object_mut().unwrap()`（agent.rs:170,175,182），实际安全但集中。
  - `modules/gateway/crypto.rs`、`gateway/adapters/*`（dingtalk 2 expect、weixin 3 expect）：多为解析自身产出的数据。
- 正面：绝大多数共享锁都用 `unwrap_or_else(|e| e.into_inner())` 抗中毒（workspace.rs:28,34、pty/mod.rs:37 等），未在锁上用裸 unwrap，值得肯定。

【风险】release `panic=abort` + 若干 IPC 可触达的 expect：一旦某个 `serde_json::to_vec` 因未来给 struct 加入不可序列化字段而失败，或线程 spawn 失败，会直接杀掉整个应用。多为低概率，但建议把协议编码 `expect` 改为 `?`/`Result`，把线程 spawn 改为 `if let Err` 记日志。

### 3.2 并发共享状态 / 死锁风险
- 大部分状态用 `RwLock`/`Mutex` 且短临界区，未发现明显的持锁跨 await 或持锁顺序不一致导致的死锁。
- `modules/secrets.rs:98-108`（Linux）`with_store` 持 `cache` 锁在锁内做 `read_store`（磁盘 I/O），且 `secrets_set`（:150-158）在锁内修改后再**二次加锁**做 snapshot 写盘。锁内磁盘 I/O + 二段式加锁存在小竞态窗口，并发 `secrets_set` 在极端时序下可能互相覆盖快照（低风险，建议复核，可用单写者队列消除）。
- `modules/shell/mod.rs:125-131` drain 线程 `join` 在 `run_blocking` 内等待：命令有 timeout kill（:134-149），kill 后管道 EOF，join 一般能返回；但若 drain 线程因 `read` 阻塞而 kill 未及时回收进程，`join` 会阻塞工作线程（非主线程，影响有限）。

### 3.3 超时 / 资源释放
- 超时处理整体到位：shell 命令 `clamp(1,300s)`（shell/mod.rs:63-67）+ 进程组 kill；`ai_http_request` 60s connect/send + 120s body 上限（net.rs:366-381）；响应 64 MiB 硬上限（net.rs:320-345）。
- 退出清理不完整：`lib.rs:518-527` 在 `RunEvent::Exit` 只 kill LSP、shutdown MCP、close DAP；**没有调用 `pty_helper::client::shutdown_helper`**（该函数已定义，`client.rs:315`，且 `mod.rs:20` 已 re-export，但**全仓无任何调用点**）。结果：应用退出后分离 helper 进程会残留，靠孤儿 reaper（`server.rs:35` `ORPHAN_TIMEOUT=10min`）在 10 分钟后才被清理。→ 资源泄漏 + 死代码（见 P2-2）。

---

## 四、死代码 / 空壳

- `#[allow(dead_code)]` 共 9 处，集中在 `gateway/adapters/{dingtalk,official_account,qq,weixin}.rs` 与 `shell/session.rs`。这些多为 adapter trait 实现里暂时未使用的辅助方法；可接受但建议清理或加 `#[allow]` 说明。
- **`pty_helper::client::shutdown_helper`（client.rs:315）从未被调用** —— 纯死代码，且它承载的"优雅退出 helper"目标未达成（见 3.3）。
- 未发现 `todo!()` / `unimplemented!()` / 明显占位实现。`pty_helper` 的 `ssh` 支持明确返回 `Error{ "not supported yet" }`（server.rs:275-281），是显式未实现而非静默空壳，可接受。

---

## 五、测试覆盖

- 全仓约 **376** 个测试构造（`#[test]`/`proptest!`/`#[cfg(test)]`），覆盖良好。
- 核心不变量测试情况：
  - **拒绝名单**：前端 `src/modules/ai/lib/security.test.ts`（含 `checkReadableCanonical` 符号链接二次校验）。**后端无对应测试**（后端本就没有该逻辑，见 P0-1）。
  - **工作区授权**：`fs/file.rs:384-432` `ai_write_authorization_allows_inside_workspace_and_blocks_outside` 与 `non_ai_writes_are_not_gated`；`workspace.rs` 30 个测试。但**没有**"helper PTY 打开路径拒绝工作区外 cwd"的测试（见 P0-3）。
  - **gateway 认证门禁**：`gateway/session.rs` 有 2 个测试；授权/撤销/自动批准逻辑有 `registry.rs` 3 个测试，但对"明文落盘"无守卫测试（见 P0-2）。
  - **SSRF 守卫**：`net.rs` 9 个测试（IPv4/IPv6 元数据、link-local、`::ffff:` 映射、私网分类等），质量高。**缺**"DNS 重绑定/redirect 跨 host" 的集成测试。
  - **PTY spawn 锁 / shell 超时**：`shell/mod.rs:396-433` 覆盖 stdout/超时/截断/进程组；`pty/agent_detect.rs` 19 个、`da_filter.rs` 23 个。
- 结论：测试覆盖面显著高于一般项目；**缺口正好集中在本文档安全发现对应的不变量**（后端读拒绝名单、helper cwd 门禁、明文凭据）。

---

## 六、与前端命令接线

- `native.ts` 封装的写/执行命令普遍带 `source:"ai"`（writeFile/createFile/createDir/renameFile/deleteFile，native.ts:179-215），后端写侧门禁能触发——**写侧纵深有效**。
- `native.ts` 读命令（readFile/readDir/grep/glob，native.ts:174,218,224,239）**不带 source**，后端读侧无门禁（见 P0-1）。前端依赖 `tools/fs.ts:50` / `tools/search.ts` 的 `checkReadableCanonical` 先行拦截；这套"前端先查、后端裸跑"的格局正是 P0-1 的由来。
- `pty-bridge.ts` 默认 helper 路径（:30-32）→ P0-3 的默认绕过。
- 结论：前端→后端命令名基本对齐，无大规模接线漂移；主要问题仍是后端读侧缺权威守卫。

---

## 七、优先级排序问题清单

### P0（安全 / 数据完整）
1. **后端读面无门禁**：`fs_read_file/fs_stat/fs_search/fs_grep/fs_glob/fs_read_dir` 等可被渲染进程直接 invoke 读任意文件（含密钥），拒绝名单仅前端实现，与文档"读写两侧、绝不可绕过"不符。`fs/file.rs:63`、`fs/search.rs:47`、`native.ts:174`、`security-model.md:19`。
2. **gateway 凭据明文落盘**：`gateway-creds/<platform>.json` 明文存微信/钉钉等 token，`restore_from_keychain` 只读明文文件，违反"密钥绝不着盘"。`adapters/mod.rs:40-46,100-120`、`commands.rs:12-35`、`security-model.md:71`。
3. **默认 PTY 路径绕过 cwd 工作区授权**：`pty_helper_open` 不校验 cwd 直接转发，helper 无注册表。`pty_helper/client.rs:174-221`、`pty/mod.rs:59`、`pty-bridge.ts:30-32`、`security-model.md:36`。

### P1（正确性）
4. **release `panic=abort` + 协议/线程 spawn 的 expect 面**：`pty_helper/protocol.rs:143-167`（8 处 encode expect）、`pty/mod.rs:89,189,293`。建议改 `Result`/记日志。
5. **`secrets.rs`（Linux）二段式加锁 + 锁内磁盘 I/O** 存在并发写快照竞态窗口，建议单写者队列。`secrets.rs:98-108,150-158`。

### P2（结构 / 健壮性）
6. **`shutdown_helper` 死代码 + helper 退出不清理**：应用退出后 helper 残留最多 10 分钟。`client.rs:315`、`lib.rs:518-527`（Exit 处理遗漏）。
7. **`net.rs` redirect 到新 hostname 未做 DNS pin**（仅 `!allow_private` 时拦截跨 host 重定向）；建议补跨 host 重定向的 pin/测试。
8. **`~/.yamet/pty-helper.json`（token+port）默认权限明文**；`gateway-creds/` 目录无权限加固。
9. **疑似无前端生产调用的命令**：`scheduler_toggle`、`pty_helper_list` 等，建议死命令审计或文档标注。
10. **`gateway_sessions` 把 session_key + 授权状态打进日志**（`commands.rs:61-73`），建议降噪或去敏感字段。
11. **`#[allow(dead_code)]` 9 处**集中在 gateway adapters 与 `shell/session.rs`，建议清理或注明原因。

---

## 八、做得好的地方

- **SSRF / DNS 重绑定防御实现扎实**（`net.rs`）：一次性解析并分类 IP（含 `::ffff:` IPv4 映射、`fd00:ec2::254` AWS IPv6 元数据、link-local），用 `resolve_to_addrs` 把 reqwest 钉到已校验 IP，redirect 策略 + 主机名校验 + 64MiB 上限 + header 黑名单/CRLF 校验，测试充分。这块是全仓安全质量最高的部分。
- **工作区授权注册表设计清晰**：`git` 全部命令都经 `canonical_dir` + `registry.is_authorized`（`git/operations.rs:23-31,92-100`），写路径有 `enforce_ai_workspace_authorization` 兜底。
- **AI 写路径双重门禁**：前端 `checkWritableCanonical` + 后端 `source=="ai"` 工作区授权，且有正/反向测试（`fs/file.rs:384-432`）。
- **原子写防 symlink**：`write_atomic` 用 `O_EXCL` tempfile + `persist` + 权限保留（`fs/file.rs:151-160`），并有"预置 symlink 不被写穿"的测试（`fs/file.rs:365-381`）。
- **锁中毒处理一致且稳健**：全仓共享锁普遍 `unwrap_or_else(|e| e.into_inner())`，无裸 lock unwrap。
- **分离 PTY helper 进程模型**：loopback + 随机端口 + token 握手认证 + 单客户端准入 + 环形缓冲回放 + 孤儿 reaper，设计成熟。
- **测试覆盖优秀**：约 376 个测试构造，PTY 检测器（19+23）、net SSRF（9）、workspace（30）、shell 超时/进程组、secrets Linux 0600/原子写等核心路径都有测试。
- **IPC 性能优化到位**：`pty_write` 用 raw body + `x-pty-id` header 规避每键 JSON 编码（`pty/mod.rs:98-111`）；写侧前端自动分块 32KiB 防卡顿（`pty-bridge.ts:193-210`）。
- **超时/资源上限全面**：shell 命令 `clamp(1,300)` + 进程组 kill，网络请求多重超时与响应上限。
- **WSL 分发包名 / 路径强校验**：`is_safe_distro_name`、`validate_wsl_distro_name`、UNC 路径遍历防护（`workspace.rs:349-418`）。

---

*审查工具与方法：`search_files`（ripgrep）+ Python 脚本统计；`git-bash` 的 grep 因 target/ 卡顿而按要求规避。个别断言（如 `scheduler_toggle` 无生产调用）基于静态检索，建议以 `cargo test` + 前端构建产物复核确认。*
