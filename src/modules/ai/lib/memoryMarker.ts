/**
 * Recalled-memory isolation marker + scrubber (P1-4, hermes
 * `StreamingContextScrubber`). Leaf module (no deps) so both `transport.ts`
 * (injection) and `agent.ts` (output scrub) import it without a cycle.
 */

/**
 * Marker isolating injected memory from model/user text. The injected block is
 * wrapped in this marker so a model echo of memory content can be stripped from
 * being mistaken for user input, and so downstream scrubbing knows exactly which
 * text came from the injected recall (vs. the conversation).
 */
export const MEMORY_NOTE = "[System note: recalled memory context]";
export const MEMORY_NOTE_END = "[end recalled memory]";

/**
 * Scrub any echo of the recalled-memory block out of a model reply. The model
 * sometimes quotes the injected context back; without stripping it, that echo
 * can be misread as new user input on the next turn. (hermes
 * StreamingContextScrubber.)
 */
export function scrubMemoryEcho(
  text: string,
  injected: string | null,
): string {
  if (!injected) return text;
  // The injected block already carries its isolation markers (see
  // buildRecalledMemory). Reconstruct the exact echoed block to search for:
  // if the caller passed bare content, wrap it; otherwise use it verbatim.
  const block = injected.includes(MEMORY_NOTE)
    ? injected
    : `${MEMORY_NOTE}\n${injected}\n${MEMORY_NOTE_END}`;
  const idx = text.indexOf(block);
  if (idx !== -1) {
    // Collapse to a single newline at the seam left by removing the block.
    const left = text.slice(0, idx).replace(/\n$/, "");
    const right = text.slice(idx + block.length).replace(/^\n/, "");
    return `${left}\n${right}`;
  }
  // Fallback: strip any isolated note markers.
  return text
    .split(MEMORY_NOTE_END)
    .map((s) => s.split(MEMORY_NOTE)[0])
    .join("");
}
