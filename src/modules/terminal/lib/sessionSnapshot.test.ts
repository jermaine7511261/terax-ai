import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    createDir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}));

vi.mock("@/platform", () => ({
  homeDir: vi.fn().mockResolvedValue("C:\\Users\\test"),
}));

import { homeDir } from "@/platform";
import { native } from "@/modules/ai/lib/native";
import {
  clearBusyMarker,
  clearTerminalSnapshot,
  hasBusyMarker,
  loadTerminalSnapshot,
  saveBusyMarker,
  saveTerminalSnapshot,
} from "./sessionSnapshot";

const mockNative = vi.mocked(native);
const mockHomeDir = vi.mocked(homeDir);

beforeEach(() => {
  mockNative.createDir.mockReset();
  mockNative.writeFile.mockReset();
  mockNative.readFile.mockReset();
  mockNative.deleteFile.mockReset();
  mockHomeDir.mockClear();
  mockHomeDir.mockResolvedValue("C:\\Users\\test");
});

afterEach(() => {
  vi.resetModules();
});

describe("busy markers", () => {
  it("writes a busy marker under the sessions dir", async () => {
    await saveBusyMarker(7);
    expect(mockNative.createDir).toHaveBeenCalledWith(
      "C:/Users/test/.yamet/sessions",
    );
    expect(mockNative.writeFile).toHaveBeenCalledWith(
      "C:/Users/test/.yamet/sessions/7.busy",
      "1",
    );
  });

  it("reports a busy marker when it exists", async () => {
    mockNative.readFile.mockResolvedValue({ kind: "text", content: "1", size: 1 });
    await expect(hasBusyMarker(7)).resolves.toBe(true);
  });

  it("reports no busy marker when read fails", async () => {
    mockNative.readFile.mockRejectedValue(new Error("missing"));
    await expect(hasBusyMarker(7)).resolves.toBe(false);
  });

  it("clears a busy marker", async () => {
    await clearBusyMarker(7);
    expect(mockNative.deleteFile).toHaveBeenCalledWith(
      "C:/Users/test/.yamet/sessions/7.busy",
    );
  });
});

describe("terminal snapshots", () => {
  it("saves snapshot text under the sessions dir", async () => {
    await saveTerminalSnapshot(3, "hello terminal");
    expect(mockNative.writeFile).toHaveBeenCalledWith(
      "C:/Users/test/.yamet/sessions/3.snap",
      "hello terminal",
    );
  });

  it("truncates oversized snapshots to the 4 MiB cap", async () => {
    const big = "a".repeat(5 * 1024 * 1024);
    await saveTerminalSnapshot(3, big);
    const written = mockNative.writeFile.mock.calls[0]![1] as string;
    expect(written).toHaveLength(4 * 1024 * 1024);
  });

  it("skips saving empty snapshots", async () => {
    await saveTerminalSnapshot(3, "");
    expect(mockNative.writeFile).not.toHaveBeenCalled();
  });

  it("loads a text snapshot back", async () => {
    mockNative.readFile.mockResolvedValue({ kind: "text", content: "hi", size: 2 });
    await expect(loadTerminalSnapshot(3)).resolves.toBe("hi");
  });

  it("returns null for non-text or failed reads", async () => {
    mockNative.readFile.mockResolvedValue({ kind: "binary" } as never);
    await expect(loadTerminalSnapshot(3)).resolves.toBeNull();

    mockNative.readFile.mockRejectedValue(new Error("missing"));
    await expect(loadTerminalSnapshot(3)).resolves.toBeNull();
  });

  it("clears a snapshot", async () => {
    await clearTerminalSnapshot(3);
    expect(mockNative.deleteFile).toHaveBeenCalledWith(
      "C:/Users/test/.yamet/sessions/3.snap",
    );
  });
});
