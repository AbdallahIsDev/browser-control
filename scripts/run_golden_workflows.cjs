#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const reportRunId = `golden-suite-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const reportPath = path.join(root, "reports", "e2e", `${reportRunId}.json`);
const testFiles = [
  "e2e/golden/local_web_app.test.ts",
  "e2e/golden/mcp_workflow.test.ts",
  "e2e/golden/failure_recovery.test.ts",
  "e2e/golden/terminal_resume_workflow.test.ts",
  "e2e/golden/provider_service_workflow.test.ts",
];

fs.rmSync(reportPath, { force: true });

const result = spawnSync(
  process.execPath,
  [
    "--require",
    "ts-node/register",
    "--require",
    "tsconfig-paths/register",
    "--test",
    "--test-concurrency=1",
    ...testFiles,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      BC_E2E_REPORT_PATH: reportPath,
      BC_E2E_REPORT_RUN_ID: reportRunId,
      BC_E2E_REPORT_STARTED_AT: new Date().toISOString(),
    },
  },
);

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(reportPath)) {
  console.error(`E2E reliability report was not written: ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const workflows = Array.isArray(report.workflows) ? report.workflows : [];
const bad = workflows.filter((workflow) => workflow.status !== "pass" || workflow.cleanup?.status !== "pass");
if (bad.length > 0) {
  console.error("E2E reliability gate failed. All workflows and cleanup checks must pass with zero skips.");
  for (const workflow of bad) {
    console.error(`- ${workflow.name}: status=${workflow.status}, cleanup=${workflow.cleanup?.status ?? "missing"}${workflow.errorSummary ? `, error=${workflow.errorSummary}` : ""}`);
  }
  process.exit(1);
}

process.exit(0);
