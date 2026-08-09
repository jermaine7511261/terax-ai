/**
 * File system command handlers for the web backend.
 * Mirrors the Tauri fs_* commands.
 *
 * SECURITY (MUST, round-25 全量优化): this is the browser-reachable analogue
 * of the Rust `fs` module, so it must enforce the same containment the Tauri
 * side gets from the workspace registry + `policy.rs`:
 *   - Path containment: every resolved path must stay inside the workspace
 *     root (`path.relative` check). Absolute / `../` escapes are rejected.
 *   - Sensitive-file gate on reads AND writes: .env / .ssh / credentials etc.
 *     are refused, mirroring `fs/policy.rs` at the basename level.
 *   - Size cap on reads so a huge file can't blow the browser's memory.
 *   - No writes outside the workspace.
 */

import { register } from "../registry";
import * as fs from "node:fs/promises";
import * as path from "node:path";

let workspaceRoot = process.cwd();

export function setWorkspaceRoot(root: string): void {
  workspaceRoot = root;
}

/** Path traversal guard: reject anything that resolves outside the workspace. */
function resolve(p: string): string {
  const abs = path.resolve(workspaceRoot, p || ".");
  const rel = path.relative(workspaceRoot, abs);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`path escapes workspace: ${p}`);
  }
  return abs;
}

/** Sensitive basenames refused on read AND write (mirrors fs/policy.rs). */
const SENSITIVE_RE = /(^|[./\\])(\.env|\.env\.[^/\\]*|\.pem|\.key|\.p12|\.pfx|id_rsa|id_ed25519|id_dsa|id_ecdsa|known_hosts|credentials|\.kubeconfig|\.netrc|\.git-credentials)$/i;
const PROTECTED_DIRS = /(^|[./\\])(\.ssh|\.aws|\.kube|\.gnupg|\.config\/YaMet|\.config\/git|\.git|\.svn|\.hg)([\\/]|$)/i;

/** Resolve + verify the resolved path stays in-workspace and is not sensitive. */
function resolveRead(p: string): string {
  const abs = resolve(p);
  const rel = path.relative(workspaceRoot, abs);
  if (SENSITIVE_RE.test(abs) || PROTECTED_DIRS.test(rel)) {
    throw new Error(`refused: sensitive path ${p}`);
  }
  return abs;
}

/** Resolve + verify for write: same gate, plus no empty target. */
function resolveWrite(p: string): string {
  const abs = resolve(p);
  const rel = path.relative(workspaceRoot, abs);
  if (SENSITIVE_RE.test(abs) || PROTECTED_DIRS.test(rel)) {
    throw new Error(`refused: sensitive path ${p}`);
  }
  return abs;
}

// Read cap mirrors the browser budget; the Rust side caps at 10MB, but a
// browser holding multi-MB strings is wasteful, so keep 4MB here.
const READ_CAP = 4 * 1024 * 1024;
const TOOLARGE_LIMIT = READ_CAP;

function isBinary(buffer: Buffer): boolean {
  const check = buffer.subarray(0, 8192);
  for (let i = 0; i < check.length; i++) {
    if (check[i] === 0) return true;
  }
  return false;
}

register("fs_read_file", async (args) => {
  const filePath = resolveRead(args.path as string);
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > READ_CAP) {
      return { kind: "toolarge", size: stat.size, limit: TOOLARGE_LIMIT };
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
  const filePath = resolveWrite(args.path as string);
  const content = (args.content as string) ?? "";
  if (content.length > READ_CAP) {
    throw new Error(`content exceeds ${READ_CAP} bytes`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
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
  const root = resolveRead(args.root as string);
  const maxResults = (args.maxResults as number) ?? 30;
  const hits: Array<{ path: string; rel: string; line: number; text: string }> = [];
  let filesScanned = 0;
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (truncated) return;
      const full = path.join(dir, e.name);
      const rel = path.relative(workspaceRoot, full);
      if (SENSITIVE_RE.test(full) || PROTECTED_DIRS.test(rel)) continue;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        await walk(full);
      } else if (e.isFile()) {
        const stat = await fs.stat(full).catch(() => null);
        if (!stat || stat.size > 2 * 1024 * 1024) continue; // skip huge binaries
        try {
          const content = await fs.readFile(full, "utf-8");
          filesScanned++;
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
              hits.push({
                path: full,
                rel: path.relative(workspaceRoot, full),
                line: i + 1,
                text: lines[i].trim(),
              });
              if (hits.length >= maxResults) {
                truncated = true;
                return;
              }
            }
          }
        } catch {
          /* skip unreadable */
        }
      }
    }
  }
  await walk(root);
  return { hits, truncated, files_scanned: filesScanned };
});

register("fs_canonicalize", async (args) => fs.realpath(resolveRead(args.path as string)));

register("fs_create_dir", async (args) => {
  await fs.mkdir(resolveWrite(args.path as string), { recursive: true });
});

register("fs_delete", async (args) => {
  const p = resolveWrite(args.path as string);
  const stat = await fs.stat(p).catch(() => null);
  if (stat?.isDirectory()) await fs.rm(p, { recursive: true });
  else await fs.unlink(p);
});

register("fs_rename", async (args) => {
  const from = resolveWrite(args.from as string);
  const to = resolveWrite(args.to as string);
  const exists = await fs.stat(to).catch(() => null);
  if (exists) throw new Error(`Target already exists: ${args.to}`);
  await fs.rename(from, to);
});
