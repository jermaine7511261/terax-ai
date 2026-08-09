# 安全模型

本指南展开说明 `YAMET.md`。如有冲突，以 `YAMET.md` 为准。

YaMet 运行 shell、读写文件、向 AI 提供商发数据。安全模型是纵深防御：单层守卫不够，所以每个边界都在行动前校验输入。

## 边界

主要信任边界：

1. **IPC 边界**：注册在 `src-tauri/src/lib.rs` 的命令，经 `src-tauri/capabilities/default.json` 门控。
2. **文件系统边界**：AI 工具走 `src/modules/ai/lib/security.ts`；PTY spawn 走工作区授权注册表。
3. **网络边界**：`src-tauri/src/modules/net.rs` 的 AI HTTP 代理带 SSRF 与 DNS 重绑定防御。
4. **密钥存储边界**：密钥在 OS 钥匙串，绝不着盘或进 `localStorage`。
5. **终端转义序列边界**：OSC 序列被解析并执行动作，但绝不盲目信任来改状态。

## 密钥路径拒绝名单

`src/modules/ai/lib/security.ts` 拒绝明显密钥路径的读写。**读写两侧**都生效，绝不可绕过。

拦截类别包括：

- 文件：`.env*`、`*.pem`、`*.key`、`*.p12`、`id_rsa*`、`known_hosts`、`credentials`、`service-account*.json` 等。
- 目录：`~/.ssh`、`~/.gnupg`、`~/.aws`、`~/.kube`、`~/.config/gh`、`~/.git`、系统目录（`/etc`、`/proc`、`/sys`）与 Windows 凭据存储。
- 系统写前缀：`/etc/`、`/var/db/`、`/usr/bin/`、`/windows/`、`/program files/` 等。

比较面对路径做归一化：反斜杠转正斜杠、剥 Windows 盘符、剥 NTFS 备用数据流、剥尾点/空格、小写化、折叠重复斜杠。受保护目录按精确路径或后代匹配，而非裸子串。

`checkReadableCanonical` 与 `checkWritableCanonical` 还会规范化路径并复核解析后的形态，因此指向 `~/.ssh` 的无害路径上的符号链接也能被抓住。

## 工作区授权注册表

`WorkspaceRegistry`（`src-tauri/src/modules/workspace.rs:20`）跟踪 PTY spawn、git 命令与 AI 工具允许操作的目录。

- `workspace_authorize` 添加目录。
- `authorize_spawn_cwd` 拒绝授权根之外的 spawn cwd。
- `authorize_user_spawn_cwd` 把用户选择的 cwd 登记为新根，而非拒绝。
- 注册表以启动目录与用户 home 目录引导（`workspace.rs:135`）。

这是文件系统边界的允许侧。任何 spawn shell 或在当前工作区外变更文件的新功能都必须与此注册表交互。

## AI 工具审批流

在 `src/modules/ai/tools/tools.ts`：

- 只读工具（`read_file`、`list_directory`、`grep`、`glob`）过拒绝名单后自动执行。
- 变更工具（`write_file`、`edit`、`multi_edit`、`create_directory`、`run_command`、`shell_session_run`、`shell_bg_spawn`）置 `needsApproval: true`。AI SDK 暂停并渲染为确认卡。
- `edit` / `multi_edit` 强制先读后改不变量：模型必须在本会话早前读过该文件。

批准后自动发送用 `lastAssistantMessageIsCompleteWithApprovalResponses`。

## SSRF 与 DNS 重绑定防御

`src-tauri/src/modules/net.rs` 代理 AI 提供商请求与本地模型 ping。连接前：

1. 一次性解析主机名（`resolve_and_classify`）。
2. 把每个解析出的 IP 分类为公网、私网、loopback 或拦截的元数据。
3. 拦截云元数据端点（`169.254.169.254`、`metadata.google.internal`、AWS IPv6 元数据等）。
4. 把 reqwest 钉到已解析 IP，使第二次 DNS 查询无法返回不同地址（DNS 重绑定）。

本地 LLM 端点显式放行，因为用户主动把 YaMet 指向它们，但仍会被分类并记录日志。

## 密钥存储

API 密钥经 `secrets_*` 命令存储（`src-tauri/src/modules/secrets.rs`）：

- macOS：经 `keyring` 的钥匙串
- Windows：经 `keyring` 的凭据管理器
- Linux：应用本地数据目录里的 JSON 文件，权限 `0600`（原子写 `.tmp` 后 rename）

服务常量：`yamet-ai`。API 密钥绝不进 `localStorage`，绝不进日志。

例外：**IM 网关凭据**（`gateway:*`）在写入钥匙串之外，还会经 `persist_creds_to_file`
存到应用本地数据目录 `gateway-creds/<platform>.json`。这是有意的 file-backed 兜底
（Windows 凭据管理器可能不可用，文件存储跨重启更可靠）。静态加密策略：
- **Windows**：文件内容经 **DPAPI**（`CryptProtectData`/`CryptUnprotectData`）加密，
  绑定当前用户 + 机器，默认 ACL 下同机其它进程也无法读出明文。
- **Unix**：明文 JSON，但目录 `chmod 0700`、文件 `0600` 仅属主可读（Linux 密钥
  文件同此惯例）。
若该目录中的凭据已被攻破的渲染进程读到，见上文「密钥路径拒绝名单」的读侧守卫。

## OSC 信任门控

终端解析来自 PTY 字节流的 OSC 序列：

- **OSC 7** 更新标签 cwd。
- **OSC 133 A/B/C/D** 标记提示符/命令边界。
- **OSC 777** 供 agent 检测器发编码 agent 状态转换。

agent 检测器（`src-tauri/src/modules/pty/agent_detect.rs`）由 `OSC 133;C;<cmd>` 或自武装标记触发，发出 `yamet:agent-signal` 事件。它**只由 OSC 序列驱动**，绝不凭原始输出，重绘 TUI 不会抖动。

## 不变量

- `security.ts` 的拒绝名单在读写两侧都生效。绝不绕过。
- 触碰文件系统的新命令必须尊重工作区授权注册表。
- 面向网络的新命令必须走 `net.rs` 代理，或重实现同样的分类与 DNS 钉扎。
- 新插件 API 必须加到 `src-tauri/capabilities/default.json`。
- 密钥、token 与凭据留在钥匙串 / Linux 密钥文件。

## 参见

- [`YAMET.md`](../../YAMET.md)：架构事实来源
- [`docs/README.md`](../README.md)：贡献者指南索引
- [双进程模型](two-process-model.md)：IPC 边界与命令目录
- [AI 子系统](ai-subsystem.md)：工具、审批流与提供商处理
