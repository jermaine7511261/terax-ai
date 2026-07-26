import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { addMemory } from "@/modules/memory/lib/memoryApi";
import { createSkill } from "@/modules/skills/lib/skillsApi";
import type { SkillDef } from "@/modules/skills/lib/skillsApi";

export type TurnRecord = {
  session_id: string;
  model_id: string;
  prompt_summary: string;
  response_summary: string;
  tools_used: string[];
  files_accessed: string[];
  errors: string[];
  timestamp: number;
};

export type ReviewResult = {
  skill_id: string | null;
  skill_name: string | null;
  skill_instructions: string | null;
  insight: string;
  confidence: number;
};

type LearningState = {
  isAnalyzing: boolean;
  lastReviewAt: number | null;
  reviewResults: ReviewResult[];
  learningEnabled: boolean;
  setIsAnalyzing: (v: boolean) => void;
  setLastReviewAt: (v: number) => void;
  setReviewResults: (r: ReviewResult[]) => void;
  setLearningEnabled: (v: boolean) => void;
};

export const useLearningStore = create<LearningState>((set) => ({
  isAnalyzing: false,
  lastReviewAt: null,
  reviewResults: [],
  learningEnabled: true,
  setIsAnalyzing: (v) => set({ isAnalyzing: v }),
  setLastReviewAt: (v) => set({ lastReviewAt: v }),
  setReviewResults: (r) => set({ reviewResults: r }),
  setLearningEnabled: (v) => set({ learningEnabled: v }),
}));

export async function recordTurn(record: TurnRecord): Promise<void> {
  try {
    await invoke("learn_record_turn", { record });
  } catch (e) {
    console.debug("Failed to record turn:", e);
  }
}

export async function buildReviewContext(
  sessionId: string,
): Promise<string> {
  try {
    return await invoke("learn_build_review_context", {
      sessionId,
    });
  } catch {
    return "";
  }
}

export async function storeReviewResult(
  result: ReviewResult,
): Promise<void> {
  try {
    await invoke("learn_store_review_result", { result });
    useLearningStore.getState().setReviewResults([
      result,
      ...useLearningStore.getState().reviewResults.slice(0, 49),
    ]);
  } catch (e) {
    console.debug("Failed to store review result:", e);
  }
}

export async function getReviewResults(
  count?: number,
): Promise<ReviewResult[]> {
  try {
    return await invoke("learn_get_review_results", {
      count: count ?? 20,
    });
  } catch {
    return [];
  }
}

export async function runCuratorCycle(): Promise<string[]> {
  try {
    return await invoke("learn_run_curator");
  } catch {
    return [];
  }
}

/**
 * Background review: called after each agent turn.
 * 1. Records the turn in the learning engine
 * 2. Every N turns, spawns a background analysis
 * 3. If patterns found, creates/improves a skill
 */
export async function backgroundReview(opts: {
  sessionId: string;
  modelId: string;
  promptSummary: string;
  responseSummary: string;
  toolsUsed: string[];
  filesAccessed: string[];
  errors: string[];
  turnIndex: number;
}): Promise<void> {
  if (!useLearningStore.getState().learningEnabled) return;

  // Record the turn
  const record: TurnRecord = {
    session_id: opts.sessionId,
    model_id: opts.modelId,
    prompt_summary: opts.promptSummary,
    response_summary: opts.responseSummary,
    tools_used: opts.toolsUsed,
    files_accessed: opts.filesAccessed,
    errors: opts.errors,
    timestamp: Date.now(),
  };
  await recordTurn(record);

  // Every 5 turns, perform a background review
  if (opts.turnIndex > 0 && opts.turnIndex % 5 === 0) {
    useLearningStore.getState().setIsAnalyzing(true);
    try {
      const context = await buildReviewContext(opts.sessionId);
      if (!context) return;

      // Store an initial review result (the actual LLM-based analysis
      // is done by the main Agent runtime, which calls this TS layer)
      const result: ReviewResult = {
        skill_id: null,
        skill_name: null,
        skill_instructions: null,
        insight: `Reviewed ${opts.turnIndex} turns in session ${opts.sessionId.slice(0, 8)}. Tools used: ${uniqueTools(opts.toolsUsed).join(", ")}.`,
        confidence: 0.5,
      };
      await storeReviewResult(result);
    } finally {
      useLearningStore.getState().setIsAnalyzing(false);
    }
  }

  // Run curator cycle every 24 hours
  const lastCurator = useLearningStore.getState().lastReviewAt;
  if (!lastCurator || Date.now() - lastCurator > 24 * 60 * 60 * 1000) {
    useLearningStore.getState().setLastReviewAt(Date.now());
    const archived = await runCuratorCycle();
    if (archived.length > 0) {
      console.debug("Curator archived skills:", archived);
    }
  }
}

/**
 * Create a skill from a review insight.
 * Called by the Agent when it identifies a reusable pattern.
 */
export async function createSkillFromReview(params: {
  name: string;
  description: string;
  category: string;
  instructions: string;
}): Promise<SkillDef | null> {
  const id = `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const skill: SkillDef = {
    id,
    name: params.name,
    description: params.description,
    category: params.category,
    instructions: params.instructions,
    version: "1.0.0",
    usage_count: 0,
    created_at: now,
    updated_at: now,
  };
  try {
    await createSkill(skill);
    // Also store as a memory for cross-session recall
    await addMemory(
      `skill-created-${id}`,
      `Created skill "${params.name}": ${params.description}`,
      `skill,${params.category}`,
      "learning-engine",
    );
    return skill;
  } catch (e) {
    console.debug("Failed to create skill:", e);
    return null;
  }
}

function uniqueTools(tools: string[]): string[] {
  return [...new Set(tools)];
}
