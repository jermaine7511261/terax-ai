// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ lang: "en", t: (key: string) => key }),
  tStatic: (key: string) => key,
  getLanguage: () => "en",
}));

const persist = vi.hoisted(() => ({
  loadTodos: vi.fn(),
  saveTodos: vi.fn(),
  deleteTodos: vi.fn(),
}));

vi.mock("../lib/todos", () => ({
  loadTodos: persist.loadTodos,
  saveTodos: persist.saveTodos,
  deleteTodos: persist.deleteTodos,
}));

import { useTodosStore } from "../store/todoStore";
import { TodoStrip } from "./TodoStrip";

function makeTodo(
  title: string,
  status: "pending" | "in_progress" | "completed",
) {
  return { id: `t-${title}`, title, status };
}

beforeEach(() => {
  persist.loadTodos.mockReset().mockResolvedValue([]);
  persist.saveTodos.mockReset().mockResolvedValue(undefined);
  persist.deleteTodos.mockReset().mockResolvedValue(undefined);
  useTodosStore.setState({ bySession: {}, hydrated: new Set() });
});

describe("TodoStrip", () => {
  it("renders todos after the agent writes them for the session", async () => {
    const { rerender } = render(<TodoStrip sessionId="sess-1" />);
    // Hydration completes with an empty list; strip stays hidden.
    expect(screen.queryByText("ai.todos")).not.toBeInTheDocument();

    act(() => {
      useTodosStore
        .getState()
        .setTodos("sess-1", [
          makeTodo("a", "pending"),
          makeTodo("b", "in_progress"),
        ]);
    });
    rerender(<TodoStrip sessionId="sess-1" />);

    expect(screen.getByText("ai.todos")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("does not leak another session's todos into this strip", async () => {
    act(() => {
      useTodosStore
        .getState()
        .setTodos("sess-2", [makeTodo("other", "pending")]);
    });
    render(<TodoStrip sessionId="sess-1" />);
    // Drain the hydration microtask (sess-1 hydrates to an empty list).
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("other")).not.toBeInTheDocument();
    expect(screen.queryByText("ai.todos")).not.toBeInTheDocument();
  });

  it("survives the hydrate-vs-write race: agent todos are not wiped by a late hydrate", async () => {
    // Hydration is slow (plugin store read pending); the agent writes todos
    // first, then the stale persistence read resolves to the old empty list.
    let resolveLoad!: (v: unknown[]) => void;
    persist.loadTodos.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    render(<TodoStrip sessionId="sess-1" />);

    act(() => {
      useTodosStore
        .getState()
        .setTodos("sess-1", [makeTodo("live", "in_progress")]);
    });
    expect(screen.getByText("live")).toBeInTheDocument();

    // Late hydration must NOT clobber the fresh in-memory todos.
    act(() => {
      resolveLoad([]);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(useTodosStore.getState().bySession["sess-1"]).toHaveLength(1);
  });
});
