import { buildManagedAgentTools } from "./agent";
import { buildComputerTools } from "./computer";
import { buildCreateSkillTools } from "./createSkill";
import { buildDelegateManyTools } from "./delegateMany";
import { buildDeepSearchTools } from "./deepSearch";
import { buildEditTools } from "./edit";
import { buildExternalAgentTools } from "./externalAgent";
import { buildFsTools } from "./fs";
import { buildFusionTools } from "./fusion";
import { buildSpreadsheetTools } from "./spreadsheet";
import { buildGitTools } from "./git";
import { buildGraphTools } from "./graph";
import { buildHandoffTools } from "./handoff";
import { buildImportRulesTools } from "./importRules";
import { buildLspTools } from "./lsp";
import { buildMcpTools } from "./mcp";
import { buildMediaTools } from "./media";
import { buildMemoryTools } from "./memory";
import { buildNetTools } from "./net";
import { buildSearchMemoriesTools } from "./searchMemories";
import { buildSearchTools } from "./search";
import { buildShellTools } from "./shell";
import { buildSubagentTools } from "./subagent";
import { buildSwarmFlowTools } from "./swarmFlow";
import { buildTerminalTools } from "./terminal";
import { buildTodoTools } from "./todo";

export { resolvePath, type ToolContext } from "./context";
// Registry lives in a separate lightweight module so the settings window can
// render the tool-allowlist picker without eagerly pulling the AI tool stack.
export { TOOL_REGISTRY } from "./registry";

/**
 * AI tool definitions.
 *
 * Approval policy:
 *  - Read-only tools (`read_file`, `list_directory`, `grep`, `glob`)
 *    auto-execute, but go through the security guard which refuses obvious
 *    secret paths (.env*, .ssh/, credentials, etc.).
 *  - Mutating tools (`write_file`, `edit`, `multi_edit`, `create_directory`,
 *    `run_command`) require explicit user approval — the AI SDK pauses on
 *    tool-call and surfaces a `tool-approval-request` part that the UI
 *    renders as a confirmation card.
 *  - `edit` / `multi_edit` additionally enforce a read-before-edit invariant
 *    (the model must have called read_file on the path earlier in the
 *    session).
 *
 * The model sees absolute paths only after they are resolved against the
 * active terminal's cwd (provided via `getCwd`); it should not invent paths
 * outside that.
 */
export function buildTools(ctx: import("./context").ToolContext) {
  return {
    ...buildFsTools(ctx),
    ...buildSpreadsheetTools(ctx),
    ...buildGitTools(ctx),
    ...buildEditTools(ctx),
    ...buildSearchTools(ctx),
    ...buildShellTools(ctx),
    ...buildSubagentTools(ctx),
    ...buildDelegateManyTools(ctx),
    ...buildSwarmFlowTools(ctx),
    ...buildExternalAgentTools(ctx),
    ...buildTerminalTools(ctx),
    ...buildTodoTools(ctx),
    ...buildMemoryTools(ctx),
    ...buildSearchMemoriesTools(ctx),
    ...buildNetTools(ctx),
    ...buildDeepSearchTools(ctx),
    ...buildManagedAgentTools(ctx),
    ...buildCreateSkillTools(ctx),
    ...buildGraphTools(ctx),
    ...buildHandoffTools(ctx),
    ...buildMediaTools(ctx),
    ...buildLspTools(ctx),
    // §3.1.2 computer-use tools
    ...buildComputerTools(ctx),
    // §3.3 multi-model fusion
    ...buildFusionTools(ctx),
    // §3.4.3 rules import
    ...buildImportRulesTools(ctx),
    // Dynamic MCP tools (read from the live mcpStore; all needsApproval).
    ...buildMcpTools(),
  } as const;
}

export type ChatTools = ReturnType<typeof buildTools>;
