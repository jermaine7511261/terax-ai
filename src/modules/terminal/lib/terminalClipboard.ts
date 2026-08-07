// Terminal clipboard I/O. Routes the native path through the `@/platform`
// abstraction layer so feature code never imports `@tauri-apps/*` directly
// (platform rule). WebKitGTK can't read external copies, so the native plugin
// path is used only on Linux; everywhere else the web Clipboard API suffices
// and keeps the native plugin out of the mac/win bundle.
import { clipboardReadText, clipboardWriteText } from "@/platform";

const IS_LINUX =
  typeof navigator !== "undefined" &&
  /Linux/.test(navigator.userAgent) &&
  !/Android/.test(navigator.userAgent);

function webClipboard(): Clipboard | null {
  if (typeof navigator === "undefined") return null;
  return navigator.clipboard ?? null;
}

export async function readTerminalClipboard(): Promise<string> {
  if (IS_LINUX) {
    try {
      return await clipboardReadText();
    } catch {
      // fall through to the web Clipboard API below
    }
  }
  try {
    return (await webClipboard()?.readText()) ?? "";
  } catch {
    return "";
  }
}

export async function writeTerminalClipboard(text: string): Promise<void> {
  if (IS_LINUX) {
    try {
      await clipboardWriteText(text);
      return;
    } catch {
      // fall through to the web Clipboard API below
    }
  }
  try {
    await webClipboard()?.writeText(text);
  } catch {
    // Clipboard is best-effort.
  }
}
