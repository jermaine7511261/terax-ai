import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

// Control surface for the real security module's canonicalize callback.
const nativeMock = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  readFile: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  createDocx: vi.fn(async () => 42),
  createXlsx: vi.fn(async () => 42),
  createPptx: vi.fn(async () => 42),
  createPdf: vi.fn(async () => 123),
  editDocx: vi.fn(async () => 1),
  editXlsx: vi.fn(async () => 2),
  editPptx: vi.fn(async () => 3),
  pdfMerge: vi.fn(async () => 1024),
  pdfEncrypt: vi.fn(async () => 2048),
  readDir: vi.fn(async () => []),
  createDir: vi.fn(async () => undefined),
  deleteFile: vi.fn(async () => undefined),
  renameFile: vi.fn(async () => undefined),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));

// Mutable plan-store state so tests can flip `active` to exercise the
// queued-for-plan-review branch of write_file.
const planState = vi.hoisted(() => ({
  state: { active: false, enqueue: vi.fn() },
}));

vi.mock("../store/planStore", () => ({
  newQueuedEditId: () => "queued-edit",
  usePlanStore: { getState: () => planState.state },
}));

// `./context` resolves `homeDir()` at import time; give it a known value so the
// `~` expansion path in resolvePath is deterministic.
vi.mock("@/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform")>();
  return {
    ...actual,
    homeDir: () => Promise.resolve("/home/user"),
  };
});

import { buildFsTools } from "./fs";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

const FILE = "/workspace/a.txt";

function makeContext(readCache: Map<string, { size: number; hash: number }>) {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    executeInActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache,
    getSessionId: () => "session",
  } as unknown as ToolContext;
}

type ToolResult = Record<string, unknown>;

async function runTool(
  ctx: ToolContext,
  name: keyof ReturnType<typeof buildFsTools>,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const execute = buildFsTools(ctx)[name].execute;
  if (!execute) throw new Error(`tool "${name}" has no execute`);
  return (await execute(input as never, toolOptions)) as unknown as ToolResult;
}

function setText(content: string) {
  nativeMock.readFile.mockResolvedValue({
    kind: "text",
    content,
    size: content.length,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  nativeMock.canonicalize.mockImplementation(async (p: string) => p);
  nativeMock.readFile.mockReset();
  nativeMock.writeFile.mockResolvedValue(undefined);
  planState.state = { active: false, enqueue: vi.fn() };
});

describe("read_file validation branches", () => {
  it("returns content for a text file", async () => {
    setText("line1\nline2");
    const ctx = makeContext(new Map());
    const result = await runTool(ctx, "read_file", { path: FILE });
    expect(result).toMatchObject({
      path: FILE,
      content: "line1\nline2",
      size: 11,
      total_lines: 2,
    });
    expect(nativeMock.readFile).toHaveBeenCalledWith(FILE);
  });

  it("refuses a binary file", async () => {
    nativeMock.readFile.mockResolvedValue({ kind: "binary", size: 42 });
    const result = await runTool(makeContext(new Map()), "read_file", {
      path: FILE,
    });
    expect(result.error).toContain("binary file refused");
    expect(result.path).toBe(FILE);
    expect(result.size).toBe(42);
  });

  it("refuses an oversized file (size cap)", async () => {
    nativeMock.readFile.mockResolvedValue({
      kind: "toolarge",
      size: 99999,
      limit: 25 * 1024,
    });
    const result = await runTool(makeContext(new Map()), "read_file", {
      path: FILE,
    });
    expect(result.error).toContain("file too large");
    expect(String(result.error)).toContain("99999");
  });

  it("rejects a sensitive file via the security check (.env)", async () => {
    const secret = "/workspace/.env";
    const result = await runTool(makeContext(new Map()), "read_file", {
      path: secret,
    });
    expect(result.error).toMatch(/sensitive-file pattern/i);
    expect(result.path).toBe(secret);
    expect(nativeMock.readFile).not.toHaveBeenCalled();
  });

  it("rejects a path inside a protected directory (.ssh)", async () => {
    // `config` is not itself a sensitive basename, so the protected-dir check
    // fires (a plain `id_rsa` path would be caught by the basename pattern first).
    const result = await runTool(makeContext(new Map()), "read_file", {
      path: "/home/user/.ssh/config",
    });
    expect(result.error).toMatch(/protected directory/i);
    expect(nativeMock.readFile).not.toHaveBeenCalled();
  });

  it("surfaces a canonicalize failure by falling back to the requested path", async () => {
    // Canonicalize rejects (e.g. path does not exist yet); the security helper
    // treats that as ok and proceeds with the literal path.
    nativeMock.canonicalize.mockRejectedValue(new Error("ENOENT"));
    setText("content");
    const result = await runTool(makeContext(new Map()), "read_file", {
      path: FILE,
    });
    expect(result.path).toBe(FILE);
    expect(nativeMock.readFile).toHaveBeenCalledWith(FILE);
  });

  it("returns unchanged:true when the same file is fully re-read", async () => {
    setText("same content");
    const ctx = makeContext(new Map());
    const first = await runTool(ctx, "read_file", { path: FILE });
    expect(first.content).toBe("same content");
    const second = await runTool(ctx, "read_file", { path: FILE });
    expect(second).toMatchObject({ path: FILE, unchanged: true, size: 12 });
    expect(second.content).toBeUndefined();
  });

  it("re-reads content when a file changes between reads", async () => {
    setText("v1");
    const ctx = makeContext(new Map());
    await runTool(ctx, "read_file", { path: FILE });
    setText("v2 changed");
    const second = await runTool(ctx, "read_file", { path: FILE });
    expect(second.content).toBe("v2 changed");
    expect(second.unchanged).toBeUndefined();
  });
});

describe("write_file validation branches", () => {
  it("writes content and returns bytesWritten", async () => {
    const ctx = makeContext(new Map());
    const result = await runTool(ctx, "write_file", {
      path: FILE,
      content: "hello",
    });
    expect(nativeMock.writeFile).toHaveBeenCalledWith(FILE, "hello");
    expect(result).toMatchObject({ path: FILE, bytesWritten: 5, ok: true });
    // read cache is primed so a follow-up read reports unchanged.
    expect(ctx.readCache.has(FILE)).toBe(true);
  });

  it("rejects a sensitive write target (.env)", async () => {
    const secret = "/workspace/.env";
    const result = await runTool(makeContext(new Map()), "write_file", {
      path: secret,
      content: "TOKEN=x",    });
    expect(result.error).toMatch(/sensitive-file pattern/i);
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });

  it("rejects a write under a system directory (/usr/bin/)", async () => {
    // `/etc/...` is caught by the protected-dir check first; use `/usr/bin` to
    // exercise the write-specific deny prefix.
    const result = await runTool(makeContext(new Map()), "write_file", {
      path: "/usr/bin/tool",
      content: "x",
    });
    expect(result.error).toMatch(/not allowed/i);
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });

  it("falls back to the literal path when canonicalize fails (new file)", async () => {
    nativeMock.canonicalize.mockRejectedValue(new Error("ENOENT"));
    const result = await runTool(makeContext(new Map()), "write_file", {
      path: FILE,
      content: "new",
    });
    expect(nativeMock.writeFile).toHaveBeenCalledWith(FILE, "new");
    expect(result.ok).toBe(true);
  });

  it("queues for plan review instead of writing when a plan is active", async () => {
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: "original",
      size: 8,
    });
    planState.state = { active: true, enqueue: vi.fn() };
    const result = await runTool(makeContext(new Map()), "write_file", {
      path: FILE,
      content: "revised",
    });
    expect(result.queued_for_plan_review).toBe(true);
    expect(result.ok).toBe(true);
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
    expect(planState.state.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "write_file",
        path: FILE,
        originalContent: "original",
        proposedContent: "revised",
        isNewFile: false,
      }),
    );
  });
});

describe("list_directory / create_directory / delete_file validation", () => {
  it("list_directory surfaces a security rejection", async () => {
    const result = await runTool(makeContext(new Map()), "list_directory", {
      path: "/home/user/.ssh",
    });
    expect(result.error).toMatch(/protected directory/i);
    expect(nativeMock.readDir).not.toHaveBeenCalled();
  });

  it("create_directory rejects a sensitive location", async () => {
    const result = await runTool(makeContext(new Map()), "create_directory", {
      path: "/workspace/.ssh",
    });
    expect(result.error).toMatch(/protected directory/i);
    expect(nativeMock.createDir).not.toHaveBeenCalled();
  });

  it("delete_file rejects a write-denied system path", async () => {
    const result = await runTool(makeContext(new Map()), "delete_file", {
      path: "/usr/bin/tool",
    });
    expect(result.error).toMatch(/not allowed/i);
    expect(nativeMock.deleteFile).not.toHaveBeenCalled();
  });

  it("delete_file deletes an allowed path", async () => {
    const result = await runTool(makeContext(new Map()), "delete_file", {
      path: FILE,
    });
    expect(nativeMock.deleteFile).toHaveBeenCalledWith(FILE);
    expect(result.ok).toBe(true);
  });
});

describe("office document create tools", () => {
  it("create_docx forwards markdown-ish lines and reports bytesWritten", async () => {
    nativeMock.createDocx.mockResolvedValue(512);
    const ctx = makeContext(new Map());
    const result = await runTool(ctx, "create_docx", {
      path: "/workspace/report.docx",
      lines: ["# Title", "- bullet"],
    });
    expect(nativeMock.createDocx).toHaveBeenCalledWith("/workspace/report.docx", [
      "# Title",
      "- bullet",
    ]);
    expect(result).toMatchObject({
      path: "/workspace/report.docx",
      bytesWritten: 512,
      ok: true,
    });
    expect(ctx.readCache.has("/workspace/report.docx")).toBe(true);
  });

  it("create_xlsx forwards the 2D grid", async () => {
    nativeMock.createXlsx.mockResolvedValue(256);
    const result = await runTool(makeContext(new Map()), "create_xlsx", {
      path: "/workspace/data.xlsx",
      rows: [
        ["Name", "Age"],
        ["Alice", "30"],
      ],
    });
    expect(nativeMock.createXlsx).toHaveBeenCalledWith("/workspace/data.xlsx", [
      ["Name", "Age"],
      ["Alice", "30"],
    ]);
    expect(result).toMatchObject({ ok: true, rows: 2 });
  });

  it("create_pptx forwards slide strings", async () => {
    nativeMock.createPptx.mockResolvedValue(900);
    const result = await runTool(makeContext(new Map()), "create_pptx", {
      path: "/workspace/deck.pptx",
      slides: ["Slide One", "Slide Two"],
    });
    expect(nativeMock.createPptx).toHaveBeenCalledWith("/workspace/deck.pptx", [
      "Slide One",
      "Slide Two",
    ]);
    expect(result).toMatchObject({ ok: true, slides: 2 });
  });

  it("rejects a sensitive create target (.env.docx would still be caught)", async () => {
    const result = await runTool(makeContext(new Map()), "create_docx", {
      path: "/workspace/.env",
      lines: ["# Secret"],
    });
    expect(result.error).toMatch(/sensitive-file pattern/i);
    expect(nativeMock.createDocx).not.toHaveBeenCalled();
  });

  it("surfaces a backend error as { error }", async () => {
    nativeMock.createDocx.mockRejectedValue(new Error("zip write failed"));
    const result = await runTool(makeContext(new Map()), "create_docx", {
      path: "/workspace/x.docx",
      lines: ["hi"],
    });
    expect(result.error).toContain("zip write failed");
    expect(result.path).toBe("/workspace/x.docx");
  });
});

describe("pdf merge / encrypt tools", () => {
  it("merge_pdf forwards resolved inputs + output and reports bytesWritten", async () => {
    nativeMock.pdfMerge.mockResolvedValue(4096);
    const ctx = makeContext(new Map());
    const result = await runTool(ctx, "merge_pdf", {
      files: ["/workspace/a.pdf", "/workspace/b.pdf"],
      output: "/workspace/m.pdf",
    });
    expect(nativeMock.pdfMerge).toHaveBeenCalledWith(
      ["/workspace/a.pdf", "/workspace/b.pdf"],
      "/workspace/m.pdf",
    );
    expect(result).toMatchObject({
      output: "/workspace/m.pdf",
      pagesMerged: 2,
      bytesWritten: 4096,
      ok: true,
    });
    expect(ctx.readCache.has("/workspace/m.pdf")).toBe(true);
  });

  it("merge_pdf rejects a sensitive output target", async () => {
    const result = await runTool(makeContext(new Map()), "merge_pdf", {
      files: ["/workspace/a.pdf"],
      output: "/workspace/.ssh/out.pdf",
    });
    expect(result.error).toMatch(/protected directory/i);
    expect(nativeMock.pdfMerge).not.toHaveBeenCalled();
  });

  it("merge_pdf requires at least one input", async () => {
    const result = await runTool(makeContext(new Map()), "merge_pdf", {
      files: [],
      output: "/workspace/m.pdf",
    });
    expect(result.error).toContain("at least one input");
    expect(nativeMock.pdfMerge).not.toHaveBeenCalled();
  });

  it("encrypt_pdf forwards input/output/passwords", async () => {
    nativeMock.pdfEncrypt.mockResolvedValue(512);
    const result = await runTool(makeContext(new Map()), "encrypt_pdf", {
      input: "/workspace/a.pdf",
      output: "/workspace/e.pdf",
      user_password: "pw",
      owner_password: "owner",
    });
    expect(nativeMock.pdfEncrypt).toHaveBeenCalledWith(
      "/workspace/a.pdf",
      "/workspace/e.pdf",
      "pw",
      "owner",
    );
    expect(result).toMatchObject({ output: "/workspace/e.pdf", bytesWritten: 512, ok: true });
  });

  it("encrypt_pdf requires at least one password", async () => {
    const result = await runTool(makeContext(new Map()), "encrypt_pdf", {
      input: "/workspace/a.pdf",
      output: "/workspace/e.pdf",
    });
    expect(result.error).toContain("password");
    expect(nativeMock.pdfEncrypt).not.toHaveBeenCalled();
  });
});

describe("create_pdf / edit document tools", () => {
  it("create_pdf forwards lines and reports bytesWritten", async () => {
    nativeMock.createPdf.mockResolvedValue(2048);
    const ctx = makeContext(new Map());
    const result = await runTool(ctx, "create_pdf", {
      path: "/workspace/r.pdf",
      lines: ["# Title", "Body"],
    });
    expect(nativeMock.createPdf).toHaveBeenCalledWith("/workspace/r.pdf", [
      "# Title",
      "Body",
    ]);
    expect(result).toMatchObject({ path: "/workspace/r.pdf", bytesWritten: 2048, ok: true });
    expect(ctx.readCache.has("/workspace/r.pdf")).toBe(true);
  });

  it("edit_docx forwards replacement pairs and reports count", async () => {
    nativeMock.editDocx.mockResolvedValue(3);
    const result = await runTool(makeContext(new Map()), "edit_docx", {
      path: "/workspace/t.docx",
      replacements: [
        ["{{NAME}}", "World"],
        ["old", "new"],
      ],
    });
    expect(nativeMock.editDocx).toHaveBeenCalledWith("/workspace/t.docx", [
      ["{{NAME}}", "World"],
      ["old", "new"],
    ]);
    expect(result).toMatchObject({ path: "/workspace/t.docx", replaced: 3, ok: true });
  });

  it("edit_xlsx forwards cell edits", async () => {
    nativeMock.editXlsx.mockResolvedValue(2);
    const result = await runTool(makeContext(new Map()), "edit_xlsx", {
      path: "/workspace/t.xlsx",
      cells: [
        { sheet: 0, cell: "B2", kind: "number", value: "31" },
        { sheet: 0, cell: "C2", value: "new" },
      ],
    });
    expect(nativeMock.editXlsx).toHaveBeenCalledWith("/workspace/t.xlsx", [
      { sheet: 0, cell: "B2", kind: "number", value: "31" },
      { sheet: 0, cell: "C2", value: "new" },
    ]);
    expect(result).toMatchObject({ path: "/workspace/t.xlsx", cellsSet: 2, ok: true });
  });

  it("edit_pptx forwards replacements", async () => {
    nativeMock.editPptx.mockResolvedValue(1);
    const result = await runTool(makeContext(new Map()), "edit_pptx", {
      path: "/workspace/t.pptx",
      replacements: [["{{N}}", "42"]],
    });
    expect(nativeMock.editPptx).toHaveBeenCalledWith("/workspace/t.pptx", [["{{N}}", "42"]]);
    expect(result).toMatchObject({ path: "/workspace/t.pptx", replaced: 1, ok: true });
  });

  it("edit_docx rejects a sensitive target", async () => {
    const result = await runTool(makeContext(new Map()), "edit_docx", {
      path: "/workspace/.ssh/t.docx",
      replacements: [["a", "b"]],
    });
    expect(result.error).toMatch(/protected directory/i);
    expect(nativeMock.editDocx).not.toHaveBeenCalled();
  });
});
