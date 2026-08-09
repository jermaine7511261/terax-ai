import { describe, expect, it, vi } from "vitest";
import type { Todo, TodoStatus } from "./todos";

// Mock the Tauri store plugin — only async store functions use it; the pure
// functions under test (newTodoId, validateTodos) don't touch the store, but
// the module-level `new LazyStore(...)` call must be shimmed or the import
// will blow up at load time.
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get() {
      return undefined;
    }
    set() {}
    delete() {}
  },
}));

const { getReadyItems, newTodoId, validateTodos } = await import("./todos");

// ─── helpers ────────────────────────────────────────────────────────────
function todo(
  overrides: Partial<Todo> & { title: string; id?: string } & {
    status?: TodoStatus;
  },
): Todo {
  return {
    id: overrides.id ?? newTodoId(),
    title: overrides.title,
    status: overrides.status ?? "pending",
    ...("description" in overrides ? { description: overrides.description } : {}),
    ...("dependencies" in overrides ? { dependencies: overrides.dependencies } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// newTodoId()
// ═══════════════════════════════════════════════════════════════════════
describe("newTodoId", () => {
  it("returns a string matching the expected format", () => {
    const id = newTodoId();
    // Format: t-<base36-timestamp>-<4-char random>
    expect(id).toMatch(/^t-[a-z0-9]+-[a-z0-9]{4}$/);
  });

  it("produces unique ids on successive calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => newTodoId()));
    // 20 calls → 20 unique ids (random suffix makes collisions astronomically unlikely)
    expect(ids.size).toBe(20);
  });

  it("always starts with the t- prefix", () => {
    for (let i = 0; i < 10; i++) {
      expect(newTodoId().startsWith("t-")).toBe(true);
    }
  });

  it("contains exactly one hyphen separator after the t- prefix between timestamp and random part", () => {
    const id = newTodoId();
    const parts = id.split("-");
    // t, timestamp, random-4-char → 3 parts
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("t");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// validateTodos()
// ═══════════════════════════════════════════════════════════════════════
describe("validateTodos", () => {
  // ── valid inputs ──────────────────────────────────────────────────────
  describe("valid lists", () => {
    it("returns null for an empty list", () => {
      expect(validateTodos([])).toBeNull();
    });

    it("returns null for a single pending todo", () => {
      expect(validateTodos([todo({ title: "Write docs", status: "pending" })])).toBeNull();
    });

    it("returns null for a single in_progress todo", () => {
      expect(validateTodos([todo({ title: "Write docs", status: "in_progress" })])).toBeNull();
    });

    it("returns null for a single completed todo", () => {
      expect(validateTodos([todo({ title: "Write docs", status: "completed" })])).toBeNull();
    });

    it("returns null for a list with exactly one in_progress among others", () => {
      const todos: Todo[] = [
        todo({ title: "Task A", status: "in_progress" }),
        todo({ title: "Task B", status: "pending" }),
        todo({ title: "Task C", status: "completed" }),
      ];
      expect(validateTodos(todos)).toBeNull();
    });

    it("returns null for a large list with no in_progress items", () => {
      const todos: Todo[] = Array.from({ length: 50 }, (_, i) =>
        todo({
          title: `Task ${i}`,
          status: i % 2 === 0 ? "completed" : "pending",
        }),
      );
      expect(validateTodos(todos)).toBeNull();
    });
  });

  // ── empty title rejection ─────────────────────────────────────────────
  describe("empty title rejection", () => {
    it("rejects a todo with an empty string title", () => {
      const result = validateTodos([todo({ title: "" })]);
      expect(result).toBe("todo title cannot be empty");
    });

    it("rejects a todo with a whitespace-only title", () => {
      const result = validateTodos([todo({ title: "   " })]);
      expect(result).toBe("todo title cannot be empty");
    });

    it("rejects a todo with a tab-only title", () => {
      const result = validateTodos([todo({ title: "\t" })]);
      expect(result).toBe("todo title cannot be empty");
    });

    it("rejects the first invalid todo it encounters (early return)", () => {
      const todos: Todo[] = [
        todo({ title: "Valid task", status: "pending" }),
        todo({ title: "", status: "completed" }),
        todo({ title: "  ", status: "pending" }),
      ];
      expect(validateTodos(todos)).toBe("todo title cannot be empty");
    });

    it("accepts titles with leading/trailing whitespace but non-empty core", () => {
      expect(validateTodos([todo({ title: "  real title  " })])).toBeNull();
    });
  });

  // ── multiple in_progress rejection ────────────────────────────────────
  describe("multiple in_progress rejection", () => {
    it("rejects two todos both marked in_progress", () => {
      const todos: Todo[] = [
        todo({ title: "Task A", status: "in_progress" }),
        todo({ title: "Task B", status: "in_progress" }),
      ];
      expect(validateTodos(todos)).toBe(
        "only one todo may be in_progress at a time (got 2)",
      );
    });

    it("rejects three in_progress todos with the correct count", () => {
      const todos: Todo[] = [
        todo({ title: "A", status: "in_progress" }),
        todo({ title: "B", status: "in_progress" }),
        todo({ title: "C", status: "in_progress" }),
      ];
      expect(validateTodos(todos)).toBe(
        "only one todo may be in_progress at a time (got 3)",
      );
    });

    it("reports the actual count of in_progress items", () => {
      const todos: Todo[] = Array.from({ length: 5 }, (_, i) =>
        todo({ title: `Task ${i}`, status: "in_progress" }),
      );
      expect(validateTodos(todos)).toBe(
        "only one todo may be in_progress at a time (got 5)",
      );
    });
  });

  // ── priority: empty title checked before in_progress count ────────────
  describe("check order", () => {
    it("returns empty title error even when in_progress count is also violated", () => {
      // Empty title is checked first (per-iteration), in_progress is checked after the loop.
      const todos: Todo[] = [
        todo({ title: "", status: "in_progress" }),
        todo({ title: "B", status: "in_progress" }),
      ];
      expect(validateTodos(todos)).toBe("todo title cannot be empty");
    });
  });

  // ── edge cases ────────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("accepts a todo list with only completed items", () => {
      const todos: Todo[] = [
        todo({ title: "Done A", status: "completed" }),
        todo({ title: "Done B", status: "completed" }),
      ];
      expect(validateTodos(todos)).toBeNull();
    });

    it("accepts a todo list with only pending items", () => {
      const todos: Todo[] = [
        todo({ title: "Pending A", status: "pending" }),
        todo({ title: "Pending B", status: "pending" }),
      ];
      expect(validateTodos(todos)).toBeNull();
    });

    it("accepts a todo with a very long title", () => {
      const longTitle = "x".repeat(10_000);
      expect(validateTodos([todo({ title: longTitle })])).toBeNull();
    });

    it("accepts a todo with unicode title", () => {
      expect(validateTodos([todo({ title: "任务一 — テスト 🚀" })])).toBeNull();
    });

    it("handles a list where the second item has empty title", () => {
      const todos: Todo[] = [
        todo({ title: "First", status: "pending" }),
        todo({ title: "", status: "pending" }),
      ];
      expect(validateTodos(todos)).toBe("todo title cannot be empty");
    });

    it("does not mutate the input array", () => {
      const todos: Todo[] = [
        todo({ title: "A", status: "pending" }),
        todo({ title: "B", status: "in_progress" }),
      ];
      const snapshot = JSON.stringify(todos);
      validateTodos(todos);
      expect(JSON.stringify(todos)).toBe(snapshot);
    });
  });

  // ── dependencies (S4) ────────────────────────────────────────────────
  describe("dependencies", () => {
    it("rejects a todo that depends on itself", () => {
      const a = todo({ title: "A", status: "pending" });
      expect(validateTodos([{ ...a, dependencies: [a.id] }])).toBe(
        "todo 'A' depends on itself",
      );
    });

    it("accepts valid dependencies between distinct todos", () => {
      const a = todo({ title: "A", status: "pending" });
      const b = todo({ title: "B", status: "pending" });
      expect(
        validateTodos([a, { ...b, dependencies: [a.id] }]),
      ).toBeNull();
    });

    it("tolerates dangling dependency ids (treated as satisfied, no deadlock)", () => {
      const a = todo({ title: "A", status: "pending" });
      expect(validateTodos([{ ...a, dependencies: ["missing-id"] }])).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getReadyItems() (S4)
// ═══════════════════════════════════════════════════════════════════════
describe("getReadyItems", () => {
  it("returns all pending todos when none have dependencies", () => {
    const todos: Todo[] = [
      todo({ title: "A", status: "pending" }),
      todo({ title: "B", status: "pending" }),
    ];
    expect(getReadyItems(todos).map((t) => t.title)).toEqual(["A", "B"]);
  });

  it("gates a dependent todo until its prerequisite is completed", () => {
    const a = todo({ title: "A", status: "pending" });
    const b = todo({ title: "B", status: "pending", dependencies: [a.id] });
    const c = todo({ title: "C", status: "pending", dependencies: [a.id] });

    // Nothing completed → B/C blocked, A ready.
    expect(getReadyItems([a, b, c]).map((t) => t.title)).toEqual(["A"]);

    // Complete A → B and C both ready (parallel fan-out).
    const completedA: Todo = { ...a, status: "completed" };
    expect(getReadyItems([completedA, b, c]).map((t) => t.title)).toEqual(["B", "C"]);
  });

  it("never returns completed or in_progress items", () => {
    const a = todo({ title: "A", status: "completed" });
    const b = todo({ title: "B", status: "in_progress" });
    const c = todo({ title: "C", status: "pending" });
    expect(getReadyItems([a, b, c]).map((t) => t.title)).toEqual(["C"]);
  });

  it("treats dangling dependencies as satisfied", () => {
    const a = todo({ title: "A", status: "pending", dependencies: ["gone"] });
    expect(getReadyItems([a]).map((t) => t.title)).toEqual(["A"]);
  });
});
