import { describe, expect, it } from "vitest";

import type { TaskItem, WorkItem } from "./api";
import { readMission, type MissionData } from "./mission";

const work = {
  id: "work-1",
  objective: "Work out whether the laptops are worth it",
  status: "completed",
  priority: "normal",
  createdAt: "2026-09-19T10:00:00.000Z",
  updatedAt: "2026-09-19T10:10:00.000Z",
  metadata: {},
} as unknown as WorkItem;

function step(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "task-1",
    workId: "work-1",
    title: "Analyse the figures",
    description: "",
    status: "completed",
    dependsOn: [],
    createdAt: "2026-09-19T10:00:00.000Z",
    updatedAt: "2026-09-19T10:05:00.000Z",
    metadata: {},
    ...overrides,
  } as TaskItem;
}

function mission(tasks: TaskItem[]): MissionData {
  return { work, tasks, events: [], approvals: [], agents: [], executionJob: null };
}

describe("what a finished mission is allowed to claim", () => {
  it("says delivered only when nothing in it went wrong", () => {
    const state = readMission(mission([step(), step({ id: "task-2" })]));

    expect(state.label).toBe("Delivered");
    expect(state.note).toBe("2 steps carried it.");
  });

  it("does not call it delivered when a step never finished", () => {
    const state = readMission(mission([step(), step({ id: "task-2", status: "failed" })]));

    expect(state.label).toBe("Finished with limits");
    expect(state.note).toMatch(/1 of 2 steps did not finish/);
    expect(state.tone).toBe("warning");
  });

  it("names a tool that came back empty", () => {
    const state = readMission(mission([
      step({ metadata: { execution: { toolCalls: [{ toolId: "calculator", status: "failed" }] } } } as Partial<TaskItem>),
    ]));

    expect(state.label).toBe("Finished with limits");
    expect(state.note).toMatch(/calculator did not return a result/);
  });

  it("passes on the system's own words when a step could not follow its procedure", () => {
    const state = readMission(mission([
      step({ metadata: { execution: { skillNote: "Harvey could not follow Expense signoff because Calculator access is no longer available." } } } as Partial<TaskItem>),
    ]));

    expect(state.note).toMatch(/could not follow Expense signoff/);
  });

  it("judges only what the system recorded, never the quality of the writing", () => {
    // An agent that concluded it lacked data still finished its step. The
    // product does not grade answers, so this stays "Delivered".
    const state = readMission(mission([
      step({ result: "The task cannot be completed due to insufficient data." } as Partial<TaskItem>),
    ]));

    expect(state.label).toBe("Delivered");
  });
});
