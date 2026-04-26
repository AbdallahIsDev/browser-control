import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseSimpleYaml,
  yamlToManifest,
  isPackagedSkillDir,
  loadPackagedSkillDir,
} from "../../skill_yaml";
import type { SkillYaml } from "../../skill_yaml";

// ── YAML Parsing ────────────────────────────────────────────────────

test("parseSimpleYaml parses flat key-value pairs", () => {
  const result = parseSimpleYaml(`
name: my-skill
version: 1.0.0
description: A test skill
author: test-author
`);
  assert.equal(result.name, "my-skill");
  assert.equal(result.version, "1.0.0");
  assert.equal(result.description, "A test skill");
  assert.equal(result.author, "test-author");
});

test("parseSimpleYaml parses booleans and nulls", () => {
  const result = parseSimpleYaml(`
enabled: true
disabled: false
empty: null
tilde: ~
`);
  assert.equal(result.enabled, true);
  assert.equal(result.disabled, false);
  assert.equal(result.empty, null);
  assert.equal(result.tilde, null);
});

test("parseSimpleYaml parses numbers", () => {
  const result = parseSimpleYaml(`
count: 42
ratio: 3.14
negative: -7
`);
  assert.equal(result.count, 42);
  assert.equal(result.ratio, 3.14);
  assert.equal(result.negative, -7);
});

test("parseSimpleYaml parses quoted strings", () => {
  const result = parseSimpleYaml(`
name1: "hello world"
name2: 'single quotes'
`);
  assert.equal(result.name1, "hello world");
  assert.equal(result.name2, "single quotes");
});

test("parseSimpleYaml parses inline arrays", () => {
  const result = parseSimpleYaml(`
domains: [example.com, test.com]
env: [KEY1, KEY2]
empty: []
`);
  assert.deepEqual(result.domains, ["example.com", "test.com"]);
  assert.deepEqual(result.env, ["KEY1", "KEY2"]);
  assert.deepEqual(result.empty, []);
});

test("parseSimpleYaml strips inline comments", () => {
  const result = parseSimpleYaml(`
name: my-skill # this is a comment
version: 2.0.0
`);
  assert.equal(result.name, "my-skill");
  assert.equal(result.version, "2.0.0");
});

test("parseSimpleYaml handles empty input", () => {
  const result = parseSimpleYaml("");
  assert.deepEqual(result, {});
});

test("parseSimpleYaml handles comment-only lines", () => {
  const result = parseSimpleYaml(`
# This is a comment
name: test
`);
  assert.equal(result.name, "test");
});

// ── yamlToManifest ──────────────────────────────────────────────────

test("yamlToManifest converts a SkillYaml to a SkillManifest", () => {
  const yaml: SkillYaml = {
    name: "my-skill",
    version: "1.0.0",
    description: "A test skill",
    author: "test-author",
    requiredEnv: ["API_KEY"],
    allowedDomains: ["example.com"],
    requiresFreshPage: true,
    configSchema: "config.schema.json",
  };

  const manifest = yamlToManifest(yaml);
  assert.equal(manifest.name, "my-skill");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.description, "A test skill");
  assert.equal(manifest.author, "test-author");
  assert.deepEqual(manifest.requiredEnv, ["API_KEY"]);
  assert.deepEqual(manifest.allowedDomains, ["example.com"]);
  assert.equal(manifest.requiresFreshPage, true);
  assert.equal(manifest.configSchema, "config.schema.json");
});

test("yamlToManifest converts actions with params", () => {
  const yaml: SkillYaml = {
    name: "action-skill",
    version: "2.0.0",
    description: "Skill with actions",
    actions: [
      {
        name: "doThing",
        description: "Do a thing",
        params: [
          { name: "count", type: "number", required: true, description: "How many" },
          { name: "label", type: "string", required: false },
        ],
      },
    ],
  };

  const manifest = yamlToManifest(yaml);
  assert.equal(manifest.actions?.length, 1);
  assert.equal(manifest.actions![0].name, "doThing");
  assert.equal(manifest.actions![0].params.length, 2);
  assert.equal(manifest.actions![0].params[0].type, "number");
  assert.equal(manifest.actions![0].params[0].required, true);
  assert.equal(manifest.actions![0].params[1].required, false);
});

test("yamlToManifest handles missing/empty fields with defaults", () => {
  const yaml: SkillYaml = {};
  const manifest = yamlToManifest(yaml);
  assert.equal(manifest.name, "");
  assert.equal(manifest.version, "0.0.0");
  assert.equal(manifest.description, "");
  assert.deepEqual(manifest.requiredEnv, []);
  assert.deepEqual(manifest.allowedDomains, []);
  assert.equal(manifest.actions, undefined);
  assert.equal(manifest.requiresFreshPage, undefined);
  assert.equal(manifest.configSchema, undefined);
});

// ── Packaged Skill Directory ────────────────────────────────────────

test("isPackagedSkillDir returns true for directory with skill.yaml", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-yaml-test-"));
  try {
    fs.writeFileSync(path.join(tempDir, "skill.yaml"), "name: test-skill\nversion: 1.0.0\n");
    assert.equal(isPackagedSkillDir(tempDir), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("isPackagedSkillDir returns false for directory without skill.yaml", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-yaml-test-"));
  try {
    assert.equal(isPackagedSkillDir(tempDir), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadPackagedSkillDir loads manifest from skill.yaml", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-yaml-test-"));
  try {
    fs.writeFileSync(path.join(tempDir, "skill.yaml"), [
      "name: packaged-test",
      "version: 2.0.0",
      "description: A packaged test skill",
      "requiredEnv: [API_KEY]",
      "allowedDomains: [example.com]",
      "requiresFreshPage: true",
    ].join("\n"));
    fs.writeFileSync(path.join(tempDir, "index.ts"), "// skill entry");

    const meta = loadPackagedSkillDir(tempDir);
    assert.ok(meta, "Should load packaged skill");
    assert.equal(meta!.manifest.name, "packaged-test");
    assert.equal(meta!.manifest.version, "2.0.0");
    assert.equal(meta!.manifest.description, "A packaged test skill");
    assert.deepEqual(meta!.manifest.requiredEnv, ["API_KEY"]);
    assert.equal(meta!.manifest.requiresFreshPage, true);
    assert.equal(meta!.entryPath, path.join(tempDir, "index.ts"));
    assert.equal(meta!.dirPath, path.resolve(tempDir));
    assert.equal(meta!.hasConfigSchema, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadPackagedSkillDir returns null for directory without skill.yaml", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-yaml-test-"));
  try {
    assert.equal(loadPackagedSkillDir(tempDir), null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadPackagedSkillDir uses custom entry path from skill.yaml", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-yaml-test-"));
  try {
    fs.writeFileSync(path.join(tempDir, "skill.yaml"), [
      "name: custom-entry",
      "version: 1.0.0",
      "description: Custom entry",
      "entry: src/main.ts",
      "requiredEnv: []",
      "allowedDomains: []",
    ].join("\n"));

    const meta = loadPackagedSkillDir(tempDir);
    assert.ok(meta);
    assert.equal(meta!.entryPath, path.join(tempDir, "src", "main.ts"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadPackagedSkillDir detects config schema file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-yaml-test-"));
  try {
    fs.writeFileSync(path.join(tempDir, "skill.yaml"), [
      "name: config-schema-skill",
      "version: 1.0.0",
      "description: Has config",
      "configSchema: config.schema.json",
      "requiredEnv: []",
      "allowedDomains: []",
    ].join("\n"));
    fs.writeFileSync(path.join(tempDir, "config.schema.json"), JSON.stringify({
      type: "object",
      properties: { theme: { type: "string" } },
    }));

    const meta = loadPackagedSkillDir(tempDir);
    assert.ok(meta);
    assert.equal(meta!.manifest.configSchema, "config.schema.json");
    assert.equal(meta!.hasConfigSchema, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadPackagedSkillDir reports hasConfigSchema=false when schema file is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-yaml-test-"));
  try {
    fs.writeFileSync(path.join(tempDir, "skill.yaml"), [
      "name: missing-schema-skill",
      "version: 1.0.0",
      "description: No schema file",
      "configSchema: config.schema.json",
      "requiredEnv: []",
      "allowedDomains: []",
    ].join("\n"));

    const meta = loadPackagedSkillDir(tempDir);
    assert.ok(meta);
    assert.equal(meta!.hasConfigSchema, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadPackagedSkillDir parses actions with multi-field list items from skill.yaml", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-yaml-test-"));
  try {
    // Write a skill.yaml with nested actions (multi-field list items)
    const yamlContent = [
      "name: action-skill",
      "version: 1.0.0",
      "description: Skill with actions",
      "requiredEnv: []",
      "allowedDomains: []",
      "actions:",
      "  - name: doThing",
      "    description: Do a thing",
      "    params:",
      "      - name: count",
      "        type: number",
      "        required: true",
      "        description: How many",
      "  - name: getStatus",
      "    description: Get the status",
    ].join("\n");
    fs.writeFileSync(path.join(tempDir, "skill.yaml"), yamlContent);

    const meta = loadPackagedSkillDir(tempDir);
    assert.ok(meta, "Should load packaged skill with actions");
    assert.equal(meta!.manifest.name, "action-skill");
    assert.ok(meta!.manifest.actions, "Should have actions");
    assert.equal(meta!.manifest.actions!.length, 2, "Should have 2 actions");

    // First action
    const action1 = meta!.manifest.actions![0];
    assert.equal(action1.name, "doThing");
    assert.equal(action1.description, "Do a thing");
    assert.ok(action1.params, "doThing should have params");
    assert.equal(action1.params.length, 1, "doThing should have 1 param");
    assert.equal(action1.params[0].name, "count");
    assert.equal(action1.params[0].type, "number");
    assert.equal(action1.params[0].required, true);
    assert.equal(action1.params[0].description, "How many");

    // Second action
    const action2 = meta!.manifest.actions![1];
    assert.equal(action2.name, "getStatus");
    assert.equal(action2.description, "Get the status");
    assert.equal(action2.params.length, 0, "getStatus should have no params");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("parseSimpleYaml handles empty-valued keys without producing arrays", () => {
  // A key with no following list items should stay as {}, not []
  const result = parseSimpleYaml(`
name: test
actions:
version: 1.0.0
`);
  assert.equal(result.name, "test");
  assert.equal(result.version, "1.0.0");
  // actions: had no list items — should be {} not []
  assert.deepEqual(result.actions, {});
});
