import fs from "node:fs";
import path from "node:path";
import { getLogsDir } from "./paths";
import { redactObject, redactString } from "../observability/redaction";

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

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

export class Logger {
  private readonly minLevel: LogLevel;

  private readonly component: string;

  private readonly fileEnabled: boolean;

  private readonly logDir: string;

  private stream: fs.WriteStream | null = null;

  constructor(options: { component?: string; level?: LogLevel; logDir?: string; fileEnabled?: boolean } = {}) {
    this.component = options.component ?? "core";
    this.minLevel = options.level ?? parseLevel(process.env.LOG_LEVEL);
    this.logDir = options.logDir ?? getLogsDir();
    this.fileEnabled = options.fileEnabled ?? (process.env.LOG_FILE === "true");
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  private formatRecord(record: LogRecord): string {
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
      }
      this.stream.write(`${line}\n`);
    } catch {
      // Silently ignore file write failures — stdout is still active
    }
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
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
    });
  }
}

/** Default logger instance for the daemon runtime. */
export const logger = new Logger({ component: "daemon" });
