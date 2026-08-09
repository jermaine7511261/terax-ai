# 扩展生态

## 设计原则

YaMet 的扩展生态遵循三条铁律：

1. **窄范围**：插件 = AI 工具 + 片段 bundle，不做 IDE 式扩展宿主
2. **原生解析**：所有扩展由 Rust 解析，禁止 Node/Python 运行时
3. **安全边界**：插件的工具权限 ≤ 宿主 agent 的权限（capability 交集）

## 扩展层次

```
┌─────────────────────────────────────────────────────┐
│  L1 Skills（已实现）                                  │
│  skills/<name>/skill.json + SKILL.md                │
│  → Agent 可调用的可复用指令模板                        │
│                                                     │
│  L2 MCP Tools（已实现）                               │
│  外部 MCP 服务器 → tools/call 注册                    │
│  → 动态工具扩展                                      │
│                                                     │
│  L3 AI Tool Bundle（预留）                            │
│  skills/<name>/ + tools/ 子目录                      │
│  → 自定义工具 + prompt 组合                           │
│                                                     │
│  L4 Native Plugin（范围外）                           │
│  Rust ABI + 前端原生 store                           │
│  → 深度扩展（UI/行为/协议）                           │
└─────────────────────────────────────────────────────┘
```

## Skills 系统（L1，已实现）

### 目录结构

```
<workspace>/
  skills/
    code-review/
      skill.json          # 声明文件
      SKILL.md            # 指令正文（frontmatter + body）
    security-audit/
      skill.json
      SKILL.md
```

### skill.json Schema

```json
{
  "name": "code-review",
  "displayName": "Code Review",
  "description": "Reviews code for correctness, perf, security.",
  "handle": "code-review",
  "version": "1.0.0",
  "type": "skill",
  "allowedTools": ["read_file", "grep", "git_diff"],
  "model": null,
  "effort": "medium",
  "agent": null,
  "requiresTools": ["read_file", "grep"],
  "requiresEnv": [],
  "fallbackForTools": [],
  "userInvocable": true,
  "hideFromSlashCommandTool": false
}
```

### 生命周期状态

```rust
pub enum SkillState {
    Active,       // 活跃（近期使用）
    Degraded,     // 降级（需求工具不可用）
    Unavailable,  // 不可用（核心依赖缺失）
}
```

### 策展（Curator）

- 后台触发：agent 空闲 + 距上次运行 > 阈值
- 操作：pin（用户标记） / archive（归档） / keep（保留）
- 约束：只动 agent 创建的 skill，永不删除，pinned 豁免

## MCP 集成（L2，已实现）

### Client 模式

```
外部 MCP 服务器 → stdio/SSE → YaMet MCP Client → Agent 工具池
```

- 工具注册：`mcp_server_connect` → 解析 server 能力 → 注册到 ToolRegistry
- 工具调用：`mcp_tool_call(server_id, tool_name, args)` → 转发 → 返回结果
- 资源读取：`mcp_resource_read(server_id, uri)` → 获取文件/数据

### Server 模式

```
外部 AI 客户端 → stdio/SSE → YaMet MCP Server → YaMet 命令面
```

- 暴露：YaMet 的 AI 工具子集作为 MCP tools
- 权限：经 `needsApproval` 门控的工具需要客户端审批

## 安全模型

### 权限层级

```
AgentDef.tools (ToolScope)
  ∩ CapabilityMode (ReadOnly/ReadWrite/Execute/All)
    ∩ Depth Guard (max_spawn_depth=3)
      = 实际可用工具集
```

### 工具白名单机制

1. AgentDef 的 `tools: ToolScope` 定义可见范围
2. `CapabilityMode::intersect()` 做父子交集
3. `resolve_subagent_toolset()` 在深度上限时剥离 `task`/`run_subagent`/`delegate_many`
4. 工具执行时 `needsApproval` 三态审批（once/always/reject）

### 插件安全边界

- 插件工具权限 ≤ 宿主 agent 的 ToolScope
- 插件无法访问 keyring（铁律：密钥不经 webview）
- 插件无法绕过 workspace 授权注册表
- 插件的路径操作受 security.ts + policy.rs 双层门控
