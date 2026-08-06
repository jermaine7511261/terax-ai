import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// notify.ts caches the granted permission in a module-level flag, so each
// test gets a fresh module instance to exercise the caching behavior.

const mockGranted = vi.mocked(isPermissionGranted);
const mockRequest = vi.mocked(requestPermission);
const mockSend = vi.mocked(sendNotification);

beforeEach(() => {
  vi.resetModules();
  mockGranted.mockReset();
  mockRequest.mockReset();
  mockSend.mockReset();
});

async function osNotify(title: string, body: string): Promise<void> {
  const mod = await import("./notify");
  return mod.osNotify(title, body);
}

describe("osNotify", () => {
  it("sends a notification when permission is already granted", async () => {
    mockGranted.mockResolvedValue(true);
    await osNotify("Title", "Body");
    expect(mockSend).toHaveBeenCalledWith({ title: "Title", body: "Body" });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("requests permission when it has not been granted yet", async () => {
    mockGranted.mockResolvedValue(false);
    mockRequest.mockResolvedValue("granted");
    await osNotify("T", "B");
    expect(mockRequest).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalled();
  });

  it("does not send when the permission request is denied", async () => {
    mockGranted.mockResolvedValue(false);
    mockRequest.mockResolvedValue("denied");
    await osNotify("T", "B");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("swallows permission-API failures", async () => {
    mockGranted.mockRejectedValue(new Error("nope"));
    await expect(osNotify("T", "B")).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("caches the granted permission across calls within one session", async () => {
    mockGranted.mockResolvedValue(true);
    const mod = await import("./notify");
    await mod.osNotify("T", "B");
    await mod.osNotify("T", "B");
    expect(mockGranted).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
