import { createStorage } from "@/platform";

export type TodoStatus = "pending" | "in_progress" | "completed";

export type Todo = {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  /**
   * Ids of other todos that must be `completed` before this one may start
   * (S4). Lets graph/agent orchestration express "only run this step after
   * its prerequisites". Missing ids are tolerated (treated as satisfied);
   * self-references are rejected by `validateTodos`.
   */
  dependencies?: string[];
};

const STORE_PATH = "YaMet-ai-todos.json";
const todosKey = (sessionId: string) => `todos:${sessionId}`;

const store = createStorage(STORE_PATH);

export async function loadTodos(sessionId: string): Promise<Todo[]> {
  return (await store.get<Todo[]>(todosKey(sessionId))) ?? [];
}

export async function saveTodos(
  sessionId: string,
  todos: Todo[],
): Promise<void> {
  await store.set(todosKey(sessionId), todos);
}

export async function deleteTodos(sessionId: string): Promise<void> {
  await store.delete(todosKey(sessionId));
}

export function newTodoId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Validate a candidate todo list:
 *  - At most one item with status `in_progress` (anti-drift invariant).
 *  - Titles must be non-empty.
 *  - Dependencies must not self-reference (a todo depending on itself would
 *    never become ready).
 * Returns null on valid, otherwise an error string.
 */
export function validateTodos(todos: Todo[]): string | null {
  let inProgress = 0;
  for (const t of todos) {
    if (!t.title.trim()) return "todo title cannot be empty";
    if (t.status === "in_progress") inProgress++;
    if (t.dependencies?.includes(t.id)) {
      return `todo '${t.title}' depends on itself`;
    }
    // Dangling deps (ids not in the list) are tolerated and treated as
    // satisfied — a stale id must not deadlock the task.
  }
  if (inProgress > 1)
    return `only one todo may be in_progress at a time (got ${inProgress})`;
  return null;
}

/**
 * S4: todos whose dependencies are all satisfied. A dependency is satisfied
 * when its id is either completed OR not present in the list at all (dangling
 * ids must not deadlock the task). Used by graph/agent orchestration to know
 * which steps may run in parallel now. `completed`/`in_progress` todos are not
 * "ready to start".
 */
export function getReadyItems(todos: Todo[]): Todo[] {
  const completed = new Set(
    todos.filter((t) => t.status === "completed").map((t) => t.id),
  );
  const existing = new Set(todos.map((t) => t.id));
  return todos.filter((t) => {
    if (t.status !== "pending") return false;
    return (t.dependencies ?? []).every(
      (id) => completed.has(id) || !existing.has(id),
    );
  });
}

export type TodoPatch = {
  id: string;
  status?: TodoStatus;
  title?: string;
  description?: string;
};

/**
 * Incremental patch mode (P1-8): merge patches keyed by id onto the existing
 * list. Unknown ids create a new todo so the agent can add steps mid-flight
 * without resending the whole list. Order of existing todos is preserved;
 * new todos are appended.
 */
export function applyTodoPatches(
  existing: Todo[],
  patches: TodoPatch[],
): Todo[] {
  const byId = new Map(existing.map((t) => [t.id, { ...t }]));
  const order = existing.map((t) => t.id);
  for (const p of patches) {
    const cur = byId.get(p.id);
    if (cur) {
      if (p.status !== undefined) cur.status = p.status;
      if (p.title !== undefined) cur.title = p.title;
      if (p.description !== undefined) cur.description = p.description;
    } else {
      byId.set(p.id, {
        id: p.id,
        title: p.title ?? p.id,
        status: p.status ?? "pending",
        description: p.description,
      });
      order.push(p.id);
    }
  }
  return order
    .map((id) => byId.get(id))
    .filter((t): t is Todo => t !== undefined);
}

/**
 * Auto-advance (P1-8): when no todo is `in_progress` but ready pending items
 * exist, promote the first ready one. Keeps the "exactly one in_progress"
 * invariant across incremental updates without the agent manually flipping
 * statuses every step.
 */
export function autoAdvanceReady(todos: Todo[]): Todo[] {
  if (todos.some((t) => t.status === "in_progress")) return todos;
  const ready = getReadyItems(todos);
  if (ready.length === 0) return todos;
  const first = ready[0];
  return todos.map((t) =>
    t.id === first.id ? { ...t, status: "in_progress" } : t,
  );
}
