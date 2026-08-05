// Per-pane navigation history + persisted bookmarks for the preview pane.

export type NavHistory = {
  urls: string[];
  index: number;
};

export function pushNav(h: NavHistory, url: string): NavHistory {
  if (h.urls[h.index] === url) return h;
  const urls = [...h.urls.slice(0, h.index + 1), url];
  return { urls, index: urls.length - 1 };
}

export function navBack(h: NavHistory): NavHistory | null {
  if (h.index <= 0) return null;
  return { urls: h.urls, index: h.index - 1 };
}

export function navForward(h: NavHistory): NavHistory | null {
  if (h.index >= h.urls.length - 1) return null;
  return { urls: h.urls, index: h.index + 1 };
}

const BOOKMARKS_KEY = "yamet.preview.bookmarks";

export function loadBookmarks(): string[] {
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function persistBookmarks(list: string[]): void {
  try {
    window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  } catch {
    // storage may fail in private mode
  }
}

export function toggleBookmark(
  list: string[],
  url: string,
): { list: string[]; added: boolean } {
  if (list.includes(url)) {
    const next = list.filter((u) => u !== url);
    persistBookmarks(next);
    return { list: next, added: false };
  }
  const next = [url, ...list];
  persistBookmarks(next);
  return { list: next, added: true };
}
