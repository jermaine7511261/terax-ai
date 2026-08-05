// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { WeixinReloginOverlay } from "./WeixinReloginOverlay";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ lang: "en", t: (key: string) => key }),
  tStatic: (key: string) => key,
  getLanguage: () => "en",
}));

const { listenMock, invokeMock } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  invokeMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: listenMock }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

type FramePayload = [string, unknown];

function captureHandler(): (payload: FramePayload) => void {
  let handler: (e: { payload: FramePayload }) => void = () => {};
  listenMock.mockImplementation((_event: string, h: typeof handler) => {
    handler = h;
    return Promise.resolve(() => {});
  });
  return (payload: FramePayload) => handler({ payload });
}

const QR = { kind: "qr", svg_data_url: "data:image/svg+xml;base64,abc" } as const;
const CONFIRMED = {
  kind: "confirmed",
  account_id: "wxid_1",
  token: "tok",
  base_url: "https://example.com",
} as const;

describe("WeixinReloginOverlay", () => {
  beforeEach(() => {
    listenMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("renders nothing before any platform event", () => {
    captureHandler();
    const { container } = render(<WeixinReloginOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the QR image and waiting hint on a weixin qr frame", async () => {
    const emit = captureHandler();
    render(<WeixinReloginOverlay />);
    await act(async () => {
      emit(["weixin", QR]);
    });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "data:image/svg+xml;base64,abc");
    expect(screen.getByText("gateway.reloginWaiting")).toBeInTheDocument();
  });

  it("switches to the scanned hint when a status frame reports scanned", async () => {
    const emit = captureHandler();
    render(<WeixinReloginOverlay />);
    await act(async () => {
      emit(["weixin", QR]);
      emit(["weixin", { kind: "status", status: "scanned" }]);
    });
    expect(screen.getByText("gateway.qrScanned")).toBeInTheDocument();
  });

  it("persists new credentials and shows done on a confirmed frame", async () => {
    const emit = captureHandler();
    render(<WeixinReloginOverlay />);
    await act(async () => {
      emit(["weixin", QR]);
      emit(["weixin", CONFIRMED]);
    });
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("gateway_weixin_persist", {
        accountId: "wxid_1",
        token: "tok",
        baseUrl: "https://example.com",
      }),
    );
    expect(screen.getByText("gateway.reloginDone")).toBeInTheDocument();
  });

  it("ignores platform events from non-weixin platforms", async () => {
    const emit = captureHandler();
    const { container } = render(<WeixinReloginOverlay />);
    await act(async () => {
      emit(["dingtalk", QR]);
    });
    expect(container.firstChild).toBeNull();
  });
});
