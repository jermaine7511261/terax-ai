import { beforeEach, describe, expect, it } from "vitest";
import {
  autoSettleText,
  autoSettleTurn,
  lastAssistantText,
  normalizeAutoSettle,
  settleAutoMemory,
  turnUsedTools,
} from "./autoSettle";
import { useMemoryStore } from "../store/memoryStore";

const text = (role: string, t: string) =>
  ({ role, parts: [{ type: "text", text: t }] }) as never;
const toolCall = () =>
  ({ role: "assistant", parts: [{ type: "tool-call" }] }) as never;

function ui(...msgs: unknown[]): never[] {
  return msgs as never[];
}

beforeEach(() => {
  useMemoryStore.setState({ bySession: {} });
});

describe("lastAssistantText", () => {
  it("returns the latest assistant text part", () => {
    const messages = ui(
      text("user", "q"),
      text("assistant", "first reply"),
      text("assistant", "final summary here"),
    );
    expect(lastAssistantText(messages)).toBe("final summary here");
  });
  it("returns empty string when no assistant text exists", () => {
    expect(lastAssistantText(ui(text("user", "q")))).toBe("");
  });
});

describe("turnUsedTools", () => {
  it("returns true when any assistant part is a tool-call", () => {
    expect(turnUsedTools(ui(toolCall()))).toBe(true);
  });
  it("returns false for a pure text turn", () => {
    expect(turnUsedTools(ui(text("assistant", "hi")))).toBe(false);
  });
});

describe("normalizeAutoSettle", () => {
  it("collapses whitespace and trims", () => {
    expect(
      normalizeAutoSettle("  We   use   pnpm   for   all   package   management   "),
    ).toBe("We use pnpm for all package management");
  });
  it("returns null below the min length", () => {
    expect(normalizeAutoSettle("ok")).toBeNull();
  });
  it("returns null for non-findings (acknowledgments)", () => {
    expect(normalizeAutoSettle("sure, let me check that now")).toBeNull();
  });
  it("caps at max length with an ellipsis", () => {
    const long = "x".repeat(400);
    const out = normalizeAutoSettle(long, { maxLen: 50 });
    expect(out?.length).toBe(51); // 50 + ellipsis
    expect(out?.endsWith("…")).toBe(true);
  });
});

describe("settleAutoMemory / autoSettleTurn", () => {
  it("writes a source:auto entry after a tool-using turn", () => {
    const messages = ui(
      text("user", "refactor it"),
      toolCall(),
      text("assistant", "We standardized on pnpm for all package management"),
    );
    const note = autoSettleTurn("s-1", messages);
    expect(note).toContain("pnpm");
    const entries = useMemoryStore.getState().bySession["s-1"] ?? [];
    expect(entries.length).toBe(1);
    expect(entries[0].source).toBe("auto");
  });
  it("does not settle a pure-text turn", () => {
    const messages = ui(text("assistant", "Here is a short answer"));
    expect(autoSettleTurn("s-1", messages)).toBeNull();
  });
  it("dedupes identical auto-settles", () => {
    settleAutoMemory("s-1", "The build command is pnpm build for this project");
    const second = settleAutoMemory("s-1", "The build command is pnpm build for this project");
    expect(second).toBeNull();
    expect(useMemoryStore.getState().bySession["s-1"].length).toBe(1);
  });
  it("settles from the transport's final text snapshot (P1-4)", () => {
    const note = autoSettleText(
      "s-1",
      "We standardized on pnpm for package management",
      true,
    );
    expect(note).toContain("pnpm");
    const entries = useMemoryStore.getState().bySession["s-1"] ?? [];
    expect(entries.length).toBe(1);
    expect(entries[0].source).toBe("auto");
  });
  it("does not settle when the turn used no tools", () => {
    expect(autoSettleText("s-1", "just a chat reply", false)).toBeNull();
    expect(useMemoryStore.getState().bySession["s-1"] ?? []).toHaveLength(0);
  });
});
