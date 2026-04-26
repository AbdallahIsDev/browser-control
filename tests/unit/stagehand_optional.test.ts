import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

type ModuleLoad = (request: string, parent?: unknown, isMain?: boolean) => unknown;

test("missing Stagehand package reports the install command", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const stagehandCorePath = require.resolve("../../stagehand_core");
  delete require.cache[stagehandCorePath];

  (Module as unknown as { _load: ModuleLoad })._load = function patchedLoad(this: unknown, request: string, parent?: unknown, isMain?: boolean) {
    if (request === "@browserbasehq/stagehand") {
      const error = new Error("Cannot find module '@browserbasehq/stagehand'");
      (error as NodeJS.ErrnoException).code = "MODULE_NOT_FOUND";
      throw error;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const core = require("../../stagehand_core") as typeof import("../../stagehand_core");
    await assert.rejects(
      () => core.connectStagehand(9222, "", {
        config: {
          openrouterApiKey: "test-key",
          openrouterBaseUrl: "https://openrouter.ai/api/v1",
          stagehandModel: "openai/gpt-4o-mini",
        } as any,
      }),
      /Stagehand support is not installed\.\nRun: npm install @browserbasehq\/stagehand/,
    );
  } finally {
    (Module as unknown as { _load: ModuleLoad })._load = originalLoad;
    delete require.cache[stagehandCorePath];
  }
});
