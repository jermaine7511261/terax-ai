# Yamet · agentskills.io 开放 Skill 标准兼容性评估（2026-08-04）

> 对应第六轮实施稿 §2.4（★ H2 Hermes：agentskills.io 类开放 skill 标准）。本文仅产出评估结论，不做标准实现——`skill.json` 仍是 Yamet 的原生技能格式。

---

## 一、评估对象

| 侧 | 规范 |
|---|---|
| 开放标准（agentskills.io 类） | `SKILL.md`：frontmatter（`name` / `description`，YAML 头）+ 正文（Markdown，即技能的 prompt 指令）+ 可选工具绑定字段（依规范而异，如 `allowed-tools` 或 metadata 扩展） |
| Yamet 本轮实现 | `skill.json`：`{ name, description, prompt, handle?, toolAllowlist? }`，存放于 `<workspace>/skills/<name>/skill.json`（★ L4 LangBot 目录约定） |

---

## 二、字段映射成本

| SKILL.md 字段 | skill.json 字段 | 映射成本 | 说明 |
|---|---|---|---|
| frontmatter `name` | `name` | 低 | 直接复制 |
| frontmatter `description` | `description` | 低 | 直接复制 |
| 正文（prompt 指令） | `prompt` | 低 | 直接复制（Markdown 正文 → 字符串） |
| —（无对应） | `handle` | 低 | Yamet 特有：composer `#handle` 触发；缺失时 `normalizeHandle(name)` 派生 |
| 工具绑定字段（如 `allowed-tools`） | `toolAllowlist` | 中 | 需解析 frontmatter 自定义键 + 与 Yamet 工具 id 对齐（远端/第三方工具 id 可能不对应） |
| —（无对应） | `builtin` | 低 | 运行时派生（扫描来源），非文件字段 |

**结构差异**：SKILL.md 是"frontmatter + 正文"的单文件格式（需 YAML frontmatter 解析器）；skill.json 是纯 JSON（`JSON.parse` 即可）。解析层成本差异极小。

---

## 三、结论与建议

1. **映射成本：低到中。** 核心三字段（name/description/prompt）零成本直映；主要增量在工具绑定字段的解析与工具 id 对齐，以及可选的一次性格式转换器。
2. **运行时维持 `skill.json` 原生格式**，不直接采用 SKILL.md 执行：
   - `skill.json` 与现有 `scanSkillsDir`/`mergeBuiltin`/`toggleBuiltin` 链路零改造；
   - JSON 无 frontmatter 解析依赖，保持"始终轻量"主题。
3. **可选后续增强**：提供一次性导入转换器（`SKILL.md → skill.json`：解析 frontmatter + 正文，`toolAllowlist` 按映射表转换），即可消费 agentskills.io 类生态技能，而无需改动运行时。列第七轮候选。
4. **与 ROADMAP 关系**：「AI 工具/片段作为可安装 bundle」保持未勾；本评估为 bundle 分享/导入的未来形态提供兼容性路径。

---

## 四、参考

- ★ H2 Hermes Agent：skills 自改进 + 开放 skill 标准（agentskills.io 类）评估
- ★ L4 LangBot：`skills/` 目录单一事实来源约定（Yamet 已实现）
- 第六轮实施稿 §2.4、§2.2
