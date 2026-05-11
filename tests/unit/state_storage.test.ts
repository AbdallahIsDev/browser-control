import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  JsonFileStateStorage,
  resetStateStorage,
  type StoredTask,
  type StoredAutomation,
  type StoredWorkflowDefinition,
  type StoredApproval,
  type StoredEvidence,
  type StoredAuditEvent,
  type StoredTradePlan,
  type StoredOrderTicket,
  type StoredSupervisorJob,
  type StoredSupervisorDecision,
} from "../../src/state/index";

function makeStorage(): { storage: JsonFileStateStorage; home: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-state-"));
  const storage = new JsonFileStateStorage(home);
  return { storage, home };
}

test("state storage saves and retrieves tasks", async () => {
  const { storage, home } = makeStorage();
  try {
    const task: StoredTask = {
      id: "task-1",
      prompt: "Analyze site",
      status: "queued",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await storage.saveTask(task);
    const retrieved = await storage.getTask("task-1");
    assert.equal(retrieved?.id, "task-1");
    assert.equal(retrieved?.status, "queued");

    const all = await storage.listTasks();
    assert.equal(all.length, 1);

    await storage.deleteTask("task-1");
    assert.equal(await storage.getTask("task-1"), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    resetStateStorage();
  }
});

test("state storage saves and retrieves automations", async () => {
  const { storage, home } = makeStorage();
  try {
    const automation: StoredAutomation = {
      id: "auto-1",
      name: "Test automation",
      description: "A test",
      prompt: "Run tests",
      source: "user",
      status: "ready",
      approvalRequired: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      runCount: 0,
    };
    await storage.saveAutomation(automation);
    const retrieved = await storage.getAutomation("auto-1");
    assert.equal(retrieved?.name, "Test automation");
    assert.equal(retrieved?.runCount, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    resetStateStorage();
  }
});

test("state storage persists workflow definitions", async () => {
  const { storage, home } = makeStorage();
  try {
    const def: StoredWorkflowDefinition = {
      id: "wf-1",
      name: "Test workflow",
      graph: [
        { id: "n1", type: "open_url", params: { url: "https://example.com" } },
        { id: "n2", type: "click", params: { target: "@e1" }, dependsOn: ["n1"] },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await storage.saveWorkflowDefinition(def);
    const retrieved = await storage.getWorkflowDefinition("wf-1");
    assert.equal(retrieved?.name, "Test workflow");
    assert.equal(retrieved?.graph.length, 2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    resetStateStorage();
  }
});

test("state storage saves approvals and filters by status", async () => {
  const { storage, home } = makeStorage();
  try {
    const pending: StoredApproval = {
      id: "app-1",
      actionId: "act-1",
      actionType: "trade",
      description: "Approve trade",
      status: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const approved: StoredApproval = {
      id: "app-2",
      actionId: "act-2",
      actionType: "delete",
      description: "Delete files",
      status: "approved",
      approvedBy: "user",
      approvedAt: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await storage.saveApproval(pending);
    await storage.saveApproval(approved);

    const all = await storage.listApprovals();
    assert.equal(all.length, 2);

    const pendingOnly = await storage.listApprovals("pending");
    assert.equal(pendingOnly.length, 1);
    assert.equal(pendingOnly[0].id, "app-1");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    resetStateStorage();
  }
});

test("state storage persists evidence and filters by task", async () => {
  const { storage, home } = makeStorage();
  try {
    const ev: StoredEvidence = {
      id: "ev-1",
      taskId: "task-1",
      type: "screenshot",
      path: "/tmp/test.png",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await storage.saveEvidence(ev);
    const forTask = await storage.listEvidence("task-1");
    assert.equal(forTask.length, 1);
    assert.equal(forTask[0].type, "screenshot");

    const all = await storage.listEvidence();
    assert.equal(all.length, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    resetStateStorage();
  }
});

test("state storage saves audit events and enforces max 1000 limit", async () => {
  const { storage, home } = makeStorage();
  try {
    for (let i = 0; i < 1010; i++) {
      await storage.saveAuditEvent({
        id: `audit-${i}`,
        action: `action-${i}`,
        timestamp: new Date().toISOString(),
      });
    }
    const events = await storage.listAuditEvents(100);
    assert.equal(events.length, 100);
    // Should have kept the last 1000, not more
    const all = await storage.listAuditEvents(2000);
    assert.equal(all.length, 1000);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    resetStateStorage();
  }
});

test("state storage persists trading state", async () => {
  const { storage, home } = makeStorage();
  try {
    const plan: StoredTradePlan = {
      id: "plan-1",
      planId: "plan-1",
      symbol: "EURUSD",
      side: "buy",
      mode: "paper",
      status: "active",
      riskPercent: 0.5,
      thesis: "Bullish",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await storage.saveTradePlan(plan);
    const plans = await storage.listTradePlans();
    assert.equal(plans.length, 1);
    assert.equal(plans[0].symbol, "EURUSD");

    const job: StoredSupervisorJob = {
      id: "job-1",
      tradeId: "trade-1",
      symbol: "EURUSD",
      side: "buy",
      mode: "paper",
      interval: 30,
      status: "active",
      decidedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await storage.saveSupervisorJob(job);
    const jobs = await storage.listSupervisorJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "active");

    const decision: StoredSupervisorDecision = {
      id: "dec-1",
      tradeId: "trade-1",
      decision: "hold",
      confidence: "high",
      riskState: "normal",
      reason: "Setup valid",
      requiresApproval: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await storage.saveSupervisorDecision(decision);
    const decisions = await storage.listSupervisorDecisions("trade-1");
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].decision, "hold");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    resetStateStorage();
  }
});

test("state storage persists order tickets", async () => {
  const { storage, home } = makeStorage();
  try {
    const ticket: StoredOrderTicket = {
      id: "ticket-1",
      planId: "plan-1",
      mode: "paper",
      account: "paper-1",
      platform: "paper",
      symbol: "EURUSD",
      side: "buy",
      size: 1,
      entry: 1.1,
      stopLoss: 1.09,
      targets: [1.13],
      status: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await storage.saveOrderTicket(ticket);
    const tickets = await storage.listOrderTickets();
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].symbol, "EURUSD");
    assert.equal(tickets[0].entry, 1.1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    resetStateStorage();
  }
});

test("state storage persists package evals", async () => {
  const { storage, home } = makeStorage();
  try {
    await storage.savePackageEval({
      packageName: "test-pkg",
      version: "1.0.0",
      evalResult: "pass",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
    });
    const evals = await storage.listPackageEvals();
    assert.equal(evals.length, 1);
    assert.equal(evals[0].evalResult, "pass");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    resetStateStorage();
  }
});