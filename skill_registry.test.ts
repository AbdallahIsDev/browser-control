import describe from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Skill, SkillContext, SkillManifest } from "./skill";
import { SkillRegistry } from "./skill_registry";

function createMockContext(): SkillContext {
  const mockScopedMemory = {
    get: () => null,
    set: () => {},
    delete: () => true,
    keys: () => [],
    clear: () => {},
    getRawStore: () => mockRawStore,
    getPrefix: () => "skill:test-skill:",
  } as unknown as SkillContext["memoryStore"];

  const mockRawStore = {
    get: () => null,
    set: () => {},
    delete: () => true,
    keys: () => [],
    clear: () => {},
    close: () => {},
    getStats: () => ({ filename: ":memory:", totalKeys: 0, collections: {}, fileSizeBytes: 0 }),
  } as unknown as SkillContext["rawMemoryStore"];

  return {
    page: {} as SkillContext["page"],
    data: {},
    memoryStore: mockScopedMemory,
    rawMemoryStore: mockRawStore,
    telemetry: {
      record: () => {},
      getSummary: () => ({
        totalSteps: 0, successCount: 0, errorCount: 0, successRate: 0,
        averageDurationMs: 0, captchasSolved: 0, screenshotsCaptured: 0,
        proxyUsage: {}, actions: {},
      }),
    } as unknown as SkillContext["telemetry"],
  };
}

function createTestSkill(overrides: Partial<SkillManifest> = {}): Skill {
  const manifest: SkillManifest = {
    name: overrides.name ?? "test-skill",
    version: overrides.version ?? "1.0.0",
    description: overrides.description ?? "A test skill",
    author: overrides.author,
    requiredEnv: overrides.requiredEnv ?? [],
    allowedDomains: overrides.allowedDomains ?? [],
  };

  return {
    manifest,
    setup: async () => {},
    execute: async (_action, params) => ({ ...params, skillName: manifest.name }),
    teardown: async () => {},
    healthCheck: async () => ({ healthy: true }),
  };
}

describe.describe("SkillRegistry", () => {
  describe.describe("register", () => {
    describe.it("registers a skill and makes it retrievable", () => {
      const registry = new SkillRegistry();
      const skill = createTestSkill();
      registry.register(skill);
      assert.equal(registry.has("test-skill"), true);
      assert.equal(registry.get("test-skill"), skill);
    });

    describe.it("throws when registering a duplicate skill name", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill());
      assert.throws(() => registry.register(createTestSkill()), /already registered/);
    });
  });

  describe.describe("unregister", () => {
    describe.it("removes a skill and returns true", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill());
      assert.equal(registry.unregister("test-skill"), true);
      assert.equal(registry.has("test-skill"), false);
    });

    describe.it("returns false for unknown skill", () => {
      const registry = new SkillRegistry();
      assert.equal(registry.unregister("nope"), false);
    });
  });

  describe.describe("list", () => {
    describe.it("returns all manifests", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill({ name: "a" }));
      registry.register(createTestSkill({ name: "b" }));
      const list = registry.list();
      assert.equal(list.length, 2);
      assert.equal(list[0].name, "a");
      assert.equal(list[1].name, "b");
    });
  });

  describe.describe("listNames", () => {
    describe.it("returns all skill names", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill({ name: "alpha" }));
      registry.register(createTestSkill({ name: "beta" }));
      assert.deepEqual(registry.listNames(), ["alpha", "beta"]);
    });
  });

  describe.describe("execute", () => {
    describe.it("delegates to skill execute", async () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill());
      const result = await registry.execute("test-skill", "doStuff", { x: 1 });
      assert.equal(result.skillName, "test-skill");
      assert.equal(result.x, 1);
    });

    describe.it("throws for unknown skill", async () => {
      const registry = new SkillRegistry();
      await assert.rejects(() => registry.execute("nope", "action", {}), /not registered/);
    });
  });

  describe.describe("setup", () => {
    describe.it("calls setup and marks complete", async () => {
      let called = false;
      const skill: Skill = {
        manifest: { name: "s", version: "1.0.0", description: "", requiredEnv: [], allowedDomains: [] },
        setup: async () => { called = true; },
        execute: async () => ({}),
        teardown: async () => {},
        healthCheck: async () => ({ healthy: true }),
      };
      const registry = new SkillRegistry();
      registry.register(skill);
      await registry.setup("s", createMockContext());
      assert.equal(called, true);
    });

    describe.it("does not call setup twice", async () => {
      let count = 0;
      const skill: Skill = {
        manifest: { name: "s", version: "1.0.0", description: "", requiredEnv: [], allowedDomains: [] },
        setup: async () => { count += 1; },
        execute: async () => ({}),
        teardown: async () => {},
        healthCheck: async () => ({ healthy: true }),
      };
      const registry = new SkillRegistry();
      registry.register(skill);
      await registry.setup("s", createMockContext());
      await registry.setup("s", createMockContext());
      assert.equal(count, 1);
    });
  });

  describe.describe("teardown", () => {
    describe.it("calls teardown and resets setupComplete", async () => {
      let tornDown = false;
      const skill: Skill = {
        manifest: { name: "s", version: "1.0.0", description: "", requiredEnv: [], allowedDomains: [] },
        setup: async () => {},
        execute: async () => ({}),
        teardown: async () => { tornDown = true; },
        healthCheck: async () => ({ healthy: true }),
      };
      const registry = new SkillRegistry();
      registry.register(skill);
      await registry.setup("s", createMockContext());
      await registry.teardown("s", createMockContext());
      assert.equal(tornDown, true);
    });
  });

  describe.describe("validateEnv", () => {
    describe.it("returns valid when all required env vars are present", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill({ requiredEnv: ["API_KEY"] }));
      const result = registry.validateEnv("test-skill", { API_KEY: "x" });
      assert.equal(result.valid, true);
      assert.equal(result.missing.length, 0);
    });

    describe.it("returns missing env vars", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill({ requiredEnv: ["API_KEY", "SECRET"] }));
      const result = registry.validateEnv("test-skill", {});
      assert.equal(result.valid, false);
      assert.deepEqual(result.missing, ["API_KEY", "SECRET"]);
    });
  });

  describe.describe("isDomainAllowed", () => {
    describe.it("allows all domains when allowedDomains is empty", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill({ allowedDomains: [] }));
      assert.equal(registry.isDomainAllowed("test-skill", "evil.com"), true);
    });

    describe.it("allows exact domain match", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill({ allowedDomains: ["example.com"] }));
      assert.equal(registry.isDomainAllowed("test-skill", "example.com"), true);
    });

    describe.it("allows subdomain match", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill({ allowedDomains: ["example.com"] }));
      assert.equal(registry.isDomainAllowed("test-skill", "sub.example.com"), true);
    });

    describe.it("rejects non-matching domain", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill({ allowedDomains: ["example.com"] }));
      assert.equal(registry.isDomainAllowed("test-skill", "evil.com"), false);
    });
  });

  describe.describe("size and clear", () => {
    describe.it("tracks size", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill({ name: "a" }));
      registry.register(createTestSkill({ name: "b" }));
      assert.equal(registry.size(), 2);
    });

    describe.it("clears all entries", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill());
      registry.clear();
      assert.equal(registry.size(), 0);
    });
  });

  describe.describe("healthCheckAll", () => {
    describe.it("returns health for all skills", async () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill({ name: "a" }));
      registry.register(createTestSkill({ name: "b" }));
      const results = await registry.healthCheckAll(createMockContext());
      assert.equal(results.a.healthy, true);
      assert.equal(results.b.healthy, true);
    });
  });

  describe.describe("loadFromDirectory", () => {
    describe.it("returns empty array for non-existent directory", async () => {
      const registry = new SkillRegistry();
      const skills = await registry.loadFromDirectory("/no/such/directory");
      assert.deepEqual(skills, []);
    });

    describe.it("loads skills from the skills/ directory", async () => {
      const registry = new SkillRegistry();
      const skills = await registry.loadFromDirectory("./skills");
      // Should load the three built-in skills
      assert.ok(skills.length >= 1, "Expected at least 1 skill to be loaded");
      const names = registry.listNames();
      // The built-in skills should be registered
      for (const skill of skills) {
        assert.ok(names.includes(skill.manifest.name), `Expected ${skill.manifest.name} to be registered`);
      }
    });

    describe.it("does not double-load the same directory", async () => {
      const registry = new SkillRegistry();
      await registry.loadFromDirectory("./skills");
      const countAfterFirst = registry.size();
      await registry.loadFromDirectory("./skills");
      assert.equal(registry.size(), countAfterFirst);
    });
  });

  describe.describe("loadFromFile", () => {
    describe.it("throws for non-existent file", async () => {
      const registry = new SkillRegistry();
      await assert.rejects(
        () => registry.loadFromFile("/no/such/skill.ts"),
        /not found/,
      );
    });

    describe.it("loads a skill from a file", async () => {
      const registry = new SkillRegistry();
      const skills = await registry.loadFromFile("./skills/framer_skill.ts");
      assert.ok(skills.length >= 1);
      assert.ok(registry.has("framer"));
    });
  });

  describe.describe("getLoadedFiles", () => {
    describe.it("tracks loaded files", async () => {
      const registry = new SkillRegistry();
      assert.deepEqual(registry.getLoadedFiles(), []);
      await registry.loadFromFile("./skills/framer_skill.ts");
      const files = registry.getLoadedFiles();
      assert.equal(files.length, 1);
      assert.ok(files[0].includes("framer_skill.ts"));
    });
  });

  // ── Manifest Validation ──────────────────────────────────────────────

  describe.describe("validateManifest", () => {
    describe.it("returns valid for a correct manifest", () => {
      const { validateManifest } = require("./skill_registry") as typeof import("./skill_registry");
      const result = validateManifest({
        name: "good-skill",
        version: "1.0.0",
        description: "A good skill",
        requiredEnv: ["API_KEY"],
        allowedDomains: ["example.com"],
      });
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    describe.it("reports missing name", () => {
      const { validateManifest } = require("./skill_registry") as typeof import("./skill_registry");
      const result = validateManifest({
        name: "",
        version: "1.0.0",
        description: "desc",
        requiredEnv: [],
        allowedDomains: [],
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e: string) => e.includes("name")));
    });

    describe.it("reports missing version", () => {
      const { validateManifest } = require("./skill_registry") as typeof import("./skill_registry");
      const result = validateManifest({
        name: "skill",
        version: "",
        description: "desc",
        requiredEnv: [],
        allowedDomains: [],
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e: string) => e.includes("version")));
    });

    describe.it("reports missing description", () => {
      const { validateManifest } = require("./skill_registry") as typeof import("./skill_registry");
      const result = validateManifest({
        name: "skill",
        version: "1.0.0",
        description: "",
        requiredEnv: [],
        allowedDomains: [],
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e: string) => e.includes("description")));
    });

    describe.it("reports non-array requiredEnv", () => {
      const { validateManifest } = require("./skill_registry") as typeof import("./skill_registry");
      const result = validateManifest({
        name: "skill",
        version: "1.0.0",
        description: "desc",
        requiredEnv: "not-array" as unknown as string[],
        allowedDomains: [],
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e: string) => e.includes("requiredEnv")));
    });

    describe.it("reports invalid action param types", () => {
      const { validateManifest } = require("./skill_registry") as typeof import("./skill_registry");
      const result = validateManifest({
        name: "skill",
        version: "1.0.0",
        description: "desc",
        requiredEnv: [],
        allowedDomains: [],
        actions: [{
          name: "doThing",
          description: "Do a thing",
          params: [{ name: "p1", type: "invalid-type" as unknown as import("./skill").ActionParamType, required: true }],
        }],
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e: string) => e.includes("invalid-type")));
    });

    describe.it("reports duplicate action names", () => {
      const { validateManifest } = require("./skill_registry") as typeof import("./skill_registry");
      const result = validateManifest({
        name: "skill",
        version: "1.0.0",
        description: "desc",
        requiredEnv: [],
        allowedDomains: [],
        actions: [
          { name: "doThing", description: "First", params: [] },
          { name: "doThing", description: "Duplicate", params: [] },
        ],
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e: string) => e.includes("duplicated")));
    });

    describe.it("reports non-string configSchema", () => {
      const { validateManifest } = require("./skill_registry") as typeof import("./skill_registry");
      const result = validateManifest({
        name: "skill",
        version: "1.0.0",
        description: "desc",
        requiredEnv: [],
        allowedDomains: [],
        configSchema: 42 as unknown as string,
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e: string) => e.includes("configSchema")));
    });

    describe.it("warns about missing action descriptions (non-string)", () => {
      const { validateManifest } = require("./skill_registry") as typeof import("./skill_registry");
      const result = validateManifest({
        name: "skill",
        version: "1.0.0",
        description: "desc",
        requiredEnv: [],
        allowedDomains: [],
        actions: [{
          name: "doThing",
          description: 42 as unknown as string,
          params: [],
        }],
      });
      assert.equal(result.valid, true, "Non-string description is a warning, not an error");
      assert.ok(result.warnings.length > 0, "Should warn about non-string action description");
      assert.ok(result.warnings.some((w: string) => w.includes("description")), "Warning should mention description");
    });

    describe.it("warns about empty action descriptions", () => {
      const { validateManifest } = require("./skill_registry") as typeof import("./skill_registry");
      const result = validateManifest({
        name: "skill",
        version: "1.0.0",
        description: "desc",
        requiredEnv: [],
        allowedDomains: [],
        actions: [{
          name: "doThing",
          description: "",
          params: [],
        }],
      });
      assert.equal(result.valid, true, "Empty description is valid but discouraged");
      assert.ok(result.warnings.length > 0, "Should warn about empty action description");
      assert.ok(result.warnings.some((w: string) => w.includes("description")), "Warning should mention description");
    });
  });

  // ── registerValidated ───────────────────────────────────────────────

  describe.describe("registerValidated", () => {
    describe.it("registers valid skills and returns true", () => {
      const registry = new SkillRegistry();
      const result = registry.registerValidated(createTestSkill());
      assert.equal(result, true);
      assert.equal(registry.has("test-skill"), true);
    });

    describe.it("skips invalid skills and returns false", () => {
      const registry = new SkillRegistry();
      const badSkill: import("./skill").Skill = {
        manifest: { name: "", version: "1.0.0", description: "", requiredEnv: [], allowedDomains: [] },
        setup: async () => {},
        execute: async () => ({}),
        teardown: async () => {},
        healthCheck: async () => ({ healthy: true }),
      };
      const result = registry.registerValidated(badSkill);
      assert.equal(result, false);
      assert.equal(registry.has(""), false);
    });
  });

  // ── validateSkillManifest ────────────────────────────────────────────

  describe.describe("validateSkillManifest", () => {
    describe.it("validates a registered skill by name", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill());
      const result = registry.validateSkillManifest("test-skill");
      assert.equal(result.valid, true);
    });

    describe.it("validates a raw manifest object", () => {
      const registry = new SkillRegistry();
      const result = registry.validateSkillManifest({
        name: "raw-skill",
        version: "1.0.0",
        description: "Raw",
        requiredEnv: [],
        allowedDomains: [],
      });
      assert.equal(result.valid, true);
    });

    describe.it("returns error for unregistered skill name", () => {
      const registry = new SkillRegistry();
      const result = registry.validateSkillManifest("nonexistent");
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("not registered")));
    });
  });

  // ── getActions / getDirPath ─────────────────────────────────────────

  describe.describe("getActions", () => {
    describe.it("returns actions from a skill manifest", () => {
      const registry = new SkillRegistry();
      const skill: import("./skill").Skill = {
        manifest: {
          name: "actioned",
          version: "1.0.0",
          description: "Has actions",
          requiredEnv: [],
          allowedDomains: [],
          actions: [
            { name: "doA", description: "Do A", params: [] },
            { name: "doB", description: "Do B", params: [{ name: "x", type: "string", required: true }] },
          ],
        },
        setup: async () => {},
        execute: async () => ({}),
        teardown: async () => {},
        healthCheck: async () => ({ healthy: true }),
      };
      registry.register(skill);
      const actions = registry.getActions("actioned");
      assert.equal(actions.length, 2);
      assert.equal(actions[0].name, "doA");
      assert.equal(actions[1].name, "doB");
    });

    describe.it("returns empty array for skill without actions", () => {
      const registry = new SkillRegistry();
      registry.register(createTestSkill());
      assert.deepEqual(registry.getActions("test-skill"), []);
    });

    describe.it("returns empty array for unknown skill", () => {
      const registry = new SkillRegistry();
      assert.deepEqual(registry.getActions("unknown"), []);
    });
  });

  // ── saveState / restoreState Round-Trip ──────────────────────────────

  describe.describe("lifecycle persistence round-trip", () => {
    describe.it("saveState and restoreState round-trip preserves state", () => {
      const savedState = { lastAction: "publish", step: 3, mode: "batch" };
      let restoredState: Record<string, unknown> | null = null;

      const skill: import("./skill").Skill = {
        manifest: {
          name: "stateful-skill",
          version: "1.0.0",
          description: "A skill with state persistence",
          requiredEnv: [],
          allowedDomains: [],
        },
        setup: async () => {},
        execute: async () => ({ success: true }),
        teardown: async () => {},
        healthCheck: async () => ({ healthy: true }),
        saveState: () => savedState,
        restoreState: (state) => { restoredState = state; },
      };

      // Simulate what the daemon does: save state, then restore it
      const serialized = skill.saveState!();
      assert.deepEqual(serialized, savedState);

      // Simulate restore (as daemon does on startup)
      skill.restoreState!(serialized);
      assert.deepEqual(restoredState, savedState);
    });

    describe.it("skills without saveState/restoreState are safe", () => {
      const skill: import("./skill").Skill = {
        manifest: {
          name: "stateless-skill",
          version: "1.0.0",
          description: "A skill without persistence hooks",
          requiredEnv: [],
          allowedDomains: [],
        },
        setup: async () => {},
        execute: async () => ({ success: true }),
        teardown: async () => {},
        healthCheck: async () => ({ healthy: true }),
      };

      // Optional hooks should be undefined, not cause errors
      assert.equal(skill.saveState, undefined);
      assert.equal(skill.restoreState, undefined);
      assert.equal(skill.onPause, undefined);
      assert.equal(skill.onResume, undefined);
      assert.equal(skill.onError, undefined);
    });
  });

  // ── installSkill / removeSkill Filesystem ────────────────────────────

  describe.describe("installSkill and removeSkill", () => {
    describe.it("installSkill copies a packaged skill directory", () => {
      const registry = new SkillRegistry();
      const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), "skill-install-src-"));
      const tempTarget = fs.mkdtempSync(path.join(os.tmpdir(), "skill-install-dst-"));

      try {
        // Create a packaged skill in the source dir
        fs.writeFileSync(path.join(tempSource, "skill.yaml"), [
          "name: installable-skill",
          "version: 1.0.0",
          "description: Can be installed",
          "requiredEnv: []",
          "allowedDomains: []",
        ].join("\n"));
        fs.writeFileSync(path.join(tempSource, "index.ts"), "// entry");
        fs.writeFileSync(path.join(tempSource, "README.md"), "# Installable Skill");

        const result = registry.installSkill(tempSource, tempTarget);
        assert.equal(result.success, true);
        assert.equal(result.name, "installable-skill");

        // Verify the directory was copied
        const installedDir = path.join(tempTarget, "installable-skill");
        assert.ok(fs.existsSync(installedDir), "Installed directory should exist");
        assert.ok(fs.existsSync(path.join(installedDir, "skill.yaml")), "skill.yaml should be copied");
        assert.ok(fs.existsSync(path.join(installedDir, "index.ts")), "index.ts should be copied");
        assert.ok(fs.existsSync(path.join(installedDir, "README.md")), "README.md should be copied");
      } finally {
        fs.rmSync(tempSource, { recursive: true, force: true });
        fs.rmSync(tempTarget, { recursive: true, force: true });
      }
    });

    describe.it("installSkill rejects non-packaged directories", () => {
      const registry = new SkillRegistry();
      const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), "skill-install-nopkg-"));
      const tempTarget = fs.mkdtempSync(path.join(os.tmpdir(), "skill-install-dst2-"));

      try {
        // No skill.yaml in source
        const result = registry.installSkill(tempSource, tempTarget);
        assert.equal(result.success, false);
        assert.ok(result.error?.includes("not a packaged skill"));
      } finally {
        fs.rmSync(tempSource, { recursive: true, force: true });
        fs.rmSync(tempTarget, { recursive: true, force: true });
      }
    });

    describe.it("installSkill rejects invalid manifest", () => {
      const registry = new SkillRegistry();
      const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), "skill-install-bad-"));
      const tempTarget = fs.mkdtempSync(path.join(os.tmpdir(), "skill-install-dst3-"));

      try {
        fs.writeFileSync(path.join(tempSource, "skill.yaml"), [
          "name: \"\"",
          "version: 1.0.0",
          "description: Bad skill",
          "requiredEnv: []",
          "allowedDomains: []",
        ].join("\n"));

        const result = registry.installSkill(tempSource, tempTarget);
        assert.equal(result.success, false);
        assert.ok(result.error?.includes("Manifest validation failed"));
      } finally {
        fs.rmSync(tempSource, { recursive: true, force: true });
        fs.rmSync(tempTarget, { recursive: true, force: true });
      }
    });

    describe.it("removeSkill deletes the skill directory and unregisters", () => {
      const registry = new SkillRegistry();
      const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), "skill-remove-src-"));
      const tempTarget = fs.mkdtempSync(path.join(os.tmpdir(), "skill-remove-dst-"));

      try {
        // Install first
        fs.writeFileSync(path.join(tempSource, "skill.yaml"), [
          "name: removable-skill",
          "version: 1.0.0",
          "description: Can be removed",
          "requiredEnv: []",
          "allowedDomains: []",
        ].join("\n"));
        fs.writeFileSync(path.join(tempSource, "index.ts"), "// entry");

        const installResult = registry.installSkill(tempSource, tempTarget);
        assert.equal(installResult.success, true);

        // Manually register the skill so removeSkill can unregister it
        registry.register({
          manifest: {
            name: "removable-skill",
            version: "1.0.0",
            description: "Can be removed",
            requiredEnv: [],
            allowedDomains: [],
          },
          setup: async () => {},
          execute: async () => ({ success: true }),
          teardown: async () => {},
          healthCheck: async () => ({ healthy: true }),
        });

        // Set the dirPath like loadPackagedSkill would
        const entry = (registry as unknown as { entries: Map<string, { dirPath?: string }> }).entries.get("removable-skill");
        if (entry) entry.dirPath = path.join(tempTarget, "removable-skill");

        const removeResult = registry.removeSkill("removable-skill", tempTarget);
        assert.equal(removeResult.success, true);
        assert.equal(registry.has("removable-skill"), false, "Skill should be unregistered");
        assert.ok(!fs.existsSync(path.join(tempTarget, "removable-skill")), "Directory should be deleted");
      } finally {
        fs.rmSync(tempSource, { recursive: true, force: true });
        fs.rmSync(tempTarget, { recursive: true, force: true });
      }
    });

    describe.it("removeSkill returns error for non-existent directory", () => {
      const registry = new SkillRegistry();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-remove-noexist-"));

      try {
        const result = registry.removeSkill("ghost-skill", tempDir);
        assert.equal(result.success, false);
        assert.ok(result.error?.includes("not found"));
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  // ── Backward Compatibility ───────────────────────────────────────────

  describe.describe("backward compatibility", () => {
    describe.it("flat .ts skills without actions still load and execute", async () => {
      const registry = new SkillRegistry();
      const skill: import("./skill").Skill = {
        manifest: {
          name: "legacy",
          version: "0.1.0",
          description: "Old-school skill without actions or lifecycle hooks",
          requiredEnv: [],
          allowedDomains: [],
        },
        setup: async () => {},
        execute: async (action, params) => ({ action, ...params }),
        teardown: async () => {},
        healthCheck: async () => ({ healthy: true }),
      };
      registry.register(skill);

      // Should work without any optional fields
      const result = await registry.execute("legacy", "doStuff", { key: "val" });
      assert.equal(result.action, "doStuff");
      assert.equal((result as Record<string, unknown>).key, "val");

      // Actions should be empty but not break anything
      assert.deepEqual(registry.getActions("legacy"), []);
    });

    describe.it("built-in skills load successfully and have actions", async () => {
      const registry = new SkillRegistry();
      await registry.loadFromDirectory("./skills");

      // Check each built-in skill has actions defined
      for (const name of registry.listNames()) {
        const actions = registry.getActions(name);
        assert.ok(actions.length > 0, `Built-in skill "${name}" should have actions defined`);
      }
    });
  });
});
