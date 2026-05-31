import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSelectorCache, saveSelectorCache, type SelectorCacheRecord } from "../../src/selector_store";

type TestSelectorCache = SelectorCacheRecord & {
  submitButton: string | null;
};

const DEFAULTS: TestSelectorCache = {
  selectorsDiscovered: false,
  discoveryNote: "defaults",
  submitButton: null,
};

const tempDirs: string[] = [];

function withTempSelectorPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-selector-store-"));
  tempDirs.push(dir);
  return path.join(dir, "selectors.json");
}

describe("selector_store", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns defaults when cache JSON has an invalid shape", () => {
    const jsonPath = withTempSelectorPath();
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        selectorsDiscovered: "yes",
        discoveryNote: 42,
        submitButton: { css: "button[type=submit]" },
      }),
    );

    const loaded = loadSelectorCache(DEFAULTS, jsonPath);

    assert.deepEqual(loaded, DEFAULTS);
  });

  it("rejects invalid selector cache values before saving", () => {
    const jsonPath = withTempSelectorPath();
    const invalid = {
      selectorsDiscovered: "yes",
      discoveryNote: "bad",
      submitButton: "button[type=submit]",
    } as unknown as TestSelectorCache;

    assert.throws(
      () => saveSelectorCache(invalid, jsonPath),
      /Invalid selector cache/,
    );
    assert.equal(fs.existsSync(jsonPath), false);
  });

  it("saves through a temp file before replacing the target cache", () => {
    const jsonPath = withTempSelectorPath();
    const calls: Array<
      | { op: "write"; file: string }
      | { op: "rename"; oldPath: string; newPath: string }
    > = [];
    const mutableFs = fs as typeof fs & {
      writeFileSync: typeof fs.writeFileSync;
      renameSync: typeof fs.renameSync;
    };
    const originalWriteFileSync = mutableFs.writeFileSync;
    const originalRenameSync = mutableFs.renameSync;

    mutableFs.writeFileSync = ((file, data, options) => {
      calls.push({ op: "write", file: String(file) });
      return originalWriteFileSync(file, data, options);
    }) as typeof fs.writeFileSync;
    mutableFs.renameSync = ((oldPath, newPath) => {
      calls.push({ op: "rename", oldPath: String(oldPath), newPath: String(newPath) });
      return originalRenameSync(oldPath, newPath);
    }) as typeof fs.renameSync;

    try {
      saveSelectorCache(DEFAULTS, jsonPath);
    } finally {
      mutableFs.writeFileSync = originalWriteFileSync;
      mutableFs.renameSync = originalRenameSync;
    }

    const writeCall = calls.find((call): call is { op: "write"; file: string } => call.op === "write");
    const renameCall = calls.find((call): call is { op: "rename"; oldPath: string; newPath: string } => call.op === "rename");

    assert.ok(writeCall, "expected temp file write");
    assert.ok(renameCall, "expected atomic rename");
    assert.notEqual(writeCall.file, jsonPath);
    assert.equal(renameCall.oldPath, writeCall.file);
    assert.equal(renameCall.newPath, jsonPath);
    assert.deepEqual(loadSelectorCache(DEFAULTS, jsonPath), DEFAULTS);
  });
});
