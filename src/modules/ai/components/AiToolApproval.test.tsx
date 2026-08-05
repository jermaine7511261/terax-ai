// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AiToolApproval } from "./AiToolApproval";
import type { ToolUIPart } from "ai";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ lang: "en", t: (key: string) => key }),
  tStatic: (key: string) => key,
  getLanguage: () => "en",
}));

const setAutoApproveTools = vi.fn();
vi.mock("@/modules/settings/store", () => ({
  setAutoApproveTools: (...args: unknown[]) => setAutoApproveTools(...args),
}));

function makePart(
  input: Record<string, unknown>,
): Extract<ToolUIPart, { state: "approval-requested" }> {
  return {
    type: "tool-write_file",
    toolCallId: "call-1",
    state: "approval-requested",
    input,
    approval: { id: "approval-1" },
  } as unknown as Extract<ToolUIPart, { state: "approval-requested" }>;
}

describe("AiToolApproval", () => {
  it("renders the tool name and input description", () => {
    const part = makePart({ path: "/src/hello.ts", content: "a\nb" });
    render(
      <AiToolApproval
        part={part}
        toolName="write_file"
        onRespond={() => {}}
      />,
    );

    // Tool label comes from TOOL_META.
    expect(screen.getByText("Write file")).toBeInTheDocument();
    // Approval banner uses the mocked t() returning the key.
    expect(screen.getByText("ai.needsApproval")).toBeInTheDocument();
    // write_file preview shows the path + line hint.
    expect(screen.getByText("/src/hello.ts")).toBeInTheDocument();
    expect(screen.getByText("2 lines · review in the diff tab")).toBeInTheDocument();
    // Approve / deny buttons use the mocked t() keys.
    expect(screen.getByText("ai.approve")).toBeInTheDocument();
    expect(screen.getByText("ai.deny")).toBeInTheDocument();
  });

  it("falls back to the raw tool name when it has no metadata", () => {
    const part = makePart({ foo: "bar" });
    render(
      <AiToolApproval
        part={part}
        toolName="some_unknown_tool"
        onRespond={() => {}}
      />,
    );
    expect(screen.getByText("some_unknown_tool")).toBeInTheDocument();
  });

  it("calls onRespond(true) when approve is clicked", () => {
    const onRespond = vi.fn();
    const part = makePart({ path: "/src/a.ts" });
    render(
      <AiToolApproval part={part} toolName="write_file" onRespond={onRespond} />,
    );

    fireEvent.click(screen.getByText("ai.approve"));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(true);
  });

  it("calls onRespond(false) when deny is clicked", () => {
    const onRespond = vi.fn();
    const part = makePart({ path: "/src/a.ts" });
    render(
      <AiToolApproval part={part} toolName="write_file" onRespond={onRespond} />,
    );

    fireEvent.click(screen.getByText("ai.deny"));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(false);
  });

  it("responds with options through the remember dropdown", async () => {
    const onRespond = vi.fn();
    const part = makePart({ path: "/src/a.ts" });
    render(
      <AiToolApproval part={part} toolName="write_file" onRespond={onRespond} />,
    );

    // Open the dropdown via its trigger (Radix opens on pointerDown).
    fireEvent.pointerDown(screen.getByText("ai.remember"));
    // Dropdown items render in a Radix portal after opening.
    const sessionItem = await screen.findByText("ai.rememberSession");
    fireEvent.click(sessionItem);

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(true, { rememberScope: "session" });
  });

  it("auto-approves: sets autoApproveTools + approves on click", () => {
    const onRespond = vi.fn();
    const part = makePart({ path: "/src/a.ts" });
    render(
      <AiToolApproval part={part} toolName="write_file" onRespond={onRespond} />,
    );

    fireEvent.click(screen.getByText("ai.autoApproveTool"));
    expect(setAutoApproveTools).toHaveBeenCalledWith(true);
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(true, { rememberScope: "session" });
  });
});
