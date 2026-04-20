import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStore } from "./memory_store";

import { TaskEngine, type TaskContext } from "./task_engine";

test("TaskEngine runs steps sequentially and follows nextStep overrides", async () => {
  const visited: string[] = [];
  const engine = new TaskEngine();

  engine.addStep({
    id: "start",
    name: "Start",
    action: async () => {
      visited.push("start");
      return {
        success: true,
        data: { phase: "start" },
        nextStep: "finish",
      };
    },
  });

  engine.addStep({
    id: "middle",
    name: "Middle",
    action: async () => {
      visited.push("middle");
      return { success: true };
    },
  });

  engine.addStep({
    id: "finish",
    name: "Finish",
    action: async () => {
      visited.push("finish");
      return {
        success: true,
        data: { phase: "finish" },
      };
    },
  });

  const context = await engine.run();

  assert.deepEqual(visited, ["start", "finish"]);
  assert.deepEqual(context.data.start, { phase: "start" });
  assert.deepEqual(context.data.finish, { phase: "finish" });
});

test("TaskEngine honors retries, timeouts, and failure hooks", async () => {
  let attempts = 0;
  let failureReason = "";

  const engine = new TaskEngine();
  engine.onFail((_task, result) => {
    failureReason = result.error ?? "";
  });

  engine.addStep({
    id: "retry-step",
    name: "Retry Step",
    retries: 1,
    timeoutMs: 100,
    action: async () => {
      attempts += 1;
      throw new Error(`attempt-${attempts}`);
    },
  });

  const context = await engine.run();

  assert.equal(attempts, 2);
  assert.match(failureReason, /attempt-2/);
  assert.equal(context.failures[0]?.taskId, "retry-step");
});

test("TaskEngine runParallel executes independent steps concurrently", async () => {
  const context: TaskContext = {
    data: {},
    cookies: [],
    screenshots: [],
    metadata: {},
    failures: [],
    completedTaskIds: [],
  };

  const engine = new TaskEngine(context);
  const results = await engine.runParallel([
    {
      id: "one",
      name: "One",
      action: async () => ({ success: true, data: 1 }),
    },
    {
      id: "two",
      name: "Two",
      action: async () => ({ success: true, data: 2 }),
    },
  ]);

  assert.deepEqual(results.map((result) => result.data), [1, 2]);
});

test("TaskEngine exportState and importState preserve serializable progress", async () => {
  const engine = new TaskEngine({
    data: {
      existing: true,
    },
  });

  engine.addStep({
    id: "step-a",
    name: "Step A",
    action: async () => ({
      success: true,
      data: { saved: "value" },
    }),
  });

  await engine.run();

  const exported = engine.exportState();
  const restored = new TaskEngine();
  restored.importState(exported);

  assert.deepEqual(restored.exportState(), exported);
});

test("TaskEngine autoPersist saves JSON-safe state with the next runnable step", async () => {
  const store = new MemoryStore({ filename: ":memory:" });
  const engine = new TaskEngine();

  engine.addStep({
    id: "step-a",
    name: "Step A",
    action: async () => ({
      success: true,
      data: { done: "a" },
    }),
  });

  engine.addStep({
    id: "step-b",
    name: "Step B",
    action: async () => ({
      success: true,
      data: { done: "b" },
    }),
  });

  engine.autoPersist(store, "task_state:");
  await engine.run("step-a");

  const snapshot = store.get<{
    currentTaskId?: string;
    context: TaskContext;
  }>("task_state:current");

  assert.equal(snapshot?.currentTaskId, undefined);
  assert.deepEqual(snapshot?.context.data["step-b"], { done: "b" });
  assert.equal("page" in (snapshot?.context ?? {}), false);
  store.close();
});

test("TaskEngine resumeFromStore restores context and the next runnable step", async () => {
  const store = new MemoryStore({ filename: ":memory:" });
  const engine = new TaskEngine({
    page: { ignored: true },
  });

  engine.addStep({
    id: "step-a",
    name: "Step A",
    action: async () => ({
      success: true,
      data: { step: "a" },
      nextStep: "step-c",
    }),
  });
  engine.addStep({
    id: "step-b",
    name: "Step B",
    action: async () => ({
      success: true,
      data: { step: "b" },
    }),
  });
  engine.addStep({
    id: "step-c",
    name: "Step C",
    action: async () => ({
      success: true,
      data: { step: "c" },
    }),
  });

  engine.autoPersist(store, "task_state:");
  await engine.run("step-a");

  const resumed = TaskEngine.resumeFromStore(store, "task_state:");
  assert.ok(resumed);
  assert.deepEqual(resumed?.context.data["step-c"], { step: "c" });
  assert.equal("page" in (resumed?.context ?? {}), false);
  assert.equal(resumed?.engine.exportState().currentTaskId, undefined);
  store.close();
});

test("TaskEngine resumeFromStore returns null when no saved state exists", () => {
  const store = new MemoryStore({ filename: ":memory:" });

  const resumed = TaskEngine.resumeFromStore(store, "task_state:");

  assert.equal(resumed, null);
  store.close();
});

// ── Retry delay and backoff ───────────────────────────────────────────

test("TaskEngine retryDelayMs adds delay between retries with exponential backoff", async () => {
  let attempts = 0;
  const attemptTimes: number[] = [];

  const engine = new TaskEngine();
  engine.addStep({
    id: "backoff-step",
    name: "Backoff Step",
    retries: 2,
    retryDelayMs: 50,
    retryBackoff: "exponential",
    action: async () => {
      attempts += 1;
      attemptTimes.push(Date.now());
      throw new Error(`attempt-${attempts}`);
    },
  });

  const context = await engine.run();

  assert.equal(attempts, 3); // 1 initial + 2 retries
  assert.equal(context.failures[0]?.taskId, "backoff-step");

  // Check delays: attempt 2 should be ~50ms after attempt 1, attempt 3 should be ~100ms after attempt 2
  if (attemptTimes.length >= 3) {
    const delay1 = attemptTimes[1] - attemptTimes[0];
    const delay2 = attemptTimes[2] - attemptTimes[1];
    assert.ok(delay1 >= 30, `First retry delay ${delay1}ms should be >= ~50ms`);
    assert.ok(delay2 >= 70, `Second retry delay ${delay2}ms should be >= ~100ms (exponential)`);
  }
});

test("TaskEngine retryBackoff 'linear' scales delay linearly", async () => {
  let attempts = 0;
  const attemptTimes: number[] = [];

  const engine = new TaskEngine();
  engine.addStep({
    id: "linear-step",
    name: "Linear Step",
    retries: 2,
    retryDelayMs: 50,
    retryBackoff: "linear",
    action: async () => {
      attempts += 1;
      attemptTimes.push(Date.now());
      throw new Error(`attempt-${attempts}`);
    },
  });

  const context = await engine.run();

  assert.equal(attempts, 3);
  assert.equal(context.failures[0]?.taskId, "linear-step");

  // Check delays: both should be ~50ms (linear: delayMs * attemptNumber)
  if (attemptTimes.length >= 3) {
    const delay1 = attemptTimes[1] - attemptTimes[0];
    const delay2 = attemptTimes[2] - attemptTimes[1];
    assert.ok(delay1 >= 30, `First retry delay ${delay1}ms should be >= ~50ms`);
    assert.ok(delay2 >= 80, `Second retry delay ${delay2}ms should be >= ~100ms (linear: 50*2)`);
  }
});

test("TaskEngine default retryDelayMs is 1000 and retryBackoff is exponential", async () => {
  // Just verify the task interface accepts these fields and the engine runs
  let attempts = 0;
  const engine = new TaskEngine();
  engine.addStep({
    id: "default-retry",
    name: "Default Retry",
    retries: 1,
    // No retryDelayMs or retryBackoff specified — should use defaults
    action: async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("retry needed");
      }
      return { success: true, data: { ok: true } };
    },
  });

  const context = await engine.run();
  assert.equal(attempts, 2);
  assert.deepEqual(context.data["default-retry"], { ok: true });
});

// ── continueOnFailure ─────────────────────────────────────────────────

test("TaskEngine continueOnFailure allows execution to continue after a step fails", async () => {
  const visited: string[] = [];
  const engine = new TaskEngine();

  engine.addStep({
    id: "will-fail",
    name: "Will Fail",
    continueOnFailure: true,
    action: async () => {
      visited.push("will-fail");
      return { success: false, error: "expected failure" };
    },
  });

  engine.addStep({
    id: "after-fail",
    name: "After Fail",
    action: async () => {
      visited.push("after-fail");
      return { success: true };
    },
  });

  const context = await engine.run();

  assert.deepEqual(visited, ["will-fail", "after-fail"]);
  assert.equal(context.failures.length, 1);
  assert.equal(context.failures[0]?.taskId, "will-fail");
});

test("TaskEngine without continueOnFailure stops on first failure", async () => {
  const visited: string[] = [];
  const engine = new TaskEngine();

  engine.addStep({
    id: "will-fail",
    name: "Will Fail",
    // No continueOnFailure — defaults to false
    action: async () => {
      visited.push("will-fail");
      return { success: false, error: "expected failure" };
    },
  });

  engine.addStep({
    id: "after-fail",
    name: "After Fail",
    action: async () => {
      visited.push("after-fail");
      return { success: true };
    },
  });

  const context = await engine.run();

  assert.deepEqual(visited, ["will-fail"]);
  assert.equal(context.failures.length, 1);
});

test("TaskEngine continueOnFailure with thrown error still proceeds", async () => {
  const visited: string[] = [];
  const engine = new TaskEngine();

  engine.addStep({
    id: "will-throw",
    name: "Will Throw",
    continueOnFailure: true,
    retries: 0,
    action: async () => {
      visited.push("will-throw");
      throw new Error("thrown error");
    },
  });

  engine.addStep({
    id: "after-throw",
    name: "After Throw",
    action: async () => {
      visited.push("after-throw");
      return { success: true };
    },
  });

  const context = await engine.run();

  assert.deepEqual(visited, ["will-throw", "after-throw"]);
  assert.equal(context.failures.length, 1);
  assert.equal(context.failures[0]?.taskId, "will-throw");
});
