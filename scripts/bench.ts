/**
 * Lightweight perf regression benchmark (P2-11). No extra deps — uses
 * performance.now() over the core pure-logic hot paths. Run with:
 *   pnpm bench
 * Fails (exit 1) if any operation exceeds its budget, so a regression in a
 * hot path surfaces in CI. Budgets are generous baselines, not micro-optimized
 * ceilings — tune them only when a real regression appears.
 */
import { performance } from "node:perf_hooks";
import { compactModelMessagesDetailed } from "../src/modules/ai/lib/compact";
import { GraphEngine } from "../src/modules/ai/graph/engine";
import { detectDoomLoop, pushToolCall } from "../src/modules/ai/lib/loop";
import type { ModelMessage } from "ai";

type Bench = { name: string; fn: () => void; budgetMs: number };

function run(b: Bench): { name: string; ms: number; ok: boolean } {
  const t0 = performance.now();
  b.fn();
  const ms = performance.now() - t0;
  return { name: b.name, ms, ok: ms <= b.budgetMs };
}

const BIG = "x".repeat(4000);

function longConversation(n: number): ModelMessage[] {
  const messages: ModelMessage[] = [{ role: "user", content: "head" }];
  for (let i = 0; i < n; i++) {
    messages.push({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: `c${i}`, toolName: "read_file", input: { path: `/p${i}.txt` } }],
    } as unknown as ModelMessage);
    messages.push({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: `c${i}`, output: { type: "text", value: BIG } }],
    } as unknown as ModelMessage);
  }
  messages.push({ role: "user", content: "tail" });
  return messages;
}

const benches: Bench[] = [
  {
    name: "compact 40-message conversation (compress under pressure)",
    fn: () => compactModelMessagesDetailed(longConversation(20), 20000),
    budgetMs: 50,
  },
  {
    name: "doom-loop detection over 10k calls",
    fn: () => {
      let recent: Parameters<typeof pushToolCall>[0] = [];
      for (let i = 0; i < 10000; i++) {
        recent = pushToolCall(recent, { toolName: "edit", args: `{"p":"/a","i":${i}}` });
        detectDoomLoop(recent);
      }
    },
    budgetMs: 30,
  },
  {
    name: "graph engine linear run (5 nodes, no-op runner)",
    fn: () => {
      const deps = {
        runAgent: async () => ({ output: "x", stepCount: 1 }),
        emit: () => {},
      };
      const eng = new GraphEngine(deps as never);
      const nodes = Array.from({ length: 5 }, (_, i) => ({
        id: `n${i}`,
        kind: "agent",
      }));
      const def = {
        id: "bench-graph",
        name: "bench",
        nodes,
        edges: nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id })),
      };
      void eng.run(def as never);
    },
    budgetMs: 20,
  },
];

const results = benches.map(run);
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}: ${r.ms.toFixed(2)}ms (budget ${r.budgetMs}ms)`);
  if (!r.ok) failed++;
}
if (failed > 0) {
  console.error(`\n${failed} bench(es) over budget — possible perf regression.`);
  process.exit(1);
}
console.log("\nAll benches within budget.");
