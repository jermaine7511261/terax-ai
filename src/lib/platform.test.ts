import { describe, expect, it } from "vitest";
import { fmtShortcut, KEY_SEP, MOD_KEY, MOD_PROP } from "./platform";

describe("platform helpers", () => {
  it("fmtShortcut joins parts with the platform separator", () => {
    expect(fmtShortcut("Ctrl", "Shift", "K")).toBe(["Ctrl", "Shift", "K"].join(KEY_SEP));
  });

  it("modifier is consistent with MOD_PROP", () => {
    if (MOD_PROP === "meta") expect(MOD_KEY).toBe("⌘");
    else expect(MOD_KEY).toBe("Ctrl");
  });

  it("separator is empty on mac else +", () => {
    expect(KEY_SEP).toBe(MOD_PROP === "meta" ? "" : "+");
  });
});
