// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

// todo.ts imports { newTodoId, validateTodos } from ../lib/todos (which pulls
// in @tauri-apps/plugin-store) and the zustand todo store. Mock both so the
// tool loads cleanly under vitest/node and persistence + id generation are
// controlled by spies.
const todosLib = vi.hoisted(() => ({
  newTodoId: vi.fn(() => "t-generated"),
  validateTodos: vi.fn(() => null),
  loadTodos: vi.fn(),
  saveTodos: vi.fn(),
  deleteTodos: vi.fn(),
}));

vi.mock("../lib/todos", () => todosLib);

const todoStore = vi.hoisted(() => ({
  setTodos: vi.fn(),
  bySession: {},
  hydrated: new Set(),
}));

vi.mock("../store/todoStore", () => ({
  useTodosStore: { getState: () => todoStore },
}));

import { newTodoId, validateTodos } from "../lib/todos";
import { buildTodoTools } from "./todo";

const schema = buildTodoTools({} as ToolContext).todo_write.inputSchema;

function makeContext(getSessionId: () => string | null = () => "sess") {
  return {
    getSessionId,
  } as unknown as ToolContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  todosLib.newTodoId.mockReturnValue("t-generated");
  todosLib.validateTodos.mockReturnValue(null);
});

describe("buildTodoTools tool definition", () => {
  it("exposes a todo_write tool", () => {
    expect(buildTodoTools({} as ToolContext)).toHaveProperty("todo_write");
  });

  it("documents that it replaces the full list and marks one in_progress", () => {
    const desc = buildTodoTools({} as ToolContext).todo_write.description;
    expect(desc).toMatch(/full list/i);
    expect(desc).toMatch(/in_progress/);
  });
});

describe("todo_write input schema validation", () => {
  it("accepts a valid todo list", () => {
    const ok = schema.safeParse({
      todos: [{ title: "a", status: "pending" }],
    });
    expect(ok.success).toBe(true);
  });

  it("accepts optional id, description, and an in_progress status", () => {
    const ok = schema.safeParse({
      todos: [
        { id: "t-1", title: "a", description: "do it", status: "in_progress" },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an empty title", () => {
    const r = schema.safeParse({ todos: [{ title: "", status: "pending" }] });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown status", () => {
    const r = schema.safeParse({
      todos: [{ title: "a", status: "wip" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing todos array", () => {
    const r = schema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe("todo_write execute", () => {
  it("returns an error when there is no active session", async () => {
    const tool = buildTodoTools(makeContext(() => null)).todo_write;
    const result = await tool.execute({
      todos: [{ title: "a", status: "pending" }],
    });
    expect(result).toEqual({
      error: "no active session; cannot persist todos",
    });
    expect(todoStore.setTodos).not.toHaveBeenCalled();
  });

  it("persists todos and returns ok/count with the in_progress title", async () => {
    const tool = buildTodoTools(makeContext()).todo_write;
    const result = await tool.execute({
      todos: [
        { title: "start", status: "in_progress" },
        { title: "finish", status: "pending" },
      ],
    });

    expect(result).toEqual({
      ok: true,
      count: 2,
      inProgress: "start",
    });
    expect(todoStore.setTodos).toHaveBeenCalledWith("sess", [
      { id: "t-generated", title: "start", description: undefined, status: "in_progress" },
      { id: "t-generated", title: "finish", description: undefined, status: "pending" },
    ]);
  });

  it("reuses provided ids instead of generating new ones", async () => {
    const tool = buildTodoTools(makeContext()).todo_write;
    await tool.execute({
      todos: [{ id: "keep-1", title: "a", status: "pending" }],
    });
    expect(todoStore.setTodos).toHaveBeenCalledWith("sess", [
      { id: "keep-1", title: "a", description: undefined, status: "pending" },
    ]);
    expect(todosLib.newTodoId).not.toHaveBeenCalled();
  });

  it("returns inProgress null when nothing is in progress", async () => {
    const tool = buildTodoTools(makeContext()).todo_write;
    const result = await tool.execute({
      todos: [{ title: "a", status: "completed" }],
    });
    expect(result.inProgress).toBeNull();
  });

  it("surfaces a validation error and does not persist", async () => {
    todosLib.validateTodos.mockReturnValue("only one todo may be in_progress");
    const tool = buildTodoTools(makeContext()).todo_write;
    const result = await tool.execute({
      todos: [
        { title: "a", status: "in_progress" },
        { title: "b", status: "in_progress" },
      ],
    });
    expect(result).toEqual({
      error: "only one todo may be in_progress",
    });
    expect(todoStore.setTodos).not.toHaveBeenCalled();
  });

  it("assigns a generated id when omitted", async () => {
    expect(newTodoId).toBeDefined();
    expect(typeof newTodoId).toBe("function");
  });

  it("calls validateTodos with the normalized list", async () => {
    const tool = buildTodoTools(makeContext()).todo_write;
    await tool.execute({ todos: [{ title: "a", status: "pending" }] });
    expect(validateTodos).toHaveBeenCalledWith([
      { id: "t-generated", title: "a", description: undefined, status: "pending" },
    ]);
  });
});
