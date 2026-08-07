import type { IOsAdapter } from "../types";

export const webOs: IOsAdapter = {
  async platform(): Promise<string> {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("win")) return "windows";
    if (ua.includes("mac")) return "macos";
    return "linux";
  },
  async arch(): Promise<string> {
    // navigator.userAgentData is async and may not be available
    const ua = navigator.userAgent;
    if (ua.includes("x86_64") || ua.includes("x64") || ua.includes("Win64"))
      return "x86_64";
    if (ua.includes("aarch64") || ua.includes("arm64")) return "aarch64";
    return "unknown";
  },
};
