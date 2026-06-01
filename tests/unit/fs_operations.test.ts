import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Check if symlink creation is supported on this platform (requires
// Developer Mode or elevation on Windows).
let hasSymlinkSupport = false;
try {
  const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-symcheck-"));
  fs.writeFileSync(path.join(checkDir, "target"), "x");
  fs.symlinkSync(path.join(checkDir, "target"), path.join(checkDir, "link"));
  hasSymlinkSupport = true;
  fs.rmSync(checkDir, { recursive: true, force: true });
} catch {
  hasSymlinkSupport = false;
}

import {
  readFile,
  writeFile,
  listDir,
  moveFile,
  deletePath,
  statPath,
  resolvePath,
  resolvePathSafe,
  FsError,
} from "../../src/filesystem/operations";

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

test("fs_operations: writeFile resolves relative paths against provided cwd", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-cwd-"));

  try {
    const result = writeFile("report.md", "cwd content", { cwd: tmpDir });
    assert.equal(result.path, path.join(tmpDir, "report.md"));
    assert.equal(fs.readFileSync(path.join(tmpDir, "report.md"), "utf-8"), "cwd content");
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

test("fs_operations: listDir can opt into hidden entries", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-hidden-"));

  try {
    fs.writeFileSync(path.join(tmpDir, "visible.txt"), "visible");
    fs.writeFileSync(path.join(tmpDir, ".env"), "secret");
    fs.mkdirSync(path.join(tmpDir, ".github"));
    fs.writeFileSync(path.join(tmpDir, ".github", "workflow.yml"), "name: test");

    const defaultResult = listDir(tmpDir);
    assert.deepEqual(
      defaultResult.entries.map((entry) => entry.name).sort(),
      ["visible.txt"],
    );

    const withHidden = listDir(tmpDir, { includeHidden: true, recursive: true });
    assert.ok(withHidden.entries.some((entry) => entry.name === ".env"));
    assert.ok(withHidden.entries.some((entry) => entry.name === ".github"));
    assert.ok(withHidden.entries.some((entry) => entry.name === "workflow.yml"));
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

// ── Issue 4: Symlink-Following Delete ─────────────────────────────────

test("fs_operations: deletePath deletes symlink to file, not target", { skip: !hasSymlinkSupport }, () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-symfile-"));

  try {
    const targetFile = path.join(tmpDir, "target.txt");
    const symlink = path.join(tmpDir, "link.txt");
    fs.writeFileSync(targetFile, "sensitive data");
    fs.symlinkSync(targetFile, symlink);

    assert.ok(fs.existsSync(targetFile));
    assert.ok(fs.existsSync(symlink));

    const result = deletePath(symlink);

    assert.equal(result.success, true);
    assert.equal(result.type, "file");
    assert.ok(!fs.existsSync(symlink), "symlink should be deleted");
    assert.ok(fs.existsSync(targetFile), "target file should remain");
    assert.equal(fs.readFileSync(targetFile, "utf-8"), "sensitive data");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: deletePath deletes symlink to directory, not directory", { skip: !hasSymlinkSupport }, () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-symdir-"));

  try {
    const targetDir = path.join(tmpDir, "target");
    const symlink = path.join(tmpDir, "link");
    fs.mkdirSync(targetDir);
    fs.writeFileSync(path.join(targetDir, "secret.txt"), "secret");
    fs.symlinkSync(targetDir, symlink, "dir");

    assert.ok(fs.existsSync(targetDir));
    assert.ok(fs.existsSync(symlink));

    const result = deletePath(symlink);

    assert.equal(result.success, true);
    assert.equal(result.type, "file");
    assert.ok(!fs.existsSync(symlink), "symlink should be deleted");
    assert.ok(fs.existsSync(targetDir), "target directory should remain");
    assert.ok(fs.existsSync(path.join(targetDir, "secret.txt")), "target file should remain");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: deletePath deletes regular file normally", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-regdel-"));

  try {
    const filePath = path.join(tmpDir, "regular.txt");
    fs.writeFileSync(filePath, "data");

    const result = deletePath(filePath);

    assert.equal(result.success, true);
    assert.equal(result.type, "file");
    assert.ok(!fs.existsSync(filePath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: deletePath deletes directory recursively with realpath validation", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-realdel-"));

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

// ── Issue 5: resolvePathSafe sandbox ──────────────────────────────────

test("fs_operations: resolvePathSafe allows paths within allowed roots", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-allow-"));
  const filePath = path.join(tmpDir, "inner", "file.txt");

  try {
    fs.mkdirSync(path.join(tmpDir, "inner"), { recursive: true });
    fs.writeFileSync(filePath, "data");

    const result = resolvePathSafe(filePath, { allowedRoots: [tmpDir] });
    assert.equal(result, filePath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: resolvePathSafe rejects paths outside allowed roots", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-deny-"));
  const outsidePath = path.join(tmpDir, "outside.txt");

  try {
    const allowedRoot = path.join(tmpDir, "allowed");
    fs.mkdirSync(allowedRoot, { recursive: true });
    fs.writeFileSync(outsidePath, "outside");

    assert.throws(
      () => resolvePathSafe(outsidePath, { allowedRoots: [allowedRoot] }),
      FsError,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: resolvePathSafe allows non-existent path whose parent is within allowed roots", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-newfile-"));
  const newFilePath = path.join(tmpDir, "new", "future.txt");

  try {
    fs.mkdirSync(path.join(tmpDir, "new"), { recursive: true });

    const result = resolvePathSafe(newFilePath, { allowedRoots: [tmpDir] });
    assert.equal(result, newFilePath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: resolvePathSafe rejects non-existent path whose parent is outside allowed roots", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-noparent-"));
  const allowedRoot = path.join(tmpDir, "allowed");
  const outsidePath = path.join(tmpDir, "outside", "future.txt");

  try {
    fs.mkdirSync(allowedRoot, { recursive: true });

    assert.throws(
      () => resolvePathSafe(outsidePath, { allowedRoots: [allowedRoot] }),
      FsError,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: resolvePathSafe rejects symlink to outside allowed roots", { skip: !hasSymlinkSupport }, () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-symescape-"));

  try {
    const insideDir = path.join(tmpDir, "inside");
    const outsideDir = path.join(tmpDir, "outside");
    const symlink = path.join(insideDir, "escape");

    fs.mkdirSync(insideDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "secret");
    fs.symlinkSync(outsideDir, symlink, "dir");

    assert.throws(
      () => resolvePathSafe(symlink, { allowedRoots: [insideDir] }),
      FsError,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: resolvePathSafe returns canonical path for allowed symlinks", { skip: !hasSymlinkSupport }, () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-symcanon-"));

  try {
    const insideDir = path.join(tmpDir, "inside");
    const targetFile = path.join(insideDir, "target.txt");
    const symlink = path.join(insideDir, "link.txt");

    fs.mkdirSync(insideDir, { recursive: true });
    fs.writeFileSync(targetFile, "safe");
    fs.symlinkSync(targetFile, symlink);

    assert.equal(
      resolvePathSafe(symlink, { allowedRoots: [insideDir] }),
      fs.realpathSync(targetFile),
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: resolvePathSafe returns the validated real path", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-realpath-"));
  const visiblePath = path.join(tmpDir, "visible.txt");
  const realPath = path.join(tmpDir, "real.txt");
  const originalRealpathSync = fs.realpathSync;

  try {
    fs.writeFileSync(visiblePath, "visible");
    fs.writeFileSync(realPath, "real");
    fs.realpathSync = ((target: fs.PathLike) => {
      if (path.resolve(String(target)) === visiblePath) return realPath;
      return originalRealpathSync(target);
    }) as typeof fs.realpathSync;

    assert.equal(
      resolvePathSafe(visiblePath, { allowedRoots: [tmpDir] }),
      realPath,
    );
  } finally {
    fs.realpathSync = originalRealpathSync;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fs_operations: resolvePath is exported and resolves paths", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-resolve-"));

  try {
    const result = resolvePath(tmpDir);
    assert.equal(result, path.resolve(tmpDir));

    const relative = resolvePath("subdir", tmpDir);
    assert.equal(relative, path.resolve(tmpDir, "subdir"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
