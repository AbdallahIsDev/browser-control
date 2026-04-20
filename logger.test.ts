import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Logger, type LogLevel, type LogRecord } from "./logger";

/** Capture writes to stdout/stderr for inspection. */
function captureOutput(fn: () => void): { stdout: string; stderr: string } {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: unknown) => {
    if (typeof chunk === "string") {
      stdoutChunks.push(chunk);
    }
    return true;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: unknown) => {
    if (typeof chunk === "string") {
      stderrChunks.push(chunk);
    }
    return true;
  };

  try {
    fn();
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
  };
}

test("Logger writes info and above to stdout by default", () => {
  const logger = new Logger({ component: "test", level: "info", fileEnabled: false });

  const output = captureOutput(() => {
    logger.debug("should be hidden");
    logger.info("visible info");
    logger.warn("visible warn");
  });

  assert.ok(!output.stdout.includes("should be hidden"));
  assert.ok(output.stdout.includes("visible info"));
  assert.ok(output.stdout.includes("visible warn"));
});

test("Logger writes error and critical to stderr", () => {
  const logger = new Logger({ component: "test", level: "info", fileEnabled: false });

  const output = captureOutput(() => {
    logger.error("err message");
    logger.critical("crit message");
  });

  assert.ok(output.stderr.includes("err message"));
  assert.ok(output.stderr.includes("crit message"));
});

test("Logger respects LOG_LEVEL debug to show all messages", () => {
  const logger = new Logger({ component: "test", level: "debug", fileEnabled: false });

  const output = captureOutput(() => {
    logger.debug("debug-msg");
    logger.info("info-msg");
  });

  assert.ok(output.stdout.includes("debug-msg"));
  assert.ok(output.stdout.includes("info-msg"));
});

test("Logger filters messages below the configured level", () => {
  const logger = new Logger({ component: "test", level: "error", fileEnabled: false });

  const output = captureOutput(() => {
    logger.info("hidden");
    logger.warn("also hidden");
    logger.error("visible");
  });

  assert.ok(!output.stderr.includes("hidden"));
  assert.ok(output.stderr.includes("visible"));
});

test("Logger includes component tag in formatted output", () => {
  const logger = new Logger({ component: "my-mod", level: "info", fileEnabled: false });

  const output = captureOutput(() => {
    logger.info("hello");
  });

  assert.ok(output.stdout.includes("[my-mod]"));
});

test("Logger includes structured data as JSON in output", () => {
  const logger = new Logger({ component: "test", level: "info", fileEnabled: false });

  const output = captureOutput(() => {
    logger.info("with data", { key: "value", count: 42 });
  });

  assert.ok(output.stdout.includes('"key":"value"'));
  assert.ok(output.stdout.includes('"count":42'));
});

test("Logger does not append data when no structured data is given", () => {
  const logger = new Logger({ component: "test", level: "info", fileEnabled: false });

  const output = captureOutput(() => {
    logger.info("plain");
  });

  // The line should end with just the message + newline, no JSON blob
  const line = output.stdout.trim();
  assert.ok(!line.includes("{"), `Expected no JSON in line: ${line}`);
});

test("Logger withComponent creates a child with different component tag", () => {
  const parent = new Logger({ component: "parent", level: "info", fileEnabled: false });
  const child = parent.withComponent("child");

  const output = captureOutput(() => {
    child.info("child message");
  });

  assert.ok(output.stdout.includes("[child]"));
  assert.ok(!output.stdout.includes("[parent]"));
});

test("Logger writes to file when fileEnabled is true", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));

  try {
    const logger = new Logger({ component: "test", level: "info", logDir: tempDir, fileEnabled: true });

    captureOutput(() => {
      logger.info("file test");
    });

    // Close the stream and wait for flush
    await new Promise<void>((resolve) => {
      if (logger["stream"]) {
        logger["stream"].on("finish", () => resolve());
        logger.close();
      } else {
        logger.close();
        resolve();
      }
    });

    // Small delay to ensure file system sync
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logFiles = fs.readdirSync(tempDir).filter((f) => f.endsWith(".log"));
    assert.ok(logFiles.length >= 1, `Expected at least one log file in ${tempDir}, found: ${fs.readdirSync(tempDir)}`);

    const content = fs.readFileSync(path.join(tempDir, logFiles[0]), "utf8");
    assert.ok(content.includes("file test"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Logger close does not throw when no file stream is active", () => {
  const logger = new Logger({ component: "test", level: "info", fileEnabled: false });
  // Should not throw
  logger.close();
});

test("LogRecord has expected shape with all fields", () => {
  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    level: "info",
    component: "test",
    message: "hello",
    data: { count: 1 },
  };

  assert.equal(record.level, "info");
  assert.equal(record.component, "test");
  assert.equal(record.message, "hello");
  assert.deepEqual(record.data, { count: 1 });
  assert.ok(record.timestamp.length > 0);
});
