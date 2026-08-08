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

export function register(name: string, handler: CommandHandler): void {
  handlers.set(name, handler);
}

export async function execute(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
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
