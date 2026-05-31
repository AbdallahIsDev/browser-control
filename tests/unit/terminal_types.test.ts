import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("terminal public types", () => {
  it("uses TerminalResumeMetadata for snapshot resume metadata", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/terminal/types.ts"),
      "utf8",
    );

    assert.match(source, /import type \{ TerminalResumeMetadata \} from "\.\/resume_types";/u);
    assert.match(source, /resumeMetadata\?: TerminalResumeMetadata;/u);
    assert.doesNotMatch(source, /resumeMetadata\?: \{\s*restored: boolean;/u);
  });
});
