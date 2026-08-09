import { tool } from "ai";
import { z } from "zod";
import {
  applyTodoPatches,
  autoAdvanceReady,
  newTodoId,
  validateTodos,
  type Todo,
  type TodoPatch,
} from "../lib/todos";
import { getTodos, useTodosStore } from "../store/todoStore";
import type { ToolContext } from "./context";

const TodoStatus = z.enum(["pending", "in_progress", "completed"]);

const TodoSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "Stable id; generated if omitted. Reuse ids across calls to keep UI stable.",
    ),
  title: z.string().min(1),
  description: z.string().optional(),
  status: TodoStatus,
  dependencies: z
    .array(z.string())
    .optional()
    .describe(
      "Ids of other todos that must be completed before this one starts.",
    ),
});

const TodoPatchSchema = z.object({
  id: z.string().describe("Id of the todo to patch."),
  status: TodoStatus.optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
});

export function buildTodoTools(ctx: ToolContext) {
  return {
    todo_write: tool({
      description:
        "Manage your task list for a multi-step task (≥3 substantive steps). Two modes: pass the FULL list as `todos` to replace it, or pass `updates` to patch incrementally by id (mark one item `completed`; the next ready item auto-advances to `in_progress`). At most one item is ever `in_progress`. Auto-executes (no approval).",
      inputSchema: z
        .object({
          todos: z
            .array(TodoSchema)
            .optional()
            .describe("The complete replacement list for this task."),
          updates: z
            .array(TodoPatchSchema)
            .optional()
            .describe(
              "Incremental patches keyed by id — merge onto the current list instead of replacing it.",
            ),
        })
        .refine((v) => v.todos !== undefined || v.updates !== undefined, {
          message: "pass either `todos` (full list) or `updates` (patch)",
        }),
      execute: async ({ todos, updates }) => {
        const sessionId = ctx.getSessionId();
        if (!sessionId)
          return { error: "no active session; cannot persist todos" };
        if (todos === undefined && updates === undefined) {
          return { error: "pass either `todos` (full list) or `updates` (patch)" };
        }

        let merged: Todo[];
        if (todos) {
          merged = todos.map((t) => ({
            id: t.id ?? newTodoId(),
            title: t.title,
            description: t.description,
            status: t.status,
            dependencies: t.dependencies,
          }));
        } else {
          const current = getTodos(sessionId);
          merged = applyTodoPatches(
            current,
            (updates ?? []) as TodoPatch[],
          );
        }

        // Auto-advance: keep exactly one item in_progress.
        merged = autoAdvanceReady(merged);

        const err = validateTodos(merged);
        if (err) return { error: err };

        useTodosStore.getState().setTodos(sessionId, merged);

        return {
          ok: true,
          count: merged.length,
          inProgress:
            merged.find((t) => t.status === "in_progress")?.title ?? null,
        };
      },
    }),
  } as const;
}
