import { beforeEach, describe, expect, it, vi } from "vitest";

// schedulerStore calls into ../lib/scheduler, which wraps `invoke`. Mock the lib
// module so the store loads under vitest/node and its state transitions can be
// asserted against controllable spies.
vi.mock("../lib/scheduler", () => ({
  schedulerList: vi.fn(),
  schedulerUpsert: vi.fn(),
  schedulerDelete: vi.fn(),
  schedulerToggle: vi.fn(),
}));

import {
  schedulerDelete,
  schedulerList,
  schedulerToggle,
  schedulerUpsert,
  type ScheduledTask,
} from "../lib/scheduler";
import { useSchedulerStore } from "./schedulerStore";

const mockedList = schedulerList as ReturnType<typeof vi.fn>;
const mockedUpsert = schedulerUpsert as ReturnType<typeof vi.fn>;
const mockedDelete = schedulerDelete as ReturnType<typeof vi.fn>;
const mockedToggle = schedulerToggle as ReturnType<typeof vi.fn>;

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "t-1",
    name: "Reminder",
    prompt: "remind me",
    cron: "0 9 * * *",
    target: "notification",
    enabled: true,
    last_fired_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  useSchedulerStore.setState({ hydrated: false, tasks: [] });
  mockedList.mockReset();
  mockedUpsert.mockReset();
  mockedDelete.mockReset();
  mockedToggle.mockReset();
});

describe("useSchedulerStore", () => {
  it("starts unhydrated with an empty task list", () => {
    const s = useSchedulerStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.tasks).toEqual([]);
  });

  describe("hydrate", () => {
    it("loads tasks and marks the store hydrated", async () => {
      const tasks = [makeTask()];
      mockedList.mockResolvedValue(tasks);

      await useSchedulerStore.getState().hydrate();

      const s = useSchedulerStore.getState();
      expect(s.tasks).toEqual(tasks);
      expect(s.hydrated).toBe(true);
      expect(mockedList).toHaveBeenCalledTimes(1);
    });

    it("is a no-op once already hydrated", async () => {
      useSchedulerStore.setState({ hydrated: true, tasks: [makeTask()] });
      mockedList.mockResolvedValue([]);

      await useSchedulerStore.getState().hydrate();

      expect(mockedList).not.toHaveBeenCalled();
      expect(useSchedulerStore.getState().tasks).toEqual([makeTask()]);
    });

    it("falls back to an empty list when the backend call fails", async () => {
      useSchedulerStore.setState({ hydrated: false, tasks: [makeTask()] });
      mockedList.mockRejectedValue(new Error("boom"));

      await useSchedulerStore.getState().hydrate();

      const s = useSchedulerStore.getState();
      expect(s.hydrated).toBe(true);
      expect(s.tasks).toEqual([]);
    });
  });

  describe("upsert", () => {
    it("persists the task then reloads the list", async () => {
      const task = makeTask();
      const afterUpsert = [task, makeTask({ id: "t-2" })];
      mockedUpsert.mockResolvedValue(undefined);
      mockedList.mockResolvedValue(afterUpsert);

      await useSchedulerStore.getState().upsert(task);

      expect(mockedUpsert).toHaveBeenCalledWith(task);
      expect(useSchedulerStore.getState().tasks).toEqual(afterUpsert);
    });
  });

  describe("remove", () => {
    it("deletes by id then reloads the list", async () => {
      mockedDelete.mockResolvedValue(undefined);
      mockedList.mockResolvedValue([]);

      await useSchedulerStore.getState().remove("t-1");

      expect(mockedDelete).toHaveBeenCalledWith("t-1");
      expect(useSchedulerStore.getState().tasks).toEqual([]);
    });
  });

  describe("toggle", () => {
    it("toggles enablement then reloads the list", async () => {
      mockedToggle.mockResolvedValue(undefined);
      mockedList.mockResolvedValue([makeTask({ id: "t-1", enabled: false })]);

      await useSchedulerStore.getState().toggle("t-1", false);

      expect(mockedToggle).toHaveBeenCalledWith("t-1", false);
      expect(useSchedulerStore.getState().tasks[0].enabled).toBe(false);
    });
  });
});
