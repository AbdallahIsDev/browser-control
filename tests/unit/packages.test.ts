import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { PackageRegistry } from "../../src/packages/registry";
import {
  computePackageDigest,
  safeResolveRelativePath,
  validatePackageManifest,
  verifyPackageSignature,
} from "../../src/packages/manifest";
import { MemoryStore } from "../../src/runtime/memory_store";
import { createBrowserControl } from "../../src/browser_control";
import { resetStateStorage } from "../../src/state/index";
import {
  ActionRecorder,
  convertRecordingToPackage,
  type RecordingSession,
} from "../../src/observability/recorder";
import {
  getPackageSavingsTelemetryHistory,
  recordDiscoveryTelemetry,
} from "../../src/packages/savings_telemetry";

describe("Automation Packages - Hardened", () => {
  let tmpDataHome: string;
  let registry: PackageRegistry;
  let memoryStore: MemoryStore;
  const fixturePath = path.join(__dirname, "..", "fixtures", "automation-packages", "basic-package");

  beforeEach(() => {
    tmpDataHome = path.join(os.tmpdir(), `bc-pkg-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDataHome, { recursive: true });
    registry = new PackageRegistry(tmpDataHome);
    memoryStore = new MemoryStore({ filename: ":memory:" });
  });

  afterEach(() => {
    memoryStore.close();
    resetStateStorage();
    if (fs.existsSync(tmpDataHome)) {
      fs.rmSync(tmpDataHome, { recursive: true, force: true });
    }
  });

  describe("Manifest Validation & Path Safety", () => {
    it("validates a well-formed package manifest with Zod", () => {
      const manifestPath = path.join(fixturePath, "automation-package.json");
      const result = validatePackageManifest(manifestPath, fixturePath);
      assert.strictEqual(result.valid, true, `Manifest should be valid: ${result.errors.join("; ")}`);
      assert.ok(result.manifest);
      assert.strictEqual(result.manifest.name, "basic-test-package");
    });

    it("rejects unknown root keys in manifest", () => {
      const badManifestPath = path.join(tmpDataHome, "automation-package.json");
      const badManifest = {
        schemaVersion: "1",
        name: "test-pkg",
        version: "1.0.0",
        description: "test",
        browserControlVersion: "1.0.0",
        permissions: [],
        unknownKey: "should-fail"
      };
      fs.writeFileSync(badManifestPath, JSON.stringify(badManifest));
      const result = validatePackageManifest(badManifestPath, tmpDataHome);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("unknownKey")));
    });

    it("accepts package trust metadata while still rejecting unknown keys", () => {
      const packageDir = path.join(tmpDataHome, "trusted-package");
      fs.mkdirSync(packageDir, { recursive: true });
      const manifestPath = path.join(packageDir, "automation-package.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          schemaVersion: "1",
          name: "trusted-package",
          version: "1.0.0",
          description: "Signed package fixture",
          browserControlVersion: "1.0.0",
          permissions: [],
          trust: {
            signer: "local-reviewer",
            digest: "sha256:abc123",
            signature: "MEUCIQD",
            reviewedAt: "2026-05-22T00:00:00.000Z",
            reviewedBy: "security-reviewer",
          },
        }),
      );

      const result = validatePackageManifest(manifestPath, packageDir);

      assert.strictEqual(result.valid, true, result.errors.join("; "));
      assert.equal(result.manifest?.trust?.signer, "local-reviewer");
    });

    it("enforces safeResolveRelativePath constraints", () => {
      const root = "/package/root";
      
      // Absolute path rejection
      assert.throws(() => safeResolveRelativePath(root, "/etc/passwd"), /Absolute paths are not allowed/);
      
      // Traversal rejection
      assert.throws(() => safeResolveRelativePath(root, "../outside"), /Path traversal detected/);
      assert.throws(() => safeResolveRelativePath(root, "node_modules/pkg"), /Reserved directory/);
      
      // Windows traversal
      assert.throws(() => safeResolveRelativePath(root, "..\\win-outside"), /Path traversal detected/);
      
      // Valid path
      const resolved = safeResolveRelativePath(fixturePath, "workflows/test-workflow.json");
      assert.ok(resolved.startsWith(path.resolve(fixturePath)));
    });

    it("verifies package signatures with a public key over the computed digest", () => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      const digest = computePackageDigest(fixturePath).digest;
      const signer = crypto.createSign("SHA256");
      signer.update(digest);
      signer.end();
      const signature = signer.sign(privateKey, "base64");
      const publicKeyPem = publicKey
        .export({ type: "spki", format: "pem" })
        .toString();

      const verified = verifyPackageSignature(
        fixturePath,
        digest,
        signature,
        publicKeyPem,
      );

      assert.strictEqual(verified.valid, true, verified.error);

      const wrongKey = crypto
        .generateKeyPairSync("rsa", { modulusLength: 2048 })
        .publicKey.export({ type: "spki", format: "pem" })
        .toString();
      const rejected = verifyPackageSignature(
        fixturePath,
        digest,
        signature,
        wrongKey,
      );
      assert.strictEqual(rejected.valid, false);
      assert.match(rejected.error ?? "", /Signature verification failed/);
    });
  });

  describe("Registry Operations", () => {
    it("installs without following symlinks and enforces limits", () => {
      const installResult = registry.install(fixturePath);
      assert.strictEqual(installResult.success, true);
      
      const installedDir = path.join(tmpDataHome, "packages", "installed", "basic-test-package");
      assert.ok(fs.existsSync(installedDir));
      assert.ok(fs.existsSync(path.join(installedDir, "automation-package.json")));
    });

    it("prevents traversal during remove/update", () => {
      registry.install(fixturePath);
      
      // Should ignore attempt to delete outside
      const result = registry.remove("../../../something");
      assert.strictEqual(result.success, false);
    });

    it("trust review reports risk from requested permissions before grants", () => {
      const result = registry.install(fixturePath);
      assert.strictEqual(result.success, true);

      const review = registry.submitReview(
        "basic-test-package",
        "pending",
        "security-reviewer",
        "pre-grant review",
      );

      assert.strictEqual(review.success, true);
      assert.ok(review.record);
      assert.match(
        review.record.riskSummary.warnings.join("\n"),
        /Terminal access requested/,
      );
      assert.notStrictEqual(
        review.record.riskSummary.riskLevel,
        "low",
        "packages requesting terminal access must not be low risk before grants",
      );
    });
  });

  describe("Permission Enforcement", () => {
    it("blocks execution if permissions are not granted", async () => {
      const bc = createBrowserControl({ memoryStore, dataHome: tmpDataHome, policyProfile: "trusted" });
      await bc.package.install(fixturePath);
      
      // Default state is denied
      const runResult = await bc.package.run("basic-test-package", "test-workflow");
      assert.strictEqual(runResult.success, false);
      assert.ok(runResult.error?.includes("Permission denied"));
      assert.ok(runResult.error?.includes("terminal"));
    });

    it("allows execution after permission is granted via API", async () => {
      const bc = createBrowserControl({ memoryStore, dataHome: tmpDataHome, policyProfile: "trusted" });
      await bc.package.install(fixturePath);
      
      // Grant permission
      const grantResult = bc.package.grantPermission("basic-test-package", "terminal");
      assert.strictEqual(grantResult.success, true);
      
      // Now it should run
      const runResult = await bc.package.run("basic-test-package", "test-workflow");
      assert.strictEqual(runResult.success, true, `Run should succeed: ${runResult.error}`);
      assert.strictEqual((runResult.data as any).status, "completed");
    });

    it("denies terminal command chaining even when the command prefix is granted", async () => {
      const bc = createBrowserControl({ memoryStore, dataHome: tmpDataHome, policyProfile: "trusted" });
      await bc.package.install(fixturePath);
      const grantResult = bc.package.grantPermission("basic-test-package", "terminal");
      assert.strictEqual(grantResult.success, true);

      const installedWorkflowPath = path.join(
        tmpDataHome,
        "packages",
        "installed",
        "basic-test-package",
        "workflows",
        "test-workflow.json",
      );
      const workflow = JSON.parse(fs.readFileSync(installedWorkflowPath, "utf8"));
      workflow.nodes[0].input.command = "echo allowed && echo chained";
      fs.writeFileSync(installedWorkflowPath, JSON.stringify(workflow, null, 2));

      const runResult = await bc.package.run("basic-test-package", "test-workflow");
      assert.strictEqual(runResult.success, false);
      assert.ok(runResult.error?.includes("Permission denied"));
    });

    it("requires permission index when a kind is ambiguous", () => {
      registry.install(fixturePath);
      const pkgs = registry.list();
      pkgs[0].permissions.push({
        permission: { kind: "terminal", commands: ["dir"] },
        granted: false,
      });
      fs.writeFileSync(
        path.join(tmpDataHome, "packages", "registry.json"),
        JSON.stringify(pkgs, null, 2),
      );

      const ambiguous = registry.grantPermission("basic-test-package", "terminal");
      assert.strictEqual(ambiguous.success, false);
      assert.ok(ambiguous.error?.includes("ambiguous"));

      const indexed = registry.grantPermission("basic-test-package", 0);
      assert.strictEqual(indexed.success, true);
    });

    it("denies filesystem path traversal through canonical containment checks", async () => {
      const bc = createBrowserControl({ memoryStore, dataHome: tmpDataHome, policyProfile: "trusted" });
      await bc.package.install(fixturePath);

      const allowedDir = path.join(tmpDataHome, "allowed");
      const secretPath = path.join(tmpDataHome, "secret.txt");
      fs.mkdirSync(allowedDir, { recursive: true });
      fs.writeFileSync(secretPath, "secret");

      const registryPath = path.join(tmpDataHome, "packages", "registry.json");
      const pkgs = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      pkgs[0].permissions = [{
        permission: { kind: "filesystem", paths: [allowedDir], access: "read" },
        granted: true,
      }];
      fs.writeFileSync(registryPath, JSON.stringify(pkgs, null, 2));

      const installedWorkflowPath = path.join(
        tmpDataHome,
        "packages",
        "installed",
        "basic-test-package",
        "workflows",
        "test-workflow.json",
      );
      const workflow = JSON.parse(fs.readFileSync(installedWorkflowPath, "utf8"));
      workflow.nodes[0] = {
        id: "node-1",
        kind: "filesystem",
        name: "Traversal Read",
        input: {
          action: "read",
          path: path.join(allowedDir, "..", "secret.txt"),
        },
      };
      fs.writeFileSync(installedWorkflowPath, JSON.stringify(workflow, null, 2));

      const runResult = await bc.package.run("basic-test-package", "test-workflow");
      assert.strictEqual(runResult.success, false);
      assert.ok(runResult.error?.includes("Permission denied"));
    });
  });

  describe("Evaluation & Timeout", () => {
    it("installs and evaluates a materialized recorder package draft", async () => {
      const recorder = new ActionRecorder();
      const session = recorder.start("Recorded Eval Package");
      recorder.record("terminal-exec", { command: "echo draft-eval" });
      recorder.stop();
      const draft = convertRecordingToPackage(session);

      const packageDir = path.join(tmpDataHome, "draft-package-source");
      const workflowPath = path.join(packageDir, draft.manifest.workflows[0]);
      const evalPath = path.join(packageDir, draft.manifest.evals[0]);
      fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
      fs.mkdirSync(path.dirname(evalPath), { recursive: true });
      fs.writeFileSync(
        path.join(packageDir, "automation-package.json"),
        JSON.stringify(draft.manifest, null, 2),
      );
      fs.writeFileSync(workflowPath, JSON.stringify(draft.workflow, null, 2));
      fs.writeFileSync(evalPath, JSON.stringify(draft.evalDefinition, null, 2));

      const bc = createBrowserControl({
        memoryStore,
        dataHome: tmpDataHome,
        policyProfile: "trusted",
      });
      const installResult = await bc.package.install(packageDir);
      assert.strictEqual(installResult.success, true, installResult.error);
      const grantResult = bc.package.grantPermission(
        draft.manifest.name,
        "terminal",
      );
      assert.strictEqual(grantResult.success, true, grantResult.error);

      const result = await bc.package.eval(draft.manifest.name);
      assert.strictEqual(result.success, true, result.error);
      const evalResults = result.data as any[];
      assert.strictEqual(evalResults[0].status, "passed", evalResults[0].error);
    });

    it("enforces timeout in evaluation", async () => {
      // Create a package with a workflow that would take time or just a long timeout
      const bc = createBrowserControl({ memoryStore, dataHome: tmpDataHome, policyProfile: "trusted" });
      await bc.package.install(fixturePath);
      bc.package.grantPermission("basic-test-package", "terminal");

      // Modifying eval to have very short timeout for test
      const installedPath = path.join(tmpDataHome, "packages", "installed", "basic-test-package");
      const evalPath = path.join(installedPath, "evals", "test-eval.json");
      const evals = JSON.parse(fs.readFileSync(evalPath, "utf8"));
      evals[0].timeoutMs = 1; // 1ms will definitely timeout
      fs.writeFileSync(evalPath, JSON.stringify(evals));

      const result = await bc.package.eval("basic-test-package");
      assert.strictEqual(result.success, true);
      const evalResults = result.data as any[];
      assert.strictEqual(evalResults[0].status, "failed");
      assert.ok(evalResults[0].error?.includes("timed out"));
    });
  });

  describe("Savings Telemetry", () => {
    it("records discovery metrics from a package recording", () => {
      const startedAt = "2026-05-23T10:00:00.000Z";
      const session: RecordingSession = {
        id: "rec-discovery-1",
        startedAt,
        name: "Basic Test Package",
        actions: [
          {
            id: "act-1",
            kind: "browser-open",
            timestamp: "2026-05-23T10:00:01.000Z",
            params: { url: "https://example.test" },
          },
          {
            id: "act-2",
            kind: "browser-click",
            timestamp: "2026-05-23T10:00:05.000Z",
            params: { target: "@e1" },
            error: "not found",
          },
        ],
      };

      const record = recordDiscoveryTelemetry(session, tmpDataHome);
      const history = getPackageSavingsTelemetryHistory(tmpDataHome);

      assert.equal(record.kind, "discovery");
      assert.equal(record.packageName, "basic-test-package");
      assert.equal(record.toolCalls, 2);
      assert.equal(record.failures, 1);
      assert.equal(record.durationMs, 5000);
      assert.equal(history[0].id, record.id);
    });

    it("attaches replay savings comparison to package run output", async () => {
      const bc = createBrowserControl({ memoryStore, dataHome: tmpDataHome, policyProfile: "trusted" });
      await bc.package.install(fixturePath);
      const grantResult = bc.package.grantPermission("basic-test-package", "terminal");
      assert.strictEqual(grantResult.success, true, grantResult.error);

      recordDiscoveryTelemetry({
        id: "rec-baseline",
        startedAt: "2026-05-23T10:00:00.000Z",
        name: "Basic Test Package",
        actions: [
          { id: "act-1", kind: "terminal-exec", timestamp: "2026-05-23T10:00:03.000Z", params: { command: "echo one" } },
          { id: "act-2", kind: "terminal-exec", timestamp: "2026-05-23T10:00:07.000Z", params: { command: "echo two" } },
          { id: "act-3", kind: "terminal-exec", timestamp: "2026-05-23T10:00:09.000Z", params: { command: "echo three" }, error: "retry" },
        ],
      }, tmpDataHome);

      const runResult = await bc.package.run("basic-test-package", "test-workflow");

      assert.strictEqual(runResult.success, true, runResult.error);
      const telemetry = (runResult.data as any).savingsTelemetry;
      assert.equal(telemetry.replay.kind, "replay");
      assert.equal(telemetry.replay.packageName, "basic-test-package");
      assert.equal(telemetry.comparison.baseline.toolCalls, 3);
      assert.equal(telemetry.comparison.savings.toolCalls, 2);
      assert.equal(telemetry.comparison.savings.failures, 1);
    });
  });
});
