/**
 * Workspace command handlers for the web backend.
 */

import { register } from "../registry";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { setWorkspaceRoot } from "./fs";
import { setWorkspaceRoot as setShellRoot } from "./shell";

let currentRoot = process.cwd();

export function setInitialRoot(root: string): void {
  currentRoot = root;
  setWorkspaceRoot(root);
  setShellRoot(root);
}

register("workspace_current_dir", () => currentRoot);

register("workspace_authorize", (args) => {
  const p = args.path as string;
  // Validate the path exists and is a directory
  return fs.stat(p).then((stat) => {
    if (!stat.isDirectory()) throw new Error("Not a directory");
    currentRoot = p;
    setWorkspaceRoot(p);
    setShellRoot(p);
    return p;
  });
});
