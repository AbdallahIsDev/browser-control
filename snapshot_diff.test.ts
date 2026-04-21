import assert from "node:assert/strict";
import test from "node:test";
import type { A11ySnapshot } from "./a11y_snapshot";
import { diffSnapshots, formatDiffSummary } from "./snapshot_diff";

function snap(elements: Array<{ ref: string; role: string; name?: string; disabled?: boolean; checked?: boolean; expanded?: boolean; focused?: boolean; text?: string; level?: number }>, url = "https://example.com", title = "Test"): A11ySnapshot {
  return {
    pageUrl: url,
    pageTitle: title,
    elements: elements as A11ySnapshot["elements"],
    generatedAt: new Date().toISOString(),
  };
}

test("diffSnapshots detects no changes for identical snapshots", () => {
  const before = snap([
    { ref: "e1", role: "heading", name: "Title" },
    { ref: "e2", role: "button", name: "OK" },
  ]);
  const after = snap([
    { ref: "e1", role: "heading", name: "Title" },
    { ref: "e2", role: "button", name: "OK" },
  ]);

  const diff = diffSnapshots(before, after);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.renamed.length, 0);
  assert.equal(diff.stateChanged.length, 0);
});

test("diffSnapshots detects added elements", () => {
  const before = snap([
    { ref: "e1", role: "heading", name: "Title" },
  ]);
  const after = snap([
    { ref: "e1", role: "heading", name: "Title" },
    { ref: "e2", role: "button", name: "New Button" },
    { ref: "e3", role: "dialog", name: "Modal" },
  ]);

  const diff = diffSnapshots(before, after);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.added.length, 2);
  assert.equal(diff.added[0].ref, "e2");
  assert.equal(diff.added[1].ref, "e3");
});

test("diffSnapshots detects removed elements", () => {
  const before = snap([
    { ref: "e1", role: "heading", name: "Title" },
    { ref: "e2", role: "button", name: "Delete" },
    { ref: "e3", role: "button", name: "Cancel" },
  ]);
  const after = snap([
    { ref: "e1", role: "heading", name: "Title" },
  ]);

  const diff = diffSnapshots(before, after);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.removed.length, 2);
  assert.equal(diff.removed[0].ref, "e2");
  assert.equal(diff.removed[1].ref, "e3");
});

test("diffSnapshots detects renamed elements", () => {
  const before = snap([
    { ref: "e1", role: "button", name: "Save" },
  ]);
  const after = snap([
    { ref: "e1", role: "button", name: "Save Changes" },
  ]);

  const diff = diffSnapshots(before, after);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.renamed.length, 1);
  assert.equal(diff.renamed[0].ref, "e1");
  assert.equal(diff.renamed[0].oldName, "Save");
  assert.equal(diff.renamed[0].newName, "Save Changes");
});

test("diffSnapshots detects state changes", () => {
  const before = snap([
    { ref: "e1", role: "button", name: "OK", disabled: false },
    { ref: "e2", role: "checkbox", name: "Accept", checked: false },
    { ref: "e3", role: "button", name: "Menu", expanded: false },
  ]);
  const after = snap([
    { ref: "e1", role: "button", name: "OK", disabled: true },
    { ref: "e2", role: "checkbox", name: "Accept", checked: true },
    { ref: "e3", role: "button", name: "Menu", expanded: true },
  ]);

  const diff = diffSnapshots(before, after);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.stateChanged.length, 3);

  // Check disabled change
  const disabledChange = diff.stateChanged.find((sc) => sc.ref === "e1");
  assert.ok(disabledChange);
  assert.ok(disabledChange.changes.some((c) => c.property === "disabled" && c.oldValue === false && c.newValue === true));

  // Check checked change
  const checkedChange = diff.stateChanged.find((sc) => sc.ref === "e2");
  assert.ok(checkedChange);
  assert.ok(checkedChange.changes.some((c) => c.property === "checked" && c.oldValue === false && c.newValue === true));

  // Check expanded change
  const expandedChange = diff.stateChanged.find((sc) => sc.ref === "e3");
  assert.ok(expandedChange);
  assert.ok(expandedChange.changes.some((c) => c.property === "expanded" && c.oldValue === false && c.newValue === true));
});

test("diffSnapshots detects route change", () => {
  const before = snap([{ ref: "e1", role: "heading", name: "Home" }], "https://example.com/home");
  const after = snap([{ ref: "e1", role: "heading", name: "About" }], "https://example.com/about", "About");

  const diff = diffSnapshots(before, after);
  assert.ok(diff.routeChanged);
  assert.equal(diff.routeChanged?.from, "https://example.com/home");
  assert.equal(diff.routeChanged?.to, "https://example.com/about");
});

test("diffSnapshots detects title change", () => {
  const before = snap([{ ref: "e1", role: "heading", name: "Title" }], "https://example.com", "Old Title");
  const after = snap([{ ref: "e1", role: "heading", name: "Title" }], "https://example.com", "New Title");

  const diff = diffSnapshots(before, after);
  assert.ok(diff.titleChanged);
  assert.equal(diff.titleChanged?.from, "Old Title");
  assert.equal(diff.titleChanged?.to, "New Title");
});

test("diffSnapshots handles empty to non-empty", () => {
  const before = snap([]);
  const after = snap([
    { ref: "e1", role: "heading", name: "Loaded" },
    { ref: "e2", role: "button", name: "Start" },
  ]);

  const diff = diffSnapshots(before, after);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.added.length, 2);
  assert.equal(diff.removed.length, 0);
});

test("diffSnapshots handles non-empty to empty", () => {
  const before = snap([
    { ref: "e1", role: "heading", name: "Title" },
    { ref: "e2", role: "button", name: "Start" },
  ]);
  const after = snap([]);

  const diff = diffSnapshots(before, after);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 2);
});

test("formatDiffSummary shows no changes message", () => {
  const before = snap([{ ref: "e1", role: "heading", name: "Title" }]);
  const after = snap([{ ref: "e1", role: "heading", name: "Title" }]);

  const diff = diffSnapshots(before, after);
  const summary = formatDiffSummary(diff);
  assert.equal(summary, "No changes detected.");
});

test("formatDiffSummary formats a full diff", () => {
  const before = snap([
    { ref: "e1", role: "heading", name: "Dashboard" },
    { ref: "e2", role: "button", name: "Save" },
  ], "https://example.com/v1", "V1");
  const after = snap([
    { ref: "e1", role: "heading", name: "Dashboard" },
    { ref: "e2", role: "button", name: "Save All", disabled: true },
    { ref: "e3", role: "dialog", name: "Confirm" },
  ], "https://example.com/v2", "V2");

  const diff = diffSnapshots(before, after);
  const summary = formatDiffSummary(diff);

  assert.ok(summary.includes("Route:"), "should show route change");
  assert.ok(summary.includes("Title:"), "should show title change");
  assert.ok(summary.includes("Added (1)"), "should show added");
  assert.ok(summary.includes("@e3"), "should mention added ref");
  assert.ok(summary.includes("Renamed (1)"), "should show renamed");
  assert.ok(summary.includes("Save"), "should show old name");
  assert.ok(summary.includes("Save All"), "should show new name");
  assert.ok(summary.includes("State changed"), "should show state changes");
});
