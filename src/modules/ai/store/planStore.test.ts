import { beforeEach, describe, expect, it, vi } from "vitest";

// planStore imports `native` from ../lib/native, which pulls in
// @tauri-apps/api and @/modules/workspace. Mock it so the module loads
// cleanly under vitest/node and so applyAll() can be asserted against a
// controllable backend.
vi.mock("../lib/native", () => ({
  native: {
    writeFile: vi.fn(),
    createDir: vi.fn(),
  },
}));

import { newQueuedEditId, usePlanStore } from "./planStore";
import { native } from "../lib/native";

const mockedNative = native as unknown as {
  writeFile: ReturnType<typeof vi.fn>;
  createDir: ReturnType<typeof vi.fn>;
};

function makeQueuedEdit(
  overrides: Partial<{
    id: string;
    kind: "write_file" | "edit" | "multi_edit" | "apply_patch" | "create_directory";
    path: string;
    originalContent: string;
    proposedContent: string;
    isNewFile: boolean;
    description?: string;
  }> = {},
) {
  return {
    id: "id-1",
    kind: "write_file" as const,
    path: "/tmp/a.txt",
    originalContent: "old",
    proposedContent: "new",
    isNewFile: false,
    ...overrides,
  };
}

describe("newQueuedEditId", () => {
  it("matches the q-<base36>-<base36> format", () => {
    expect(newQueuedEditId()).toMatch(/^q-[0-9a-z]+-[0-9a-z]+$/);
  });

  it("returns unique ids across successive calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newQueuedEditId());
    expect(ids.size).toBe(1000);
  });

  it("increments the trailing counter across calls", () => {
    const a = newQueuedEditId();
    const b = newQueuedEditId();
    const counterA = a.split("-")[2];
    const counterB = b.split("-")[2];
    // base36: '1' -> '10' -> '11' ...
    expect(parseInt(counterB, 36)).toBeGreaterThan(parseInt(counterA, 36));
  });
});

describe("usePlanStore", () => {
  beforeEach(() => {
    usePlanStore.setState({ active: false, queue: [] });
    mockedNative.writeFile.mockReset();
    mockedNative.createDir.mockReset();
  });

  it("starts inactive with an empty queue", () => {
    const s = usePlanStore.getState();
    expect(s.active).toBe(false);
    expect(s.queue).toEqual([]);
  });

  it("enqueue appends edits in order", () => {
    const { enqueue } = usePlanStore.getState();
    enqueue(makeQueuedEdit({ id: "a", path: "/p/a" }));
    enqueue(makeQueuedEdit({ id: "b", path: "/p/b" }));
    expect(usePlanStore.getState().queue.map((q) => q.id)).toEqual(["a", "b"]);
  });

  it("removeOne removes only the matching edit", () => {
    const { enqueue, removeOne } = usePlanStore.getState();
    enqueue(makeQueuedEdit({ id: "a" }));
    enqueue(makeQueuedEdit({ id: "b" }));
    enqueue(makeQueuedEdit({ id: "c" }));
    removeOne("b");
    expect(usePlanStore.getState().queue.map((q) => q.id)).toEqual(["a", "c"]);
  });

  it("removeOne on a missing id is a no-op", () => {
    const { enqueue, removeOne } = usePlanStore.getState();
    enqueue(makeQueuedEdit({ id: "a" }));
    removeOne("nope");
    expect(usePlanStore.getState().queue.map((q) => q.id)).toEqual(["a"]);
  });

  it("clear empties the queue", () => {
    const { enqueue, clear } = usePlanStore.getState();
    enqueue(makeQueuedEdit({ id: "a" }));
    enqueue(makeQueuedEdit({ id: "b" }));
    clear();
    expect(usePlanStore.getState().queue).toEqual([]);
  });

  it("enable sets active true without clearing the queue", () => {
    const { enqueue, enable } = usePlanStore.getState();
    enqueue(makeQueuedEdit({ id: "a" }));
    enable();
    const s = usePlanStore.getState();
    expect(s.active).toBe(true);
    expect(s.queue).toHaveLength(1);
  });

  it("disable sets active false and clears the queue", () => {
    const { enqueue, disable } = usePlanStore.getState();
    enqueue(makeQueuedEdit({ id: "a" }));
    disable();
    const s = usePlanStore.getState();
    expect(s.active).toBe(false);
    expect(s.queue).toEqual([]);
  });

  it("toggle flips active state", () => {
    const { toggle } = usePlanStore.getState();
    expect(usePlanStore.getState().active).toBe(false);
    toggle();
    expect(usePlanStore.getState().active).toBe(true);
    toggle();
    expect(usePlanStore.getState().active).toBe(false);
  });

  it("toggle from active clears the queue", () => {
    usePlanStore.setState({ active: true, queue: [makeQueuedEdit({ id: "a" })] });
    usePlanStore.getState().toggle();
    const s = usePlanStore.getState();
    expect(s.active).toBe(false);
    expect(s.queue).toEqual([]);
  });

  it("applyAll writes files for non-create_directory edits and clears the queue", async () => {
    const { enqueue, applyAll } = usePlanStore.getState();
    enqueue(makeQueuedEdit({ id: "w1", path: "/p/1", proposedContent: "c1" }));
    enqueue(
      makeQueuedEdit({
        id: "w2",
        path: "/p/2",
        proposedContent: "c2",
        kind: "edit",
      }),
    );
    mockedNative.writeFile.mockResolvedValue(undefined);

    const results = await applyAll();

    expect(mockedNative.writeFile).toHaveBeenCalledWith("/p/1", "c1");
    expect(mockedNative.writeFile).toHaveBeenCalledWith("/p/2", "c2");
    expect(results).toEqual([
      { id: "w1", ok: true },
      { id: "w2", ok: true },
    ]);
    expect(usePlanStore.getState().queue).toEqual([]);
  });

  it("applyAll creates directories for create_directory edits", async () => {
    const { enqueue, applyAll } = usePlanStore.getState();
    enqueue(
      makeQueuedEdit({
        id: "dir1",
        path: "/dir/new",
        kind: "create_directory",
      }),
    );
    mockedNative.createDir.mockResolvedValue(undefined);

    const results = await applyAll();

    expect(mockedNative.createDir).toHaveBeenCalledWith("/dir/new");
    expect(results).toEqual([{ id: "dir1", ok: true }]);
  });

  it("applyAll reports failures without aborting and clears the queue", async () => {
    const { enqueue, applyAll } = usePlanStore.getState();
    enqueue(makeQueuedEdit({ id: "ok", path: "/p/ok" }));
    enqueue(makeQueuedEdit({ id: "bad", path: "/p/bad" }));
    mockedNative.writeFile.mockImplementation(async (path: string) => {
      if (path === "/p/bad") throw new Error("boom");
    });

    const results = await applyAll();

    expect(results).toEqual([
      { id: "ok", ok: true },
      { id: "bad", ok: false, error: "Error: boom" },
    ]);
    expect(usePlanStore.getState().queue).toEqual([]);
  });
});
