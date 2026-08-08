import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ customEndpoints: [], apiKeys: {} }),
  },
}));

vi.mock("../store/chatStore", () => ({
  useChatStore: {
    getState: () => ({
      apiKeys: {},
      selectedModelId: "test",
      customEndpointKeys: {},
      activeSessionId: null,
    }),
  },
}));

vi.mock("../store/agentActivityStore", () => ({
  newActivityId: () => "act-test",
  useAgentActivityStore: {
    getState: () => ({
      start: () => {},
      finish: () => {},
      fail: () => {},
      updateStep: () => {},
    }),
  },
}));

vi.mock("../lib/native", () => ({ native: {} }));
vi.mock("@/modules/mcp", () => ({
  useMcpStore: { getState: () => ({ servers: [] }) },
  mcpToolCall: vi.fn(),
}));

import { buildTools } from "./tools";

const ctx = {
  getCwd: () => "/cwd",
  getWorkspaceRoot: () => "/root",
} as never;

describe("buildTools registration surface", () => {
  const tools = buildTools(ctx);

  it("registers all expected tool names", () => {
    const names = Object.keys(tools);
    const expected = [
      // fs
      "read_file",
      "write_file",
      "create_docx",
      "create_xlsx",
      "create_pptx",
      "create_pdf",
      "edit_docx",
      "edit_xlsx",
      "edit_pptx",
      "merge_pdf",
      "encrypt_pdf",
      "list_directory",
      "create_directory",
      "delete_file",
      "rename_file",
      // edit
      "edit",
      "multi_edit",
      "apply_patch",
      // search
      "grep",
      "glob",
      // shell
      "bash_run",
      "bash_background",
      "bash_logs",
      "bash_list",
      "bash_kill",
      // subagent
      "run_subagent",
      "delegate_many",
      "run_external_agent",
      // git
      "git_status",
      "git_diff",
      "git_stage",
      "git_commit",
      // todo / memory
      "todo_write",
      "update_project_memory",
      // network (round 21)
      "fetch_url",
      "web_search",
      "deep_search",
      // graph
      "run_graph",
    ];
    for (const n of expected) {
      expect(names).toContain(n);
    }
  });

  it("has no duplicate keys across builders", () => {
    const names = Object.keys(tools);
    expect(new Set(names).size).toBe(names.length);
  });
});
