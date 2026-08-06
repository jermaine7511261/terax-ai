# Yamet 前端代码审查报告（audit-frontend）

> 审查对象：`E:/Agent/yamet`（v0.1.14，React 19 + TypeScript + Vite + xterm.js + CodeMirror 6 + zustand + radix-ui + shadcn/ui + Tailwind v4，别名 `@/*` → `src/*`）
> 审查视角：资深前端/React 工程师 · 前端工程纵深
> 方法：静态分析（Python 扫描 + ripgrep/search_files），全部结论基于真实代码 `file:line` 证据。未臆造。
> 规模：src/ 共 **588 个 TS/TSX 文件**（425 TS + 163 TSX），其中 **166 个 `*.test.*` 测试文件**。

---

## ⏱ 修复状态（2026-08-06 全量修复后更新）

| 原发现 | 严重度 | 修复状态 | 修复提交 |
|---|---|---|---|
| 1.2 同功能多份实现（basename 12 处复制 + 行为漂移） | P1 | ✅ 已修复 | `3d9dc81`+`844efd2`（收敛到 `@/lib/path`，security.ts 拒绝名单版保留） |
| 6.2 硬编码中文漏网（rendererPool toast） | P2 | ✅ 已修复 | `971c084`（→ tStatic 双语键）+ `b964a51`（移除白名单豁免） |
| 6.3 硬编码英文盲区（无英文检测门禁） | P2 | ✅ 已修复 | `7f82882`（16+ 处英文 → t()/tStatic） |
| 巨型组件（SourceControlPanel/ModelsSection 等） | 高 | ⏳ 待拆分 | 见规划，后续迭代 |
| 类型化 IPC 契约层 | 中 | ⏳ 待收敛 | 见规划，后续迭代 |

> 巨型组件拆分与类型化 IPC 收敛属重构范畴，已列入后续迭代；其余 P1/P2 均已闭环。

---

## 一、架构

### 1.1 【模块划分与 barrel 导出】—— 做得好
【证据】`src/modules/*/index.ts` 均为薄 barrel：`explorer/index.ts`(2 行)、`search/index.ts`(1 行)、`remote/index.ts`(1 行)、`statusbar/index.ts`(1 行) 等，几乎全部是纯 re-export；多个模块用 `*StackLazy` 惰性包装导出（`editor/index.ts`、`git-history/index.ts`、`markdown/index.ts`、`source-control/index.ts`）。
【现状】模块按 `<area>/` 自包含，hooks 归 `lib/`，跨模块一律 `@/...`（无相对路径），与 YAMET.md 约定一致。
【问题】无。
【改进建议】保持现状；新增模块遵循同样的薄 barrel + lazy 入口约定。

### 1.2 【同功能多份实现：路径工具严重重复且有行为漂移】—— P1
【证据】`basename` 在 **12 个文件独立复制定义**：
- `src/modules/ai/components/AiChat.tsx:578`
- `src/modules/git-history/GitHistoryPane.tsx:88`
- `src/modules/tabs/lib/useTabs.ts:170`
- `src/modules/source-control/SourceControlPanel.tsx:122`
- `src/modules/ai/lib/security.ts:131`
- `src/modules/command-palette/CommandPalette.tsx:530`
- `src/modules/explorer/FileExplorer.tsx:103`
- `src/modules/lsp/lib/sessionManager.ts:44`
- `src/modules/spaces/lib/serialize.ts:31`
- `src/modules/statusbar/CwdBreadcrumb.tsx:43`
- `src/modules/tabs/lib/useWindowTitle.ts:8`
- `src/modules/ai/components/PlanDiffReview.tsx:16`

实现**行为漂移**：`AiChat.tsx:579` 用 `Math.max(lastIndexOf("/"), lastIndexOf("\\"))`；而 `GitHistoryPane.tsx:89` / `useTabs.ts:171` / `SourceControlPanel.tsx:123` 用 `path.split(/[\\/]/).filter(Boolean)` —— 对尾斜杠（如 `"a/b/"`）前者返回 `""`、后者返回 `"b"`，边角行为不一致。

`dirname` 同样在 6 处独立定义（`externalFormat.ts:96`、`useFileTree.ts:33`、`GitHistoryPane.tsx:93`、`SourceControlPanel.tsx:127`、`useSourceControlContext.ts:7`、`CwdBreadcrumb.tsx:37`），且 `SourceControlPanel.tsx:130` 用 `index <= 0` 返回 `""` 的边角与 `GitHistoryPane.tsx:96` 不同。

`formatBytes` 在 4 处独立定义（`components/ai-elements/tool.tsx:755`、`editor/EditorPane.tsx:106`、`theme/bgImageStore.ts:77`、`updater/UpdaterDialog.tsx:35`）。`normalizeError` 在 3 处独立定义（`GitHistoryPane.tsx:100`、`useSourceControl.ts:70`、`useSourceControlPanel.ts:136`）。

【现状】`src/lib` 下**没有共享 path 工具**（仅有 `src/modules/statusbar/lib/pathUtils.ts:13` 的 `segmentsFromCwd`，且局限在 statusbar 域）。YAMET.md:158 明确约定「反斜杠感知 basename」，但始终未收敛为共享工具，而是到处复制。
【问题】违反 DRY；跨文件行为漂移是潜在正确性隐患（尤其 Windows 反斜杠/尾斜杠路径）；修 bug 要改 12 处。
【改进建议】在 `src/lib/path.ts` 收敛 `basename`/`dirname`/`joinPath`/`formatBytes`，统一用 `.split(/[\\/]/)` 语义（与 YAMET.md 约定一致），删掉 12 处复制；`normalizeError` 收敛为 `src/lib/errors.ts` 单一实现。

### 1.3 【zustand store 分布】—— 合理，仅命名易混淆
【证据】共 19 个 `create<T>(...)` store（扫描见 `.audit_pat.py` 结果）：
- ai 域：`chatStore`、`agentsStore`、`memoryStore`、`planStore`、`schedulerStore`、`snippetsStore`、`todoStore`、`providerModels`(fetchedModelsStore)
- 其他：`agentStore`(agents)、`managedAgentsStore`、`dap/store`、`diagnosticsStore`、`lsp/runtimeStore`、`mcp/store`、`settings/preferences`、`spaces/useSpaces`、`terminal/agentActivity`、`terminal/dropStore`、`workspace/env`

【现状】按域划分，职责清晰，未过度分散。唯一隐患是命名混淆：`modules/agents/store/agentStore.ts:28`（终端 agent 会话/通知）与 `modules/ai/store/agentsStore.ts:32`（AI 子 agent/工具）两个完全不同的域用了几乎同名的 store。
【问题】命名近似导致误引用风险。
【改进建议】`ai/agentsStore.ts` 更名（如 `subagentsStore` / `aiAgentsStore`）以消除歧义。

### 1.4 【App.tsx 协调者】—— 做得好
【证据】`src/app/App.tsx`（1577 行）作为协调者，把标签树 `useTabs`、工作区切换 `useWorkspaceSwitcher`、spaces 启动 `useSpacesBoot`、AI 引导 `useAiBootstrap` 等拆到独立 hooks；import 全部走模块 barrel 或 `lazy(() => import(...))`（DebugPanel/RemotePanel 惰性，见 `App.tsx:20-25`）。
【问题】无；结构清晰。

---

## 二、代码质量

### 2.1 【巨型单文件组件/Hook】—— P2
【证据】>1000 行的文件：
- `SourceControlPanel.tsx` **1821 行**
- `useSourceControlPanel.ts` 1237 行
- `useTabs.ts` 1328 行
- `useTerminalSession.ts` 1220 行
- `rendererPool.ts` 1146 行
- `App.tsx` 1577 行
另有 `translations.ts` 2724 行（数据表，合理）、`fileIcons.ts` 2681 行（图标映射表，合理）属数据性质除外。
【现状】source-control 域的两个文件加起来超 3000 行，rendererPool/useTerminalSession 均超千行。
【问题】可维护性/可测性下降；`SourceControlPanel.tsx` 顶部一段同时手写 `basename`/`dirname`（122/127 行），进一步印证 1.2 的重复问题。
【改进建议】优先拆分 `SourceControlPanel.tsx`（渲染 vs 逻辑已部分在 `useSourceControlPanel.ts`，可再拆行级组件与工具函数）。

### 2.2 【React Compiler 已启用，但仍有大量手动 memo】—— P2（观察）
【证据】`vite.config.ts:21-23` 启用 `babel-plugin-react-compiler`（`reactCompilerPreset({ target: "19" })`）。但全库仍有 `useCallback` **282 处**、`useEffect` 246 处、`useMemo` 70 处、`useRef` 104 处、`useState` 157 处。
【现状】React Compiler 会自动 memo 组件与 hooks，部分手动 `useMemo`/`useCallback` 属冗余。
【问题】非 bug；但加重心智负担与 diff 噪音。
【改进建议】在 CI 引入 `react-compiler-healthcheck`（已装为 devDep），评估可移除的手动 memo 数量，不强制清零。

### 2.3 【事件监听清理】—— P2（观察，非定论）
【证据】全库 `addEventListener` 44 处 vs `removeEventListener` 31 处；6 个文件在同一文件内 add 而无 remove：
- `ai/lib/proxyFetch.ts`(add=1)、`editor/lib/colorSwatches.ts`(2)、`lsp/lib/client.ts`(3)、`lsp/lib/locationsPanel.ts`(2)、`terminal/block/lib/historyPopover.ts`(2)、`terminal/lib/rendererPool.ts`(3)
【现状】这些多为模块级长生命周期监听或 xterm/编辑器实例上的 DOM 监听，经 `dispose`/`UnlistenFn`/channel 清理而非 `removeEventListener`。
【问题】无法静态断定泄漏；`rendererPool.ts` 的 3 处（终端/编辑器实例上）若实例销毁路径未覆盖则可能泄漏，需人工核验。
【改进建议】对上述 6 文件逐一确认清理路径；用 eslint 规则或 code review 确保每个 `addEventListener` 有成对清理。

### 2.4 【死代码/未使用】—— 基本干净
【证据】`knip.json` 与 `knip`（devDep）已配置（`package.json:30`，`knip.json` 存在）；无 `console.log`（0 处）；`console.warn` 17 处、`console.error` 36 处，属合理错误处理。`TODO` 注释 102 处。
【问题】无明确死代码证据；`eager-graph.mjs:9` 注释声称由 `scripts/eager-graph.test.ts` 使用，但该测试文件**不存在**（实际测试在 `src/app/eager-budget.test.ts`），为陈旧注释。
【改进建议】更新 `eager-graph.mjs:9` 注释指向 `src/app/eager-budget.test.ts`；在 CI 跑 `pnpm knip`。

---

## 三、类型安全 —— 本库最强项

【证据】
- `tsconfig.json:18` `strict: true`，外加 `noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`；`verify.ps1:26-28` 强制 `tsc --noEmit`。
- **`as any` / `: any` / `<any>` 全库为 0 处**；39 处词法 "any" 全部出现在注释/翻译文案/AI 提示词等自然语言中（如 `main.tsx:22` 注释、`translations.ts:1941` 文案），无一处是类型逃生。
- 34 处 `as unknown as` 全部是**合理的第三方边界逃生**：`components/ai-elements/chat-code-lezer.ts:42-114`（lezer `StreamParser`）、`explorer/lib/iconResolver.ts:18`（iconify set）、`terminal/lib/rendererPool.ts:863-875`（xterm addon 私有字段）、`ai/components/AiChat.tsx:712-734` 与 `chatRuntime.ts:101`（AI SDK part 类型）、`useTabs.ts:535`/`useTerminalSession.ts:1218`（window 全局扩展）等。
- 仅 **1 处** `@ts-ignore`：`src/components/ui/spinner.tsx:9`，位于 shadcn/ui 生成文件（biome 已排除 `!src/components/ui/**`）。
- 仅 **2 处**非空断言：`AiChat.tsx:553` `run!.startIdx`、`statusbar/lib/pathUtils.ts:26` `normHome!.length`，均为已判空后的安全断言。

【现状】类型纪律极佳，逃生舱使用克制且都有边界合理性。
【问题】无实质问题。
【改进建议】保持；新代码延续「用 `as unknown as` 做边界转换、禁 `as any`」的隐性约定，可考虑在 biome 或 knip 显式加 `noExplicitAny` 门禁固化。

---

## 四、测试质量

### 4.1 【测试分布】—— 166 个测试文件
【证据】分布：`ai` 50、`terminal` 23、`editor` 17、`theme` 8、`lsp` 7、`tabs` 7、`explorer` 6、`agents` 5、`command-palette` 5、`settings` 5、`spaces` 4、`components` 4 等（覆盖全部 27 个子域，仅 `search`/`preview`/`remote`/`mcp`/`markdown` 各 1 个较薄）。
【问题】核心且复杂的域覆盖好；集成型 UI 壳（search/preview/remote）覆盖薄，与注释自述一致（见 4.3）。

### 4.2 【测试是否测到真实逻辑】—— 做得好，无空壳/纯 snapshot
【证据】
- **0 个 `toMatchSnapshot`/`toMatchInlineSnapshot` 使用**（全库无纯快照测试）；唯一含 "snapshot" 的 `terminal/lib/sessionSnapshot.test.ts` 是会话快照逻辑测试，非 jest snapshot。
- 抽样 `src/modules/lsp/lib/transport.test.ts:1-73`：`vi.hoisted` mock `@tauri-apps/api/core` 与 `@/modules/workspace`，断言 `lsp_spawn` 被以正确参数（`command`/`args`/`env`/`maxRssMb`/`workspace`）调用，且校验空 env/maxRssMb 传 null 的边界——是真实逻辑测试。
- 其他较大测试：`slashCommands.test.ts`(455)、`useTabs.test.ts`(379)、`chatStore.test.ts`(346)、`security.test.ts`(322，测密钥路径拒绝名单)、`useFileTree.test.ts`(224)。

### 4.3 【核心逻辑不变量锁定】—— 做得好
【证据】`src/app/eager-budget.test.ts`（25 行）从 `scripts/eager-graph.mjs` 引入自研静态导入追踪器 `traceEager`，BFS 两窗口入口 `src/main.tsx` 与 `src/settings/main.tsx`，断言 `@ai-sdk`/`ai`/`streamdown`/`@codemirror`/`@uiw` 不在 eager 图内。这是**启动 bundle 的锁定不变量测试**。
【现状】核心体积不变量被测试保护；`eager-graph.mjs` 是真实静态分析器（非 mock），能抓住 barrel 重新导出把重型栈拉入 eager 图的回归。
【问题】无。
【改进建议】`eager-graph.mjs:9` 注释指向的 `eager-graph.test.ts` 应更正为 `src/app/eager-budget.test.ts`。

### 4.4 【覆盖率】—— P2（观察）
【证据】`vite.config.ts:176-186` 覆盖率阈值：statements 29 / branches 25 / functions 23 / lines 29；`verify.ps1:38-40` 强制 `test:coverage`。注释自述从 24.75% 提到 29.13%（1392 → 1547 tests）。
【现状】阈值已门槛化并逐轮提升；但绝对覆盖率仍偏低（~29%），缺口在大型集成 hook + 组件外壳。
【问题】组件渲染路径几乎无单元测试。
【改进建议】保持逐轮加阈值；为高价值组件壳（如 Settings 各 section、DebugPanel）补 jsdom 冒烟测试，或明确交给 E2E 并给出验收标准。

---

## 五、性能 / 体积 —— 做得好

【证据】体积治理是多重叠加防线：
1. **eager-budget 测试**锁死重型栈不 eager（见 4.3）。
2. **`.size-limit.json`** 锁 `main window startup JS` 540KB gzip + `total client JS` 1550KB gzip，`verify.ps1:50-52` 跑 `pnpm size`。
3. **`vite.config.ts:72-139` 精细 manualChunks**：每个 AI 提供商独立 chunk（`ai-anthropic`/`ai-openai`/`ai-cerebras`…，仅供 `agent.ts` 懒加载）、每个 CodeMirror 语言独立 `cm-lang-*` chunk（按需加载）、xterm/streamdown/codemirror/radix 各自成块、`clsx`/`tailwind-merge`/`class-variance-authority` 与 `vite/preload-helper` 钉到 react（防止被重型 chunk 吸附而拖入 eager 图，见注释 73-92）。
4. **`vscode-languageserver-protocol` 别名到 4 枚举 shim**（`vite.config.ts:46-51`）省约 117KB。
5. **treeshake `manualPureFunctions`**（`vite.config.ts:64-70`）把 `console.debug/info/trace` 标纯以在 prod 裁掉。
6. 重型栈（editor/AI/markdown/DAP/remote）全部 `lazy(() => import(...))`。

【问题】无；这是极佳的体积工程范例。
【改进建议】无。

---

## 六、i18n

### 6.1 【架构】—— 做得好
【证据】`src/lib/i18n/translations.ts`（2724 行）以 `zhMessages` 为主 + `enMessages` 回退，`Paths<>` 派生 `TranslationKey` 类型，zh/en 键奇偶在编译期强制（YAMET.md:99）；全库 **341 个文件**触碰 i18n（`useI18n()` / `tStatic()` / `t()`）。组件用 `useI18n`、模块作用域用 `tStatic`，符合约定。

### 6.2 【硬编码中文】—— 门禁通过，但已知漏网未修
【证据】`node scripts/i18n-scan.mjs` 通过（输出 "i18n-scan: 通过"）。但 `i18n-scan.mjs:92` 白名单显式豁免 `rendererPool.ts`，其内部 `src/modules/terminal/lib/rendererPool.ts:325-328` 硬编码中文 toast：
```
toast("检测到多行粘贴", { description: `剪贴板包含 ${lineCount} 行内容…`, label: "粘贴" })
```
`i18n-scan.mjs:93` 还豁免 `GeneralSection.tsx` 的语言名 `中文（简体）`。
【现状】这是**已知的、被白名单掩盖的未修复硬编码**，注释自述"tracked for a follow-up pass"。
【问题】违反"绝不硬编码 UI 文本"的仓库约定；白名单让门禁对这些漏网失效。
【改进建议】把 `rendererPool.ts:325-328` 的多行粘贴 toast 与 `GeneralSection.tsx` 语言名改为 `t()` 键，然后从 `i18n-scan.mjs` 白名单移除这两条豁免。

### 6.3 【硬编码英文盲区】—— P2
【证据】`i18n-scan.mjs` 只匹配 CJK（`CJK_RE = /[\u4e00-\u9fff]{2,}/`，第 52 行），**完全不查英文硬编码**。实证：`src/modules/source-control/SourceControlPanel.tsx:140` 返回硬编码英文 `"No upstream"`，且在 `:641`（`pushStatusLabel = upstreamBadgeLabel(...)`）被渲染为面向用户的 push 状态标签。
【现状】英文文案泄漏无门禁。
【问题】zh 为主的 UI 在英文回退模式下此处直接显示英文（虽恰好是英文，但破坏了"文案走 i18n 键"的一致性约定；若未来加第三种语言或统一措辞会漏）。
【改进建议】为 i18n-scan 增加英文 JSX 文本节点检测（白名单品牌/模型/协议名），把 `SourceControlPanel.tsx:140` 等改为 `t()` 键。

---

## 七、与后端命令的接线 —— 无死链

【证据】静态交叉核对（generic-aware 正则，兼容 `invoke<number>("cmd")` 形式）：
- 前端 invoke 命令字符串 **133 个**，全部能在 `src-tauri` 找到对应的 `#[tauri::command] fn`，**缺失 = 0**。
- 首次扫描报 `pty_open`/`lsp_spawn`/`pty_helper_open` 疑似缺失，实为这些命令的 `#[tauri::command]` 与 `fn` 之间夹了 `#[allow(clippy::too_many_arguments)]`（`src-tauri/src/modules/pty/mod.rs`、`lsp/mod.rs`、`pty_helper/client.rs`），命令面完整。
- 反向"未被前端调用"的 86 个 Rust 命令多为误报：它们经动态 `invoke(cmd)` 或 wrapper 调用（如 `ai/lib/native.ts` 统一封装 fs/git/shell/history 命令、`lsp/lib/transport.ts` 封装 `lsp_spawn`、`pty-bridge.ts` 封装 `pty_open`），或经 Tauri 事件/插件调用。
- `scripts/check-doc-drift.mjs`（`verify.ps1:42-44` 强制）核对命令面/模块布局/原生铁律与文档一致性。

【现状】前端调用的每条命令都有 Rust 侧实现，无死链；后端命令面有文档漂移门禁保护。
【问题】无。
【改进建议】无。

---

## 八、优先级问题清单

### P0（阻断/致命）
- 无。

### P1（应尽快修复）
1. **路径工具重复 + 行为漂移**（1.2）：`basename`×12、`dirname`×6、`formatBytes`×4、`normalizeError`×3 各自复制实现，且 basename 尾斜杠边角行为不一致（`AiChat.tsx:578` vs `GitHistoryPane.tsx:88`）。→ 收敛到 `src/lib/path.ts` / `src/lib/errors.ts` 单一实现。
2. **i18n 硬编码英文盲区**（6.3）：`SourceControlPanel.tsx:140` "No upstream"（`:641` 渲染）等英文文案无门禁。→ 扩展 i18n-scan 覆盖英文并修复。
3. **已知硬编码中文漏网未修**（6.2）：`rendererPool.ts:325-328` 多行粘贴 toast、`GeneralSection.tsx` 语言名被 i18n-scan 白名单掩盖。→ 改为 `t()` 键并移除白名单豁免。

### P2（建议改进）
4. **巨型单文件**（2.1）：`SourceControlPanel.tsx`(1821)、`useSourceControlPanel.ts`(1237)、`useTabs.ts`(1328)、`useTerminalSession.ts`(1220)、`rendererPool.ts`(1146)。优先拆 source-control 域。
5. **React Compiler 启用但手动 memo 冗余**（2.2）：282 `useCallback` / 70 `useMemo`。用 `react-compiler-healthcheck` 评估。
6. **组件覆盖率薄**（4.4）：整体 ~29%，组件壳无单测。逐轮加阈值或明确 E2E 验收。
7. **store 命名混淆**（1.3）：`ai/agentsStore.ts` vs `agents/agentStore.ts`。更名消歧。
8. **陈旧注释**（4.3/2.4）：`eager-graph.mjs:9` 指向不存在的 `eager-graph.test.ts`，实际在 `src/app/eager-budget.test.ts`。
9. **监听器清理核验**（2.3）：6 文件 `addEventListener` 无同文件 `removeEventListener`（rendererPool 等），需人工确认 dispose 路径。
10. **knip 未进 CI**（2.4）：`knip.json` 已配置，建议加入 `verify.ps1`。

---

## 九、做得好的地方

- **体积/性能工程极佳**（五）：eager-budget 不变量测试 + size-limit 双上限 + 精细 manualChunks（AI 提供商/CM 语言按需分块）+ LSP protocol shim 省 117KB + 懒加载全覆盖。
- **类型安全零 any**（三）：全库 0 个 `as any`；34 处 `as unknown as` 全是合理的第三方边界逃生；仅 1 处 `@ts-ignore`（在 shadcn 生成文件）；tsconfig strict + CI 强约束。
- **测试测真实逻辑**（四）：0 个纯快照测试；LSP transport / 密钥安全 / 标签树 / 命令补全等核心逻辑有实质断言；启动 bundle 不变量被静态分析器测试锁定。
- **i18n 架构**（六）：编译期 zh/en 键奇偶强制 + 341 文件走统一文案层 + CI 硬编码中文门禁。
- **命令面无死链**（七）：133 个前端 invoke 全部有 Rust 对应，且有 doc-drift 门禁。
- **模块规范**（一）：薄 barrel + 自包含 + lazy 入口 + 跨模块一律 `@/` 别名。
- **CI 门禁完备**：`verify.ps1` 串起 check-types / lint / test / coverage / check-drift / i18n-scan / size-limit / lock-poison / cargo check/test / tauri build 全链路。
