// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  value: "",
  setValue: vi.fn((v: string) => {
    mock.value = v;
  }),
  textareaRef: { current: null as HTMLTextAreaElement | null },
  addSnippet: vi.fn(),
  addCommand: vi.fn(),
  attachFileByPath: vi.fn(),
  submit: vi.fn(),
  setFiles: vi.fn(),
  getFiles: () => [],
  voice: { recording: false, transcribing: false },
}));

vi.mock("../lib/composer", () => ({ useComposer: () => mock }));
vi.mock("../store/chatStore", () => ({
  useChatStore: (sel: (s: unknown) => unknown) =>
    sel({
      live: { getWorkspaceRoot: () => null },
      selectedModelId: "deepseek-chat",
      agentMeta: { tokens: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } },
    }),
}));
vi.mock("../store/snippetsStore", () => ({
  useSnippetsStore: (sel: (s: unknown) => unknown) => sel({ snippets: [] }),
}));
vi.mock("../hooks/useWorkspaceFiles", () => ({
  useWorkspaceFiles: () => ({ files: [], indexing: false, truncated: false }),
}));
vi.mock("@/lib/usePresence", () => ({
  usePresence: () => ({ mounted: false, state: "hidden" }),
}));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

import { AiComposerInput } from "./AiComposerInput";

describe("AiComposerInput render", () => {
  beforeEach(() => {
    mock.value = "";
    mock.textareaRef.current = null;
    vi.clearAllMocks();
  });

  it("opens the snippet picker when typing a leading slash", async () => {
    const { rerender } = render(<AiComposerInput />);
    const ta = mock.textareaRef.current!;
    expect(ta).toBeTruthy();

    fireEvent.change(ta, { target: { value: "/" } });
    ta.setSelectionRange(1, 1);
    await act(async () => {
      rerender(<AiComposerInput />);
    });

    // Popover content should now be in the document (SnippetPickerContent).
    expect(screen.queryByText("Pre-built snippets")).not.toBeNull();
  });

  it("opens the file picker when typing a leading @", async () => {
    const { rerender } = render(<AiComposerInput />);
    const ta = mock.textareaRef.current!;

    fireEvent.change(ta, { target: { value: "@" } });
    ta.setSelectionRange(1, 1);
    await act(async () => {
      rerender(<AiComposerInput />);
    });

    // FilePickerContent should render inside the popover when workspace is null.
    expect(screen.queryAllByText(/workspace|index/i).length).toBeGreaterThan(0);
  });
});
