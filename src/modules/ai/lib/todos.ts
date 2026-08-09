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

const STORE_PATH = "yamet-ai-todos.json";
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
