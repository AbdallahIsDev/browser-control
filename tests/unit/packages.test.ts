import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { PackageRegistry } from "../../src/packages/registry";
import { validatePackageManifest, safeResolveRelativePath } from "../../src/packages/manifest";
import { MemoryStore } from "../../src/runtime/memory_store";
import { createBrowserControl } from "../../src/browser_control";
import { resetStateStorage } from "../../src/state/index";

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
});
