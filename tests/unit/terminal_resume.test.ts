import assert from "node:assert/strict";
import test from "node:test";

import {
  decideResume,
  buildResumeResult,
  type ResumeDecision,
} from "../../src/terminal_resume";

function createMockSerialized(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sessionId: "test-123",
    shell: "bash",
    cwd: "/home/user",
    env: { PATH: "/usr/bin" },
    history: [],
    scrollbackBuffer: [],
    status: "idle" as const,
    resumeLevel: 2 as const,
    serializedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    ...overrides,
  };
}

test("decideResume: returns resumed when metadata + buffer present", () => {
  const metadata = createMockSerialized();
  const buffer = { sessionId: "test-123", scrollback: ["line1", "line2"], visibleContent: "line2", capturedAt: new Date().toISOString() };
  const decision = decideResume("test-123", metadata as any, buffer as any);

  assert.equal(decision.resumeLevel, 2);
  assert.equal(decision.status, "resumed");
  assert.ok(decision.preserved.metadata);
  assert.ok(decision.preserved.buffer);
  assert.equal(decision.lost.length, 0);
});

test("decideResume: returns reconstructed when only metadata present", () => {
  const metadata = createMockSerialized();
  const decision = decideResume("test-123", metadata as any, null);

  assert.equal(decision.resumeLevel, 1);
  assert.equal(decision.status, "reconstructed");
  assert.ok(decision.preserved.metadata);
  assert.ok(!decision.preserved.buffer);
  assert.ok(decision.lost.includes("buffer was not persisted"));
});

test("decideResume: returns fresh when no metadata", () => {
  const decision = decideResume("test-123", null, null);

  assert.equal(decision.resumeLevel, 1);
  assert.equal(decision.status, "fresh");
  assert.ok(!decision.preserved.metadata);
  assert.ok(!decision.preserved.buffer);
  assert.ok(decision.lost.includes("no prior state"));
});

test("decideResume: reports lost process continuity for running command", () => {
  const metadata = createMockSerialized({ status: "running", runningCommand: "sleep 100" });
  const decision = decideResume("test-123", metadata as any, null);

  assert.equal(decision.status, "reconstructed");
  assert.ok(decision.lost.includes("live process continuity"));
  assert.ok(decision.lost.some((l) => l.includes("sleep 100")));
});

test("decideResume: redacts secrets from lost running command notes", () => {
  const metadata = createMockSerialized({ status: "running", runningCommand: "deploy --token prod-secret" });
  const decision = decideResume("test-123", metadata as any, null);

  assert.ok(decision.lost.some((l) => l.includes("deploy --token <redacted>")));
  assert.ok(!decision.lost.some((l) => l.includes("prod-secret")));
});

test("decideResume: returns reconstructed for corrupt buffer", () => {
  const metadata = createMockSerialized();
  const decision = decideResume("test-123", metadata as any, { scrollback: "not-an-array" } as any);

  assert.equal(decision.resumeLevel, 1);
  assert.equal(decision.status, "reconstructed");
  assert.ok(decision.lost.includes("buffer was corrupt"));
});

test("buildResumeResult: constructs resumed result correctly", () => {
  const decision: ResumeDecision = {
    sessionId: "test-123",
    resumeLevel: 2,
    status: "resumed",
    preserved: { metadata: true, buffer: true },
    lost: [],
  };
  const result = buildResumeResult(decision, { id: "test-123", shell: "bash", cwd: "/home/user", status: "idle" });

  assert.equal(result.sessionId, "test-123");
  assert.equal(result.resumeLevel, 2);
  assert.equal(result.status, "resumed");
  assert.ok(result.preserved.metadata);
  assert.ok(result.preserved.buffer);
  assert.equal(result.lost.length, 0);
  assert.ok(result.session);
});

test("buildResumeResult: constructs reconstructed result correctly", () => {
  const decision: ResumeDecision = {
    sessionId: "test-123",
    resumeLevel: 1,
    status: "reconstructed",
    preserved: { metadata: true, buffer: false },
    lost: ["buffer was not persisted"],
  };
  const result = buildResumeResult(decision);

  assert.equal(result.resumeLevel, 1);
  assert.equal(result.status, "reconstructed");
  assert.ok(result.preserved.metadata);
  assert.ok(!result.preserved.buffer);
  assert.deepEqual(result.lost, ["buffer was not persisted"]);
});

test("buildResumeResult: constructs fresh result correctly", () => {
  const decision: ResumeDecision = {
    sessionId: "test-123",
    resumeLevel: 1,
    status: "fresh",
    preserved: { metadata: false, buffer: false },
    lost: ["no prior state"],
  };
  const result = buildResumeResult(decision);

  assert.equal(result.resumeLevel, 1);
  assert.equal(result.status, "fresh");
  assert.ok(!result.preserved.metadata);
  assert.ok(!result.preserved.buffer);
});
