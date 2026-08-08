import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMock = vi.hoisted(() => ({
  saveState: vi.fn(async () => {}),
  saveSpacesList: vi.fn(async () => {}),
  saveActiveId: vi.fn(async () => {}),
  saveRecent: vi.fn(async () => {}),
  deleteSpaceData: vi.fn(async () => {}),
  newSpaceId: () => "space-new",
  recentWith: (list: string[], id: string) =>
    [id, ...list.filter((x) => x !== id)].slice(0, 8),
}));

vi.mock("./store", () => storeMock);

import { useSpaces } from "./useSpaces";

beforeEach(() => {
  storeMock.saveSpacesList.mockClear();
  storeMock.saveActiveId.mockClear();
  storeMock.saveRecent.mockClear();
  storeMock.deleteSpaceData.mockClear();
  useSpaces.setState({
    spaces: [],
    activeId: null,
    recent: [],
    hydrated: false,
    initialActiveIndex: {},
  });
});

describe("useSpaces", () => {
  it("hydrate sets spaces, active id, recents and marks hydrated", () => {
    const meta = { id: "s1", name: "one", root: "/a" };
    useSpaces.getState().hydrate([meta as never], "s1", { s2: 2 }, ["s1"]);
    expect(useSpaces.getState()).toMatchObject({
      spaces: [meta],
      activeId: "s1",
      recent: ["s1"],
      initialActiveIndex: { s2: 2 },
      hydrated: true,
    });
  });

  it("create appends a space and persists the list", () => {
    const s = useSpaces.getState().create({ name: "work", root: "/ws" });
    expect(s.id).toBe("space-new");
    expect(s.env).toEqual({ kind: "local" });
    expect(useSpaces.getState().spaces).toHaveLength(1);
    expect(storeMock.saveSpacesList).toHaveBeenCalledWith(
      useSpaces.getState().spaces,
    );
  });

  it("create keeps an explicit env", () => {
    const s = useSpaces
      .getState()
      .create({ name: "wsl", root: null, env: { kind: "wsl", distro: "U" } });
    expect(s.env).toEqual({ kind: "wsl", distro: "U" });
  });

  it("rename / setRoot / setEnv / setColor update the space and persist", () => {
    useSpaces.getState().hydrate(
      [{ id: "s1", name: "a", root: "/a", env: { kind: "local" }, createdAt: 0, updatedAt: 0 }],
      null,
    );
    const { rename, setRoot, setEnv, setColor } = useSpaces.getState();
    rename("s1", "b");
    setRoot("s1", "  /b  ");
    setEnv("s1", { kind: "wsl", distro: "U" });
    setColor("s1", 3);
    const s = useSpaces.getState().spaces[0];
    expect(s.name).toBe("b");
    expect(s.root).toBe("/b");
    expect(s.env).toEqual({ kind: "wsl", distro: "U" });
    expect(s.color).toBe(3);
    expect(storeMock.saveSpacesList).toHaveBeenCalled();
  });

  it("setRoot normalizes whitespace-only roots to null", () => {
    useSpaces.getState().hydrate(
      [{ id: "s1", name: "a", root: "/a", env: { kind: "local" }, createdAt: 0, updatedAt: 0 }],
      null,
    );
    useSpaces.getState().setRoot("s1", "   ");
    expect(useSpaces.getState().spaces[0].root).toBeNull();
  });

  it("reorder follows the given order and appends stragglers", () => {
    useSpaces.getState().hydrate(
      [
        { id: "a", name: "a", root: null, env: { kind: "local" }, createdAt: 0, updatedAt: 0 },
        { id: "b", name: "b", root: null, env: { kind: "local" }, createdAt: 0, updatedAt: 0 },
        { id: "c", name: "c", root: null, env: { kind: "local" }, createdAt: 0, updatedAt: 0 },
      ],
      null,
    );
    useSpaces.getState().reorder(["c", "b"]);
    expect(useSpaces.getState().spaces.map((s) => s.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(storeMock.saveSpacesList).toHaveBeenCalled();
  });

  it("reorder no-ops when the ordered list loses entries", () => {
    useSpaces.getState().hydrate(
      [
        { id: "a", name: "a", root: null, env: { kind: "local" }, createdAt: 0, updatedAt: 0 },
        { id: "b", name: "b", root: null, env: { kind: "local" }, createdAt: 0, updatedAt: 0 },
      ],
      null,
    );
    useSpaces.getState().reorder(["a"]);
    expect(useSpaces.getState().spaces.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("remove deletes the space and fixes the active id", () => {
    useSpaces.getState().hydrate(
      [
        { id: "a", name: "a", root: null, env: { kind: "local" }, createdAt: 0, updatedAt: 0 },
        { id: "b", name: "b", root: null, env: { kind: "local" }, createdAt: 0, updatedAt: 0 },
      ],
      "a",
    );
    const next = useSpaces.getState().remove("a");
    expect(next).toBe("b");
    expect(useSpaces.getState().spaces.map((s) => s.id)).toEqual(["b"]);
    expect(storeMock.deleteSpaceData).toHaveBeenCalledWith("a");
    expect(storeMock.saveActiveId).toHaveBeenCalledWith("b");
  });

  it("remove of an inactive space keeps the active id", () => {
    useSpaces.getState().hydrate(
      [
        { id: "a", name: "a", root: null, env: { kind: "local" }, createdAt: 0, updatedAt: 0 },
        { id: "b", name: "b", root: null, env: { kind: "local" }, createdAt: 0, updatedAt: 0 },
      ],
      "a",
    );
    useSpaces.getState().remove("b");
    expect(storeMock.saveActiveId).not.toHaveBeenCalled();
    expect(useSpaces.getState().activeId).toBe("a");
  });

  it("setActive persists and pushes to recent", () => {
    useSpaces.getState().hydrate([{ id: "a", name: "a", root: null, env: { kind: "local" }, createdAt: 0, updatedAt: 0 }], null);
    useSpaces.getState().setActive("a");
    expect(useSpaces.getState().activeId).toBe("a");
    expect(storeMock.saveActiveId).toHaveBeenCalledWith("a");
    expect(useSpaces.getState().recent).toEqual(["a"]);
  });

  it("setActive with the same id is a no-op", () => {
    useSpaces.getState().hydrate([{ id: "a", name: "a", root: null, env: { kind: "local" }, createdAt: 0, updatedAt: 0 }], "a");
    useSpaces.getState().setActive("a");
    expect(storeMock.saveActiveId).not.toHaveBeenCalled();
  });

  it("pushRecent dedupes and saves", () => {
    useSpaces.getState().hydrate([], null, {}, ["a", "b"]);
    useSpaces.getState().pushRecent("a");
    expect(useSpaces.getState().recent).toEqual(["a", "b"]);
    expect(storeMock.saveRecent).toHaveBeenCalled();
  });

  it("setRecent dedupes, caps at 8 and saves", () => {
    useSpaces.getState().setRecent(["a", "a", "b"]);
    expect(useSpaces.getState().recent).toEqual(["a", "b"]);
    useSpaces
      .getState()
      .setRecent(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(useSpaces.getState().recent).toHaveLength(8);
    expect(storeMock.saveRecent).toHaveBeenCalledTimes(2);
  });
});
