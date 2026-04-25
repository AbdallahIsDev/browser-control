import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRunReport, finishRunReport, recordWorkflow, writeReliabilityReport } from "../support/reliability_report";
import { scanForBrowserControlLeftovers, summarizeCleanupFailure } from "../support/process_cleanup";
import { createMcpGoldenHarness } from "../support/mcp_client";

function parseToolJson(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  assert.ok(content?.[0]?.text, "MCP tool result did not include text content");
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

function getToolData(result: Record<string, unknown>): Record<string, unknown> {
  assert.equal(result.success, true);
  assert.ok(result.data && typeof result.data === "object");
  return result.data as Record<string, unknown>;
}

test("golden MCP workflow keeps stdio clean and runs status/fs/terminal tools", async () => {
  const startedAt = Date.now();
  const report = createRunReport();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-e2e-mcp-files-"));
  let harness: ReturnType<typeof createMcpGoldenHarness> | undefined;
  let status: "pass" | "fail" | "skip" = "fail";
  let errorSummary: string | undefined;

  try {
    harness = createMcpGoldenHarness();
    const startupStdout = await harness.readStartupStdout(500);
    assert.equal(startupStdout, "");

    await harness.client.connect(harness.transport);
    const tools = await harness.client.listTools();
    assert.ok(tools.tools.some((tool: { name: string }) => tool.name === "bc_status"));
    assert.ok(tools.tools.some((tool: { name: string }) => tool.name === "bc_fs_write"));

    const statusResult = await harness.client.callTool({ name: "bc_status", arguments: {} });
    assert.equal(parseToolJson(statusResult).success, true);

    const debugResult = parseToolJson(await harness.client.callTool({ name: "bc_debug_get_console", arguments: { sessionId: "default" } }));
    assert.equal(debugResult.success, true);

    const sessionResult = parseToolJson(await harness.client.callTool({
      name: "bc_session_create",
      arguments: { name: "golden-mcp-trusted", policyProfile: "trusted", workingDirectory: tempDir },
    }));
    const trustedSessionId = String(getToolData(sessionResult).id);

    const targetFile = path.join(tempDir, "golden.txt");
    const writeResult = await harness.client.callTool({
      name: "bc_fs_write",
      arguments: { path: targetFile, content: "golden mcp", sessionId: trustedSessionId },
    });
    assert.equal(parseToolJson(writeResult).success, true);

    const readResult = await harness.client.callTool({ name: "bc_fs_read", arguments: { path: targetFile, sessionId: trustedSessionId } });
    assert.ok(JSON.stringify(parseToolJson(readResult)).includes("golden mcp"));

    const listResult = await harness.client.callTool({ name: "bc_fs_list", arguments: { path: tempDir, sessionId: trustedSessionId } });
    assert.ok(JSON.stringify(parseToolJson(listResult)).includes("golden.txt"));

    const browserResult = parseToolJson(await harness.client.callTool({
      name: "bc_browser_snapshot",
      arguments: { sessionId: trustedSessionId },
    }));
    assert.equal(browserResult.success, false);
    assert.match(String(browserResult.error), /No active browser|No browser|Cannot read properties/i);

    const terminalResult = await harness.client.callTool({
      name: "bc_terminal_exec",
      arguments: { command: "node -e \"console.log('golden-terminal')\"", timeoutMs: 10000, browserControlSessionId: trustedSessionId },
    });
    assert.ok(JSON.stringify(parseToolJson(terminalResult)).includes("golden-terminal"));

    const safeSession = parseToolJson(await harness.client.callTool({
      name: "bc_session_create",
      arguments: { name: "golden-mcp-safe", policyProfile: "safe", workingDirectory: tempDir },
    }));
    const safeSessionId = String(getToolData(safeSession).id);
    const denied = await harness.client.callTool({
      name: "bc_terminal_exec",
      arguments: { command: "node -e \"console.log('denied')\"", timeoutMs: 1000, browserControlSessionId: safeSessionId },
    });
    const deniedJson = parseToolJson(denied);
    assert.equal(deniedJson.success, false);
    assert.match(JSON.stringify(deniedJson), /Confirmation required|Policy denied/);
    status = "pass";
  } catch (error) {
    errorSummary = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await harness?.close();
    const cleanup = await scanForBrowserControlLeftovers({
      commandFragments: [harness?.homeDir, "mcp serve"].filter((fragment): fragment is string => Boolean(fragment)),
      fixturePids: harness?.pids,
    });
    const cleanupFailure = summarizeCleanupFailure(cleanup);
    const shouldThrowCleanup = Boolean(cleanupFailure && status !== "fail");
    if (cleanupFailure) {
      status = "fail";
      errorSummary = cleanupFailure;
    }
    recordWorkflow(report, {
      name: "mcp stdio",
      status,
      durationMs: Date.now() - startedAt,
      retryCount: 0,
      cleanup,
      errorSummary,
    });
    finishRunReport(report);
    writeReliabilityReport(report);
    if (shouldThrowCleanup && cleanupFailure) throw new Error(cleanupFailure);
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (harness) fs.rmSync(harness.homeDir, { recursive: true, force: true });
  }
});
