import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POLICY_AUDIT_CLEAR_CONFIRMATION, PolicyAuditLogger } from "../../src/policy/audit";
import type { PolicyAuditEntry, PolicyDecision } from "../../src/policy/types";

function makeEntry(overrides: Partial<PolicyAuditEntry> = {}): PolicyAuditEntry {
  const decision = overrides.decision ?? "allow_with_audit";
  return {
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    sessionId: overrides.sessionId ?? "session-1",
    actor: overrides.actor ?? "agent",
    step: overrides.step ?? {
      id: "step-1",
      path: "command",
      action: "terminal_exec",
      params: {},
      risk: "moderate",
      sessionId: overrides.sessionId ?? "session-1",
    },
    decision,
    reason: overrides.reason ?? "test",
    profile: overrides.profile ?? "balanced",
    risk: overrides.risk ?? "moderate",
    matchedRule: overrides.matchedRule,
  };
}

test("PolicyAuditLogger queues writes without synchronous appendFileSync", async () => {
  const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-policy-audit-"));
  const logger = new PolicyAuditLogger({ auditDir });
  const originalAppendFileSync = fs.appendFileSync;

  try {
    fs.appendFileSync = (() => {
      throw new Error("appendFileSync should not be used for audit writes");
    }) as typeof fs.appendFileSync;

    logger.log(makeEntry({ sessionId: "async-session" }));
    await logger.flush();

    const entries = logger.queryBySession("async-session");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].sessionId, "async-session");
  } finally {
    fs.appendFileSync = originalAppendFileSync;
    await logger.close();
    fs.rmSync(auditDir, { recursive: true, force: true });
  }
});

test("PolicyAuditLogger queries scan JSONL without full-file readFileSync", async () => {
  const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-policy-audit-"));
  const logger = new PolicyAuditLogger({ auditDir });
  const originalReadFileSync = fs.readFileSync;
  const now = Date.now();

  try {
    logger.log(makeEntry({
      sessionId: "session-a",
      actor: "agent",
      decision: "allow_with_audit",
      timestamp: new Date(now - 1000).toISOString(),
    }));
    logger.log(makeEntry({
      sessionId: "session-b",
      actor: "human",
      decision: "deny",
      timestamp: new Date(now).toISOString(),
    }));
    await logger.flush();

    const auditFile = fs.readdirSync(auditDir).find((file) => file.endsWith(".jsonl"));
    assert.ok(auditFile);
    fs.appendFileSync(path.join(auditDir, auditFile), "not-json\n");

    fs.readFileSync = (() => {
      throw new Error("readFileSync should not be used for audit queries");
    }) as typeof fs.readFileSync;

    assert.equal(logger.queryBySession("session-a").length, 1);
    assert.equal(logger.queryByActor("human").length, 1);
    assert.equal(logger.queryByDecision("deny" as PolicyDecision).length, 1);
    assert.equal(
      logger.queryByTimeRange(new Date(now - 1500), new Date(now - 500)).length,
      1,
    );
    assert.equal(logger.getAll(1).length, 1);
  } finally {
    fs.readFileSync = originalReadFileSync;
    await logger.close();
    fs.rmSync(auditDir, { recursive: true, force: true });
  }
});

test("PolicyAuditLogger clear requires confirmation and preserves a clear marker", async () => {
  const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-policy-audit-"));
  const logger = new PolicyAuditLogger({ auditDir });

  try {
    logger.log(makeEntry({ sessionId: "clear-session" }));
    await logger.flush();

    const auditFileBefore = fs.readdirSync(auditDir).find((file) => file.startsWith("policy-audit-"));
    assert.ok(auditFileBefore);
    assert.throws(
      () => (logger as unknown as { clear: () => void }).clear(),
      /Policy audit clear requires confirm=CLEAR_POLICY_AUDIT_LOGS/u,
    );
    assert.ok(fs.existsSync(path.join(auditDir, auditFileBefore)));

    logger.clear({
      confirm: POLICY_AUDIT_CLEAR_CONFIRMATION,
      actor: "human",
      reason: "unit-test",
    });
    await logger.flush();

    assert.deepEqual(
      fs.readdirSync(auditDir).filter((file) => file.startsWith("policy-audit-")),
      [],
    );
    const markerPath = path.join(auditDir, "audit-clear-events.jsonl");
    assert.ok(fs.existsSync(markerPath));
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8").trim());
    assert.equal(marker.action, "policy_audit_clear");
    assert.equal(marker.actor, "human");
    assert.equal(marker.reason, "unit-test");
    assert.equal(marker.deletedFiles.length, 1);
    assert.equal(marker.deletedFiles[0].name, auditFileBefore);
    assert.match(marker.deletedFiles[0].sha256, /^[a-f0-9]{64}$/u);
  } finally {
    await logger.close();
    fs.rmSync(auditDir, { recursive: true, force: true });
  }
});
