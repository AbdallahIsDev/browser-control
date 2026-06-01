import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(__dirname, "../..");

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
}

test("test scripts use active-test discovery and coverage tooling", () => {
  const pkg = readPackageJson();

  assert.equal(pkg.scripts.test, "node scripts/run_active_tests.cjs");
  assert.equal(pkg.scripts["test:ci"], "node scripts/run_active_tests.cjs");
  assert.equal(pkg.scripts["test:coverage"], "node scripts/run_coverage.cjs");
  assert.equal(pkg.scripts["test:infra"], "node scripts/check_test_infra.cjs");
});

test("active test runner discovers tests and keeps concurrency configurable", () => {
  const source = fs.readFileSync(path.join(root, "scripts", "run_active_tests.cjs"), "utf8");

  assert.match(source, /const testRoots = \[/u);
  assert.match(source, /function collect\(/u);
  assert.match(source, /BROWSER_CONTROL_TEST_CONCURRENCY/u);
  assert.match(source, /`--test-concurrency=\$\{testConcurrency\}`/u);
});

test("test infrastructure checker passes", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "check_test_infra.cjs")], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Test infrastructure checks passed\./u);
});

test("coverage wrapper writes V8 coverage artifacts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-coverage-test-"));
  const coverageDir = path.join(tempDir, "coverage");
  const scriptPath = path.join(tempDir, "smoke.cjs");
  fs.writeFileSync(scriptPath, "console.log('coverage smoke');\n");

  try {
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "run_coverage.cjs"), scriptPath], {
      cwd: root,
      env: {
        ...process.env,
        BROWSER_CONTROL_COVERAGE_DIR: coverageDir,
      },
      encoding: "utf8",
      windowsHide: true,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Raw V8 coverage written to/u);
    assert.ok(fs.readdirSync(coverageDir).some((entry) => entry.endsWith(".json")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
