import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/lib/native", () => ({
  native: {},
}));
vi.mock("@/modules/workspace", () => ({
  useWorkspaceEnvStore: () => ({}),
  workspaceScopeKey: "test",
}));

import { getSourceControlRemoteIndicator } from "./useSourceControl";
import type { SourceControlSummary } from "./useSourceControl";

const base: Pick<
  SourceControlSummary,
  "hasRepo" | "upstream" | "ahead" | "behind" | "busyAction"
> = { hasRepo: true, upstream: "origin/main", ahead: 0, behind: 0, busyAction: null };

describe("getSourceControlRemoteIndicator", () => {
  it("hides when there is no repo or upstream", () => {
    expect(getSourceControlRemoteIndicator({ ...base, hasRepo: false })).toMatchObject({
      visible: false,
      action: null,
    });
    expect(getSourceControlRemoteIndicator({ ...base, upstream: null })).toMatchObject({
      visible: false,
      action: null,
    });
  });

  it("reports diverged as visible and disabled", () => {
    const r = getSourceControlRemoteIndicator({ ...base, ahead: 2, behind: 3 });
    expect(r).toMatchObject({ visible: true, disabled: true, action: null });
  });

  it("offers pull when behind only", () => {
    const r = getSourceControlRemoteIndicator({ ...base, behind: 1 });
    expect(r).toMatchObject({ visible: true, action: "pull", disabled: false });
  });

  it("offers push when ahead only", () => {
    const r = getSourceControlRemoteIndicator({ ...base, ahead: 4 });
    expect(r).toMatchObject({ visible: true, action: "push", disabled: false });
  });

  it("offers fetch when in sync", () => {
    const r = getSourceControlRemoteIndicator(base);
    expect(r).toMatchObject({ visible: true, action: "fetch" });
  });

  it("disables the action while a git action is busy", () => {
    const r = getSourceControlRemoteIndicator({ ...base, ahead: 1, busyAction: "push" });
    expect(r).toMatchObject({ action: "push", disabled: true });
  });
});
