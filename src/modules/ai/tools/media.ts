import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import type { ToolContext } from "./context";

/**
 * Media generation tool (R29 §3.6.2): `generate_image` calls the Rust
 * `generate_image` command (OpenAI DALL-E / Gemini / Stability) and returns a
 * data-URL the chat can render inline. All generation requires approval.
 */
export function buildMediaTools(_ctx: ToolContext) {
  return {
    generate_image: tool({
      description:
        "Generate an image from a text prompt via an image model (OpenAI DALL-E, Google Gemini Imagen, or Stability). Returns the image as a data URL for inline display. Asks for approval before generating.",
      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe("Detailed image prompt describing what to generate."),
        provider: z
          .enum(["openai", "gemini", "stability"])
          .describe(
            "Image provider. Uses the matching API key from the keyring.",
          ),
        size: z
          .enum(["1024x1024", "1792x1024", "1024x1792"])
          .optional()
          .describe(
            "Output resolution (provider-dependent; defaults to the provider default).",
          ),
      }),
      needsApproval: true,
      execute: async ({ prompt, provider, size }) => {
        try {
          const r = await native.generateImage({
            prompt,
            provider,
            size: size ?? null,
          });
          if (!r.ok) {
            return { error: r.error ?? "image generation failed" };
          }
          return {
            imageDataUrl: r.imageDataUrl,
            provider: r.provider,
            model: r.model ?? null,
          };
        } catch (e) {
          return { error: `image generation failed: ${String(e)}` };
        }
      },
    }),
  } as const;
}
