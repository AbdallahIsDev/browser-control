import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";

import { Daemon } from "../../src/daemon";
import { resetStateStorage } from "../../src/state";
import {
  createBrokerServer,
  normalizeClientIp,
  type BrokerServer,
} from "../../src/broker_server";
import type { BrokerRunTaskRequest } from "../../src/broker_types";

async function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }

  await once(socket, "open");
}

async function waitForMessage(socket: WebSocket): Promise<string> {
  const [payload] = await once(socket, "message");
  return payload.toString();
}

function getBaseUrl(server: BrokerServer): string {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

test("normalizeClientIp collapses IPv6 loopback and IPv4-mapped loopback addresses", () => {
  assert.equal(normalizeClientIp("::1"), "127.0.0.1");
  assert.equal(normalizeClientIp("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeClientIp("192.168.1.5"), "192.168.1.5");
});

test("createBrokerServer rejects oversized JSON request bodies", async (t) => {
  const broker = createBrokerServer({
    env: { BROKER_API_KEY: "body-test-key", BROKER_MAX_BODY_BYTES: "32" },
    callbacks: {
      submitTask: async () => ({ taskId: "should-not-run" }),
    },
  });
  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const response = await fetch(`${getBaseUrl(broker)}/api/v1/tasks/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "body-test-key",
    },
    body: JSON.stringify({ action: "visit", params: { text: "x".repeat(64) } }),
  });
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 400);
  assert.match(body.error ?? "", /Request body too large/);
});

test("createBrokerServer defaults CORS to loopback origins only", async (t) => {
  const broker = createBrokerServer({
    env: { BROKER_API_KEY: "cors-default-key" },
  });
  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  const blocked = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { origin: "https://evil.example" },
  });
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);

  const loopback = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { origin: "http://127.0.0.1:5173" },
  });
  assert.equal(
    loopback.headers.get("access-control-allow-origin"),
    "http://127.0.0.1:5173",
  );
  assert.equal(loopback.headers.get("vary"), "Origin");
});

test("createBrokerServer supports explicit wildcard CORS opt-in", async (t) => {
  const broker = createBrokerServer({
    env: {
      BROKER_API_KEY: "cors-wildcard-key",
      BROKER_ALLOWED_ORIGINS: "*",
    },
  });
  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const response = await fetch(`${getBaseUrl(broker)}/api/v1/health`, {
    headers: { origin: "https://client.example" },
  });

  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("createBrokerServer exposes runtime endpoints and WebSocket completion events", async (t) => {
  let broker!: BrokerServer;
  let scheduledBody: Record<string, unknown> | undefined;
  const schedulerState = new Map<string, { id: string; name: string; nextRun: Date | null; enabled: boolean }>([
    ["sched-1", {
      id: "sched-1",
      name: "Morning run",
      nextRun: new Date("2026-04-14T08:00:00.000Z"),
      enabled: true,
    }],
  ]);
  let killCalls = 0;
  const terminalCalls: Array<{ subcommand: string; payload: Record<string, unknown> }> = [];

  broker = createBrokerServer({
    env: {
      BROKER_API_KEY: "runtime-key",
      BROKER_ALLOWED_DOMAINS: "example.com",
      BROKER_ALLOWED_ORIGINS: "http://client.example",
    },
    callbacks: {
      submitTask: async (request) => {
        assert.equal(request.action, "visit");
        assert.deepEqual(request.params, {
          url: "https://app.example.com/dashboard",
        });

        setImmediate(() => {
          broker.setTaskStatus("task-1", {
            status: "running",
          });
          setImmediate(() => {
            broker.setTaskStatus("task-1", {
              status: "completed",
              result: {
                ok: true,
              },
            });
          });
        });

        return {
          taskId: "task-1",
        };
      },
      scheduleTask: async (request) => {
        scheduledBody = {
          id: request.id,
          name: request.name,
          cronExpression: request.cronExpression,
          ...(request.kind ? { kind: request.kind } : {}),
          ...(request.params ? { params: request.params } : {}),
          ...(request.priority ? { priority: request.priority } : {}),
          ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
        };
        return {
          id: request.id,
          nextRun: new Date("2026-04-14T08:00:00.000Z"),
        };
      },
      pauseScheduledTask: async (id) => {
        const entry = schedulerState.get(id);
        if (!entry) return null;
        entry.enabled = false;
        entry.nextRun = null;
        return entry;
      },
      resumeScheduledTask: async (id) => {
        const entry = schedulerState.get(id);
        if (!entry) return null;
        entry.enabled = true;
        entry.nextRun = new Date("2026-04-14T08:00:00.000Z");
        return entry;
      },
      removeScheduledTask: async (id) => schedulerState.delete(id),
      kill: async () => {
        killCalls += 1;
      },
      getHealth: async () => ({
        overall: "healthy",
        checks: [
          {
            name: "cdp",
            status: "pass",
            details: "ok",
          },
        ],
        timestamp: "2026-04-13T20:00:00.000Z",
      }),
      getStats: async () => ({
        totalSteps: 3,
        successCount: 2,
        errorCount: 1,
        successRate: 2 / 3,
        averageDurationMs: 150,
        captchasSolved: 0,
        screenshotsCaptured: 1,
        proxyUsage: {},
        actions: {},
      }),
      getSchedulerQueue: async () => Array.from(schedulerState.values()),
      handleTerminal: async (subcommand, payload) => {
        terminalCalls.push({ subcommand, payload });
        return { subcommand, sessionId: payload.sessionId };
      },
    },
  });

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws`, {
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  t.after(() => socket.close());
  await waitForOpen(socket);

  const runResponse = await fetch(`${baseUrl}/api/v1/tasks/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://client.example",
      "x-api-key": "runtime-key",
    },
    body: JSON.stringify({
      action: "visit",
      params: {
        url: "https://app.example.com/dashboard",
      },
    }),
  });

  assert.equal(runResponse.status, 202);
  assert.equal(runResponse.headers.get("access-control-allow-origin"), "http://client.example");
  assert.deepEqual(await runResponse.json(), {
    taskId: "task-1",
    status: "pending",
  });

  const socketEvent = JSON.parse(await waitForMessage(socket)) as {
    type: string;
    taskId: string;
    status: string;
    result: unknown;
  };
  assert.deepEqual(socketEvent, {
    type: "task_completed",
    taskId: "task-1",
    status: "completed",
    result: {
      ok: true,
    },
  });

  const statusResponse = await fetch(`${baseUrl}/api/v1/tasks/task-1/status`, {
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), {
    id: "task-1",
    status: "completed",
    result: {
      ok: true,
    },
  });

  const listResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).length, 1);

  const scheduleResponse = await fetch(`${baseUrl}/api/v1/tasks/schedule`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "runtime-key",
    },
    body: JSON.stringify({
      id: "sched-1",
      name: "Morning run",
      cronExpression: "0 8 * * *",
    }),
  });
  assert.equal(scheduleResponse.status, 200);
  assert.deepEqual(await scheduleResponse.json(), {
    id: "sched-1",
    nextRun: "2026-04-14T08:00:00.000Z",
  });
  assert.deepEqual(scheduledBody, {
    id: "sched-1",
    name: "Morning run",
    cronExpression: "0 8 * * *",
  });

  const healthResponse = await fetch(`${baseUrl}/api/v1/health`, {
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).overall, "healthy");

  const statsResponse = await fetch(`${baseUrl}/api/v1/stats`, {
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  assert.equal(statsResponse.status, 200);
  assert.equal((await statsResponse.json()).totalSteps, 3);

  const schedulerResponse = await fetch(`${baseUrl}/api/v1/scheduler`, {
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  assert.equal(schedulerResponse.status, 200);
  assert.deepEqual(await schedulerResponse.json(), [
    {
      id: "sched-1",
      name: "Morning run",
      nextRun: "2026-04-14T08:00:00.000Z",
      enabled: true,
    },
  ]);

  const pauseResponse = await fetch(`${baseUrl}/api/v1/scheduler/sched-1/pause`, {
    method: "POST",
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  assert.equal(pauseResponse.status, 200);
  assert.deepEqual(await pauseResponse.json(), {
    id: "sched-1",
    name: "Morning run",
    nextRun: null,
    enabled: false,
  });

  const resumeScheduledResponse = await fetch(`${baseUrl}/api/v1/scheduler/sched-1/resume`, {
    method: "POST",
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  assert.equal(resumeScheduledResponse.status, 200);
  assert.deepEqual(await resumeScheduledResponse.json(), {
    id: "sched-1",
    name: "Morning run",
    nextRun: "2026-04-14T08:00:00.000Z",
    enabled: true,
  });

  const removeScheduledResponse = await fetch(`${baseUrl}/api/v1/scheduler/sched-1`, {
    method: "DELETE",
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  assert.equal(removeScheduledResponse.status, 200);
  assert.deepEqual(await removeScheduledResponse.json(), {
    id: "sched-1",
    removed: true,
  });

  const missingScheduledResponse = await fetch(`${baseUrl}/api/v1/scheduler/missing/pause`, {
    method: "POST",
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  assert.equal(missingScheduledResponse.status, 404);
  assert.deepEqual(await missingScheduledResponse.json(), {
    error: 'Scheduled task "missing" was not found.',
  });

  const resumeResponse = await fetch(`${baseUrl}/api/v1/term/resume`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "runtime-key",
    },
    body: JSON.stringify({ sessionId: "term-1" }),
  });
  assert.equal(resumeResponse.status, 200);
  assert.deepEqual(await resumeResponse.json(), {
    subcommand: "resume",
    sessionId: "term-1",
  });

  const statusResponseForTerminal = await fetch(`${baseUrl}/api/v1/term/status?sessionId=term-1`, {
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  assert.equal(statusResponseForTerminal.status, 200);
  assert.deepEqual(await statusResponseForTerminal.json(), {
    subcommand: "status",
    sessionId: "term-1",
  });
  assert.deepEqual(terminalCalls.map((call) => call.subcommand), ["resume", "status"]);

  const killResponse = await fetch(`${baseUrl}/api/v1/kill`, {
    method: "POST",
    headers: {
      "x-api-key": "runtime-key",
    },
  });
  assert.equal(killResponse.status, 202);
  assert.equal(killCalls, 1);

  const preflightResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: "OPTIONS",
    headers: {
      origin: "http://client.example",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(preflightResponse.status, 204);
  assert.equal(preflightResponse.headers.get("access-control-allow-origin"), "http://client.example");
});

test("createBrokerServer enforces auth with BROKER_API_KEY and falls back to BROKER_SECRET", async (t) => {
  const apiKeyBroker = createBrokerServer({
    env: {
      BROKER_API_KEY: "api-key",
    },
  });

  t.after(async () => {
    await apiKeyBroker.close();
  });

  await apiKeyBroker.listen(0, "127.0.0.1");
  const apiKeyBaseUrl = getBaseUrl(apiKeyBroker);

  // Health endpoint is exempt from auth
  const healthResponse = await fetch(`${apiKeyBaseUrl}/api/v1/health`);
  assert.equal(healthResponse.status, 200);

  // Other endpoints still require auth
  const unauthorizedResponse = await fetch(`${apiKeyBaseUrl}/api/v1/stats`);
  assert.equal(unauthorizedResponse.status, 401);

  const authorizedResponse = await fetch(`${apiKeyBaseUrl}/api/v1/stats`, {
    headers: {
      "x-api-key": "api-key",
    },
  });
  assert.equal(authorizedResponse.status, 200);

  const secretFallbackBroker = createBrokerServer({
    env: {
      BROKER_SECRET: "legacy-secret",
    },
  });

  t.after(async () => {
    await secretFallbackBroker.close();
  });

  await secretFallbackBroker.listen(0, "127.0.0.1");
  const secretBaseUrl = getBaseUrl(secretFallbackBroker);

  const fallbackResponse = await fetch(`${secretBaseUrl}/api/v1/health`, {
    headers: {
      authorization: "Bearer legacy-secret",
    },
  });
  assert.equal(fallbackResponse.status, 200);
});

test("createBrokerServer /health works without auth even with auto-generated key", async (t) => {
  const broker = createBrokerServer();

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  // Health should always be accessible without auth
  const healthRes = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(healthRes.status, 200);

  // Other endpoints should fail without auth
  const tasksRes = await fetch(`${baseUrl}/api/v1/tasks`);
  assert.equal(tasksRes.status, 401);

  const statusRes = await fetch(`${baseUrl}/api/v1/status`);
  assert.equal(statusRes.status, 401);

  const configRes = await fetch(`${baseUrl}/api/v1/config`);
  assert.equal(configRes.status, 401);
});

test("createBrokerServer state endpoints work with X-Broker-Api-Key header", async (t) => {
  const broker = createBrokerServer({
    env: { BROKER_API_KEY: "header-key" },
    callbacks: {
      listTasks: async () => [],
      getStatus: async () => ({ daemon: { state: "running" } }),
    },
  });

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  // X-Broker-Api-Key header should work
  const tasksRes = await fetch(`${baseUrl}/api/v1/tasks`, {
    headers: { "X-Broker-Api-Key": "header-key" },
  });
  assert.equal(tasksRes.status, 200);

  const statusRes = await fetch(`${baseUrl}/api/v1/status`, {
    headers: { "X-Broker-Api-Key": "header-key" },
  });
  assert.equal(statusRes.status, 200);

  // Wrong key should return 401
  const wrongKeyRes = await fetch(`${baseUrl}/api/v1/tasks`, {
    headers: { "X-Broker-Api-Key": "wrong-key" },
  });
  assert.equal(wrongKeyRes.status, 401);
});

test("createBrokerServer rate limits HTTP requests, counts unauthorized attempts, and validates allowed domains", async (t) => {
  const broker = createBrokerServer({
    env: {
      BROKER_API_KEY: "limit-key",
      BROKER_ALLOWED_DOMAINS: "allowed.example",
    },
    rateLimit: {
      maxRequests: 2,
      windowMs: 60_000,
    },
    callbacks: {
      submitTask: async () => ({
        taskId: "domain-task",
      }),
    },
  });

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  // Health is exempt from auth — always accessible
  const healthOk = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(healthOk.status, 200);

  const authorized = await fetch(`${baseUrl}/api/v1/health`, {
    headers: {
      "x-api-key": "limit-key",
    },
  });
  assert.equal(authorized.status, 200);

  // Third request should be rate-limited (maxRequests=2)
  const rateLimited = await fetch(`${baseUrl}/api/v1/health`, {
    headers: {
      "x-api-key": "limit-key",
    },
  });
  assert.equal(rateLimited.status, 429);

  const domainBroker = createBrokerServer({
    env: {
      BROKER_API_KEY: "domain-key",
      BROKER_ALLOWED_DOMAINS: "allowed.example",
    },
    callbacks: {
      submitTask: async () => ({
        taskId: "domain-check",
      }),
    },
  });

  t.after(async () => {
    await domainBroker.close();
  });

  await domainBroker.listen(0, "127.0.0.1");
  const domainBaseUrl = getBaseUrl(domainBroker);

  const blockedResponse = await fetch(`${domainBaseUrl}/api/v1/tasks/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "domain-key",
    },
    body: JSON.stringify({
      action: "visit",
      params: {
        url: "https://blocked.example/path",
      },
    }),
  });
  assert.equal(blockedResponse.status, 403);

  const allowedResponse = await fetch(`${domainBaseUrl}/api/v1/tasks/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "domain-key",
    },
    body: JSON.stringify({
      action: "visit",
      params: {
        url: "https://allowed.example/path",
      },
    }),
  });
  assert.equal(allowedResponse.status, 202);
});

test("createBrokerServer /api/v1/stats returns enriched format when getStats callback provides it", async (t) => {
  const broker = createBrokerServer({
    env: {
      BROKER_API_KEY: "stats-key",
    },
    callbacks: {
      getStats: async () => ({
        totalSteps: 5,
        successCount: 4,
        errorCount: 1,
        successRate: 0.8,
        averageDurationMs: 200,
        captchasSolved: 1,
        screenshotsCaptured: 0,
        proxyUsage: {},
        actions: {},
        daemon: {
          status: "running",
          pid: 12345,
          uptimeMs: 60000,
          startedAt: "2026-04-16T00:00:00.000Z",
          lastHealthCheckAt: "2026-04-16T00:01:00.000Z",
          acceptNewTasks: true,
          chromeConnected: true,
        },
        memory: {
          heapUsedMb: 50,
          heapTotalMb: 100,
          rssMb: 80,
          externalMb: 10,
        },
        tasks: {
          running: 2,
          queued: 1,
          totalCompleted: 10,
          totalFailed: 2,
        },
        scheduler: {
          paused: false,
          queueSize: 3,
        },
        activeSessions: 1,
      }),
    },
  });

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  const statsResponse = await fetch(`${baseUrl}/api/v1/stats`, {
    headers: {
      "x-api-key": "stats-key",
    },
  });

  assert.equal(statsResponse.status, 200);
  const stats = await statsResponse.json() as Record<string, unknown>;

  // Verify enriched sections are present
  assert.ok("daemon" in stats, "Should have daemon section");
  assert.ok("memory" in stats, "Should have memory section");
  assert.ok("tasks" in stats, "Should have tasks section");
  assert.ok("scheduler" in stats, "Should have scheduler section");

  const daemon = stats.daemon as Record<string, unknown>;
  assert.equal(daemon.status, "running");
  assert.equal(daemon.pid, 12345);
  assert.equal(daemon.uptimeMs, 60000);

  const memory = stats.memory as Record<string, unknown>;
  assert.equal(memory.heapUsedMb, 50);
  assert.equal(memory.rssMb, 80);

  const tasks = stats.tasks as Record<string, unknown>;
  assert.equal(tasks.running, 2);
  assert.equal(tasks.queued, 1);

  // Standard telemetry fields should still be present
  assert.equal(stats.totalSteps, 5);
  assert.equal(stats.successRate, 0.8);
});

test("createBrokerServer exposes operator status and config endpoints", async (t) => {
  const broker = createBrokerServer({
    env: {
      BROKER_API_KEY: "operator-key",
    },
    callbacks: {
      getStatus: async () => ({
        daemon: { state: "running", pid: 4321 },
        broker: { reachable: true, url: "http://127.0.0.1:7788" },
        browser: { provider: "local", activeSessions: 0 },
        terminal: { activeSessions: 0, sessions: [] },
        tasks: { queued: 0, running: 0 },
        services: { count: 0 },
        provider: { active: "local" },
        policyProfile: "balanced",
        dataHome: "/tmp/browser-control",
        health: { overall: "healthy", pass: 1, warn: 0, fail: 0 },
      }),
      listConfig: async () => [
        {
          key: "logLevel",
          category: "logging",
          value: "info",
          defaultValue: "info",
          source: "default",
          sensitive: false,
          envVars: ["LOG_LEVEL"],
          description: "Minimum log level.",
        },
      ],
      getConfig: async (key) => ({
        key: key as "logLevel",
        category: "logging",
        value: "info",
        defaultValue: "info",
        source: "default",
        sensitive: false,
        envVars: ["LOG_LEVEL"],
        description: "Minimum log level.",
      }),
      setConfig: async (key, value) => ({
        key,
        value,
        source: "user",
      }),
    },
  });

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  const statusResponse = await fetch(`${baseUrl}/api/v1/status`, {
    headers: { "x-api-key": "operator-key" },
  });
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json() as { daemon: { state: string } }).daemon.state, "running");

  const configListResponse = await fetch(`${baseUrl}/api/v1/config`, {
    headers: { "x-api-key": "operator-key" },
  });
  assert.equal(configListResponse.status, 200);
  const configList = await configListResponse.json() as Array<{ key: string }>;
  assert.equal(configList[0].key, "logLevel");

  const configGetResponse = await fetch(`${baseUrl}/api/v1/config/logLevel`, {
    headers: { "x-api-key": "operator-key" },
  });
  assert.equal(configGetResponse.status, 200);
  assert.equal((await configGetResponse.json() as { key: string }).key, "logLevel");

  const configSetResponse = await fetch(`${baseUrl}/api/v1/config/logLevel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "operator-key",
    },
    body: JSON.stringify({ value: "debug" }),
  });
  assert.equal(configSetResponse.status, 200);
  assert.deepEqual(await configSetResponse.json(), {
    key: "logLevel",
    value: "debug",
    source: "user",
  });
});

test("createBrokerServer rejects config mutation when auth key is not provided", async (t) => {
  // Server auto-generates a key; a request without it should be 401
  const broker = createBrokerServer();

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  const response = await fetch(`${baseUrl}/api/v1/config/logLevel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ value: "debug" }),
  });

  assert.equal(response.status, 401);
  const body = await response.json() as { error?: string };
  assert.match(body.error ?? "", /unauthorized/i);
});

test("broker filesystem endpoints reject paths outside daemon filesystem sandbox", async (t) => {
  const originalHome = process.env.BROWSER_CONTROL_HOME;
  const originalPolicy = process.env.POLICY_PROFILE;
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-broker-fs-home-"));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bc-broker-fs-outside-"));
  process.env.BROWSER_CONTROL_HOME = dataHome;
  process.env.POLICY_PROFILE = "trusted";

  const outsideRead = path.join(outsideRoot, "read.txt");
  const outsideWrite = path.join(outsideRoot, "write.txt");
  const outsideDelete = path.join(outsideRoot, "delete.txt");
  const outsideMoveSrc = path.join(outsideRoot, "move-src.txt");
  const outsideMoveDst = path.join(outsideRoot, "move-dst.txt");
  fs.writeFileSync(outsideRead, "outside read");
  fs.writeFileSync(outsideDelete, "outside delete");
  fs.writeFileSync(outsideMoveSrc, "outside move");

  const daemon = new Daemon({
    heartbeatIntervalMs: 60_000,
    chromeWatchdogIntervalMs: 60_000,
    memoryStore: undefined,
    healthCheck: {
      runCritical: async () => true,
      runAll: async () => ({
        overall: "healthy",
        checks: [],
        timestamp: new Date().toISOString(),
      }),
    },
    brokerFactory: async () => ({
      start: async () => {},
      stop: async () => {},
    }),
  });
  await daemon.start();

  const broker = createBrokerServer({
    env: {
      BROKER_API_KEY: "fs-sandbox-key",
      POLICY_PROFILE: "trusted",
    },
    daemon,
  });

  t.after(async () => {
    await broker.close();
    await daemon.stop().catch(() => {});
    resetStateStorage();
    if (originalHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = originalHome;
    }
    if (originalPolicy === undefined) {
      delete process.env.POLICY_PROFILE;
    } else {
      process.env.POLICY_PROFILE = originalPolicy;
    }
    fs.rmSync(dataHome, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);
  const headers = {
    "content-type": "application/json",
    "x-api-key": "fs-sandbox-key",
  };

  const cases = [
    { endpoint: "read", body: { path: outsideRead } },
    { endpoint: "write", body: { path: outsideWrite, content: "blocked" } },
    { endpoint: "delete", body: { path: outsideDelete } },
    { endpoint: "move", body: { src: outsideMoveSrc, dst: outsideMoveDst } },
    { endpoint: "list", body: { path: outsideRoot } },
    { endpoint: "stat", body: { path: outsideRead } },
  ];

  for (const item of cases) {
    const response = await fetch(`${baseUrl}/api/v1/fs/${item.endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(item.body),
    });
    assert.equal(response.status, 400, `${item.endpoint} should reject outside sandbox`);
    assert.match(await response.text(), /allowed roots|sandbox/i);
  }

  assert.equal(fs.existsSync(outsideWrite), false);
  assert.equal(fs.existsSync(outsideDelete), true);
  assert.equal(fs.existsSync(outsideMoveSrc), true);
  assert.equal(fs.existsSync(outsideMoveDst), false);
});

test("createBrokerServer rejects config mutation when policy requires confirmation", async (t) => {
  let setConfigCalls = 0;
  const broker = createBrokerServer({
    env: {
      BROKER_API_KEY: "operator-key",
      POLICY_PROFILE: "safe",
    },
    callbacks: {
      setConfig: async (key, value) => {
        setConfigCalls += 1;
        return { key, value, source: "user" };
      },
    },
  });

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  const response = await fetch(`${baseUrl}/api/v1/config/logLevel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "operator-key",
    },
    body: JSON.stringify({ value: "debug" }),
  });

  assert.equal(response.status, 403);
  const body = await response.json() as { policyDecision?: string; risk?: string; error?: string };
  assert.equal(body.policyDecision, "require_confirmation");
  assert.equal(body.risk, "moderate");
  assert.match(body.error ?? "", /requires user confirmation/i);
  assert.equal(setConfigCalls, 0);
});

test("createBrokerServer rejects unauthorized requests with auto-generated key", async (t) => {
  const broker = createBrokerServer({
    callbacks: {
      submitTask: async () => ({ taskId: "should-not-run" }),
    },
  });

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  // Without any auth header — 401 (auth always configured)
  const response = await fetch(`${baseUrl}/api/v1/tasks/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
    },
    body: JSON.stringify({ action: "terminal_exec", params: { command: "echo unsafe" } }),
  });

  assert.equal(response.status, 401);
  assert.match(JSON.stringify(await response.json()), /Unauthorized/);
});

test("createBrokerServer redacts secrets from callback error responses", async (t) => {
  const broker = createBrokerServer({
    env: {
      BROKER_API_KEY: "error-key",
    },
    callbacks: {
      getConfig: async () => {
        throw new Error("connect failed: wss://browserless.example?token=supersecrettoken1234567890");
      },
    },
  });

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  const response = await fetch(`${baseUrl}/api/v1/config/browserlessEndpoint`, {
    headers: {
      "x-api-key": "error-key",
    },
  });

  assert.equal(response.status, 400);
  const body = await response.json() as { error?: string };
  assert.match(body.error ?? "", /REDACTED/);
  assert.doesNotMatch(body.error ?? "", /supersecrettoken1234567890/);
});

test("createBrokerServer routes skill tasks through daemon.submitSkillTask when daemon is provided", async (t) => {
  const submittedSkillTasks: Array<{ taskId: string; skillName: string; action: string; params: Record<string, unknown> }> = [];
  const submittedTasks: Array<{ id: string; name: string }> = [];

  const broker = createBrokerServer({
    env: {
      BROKER_API_KEY: "skill-key",
    },
    daemon: {
      submitTask: async (task) => {
        submittedTasks.push({ id: task.id, name: task.name });
        return `task-${Date.now()}`;
      },
      submitSkillTask: (taskId, skillName, action, params) => {
        submittedSkillTasks.push({ taskId, skillName, action, params });
      },
      getScheduler: () => ({
        schedule: () => {},
        pause: () => {},
        resume: () => {},
        unschedule: () => {},
        getQueue: () => [],
      }),
      emergencyKill: async () => {},
      getHealthCheck: () => ({
        runAll: async () => ({
          overall: "healthy" as const,
          checks: [],
          timestamp: new Date().toISOString(),
        }),
      }),
      getTelemetry: () => ({
        getSummary: () => ({
          totalSteps: 0,
          successCount: 0,
          errorCount: 0,
          successRate: 0,
          averageDurationMs: 0,
          captchasSolved: 0,
          screenshotsCaptured: 0,
          proxyUsage: {},
          actions: {},
        }),
      }),
      getStats: () => ({
        totalSteps: 0,
        successCount: 0,
        errorCount: 0,
        successRate: 0,
        averageDurationMs: 0,
        captchasSolved: 0,
        screenshotsCaptured: 0,
        proxyUsage: {},
        actions: {},
      }),
    },
  });

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  // Submit a skill task through the broker API
  const skillResponse = await fetch(`${baseUrl}/api/v1/tasks/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "skill-key",
    },
    body: JSON.stringify({
      skill: "framer",
      action: "publish",
      params: { siteId: "test-site" },
    }),
  });

  assert.equal(skillResponse.status, 202);
  const skillBody = await skillResponse.json() as Record<string, unknown>;
  assert.ok(skillBody.taskId, "Should return a taskId");
  assert.equal(skillBody.status, "pending");

  // Verify the skill task went through submitSkillTask, not submitTask
  assert.equal(submittedSkillTasks.length, 1, "Should have one skill task submission");
  assert.equal(submittedSkillTasks[0].skillName, "framer");
  assert.equal(submittedSkillTasks[0].action, "publish");
  assert.deepEqual(submittedSkillTasks[0].params, { siteId: "test-site" });
  assert.equal(submittedTasks.length, 0, "Non-skill submitTask should NOT have been called");

  // Submit a non-skill task through the broker API
  const nonSkillResponse = await fetch(`${baseUrl}/api/v1/tasks/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "skill-key",
    },
    body: JSON.stringify({
      action: "visit",
      params: { url: "https://example.com" },
    }),
  });

  assert.equal(nonSkillResponse.status, 202);

  // Verify the non-skill task went through submitTask, not submitSkillTask
  assert.equal(submittedSkillTasks.length, 1, "No additional skill task should be submitted");
  assert.equal(submittedTasks.length, 1, "Non-skill task should go through submitTask");
  assert.equal(submittedTasks[0].name, "visit");
});

test("broker /api/v1/tasks/run with skill field routes through submitTask callback (daemon-managed path)", async (t) => {
  let submitTaskCalls = 0;
  let lastRequest: BrokerRunTaskRequest | undefined;

  const broker = createBrokerServer({
    env: {
      BROKER_API_KEY: "skill-route-key",
    },
    callbacks: {
      submitTask: async (request) => {
        submitTaskCalls += 1;
        lastRequest = request;
        return { taskId: `routed-${request.skill ?? "task"}` };
      },
    },
  });

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);

  // Submit a skill task via the broker
  const skillResponse = await fetch(`${baseUrl}/api/v1/tasks/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "skill-route-key",
    },
    body: JSON.stringify({
      skill: "framer",
      action: "publish",
      params: { siteId: "test" },
    }),
  });

  assert.equal(skillResponse.status, 202, "Skill task should be accepted");
  const skillBody = await skillResponse.json() as Record<string, unknown>;
  assert.ok(skillBody.taskId, "Should return a taskId");

  // Verify submitTask was called (not executeSkill bypass)
  assert.equal(submitTaskCalls, 1, "submitTask callback should be called for skill tasks");
  assert.equal(lastRequest?.skill, "framer", "Request should include skill field");
  assert.equal(lastRequest?.action, "publish", "Request should include action field");
  assert.deepEqual(lastRequest?.params, { siteId: "test" }, "Request should include params");

  // Also verify non-skill tasks still work through the same path
  const normalResponse = await fetch(`${baseUrl}/api/v1/tasks/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "skill-route-key",
    },
    body: JSON.stringify({
      action: "visit",
      params: { url: "https://example.com" },
    }),
  });

  assert.equal(normalResponse.status, 202, "Normal task should be accepted");
  assert.equal(submitTaskCalls, 2, "submitTask callback should be called for normal tasks too");
  assert.ok(!lastRequest?.skill, "Normal task request should not have skill field");
});

test("createBrokerServer rate limits WebSocket upgrades from the same client", async (t) => {
  const broker = createBrokerServer({
    env: {
      BROKER_API_KEY: "socket-key",
    },
    rateLimit: {
      maxRequests: 1,
      windowMs: 60_000,
    },
  });

  t.after(async () => {
    await broker.close();
  });

  await broker.listen(0, "127.0.0.1");
  const baseUrl = getBaseUrl(broker);
  const websocketUrl = `${baseUrl.replace("http", "ws")}/ws`;

  const firstSocket = new WebSocket(websocketUrl, {
    headers: {
      "x-api-key": "socket-key",
    },
  });
  t.after(() => firstSocket.close());
  await waitForOpen(firstSocket);

  const secondSocket = new WebSocket(websocketUrl, {
    headers: {
      "x-api-key": "socket-key",
    },
  });
  t.after(() => secondSocket.close());

  const [error] = await once(secondSocket, "error");
  assert.match(String(error), /Unexpected server response: 429/);
});
