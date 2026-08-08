/**
 * File system command handlers for the web backend.
 * Mirrors the Tauri fs_* commands.
 */

import { register } from "../registry";
import * as fs from "node:fs/promises";
import * as path from "node:path";

let workspaceRoot = process.cwd();

export function setWorkspaceRoot(root: string): void {
  workspaceRoot = root;
}

function resolve(p: string): string {
  return path.resolve(workspaceRoot, p);
}

function isBinary(buffer: Buffer): boolean {
  const check = buffer.subarray(0, 8192);
  for (let i = 0; i < check.length; i++) {
    if (check[i] === 0) return true;
  }
  return false;
}

register("fs_read_file", async (args) => {
  const filePath = resolve(args.path as string);
  try {
    const stat = await fs.stat(filePath);
    const LARGE = 256 * 1024;
    if (stat.size > LARGE) {
      return { kind: "toolarge", size: stat.size, limit: LARGE };
    }
    const buffer = await fs.readFile(filePath);
    if (isBinary(buffer)) {
      return { kind: "binary", size: stat.size };
    }
    return { kind: "text", content: buffer.toString("utf-8"), size: stat.size };
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "text", content: "", size: 0 };
    }
    throw e;
  }
});

register("fs_write_file", async (args) => {
  const filePath = resolve(args.path as string);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, args.content as string, "utf-8");
});

register("fs_read_dir", async (args) => {
  const dirPath = resolve(args.path as string);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return Promise.all(
    entries.map(async (e) => {
      const full = path.join(dirPath, e.name);
      const stat = await fs.stat(full).catch(() => null);
      return {
        name: e.name,
        kind: e.isDirectory() ? "dir" : e.isSymbolicLink() ? "symlink" : "file",
        size: stat?.size ?? 0,
        mtime: stat?.mtimeMs ?? 0,
        gitignored: false,
      };
    }),
  );
});

register("fs_grep", async (args) => {
  const pattern = new RegExp(
    args.pattern as string,
    (args.caseInsensitive as boolean) ? "i" : undefined,
  );
  const root = resolve(args.root as string);
  const maxResults = (args.maxResults as number) ?? 30;
  const hits: Array<{ path: string; rel: string; line: number; text: string }> = [];
  let filesScanned = 0;

  async function walk(dir: string): Promise<void> {
    if (hits.length >= maxResults) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (hits.length >= maxResults) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        await walk(full);
      } else if (e.isFile()) {
        try {
          const content = await fs.readFile(full, "utf-8");
          filesScanned++;
          for (let i = 0; i < content.split("\n").length; i++) {
            const line = content.split("\n")[i];
            if (pattern.test(line)) {
              hits.push({
                path: full,
                rel: path.relative(workspaceRoot, full),
                line: i + 1,
                text: line.trim(),
              });
              if (hits.length >= maxResults) break;
            }
          }
        } catch { /* skip unreadable */ }
      }
    }
  }
  await walk(root);
  return { hits, truncated: false, files_scanned: filesScanned };
});

register("fs_canonicalize", async (args) => fs.realpath(resolve(args.path as string)));

register("fs_create_dir", async (args) => {
  await fs.mkdir(resolve(args.path as string), { recursive: true });
});

register("fs_delete", async (args) => {
  const p = resolve(args.path as string);
  const stat = await fs.stat(p).catch(() => null);
  if (stat?.isDirectory()) await fs.rm(p, { recursive: true });
  else await fs.unlink(p);
});

register("fs_rename", async (args) => {
  const from = resolve(args.from as string);
  const to = resolve(args.to as string);
  const exists = await fs.stat(to).catch(() => null);
  if (exists) throw new Error(`Target already exists: ${args.to}`);
  await fs.rename(from, to);
});
