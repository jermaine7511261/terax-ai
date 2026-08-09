/**
 * Command-history handlers for the web backend (WebUI 服务端域扩展).
 * Backed by a rolling ring buffer in memory — web mode has no shell integration
 * to record real commands, so `history_suggest`/`history_list` return what the
 * frontend explicitly records via `history_record`.
 */

import { register } from "../registry";

const MAX_ENTRIES = 200;
const history: string[] = [];

function push(cmd: string): void {
  const c = cmd.trim();
  if (!c) return;
  history.push(c);
  if (history.length > MAX_ENTRIES) history.splice(0, history.length - MAX_ENTRIES);
}

register("history_record", (args) => {
  push((args.command as string) ?? "");
  return null;
});

register("history_list", (args) => {
  const limit = (args.limit as number) ?? 50;
  return history.slice(-limit);
});

register("history_suggest", (args) => {
  const prefix = ((args.prefix as string) ?? "").toLowerCase();
  if (!prefix) return history.slice(-10);
  const matches = history.filter((h) => h.toLowerCase().startsWith(prefix));
  return matches.slice(-10);
});

export function _resetHistoryForTests(): void {
  history.length = 0;
}
