# 终端渲染池

本指南展开说明 `YAMET.md`。如有冲突，以 `YAMET.md` 为准。

## 为什么有池

终端标签切换时保持挂载与隐藏，让 PTY 与开发服务器持续后台流式输出。无限创建活跃的 xterm + WebGL 渲染实例会爆内存预算，所以 Yamet 池化渲染槽位。

池在 `src/modules/terminal/lib/rendererPool.ts`。

## 槽位生命周期

- `POOL_MAX_SIZE` 为 5（`rendererPool.ts:22`）。每个槽位持有一个 xterm `Terminal`、`FitAddon`、`SearchAddon`、`SerializeAddon`，可选 `WebglAddon`。
- 槽位按需创建，绑定时分配给叶子。
- `releaseSlot` 把槽位与叶子解绑。叶子空闲时槽位以 `display:none` 停放，xterm 停止渲染但仍解析 PTY 字节。
- 宽限期后，空闲槽位可被回收以控制池大小。

## 停放 vs 释放

叶子变隐藏时：

1. `parkLeafSlot` 把宿主设为 `display:none`。渲染暂停，但活 buffer 继续收字节。
2. 叶子**忙**（前台命令、agent 信号、alt-screen TUI 或块 shell 运行态）时，无限期保留停放的槽位。
3. 叶子**空闲**时，`HIDDEN_RELEASE_DELAY_MS` 后调 `releaseSlot`。槽位的 `currentLeafId` 清空、置 `retainedLeafId`，让 buffer 保持存活。

叶子重新可见时，`acquireSlot` 依次找：

1. 已绑定到此叶子的槽位。
2. 此叶子的保留槽位（`retainedLeafId === leafId`）：快路径，无需快照回放。
3. 干净的空闲槽位。
4. 池满时逐出得分最低的槽位。逐出会先经 `SerializeAddon` 把保留 buffer 序列化成快照，再抢槽。

## DormantRing

`src/modules/terminal/lib/dormantRing.ts` 为完全没有槽位（被抢或从未绑定）的叶子缓冲 PTY 字节。上限 1 MiB，溢出丢最旧块。排空时从下一行边界续起，而非重置终端，避免从中间回放行中转义序列。

## 绝不序列化命令中途的叶子不变量

这是池里最重要的规则。处于命令中段的叶子**绝不**被序列化。在陈旧快照上回放增量 TUI 重绘，正是当初抹掉 Claude Code 的原因。

代码在逐出前查 `isLeafBusy`，并在 `commandRunning`、`isAgentActivePty` 或 alt-screen 为真时保持停放（不释放）槽位来强制该规则。

## 快路径与快照回放

叶子存在保留槽位时，`bindSlot` 跳过 `term.clear()` / `term.reset()`，只把 DormantRing 排空进活 buffer，避免重渲染大快照。

只有快照时，`bindSlot` 清终端、调尺寸、写快照，再排空 ring。对 alt-screen TUI，跳过快照并发 SIGWINCH kick，让 TUI 从零重绘。

## WebGL 生命周期

WebGL addon 在槽位变可见时创建，停放超宽限期后回收。addon 在睡眠/唤醒或 GPU 重置导致 context 丢失时自动恢复。

## 不变量

- 绝不允许池无限增长；上限 `POOL_MAX_SIZE`。
- 绝不在命令中途或 alt-screen 时序列化或逐出叶子。
- 隐藏的忙叶子保持活网格停放（`display:none`）。
- 隐藏的空闲叶子释放槽位，但 buffer 继续解析字节。
- DormantRing 只缓冲没有任何槽位的叶子的字节。

## 参见

- [`YAMET.md`](../../YAMET.md)：架构事实来源
- [`docs/README.md`](../README.md)：贡献者指南索引
- [PTY shell 集成](pty-shell-integration.md)：会话、OSC 序列与 ConPTY
