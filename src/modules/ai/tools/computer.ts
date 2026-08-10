import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import type { ToolContext } from "./context";

/**
 * §3.1.2 Built-in computer-use tools (screenshot, click, type, read_tree).
 * All tools require approval (needsApproval: true) per §3.1.3.
 */
export function buildComputerTools(_ctx: ToolContext) {
  return {
    computer_screenshot: tool({
      description:
        "Capture a screenshot of the current screen as a PNG data URL. Requires approval.",
      inputSchema: z.object({}),
      needsApproval: true,
      execute: async () => {
        try {
          const result = await native.computerScreenshot();
          if (result.ok && result.imageDataUrl) {
            return {
              imageDataUrl: result.imageDataUrl,
              width: result.width,
              height: result.height,
              scale: result.scale,
            };
          }
          return { error: result.error ?? "screenshot failed" };
        } catch (e) {
          return { error: `screenshot failed: ${String(e)}` };
        }
      },
    }),

    computer_click: tool({
      description:
        "Click at screen coordinates (pixels). Supports left/right/middle buttons. Requires approval.",
      inputSchema: z.object({
        x: z.number().int().describe("Screen X coordinate (pixels)"),
        y: z.number().int().describe("Screen Y coordinate (pixels)"),
        button: z
          .enum(["left", "right", "middle"])
          .optional()
          .describe("Mouse button (default left)"),
      }),
      needsApproval: true,
      execute: async ({ x, y, button }) => {
        try {
          await native.computerClick(x, y, button ?? "left");
          return { ok: true, x, y, button: button ?? "left" };
        } catch (e) {
          return { error: `click failed: ${String(e)}` };
        }
      },
    }),

    computer_type: tool({
      description:
        "Type text into the currently focused window using Unicode input (any language). Requires approval.",
      inputSchema: z.object({
        text: z.string().describe("The text to type"),
      }),
      needsApproval: true,
      execute: async ({ text }) => {
        try {
          await native.computerType(text);
          return { ok: true, length: text.length };
        } catch (e) {
          return { error: `type failed: ${String(e)}` };
        }
      },
    }),

    computer_read_tree: tool({
      description:
        "Read the accessibility element tree of the current screen. Returns the UI element hierarchy. Read-only; requires approval.",
      inputSchema: z.object({}),
      needsApproval: true,
      execute: async () => {
        // R30 §2.2: the Rust command (Windows UIA) and native wrapper exist —
        // wire the tool to the real accessibility tree and pass platform
        // errors through instead of the old hardcoded stub.
        try {
          const tree = await native.computerReadAccessibilityTree();
          return { ok: true, tree };
        } catch (e) {
          return { ok: false, error: `read_tree failed: ${String(e)}` };
        }
      },
    }),
  } as const;
}
