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
}

export interface WriteFileOptions {
  /** Text encoding (default: utf-8). */
  encoding?: BufferEncoding;
  /** If true, create parent directories. Default: true. */
  createDirs?: boolean;
  /** If true, fail if file exists. Default: false. */
  exclusive?: boolean;
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
}

export interface DeleteOptions {
  /** Allow recursive directory deletion. Default: false. */
  recursive?: boolean;
  /** If true, don't throw if path doesn't exist. Default: false. */
  force?: boolean;
}

// ── Read ─────────────────────────────────────────────────────────────

/**
 * Read a file and return structured result.
 */
export function readFile(
  filePath: string,
  options: ReadFileOptions = {},
): FileReadResult {
  const resolved = resolvePath(filePath);
  const encoding = options.encoding ?? "utf-8";

  if (!fs.existsSync(resolved)) {
    throw new FsError(`File not found: ${resolved}`, "ENOENT", resolved);
  }

  const stats = fs.statSync(resolved);
  if (stats.isDirectory()) {
    throw new FsError(`Path is a directory: ${resolved}`, "EISDIR", resolved);
  }

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
  const resolved = resolvePath(filePath);
  const encoding = options.encoding ?? "utf-8";
  const createDirs = options.createDirs ?? true;

  if (options.exclusive && fs.existsSync(resolved)) {
    throw new FsError(`File already exists: ${resolved}`, "EEXIST", resolved);
  }

  if (createDirs) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
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
  const resolved = resolvePath(dirPath);

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
export function moveFile(srcPath: string, dstPath: string): MoveResult {
  const resolvedSrc = resolvePath(srcPath);
  const resolvedDst = resolvePath(dstPath);

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
  const resolved = resolvePath(targetPath);

  if (!fs.existsSync(resolved)) {
    if (options.force) {
      return { path: resolved, success: false, type: "file" };
    }
    throw new FsError(`Path not found: ${resolved}`, "ENOENT", resolved);
  }

  const stats = fs.statSync(resolved);

  if (stats.isDirectory()) {
    if (!options.recursive) {
      throw new FsError(
        `Cannot delete directory without recursive option: ${resolved}`,
        "EISDIR",
        resolved,
      );
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
export function statPath(targetPath: string): FileStatResult {
  const resolved = resolvePath(targetPath);

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

function resolvePath(filePath: string): string {
  // Expand ~ to home directory
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
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
