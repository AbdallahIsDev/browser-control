/**
 * File System Operations — Structured native file/system APIs.
 *
 * These are NOT hidden behind shell commands. They provide clean, typed
 * interfaces for common filesystem tasks that the command path needs.
 *
 * All operations can be routed through the policy engine when a policy
 * context is provided (handled at the CLI/API surface).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ────────────────────────────────────────────────────────────

export interface FileReadResult {
  path: string;
  content: string;
  encoding: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface FileWriteResult {
  path: string;
  sizeBytes: number;
  bytesWritten: number;
  created: boolean; // true if file was newly created
}

export interface FileStatResult {
  path: string;
  exists: boolean;
  sizeBytes: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  createdAt: string;
  modifiedAt: string;
  accessedAt: string;
  permissions: string;
}

export interface ListEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  sizeBytes: number;
  modifiedAt: string;
}

export interface ListResult {
  path: string;
  entries: ListEntry[];
  totalEntries: number;
}

export interface MoveResult {
  from: string;
  to: string;
  success: boolean;
}

export interface DeleteResult {
  path: string;
  success: boolean;
  type: "file" | "directory";
}

// ── Options ──────────────────────────────────────────────────────────

export interface ReadFileOptions {
  /** Text encoding (default: utf-8). */
  encoding?: BufferEncoding;
  /** Max bytes to read. */
  maxBytes?: number;
  /** Base directory for resolving relative paths. */
  cwd?: string;
  /** Allowed root directories for sandbox enforcement. */
  allowedRoots?: string[];
}

export interface WriteFileOptions {
  /** Text encoding (default: utf-8). */
  encoding?: BufferEncoding;
  /** If true, create parent directories. Default: true. */
  createDirs?: boolean;
  /** If true, fail if file exists. Default: false. */
  exclusive?: boolean;
  /** Base directory for resolving relative paths. */
  cwd?: string;
  /** Allowed root directories for sandbox enforcement. */
  allowedRoots?: string[];
}

export interface ListOptions {
  /** Include file metadata. Default: true. */
  withStats?: boolean;
  /** Recurse into subdirectories. Default: false. */
  recursive?: boolean;
  /** Max recursion depth. Default: 3. */
  maxDepth?: number;
  /** Filter by file extension (e.g., ".ts"). */
  extension?: string;
  /** Base directory for resolving relative paths. */
  cwd?: string;
  /** Allowed root directories for sandbox enforcement. */
  allowedRoots?: string[];
}

export interface MoveOptions {
  /** Base directory for resolving relative paths. */
  cwd?: string;
  /** Allowed root directories for sandbox enforcement. */
  allowedRoots?: string[];
}

export interface DeleteOptions {
  /** Allow recursive directory deletion. Default: false. */
  recursive?: boolean;
  /** If true, don't throw if path doesn't exist. Default: false. */
  force?: boolean;
  /** Base directory for resolving relative paths. */
  cwd?: string;
  /** Allowed root directories for sandbox enforcement. */
  allowedRoots?: string[];
}

export interface StatOptions {
  /** Base directory for resolving relative paths. */
  cwd?: string;
  /** Allowed root directories for sandbox enforcement. */
  allowedRoots?: string[];
}

// ── Read ─────────────────────────────────────────────────────────────

/**
 * Read a file and return structured result.
 */
export function readFile(
  filePath: string,
  options: ReadFileOptions = {},
): FileReadResult {
  const resolved = resolvePathSafe(filePath, { cwd: options.cwd, allowedRoots: options.allowedRoots });
  const encoding = options.encoding ?? "utf-8";

  if (!fs.existsSync(resolved)) {
    throw new FsError(`File not found: ${resolved}`, "ENOENT", resolved);
  }

  const lstats = fs.lstatSync(resolved);
  if (lstats.isSymbolicLink()) {
    validateRealPath(resolved, options.allowedRoots);
  }

  if (lstats.isDirectory()) {
    throw new FsError(`Path is a directory: ${resolved}`, "EISDIR", resolved);
  }

  const stats = lstats.isSymbolicLink() ? fs.statSync(resolved) : lstats;

  if (options.maxBytes && stats.size > options.maxBytes) {
    throw new FsError(
      `File too large (${stats.size} bytes, max ${options.maxBytes}): ${resolved}`,
      "E2BIG",
      resolved,
    );
  }

  const content = fs.readFileSync(resolved, encoding);

  return {
    path: resolved,
    content,
    encoding,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

// ── Write ────────────────────────────────────────────────────────────

/**
 * Write content to a file. Creates parent directories by default.
 */
export function writeFile(
  filePath: string,
  content: string | Buffer,
  options: WriteFileOptions = {},
): FileWriteResult {
  const resolved = resolvePathSafe(filePath, { cwd: options.cwd, allowedRoots: options.allowedRoots });
  const encoding = options.encoding ?? "utf-8";
  const createDirs = options.createDirs ?? true;

  if (options.exclusive && fs.existsSync(resolved)) {
    throw new FsError(`File already exists: ${resolved}`, "EEXIST", resolved);
  }

  // Check parent directory isn't an unexpected symlink
  const parentDir = path.dirname(resolved);
  const parentExists = fs.existsSync(parentDir);
  if (parentExists) {
    const parentLstats = fs.lstatSync(parentDir);
    if (parentLstats.isSymbolicLink()) {
      validateRealPath(fs.realpathSync(parentDir), options.allowedRoots);
    }
  }

  if (createDirs) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const existed = fs.existsSync(resolved);
  fs.writeFileSync(resolved, content, encoding);

  const stats = fs.statSync(resolved);

  return {
    path: resolved,
    sizeBytes: stats.size,
    bytesWritten: Buffer.byteLength(content, encoding),
    created: !existed,
  };
}

// ── List ─────────────────────────────────────────────────────────────

/**
 * List directory contents with optional metadata.
 */
export function listDir(
  dirPath: string,
  options: ListOptions = {},
): ListResult {
  const resolved = resolvePathSafe(dirPath, { cwd: options.cwd, allowedRoots: options.allowedRoots });

  if (!fs.existsSync(resolved)) {
    throw new FsError(`Directory not found: ${resolved}`, "ENOENT", resolved);
  }

  const stats = fs.statSync(resolved);
  if (!stats.isDirectory()) {
    throw new FsError(`Path is not a directory: ${resolved}`, "ENOTDIR", resolved);
  }

  const entries = readDirEntries(resolved, options, 0);

  return {
    path: resolved,
    entries,
    totalEntries: entries.length,
  };
}

function readDirEntries(
  dirPath: string,
  options: ListOptions,
  depth: number,
): ListEntry[] {
  const withStats = options.withStats ?? true;
  const recursive = options.recursive ?? false;
  const maxDepth = options.maxDepth ?? 3;
  const entries: ListEntry[] = [];

  const names = fs.readdirSync(dirPath);

  for (const name of names) {
    // Skip hidden files
    if (name.startsWith(".")) continue;

    const fullPath = path.join(dirPath, name);
    let entryStats: fs.Stats;
    try {
      entryStats = fs.lstatSync(fullPath);
    } catch {
      continue; // Skip broken symlinks
    }

    let type: ListEntry["type"];
    if (entryStats.isSymbolicLink()) {
      type = "symlink";
    } else if (entryStats.isFile()) {
      type = "file";
    } else if (entryStats.isDirectory()) {
      type = "directory";
    } else {
      type = "other";
    }

    // Extension filter
    if (options.extension && type === "file") {
      if (!name.endsWith(options.extension)) continue;
    }

    if (withStats) {
      entries.push({
        name,
        path: fullPath,
        type,
        sizeBytes: entryStats.size,
        modifiedAt: entryStats.mtime.toISOString(),
      });
    } else {
      entries.push({
        name,
        path: fullPath,
        type,
        sizeBytes: 0,
        modifiedAt: "",
      });
    }

    // Recurse into directories
    if (recursive && type === "directory" && depth < maxDepth) {
      entries.push(...readDirEntries(fullPath, options, depth + 1));
    }
  }

  return entries;
}

// ── Move / Rename ────────────────────────────────────────────────────

/**
 * Move or rename a file or directory.
 */
export function moveFile(
  srcPath: string,
  dstPath: string,
  options: MoveOptions = {},
): MoveResult {
  const resolvedSrc = resolvePathSafeForDirectoryEntry(srcPath, { cwd: options.cwd, allowedRoots: options.allowedRoots });
  const resolvedDst = resolvePathSafeForDirectoryEntry(dstPath, { cwd: options.cwd, allowedRoots: options.allowedRoots });

  if (!fs.existsSync(resolvedSrc)) {
    throw new FsError(`Source not found: ${resolvedSrc}`, "ENOENT", resolvedSrc);
  }

  // Create destination parent dir
  fs.mkdirSync(path.dirname(resolvedDst), { recursive: true });

  fs.renameSync(resolvedSrc, resolvedDst);

  return {
    from: resolvedSrc,
    to: resolvedDst,
    success: true,
  };
}

// ── Delete ───────────────────────────────────────────────────────────

/**
 * Delete a file or directory.
 */
export function deletePath(
  targetPath: string,
  options: DeleteOptions = {},
): DeleteResult {
  const resolved = resolvePathSafeForDirectoryEntry(targetPath, { cwd: options.cwd, allowedRoots: options.allowedRoots });

  if (!fs.existsSync(resolved)) {
    if (options.force) {
      return { path: resolved, success: false, type: "file" };
    }
    throw new FsError(`Path not found: ${resolved}`, "ENOENT", resolved);
  }

  const lstats = fs.lstatSync(resolved);

  if (lstats.isSymbolicLink()) {
    fs.unlinkSync(resolved);
    return { path: resolved, success: true, type: "file" };
  }

  if (lstats.isDirectory()) {
    if (!options.recursive) {
      throw new FsError(
        `Cannot delete directory without recursive option: ${resolved}`,
        "EISDIR",
        resolved,
      );
    }
    // Validate real path for recursive directory delete
    const realPath = fs.realpathSync(resolved);
    if (options.allowedRoots && options.allowedRoots.length > 0) {
      const allowed = options.allowedRoots.some(root => {
        const realRoot = fs.realpathSync(root);
        return realPath.startsWith(realRoot + path.sep) || realPath === realRoot;
      });
      if (!allowed) {
        throw new FsError(
          `Path ${realPath} is not within allowed roots for recursive delete`,
          "EACCES",
          resolved,
        );
      }
    }
    fs.rmSync(resolved, { recursive: true, force: true });
    return { path: resolved, success: true, type: "directory" };
  }

  fs.unlinkSync(resolved);
  return { path: resolved, success: true, type: "file" };
}

// ── Stat ─────────────────────────────────────────────────────────────

/**
 * Get file/directory metadata.
 */
export function statPath(targetPath: string, options: StatOptions = {}): FileStatResult {
  const resolved = resolvePathSafe(targetPath, { cwd: options.cwd, allowedRoots: options.allowedRoots });

  if (!fs.existsSync(resolved)) {
    return {
      path: resolved,
      exists: false,
      sizeBytes: 0,
      isFile: false,
      isDirectory: false,
      isSymlink: false,
      createdAt: "",
      modifiedAt: "",
      accessedAt: "",
      permissions: "",
    };
  }

  const lstats = fs.lstatSync(resolved);
  const isSymlink = lstats.isSymbolicLink();

  // For symlinks, also stat the target
  let stats = lstats;
  if (isSymlink) {
    try {
      stats = fs.statSync(resolved);
    } catch {
      // Broken symlink
    }
  }

  return {
    path: resolved,
    exists: true,
    sizeBytes: stats.size,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymlink,
    createdAt: stats.birthtime.toISOString(),
    modifiedAt: stats.mtime.toISOString(),
    accessedAt: stats.atime.toISOString(),
    permissions: modeToOctal(stats.mode),
  };
}

// ── Process/System Helpers ───────────────────────────────────────────

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu?: number;
  memory?: number;
}

/**
 * List running processes (platform-dependent).
 * Uses `ps` on Unix, `tasklist` on Windows.
 */
export function listProcesses(): ProcessInfo[] {
  const platform = os.platform();

  if (platform === "win32") {
    // Windows: use tasklist
    try {
      const { execFileSync } = require("node:child_process");
      const output = execFileSync("tasklist", ["/FO", "CSV", "/NH"], {
        encoding: "utf8",
        timeout: 10000,
      });
      return parseWindowsTasklist(output);
    } catch {
      return [];
    }
  }

  // Unix: use ps
  try {
    const { execFileSync } = require("node:child_process");
    const output = execFileSync("ps", ["-eo", "pid,comm,%cpu,%mem", "--no-headers"], {
      encoding: "utf8",
      timeout: 10000,
    });
    return parseUnixPs(output);
  } catch {
    return [];
  }
}

/**
 * Kill a process by PID.
 */
export function killProcess(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

export function resolvePath(filePath: string, cwd?: string): string {
  // Expand ~ to home directory
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  if (path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }
  return path.resolve(cwd ?? process.cwd(), filePath);
}

export function resolvePathSafe(
  filePath: string,
  options: { cwd?: string; allowedRoots?: string[] } = {},
): string {
  const resolved = resolvePath(filePath, options.cwd);
  return validateRealPath(resolved, options.allowedRoots);
}

function resolvePathSafeForDirectoryEntry(
  filePath: string,
  options: { cwd?: string; allowedRoots?: string[] } = {},
): string {
  const resolved = resolvePath(filePath, options.cwd);
  validateRealPath(resolved, options.allowedRoots);
  return resolved;
}

function validateRealPath(targetPath: string, allowedRoots?: string[]): string {
  if (!allowedRoots || allowedRoots.length === 0) return targetPath;

  let realPath: string;
  try {
    realPath = fs.realpathSync(targetPath);
  } catch {
    const parent = path.dirname(targetPath);
    if (parent === targetPath) {
      throw new FsError(
        `Path ${targetPath} does not exist and has no parent to validate against allowed roots`,
        "EACCES",
        targetPath,
      );
    }
    let realParent: string;
    try {
      realParent = fs.realpathSync(parent);
    } catch {
      throw new FsError(
        `Path ${targetPath} and its parent ${parent} do not exist; cannot validate against allowed roots`,
        "EACCES",
        targetPath,
      );
    }
    const parentAllowed = allowedRoots.some(root => {
      const realRoot = resolveRealRoot(root);
      return realParent.startsWith(realRoot + path.sep) || realParent === realRoot;
    });
    if (!parentAllowed) {
      throw new FsError(
        `Path ${targetPath} (parent ${parent}) is not within allowed roots: ${allowedRoots.join(", ")}`,
        "EACCES",
        targetPath,
      );
    }
    return targetPath;
  }

  const allowed = allowedRoots.some(root => {
    const realRoot = resolveRealRoot(root);
    return realPath.startsWith(realRoot + path.sep) || realPath === realRoot;
  });
  if (!allowed) {
    throw new FsError(
      `Path ${targetPath} (resolved to ${realPath}) is not within allowed roots: ${allowedRoots.join(", ")}`,
      "EACCES",
      targetPath,
    );
  }
  return realPath;
}

function resolveRealRoot(root: string): string {
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

function modeToOctal(mode: number): string {
  return (mode & 0o777).toString(8);
}

function parseWindowsTasklist(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  const lines = output.trim().split(/\r?\n/);
  for (const line of lines) {
    // CSV format: "name","pid","session","session#","mem"
    const match = line.match(/^"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]+)"/);
    if (match) {
      processes.push({
        pid: parseInt(match[2], 10),
        name: match[1],
      });
    }
  }
  return processes;
}

function parseUnixPs(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  const lines = output.trim().split(/\r?\n/);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      processes.push({
        pid: parseInt(parts[0], 10),
        name: parts[1],
        cpu: parts[2] ? parseFloat(parts[2]) : undefined,
        memory: parts[3] ? parseFloat(parts[3]) : undefined,
      });
    }
  }
  return processes;
}

// ── FsError ──────────────────────────────────────────────────────────

export class FsError extends Error {
  readonly code: string;
  readonly filePath: string;

  constructor(message: string, code: string, filePath: string) {
    super(message);
    this.name = "FsError";
    this.code = code;
    this.filePath = filePath;
  }
}
