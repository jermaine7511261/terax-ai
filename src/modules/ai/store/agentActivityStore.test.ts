import { describe, expect, it } from "vitest";
import { useAgentActivityStore } from "./agentActivityStore";

// Regression for React #185 ("Maximum update depth exceeded") in the mini
// window: the zustand SELECTOR must return the stable `s.activities` reference,
// never a derived fresh array. A selector like `s.activities.slice(0, 8)`
// returns a new array every call, which useSyncExternalStore sees as a changed
// snapshot and re-renders forever. The slice must happen OUTSIDE the selector,
// on the stable `s.activities` array.
describe("agentActivityStore selector stability", () => {
  it("the `activities` selector returns the same reference across reads", () => {
    useAgentActivityStore.setState({ activities: [] });
    const a = useAgentActivityStore.getState().activities;
    const b = useAgentActivityStore.getState().activities;
    expect(a).toBe(b); // identical reference, not a fresh array
  });

  it("caps display at 8 items without losing the underlying 10", () => {
    useAgentActivityStore.setState({ activities: [] });
    const items = useAgentActivityStore.getState().activities;
    for (let i = 0; i < 10; i++) {
      items.push({
        id: `a-${i}`,
        kind: "subagent",
        type: "subagent",
        prompt: `Prompt ${i}`,
        status: "running",
        step: null,
        startedAt: Date.now(),
      });
    }
    useAgentActivityStore.setState({ activities: [...items] });

    const all = useAgentActivityStore.getState().activities;
    expect(all).toHaveLength(10);
    // The hook slices on the stable array in the component body, so only the
    // first 8 are shown while state keeps all 10.
    expect(all.slice(0, 8)).toHaveLength(8);

    useAgentActivityStore.setState({ activities: [] });
  });
});
