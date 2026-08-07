# yamet Rust 后端核心子系统深度审计报告

> 审计范围：terminal/PTY/pty_helper/shell/ssh/process/scheduler/net + fs + workspace + secrets。
> 仅审计，未修改任何文件。证据均以【文件:行号】标注，全部经核实（非猜测）。
> 说明：yamet 是单用户桌面终端应用，AI 层本身拥有 shell 执行权限（`shell_run_command`），因此下述多数"AI 文件门"问题属于**纵深防御**层面的设计失效，而非全新的泄露面；严重性已按此语境校准。

---

## 优先级 P0（安全 / 数据丢失 / 不可用）

未发现无可争议的 P0 级缺陷。核心 PTY 生命周期、ConPTY 锁、进程树回收（Job Object / process group / SIGKILL 组）、SSRF 防护（DNS 固定 + 元数据 IP 封禁 + 重定向策略）、ssh/sftp 参数注入清洗、secrets 平台后端、原子写等均实现扎实、有单测覆盖。

---

## 优先级 P1（安全 / 功能缺口）

### P1-1　pty-helper 认证令牌文件权限过宽，可导致终端劫持
- 【`src-tauri/src/modules/pty_helper/server.rs:128-136`】`write_state` 用 `std::fs::write` 写 `~/.yamet/pty-helper.json`，未设置权限位（Linux 默认 umask 022 → 0644，世界可读）。文件内明文存放 `{ port, token }`。
- 【`server.rs:200-218`】该 token 是 helper 唯一认证凭据：`handle_connection` 只校验首帧 token 即放行，此后可发送 `Frame::Write`（向用户活动 PTY 注入按键）、`Frame::Kill`、`Frame::Open`。
- helper 虽绑定 `127.0.0.1`，但在多用户 Linux 上，任何能读 `~/.yamet/pty-helper.json` 的本地进程/用户均可连接并认证，进而向用户 shell 注入按键（如截获/篡改 `sudo` 密码输入）或杀掉其进程。**终端输入注入，影响面高。**
- 建议：`write_state` 用 `OpenOptionsExt::mode(0o600)`；或把 token 存入平台 secrets（复用 secrets 模块）。

### P1-2　`fs_copy` 是唯一未接 AI 源门/未跑敏感清单的变更命令
- 【`src-tauri/src/modules/fs/mutate.rs:163-189`】`fs_copy` 签名无 `source` 参数，从不调用 `enforce_ai_workspace_authorization`（fs/mod.rs:20），也从未对**源路径**执行 `policy::check_readable`。对比同文件其它变更命令（`fs_create_file`/`fs_create_dir`/`fs_rename`/`fs_delete` 均在第 27/57/97-105/139 行接门）。
- 结果：任何调用方可把**任意绝对路径**（如 `~/.bashrc`、浏览器 cookie、`.git-credentials`、任何不在敏感 basename 清单上的文件）复制进已授权工作区，绕过秘密清单与工作区边界。当前前端仅在拖放路径调用（`src/modules/explorer/lib/useExplorerFileDrop.ts:72`），故为纵深防御缺口而非活跃泄露向量；但若未来 AI 工具层暴露该命令即成为绕过点。
- 建议：给 `fs_copy` 增加 `source` 参数，源路径跑 `check_read_path_authorized`。

### P1-3　AI 文件安全模型边界"形同虚设"：home 恒被授权 + `source` 客户端可控
- 【`src-tauri/src/modules/workspace.rs:133-138`】`bootstrap_registry` 无条件 `authorize(home)` 与 launch dir；【`workspace.rs:33-36`】`is_authorized` 是前缀匹配。
- 因此 `enforce_ai_workspace_authorization`（fs/mod.rs:44）与 `check_read_path_authorized`（fs/policy.rs:208-217）对**用户 home 下任意路径**（多数用户的全部可写空间）都放行——工作区边界对绝大多数用户不构成额外保护，实际防线只剩秘密 basename 清单。
- 【fs/file.rs:68、fs/mutate.rs:19、fs/tree.rs:71 等】所有 AI 门均以 `source == "ai"` 触发，而 `source` 由前端传入且无签名/来源校验。任何能 invoke IPC 的代码（被攻陷的渲染进程、未来暴露给 MCP/agent 的命令面）传 `source: null` 或 `"editor"` 即可整体绕过后端全部 fs 限制。代码注释将其标为"authoritative"言过其实。
- 鉴于 AI 已有 shell 权限，此为纵深防御失效而非新泄露面，但**与文档承诺不符**，且当未来出现无 shell 的受限 agent 工具面时将成为实缺口。建议：至少去掉无条件 home 授权（仅授权显式 launch dir），并将 `source` 改为后端无法伪造的传递通道。

### P1-4　`next_trigger` 在持写锁下做最长 5 年逐分钟扫描（可放大）
- 【`src-tauri/src/modules/scheduler/cron.rs:109-125`】不可满足的表达式（如 `0 0 30 2 *` 二月三十）会扫描 ~2.6M 次；【`scheduler/mod.rs:76-107`】`tick()` 在持 `tasks.write()` 锁时对每个任务调用它，而 tick 线程每 30s 执行一次（lib.rs:334-341）。
- 单次约几十毫秒不致命，但多个坏表达式或大任务集叠加会阻塞 `scheduler_upsert/list/delete/toggle`（均需同一写/读锁）。属放大风险，非 P0。建议把 `next_trigger` 挪到锁外或加迭代上限。

---

## 优先级 P2（打磨 / 性能 / 资源 / 死代码）

### P2-1　后台进程条目永不回收 → 无界内存增长（真实资源泄漏）
- 【`src-tauri/src/modules/shell/mod.rs:263`】`bg` map 只在 `shell_bg_spawn` 写入；【`mod.rs:283-288`】`shell_bg_kill` 只 kill 不 `remove`；【`mod.rs:291-299`】`shell_bg_list` 仅过滤展示不清理。全仓库无任何 `bg.remove` 路径（已核实）。
- 每个 `BackgroundProc` 持有 4 MiB 环形缓冲（background.rs:14 `RING_CAP`）。长会话内反复启停/自然退出后台任务将无限累积条目与缓冲。建议在 wait 线程置 `exited` 后由 list/kill 主动移除，或引入 LRU 上限。

### P2-2　pty-helper 重连 id 种子用固定 200ms 休眠，存在撞 id 杀会话竞态
- 【`src-tauri/src/modules/pty_helper/client.rs:147-156`】`connect()` 发 `List` 后固定 `sleep(200ms)` 再读 `client.sessions` 求 `max` 作为 `next_id` 种子。
- 若 helper 已有较多会话、`SessionList` 帧未在 200ms 内到达，id 低估 → 下次 `pty_helper_open` 分配 id 撞上现存会话，【`server.rs:313-317`】会 **kill 该旧会话** 腾位。重连+大负载下可致现存 PTY 意外退出。建议改为阻塞等 `SessionList` 或由服务端回传确认。

### P2-3　`fs_rename` Unix 覆盖竞态（数据丢失）
- 【`src-tauri/src/modules/fs/mutate.rs:65-80`】先 `to_p.exists()` 预检，再 `std::fs::rename`；Unix 的 `rename(2)` 会**静默覆盖**已存在目标。预检与 rename 之间存在 TOCTOU 窗口（并发写同一目标时丢数据）。Windows 上 `rename` 目标存在会报错，安全。建议 Unix 上用 `renameat2(RENAME_NOREPLACE)` 或 `hard_link`+`unlink` 组合保证不覆盖。

### P2-4　`sftp_read` 在 cap 检查前整体读入内存（OOM 风险）
- 【`src-tauri/src/modules/ssh/sftp.rs:184-188`】`std::fs::read_to_string(&local)` 先整体读入再判 `content.len() > READ_BYTE_CAP`。预检靠 `ls -la` 解析文件大小（161-165），若某文件 ls 行格式异常（特殊权限位等）导致 size 解析为 0，则绕过预检，巨型远程文件会整体读入内存。建议用 `File::metadata`/分块读并在读时计数。

### P2-5　`shell_run_command` / `shell_session_run` 无并发上限地起线程
- 【`src-tauri/src/modules/shell/mod.rs:71-76、238-242`】每次调用 spawn 1~3 个 OS 线程，无信号量/池。AI 并行发多个工具调用可耗尽线程资源（DoS）。建议加并发信号量（如 `Arc<Semaphore>`）。

### P2-6　pty-helper 状态文件路径硬编码 `~/.yamet`
- 【`src-tauri/src/modules/pty_helper/server.rs:115-120`】`state_file_path` 用 `dirs::home_dir()`，未走 Tauri `app_local_data_dir`（与 secrets/scheduler 的持久化位置不一致）。与 P1-1 权限问题相关，建议统一并收紧权限。

### P2-7　ssh/sftp 身份文件路径含空格被拒（功能缺口）
- 【`src-tauri/src/modules/ssh/target.rs:23-38`】`clean_component` 拒绝空白，`identity_file` 经其校验后用于 `-i`（target.rs:63-67；sftp.rs:64-67）。Windows 常见路径 `C:\Users\John Doe\.ssh\id_ed25519` 因此无法连接。建议对身份文件仅拒空/控制字符/前导 `-`，保留空格。

### P2-8　死命令面：`pty_helper_list` 注册但无人调用
- 【`src-tauri/src/lib.rs:372`】`pty_helper::client::pty_helper_list` 注册进 `generate_handler`，但前端（全量扫描 src/ 无命中）与后端（仅 client.rs 定义、mod.rs re-export、lib.rs 注册）均无调用方。为纯死表面。
- 【`lib.rs:384`】`pty_helper_start` 亦被注册进 IPC，但实际只被内部 `ensure_client`（client.rs:60）以 Rust 函数方式调用，前端从不 invoke——冗余 IPC 暴露（虽无害）。建议移除 `pty_helper_start`/`pty_helper_list` 的 `generate_handler` 注册。

### P2-9　`fs_write_file` 无写入字节上限
- 【`src-tauri/src/modules/fs/file.rs:197-238`】`content: String` 无大小限制即落盘。`force` 仅作用于读上限，写路径无 cap。恶意/异常调用可一次写出超大文件。建议加 `MAX_WRITE_BYTES`。

### P2-10　`fs_watch` 线程生命周期依赖进程退出
- 【`src-tauri/src/modules/fs/watch.rs:137-170`】`drain_loop` 线程仅在 channel 断开（watcher drop）时退出；`FsWatchState` 持有 watcher 至进程退出，无显式 shutdown 路径（reload 场景下旧 watcher 与线程随旧状态 GC 才释放）。功能上可接受，但资源在长会话内无法主动回收。

---

## 做得好（done well）

- **PTY 生命周期严谨**：Session 字段按 Drop 顺序排布（session.rs:75-100），Windows Job Object + ConPTY 生命周期全局锁（session.rs:113-122）+ 5s openpty 超时（session.rs:190-202）+ 分离 drop 线程避免阻塞 IPC，均处理得当。
- **子进程回收完备**：`shell_run_command` 超时对 Unix 用 `kill(-pgid, SIGKILL)`、对 Windows 用 Job Object `KILL_ON_JOB_CLOSE`（shell/mod.rs:134-150），后台进程 Drop 即 kill 整树（background.rs:66-107）。
- **SSRF 防护教科书级**：DNS 固定 resolve_to_addrs 防 rebinding、云元数据 IP（169.254.169.254 / fd00:ec2::254）封禁、IPv4-mapped IPv6 处理、重定向策略逐跳校验、header blocklist + CRLF 注入拦截（net.rs:12-197, 253-308）。
- **ssh/sftp 参数注入防线统一**：`clean_component` 拒前导 `-`/空白/控制字符，路径全部 argv 直传不经 shell（target.rs、sftp.rs、tunnels.rs），并有对应单测。
- **AI fs 策略归一化深入**：NTFS ADS/尾点尾空格/盘符前缀/verbatim 前缀在 `comparison_form` 中统一剥离，敏感 basename 与受保护目录清单较全（fs/policy.rs）。
- **secrets 后端合理**：macOS/Windows 走系统凭据库，Linux 回退 0600 明文文件并加锁持久化（secrets.rs:68-130），原子写 + fsync。
- **工作区路径规范化**：WSL 路径 UNC/驱动盘转换、distro 名校验防 `..` 逃逸（workspace.rs:349-426）。
- **并发锁均用 `into_inner` 抗中毒**，无跨 await 持锁，未发现裸 `unwrap()` 出现在 IPC 可达路径。
