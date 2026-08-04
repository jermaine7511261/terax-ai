import {
  Bug01Icon,
  CheckListIcon,
  ClaudeIcon,
  CodeSquareIcon,
  Search01Icon,
  SparklesIcon,
  TestTube01Icon,
} from "@hugeicons/core-free-icons";
import { usePlanStore } from "../store/planStore";

/**
 * Outcome of intercepting a slash command from the composer.
 *
 * - `"handled"`: command ran; the composer should NOT send a chat message.
 * - `"send-prompt"`: replace the user's text with `prompt` and send normally.
 * - `"none"`: not a slash command; let the composer behave as usual.
 */
export type SlashOutcome =
  | { kind: "handled"; toast?: string }
  | { kind: "send-prompt"; prompt: string; commandName?: string }
  | { kind: "none" };

function claudeCodeDirective(request: string): string {
  return `The user wants to drive a Claude Code agent through you. Their request:

<request>
${request}
</request>

You are the orchestrator, not the implementer. Do not write the code yourself.
1. Call read_agent_output to see whether a Claude Code agent is already active in this session.
2. If none is active: turn the request into one clear, complete, self-contained prompt (state the concrete goal, relevant constraints, and what "done" looks like) and call spawn_coding_agent with it.
3. If one is active: read its latest output, then craft a precise follow-up and call send_to_agent.
Sharpen vague requests into precise engineering instructions; keep each agent prompt focused on one coherent unit of work.`;
}

const INIT_PROMPT = `Scan this workspace and produce YAMET.md at the workspace root with:

- One-paragraph project description.
- Build / test / dev commands.
- Architecture overview (subsystems, data flow, key dirs).
- Conventions worth knowing (naming, patterns, gotchas).
- Paths to entry points.

Use grep/glob/list_directory/read_file to explore. Cap YAMET.md under 200 lines. Use write_file to create it (will go through normal approval).`;

const REVIEW_PROMPT = `Review the current set of uncommitted changes in this workspace and report concrete problems.

1. Run git diff (and git status) to see exactly what changed.
2. Look for bugs, regressions, style issues, missing error handling, security or performance problems in the diff.
3. For each issue found, cite the file and the specific lines involved, and explain why it's a problem.
4. Suggest a concrete fix for each issue. If a fix is small and safe, you may propose it as a patch.
5. Summarize the overall health of the change set (ready / needs work) at the end.

Be precise and avoid nitpicks unless they are genuinely worth fixing.`;

const COMMIT_PROMPT = `Generate a conventional, well-formed git commit message for the current uncommitted changes.

1. Run git status and git diff to inspect the staged and unstaged changes.
2. Summarize what the change set does in a clear imperative subject line (e.g. "feat(editor): add context menu to code pane").
3. If the diff is non-trivial, add a short body with bullet points of the key changes.
4. Follow conventional commits style (feat/fix/refactor/chore/docs/test/perf/style/build/ci).
5. If you are able to commit safely (the user expects it), stage and commit with that message via the shell. Otherwise just print the suggested message and ask whether to commit.

Do not commit unrelated or untracked files unless asked.`;

const TEST_PROMPT = `Find and run the tests most relevant to the current state of the workspace, then report the results.

1. Inspect the workspace to find the test setup (package.json scripts, vitest/jest config, test directories).
2. Determine which tests are relevant to the code you just changed or the active concern (scan recent git diff for touched modules).
3. Run the targeted tests (scope them, e.g. npx vitest run src/modules/<dir>). Do NOT run the entire unbounded suite unless it is small.
4. Report pass/fail counts, the commands you ran, and any failures with enough detail to debug them.

If tests fail, state clearly what broke and where.`;

const FIX_PROMPT = `Locate and fix the most recent error in this workspace, then verify the fix.

1. Find the last error: check the terminal buffer, the git diff / recent edits, build output, or run a quick targeted command to surface it.
2. Reproduce or locate the failing code path and identify the root cause.
3. Apply a minimal, correct fix to the source.
4. Re-run the relevant check (type-check, lint, or the failing test) to confirm the fix resolves it.
5. Report what was wrong, what you changed, and the verification result.

Make sure not to introduce unrelated changes.`;

export type SlashCommandMeta = {
  name: string;
  invocation: string;
  label: string;
  /** Optional i18n key for display; `label` stays English for fuzzy search. */
  labelKey?: string;
  icon: typeof SparklesIcon;
};

export const SLASH_COMMANDS: Record<string, SlashCommandMeta> = {
  init: {
    name: "init",
    invocation: "/init",
    label: "Initialize workspace",
    icon: SparklesIcon,
  },
  plan: {
    name: "plan",
    invocation: "/plan",
    label: "Plan mode",
    icon: CheckListIcon,
  },
  "claude-code": {
    name: "claude-code",
    invocation: "/claude-code",
    label: "Delegate to Claude Code",
    icon: ClaudeIcon,
  },
  review: {
    name: "review",
    invocation: "/review",
    label: "Review current diff",
    labelKey: "ai.slash.review",
    icon: Search01Icon,
  },
  commit: {
    name: "commit",
    invocation: "/commit",
    label: "Generate commit message",
    labelKey: "ai.slash.commit",
    icon: CodeSquareIcon,
  },
  test: {
    name: "test",
    invocation: "/test",
    label: "Find and run relevant tests",
    labelKey: "ai.slash.test",
    icon: TestTube01Icon,
  },
  fix: {
    name: "fix",
    invocation: "/fix",
    label: "Fix the most recent error",
    labelKey: "ai.slash.fix",
    icon: Bug01Icon,
  },
};

export const YAMET_CMD_RE =
  /^<yamet-command\s+name="([a-z0-9-]+)"(?:\s+state="([a-z]+)")?\s*\/>(?:\n+|$)/;

export function wrapWithCommandMarker(prompt: string, name: string): string {
  return `<yamet-command name="${name}" />\n\n${prompt}`;
}

export function tryRunSlashCommand(input: string): SlashOutcome {
  const trimmed = input.trim();
  const lead = trimmed[0];
  if (lead !== "/" && lead !== "#") return { kind: "none" };
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  if (lead === "#" && !SLASH_COMMANDS[head]) return { kind: "none" };
  const tail = rest.join(" ").trim();

  switch (head) {
    case "plan": {
      const store = usePlanStore.getState();
      if (tail === "off" || tail === "exit") {
        store.disable();
        return { kind: "handled", toast: "Plan mode off" };
      }
      store.toggle();
      const nowActive = usePlanStore.getState().active;
      return {
        kind: "handled",
        toast: nowActive ? "Plan mode on" : "Plan mode off",
      };
    }
    case "init": {
      return {
        kind: "send-prompt",
        prompt: INIT_PROMPT,
        commandName: "init",
      };
    }
    case "claude-code": {
      if (!tail) {
        return { kind: "handled", toast: "Usage: /claude-code <request>" };
      }
      return {
        kind: "send-prompt",
        prompt: claudeCodeDirective(tail),
        commandName: "claude-code",
      };
    }
    case "review":
      return {
        kind: "send-prompt",
        prompt: REVIEW_PROMPT,
        commandName: "review",
      };
    case "commit":
      return {
        kind: "send-prompt",
        prompt: COMMIT_PROMPT,
        commandName: "commit",
      };
    case "test":
      return {
        kind: "send-prompt",
        prompt: TEST_PROMPT,
        commandName: "test",
      };
    case "fix":
      return {
        kind: "send-prompt",
        prompt: FIX_PROMPT,
        commandName: "fix",
      };
    default:
      return { kind: "none" };
  }
}
