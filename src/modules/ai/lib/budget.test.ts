import { describe, expect, it } from "vitest";
import {
  createBudget,
  getActiveBudget,
  refundStep,
  setActiveBudget,
  tryConsumeStep,
} from "./budget";

describe("createBudget (H5 IterationBudget)", () => {
  it("consume() returns true up to max, then false with no effect", () => {
    const b = createBudget({ max: 3 });
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false); // exhausted — no more units
    expect(b.used).toBe(3);
    expect(b.exhausted()).toBe(true);
    expect(b.remaining()).toBe(0);
  });

  it("refund() returns a unit and never goes below 0", () => {
    const b = createBudget({ max: 2 });
    b.consume();
    b.consume();
    b.refund();
    expect(b.used).toBe(1);
    expect(b.consume()).toBe(true); // space freed up
    b.refund();
    b.refund();
    b.refund(); // below 0 — clamped
    expect(b.used).toBe(0);
  });

  it("max 0 means unlimited", () => {
    const b = createBudget({ max: 0 });
    expect(b.exhausted()).toBe(false);
    expect(b.remaining()).toBe(Infinity);
    for (let i = 0; i < 100; i++) expect(b.consume()).toBe(true);
  });

  it("reset() clears usage", () => {
    const b = createBudget({ max: 1 });
    b.consume();
    expect(b.exhausted()).toBe(true);
    b.reset();
    expect(b.exhausted()).toBe(false);
    expect(b.used).toBe(0);
  });

  it("module-level active budget gates tryConsumeStep/refundStep", () => {
    setActiveBudget(null);
    // No budget armed — every step allowed.
    expect(tryConsumeStep()).toBe(true);
    expect(getActiveBudget()).toBeNull();

    const b = createBudget({ max: 1 });
    setActiveBudget(b);
    expect(tryConsumeStep()).toBe(true);
    expect(tryConsumeStep()).toBe(false); // exhausted
    refundStep();
    expect(tryConsumeStep()).toBe(true); // refunded

    setActiveBudget(null);
  });
});
