/**
 * Command registry for the web backend server.
 *
 * Each Tauri `invoke("command_name", args)` from the frontend maps to a
 * registered handler here. The handler receives the same args and returns
 * a result (or throws an error string).
 *
 * To add a new command: register it with `register(name, handler)`.
 * The server's WebSocket loop dispatches to `registry.execute(name, args)`.
 */

export type CommandHandler = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

const handlers = new Map<string, CommandHandler>();

/**
 * Mutating commands that the web build must NEVER expose. The Rust Tauri side
 * gates these behind the workspace registry + approval; a browser-reachable
 * Node server has no such gate, so they are hard-rejected at dispatch time
 * regardless of whether a handler happens to be registered.
 */
const WRITE_BLOCKED = new Set([
  // git mutations
  "git_stage",
  "git_unstage",
  "git_commit",
  "git_push",
  "git_checkout_branch",
  "git_reset",
  // shell long-running / background
  "shell_session_open",
  "shell_bg_spawn",
  "pty_open",
]);

export function register(name: string, handler: CommandHandler): void {
  handlers.set(name, handler);
}

export async function execute(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (WRITE_BLOCKED.has(name)) {
    throw new Error(`command not allowed in web mode: ${name}`);
  }
  const handler = handlers.get(name);
  if (!handler) {
    throw new Error(`Unknown command: ${name}`);
  }
  return handler(args);
}

/** List all registered commands (for debugging). */
export function listCommands(): string[] {
  return Array.from(handlers.keys()).sort();
}
