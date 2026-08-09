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
          const result = await native.computerCapture(0);
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
          await native.computerAction(0, {
            kind: "click",
            x,
            y,
          });
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
          await native.computerAction(0, {
            kind: "type",
            text,
          });
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
        // Accessibility-tree extraction needs a native OS bridge that is not
        // implemented yet; keep the tool surface defined but degrade cleanly
        // instead of calling a non-existent command.
        return {
          ok: false,
          error:
            "accessibility tree is not implemented on this platform yet; use computer_screenshot instead",
        };
      },
    }),
  } as const;
}
