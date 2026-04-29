import { describe, it } from "node:test";
import * as assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HarnessRegistry, getHarnessDir } from "../../src/harness/registry";
import { LocalTempSandbox } from "../../src/harness/sandbox";
import type { HarnessHelperManifest } from "../../src/harness/types";

function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bc-harness-test-"));
}

function makeManifest(overrides: Partial<HarnessHelperManifest> = {}): HarnessHelperManifest {
  return {
    id: "test-helper",
    taskTags: ["login"],
    failureTypes: ["timeout"],
    files: ["helper.ts"],
    usage: "import { helper } from './helper'",
    purpose: "Test helper for login pages",
    version: "1.0.0",
    activated: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Harness Registry", () => {
  it("registers and lists helpers", () => {
    const home = makeTempHome();
    const registry = new HarnessRegistry({ dataHome: home });

    registry.register(makeManifest());
    const list = registry.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, "test-helper");
    assert.strictEqual(list[0].activated, false);

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("finds helpers by task tag", () => {
    const home = makeTempHome();
    const registry = new HarnessRegistry({ dataHome: home });

    registry.register(makeManifest());
    registry.register(makeManifest({ id: "other", taskTags: ["checkout"] }));

    const found = registry.find({ taskTag: "login" });
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].id, "test-helper");

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("validates schema check passes for well-formed helper", () => {
    const home = makeTempHome();
    const registry = new HarnessRegistry({ dataHome: home });

    registry.register(makeManifest());
    const result = registry.validate("test-helper");
    assert.strictEqual(result.status, "passed");
    assert.ok(result.checks.some(c => c.name === "schema" && c.status === "passed"));

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("validation fails for unknown helper", () => {
    const home = makeTempHome();
    const registry = new HarnessRegistry({ dataHome: home });

    const result = registry.validate("nonexistent");
    assert.strictEqual(result.status, "failed");

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("validation fails for unsafe paths", () => {
    const home = makeTempHome();
    const registry = new HarnessRegistry({ dataHome: home });

    registry.register(makeManifest({ files: ["../etc/passwd"] }));
    const result = registry.validate("test-helper");
    assert.strictEqual(result.status, "failed");
    assert.ok(result.checks.some(c => c.name === "path_safety" && c.status === "failed"));

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("validation fails for absolute paths and Windows traversal", () => {
    const home = makeTempHome();
    const registry = new HarnessRegistry({ dataHome: home });

    registry.register(makeManifest({ files: ["C:\\Users\\11\\browser-control\\src\\core.ts"] }));
    let result = registry.validate("test-helper");
    assert.strictEqual(result.status, "failed");
    assert.ok(result.checks.some(c => c.name === "path_safety" && c.status === "failed"));

    registry.register(makeManifest({ files: ["..\\..\\src\\core.ts"] }));
    result = registry.validate("test-helper");
    assert.strictEqual(result.status, "failed");
    assert.ok(result.checks.some(c => c.name === "path_safety" && c.status === "failed"));

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("rejects unsafe helper IDs before filesystem use", () => {
    const home = makeTempHome();
    const registry = new HarnessRegistry({ dataHome: home });

    assert.throws(() => registry.register(makeManifest({ id: "../escape" })), /Unsafe helper id/);
    const result = registry.validate("../escape");
    assert.strictEqual(result.status, "failed");
    assert.ok(result.checks.some(c => c.message?.includes("Unsafe helper id")));

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("prevents activation of invalid helper", () => {
    const home = makeTempHome();
    const registry = new HarnessRegistry({ dataHome: home });

    registry.register(makeManifest({ files: ["../exploit.js"] }));
    const result = registry.activate("test-helper");
    assert.strictEqual(result.status, "failed");

    const helper = registry.get("test-helper");
    assert.strictEqual(helper?.activated, false);

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("activates valid helper", () => {
    const home = makeTempHome();
    const registry = new HarnessRegistry({ dataHome: home });

    registry.register(makeManifest());
    const result = registry.activate("test-helper");
    assert.strictEqual(result.status, "passed");

    const helper = registry.get("test-helper");
    assert.strictEqual(helper?.activated, true);

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("rolls back to previous version", () => {
    const home = makeTempHome();
    const registry = new HarnessRegistry({ dataHome: home });

    registry.register(makeManifest({ version: "1.0.0" }));
    registry.register(makeManifest({ version: "2.0.0" }));

    const helper = registry.get("test-helper");
    assert.strictEqual(helper?.version, "2.0.0");
    assert.ok(helper?.previousVersions?.includes("1.0.0"));

    const result = registry.rollback("test-helper", "1.0.0");
    assert.strictEqual(result.success, true);

    const rolled = registry.get("test-helper");
    assert.strictEqual(rolled?.version, "1.0.0");
    assert.strictEqual(rolled?.activated, false);

    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe("LocalTempSandbox", () => {
  it("rejects shell control characters", async () => {
    const home = makeTempHome();
    const sandbox = new LocalTempSandbox();

    const result = await sandbox.run("node --version & echo unsafe", [], home);
    assert.strictEqual(result.success, false);
    assert.match(result.error ?? "", /shell control characters/);

    await sandbox.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("rejects commands outside the sandbox allowlist", async () => {
    const home = makeTempHome();
    const sandbox = new LocalTempSandbox();

    const result = await sandbox.run("powershell Get-ChildItem", [], home);
    assert.strictEqual(result.success, false);
    assert.match(result.error ?? "", /not allowed/);

    await sandbox.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  });
});
