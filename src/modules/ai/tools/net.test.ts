import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMock = vi.hoisted(() => ({
  webFetch: vi.fn(),
  webSearch: vi.fn(),
}));

vi.mock("../lib/native", () => ({
  native: nativeMock,
}));

import { buildNetTools } from "./net";

function makeContext() {
  return {
    getCwd: () => "/cwd",
    getWorkspaceRoot: () => "/root",
  };
}

const tools = buildNetTools(makeContext() as never);
const fetchUrl = tools.fetch_url;
if (!fetchUrl.execute) throw new Error("fetch_url execute missing");
const execute = fetchUrl.execute as unknown as (args: {
  url: string;
  max_chars?: number;
}) => Promise<Record<string, unknown>>;

describe("fetch_url tool", () => {
  beforeEach(() => {
    nativeMock.webFetch.mockReset();
  });

  it("rejects non-http(s) URLs before calling native", async () => {
    const res = await execute({ url: "ftp://x.com" });
    expect(res).toHaveProperty("error");
    expect(nativeMock.webFetch).not.toHaveBeenCalled();
  });

  it("calls native.webFetch and maps content output", async () => {
    nativeMock.webFetch.mockResolvedValue({
      ok: true,
      output: {
        url: "https://docs.rs/reqwest/latest",
        content: "# reqwest\nHTTP client",
        contentType: "markdown",
        statusCode: 200,
        truncated: false,
      },
      error: null,
    });
    const res = await execute({ url: "https://docs.rs/reqwest/latest" });
    expect(nativeMock.webFetch).toHaveBeenCalledWith(
      "https://docs.rs/reqwest/latest",
      undefined,
    );
    expect(res).toMatchObject({
      url: "https://docs.rs/reqwest/latest",
      content: "# reqwest\nHTTP client",
      contentType: "markdown",
      statusCode: 200,
      truncated: false,
    });
  });

  it("passes max_chars through", async () => {
    nativeMock.webFetch.mockResolvedValue({
      ok: true,
      output: { content: "x" },
      error: null,
    });
    await execute({ url: "https://docs.rs/", max_chars: 5000 });
    expect(nativeMock.webFetch).toHaveBeenCalledWith("https://docs.rs/", 5000);
  });

  it("returns error when native reports failure", async () => {
    nativeMock.webFetch.mockResolvedValue({
      ok: false,
      output: null,
      error: "domain not allowed",
    });
    const res = await execute({ url: "https://evil.com" });
    expect(res).toHaveProperty("error", "domain not allowed");
  });

  it("returns error when native throws", async () => {
    nativeMock.webFetch.mockRejectedValue(new Error("network down"));
    const res = await execute({ url: "https://docs.rs/" });
    expect(res).toHaveProperty("error");
    expect(String(res.error)).toContain("network down");
  });
});

const searchTools = buildNetTools(makeContext() as never);
const webSearch = searchTools.web_search;
if (!webSearch.execute) throw new Error("web_search execute missing");
const searchExecute = webSearch.execute as unknown as (args: {
  query: string;
  max_results?: number;
}) => Promise<Record<string, unknown>>;

describe("web_search tool (Rust-backed thin shell)", () => {
  beforeEach(() => {
    nativeMock.webSearch.mockReset();
  });

  it("returns error for empty query", async () => {
    const res = await searchExecute({ query: "   " });
    expect(res).toHaveProperty("error");
    expect(nativeMock.webSearch).not.toHaveBeenCalled();
  });

  it("calls native.webSearch and passes results through", async () => {
    nativeMock.webSearch.mockResolvedValue({
      ok: true,
      query: "rust",
      results: [
        {
          title: "The Rust Programming Language",
          url: "https://doc.rust-lang.org/book/",
          snippet: "A book about Rust",
        },
      ],
      truncated: false,
      degraded: false,
      error: null,
    });
    const res = await searchExecute({ query: "rust" });
    expect(nativeMock.webSearch).toHaveBeenCalledWith({
      query: "rust",
      maxResults: 5,
    });
    const results = res.results as { title: string; url: string }[];
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({
      title: "The Rust Programming Language",
      url: "https://doc.rust-lang.org/book/",
    });
    expect(res.degraded).toBe(false);
  });

  it("returns error when native reports failure", async () => {
    nativeMock.webSearch.mockResolvedValue({
      ok: false,
      query: "rust",
      results: [],
      truncated: false,
      degraded: true,
      error: "search blocked by ddg challenge/captcha",
    });
    const res = await searchExecute({ query: "rust" });
    expect(res).toHaveProperty("error");
    expect(String(res.error)).toContain("challenge");
  });

  it("returns error when native throws", async () => {
    nativeMock.webSearch.mockRejectedValue(new Error("network down"));
    const res = await searchExecute({ query: "rust" });
    expect(res).toHaveProperty("error");
    expect(String(res.error)).toContain("network down");
  });

  it("marks truncated from the native flag", async () => {
    nativeMock.webSearch.mockResolvedValue({
      ok: true,
      query: "x",
      results: Array.from({ length: 5 }, (_, i) => ({
        title: `r${i}`,
        url: `https://example.com/${i}`,
        snippet: "",
      })),
      truncated: true,
      degraded: false,
      error: null,
    });
    const capped = await searchExecute({ query: "x", max_results: 5 });
    expect(capped.results as unknown[]).toHaveLength(5);
    expect(capped.truncated).toBe(true);
  });
});
