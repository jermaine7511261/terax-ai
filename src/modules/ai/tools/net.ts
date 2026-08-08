import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import type { ToolContext } from "./context";

const DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";

type SearchHit = { title: string; url: string; snippet: string };

/**
 * Parse DuckDuckGo HTML results. DDG's html endpoint uses a stable structure:
 * `.result` blocks each containing `a.result__a` (title/link) and
 * `a.result__snippet` (snippet). We parse with a tolerant regex fallback since
 * we don't pull in a DOM parser here.
 */
function parseDdgResults(html: string, maxResults: number): SearchHit[] {
  const hits: SearchHit[] = [];
  // Split on result blocks (robust to minor HTML variations).
  const blocks = html.split('class="result__body"');
  for (let i = 1; i < blocks.length && hits.length < maxResults; i++) {
    const block = blocks[i];
    const titleMatch = block.match(
      /class="result__a"[^>]*>(.*?)<\/a>/s,
    );
    const hrefMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
    const snippetMatch = block.match(
      /class="result__snippet"[^>]*>(.*?)<\/a>/s,
    );
    const title = titleMatch
      ? stripTags(titleMatch[1]).trim()
      : "";
    const href = hrefMatch ? decodeEntities(hrefMatch[1]) : "";
    const snippet = snippetMatch
      ? stripTags(snippetMatch[1]).trim()
      : "";
    if (title && href) {
      hits.push({ title, url: href, snippet });
    }
  }
  // Fallback: regex over the whole HTML if block splitting found nothing.
  if (hits.length === 0) {
    const re =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && hits.length < maxResults) {
      hits.push({
        title: stripTags(m[2]).trim(),
        url: decodeEntities(m[1]),
        snippet: "",
      });
    }
  }
  return hits;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

/**
 * Network tools (ported from Grok grok-build web_fetch / web_search).
 *
 * - `fetch_url`: read a single URL, convert HTML→markdown, enforce SSRF +
 *   domain allowlist on the Rust side. Read-only; no write path.
 * - `web_search`: (free, no-key) real-time web search via DuckDuckGo HTML.
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
        if (!query || !query.trim()) {
          return { error: "query is required" };
        }
        const max = Math.min(max_results ?? 5, 10);
        try {
          const url = new URL(DDG_HTML_ENDPOINT);
          url.searchParams.set("q", query);
          const { status, text } = await native.httpGetText(url.toString(), {
            "User-Agent": "Mozilla/5.0",
          });
          if (status < 200 || status >= 300) {
            return { error: `search request failed (HTTP ${status})` };
          }
          const results = parseDdgResults(text, max);
          return {
            query,
            results,
            truncated: results.length > 0,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
