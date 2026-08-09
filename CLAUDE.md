# CLAUDE.md

YaMet 的 AI 编码约定。改动前先读 `YAMET.md`（活架构文档）。

---

## 铁律（违反即回滚）

1. **AI 本有 shell 权限**：security.ts / policy.rs 是纵深防御层，不是唯一防线。禁止以此为由放行任何危险操作。
2. **密钥不经 webview**：keyring 解析在 Rust 侧，前端只传 account 名。
3. **无 XSS**：全仓 `dangerouslySetInnerHTML` = 0。
4. **前端不直连 `@tauri-apps/*`**：一律走 `@/platform` 适配器层（16 接口）。
5. **只用 pnpm**。
6. **禁 em-dash / 禁 emoji**：代码、注释、提交、文档。
7. **原生铁律**：DAP/MCP/PTY/LSP/Skill 宿主/传输/UI 层必须 Rust 原生，禁止 Node/Python 常驻桥接。

---

## DTO 边界

### 传入（前端 → Rust）

```rust
// 正确：类型安全的 serde 结构
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellRunParams {
    pub command: String,
    pub cwd: Option<String>,
    pub env: Option<Vec<(String, String)>>,
    pub timeout_secs: Option<u64>,
}

// 错误：裸 Value（安全关键命令除外如 dap_request_send 透传）
pub fn bad_command(params: serde_json::Value) -> Result<(), String> { ... }
```

### 返回（Rust → 前端）

```rust
// 正确：结构化返回
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResponse {
    pub hits: Vec<GrepHit>,
    pub truncated: bool,
    pub next_offset: Option<usize>,
}

// 错误：裸 String 表示结构化数据
pub fn bad_response() -> Result<String, String> { ... }
```

### 前端 DTO 同步

Rust DTO 的 serde `rename_all = "camelCase"` 会自动映射到 TS 侧同名字段。新增 DTO 时：

1. Rust 侧 `types.rs` 定义结构体
2. `native.ts` 顶部声明对应的 `export type XxxYyy = { ... }`
3. `native` 对象内加 `invoke<XxxYyy>("command_name", { ... })`

---

## 映射规则速查

| Rust 类型 | TS 类型 | JSON 形式 | 示例 |
|---|---|---|---|
| `Option<T>` | `T \| null` | `null` 或省略 | `{ cwd: null }` |
| `Vec<T>` | `T[]` | JSON 数组 | `{ hits: [...] }` |
| `HashMap<K,V>` | `Record<K,V>` | JSON 对象 | `{ metadata: {} }` |
| `enum A { B, C(u32) }` | `"b" \| { kind: "c"; value: number }` | tagged enum | `{ kind: "failed", message: "..." }` |
| `u64` (时间戳) | `number` | 毫秒数 | `{ createdAt: 1690000000000 }` |
| `bool` | `boolean` | `true`/`false` | `{ enabled: true }` |

### 枚举标签格式

```rust
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AgentState {
    Created,              // → "created"
    Running,              // → "running"
    Failed(String),       // → { "kind": "failed", "value": "boom" }
}

// TS 侧
type AgentStateKind =
  | "created" | "running" | "idle" | "paused" | "stopped"
  | { kind: "failed"; message: string };
```

---

## 验证门禁（每改动必过）

### 后端

```bash
cd src-tauri
cargo clippy --all-targets --locked -- -D warnings    # 零 warning
cargo nextest run --locked                            # 全绿
# 或回退：cargo test --locked
```

### 前端

```bash
pnpm check-types   # tsc --noEmit，零错误
pnpm lint          # biome lint，零 error
pnpm test          # vitest run，全绿
```

### 全局

```bash
pnpm check-drift   # 命令面/模块布局/原生铁律一致性
pnpm size          # 体积预算（eager ≤540KB，total ≤1.6MB）
```

### CI 四级链路（防死代码）

```
级 1：Rust #[tauri::command] 存在
级 2：lib.rs generate_handler! 注册
级 3：native.ts invoke 封装存在
级 4：前端组件实际 import 并调用（非仅存在）
```

级 4 为空的封装 = 死代码，必须接线或删除。

---

## 回复格式规范

### 工具执行结果

```typescript
// 成功
{ ok: true, path: "/src/main.rs", bytesWritten: 123 }

// 失败 — 必须带 user-friendly 提示
{
  error: "old_string not found: \"foobar\"",
  path: "/src/main.rs",
  hint: "Try read_file first to confirm the exact text."
}
```

### 安全拒绝

```rust
// reason 给模型理解，不泄露路径内容细节
{ error: "Refused: environment variable \"LD_PRELOAD\" is not allowed (could hijack the process)." }

// 前端安全检查
{ ok: false, reason: "Refused: file path is outside the authorized workspace." }
```

### 子代理结果

```typescript
// 成功
{
  type: "explore",
  summary: "Found 3 files...",
  stepCount: 5,
  durationMs: 12340
}

// 失败 — 带 lastStep 和 stepCount 供主 agent 诊断
{
  error: "worker timed out",
  type: "explore",
  lastStep: "read_file",
  stepCount: 3
}
```

### 体积预算

| 指标 | 预算 | 说明 |
|---|---|---|
| eager (main + settings) | ≤ 540 KB gzip | 入口阻塞包 |
| total (全量) | ≤ 1.6 MB gzip | 所有 chunk 合计 |

新增功能必须评估体积 impact，PR 报告 size 变化。

---

## 常见陷阱

| 陷阱 | 修复 |
|---|---|
| `native.writeFile` 未传 `expectedMtime` | `write_file` 必须传 mtime CAS，并发写不丢数据 |
| 子代理 summary 空字符串 | `CLOSING_RULE` + nudge 重试，保证必产文本 |
| `replace_all` 0 匹配静默成功 | 返回 error（edit.ts 已修） |
| Shell idle 挂死 | `IDLE_TIMEOUT` 独立看门狗（shell/mod.rs） |
| 密钥 env 注入 | `checkEnvKeys` + `ENV_KEY_ALLOWLIST` + Rust `filter_extra_env` |
| `nohup/setsid` 绕过超时 kill | `checkShellCommand` 拦截（security.ts） |
| LLM 判定异常阻塞 graph | Judge fail-open + 连续 3 次失败才暂停 |
| Web 服务端 0.0.0.0 暴露 | 绑定 127.0.0.1 + Origin + token 鉴权 |

---

## Rust 编码规范

### 函数签名

```rust
// 正确：纯函数，可测试
pub fn compute_idf(lines: &[&str], query: &str) -> HashMap<String, f64> { ... }

// 正确：命令函数薄壳（状态管理在 State，逻辑在纯函数）
#[tauri::command]
pub fn agent_registry_list(state: State<'_, AgentPlatformState>) -> Vec<AgentListEntry> {
    state.registry.all().into_iter().map(|def| AgentListEntry { ... }).collect()
}
```

### 错误处理

```rust
// 正确：Result<T, String>（Tauri 命令约定）
#[tauri::command]
pub fn my_command() -> Result<MyOutput, String> { ... }

// 正确：内部用 thiserror 或自定义错误类型，转 String 只在 #[tauri::command] 边界
// 错误：到处用 .unwrap() 或 .expect()
```

### 并发

```rust
// 正确：RwLock + poisoned 恢复
self.instances.write().unwrap_or_else(|e| e.into_inner())

// 正确：AtomicBool 做取消标志
pub cancel_flag: Arc<AtomicBool>,

// 错误：Mutex 保护只读数据（用 RwLock）
```

### 注释

```rust
// 正确：解释 WHY
// ConPTY openpty 可能无限挂起，超时 5s 兜底（microsoft/terminal#1810）
#[cfg(windows)]
let result = timeout(Duration::from_secs(5), openpty()).await;

// 错误：解释 WHAT
// 调用 openpty 创建伪终端
```

### cfg 分支

```rust
// 正确：平台代码放在正确分支
#[cfg(target_os = "windows")]
mod windows_impl { ... }

#[cfg(target_os = "macos")]
mod macos_impl { ... }

#[cfg(not(target_os = "windows"))]
mod unix_impl { ... }
```

### 测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_roundtrip_preserves_every_field() {
        let def = sample_def();
        let json = serde_json::to_string(&def).unwrap();
        let back: AgentDef = serde_json::from_str(&json).unwrap();
        assert_eq!(def, back);
    }

    #[test]
    fn boundary_empty_input() {
        assert_eq!(compute_idf(&[], ""), HashMap::new());
    }
}
```
