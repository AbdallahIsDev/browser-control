import assert from "node:assert/strict";
import test from "node:test";

import { MemoryStore } from "../../memory_store";
import { Scheduler, parseCron, type ScheduledTask } from "../../scheduler";

test("parseCron supports wildcards, steps, numbers, and lists", () => {
  const parsed = parseCron("*/15 1,13 * 1,6 1,3");

  assert.deepEqual(Array.from(parsed.minutes), [0, 15, 30, 45]);
  assert.deepEqual(Array.from(parsed.hours), [1, 13]);
  assert.deepEqual(Array.from(parsed.daysOfMonth), ["*"]);
  assert.deepEqual(Array.from(parsed.months), [1, 6]);
  assert.deepEqual(Array.from(parsed.daysOfWeek), [1, 3]);
});

test("Scheduler persists and restores schedule metadata through MemoryStore", () => {
  const store = new MemoryStore({ filename: ":memory:" });
  const baseTime = new Date("2026-04-13T10:00:00.000Z");

  const scheduler = new Scheduler({
    store,
    now: () => new Date(baseTime),
  });

  scheduler.schedule({
    id: "heartbeat",
    name: "Heartbeat",
    cronExpression: "*/5 * * * *",
    enabled: true,
    taskFactory: async () => ({
      id: "heartbeat-task",
      name: "Heartbeat Task",
      action: async () => ({ success: true }),
    }),
  });

  const restored = new Scheduler({
    store,
    now: () => new Date(baseTime),
  });

  assert.deepEqual(restored.getQueue(), [
    {
      id: "heartbeat",
      name: "Heartbeat",
      nextRun: new Date("2026-04-13T10:05:00.000Z"),
      enabled: true,
    },
  ]);

  store.close();
});

test("Scheduler fires due tasks once for a matching minute and supports pause/resume", async () => {
  let now = new Date("2026-04-13T10:00:00.000Z");
  const dueIds: string[] = [];

  const scheduler = new Scheduler({
    now: () => new Date(now),
  });

  scheduler.schedule({
    id: "every-minute",
    name: "Every Minute",
    cronExpression: "* * * * *",
    enabled: true,
    taskFactory: async () => ({
      id: "job",
      name: "Job",
      action: async () => ({ success: true }),
    }),
  });

  scheduler.onTaskDue(async (task: ScheduledTask) => {
    dueIds.push(task.id);
  });

  scheduler.start();
  now = new Date("2026-04-13T10:00:01.000Z");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  now = new Date("2026-04-13T10:00:30.000Z");
  await new Promise((resolve) => setTimeout(resolve, 1100));

  scheduler.pause("every-minute");
  now = new Date("2026-04-13T10:01:00.000Z");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  scheduler.resume("every-minute");
  now = new Date("2026-04-13T10:02:00.000Z");
  await new Promise((resolve) => setTimeout(resolve, 2200));

  await scheduler.stop();

  assert.deepEqual(dueIds, ["every-minute"]);
});

test("Scheduler killzone helper uses UTC session windows", () => {
  const scheduler = new Scheduler({
    now: () => new Date("2026-04-13T02:30:00.000Z"),
  });

  assert.equal(scheduler.isWithinKillzone("london"), true);
  assert.equal(scheduler.isWithinKillzone("ny"), false);
  assert.equal(scheduler.isWithinKillzone("asia"), false);
});
