import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  newSchedulerTaskId,
  schedulerDelete,
  schedulerList,
  schedulerToggle,
  schedulerUpsert,
  type ScheduledTask,
} from "./scheduler";

const mockInvoke = vi.mocked(invoke);

const task: ScheduledTask = {
  id: "cron-1",
  name: "Morning check",
  prompt: "Summarize overnight commits",
  cron: "0 9 * * *",
  target: "notification",
  enabled: true,
  last_fired_at: null,
};

describe("scheduler invoke wrappers", () => {
  it("schedulerList delegates to invoke", async () => {
    mockInvoke.mockResolvedValue([task]);
    await expect(schedulerList()).resolves.toEqual([task]);
    expect(mockInvoke).toHaveBeenCalledWith("scheduler_list");
  });

  it("schedulerUpsert forwards the task", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await schedulerUpsert(task);
    expect(mockInvoke).toHaveBeenCalledWith("scheduler_upsert", { task });
  });

  it("schedulerDelete forwards the id", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await schedulerDelete("cron-9");
    expect(mockInvoke).toHaveBeenCalledWith("scheduler_delete", { id: "cron-9" });
  });

  it("schedulerToggle forwards id + enabled", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await schedulerToggle("cron-9", false);
    expect(mockInvoke).toHaveBeenCalledWith("scheduler_toggle", {
      id: "cron-9",
      enabled: false,
    });
  });
});

describe("newSchedulerTaskId", () => {
  it("returns a cron- prefixed id", () => {
    expect(newSchedulerTaskId()).toMatch(/^cron-/);
  });
});
