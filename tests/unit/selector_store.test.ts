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
});
