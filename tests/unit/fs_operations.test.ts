import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readFile,
  writeFile,
  listDir,
  moveFile,
  deletePath,
  statPath,
  FsError,
} from "../../fs_operations";

test("fs_operations: readFile returns content and metadata", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-test-"));
  const filePath = path.join(tmpDir, "test.txt");

  try {
    fs.writeFileSync(filePath, "hello world", "utf-8");
    const result = readFile(filePath);

    assert.equal(result.content, "hello world");
    assert.equal(result.encoding, "utf-8");
    assert.equal(result.sizeBytes, 11);
    assert.ok(result.modifiedAt.length > 0);
    assert.ok(result.path.endsWith("test.txt"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: readFile throws FsError for missing file", () => {
  assert.throws(() => readFile("/tmp/nonexistent-bc-test-file.txt"), FsError);
});

test("fs_operations: readFile throws FsError for directory", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-dir-"));
  try {
    assert.throws(() => readFile(tmpDir), FsError);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: writeFile creates file and parent dirs", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-write-"));
  const filePath = path.join(tmpDir, "sub", "dir", "file.txt");

  try {
    const result = writeFile(filePath, "test content");
    assert.equal(result.created, true);
    assert.equal(result.bytesWritten, 12);
    assert.ok(fs.existsSync(filePath));
    assert.equal(fs.readFileSync(filePath, "utf-8"), "test content");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: writeFile exclusive mode fails on existing file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-exc-"));
  const filePath = path.join(tmpDir, "file.txt");

  try {
    fs.writeFileSync(filePath, "existing");
    assert.throws(
      () => writeFile(filePath, "overwrite", { exclusive: true }),
      FsError,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: listDir returns entries with metadata", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-list-"));

  try {
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "a");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "b");
    fs.mkdirSync(path.join(tmpDir, "subdir"));

    const result = listDir(tmpDir);
    assert.equal(result.totalEntries, 3);
    assert.equal(result.entries.length, 3);

    const names = result.entries.map((e) => e.name).sort();
    assert.deepEqual(names, ["a.txt", "b.ts", "subdir"]);

    const dirEntry = result.entries.find((e) => e.name === "subdir");
    assert.equal(dirEntry!.type, "directory");

    const fileEntry = result.entries.find((e) => e.name === "a.txt");
    assert.equal(fileEntry!.type, "file");
    assert.equal(fileEntry!.sizeBytes, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: listDir filters by extension", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-ext-"));

  try {
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "a");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "b");

    const result = listDir(tmpDir, { extension: ".ts" });
    assert.equal(result.totalEntries, 1);
    assert.equal(result.entries[0].name, "b.ts");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: moveFile renames files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-move-"));

  try {
    fs.writeFileSync(path.join(tmpDir, "old.txt"), "data");
    const result = moveFile(
      path.join(tmpDir, "old.txt"),
      path.join(tmpDir, "new.txt"),
    );

    assert.equal(result.success, true);
    assert.ok(!fs.existsSync(path.join(tmpDir, "old.txt")));
    assert.ok(fs.existsSync(path.join(tmpDir, "new.txt")));
    assert.equal(fs.readFileSync(path.join(tmpDir, "new.txt"), "utf-8"), "data");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: deletePath removes files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-del-"));

  try {
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "data");
    const result = deletePath(path.join(tmpDir, "file.txt"));

    assert.equal(result.success, true);
    assert.equal(result.type, "file");
    assert.ok(!fs.existsSync(path.join(tmpDir, "file.txt")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: deletePath requires recursive for directories", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-rmdir-"));

  try {
    fs.mkdirSync(path.join(tmpDir, "subdir"));
    assert.throws(
      () => deletePath(path.join(tmpDir, "subdir")),
      FsError,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: deletePath recursive removes directories", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-recdel-"));

  try {
    const subDir = path.join(tmpDir, "subdir");
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, "file.txt"), "data");

    const result = deletePath(subDir, { recursive: true });
    assert.equal(result.success, true);
    assert.equal(result.type, "directory");
    assert.ok(!fs.existsSync(subDir));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: statPath returns metadata for files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-stat-"));

  try {
    const filePath = path.join(tmpDir, "file.txt");
    fs.writeFileSync(filePath, "hello");

    const result = statPath(filePath);
    assert.equal(result.exists, true);
    assert.equal(result.isFile, true);
    assert.equal(result.isDirectory, false);
    assert.equal(result.sizeBytes, 5);
    assert.ok(result.createdAt.length > 0);
    assert.ok(result.modifiedAt.length > 0);
    assert.ok(result.permissions.length > 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: statPath returns exists=false for missing paths", () => {
  const result = statPath("/tmp/nonexistent-bc-stat-test");
  assert.equal(result.exists, false);
  assert.equal(result.sizeBytes, 0);
});

test("fs_operations: readFile expands tilde paths", () => {
  // Create a temp file and test tilde expansion
  const homeDir = os.homedir();
  const testDir = path.join(homeDir, ".bc-test-fs-ops");
  const testFile = path.join(testDir, "tilde-test.txt");

  try {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, "tilde content");

    const result = readFile("~/.bc-test-fs-ops/tilde-test.txt");
    assert.equal(result.content, "tilde content");
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
