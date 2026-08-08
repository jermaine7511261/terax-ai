import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMock = vi.hoisted(() => ({
  webFetch: vi.fn(),
  httpGetText: vi.fn(),
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

describe("web_search tool (DuckDuckGo)", () => {
  beforeEach(() => {
    nativeMock.httpGetText.mockReset();
  });

  it("returns error for empty query", async () => {
    const res = await searchExecute({ query: "   " });
    expect(res).toHaveProperty("error");
    expect(nativeMock.httpGetText).not.toHaveBeenCalled();
  });

  it("parses DuckDuckGo HTML results", async () => {
    nativeMock.httpGetText.mockResolvedValue({
      status: 200,
      text: `
        <div class="result__body">
          <a class="result__a" href="https://doc.rust-lang.org/book/">The Rust Programming Language</a>
          <a class="result__snippet">A book about Rust</a>
        </div>
        <div class="result__body">
          <a class="result__a" href="https://docs.rs/reqwest">reqwest</a>
          <a class="result__snippet">HTTP client</a>
        </div>
      `,
    });
    const res = await searchExecute({ query: "rust" });
    expect(nativeMock.httpGetText).toHaveBeenCalledWith(
      expect.stringContaining("html.duckduckgo.com/html/?q=rust"),
      expect.anything(),
    );
    const results = res.results as { title: string; url: string }[];
    expect(results.length).toBe(2);
    expect(results[0]).toMatchObject({
      title: "The Rust Programming Language",
      url: "https://doc.rust-lang.org/book/",
    });
  });

  it("returns error on HTTP failure", async () => {
    nativeMock.httpGetText.mockResolvedValue({ status: 500, text: "" });
    const res = await searchExecute({ query: "rust" });
    expect(res).toHaveProperty("error");
    expect(String(res.error)).toContain("500");
  });

  it("returns empty results when no matches", async () => {
    nativeMock.httpGetText.mockResolvedValue({
      status: 200,
      text: "<html><body>No results.</body></html>",
    });
    const res = await searchExecute({ query: "zzzqqq" });
    expect(Array.isArray(res.results)).toBe(true);
    expect(res.results as unknown[]).toHaveLength(0);
  });

  it("unwraps DDG tracking-redirect hrefs to real URLs", async () => {
    // Real html.duckduckgo.com/html/ shape (verified 2026-08-08): result links
    // are protocol-relative `//duckduckgo.com/l/?uddg=<urlencoded>` redirects.
    nativeMock.httpGetText.mockResolvedValue({
      status: 200,
      text: `
        <div class="links_main links_deep result__body">
          <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Frust%2Dlang.github.io%2Fasync%2Dbook%2F&amp;rut=632883697d8adf14f9b6790b16cb39611a2065fc06663d3">The Rust Programming Language</a>
          <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Frust%2Dlang.github.io%2Fasync%2Dbook%2F&amp;rut=632883697d8adf14f9b6790b16cb39611a2065fc06663d3">A book about Rust</a>
        </div>
        <div class="links_main links_deep result__body">
          <a rel="nofollow" class="result__a" href="https://docs.rs/reqwest/latest">reqwest</a>
          <a class="result__snippet" href="https://docs.rs/reqwest/latest">HTTP client</a>
        </div>
      `,
    });
    const res = await searchExecute({ query: "rust" });
    const results = res.results as { title: string; url: string }[];
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe("https://rust-lang.github.io/async-book/");
    expect(results[1].url).toBe("https://docs.rs/reqwest/latest");
  });

  it("marks truncated only when the max_results cap is reached", async () => {
    const tenResults = Array.from(
      { length: 10 },
      (_, i) => `
      <div class="result__body">
        <a class="result__a" href="https://example.com/${i}">result ${i}</a>
        <a class="result__snippet" href="https://example.com/${i}">snippet</a>
      </div>`,
    ).join("");
    nativeMock.httpGetText.mockResolvedValue({ status: 200, text: tenResults });
    const capped = await searchExecute({ query: "x", max_results: 5 });
    expect(capped.results as unknown[]).toHaveLength(5);
    expect(capped.truncated).toBe(true);

    nativeMock.httpGetText.mockResolvedValue({
      status: 200,
      text: '<div class="result__body"><a class="result__a" href="https://example.com/1">one</a><a class="result__snippet" href="https://example.com/1">s</a></div>',
    });
    const complete = await searchExecute({ query: "x", max_results: 5 });
    expect(complete.results as unknown[]).toHaveLength(1);
    expect(complete.truncated).toBe(false);
  });
});
