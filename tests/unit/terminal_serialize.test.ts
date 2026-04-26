import assert from "node:assert/strict";
import test from "node:test";

import { captureTerminalBuffer, serializeTerminalSession, validateSerializedSession } from "../../terminal_serialize";

function createMockSession(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "test-session-123",
    name: "Test Session",
    shell: "bash",
    cwd: "/home/user",
    env: { PATH: "/usr/bin", HOME: "/home/user" },
    status: "idle" as const,
    createdAt: now,
    lastActivityAt: now,
    _history: ["ls -la", "cd /tmp"],
    _outputBuffer: "some output\n$ ",
    _runningCommand: undefined,
    pid: 12345,
    ...overrides,
  };
}

test("serializeTerminalSession: captures metadata correctly", () => {
  const session = createMockSession();
  const serialized = serializeTerminalSession(session);

  assert.ok(serialized !== null);
  assert.equal(serialized!.sessionId, "test-session-123");
  assert.equal(serialized!.name, "Test Session");
  assert.equal(serialized!.shell, "bash");
  assert.equal(serialized!.cwd, "/home/user");
  assert.deepEqual(serialized!.env, { PATH: "/usr/bin", HOME: "/home/user" });
  assert.equal(serialized!.status, "idle");
  assert.deepEqual(serialized!.history, ["ls -la", "cd /tmp"]);
  assert.ok(serialized!.serializedAt);
  assert.equal(serialized!.resumeLevel, 2);
  assert.deepEqual(serialized!.scrollbackBuffer, ["some output", "$ "]);
});

test("serializeTerminalSession: redacts secrets from env", () => {
  const session = createMockSession({
    env: {
      PATH: "/usr/bin",
      API_KEY: "secret123",
      GITHUB_TOKEN: "ghp_xxx",
      PASSWORD: "hunter2",
      SESSION_COOKIE: "sid=secret",
    },
  });
  const serialized = serializeTerminalSession(session);

  assert.ok(serialized !== null);
  assert.equal(serialized!.env.API_KEY, "<redacted>");
  assert.equal(serialized!.env.GITHUB_TOKEN, "<redacted>");
  assert.equal(serialized!.env.PASSWORD, "<redacted>");
  assert.equal(serialized!.env.SESSION_COOKIE, "<redacted>");
  assert.equal(serialized!.env.PATH, "/usr/bin");
});

test("serializeTerminalSession: redacts secrets from command metadata", () => {
  const session = createMockSession({
    status: "running",
    _history: [
      "npm login --password hunter2",
      "curl -H \"Authorization: Bearer ghp_secret\" https://example.test",
      "TOKEN=plain-secret npm publish",
    ],
    _runningCommand: "deploy --api-key=prod-secret",
  });
  const serialized = serializeTerminalSession(session);

  assert.ok(serialized !== null);
  assert.deepEqual(serialized!.history, [
    "npm login --password <redacted>",
    "curl -H \"Authorization: Bearer <redacted>\" https://example.test",
    "TOKEN=<redacted> npm publish",
  ]);
  assert.equal(serialized!.runningCommand, "deploy --api-key=<redacted>");
});

test("serializeTerminalSession: handles running command", () => {
  const session = createMockSession({
    status: "running",
    _runningCommand: "long-running-process",
  });
  const serialized = serializeTerminalSession(session);

  assert.ok(serialized !== null);
  assert.equal(serialized!.status, "running");
  assert.equal(serialized!.runningCommand, "long-running-process");
  assert.equal(serialized!.processInfo?.pid, 12345);
});

test("serializeTerminalSession: bounds metadata scrollback", () => {
  const output = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
  const session = createMockSession({ _outputBuffer: output });
  const serialized = serializeTerminalSession(session, { maxScrollbackLines: 5 });

  assert.ok(serialized !== null);
  assert.deepEqual(serialized!.scrollbackBuffer, ["line-15", "line-16", "line-17", "line-18", "line-19"]);
});

test("serializeTerminalSession: redacts secrets from scrollback", () => {
  const session = createMockSession({
    _outputBuffer: [
      "curl -H \"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.secret\" https://example.test",
      "Cookie: sid=secret-session; theme=dark",
      "$ ",
    ].join("\n"),
  });

  const serialized = serializeTerminalSession(session);

  assert.ok(serialized !== null);
  assert.ok(serialized!.scrollbackBuffer.join("\n").includes("[REDACTED]"));
  assert.ok(!serialized!.scrollbackBuffer.join("\n").includes("eyJ"));
  assert.ok(!serialized!.scrollbackBuffer.join("\n").includes("secret-session"));
  assert.ok(!serialized!.scrollbackBuffer.join("\n").includes("theme=dark"));
});

test("captureTerminalBuffer: redacts secrets from scrollback and visibleContent", () => {
  const output = [
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.secret",
    "Cookie: sid=secret-session; theme=dark",
  ].join("\n");

  const captured = captureTerminalBuffer("test-session-123", output);

  assert.ok(captured.scrollback.join("\n").includes("[REDACTED]"));
  assert.ok(captured.visibleContent.includes("[REDACTED]"));
  assert.ok(!captured.scrollback.join("\n").includes("eyJ"));
  assert.ok(!captured.visibleContent.includes("secret-session"));
  assert.ok(!captured.visibleContent.includes("theme=dark"));
});

test("serializeTerminalSession: returns null for closed session", () => {
  const session = createMockSession({ status: "closed" });
  const serialized = serializeTerminalSession(session);
  assert.equal(serialized, null);
});

test("serializeTerminalSession: level 1 when no buffer", () => {
  const session = createMockSession({ _outputBuffer: undefined });
  const serialized = serializeTerminalSession(session);
  assert.ok(serialized !== null);
  assert.equal(serialized!.resumeLevel, 1);
  assert.deepEqual(serialized!.scrollbackBuffer, []);
});

test("validateSerializedSession: accepts valid session", () => {
  const session = createMockSession();
  const serialized = serializeTerminalSession(session);
  assert.ok(validateSerializedSession(serialized));
});

test("validateSerializedSession: rejects missing sessionId", () => {
  const session = createMockSession();
  const serialized = serializeTerminalSession(session);
  assert.ok(serialized !== null);
  const raw = serialized as unknown as Record<string, unknown>;
  delete raw.sessionId;
  assert.ok(!validateSerializedSession(raw));
});

test("validateSerializedSession: rejects missing shell", () => {
  const session = createMockSession();
  const serialized = serializeTerminalSession(session);
  assert.ok(serialized !== null);
  const raw = serialized as unknown as Record<string, unknown>;
  delete raw.shell;
  assert.ok(!validateSerializedSession(raw));
});

test("validateSerializedSession: rejects missing cwd", () => {
  const session = createMockSession();
  const serialized = serializeTerminalSession(session);
  assert.ok(serialized !== null);
  const raw = serialized as unknown as Record<string, unknown>;
  delete raw.cwd;
  assert.ok(!validateSerializedSession(raw));
});

test("validateSerializedSession: rejects missing status", () => {
  const session = createMockSession();
  const serialized = serializeTerminalSession(session);
  assert.ok(serialized !== null);
  const raw = serialized as unknown as Record<string, unknown>;
  delete raw.status;
  assert.ok(!validateSerializedSession(raw));
});

test("validateSerializedSession: rejects invalid resumeLevel", () => {
  const session = createMockSession();
  const serialized = serializeTerminalSession(session);
  assert.ok(serialized !== null);
  const raw = serialized as unknown as Record<string, unknown>;
  raw.resumeLevel = 3;
  assert.ok(!validateSerializedSession(raw));
});
