import fs from "node:fs";
import path from "node:path";
import { getLogsDir } from "./paths";
import { redactObject, redactString } from "../observability/redaction";

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";
export type LogFormat = "text" | "json";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

function parseLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();
  if (normalized && normalized in LEVEL_PRIORITY) {
    return normalized as LogLevel;
  }
  return "info";
}

function parseFormat(value: string | undefined): LogFormat {
  return value?.trim().toLowerCase() === "json" ? "json" : "text";
}

function isProtocolStdoutReserved(): boolean {
  return process.env.BROWSER_CONTROL_STDIO_MODE === "mcp" || process.env.BROWSER_CONTROL_JSON_OUTPUT === "true";
}

function isJsonConsoleLoggingSuppressed(): boolean {
  return process.env.BROWSER_CONTROL_JSON_OUTPUT === "true" && process.env.BROWSER_CONTROL_JSON_LOGS !== "stderr";
}

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

interface LoggerExitProcess {
  once(event: "beforeExit" | "exit", listener: () => void): unknown;
}

const activeFileLoggers = new Set<Logger>();
const installedExitProcesses = new WeakSet<object>();
const DEFAULT_FILE_FLUSH_INTERVAL_MS = 100;
const DEFAULT_FILE_BATCH_SIZE = 100;

interface LoggerOptions {
  component?: string;
  level?: LogLevel;
  logDir?: string;
  fileEnabled?: boolean;
  format?: LogFormat;
  fileFlushIntervalMs?: number;
  fileBatchSize?: number;
}

export function closeActiveLoggers(): void {
  for (const activeLogger of Array.from(activeFileLoggers)) {
    activeLogger.close();
  }
}

export function installLoggerExitHandlers(processRef: LoggerExitProcess = process): void {
  const processKey = processRef as object;
  if (installedExitProcesses.has(processKey)) {
    return;
  }
  installedExitProcesses.add(processKey);

  processRef.once("beforeExit", closeActiveLoggers);
  processRef.once("exit", closeActiveLoggers);
}

export class Logger {
  private readonly minLevel: LogLevel;

  private readonly component: string;

  private readonly fileEnabled: boolean;

  private readonly logDir: string;

  private readonly format: LogFormat;

  private readonly fileFlushIntervalMs: number;

  private readonly fileBatchSize: number;

  private stream: fs.WriteStream | null = null;

  private fileBuffer: string[] = [];

  private flushTimer: NodeJS.Timeout | null = null;

  constructor(options: LoggerOptions = {}) {
    this.component = options.component ?? "core";
    this.minLevel = options.level ?? parseLevel(process.env.LOG_LEVEL);
    this.logDir = options.logDir ?? getLogsDir();
    this.fileEnabled = options.fileEnabled ?? (process.env.LOG_FILE === "true");
    this.format = options.format ?? parseFormat(process.env.BROWSER_CONTROL_LOG_FORMAT);
    this.fileFlushIntervalMs = Math.max(1, options.fileFlushIntervalMs ?? DEFAULT_FILE_FLUSH_INTERVAL_MS);
    this.fileBatchSize = Math.max(1, options.fileBatchSize ?? DEFAULT_FILE_BATCH_SIZE);
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  private formatRecord(record: LogRecord): string {
    if (this.format === "json") {
      return JSON.stringify({
        timestamp: record.timestamp,
        level: record.level,
        component: record.component,
        message: redactString(record.message),
        ...(record.data && Object.keys(record.data).length > 0
          ? { data: redactObject(record.data) }
          : {}),
      });
    }

    const base = `${record.timestamp} [${record.level.toUpperCase()}] [${record.component}] ${redactString(record.message)}`;
    if (record.data && Object.keys(record.data).length > 0) {
      return `${base} ${JSON.stringify(redactObject(record.data))}`;
    }
    return base;
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      ...(data ? { data } : {}),
    };

    const line = this.formatRecord(record);

    // JSON CLI mode is meant for machine parsing. Keep stdout/stderr free of
    // logger noise unless callers explicitly opt into stderr logs.
    if (isJsonConsoleLoggingSuppressed()) {
      if (this.fileEnabled) {
        this.writeToFile(line);
      }
      return;
    }

    // In stdio MCP mode, stdout is reserved for protocol frames only.
    // Route all logs to stderr so MCP clients never see plain log lines
    // interleaved with the protocol stream.
    if (isProtocolStdoutReserved() || level === "error" || level === "critical") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }

    // Optionally write to file
    if (this.fileEnabled) {
      this.writeToFile(line);
    }
  }

  private writeToFile(line: string): void {
    try {
      if (!this.stream) {
        fs.mkdirSync(this.logDir, { recursive: true });
        const logFile = path.join(this.logDir, `daemon-${new Date().toISOString().slice(0, 10)}.log`);
        this.stream = fs.createWriteStream(logFile, { flags: "a" });
        activeFileLoggers.add(this);
        installLoggerExitHandlers();
      }
      this.fileBuffer.push(line);
      if (this.fileBuffer.length >= this.fileBatchSize) {
        this.flushFileBuffer();
      } else {
        this.scheduleFileFlush();
      }
    } catch {
      // Silently ignore file write failures — stdout is still active
    }
  }

  private scheduleFileFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushFileBuffer();
    }, this.fileFlushIntervalMs);
    this.flushTimer.unref?.();
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) {
      return;
    }
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private flushFileBuffer(): void {
    this.clearFlushTimer();
    if (!this.stream || this.fileBuffer.length === 0) {
      return;
    }
    const chunk = `${this.fileBuffer.join("\n")}\n`;
    this.fileBuffer = [];
    this.stream.write(chunk);
  }

  async flush(): Promise<void> {
    this.flushFileBuffer();
    const stream = this.stream;
    if (!stream) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      stream.write("", (error?: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  close(): void {
    this.flushFileBuffer();
    if (!this.stream) {
      return;
    }
    const stream = this.stream;
    this.stream = null;
    activeFileLoggers.delete(this);
    stream.end();
  }

  debug(message: string, data?: Record<string, unknown>): void { this.write("debug", message, data); }
  info(message: string, data?: Record<string, unknown>): void { this.write("info", message, data); }
  warn(message: string, data?: Record<string, unknown>): void { this.write("warn", message, data); }
  error(message: string, data?: Record<string, unknown>): void { this.write("error", message, data); }
  critical(message: string, data?: Record<string, unknown>): void { this.write("critical", message, data); }

  /** Create a child logger with a different component tag. */
  withComponent(component: string): Logger {
    return new Logger({
      component,
      level: this.minLevel,
      logDir: this.logDir,
      fileEnabled: this.fileEnabled,
      format: this.format,
      fileFlushIntervalMs: this.fileFlushIntervalMs,
      fileBatchSize: this.fileBatchSize,
    });
  }
}

/** Default logger instance for the daemon runtime. */
export const logger = new Logger({ component: "daemon" });
