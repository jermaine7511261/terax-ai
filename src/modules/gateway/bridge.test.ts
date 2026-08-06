import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  consumePendingGatewayMeta,
  setPendingGatewayMeta,
  type GatewayMessageMeta,
} from "./bridge";

const meta: GatewayMessageMeta = {
  platform: "weixin",
  chatId: "chat-1",
  chatType: "dm",
  senderId: "user-1",
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pending gateway meta", () => {
  it("round-trips a pending meta through set then consume", () => {
    setPendingGatewayMeta(meta);
    expect(consumePendingGatewayMeta()).toEqual(meta);
    // consumed once, second read is null
    expect(consumePendingGatewayMeta()).toBeNull();
  });

  it("returns null when nothing is pending", () => {
    expect(consumePendingGatewayMeta()).toBeNull();
  });

  it("drops the pending meta after the reply timeout", () => {
    setPendingGatewayMeta(meta);
    vi.advanceTimersByTime(120_000);
    expect(consumePendingGatewayMeta()).toBeNull();
  });

  it("replacing the meta resets the timeout window", () => {
    setPendingGatewayMeta(meta);
    vi.advanceTimersByTime(60_000);
    setPendingGatewayMeta({ ...meta, chatId: "chat-2" });
    vi.advanceTimersByTime(60_000);
    expect(consumePendingGatewayMeta()).toEqual({ ...meta, chatId: "chat-2" });
  });
});
