# Yamet 桌面应用 · 用户体验 / 产品审查报告

> 审查人身份：资深用户体验 / 产品工程师（真实用户视角，首次启动 → 日常使用全流程）
> 审查基线：v0.1.14（第十三轮迭代后），源码级核对，每条结论附 `文件:行号` 证据
> 原则：宁缺毋滥，不臆造。所有「宣称」均对照 README / YAMET.md / ROADMAP / CHANGELOG 与真实代码逐项核实。

---

## 0. 总体结论

技术地基扎实（双进程模型、原生铁律、双语 i18n 体系、安全护栏都做得认真），但**作为普通用户可感知的完成度仍偏低**。最刺眼的三点：**首启不落地终端**（终端优先的产品第一次打开只见一个空 chat 标签）、**中英混排**（中文界面里四处硬编码英文，且门禁只扫中文不扫英文，与「硬编码英文清零」的宣称不符）、**空状态组件未真正落地**（第十三轮宣称用 EmptyState 的五个面板实际上仍是一行纯文本）。

---

## 1. 首次体验 / 上手

### 1.1 【P0】首启只有一个 chat 标签，没有自动打开终端
- 证据：
  - `src/modules/tabs/lib/useTabs.ts:346-353`：`useState<Tab[]>` 初始值只有一个 `{ kind: "chat", title: "chat" }`。
  - `src/modules/spaces/lib/useSpacesBoot.ts:57-79`：首启分支（`spaces.length === 0`）只创建默认 space 后**直接 return**，不调用 `replaceTabs`，因此不创建任何 terminal / editor 标签。
- 现状：产品定位是「终端优先、AI 原生能力」，但全新用户第一次启动，过完 Onboarding 对话框后，工作区里只有一个空的 AI chat 标签，没有 shell。
- 问题/痛点：用户以为「还要装个终端」；要花几步去找「+」菜单才能开一个终端。首次价值感极低。
- 改进建议：首启在创建默认 space 时同时创建一个 terminal 标签并激活（或 Onboarding 的「开始使用」按钮落地到新开一个终端），让终端优先的定位从第一秒兑现。

### 1.2 【P1】Onboarding 引导「设置 → AI」与实际标签名「模型」不符
- 证据：
  - `src/lib/i18n/translations.ts:127`：`aiKeyDesc: "在设置 → AI 中粘贴 API 密钥…"`。
  - `src/settings/SettingsApp.tsx:42`：设置 tab 实际 id 是 `models`，`src/lib/i18n/translations.ts:681` 标签为「模型」；`models` 是 `"ai"/"connections"` 旧名的重定向目标（`SettingsApp.tsx:68`）。
- 现状：README 也写「设置 → AI」。但设置页顶部没有「AI」标签，叫「模型」。
- 问题/痛点：用户按引导找不到「AI」入口，术语不一致制造困惑。
- 改进建议：统一术语——要么把 tab 名改回「AI」，要么把 Onboarding/README 文案改成「设置 → 模型」。

### 1.3 【P1】Onboarding「能力引导」步骤只有描述、没有跳转 CTA
- 证据：`src/components/OnboardingDialog.tsx:91-96` 的 `capabilities` 卡片只渲染 `title` + `desc`（`translations.ts:130-132` 描述了 DAP/LSP/SFTP），`Dialog` 无任何「去打开」动作。
- 问题/痛点：引导告知「有这些能力」但不说/不带到「在哪里、怎么开」。对 DAP、远程、网关这些入口本身就藏得深的能力，光描述等于没说。
- 改进建议：每张能力卡片可点击跳转到对应侧栏视图或设置 tab（如 `openSettingsWindow("integrations")`）。

### 1.4 【P1】云端 API 密钥无「测试连接」，本地端点才有
- 证据：`lm_ping` 只在本地端点校验处调用——`src/settings/sections/ModelsSection.tsx:853`、`:1078`（llama.cpp / openai-compatible 的 base URL 探活）。`src/settings/components/ProviderKeyCard.tsx` 全文无测试按钮。
- 现状：贴入 OpenAI/Anthropic/DeepSeek 等云端 key 后，没有任何方式验证 key 是否有效，只能去发一条消息试。
- 问题/痛点：首配 AI 的最常见挫败点——贴错/过期/被风控的 key，用户要等一次失败请求才知道。
- 改进建议：在 ProviderKeyCard 或默认模型选择处加「测试连接」按钮（Rust 侧已有 `lm_ping`/`ai_http_request` 通道，可扩展对云端做轻量 `/models` 或 chat 探活）。

---

## 2. 功能完整性与体验（对照 README / YAMET.md 宣称）

### 2.1 【P1】远程 SFTP 只能只读预览，不能编辑（半成品）
- 证据：`src/app/App.tsx:1287-1300` `openRemoteFile`：`sftp_read` 读内容后 `encodeURIComponent` 塞进 `data:` URL 交给 `newPreviewTab`。注释明写「Remote files aren't on disk, so render them through the preview pane via a data URL」。
- 现状：README（`功能特性·文件浏览器/网页预览`）与 YAMET.md（`remote/` 模块「SFTP 文件浏览器…读取为 preview」）宣称远程浏览，但打开后是只读、纯文本、不可保存的预览标签。
- 问题/痛点：远程工作流只能「看」，改不回去；对以远程为主场景的用户这是能力缺口。
- 改进建议：要么明确标注「只读预览」，要么支持编辑后回写（`sftp_write` 通道），或至少提供「在终端用 scp/sed 处理」的引导。

### 2.2 【P1】MCP 与 IM 网关入口深藏设置页，功能不可发现
- 证据：
  - `src/modules/sidebar/types.ts:1`：侧栏 rail 仅 `explorer | source-control | search | debug | remote` 五视图；`src/modules/sidebar/SidebarRail.tsx:30-41` 无 mcp / gateway 项。
  - MCP 只在 `src/settings/sections/IntegrationsSection.tsx` → `McpServersGroup`；网关只在 `src/settings/sections/GatewaySection.tsx`。
- 现状：MCP（外部工具接入）和 IM 网关（钉钉/飞书/企微/QQ/微信）是 README 的卖点，但侧栏没有入口，用户得知道去「设置 → 集成」「设置 → IM 网关」才找得到。
- 问题/痛点：功能存在 = 功能不可见。新用户几乎不可能自己发现网关。
- 改进建议：在侧栏 rail 增加「MCP」入口（参考 VS Code 的扩展/资源管理器），网关至少在主界面空态/引导里给一个直达入口。

### 2.3 【P2】git-history（提交图）无侧栏入口，仅藏在「+」菜单与命令面板
- 证据：YAMET.md:116 写「sidebar：活动栏 + 可折叠侧面板（explorer、源码管理、git 历史）」，但 `SidebarRail.tsx:30-41` 没有 git-history 视图；打开只能走 `NewTabMenu.tsx:178` 的「gitGraph」或命令面板 `commands.ts:222`「Open git graph」。
- 现状：提交图是 README 卖点（「带真实提交图的历史面板」），但入口不直观。
- 问题/痛点：宣称的侧栏入口与实际不符；功能可发现性差。
- 改进建议：把 git history 并入 source-control 侧栏的次级标签，或在 rail 增加历史图标。

### 2.4 【P2】DAP 适配器安装引导在「设置 → 集成」，不在侧栏调试面板内
- 证据：适配器缺失检测与可复制安装命令在 `src/modules/dap/components/DapAdaptersGroup.tsx:139-149`（属 Integrations 设置 tab）；而侧栏「调试」视图 `DebugPanel.tsx` 内没有同等的安装引导（只有 launch/调试按钮与线程/变量面板）。
- 现状：第十三轮确实交付了 G1（适配器检测），但入口设在设置页；用户在调试侧栏点启动失败时，不会知道要去设置页找安装命令。
- 问题/痛点：引导闭环没有落在用户出错的那一刻。
- 改进建议：把缺失检测的 toast/引导同时接入 `DebugPanel`（`dap_session_create` 返回 `adapter_missing` 时在侧栏内就地给出可复制命令）。

### 2.5 【P2】MCP 添加失败无 UI 反馈
- 证据：`src/modules/mcp/components/McpServersGroup.tsx:174-176`：`catch` 里仅 `console.error`。
- 问题/痛点：用户填了错误命令/URL，点保存毫无反应，只能看 DevTools。
- 改进建议：catch 中 `toast.error` 展示错误信息（走 i18n）。

---

## 3. 设置页

- 组织合理：`SettingsApp.tsx:33-48` 十个 tab（常规/编辑器/主题/快捷键/模型/技能/集成/智能体/IM 网关/关于），带图标、独立 webview 可深链 tab、`SettingsApp.tsx:63-71` 支持 `?tab=` 深链，术语基本易懂。
- 建议改进：
  - 「集成」tab 同时装 DAP 适配器与 MCP 服务器，而 DAP 又在侧栏有「调试」视图，同一能力双入口位置不一致（见 2.4）。
  - 「技能」与「智能体」容易混淆（一个是 skill/snippet，一个是外部编码 agent 启动器），可在 tab 描述里一句话区隔。
  - 语言选择器存在（`GeneralSection.tsx:146-161`），但部分设置文案仍硬编码英文（见 §5/§6），切换到中文也混合英文，削弱了多语言功能的价值。

---

## 4. 日常工作流阻塞点

### 4.1 【P0】首启拿不到终端（见 1.1）——最痛的流程阻塞。
### 4.2 【P1】Git 提交提示全英文，混在中文界面里
- 证据：`src/modules/source-control/SourceControlPanel.tsx:625-638`：`"Wait for the current Git action to finish."`、`"Stage changes to enable commit."`、`"Enter a commit message to enable commit."`、`"Commit with ${commitShortcut}."`；`:140` `"No upstream"`；`:615` `"Source Control"`。
- 现状：默认语言中文时，提交框下方的禁用提示是英文句子。
- 问题/痛点：中文用户看提示要用第二语言；也暴露 i18n 体系未闭环。

### 4.3 【P1】打开文件 → 编辑 → 保存 主链路本身是通的（explorer 双击 → 编辑器 → 保存冲突检测 `lib/useDocument.ts` 有 mtime 冲突 toast），但远程文件走的是只读预览（见 2.1），是主工作流的硬缺口。

### 4.4 做得顺的：命令面板（`/` 触发）带搜索/分组/MRU，前缀 `#`（内容搜索）、`>`（历史）、`?`（帮助）分层清晰；「+」新建菜单 8 种标签各带快捷键提示（`NewTabMenu.tsx`）；侧栏 source-control 带变更数徽标（`SidebarRail.tsx:36`）。

---

## 5. 视觉与状态细节（空态 / 加载态 / 错误态 / 反馈）

### 5.1 【P1】第十三轮宣称的「五面板 EmptyState 组件」未落地
- 证据：
  - `grep -rn "components/ui/empty" src/` 结果为空——`src/components/ui/empty.tsx`（含 `Empty/EmptyState` 变体）**全仓库无人 import**。
  - 实际空态是纯文本：`McpServersGroup.tsx:49` `<p>{t("settingsMcp.empty")}</p>`；`RemotePanel.tsx:179` `<div>{t("remote.emptyDir")}</div>`；`DebugPanel.tsx:303-307` 无线程时 `<p>{t("settingsDap.noThreads")}</p>`。
- 现状：CHANGELOG:8 与需求文档宣称「dap/mcp/remote/search/gateway 用 EmptyState 组件」，但代码里空态仍是单行文字，无图标、无主动作、无引导下一步。
- 问题/痛点：空态是死文字不是入口，新用户不知道「这里该加什么、下一步点哪」——第十三轮 E 批次核心目标未真正达成。
- 改进建议：把 `empty.tsx` 的 `EmptyState({icon,title,description,action})` 真正接入五面板；每空态给「添加服务器 / 新建隧道 / 配置密钥 / 复制安装命令」等主动作。

### 5.2 【P1】错误反馈走硬编码英文 toast，i18n 未闭环（并入 §6 详列）。
### 5.3 加载态：命令面板/搜索有 loading 态（`CommandPalette.tsx:485` `searching`）；MCP 有 `checking`（`McpServersGroup.tsx:47`）；DAP 有 `busy` 置灰。整体加载态覆盖尚可。
### 5.4 确认对话框：标签关闭/应用退出有守卫（`App.tsx` `useTabCloseGuards`/`useAppCloseGuard`），删除/覆盖有确认，做得较全。

---

## 6. 国际化（中英齐全性 / 硬编码英文）

### 6.1 【P0】硬编码英文 UI 大量残留，且「清零」门禁只扫中文不扫英文
- 证据（硬编码英文字面量，未走 `t()`）：
  - `src/settings/components/ProviderKeyCard.tsx:95` `Connected`、`:103` `Get key`、`:176` `Save`。
  - `src/modules/source-control/SourceControlPanel.tsx:615/625-638/140`（见 §4.2）。
  - `src/app/App.tsx:1296` `toast.error("Failed to open remote file", …)`。
  - `src/modules/editor/EditorPane.tsx:198/204/211/255/267/273` `"Language server format failed"` / `"Format on save skipped"` / `"Format skipped"`。
  - `src/modules/editor/lib/useDocument.ts:87` `toast.warning("File changed on disk", …)`。
  - `src/modules/ai/hooks/useWhisperRecording.ts:109` `toast.error("Microphone access failed")`。
  - `src/modules/explorer/FileExplorer.tsx:743` `"New folder"`（右键动作）。
- 门禁漏洞：`scripts/i18n-scan.mjs:52` `const CJK_RE = /[\u4e00-\u9fff]{2,}/`——只扫**中文**字面量，`CJK_RE.test(line)` 为假时直接 `return`（`:70`）。**硬编码英文完全不在扫描范围**，也没有任何针对英文 UI 字面量的门禁。
- 现状：CHANGELOG:13 与第十二/十三轮反复宣称「硬编码英文 UI 清零」「i18n parity 恢复」，但实际仍有至少 16 处英文 UI 文本未走翻译层，`AssertSameKeys` 只保证 zh/en 键集一致，管不到「组件里根本不查 i18n」的情况。
- 问题/痛点：默认语言中文的用户会在提交框、密钥卡、格式化为保存、麦克风、远程文件等高频处看到英文碎片；多语言成为半成品。
- 改进建议：为 i18n-scan 增加「JSX/TSX 中非注释、非白名单的英文 UI 字面量扫描」（可基于关键词/启发式，先建基线再收紧）；把这 16 处全部迁到 `t()` 键。

### 6.2 【P2】Onboarding「设置 → AI」与「模型」标签不一致（见 1.2），也属术语层面的 i18n 一致性问题。
### 6.3 做得好的：`translations.ts` 以简体中文为主、英文回退，`AssertSameKeys`（`Paths<>` 派生 `TranslationKey`）在编译期强制 zh/en 键集一致（YAMET.md:99、CHANGELOG:11），双语体系地基扎实——缺的是「组件是否真的用 `t()`」这一层的审计。

---

## 7. 优先级排序问题清单

### P0（严重 / 不可用 / 一致性破坏）
| # | 问题 | 证据 |
|---|---|---|
| 1 | 首启不落地终端，用户看到空 chat 标签，终端优先定位未兑现 | `useTabs.ts:346-353`、`useSpacesBoot.ts:57-79` |
| 2 | 中英混排：≥16 处硬编码英文 UI，门禁只扫中文（CJK_RE）不扫英文，「清零」宣称不实 | `i18n-scan.mjs:52`、`SourceControlPanel.tsx:625-638`、`ProviderKeyCard.tsx:95/103/176`、`App.tsx:1296` 等 |

### P1（功能缺口）
| # | 问题 | 证据 |
|---|---|---|
| 3 | 空状态组件未落地：五面板空态仍是纯文本，无引导动作 | `empty.tsx` 无人 import；`McpServersGroup.tsx:49`、`RemotePanel.tsx:179`、`DebugPanel.tsx:303-307` |
| 4 | 远程 SFTP 文件只读预览，不可编辑回写 | `App.tsx:1287-1300` |
| 5 | MCP / IM 网关入口深藏设置，侧栏无视图，不可发现 | `sidebar/types.ts:1`、`SidebarRail.tsx:30-41` |
| 6 | git-history（提交图）无侧栏入口 | `SidebarRail.tsx:30-41` vs `YAMET.md:116` |
| 7 | 云端 API 密钥无「测试连接」 | `ProviderKeyCard.tsx` 无测试；`lm_ping` 仅本地端点（`ModelsSection.tsx:853/1078`） |
| 8 | Onboarding 术语「设置→AI」与「模型」不符；能力步骤无 CTA | `translations.ts:127` vs `SettingsApp.tsx:42/68`、`OnboardingDialog.tsx:91-96` |

### P2（打磨）
| # | 问题 | 证据 |
|---|---|---|
| 9 | DAP 适配器安装引导在设置页而非侧栏调试面板出错处 | `DapAdaptersGroup.tsx:139-149` vs `DebugPanel.tsx` |
| 10 | MCP 添加失败仅 console.error，无 UI 反馈 | `McpServersGroup.tsx:174-176` |
| 11 | 「集成」与「调试」双入口承载 DAP，位置不一致 | `SettingsApp.tsx:44`、`sidebar/types.ts:1` |

---

## 8. 做得好的地方（保持公正）

1. **双语 i18n 体系地基扎实**：简体中文为主 + 英文回退，`AssertSameKeys` 编译期强制 zh/en 键集一致（YAMET.md:99、CHANGELOG:11），比多数同类项目认真。
2. **命令面板是亮点**：搜索/分组/最近使用排序 + 前缀模式（`#` 内容、`>` 历史、`?` 帮助），空态/加载态/错误重试齐全（`CommandPalette.tsx`）。
3. **「+」新建菜单**：8 种标签类型都带键盘快捷键提示（`NewTabMenu.tsx`），新用户可按提示快速上手。
4. **DAP 适配器缺失检测 + 可复制安装命令 + 多语言 launch.json 模板**已真正交付（`DapAdaptersGroup.tsx:139-149`），且语言探测按 root marker 选择默认模板。
5. **搜索替换已支持正则 + 大小写**：`SearchPanel.tsx:71-73`（第十三轮 H3 落地）。
6. **标签关闭/应用退出有守卫**，覆盖 mtime 冲突检测（`useDocument.ts:87`），拒绝静默 last-writer-wins，安全与数据保护意识强。
7. **Onboarding** 双语 + Windows 首启签名提示（`OnboardingDialog.tsx:98-102`），对平台坑有主动引导。
8. **侧栏 source-control 带变更数徽标**（`SidebarRail.tsx:36`），工作流状态一目了然。
9. **主题/编辑器主题独立 + 命令面板内主题实时预览**，个性化完成度高。

---

## 9. 一句话收尾

把首启落地一个终端、把空状态组件和英文 i18n 门禁真正补上、给远程编辑和 MCP/网关入口一个合理位置，这四点做完，「普通用户可感知的完成度」会从 4/10 跳到 7/10 以上。
