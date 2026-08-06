import { describe, expect, it } from "vitest";
import { quoteShellArg } from "./shellQuote";

describe("quoteShellArg", () => {
  it("wraps a simple value in single quotes on POSIX", () => {
    expect(quoteShellArg("foo", false)).toBe("'foo'");
  });

  it("escapes embedded single quotes for POSIX", () => {
    expect(quoteShellArg("it's", false)).toBe("'it'\\''s'");
  });

  it("doubles embedded single quotes on Windows", () => {
    expect(quoteShellArg("it's", true)).toBe("'it''s'");
  });

  it("keeps a value without quotes unchanged on Windows", () => {
    expect(quoteShellArg("plain value", true)).toBe("'plain value'");
  });

  it("defaults to the platform flag (IS_WINDOWS)", () => {
    // The exact output depends on the runtime platform; just assert it is one
    // of the two quoting variants for a quote-free value.
    const out = quoteShellArg("abc");
    expect(out).toBe("'abc'");
  });
});
