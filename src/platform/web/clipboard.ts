import type { IClipboardAdapter } from "../types";

export const webClipboard: IClipboardAdapter = {
  async readText(): Promise<string> {
    return navigator.clipboard.readText();
  },
  async writeText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  },
};
