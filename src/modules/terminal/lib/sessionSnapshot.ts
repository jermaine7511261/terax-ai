// Disk-persisted terminal buffer snapshots (I1c light path / helper fallback).
//
// A terminal tab periodically (and on dispose) serializes its xterm buffer to
// `~/.yamet/sessions/<leafId>.snap`. When a restored cold tab is activated we
// replay the snapshot into the grid and then spawn a fresh shell in the
// original cwd, so the previous session's visible output (including
// scrollback) survives a restart without needing process-level reconnect.
// All failures are silent: no snapshot support degrades to a plain new shell.

import { native } from "@/modules/ai/lib/native";
import { homeDir } from "@tauri-apps/api/path";

let cachedHome: string | null = null;

async function getHome(): Promise<string | null> {
  if (cachedHome !== null) return cachedHome;
  try {
    cachedHome = (await homeDir()).replace(/\\/g, "/");
  } catch {
    cachedHome = null;
  }
  return cachedHome;
}

// Serialized buffer cap: ~1000 full 80x24 screens. Beyond this we truncate
// the head (oldest scrollback) rather than refuse to persist.
const MAX_BYTES = 4 * 1024 * 1024;

function snapPath(leafId: number, home: string): string {
  return `${home}/.yamet/sessions/${leafId}.snap`;
}

function busyPath(leafId: number, home: string): string {
  return `${home}/.yamet/sessions/${leafId}.busy`;
}

// Marker written when a terminal exits with a foreground job / TUI running
// (a state we refuse to snapshot). On restore the tab can tell the user the
// previous session's live process was not preserved.
export async function saveBusyMarker(leafId: number): Promise<void> {
  const home = await getHome();
  if (!home) return;
  try {
    await native.createDir(`${home}/.yamet/sessions`);
  } catch {
    // Already exists.
  }
  try {
    await native.writeFile(busyPath(leafId, home), "1");
  } catch {
    // Best-effort.
  }
}

export async function hasBusyMarker(leafId: number): Promise<boolean> {
  const home = await getHome();
  if (!home) return false;
  try {
    await native.readFile(busyPath(leafId, home));
    return true;
  } catch {
    return false;
  }
}

export async function clearBusyMarker(leafId: number): Promise<void> {
  const home = await getHome();
  if (!home) return;
  try {
    await native.deleteFile(busyPath(leafId, home));
  } catch {
    // Missing marker is fine.
  }
}

export async function saveTerminalSnapshot(
  leafId: number,
  text: string,
): Promise<void> {
  const home = await getHome();
  if (!home) return;
  const content = text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
  if (!content) return;
  try {
    await native.createDir(`${home}/.yamet/sessions`);
  } catch {
    // Already exists — the common case.
  }
  try {
    await native.writeFile(snapPath(leafId, home), content);
  } catch (e) {
    console.warn("[yamet] terminal snapshot save failed:", e);
  }
}

export async function loadTerminalSnapshot(
  leafId: number,
): Promise<string | null> {
  const home = await getHome();
  if (!home) return null;
  try {
    const r = await native.readFile(snapPath(leafId, home));
    return r.kind === "text" ? r.content : null;
  } catch {
    return null;
  }
}

export async function clearTerminalSnapshot(leafId: number): Promise<void> {
  const home = await getHome();
  if (!home) return;
  try {
    await native.deleteFile(snapPath(leafId, home));
  } catch {
    // Missing file is fine.
  }
}
