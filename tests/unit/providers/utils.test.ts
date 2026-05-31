import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { generateConnectionId } from "../../../src/providers/utils";

describe("provider utils", () => {
  it("generates compact browser connection IDs", () => {
    assert.match(generateConnectionId(), /^conn-\d+-[a-z0-9]{5}$/u);
  });

  it("keeps connection ID generation centralized", () => {
    const providersDir = path.resolve(__dirname, "../../../src/providers");
    const providerFiles = [
      "browserbase.ts",
      "browserless.ts",
      "custom.ts",
      "local.ts",
    ];

    for (const file of providerFiles) {
      const source = fs.readFileSync(path.join(providersDir, file), "utf8");
      assert.doesNotMatch(
        source,
        /conn-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2,\s*7\)\}/u,
        `${file} should call generateConnectionId() instead of inlining the generator`,
      );
    }
  });
});
