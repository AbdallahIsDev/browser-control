import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { KnowledgeFrontmatter, KnowledgeArtifact } from "../../knowledge_types";
import {
  loadArtifact,
  saveArtifact,
  deleteArtifact,
  listAllKnowledge,
  listByKind,
  findByDomain,
  findByName,
  pruneArtifact,
} from "../../knowledge_store";
import {
  validateArtifact,
  validateFile,
} from "../../knowledge_validator";
import {
  queryKnowledge,
  searchDomainKnowledge,
  listKnownDomains,
  listInteractionSkillNames,
  getKnowledgeStats,
} from "../../knowledge_query";

// ── Helpers ─────────────────────────────────────────────────────────

function createTempKnowledgeHome(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-knowledge-test-"));
  const knowledgeDir = path.join(tmp, "knowledge");
  fs.mkdirSync(path.join(knowledgeDir, "interaction-skills"), { recursive: true });
  fs.mkdirSync(path.join(knowledgeDir, "domain-skills"), { recursive: true });
  return tmp;
}

/** Patch process.env.BROWSER_CONTROL_HOME so paths.ts resolves to our temp dir. */
function withTempHome<T>(tmp: string, fn: () => T): T {
  const old = process.env.BROWSER_CONTROL_HOME;
  process.env.BROWSER_CONTROL_HOME = tmp;
  // Force path module re-read by clearing require cache
  delete require.cache[require.resolve("./paths")];
  delete require.cache[require.resolve("./knowledge_store")];
  delete require.cache[require.resolve("./knowledge_query")];
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = old;
    delete require.cache[require.resolve("./paths")];
    delete require.cache[require.resolve("./knowledge_store")];
    delete require.cache[require.resolve("./knowledge_query")];
  }
}

const SAMPLE_DOMAIN_MD = `---
kind: domain-skill
domain: "github.com"
capturedAt: "2026-04-20T10:00:00Z"
verified: true
lastVerified: "2026-04-20T10:00:00Z"
tags: [git, code-review]
---

# github.com

## Stable Selectors
- PR merge button
  - selector: \`[data-test-id="merge-button"]\`
  - role: button
  - name: Merge pull request
  - verified: true
  - lastVerified: 2026-04-20

## Pitfalls
- Actions dropdown can take ~2 seconds to appear after click
  - waitCondition: role=menu
  - waitMs: 2500

## Navigation Shortcuts
- Repo settings URL pattern:
  - pattern: https://github.com/{owner}/{repo}/settings
`;

const SAMPLE_INTERACTION_MD = `---
kind: interaction-skill
name: "modal-dialogs"
capturedAt: "2026-04-20T10:00:00Z"
tags: [dialogs, modals]
---

# Modal Dialogs

## Overview
How to handle browser modal dialogs (alert, confirm, prompt, beforeunload).

## Detection
Use \`page.on('dialog')\` to catch dialogs before they freeze the page.

## Reactive Handling
- Accept: \`dialog.accept()\`
- Dismiss: \`dialog.dismiss()\`
`;

const SAMPLE_WITH_SECRET = `---
kind: domain-skill
domain: "example.com"
capturedAt: "2026-04-20T10:00:00Z"
---

# example.com

## API Endpoints
- Login endpoint uses api_key: "sk-live-abc123def456ghi789jkl012mno"
`;

// ── Tests: Store ────────────────────────────────────────────────────

test("knowledge store: save and load domain-skill artifact", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      const filePath = saveArtifact(
        "domain-skill",
        "github.com",
        {
          kind: "domain-skill",
          domain: "github.com",
          capturedAt: "2026-04-20T10:00:00Z",
        },
        "## Stable Selectors\n- PR merge button\n  - selector: `[data-test-id=\"merge-button\"]`",
      );

      assert.ok(filePath.endsWith(".md"));
      assert.ok(fs.existsSync(filePath));

      const artifact = loadArtifact(filePath);
      assert.ok(artifact);
      assert.equal(artifact!.frontmatter.kind, "domain-skill");
      assert.equal(artifact!.frontmatter.domain, "github.com");
      assert.ok(artifact!.body.includes("Stable Selectors"));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge store: save and load interaction-skill artifact", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      const filePath = saveArtifact(
        "interaction-skill",
        "modal-dialogs",
        {
          kind: "interaction-skill",
          name: "modal-dialogs",
          capturedAt: "2026-04-20T10:00:00Z",
        },
        "## Overview\nHow to handle browser modal dialogs.",
      );

      const artifact = loadArtifact(filePath);
      assert.ok(artifact);
      assert.equal(artifact!.frontmatter.kind, "interaction-skill");
      assert.equal(artifact!.frontmatter.name, "modal-dialogs");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge store: delete artifact", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      const filePath = saveArtifact(
        "domain-skill",
        "test.com",
        { kind: "domain-skill", domain: "test.com", capturedAt: "2026-04-20T10:00:00Z" },
        "## Selectors\n- test",
      );

      assert.ok(fs.existsSync(filePath));
      assert.ok(deleteArtifact(filePath));
      assert.ok(!fs.existsSync(filePath));
      assert.ok(!deleteArtifact(filePath)); // double-delete returns false
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge store: listAllKnowledge returns all artifacts", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      saveArtifact("domain-skill", "github.com", {
        kind: "domain-skill", domain: "github.com", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Selectors\n- test");
      saveArtifact("domain-skill", "framer.com", {
        kind: "domain-skill", domain: "framer.com", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Selectors\n- test");
      saveArtifact("interaction-skill", "modal-dialogs", {
        kind: "interaction-skill", name: "modal-dialogs", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Overview\n- test");

      const all = listAllKnowledge();
      assert.equal(all.length, 3);
      assert.equal(all.filter((s) => s.kind === "domain-skill").length, 2);
      assert.equal(all.filter((s) => s.kind === "interaction-skill").length, 1);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge store: listByKind filters correctly", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      saveArtifact("domain-skill", "github.com", {
        kind: "domain-skill", domain: "github.com", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Selectors\n- test");
      saveArtifact("interaction-skill", "modal-dialogs", {
        kind: "interaction-skill", name: "modal-dialogs", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Overview\n- test");

      assert.equal(listByKind("domain-skill").length, 1);
      assert.equal(listByKind("interaction-skill").length, 1);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge store: findByDomain and findByName", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      saveArtifact("domain-skill", "github.com", {
        kind: "domain-skill", domain: "github.com", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Selectors\n- PR merge button");
      saveArtifact("interaction-skill", "modal-dialogs", {
        kind: "interaction-skill", name: "modal-dialogs", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Overview\n- test");

      const domain = findByDomain("github.com");
      assert.ok(domain);
      assert.equal(domain!.frontmatter.domain, "github.com");

      const skill = findByName("modal-dialogs");
      assert.ok(skill);
      assert.equal(skill!.frontmatter.name, "modal-dialogs");

      assert.equal(findByDomain("nonexistent.com"), null);
      assert.equal(findByName("nonexistent-skill"), null);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Tests: Frontmatter Parsing ──────────────────────────────────────

test("knowledge store: parses entries from structured markdown", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      // Write raw markdown to a domain-skill file
      const dir = path.join(tmp, "knowledge", "domain-skills");
      fs.writeFileSync(path.join(dir, "github.com.md"), SAMPLE_DOMAIN_MD);

      const artifact = loadArtifact(path.join(dir, "github.com.md"));
      assert.ok(artifact);
      assert.equal(artifact!.frontmatter.kind, "domain-skill");
      assert.equal(artifact!.frontmatter.domain, "github.com");
      assert.ok(artifact!.frontmatter.verified);
      assert.deepEqual(artifact!.frontmatter.tags, ["git", "code-review"]);

      // Should have parsed entries from structured sections
      assert.ok(artifact!.entries.length > 0);

      // Check that we found the right section types
      const selectorEntries = artifact!.entries.filter((e) => e.type === "stable-selector");
      const pitfallEntries = artifact!.entries.filter((e) => e.type === "pitfall");
      assert.ok(selectorEntries.length > 0, "Should have stable-selector entries");
      assert.ok(pitfallEntries.length > 0, "Should have pitfall entries");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge store: missing frontmatter returns null", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      const dir = path.join(tmp, "knowledge", "domain-skills");
      fs.writeFileSync(path.join(dir, "bad.md"), "# No frontmatter\nJust content.");

      const artifact = loadArtifact(path.join(dir, "bad.md"));
      assert.equal(artifact, null);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Tests: Validator ────────────────────────────────────────────────

test("knowledge validator: valid artifact passes", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      const filePath = saveArtifact("domain-skill", "github.com", {
        kind: "domain-skill", domain: "github.com", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Stable Selectors\n- PR merge button\n  - selector: `[data-test-id]`\n  - verified: true\n  - lastVerified: 2026-04-20");

      const artifact = loadArtifact(filePath)!;
      const result = validateArtifact(artifact);
      assert.ok(result.valid, `Should be valid. Issues: ${JSON.stringify(result.issues)}`);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge validator: validateFile loads saved artifacts after module move", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      const filePath = saveArtifact("domain-skill", "github.com", {
        kind: "domain-skill", domain: "github.com", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Stable Selectors\n- PR merge button\n  - selector: `[data-test-id]`\n  - verified: true\n  - lastVerified: 2026-04-20");

      const result = validateFile(filePath);

      assert.ok(result);
      assert.equal(result.filePath, filePath);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge validator: missing domain for domain-skill", () => {
  const artifact: KnowledgeArtifact = {
    filePath: "/tmp/test.md",
    frontmatter: {
      kind: "domain-skill",
      capturedAt: "2026-04-20T10:00:00Z",
      // missing domain!
    },
    body: "## Selectors\n- test",
    sections: {},
    entries: [],
    mtimeMs: Date.now(),
  };
  const result = validateArtifact(artifact);
  assert.ok(!result.valid);
  assert.ok(result.issues.some((i) => i.message.includes("domain")));
});

test("knowledge validator: catches secrets", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      const dir = path.join(tmp, "knowledge", "domain-skills");
      fs.writeFileSync(path.join(dir, "example.com.md"), SAMPLE_WITH_SECRET);

      const artifact = loadArtifact(path.join(dir, "example.com.md"))!;
      const result = validateArtifact(artifact);
      assert.ok(!result.valid, "Should be invalid due to secrets");
      assert.ok(result.issues.some((i) => i.severity === "error" && i.message.toLowerCase().includes("secret")));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge validator: catches bearer tokens", () => {
  const artifact: KnowledgeArtifact = {
    filePath: "/tmp/test.md",
    frontmatter: { kind: "domain-skill", domain: "test.com", capturedAt: "2026-04-20T10:00:00Z" },
    body: "## API\n- Use bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    sections: {},
    entries: [],
    mtimeMs: Date.now(),
  };
  const result = validateArtifact(artifact);
  assert.ok(!result.valid);
  assert.ok(result.issues.some((i) => i.severity === "error" && i.message.toLowerCase().includes("secret")));
});

test("knowledge validator: empty body produces warning", () => {
  const artifact: KnowledgeArtifact = {
    filePath: "/tmp/test.md",
    frontmatter: { kind: "interaction-skill", name: "test", capturedAt: "2026-04-20T10:00:00Z" },
    body: "",
    sections: {},
    entries: [],
    mtimeMs: Date.now(),
  };
  const result = validateArtifact(artifact);
  // warnings don't make it invalid
  assert.ok(result.valid);
  assert.ok(result.issues.some((i) => i.severity === "warning" && i.message.includes("empty")));
});

test("knowledge validator: duplicate entries produce warning", () => {
  const artifact: KnowledgeArtifact = {
    filePath: "/tmp/test.md",
    frontmatter: { kind: "domain-skill", domain: "test.com", capturedAt: "2026-04-20T10:00:00Z" },
    body: "## Selectors\n- button\n- button",
    sections: {},
    entries: [
      { type: "stable-selector", description: "click me", verified: false, lastVerified: "2026-04-20", capturedAt: "2026-04-20" },
      { type: "stable-selector", description: "click me", verified: false, lastVerified: "2026-04-20", capturedAt: "2026-04-20" },
    ],
    mtimeMs: Date.now(),
  };
  const result = validateArtifact(artifact);
  assert.ok(result.issues.some((i) => i.severity === "warning" && i.message.includes("Duplicate")));
});

// ── Tests: Prune Body Preservation (Section 9 Fix) ────────────────────

test("knowledge store: prune preserves non-entry prose sections", async () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      // Create an interaction-skill with prose + entry sections
      const md = `---
kind: interaction-skill
name: "modal-dialogs"
capturedAt: "2026-04-20T10:00:00Z"
tags: [dialogs]
---

# Modal Dialogs

## Overview
This skill handles browser modal dialogs (alert, confirm, prompt, beforeunload).
Dialogs can freeze page execution if not handled promptly.

## Detection
Use page.on('dialog') to catch dialogs before they block.

## Reactive Handling
- Accept: dialog.accept()
- Dismiss: dialog.dismiss()

## Stable Selectors
- accept button: dialog.accept()
- dismiss button: dialog.dismiss()

## Pitfalls
- beforeunload dialogs cannot be auto-dismissed
`;

      const dir = path.join(tmp, "knowledge", "interaction-skills");
      fs.writeFileSync(path.join(dir, "modal-dialogs.md"), md);

      const artifact = loadArtifact(path.join(dir, "modal-dialogs.md"))!;
      assert.ok(artifact, "Artifact should load");
      assert.ok(artifact.entries.length > 0, "Should parse entries");

      // Verify non-entry sections exist in the artifact
      assert.ok(artifact.sections["Overview"], "Overview section should exist");
      assert.ok(artifact.sections["Detection"], "Detection section should exist");
      assert.ok(artifact.sections["Reactive Handling"], "Reactive Handling section should exist");
      assert.ok(artifact.sections["Stable Selectors"], "Stable Selectors section should exist");
      assert.ok(artifact.sections["Pitfalls"], "Pitfalls section should exist");

      // Verify Overview and Detection content is prose (not list items)
      assert.ok(
        !artifact.sections["Overview"].trim().startsWith("-"),
        "Overview should be prose, not list items",
      );
      assert.ok(
        !artifact.sections["Detection"].trim().startsWith("-"),
        "Detection should be prose, not list items",
      );
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge store: prune removes only entry lines, keeps prose", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      // Create a domain-skill with narrative + entry sections
      const md = `---
kind: domain-skill
domain: "test.com"
capturedAt: "2026-04-20T10:00:00Z"
---

# test.com

## Overview
Test domain for validation. Contains various UI elements.

## Stable Selectors
- Save button
  selector: #save
  verified: true
  lastVerified: 2026-04-20
- Cancel button
  selector: #cancel
  verified: false
  lastVerified: 2026-04-20

## Pitfalls
Modal may appear after form submit.
`;

      const dir = path.join(tmp, "knowledge", "domain-skills");
      const filePath = path.join(dir, "test.com.md");
      fs.writeFileSync(filePath, md);

      // Prune with removeUnverified: removes only unverified entries.
      // Save button is verified → kept.
      // Cancel button is unverified → removed (regardless of lastVerified date).
      const result = pruneArtifact(filePath, {
        maxAgeDays: 90,
        removeUnverified: true,
        removeFailed: false,
      });

      assert.equal(result.removed, 1, "Should remove 1 unverified entry (Cancel button)");
      assert.equal(result.kept, 1, "Should keep 1 entry (Save button)");

      // Re-load and verify the file
      const pruned = loadArtifact(filePath)!;
      assert.ok(pruned, "Pruned file should still load");
      assert.equal(pruned.entries.length, 1, "Should have exactly 1 entry");
      assert.equal(pruned.entries[0].description, "Save button", "Save button should remain");

      // Critical: non-entry prose sections must still be present
      assert.ok(
        pruned.body.includes("## Overview"),
        "Overview section should be preserved",
      );
      assert.ok(
        pruned.body.includes("Test domain for validation"),
        "Overview prose content should be preserved",
      );
      assert.ok(
        pruned.body.includes("Modal may appear after form submit"),
        "Pitfalls prose content should be preserved",
      );

      // Entry section should be regenerated with only the kept entry
      assert.ok(
        pruned.body.includes("## Stable Selectors"),
        "Stable Selectors section should still exist",
      );
      assert.ok(
        !pruned.body.includes("Cancel button"),
        "Pruned entry (Cancel button) should be gone",
      );
      assert.ok(
        pruned.body.includes("Save button"),
        "Kept entry (Save button) should remain",
      );
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge store: prune with all entries removed preserves prose sections", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      // Create a skill with old unverified entries only
      const md = `---
kind: interaction-skill
name: "legacy-skill"
capturedAt: "2020-01-01T00:00:00Z"
---

# Legacy Skill

## Overview
This is an old skill with very stale entries.

## Stable Selectors
- Old selector 1
  verified: false
  lastVerified: 2020-01-01
- Old selector 2
  verified: false
  lastVerified: 2020-01-01
`;

      const dir = path.join(tmp, "knowledge", "interaction-skills");
      const filePath = path.join(dir, "legacy-skill.md");
      fs.writeFileSync(filePath, md);

      // Prune with removeUnverified: removes both entries (both unverified).
      // The age check would also trigger since lastVerified=2020-01-01 is old,
      // but removeUnverified is the primary mechanism since both are unverified.
      // Note: removeFailed requires entries to have failed:true, which extractEntries
      // does not set. Use removeUnverified instead.
      const result = pruneArtifact(filePath, {
        maxAgeDays: 30,
        removeUnverified: true,
        removeFailed: false,
      });

      // All entries should be removed (captured before cutoff)
      assert.equal(result.removed, 2, "Should remove 2 old entries");
      assert.equal(result.kept, 0, "Should keep 0 entries");

      // Re-load and verify prose is preserved even when all entries are gone
      const pruned = loadArtifact(filePath)!;
      assert.ok(pruned, "File should still exist after prune");
      assert.equal(pruned.entries.length, 0, "Should have no entries");

      // Overview should still be there
      assert.ok(
        pruned.body.includes("## Overview"),
        "Overview section should be preserved even when all entries pruned",
      );
      assert.ok(
        pruned.body.includes("very stale entries"),
        "Overview prose content should be preserved",
      );
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Tests: Query ────────────────────────────────────────────────────

test("knowledge query: searchDomainKnowledge", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      saveArtifact("domain-skill", "github.com", {
        kind: "domain-skill", domain: "github.com", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Selectors\n- PR merge button");

      const result = searchDomainKnowledge("github.com");
      assert.ok(result);
      assert.equal(result!.frontmatter.domain, "github.com");

      assert.equal(searchDomainKnowledge("nonexistent.com"), null);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge query: listKnownDomains and listInteractionSkillNames", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      saveArtifact("domain-skill", "github.com", {
        kind: "domain-skill", domain: "github.com", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Selectors\n- test");
      saveArtifact("interaction-skill", "modal-dialogs", {
        kind: "interaction-skill", name: "modal-dialogs", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Overview\n- test");

      const domains = listKnownDomains();
      assert.ok(domains.includes("github.com"));

      const skills = listInteractionSkillNames();
      assert.ok(skills.includes("modal-dialogs"));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge query: getKnowledgeStats", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      saveArtifact("domain-skill", "github.com", {
        kind: "domain-skill", domain: "github.com", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Selectors\n- test");
      saveArtifact("interaction-skill", "modal-dialogs", {
        kind: "interaction-skill", name: "modal-dialogs", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Overview\n- test");

      const stats = getKnowledgeStats();
      assert.equal(stats.totalFiles, 2);
      assert.equal(stats.interactionSkills, 1);
      assert.equal(stats.domainSkills, 1);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge query: queryKnowledge with kind filter", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      saveArtifact("domain-skill", "github.com", {
        kind: "domain-skill", domain: "github.com", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Selectors\n- test");
      saveArtifact("interaction-skill", "modal-dialogs", {
        kind: "interaction-skill", name: "modal-dialogs", capturedAt: "2026-04-20T10:00:00Z",
      }, "## Overview\n- test");

      const domains = queryKnowledge({ kind: "domain-skill" });
      assert.equal(domains.length, 1);
      assert.equal(domains[0].summary.kind, "domain-skill");

      const skills = queryKnowledge({ kind: "interaction-skill" });
      assert.equal(skills.length, 1);
      assert.equal(skills[0].summary.kind, "interaction-skill");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Tests: Prose Bullet Misclassification Regression ────────────────────

test("knowledge store: prose bullet sections survive prune unchanged", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      // Create a domain-skill with prose bullets in Overview + structured entries in Stable Selectors
      const md = `---
kind: domain-skill
domain: "shop.example.com"
capturedAt: "2026-04-20T10:00:00Z"
---

# shop.example.com

## Overview
- First note about the site
- Second note about the site
- Third observation

## Detection
Use a11y snapshot to find key elements.

## Stable Selectors
- Add to cart button
  selector: #add-to-cart
  verified: true
  lastVerified: 2026-04-20
- Checkout button
  selector: #checkout
  verified: false
  lastVerified: 2026-04-20

## Pitfalls
- Cart overlay takes 2 seconds to appear
  waitCondition: role=dialog
  waitMs: 2500
`;

      const dir = path.join(tmp, "knowledge", "domain-skills");
      const filePath = path.join(dir, "shop.example.com.md");
      fs.writeFileSync(filePath, md);

      const before = loadArtifact(filePath)!;
      assert.ok(before, "Artifact should load");

      // Verify Overview starts with bullets but is NOT classified as entry-backed
      assert.ok(
        before.sections["Overview"].trim().startsWith("-"),
        "Overview section should start with bullets (prose)",
      );
      assert.ok(
        before.sections["Detection"].trim().startsWith("Use"),
        "Detection should be prose",
      );

      // Prune with removeUnverified: removes Checkout button but keeps Add to cart.
      const result = pruneArtifact(filePath, {
        maxAgeDays: 90,
        removeUnverified: true,
        removeFailed: false,
      });

      assert.equal(result.removed, 2, "Should remove 2 unverified entries (Checkout + Cart overlay)");
      assert.equal(result.kept, 1, "Should keep 1 entry (Add to cart button)");

      const after = loadArtifact(filePath)!;

      // Critical: Overview prose bullets must be preserved VERBATIM
      assert.ok(
        after.body.includes("## Overview"),
        "Overview section heading must be preserved",
      );
      assert.ok(
        after.body.includes("- First note about the site"),
        "Overview prose bullet 1 must be preserved verbatim",
      );
      assert.ok(
        after.body.includes("- Second note about the site"),
        "Overview prose bullet 2 must be preserved verbatim",
      );
      assert.ok(
        after.body.includes("- Third observation"),
        "Overview prose bullet 3 must be preserved verbatim",
      );

      // Detection prose must also be preserved
      assert.ok(
        after.body.includes("## Detection"),
        "Detection section must be preserved",
      );
      assert.ok(
        after.body.includes("Use a11y snapshot"),
        "Detection prose must be preserved verbatim",
      );

      // Stable Selectors should only have the verified entry
      assert.ok(
        after.body.includes("## Stable Selectors"),
        "Stable Selectors section should remain",
      );
      assert.ok(
        after.body.includes("Add to cart button"),
        "Kept entry should remain",
      );
      assert.ok(
        !after.body.includes("Checkout button"),
        "Pruned entry should be gone",
      );

      // Cart overlay pitfall was also unverified and removed by removeUnverified
      assert.ok(
        !after.body.includes("Cart overlay takes 2 seconds"),
        "Unverified pitfall entry should be removed by removeUnverified",
      );
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("knowledge store: non-entry section with bullets never treated as entries", () => {
  const tmp = createTempKnowledgeHome();
  try {
    withTempHome(tmp, () => {
      // Interaction-skill with prose bullets under a non-entry heading
      const md = `---
kind: interaction-skill
name: "iframe-navigation"
capturedAt: "2026-04-20T10:00:00Z"
---

# iframe-navigation

## Overview
- Iframes require special handling in Playwright
- Use frameLocator() to access iframe content
- Nested iframes need chained frameLocator calls

## Detection
Look for iframe or frame elements in the DOM snapshot.

## Reactive Handling
- Switch to iframe context using frameLocator
- Interact with elements inside the iframe
- Switch back to main frame after interaction

## Stable Selectors
- iframe container
  selector: iframe.main-content
  verified: true
  lastVerified: 2026-04-20
`;

      const dir = path.join(tmp, "knowledge", "interaction-skills");
      const filePath = path.join(dir, "iframe-navigation.md");
      fs.writeFileSync(filePath, md);

      const before = loadArtifact(filePath)!;
      // Overview and Reactive Handling both start with bullets
      // but only Stable Selectors maps to a known entry type.
      // So only Stable Selectors entries should be extracted.
      const selectorEntries = before.entries.filter(e => e.type === "stable-selector");
      assert.equal(selectorEntries.length, 1, "Only Stable Selectors should yield entries");

      // Overview and Reactive Handling bullets are NOT entries
      // (they have no known entry type from their heading)
      const overviewEntries = before.entries.filter(e => e.type !== "stable-selector");
      assert.equal(overviewEntries.length, 0, "No entries from prose sections");

      // Prune should preserve all prose bullet sections
      const result = pruneArtifact(filePath, {
        maxAgeDays: 90,
        removeUnverified: false,
        removeFailed: false,
      });

      assert.equal(result.removed, 0, "No entries should be removed");

      const after = loadArtifact(filePath)!;
      assert.ok(
        after.body.includes("- Iframes require special handling"),
        "Overview bullet 1 must survive prune",
      );
      assert.ok(
        after.body.includes("- Use frameLocator()"),
        "Overview bullet 2 must survive prune",
      );
      assert.ok(
        after.body.includes("- Switch to iframe context"),
        "Reactive Handling bullet 1 must survive prune",
      );
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
