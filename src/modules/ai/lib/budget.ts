/**
 * Iteration budget (H5) — consume/refund counter modelled on hermes'
 * `IterationBudget`. Lets a parent agent (and each delegated subagent)
 * enforce a hard step ceiling with a refund path so a cancelled/errored run
 * can hand its remaining budget back.
 *
 * Pure module — no platform deps — unit-tested in `budget.test.ts`.
 */

export type BudgetOptions = {
  /** Hard ceiling on `consume()` successes (0 = unlimited). */
  max: number;
};

export type Budget = {
  used: number;
  max: number;
  /** Try to consume one unit. Returns false (no effect) when exhausted. */
  consume: () => boolean;
  /** Give back a previously-consumed unit (never goes below 0). */
  refund: () => void;
  remaining: () => number;
  exhausted: () => boolean;
  reset: () => void;
};

export function createBudget({ max }: BudgetOptions): Budget {
  let used = 0;
  return {
    get used() {
      return used;
    },
    max,
    consume() {
      if (max > 0 && used >= max) return false;
      used += 1;
      return true;
    },
    refund() {
      if (used > 0) used -= 1;
    },
    remaining: () => (max > 0 ? Math.max(0, max - used) : Infinity),
    exhausted: () => max > 0 && used >= max,
    reset: () => {
      used = 0;
    },
  };
}

/** The active budget instance for the current run (module-level singleton). */
let activeBudget: Budget | null = null;

export function setActiveBudget(b: Budget | null): void {
  activeBudget = b;
}

export function getActiveBudget(): Budget | null {
  return activeBudget;
}

/**
 * Consume one unit from the active budget if present. Returns true when the
 * run may continue (either no budget is armed, or a unit was available).
 */
export function tryConsumeStep(): boolean {
  if (!activeBudget) return true;
  return activeBudget.consume();
}

/** Refund the active budget by one unit (e.g. on a cancelled step). */
export function refundStep(): void {
  activeBudget?.refund();
}
