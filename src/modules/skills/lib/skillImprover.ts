import { listSkills, createSkill, type SkillDef } from "./skillsApi";
import { addMemory } from "@/modules/memory/lib/memoryApi";

type ImprovementSuggestion = {
  skillId: string;
  currentName: string;
  suggestion: string;
  reason: string;
};

/**
 * Analyze skill usage and determine if improvements are needed.
 * Rules:
 * - Skills used 0 times in 30 days → mark as stale
 * - Skills with vague names → suggest renaming
 * - Skills with very short instructions → suggest expanding
 */
export async function analyzeSkillsForImprovement(): Promise<ImprovementSuggestion[]> {
  const skills = await listSkills();
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const suggestions: ImprovementSuggestion[] = [];

  for (const skill of skills) {
    const updatedAt = new Date(skill.updated_at).getTime();
    const age = now - updatedAt;

    // Stale detection
    if (skill.usage_count === 0 && age > thirtyDays) {
      suggestions.push({
        skillId: skill.id,
        currentName: skill.name,
        suggestion: `Archive "${skill.name}" — unused for ${Math.floor(age / (24 * 60 * 60 * 1000))} days`,
        reason: "stale",
      });
      continue;
    }

    // Vague name detection
    if (skill.name.length < 5 || /^skill\d+$/.test(skill.name)) {
      suggestions.push({
        skillId: skill.id,
        currentName: skill.name,
        suggestion: `Rename "${skill.name}" to something descriptive`,
        reason: "vague-name",
      });
    }

    // Short instructions
    if (skill.instructions.length < 100 && skill.usage_count > 5) {
      suggestions.push({
        skillId: skill.id,
        currentName: skill.name,
        suggestion: `Expand instructions for "${skill.name}" (currently ${skill.instructions.length} chars, used ${skill.usage_count} times)`,
        reason: "too-short",
      });
    }
  }

  return suggestions;
}

/**
 * Automatically improve a skill by regenerating its instructions.
 * This is called by the learning engine when patterns suggest improvement.
 */
export async function improveSkillInstructions(
  skill: SkillDef,
  newInstructions: string,
): Promise<boolean> {
  try {
    const improved: SkillDef = {
      ...skill,
      instructions: newInstructions,
      version: bumpVersion(skill.version),
      updated_at: new Date().toISOString(),
    };
    await createSkill(improved);
    await addMemory(
      `skill-improved-${skill.id}`,
      `Improved skill "${skill.name}" to v${improved.version}`,
      `skill,improvement,${skill.category}`,
      "skill-improver",
    );
    return true;
  } catch {
    return false;
  }
}

function bumpVersion(version: string): string {
  const parts = version.split(".").map(Number);
  if (parts.length === 3) {
    parts[2] = (parts[2] || 0) + 1;
  } else {
    return "1.0.1";
  }
  return parts.join(".");
}
