import { describe, expect, it } from "vitest";
import {
  findLeafCwd,
  firstLeafSlotId,
  hasLeaf,
  isLeaf,
  leafIds,
  nextLeafId,
  removeLeaf,
  setLeafCwd,
  siblingLeafOf,
  splitLeaf,
  swapLeafInDirection,
  type PaneNode,
} from "./panes";

const leaf = (id: number, cwd?: string): PaneNode => ({
  kind: "leaf",
  id,
  ...(cwd !== undefined ? { cwd } : {}),
});

const split = (
  id: number,
  dir: "row" | "col",
  children: PaneNode[],
): PaneNode => ({ kind: "split", id, dir, children });

// row[ A(1,/a) | col[ B(2) | C(3,/c) ] | D(4) ]
const TREE: PaneNode = split(10, "row", [
  leaf(1, "/a"),
  split(20, "col", [leaf(2), leaf(3, "/c")]),
  leaf(4),
]);

describe("isLeaf / leafIds", () => {
  it("distinguishes leaves from splits", () => {
    expect(isLeaf(leaf(1))).toBe(true);
    expect(isLeaf(TREE)).toBe(false);
  });

  it("collects leaf ids in order, including nested splits", () => {
    expect(leafIds(TREE)).toEqual([1, 2, 3, 4]);
    expect(leafIds(leaf(9))).toEqual([9]);
  });
});

describe("firstLeafSlotId", () => {
  it("returns slotId when present, else the leaf id", () => {
    expect(firstLeafSlotId({ kind: "leaf", id: 5, slotId: 7 })).toBe(7);
    expect(firstLeafSlotId(leaf(5))).toBe(5);
  });

  it("recurses to the first child of a split", () => {
    expect(firstLeafSlotId(TREE)).toBe(1);
    expect(firstLeafSlotId(split(1, "col", [leaf(2), leaf(3)]))).toBe(2);
  });
});

describe("findLeafCwd", () => {
  it("finds the cwd of a matching leaf", () => {
    expect(findLeafCwd(TREE, 3)).toBe("/c");
    expect(findLeafCwd(TREE, 1)).toBe("/a");
  });

  it("returns undefined when the leaf has no cwd or does not exist", () => {
    expect(findLeafCwd(TREE, 2)).toBeUndefined();
    expect(findLeafCwd(TREE, 99)).toBeUndefined();
  });
});

describe("setLeafCwd", () => {
  it("returns the same node when nothing changes", () => {
    const same = setLeafCwd(TREE, 1, "/a");
    expect(same).toBe(TREE);
  });

  it("returns a new leaf when the cwd changes", () => {
    const next = setLeafCwd(TREE, 1, "/new");
    expect(next).not.toBe(TREE);
    expect(findLeafCwd(next, 1)).toBe("/new");
    expect(findLeafCwd(next, 3)).toBe("/c");
  });

  it("leaves other leaves untouched", () => {
    const next = setLeafCwd(TREE, 3, "/z");
    expect(findLeafCwd(next, 3)).toBe("/z");
    expect(findLeafCwd(next, 1)).toBe("/a");
  });
});

describe("splitLeaf", () => {
  it("appends a sibling when the enclosing split already runs in dir", () => {
    const next = splitLeaf(TREE, 1, 90, 91, "row");
    // row now has A, new leaf, col, D
    expect(next.kind).toBe("split");
    if (next.kind !== "split") return;
    expect(next.children.map((c) => (c.kind === "leaf" ? c.id : c.id))).toEqual(
      [1, 91, 20, 4],
    );
  });

  it("wraps a leaf in a new split when no same-dir parent matches", () => {
    // Split col[ B(2) | C(3) ] around leaf 2 in "row" direction.
    const col = split(20, "col", [leaf(2), leaf(3)]);
    const next = splitLeaf(col, 2, 90, 91, "row", "/new");
    expect(next).toEqual(
      split(20, "col", [split(90, "row", [leaf(2), leaf(91, "/new")]), leaf(3)]),
    );
  });

  it("is a no-op for an unknown target leaf", () => {
    const col = split(20, "col", [leaf(2), leaf(3)]);
    expect(splitLeaf(col, 99, 90, 91, "row")).toEqual(col);
  });
});

describe("removeLeaf", () => {
  it("returns null when removing the only leaf", () => {
    expect(removeLeaf(leaf(1), 1)).toBeNull();
  });

  it("collapses single-child splits left behind", () => {
    const next = removeLeaf(TREE, 4);
    // Removed D(4); row[ A | col[ B | C ] ] stays.
    expect(next).toEqual(split(10, "row", [leaf(1, "/a"), split(20, "col", [leaf(2), leaf(3, "/c")])]));
  });

  it("keeps the tree unchanged when the target is absent", () => {
    expect(removeLeaf(TREE, 99)).toEqual(TREE);
  });
});

describe("nextLeafId", () => {
  it("wraps around the ordered leaf ids", () => {
    expect(nextLeafId(TREE, 2, 1)).toBe(3);
    expect(nextLeafId(TREE, 4, 1)).toBe(1);
    expect(nextLeafId(TREE, 1, -1)).toBe(4);
  });

  it("falls back to the first leaf when current is unknown", () => {
    expect(nextLeafId(TREE, 99, 1)).toBe(1);
  });
});

describe("siblingLeafOf", () => {
  it("prefers the next sibling, then the previous", () => {
    const row = split(10, "row", [leaf(1), leaf(2), leaf(3)]);
    expect(siblingLeafOf(row, 1)).toBe(2); // next sibling
    expect(siblingLeafOf(row, 3)).toBe(2); // no next -> previous
  });

  it("treats a nested split as its first leaf for sibling selection", () => {
    // A's next sibling is the col split, whose first leaf is B(2).
    expect(siblingLeafOf(TREE, 1)).toBe(2);
    expect(siblingLeafOf(TREE, 4)).toBe(2); // D's previous sibling -> col -> B
  });

  it("returns null for a lone leaf or unknown id", () => {
    expect(siblingLeafOf(leaf(1), 1)).toBeNull();
    expect(siblingLeafOf(TREE, 99)).toBeNull();
  });
});

describe("hasLeaf", () => {
  it("reports presence across nested splits", () => {
    expect(hasLeaf(TREE, 3)).toBe(true);
    expect(hasLeaf(TREE, 9)).toBe(false);
  });
});

describe("swapLeafInDirection", () => {
  it("swaps two leaves within a simple row, tagging each with its slot", () => {
    const row = split(10, "row", [leaf(1, "/a"), leaf(2, "/b")]);
    const next = swapLeafInDirection(row, 1, "right");
    expect(next).toEqual(
      split(10, "row", [
        { kind: "leaf", id: 2, cwd: "/b", slotId: 1 },
        { kind: "leaf", id: 1, cwd: "/a", slotId: 2 },
      ]),
    );
  });

  it("preserves slotIds when swapping", () => {
    const a: PaneNode = { kind: "leaf", id: 1, slotId: 7, cwd: "/a" };
    const b: PaneNode = { kind: "leaf", id: 2, slotId: 8, cwd: "/b" };
    const row = split(10, "row", [a, b]);
    const next = swapLeafInDirection(row, 1, "right");
    expect(next).toEqual(split(10, "row", [{ ...b, slotId: 7 }, { ...a, slotId: 8 }]));
  });

  it("is a no-op with fewer than two leaves or an unknown active leaf", () => {
    expect(swapLeafInDirection(leaf(1), 1, "right")).toEqual(leaf(1));
    expect(swapLeafInDirection(TREE, 99, "right")).toBe(TREE);
  });

  it("prefers live bounds when a complete layout is provided", () => {
    const row = split(10, "row", [leaf(1), leaf(2)]);
    const bounds = [
      { id: 1, left: 0, right: 5, top: 0, bottom: 10 },
      { id: 2, left: 5, right: 10, top: 0, bottom: 10 },
    ];
    const next = swapLeafInDirection(row, 1, "right", bounds);
    expect(next).toEqual(
      split(10, "row", [
        { kind: "leaf", id: 2, slotId: 1 },
        { kind: "leaf", id: 1, slotId: 2 },
      ]),
    );
  });
});
