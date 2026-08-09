/**
 * Browser-compatible path utilities.
 * In web mode, paths are managed by the backend server — these provide
 * sensible defaults for UI logic that needs path strings.
 */

import type { IPathAdapter } from "../types";

export const webPath: IPathAdapter = {
  async homeDir(): Promise<string> {
    return "/";
  },

  async join(...parts: string[]): Promise<string> {
    // Normalize separators and remove empty segments
    const filtered = parts.filter((p) => p && p !== ".");
    if (filtered.length === 0) return "/";
    // Handle absolute first segment
    let result = filtered[0].replace(/\/+$/, "");
    for (let i = 1; i < filtered.length; i++) {
      const seg = filtered[i].replace(/^\/+/, "").replace(/\/+$/, "");
      result += `/${seg}`;
    }
    return result || "/";
  },

  async appConfigDir(): Promise<string> {
    return "/.config/YaMet";
  },
};
