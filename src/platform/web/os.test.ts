// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { webOs } from "./os";

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

afterEach(() => {
  // Reset to a neutral UA.
  Object.defineProperty(window.navigator, "userAgent", {
    value: "node",
    configurable: true,
  });
});

describe("webOs.platform", () => {
  it("detects windows", () => {
    setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );
    expect(webOs.platform()).toBe("windows");
  });

  it("detects macos", () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    );
    expect(webOs.platform()).toBe("macos");
  });

  it("defaults to linux", () => {
    setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    );
    expect(webOs.platform()).toBe("linux");
  });
});

describe("webOs.arch", () => {
  it("detects x86_64", () => {
    setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );
    expect(webOs.arch()).toBe("x86_64");
  });

  it("detects arm64", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Apple M1) arm64");
    expect(webOs.arch()).toBe("aarch64");
  });

  it("unknown arch", () => {
    setUserAgent("Mozilla/5.0 (X11; Linux) AppleWebKit/537.36");
    expect(webOs.arch()).toBe("unknown");
  });
});
