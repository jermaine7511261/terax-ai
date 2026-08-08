import { describe, expect, it } from "vitest";
import {
  applyCurateDecision,
  curateSkill,
  curateSkills,
  shouldRunCurator,
  touchSkill,
  type SkillLifecycle,
} from "./skillCurator";

const NOW = 1_700_000_000_000; // realistic ms epoch (2023+)
const DAY = 24 * 60 * 60 * 1000;

function skill(name: string, over: Partial<SkillLifecycle> = {}): SkillLifecycle {
  return { name, activityTs: NOW, usageCount: 1, status: "active", agentCreated: true, ...over };
}

describe("curateSkill (P1-5 lifecycle)", () => {
  it("archives a stale agent-created skill unused past the threshold", () => {
    const d = curateSkill(
      skill("old", { activityTs: NOW - 40 * DAY }),
      NOW,
      { archiveAfterMs: 30 * DAY, pinUsageThreshold: 5, onlyAgentCreated: true },
    );
    expect(d.action).toBe("archive");
  });

  it("keeps a non-agent-created skill untouched when onlyAgentCreated", () => {
    const d = curateSkill(skill("builtin", { agentCreated: false }), NOW);
    expect(d.action).toBe("keep");
    expect(d.reason).toContain("not agent-created");
  });

  it("never archives a pinned skill even when stale", () => {
    const d = curateSkill(
      skill("fave", { pinned: true, activityTs: NOW - 100 * DAY }),
      NOW,
    );
    expect(d.action).toBe("keep");
    expect(d.reason).toBe("pinned");
  });

  it("keeps an already-archived skill (terminal state, never re-pinned)", () => {
    const d = curateSkill(skill("old", { status: "archived" }), NOW);
    expect(d.action).toBe("keep");
  });

  it("pins a high-usage skill", () => {
    const d = curateSkill(
      skill("hot", { usageCount: 8 }),
      NOW,
    );
    expect(d.action).toBe("pin");
  });

  it("keeps an active recently-used skill", () => {
    const d = curateSkill(skill("normal", { activityTs: NOW - 5 * DAY }), NOW);
    expect(d.action).toBe("keep");
  });
});

describe("curateSkills", () => {
  it("returns only non-keep decisions, filtering pinned/non-agent", () => {
    const decisions = curateSkills(
      [
        skill("stale", { activityTs: NOW - 40 * DAY }),
        skill("pinned", { pinned: true, activityTs: NOW - 40 * DAY }),
        skill("builtin", { agentCreated: false, activityTs: NOW - 40 * DAY }),
        skill("active"),
      ],
      NOW,
    );
    expect(decisions.length).toBe(1);
    expect(decisions[0].name).toBe("stale");
  });
});

describe("touchSkill / shouldRunCurator", () => {
  it("touchSkill bumps activityTs and keeps status active", () => {
    const t = touchSkill(skill("s", { activityTs: NOW - 10 * DAY }), NOW, 4);
    expect(t.activityTs).toBe(NOW);
    expect(t.usageCount).toBe(4);
    expect(t.status).toBe("active");
  });

  it("shouldRunCurator returns true only after the interval elapses", () => {
    expect(
      shouldRunCurator({ lastRunAt: NOW - 1000, now: NOW, intervalMs: 500 }),
    ).toBe(true);
    expect(
      shouldRunCurator({ lastRunAt: NOW - 100, now: NOW, intervalMs: 500 }),
    ).toBe(false);
  });
});

describe("applyCurateDecision", () => {
  it("archive decision writes archived:true", () => {
    const out = applyCurateDecision(
      { name: "x", prompt: "p" },
      { action: "archive", name: "x", reason: "idle" },
    );
    expect(out?.archived).toBe(true);
  });
  it("pin/keep decisions are no-ops (return null)", () => {
    expect(
      applyCurateDecision(
        { name: "x", prompt: "p" },
        { action: "pin", name: "x", reason: "high usage" },
      ),
    ).toBeNull();
    expect(
      applyCurateDecision(
        { name: "x", prompt: "p" },
        { action: "keep", name: "x", reason: "active" },
      ),
    ).toBeNull();
  });
});
