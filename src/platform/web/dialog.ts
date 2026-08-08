/**
 * Dialog adapter for browser environments.
 * Uses the File System Access API when available; falls back to <input type="file">.
 */

import type { IDialogAdapter } from "../types";

export const webDialog: IDialogAdapter = {
  async open(options) {
    // Directory picker (if File System Access API available)
    if (options?.directory && "showDirectoryPicker" in window) {
      try {
        const dirHandle = await (window as unknown as {
          showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker();
        return dirHandle.name;
      } catch {
        return null;
      }
    }

    // File picker via <input type="file">
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = options?.multiple ?? false;

      if (options?.filters) {
        const accept: Record<string, string[]> = {};
        for (const f of options.filters) {
          accept[f.name] = f.extensions.map((e) => `.${e}`);
        }
        input.accept = Object.values(accept).flat().join(",");
      }

      input.onchange = () => {
        const files = input.files;
        if (!files || files.length === 0) {
          resolve(null);
          return;
        }
        if (files.length === 1 && !options?.multiple) {
          resolve(files[0].name);
        } else {
          resolve(Array.from(files).map((f) => f.name));
        }
      };

      input.oncancel = () => resolve(null);
      input.click();
    });
  },
};
