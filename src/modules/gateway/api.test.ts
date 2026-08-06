import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  gatewayAuthorize,
  gatewayAutoApprove,
  gatewayCallbackUrls,
  gatewayConfigure,
  gatewayConnect,
  gatewayDisconnect,
  gatewayPlatforms,
  gatewayRevoke,
  gatewaySend,
  gatewaySessions,
  gatewayWeixinPersist,
} from "./api";

const mockInvoke = vi.mocked(invoke);

// Contract tests: lock the command name + payload shape so a serde rename or
// field drift on the Rust side is caught here instead of failing silently at
// runtime (the identityFile vs identity_file class of bug).
describe("gateway typed IPC", () => {
  it("gatewayPlatforms calls gateway_platforms", async () => {
    mockInvoke.mockResolvedValue([]);
    await gatewayPlatforms();
    expect(mockInvoke).toHaveBeenCalledWith("gateway_platforms");
  });

  it("gatewayCallbackUrls calls gateway_callback_urls", async () => {
    mockInvoke.mockResolvedValue([]);
    await gatewayCallbackUrls();
    expect(mockInvoke).toHaveBeenCalledWith("gateway_callback_urls");
  });

  it("gatewaySessions calls gateway_sessions", async () => {
    mockInvoke.mockResolvedValue([]);
    await gatewaySessions();
    expect(mockInvoke).toHaveBeenCalledWith("gateway_sessions");
  });

  it("gatewayConfigure forwards platform + configJson", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await gatewayConfigure("weixin", '{"x":1}');
    expect(mockInvoke).toHaveBeenCalledWith("gateway_configure", {
      platform: "weixin",
      configJson: '{"x":1}',
    });
  });

  it("gatewayConnect / gatewayDisconnect forward platform", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await gatewayConnect("dingtalk");
    expect(mockInvoke).toHaveBeenCalledWith("gateway_connect", {
      platform: "dingtalk",
    });
    await gatewayDisconnect("dingtalk");
    expect(mockInvoke).toHaveBeenCalledWith("gateway_disconnect", {
      platform: "dingtalk",
    });
  });

  it("gatewaySend forwards platform/chatId/text/group", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await gatewaySend("wecom", "chat-1", "hello", true);
    expect(mockInvoke).toHaveBeenCalledWith("gateway_send", {
      platform: "wecom",
      chatId: "chat-1",
      text: "hello",
      group: true,
    });
  });

  it("gatewayAuthorize / gatewayRevoke use snake_case session_key", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await gatewayAuthorize("sess-1");
    expect(mockInvoke).toHaveBeenCalledWith("gateway_authorize", {
      session_key: "sess-1",
    });
    await gatewayRevoke("sess-1");
    expect(mockInvoke).toHaveBeenCalledWith("gateway_revoke", {
      session_key: "sess-1",
    });
  });

  it("gatewayAutoApprove forwards session_key + value", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await gatewayAutoApprove("sess-1", true);
    expect(mockInvoke).toHaveBeenCalledWith("gateway_auto_approve", {
      session_key: "sess-1",
      value: true,
    });
  });

  it("gatewayWeixinPersist uses snake_case account_id/base_url (not camelCase)", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await gatewayWeixinPersist({
      account_id: "acc",
      token: "tok",
      base_url: "http://localhost",
    });
    expect(mockInvoke).toHaveBeenCalledWith("gateway_weixin_persist", {
      account_id: "acc",
      token: "tok",
      base_url: "http://localhost",
    });
    // Guards the serde shape: the Rust command expects snake_case.
    const arg = mockInvoke.mock.calls[mockInvoke.mock.calls.length - 1][1];
    expect(arg).not.toHaveProperty("accountId");
    expect(arg).not.toHaveProperty("baseUrl");
  });
});
