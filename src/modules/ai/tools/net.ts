import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import type { ToolContext } from "./context";

/**
 * Network tools (ported from Grok grok-build web_fetch / web_search).
 *
 * - `fetch_url`: read a single URL, convert HTML→markdown, enforce SSRF +
 *   domain allowlist on the Rust side. Read-only; no write path.
 * - `web_search`: P4 薄壳化后为薄壳——搜索下沉 Rust `web_search`（uddg 还原 /
 *   假成功检测 / 词汇级重排全部原生），前端只做参数映射与结果透传。
 */
export function buildNetTools(_ctx: ToolContext) {
  return {
    fetch_url: tool({
      description:
        "Fetch a single URL and return its content converted to markdown. Enforces a domain allowlist (developer-docs domains) and blocks private/local addresses (SSRF) on the backend. Use for reading documentation, online references, issues, or any page whose URL you already know. Returns the page text, final URL (after redirects), status code, and a truncation flag. Does NOT search the web — pair with web_search when you don't know the URL.",
      inputSchema: z.object({
        url: z
          .string()
          .describe(
            "Absolute http(s) URL to fetch. Must be an allowed domain (developer documentation); otherwise it is rejected before any network I/O.",
          ),
        max_chars: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .optional()
          .describe(
            "Maximum inline characters to return (default 100k, capped). Longer pages are truncated with a marker.",
          ),
      }),
      execute: async ({ url, max_chars }) => {
        if (!/^https?:\/\//i.test(url)) {
          return {
            error:
              "Only http(s) URLs are supported. Provide an absolute URL with a scheme.",
          };
        }
        try {
          const res = await native.webFetch(url, max_chars);
          if (!res.ok) {
            return { error: res.error ?? "fetch failed" };
          }
          const o = res.output as {
            url?: string;
            content?: string;
            contentType?: string;
            statusCode?: number;
            truncated?: boolean;
            metadata?: Record<string, string>;
          } | null;
          if (!o) return { error: "no output" };
          return {
            url: o.url ?? url,
            content: o.content ?? "",
            contentType: o.contentType,
            statusCode: o.statusCode,
            truncated: o.truncated ?? false,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    web_search: tool({
      description:
        "Search the web (free, no API key) and return up to `max_results` results as `{title, url, snippet}`. Uses DuckDuckGo. Use this when you don't know the URL and need to discover pages, then call fetch_url to read the most relevant result. Returns an empty `results` array when nothing is found.",
      inputSchema: z.object({
        query: z.string().describe("Search query, e.g. 'rust async book'"),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Maximum results to return (default 5, max 10)."),
      }),
      execute: async ({ query, max_results }) => {
        if (!query?.trim()) {
          return { error: "query is required" };
        }
        try {
          // P4 薄壳化：搜索下沉 Rust（uddg 还原 / 假成功检测 / 重排全部原生）。
          const res = await native.webSearch({
            query,
            maxResults: max_results ?? 5,
          });
          if (!res.ok) {
            return { error: res.error ?? "search failed" };
          }
          return {
            query,
            results: res.results,
            truncated: res.truncated,
            degraded: res.degraded,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
