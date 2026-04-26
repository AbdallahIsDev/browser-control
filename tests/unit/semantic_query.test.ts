import assert from "node:assert/strict";
import test from "node:test";
import type { A11ySnapshot } from "../../a11y_snapshot";
import {
  queryAll,
  queryFirst,
  queryByRole,
  queryByRoleAndName,
  queryByName,
  findButton,
  findTextbox,
  findLink,
  findHeading,
  findByDescription,
} from "../../semantic_query";

const testSnapshot: A11ySnapshot = {
  pageUrl: "https://example.com",
  pageTitle: "Test Page",
  elements: [
    { ref: "e1", role: "heading", name: "Dashboard", level: 1 },
    { ref: "e2", role: "heading", name: "Settings", level: 2 },
    { ref: "e3", role: "textbox", name: "Search" },
    { ref: "e4", role: "textbox", name: "Email" },
    { ref: "e5", role: "button", name: "Submit", disabled: false },
    { ref: "e6", role: "button", name: "Cancel", disabled: true },
    { ref: "e7", role: "link", name: "Sign Out" },
    { ref: "e8", role: "checkbox", name: "Accept Terms", checked: true },
    { ref: "e9", role: "button", name: "Delete Account", disabled: false },
  ],
  generatedAt: new Date().toISOString(),
};

test("queryByRole returns all elements with matching role", () => {
  const buttons = queryByRole(testSnapshot, "button");
  assert.equal(buttons.length, 3);
  assert.equal(buttons[0].name, "Submit");
  assert.equal(buttons[1].name, "Cancel");
  assert.equal(buttons[2].name, "Delete Account");
});

test("queryByRole returns empty for no match", () => {
  const radios = queryByRole(testSnapshot, "radio");
  assert.equal(radios.length, 0);
});

test("queryByRoleAndName finds by role and name (substring)", () => {
  const el = queryByRoleAndName(testSnapshot, "button", "Sub");
  assert.ok(el);
  assert.equal(el?.ref, "e5");
});

test("queryByRoleAndName supports exact matching", () => {
  const el = queryByRoleAndName(testSnapshot, "button", "Submit", true);
  assert.ok(el);
  assert.equal(el?.ref, "e5");

  // Partial match won't work with exact
  const noMatch = queryByRoleAndName(testSnapshot, "button", "Sub", true);
  assert.equal(noMatch, undefined);
});

test("queryByName finds by accessible name", () => {
  const results = queryByName(testSnapshot, "Search");
  assert.equal(results.length, 1);
  assert.equal(results[0].ref, "e3");
});

test("queryByName is case-insensitive", () => {
  const results = queryByName(testSnapshot, "search");
  assert.equal(results.length, 1);
  assert.equal(results[0].ref, "e3");
});

test("queryAll filters by multiple criteria", () => {
  const results = queryAll(testSnapshot, { role: "button", disabled: true });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Cancel");
});

test("queryAll with checked filter", () => {
  const results = queryAll(testSnapshot, { checked: true });
  assert.equal(results.length, 1);
  assert.equal(results[0].ref, "e8");
});

test("queryFirst returns first match", () => {
  const el = queryFirst(testSnapshot, { role: "heading" });
  assert.ok(el);
  assert.equal(el?.ref, "e1");
});

test("findButton finds button by name", () => {
  const el = findButton(testSnapshot, "Cancel");
  assert.ok(el);
  assert.equal(el?.ref, "e6");
});

test("findButton without name finds first button", () => {
  const el = findButton(testSnapshot);
  assert.ok(el);
  assert.equal(el?.ref, "e5");
});

test("findTextbox finds textbox by name", () => {
  const el = findTextbox(testSnapshot, "Email");
  assert.ok(el);
  assert.equal(el?.ref, "e4");
});

test("findLink finds link by name", () => {
  const el = findLink(testSnapshot, "Sign Out");
  assert.ok(el);
  assert.equal(el?.ref, "e7");
});

test("findHeading finds heading by name and level", () => {
  const h2 = findHeading(testSnapshot, "Settings", 2);
  assert.ok(h2);
  assert.equal(h2?.ref, "e2");

  const anyH = findHeading(testSnapshot, "Dashboard");
  assert.ok(anyH);
  assert.equal(anyH?.ref, "e1");
});

test("findByDescription handles direct ref lookup", () => {
  const el = findByDescription(testSnapshot, "@e3");
  assert.ok(el);
  assert.equal(el?.role, "textbox");
});

test("findByDescription handles 'role name' pattern", () => {
  const el = findByDescription(testSnapshot, "button Submit");
  assert.ok(el);
  assert.equal(el?.ref, "e5");
});

test("findByDescription handles quoted names", () => {
  const el = findByDescription(testSnapshot, 'button "Delete Account"');
  assert.ok(el);
  assert.equal(el?.ref, "e9");
});

test("findByDescription handles ref without @", () => {
  const el = findByDescription(testSnapshot, "e7");
  assert.ok(el);
  assert.equal(el?.role, "link");
});
