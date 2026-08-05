// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

// todoStore imports { loadTodos, saveTodos, deleteTodos } from ../lib/todos,
// which pulls in @tauri-apps/plugin-store. Mock the lib module so the store
// loads cleanly under vitest/node and persistence is asserted against
// controllable spies.
vi.mock("../lib/todos", () => ({
  loadTodos: vi.fn(),
  saveTodos: vi.fn(),
  deleteTodos: vi.fn(),
}));

import {
  loadTodos as persistLoad,
  saveTodos as persistSave,
  deleteTodos as persistDelete,
  type Todo,
} from "../lib/todos";
import { getTodos, useTodosStore } from "./todoStore";

const mockedLoad = persistLoad as ReturnType<typeof vi.fn>;
const mockedSave = persistSave as ReturnType<typeof vi.fn>;
const mockedDelete = persistDelete as ReturnType<typeof vi.fn>;

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "t-1",
    title: "Write tests",
    description: undefined,
    status: "pending",
    ...overrides,
  };
}

describe("useTodosStore", () => {
  beforeEach(() => {
    useTodosStore.setState({ bySession: {}, hydrated: new Set() });
    mockedLoad.mockReset();
    mockedSave.mockReset();
    mockedDelete.mockReset();
  });

  it("starts empty with no hydrated sessions", () => {
    const s = useTodosStore.getState();
    expect(s.bySession).toEqual({});
    expect(s.hydrated.size).toBe(0);
  });

  describe("hydrate", () => {
    it("loads todos from persistence and marks the session hydrated", async () => {
      const loaded = [makeTodo({ id: "a" })];
      mockedLoad.mockResolvedValue(loaded);

      await useTodosStore.getState().hydrate("sess-1");

      expect(mockedLoad).toHaveBeenCalledWith("sess-1");
      const s = useTodosStore.getState();
      expect(s.bySession["sess-1"]).toEqual(loaded);
      expect(s.hydrated.has("sess-1")).toBe(true);
    });

    it("defaults a session with no persisted todos to an empty list", async () => {
      mockedLoad.mockResolvedValue([]);

      await useTodosStore.getState().hydrate("sess-1");

      expect(useTodosStore.getState().bySession["sess-1"]).toEqual([]);
      expect(useTodosStore.getState().hydrated.has("sess-1")).toBe(true);
    });

    it("does not re-fetch or overwrite an already hydrated session", async () => {
      mockedLoad.mockResolvedValueOnce([makeTodo({ id: "a" })]);
      await useTodosStore.getState().hydrate("sess-1");
      expect(mockedLoad).toHaveBeenCalledTimes(1);

      mockedLoad.mockResolvedValue([makeTodo({ id: "b" })]);
      await useTodosStore.getState().hydrate("sess-1");

      expect(mockedLoad).toHaveBeenCalledTimes(1);
      expect(useTodosStore.getState().bySession["sess-1"]).toEqual([
        makeTodo({ id: "a" }),
      ]);
    });

    it("tracks hydration per session independently", async () => {
      mockedLoad.mockResolvedValue([]);
      await useTodosStore.getState().hydrate("sess-1");
      await useTodosStore.getState().hydrate("sess-2");

      const s = useTodosStore.getState();
      expect(s.hydrated.has("sess-1")).toBe(true);
      expect(s.hydrated.has("sess-2")).toBe(true);
      expect(mockedLoad).toHaveBeenCalledTimes(2);
    });
  });

  describe("setTodos", () => {
    it("stores todos for a session and persists them", () => {
      const todos = [makeTodo()];
      useTodosStore.getState().setTodos("sess-1", todos);

      expect(useTodosStore.getState().bySession["sess-1"]).toEqual(todos);
      expect(mockedSave).toHaveBeenCalledWith("sess-1", todos);
    });

    it("replaces the existing list for a session", () => {
      useTodosStore.getState().setTodos("sess-1", [makeTodo({ id: "a" })]);
      useTodosStore.getState().setTodos("sess-1", [makeTodo({ id: "b" })]);

      expect(useTodosStore.getState().bySession["sess-1"].map((t) => t.id)).toEqual([
        "b",
      ]);
      expect(mockedSave).toHaveBeenLastCalledWith("sess-1", [
        makeTodo({ id: "b" }),
      ]);
    });

    it("scopes todos per session without cross-contamination", () => {
      useTodosStore.getState().setTodos("sess-1", [makeTodo({ id: "a" })]);
      useTodosStore.getState().setTodos("sess-2", [makeTodo({ id: "b" })]);

      const s = useTodosStore.getState();
      expect(s.bySession["sess-1"].map((t) => t.id)).toEqual(["a"]);
      expect(s.bySession["sess-2"].map((t) => t.id)).toEqual(["b"]);
    });
  });

  describe("clearSession", () => {
    it("removes the session's todos and hydration marker and deletes persistence", async () => {
      useTodosStore.setState({
        bySession: { "sess-1": [makeTodo()], "sess-2": [makeTodo()] },
        hydrated: new Set(["sess-1", "sess-2"]),
      });
      mockedDelete.mockResolvedValue(undefined);

      await useTodosStore.getState().clearSession("sess-1");

      const s = useTodosStore.getState();
      expect(s.bySession).toEqual({ "sess-2": [makeTodo()] });
      expect(s.hydrated.has("sess-1")).toBe(false);
      expect(s.hydrated.has("sess-2")).toBe(true);
      expect(mockedDelete).toHaveBeenCalledWith("sess-1");
    });

    it("is a no-op for an unknown session", async () => {
      mockedDelete.mockResolvedValue(undefined);
      await useTodosStore.getState().clearSession("nope");
      expect(useTodosStore.getState().bySession).toEqual({});
    });
  });
});

describe("getTodos", () => {
  beforeEach(() => {
    useTodosStore.setState({ bySession: {}, hydrated: new Set() });
  });

  it("returns the todos for a session", () => {
    const todos = [makeTodo({ id: "a" })];
    useTodosStore.setState({ bySession: { "sess-1": todos } });
    expect(getTodos("sess-1")).toEqual(todos);
  });

  it("returns an empty list for a session with no todos", () => {
    expect(getTodos("sess-1")).toEqual([]);
  });

  it("returns an empty list for a null or undefined session id", () => {
    expect(getTodos(null)).toEqual([]);
    expect(getTodos(undefined)).toEqual([]);
  });
});
