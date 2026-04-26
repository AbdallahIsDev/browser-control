import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

import {
  confirmationRequiredResult,
  failureResult,
  formatActionResult,
  policyDeniedResult,
  successResult,
} from "../action_result";
import { getConfigEntries } from "../config";
import {
  buildToolRegistry,
  getToolCategories,
} from "../mcp/tool_registry";
import type { BrowserControlAPI } from "../browser_control";
import { createBrowserControl } from "../browser_control";
import { MemoryStore } from "../memory_store";
import { actionResultToMcpResult, type McpTool } from "../mcp/types";
import {
  OBSERVABILITY_KEYS,
  type DebugBundle,
} from "../observability/types";
import {
  TERMINAL_BUFFER_KEY,
  TERMINAL_METADATA_KEY,
  TERMINAL_PENDING_KEY,
} from "../terminal_buffer_store";
import {
  validateSerializedSession,
} from "../terminal_serialize";
import type {
  SerializedTerminalSession,
  TerminalBufferRecord,
} from "../terminal_resume_types";

export const PUBLIC_SURFACE_FIXTURE_DIR = path.join(
  process.cwd(),
  "test-fixtures",
  "public-surface",
);

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SnapshotDescriptor {
  fileName: string;
  build: () => unknown | Promise<unknown>;
}

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function sortObject(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (typeof item === "function" || item === undefined) continue;
      sorted[key] = sortObject(item);
    }
    return sorted;
  }
  return value as JsonValue;
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortObject(value), null, 2)}\n`;
}

async function extractCliHelpText(): Promise<string> {
  const { runCli } = await import("../cli");
  const writes: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (...args: unknown[]) => {
      writes.push(args.map(String).join(" "));
    };
    await runCli(["node", "bc", "--help"]);
  } finally {
    console.log = originalLog;
  }
  return writes.join("\n").trim();
}

async function runCliJson(command: string[]): Promise<unknown> {
  const writes: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const originalHome = process.env.BROWSER_CONTROL_HOME;
  process.env.BROWSER_CONTROL_HOME = path.join(os.tmpdir(), "browser-control-public-surface-cli-json");
  try {
    const { runCli } = await import("../cli");
    console.log = (...args: unknown[]) => {
      writes.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    await runCli(["node", "bc", ...command]);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
    if (originalHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = originalHome;
  }

  const output = writes.join("\n").trim();
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`CLI command did not return JSON: bc ${command.join(" ")}\nstdout: ${output}\nstderr: ${errors.join("\n")}`);
  }
}

function extractFlagNames(syntax: string): string[] {
  return Array.from(syntax.matchAll(/--([a-zA-Z0-9-]+)/g))
    .map((match) => match[1])
    .sort();
}

function commandPathFromSyntax(syntax: string): string[] {
  return syntax
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !part.startsWith("[") && !part.startsWith("<") && !part.startsWith("--"))
    .slice(0, 3);
}

export async function getCliCommandInventory(): Promise<unknown> {
  const helpText = await extractCliHelpText();
  const sections: Array<{
    section: string;
    entries: Array<{
      syntax: string;
      commandPath: string[];
      flags: string[];
      jsonSupport: boolean;
      description: string;
    }>;
  }> = [];
  let current:
    | {
      section: string;
      entries: Array<{
        syntax: string;
        commandPath: string[];
        flags: string[];
        jsonSupport: boolean;
        description: string;
      }>;
    }
    | null = null;

  for (const rawLine of helpText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (!line.startsWith(" ") && line.endsWith(":")) {
      current = { section: line.slice(0, -1), entries: [] };
      sections.push(current);
      continue;
    }
    if (!current || !line.startsWith("  ")) continue;

    const trimmed = line.trim();
    const [syntax, ...descriptionParts] = trimmed.split(/\s{2,}/);
    current.entries.push({
      syntax,
      commandPath: commandPathFromSyntax(syntax),
      flags: extractFlagNames(syntax),
      jsonSupport: extractFlagNames(syntax).includes("json"),
      description: descriptionParts.join(" ").trim(),
    });
  }

  return {
    source: "cli.ts#printHelp",
    usage: "bc <command> [subcommand] [options]",
    sections,
    globalFlags: ["help", "json"],
  };
}

export async function getCliJsonOutputShapeInventory(): Promise<unknown> {
  const commands = [
    { name: "doctor", argv: ["doctor", "--json"] },
    { name: "config list", argv: ["config", "list", "--json"] },
    { name: "config get logLevel", argv: ["config", "get", "logLevel", "--json"] },
    { name: "status", argv: ["status", "--json"] },
  ];

  const inventory = [];
  for (const command of commands) {
    const output = await runCliJson(command.argv);
    inventory.push({
      command: `bc ${command.argv.join(" ")}`,
      shape: command.name === "status" ? normalizeSystemStatusCliJsonShape(shapeOf(output)) : shapeOf(output),
    });
  }

  return {
    source: "cli.ts JSON output",
    commands: inventory,
  };
}

function normalizeSystemStatusCliJsonShape(shape: JsonValue): JsonValue {
  if (!shape || typeof shape !== "object" || Array.isArray(shape)) return shape;
  const statusShape = shape as Record<string, JsonValue>;

  if (statusShape.daemon && typeof statusShape.daemon === "object" && !Array.isArray(statusShape.daemon)) {
    const daemon = statusShape.daemon as Record<string, JsonValue>;
    daemon.pid = "number (optional)";
    daemon.reason = "string (optional)";
  }
  if (statusShape.broker && typeof statusShape.broker === "object" && !Array.isArray(statusShape.broker)) {
    const broker = statusShape.broker as Record<string, JsonValue>;
    broker.error = "string (optional)";
  }
  if (statusShape.browser && typeof statusShape.browser === "object" && !Array.isArray(statusShape.browser)) {
    const browser = statusShape.browser as Record<string, JsonValue>;
    browser.connection = "object|null";
  }
  if (statusShape.terminal && typeof statusShape.terminal === "object" && !Array.isArray(statusShape.terminal)) {
    const terminal = statusShape.terminal as Record<string, JsonValue>;
    terminal.sessions = ["object"];
  }

  return statusShape;
}

function createStubApi(): BrowserControlAPI {
  const action = (): any => successResult({}, { path: "command", sessionId: "snapshot" });
  const api = {
    browser: {
      open: async () => action(),
      snapshot: async () => action(),
      click: async () => action(),
      fill: async () => action(),
      hover: async () => action(),
      type: async () => action(),
      press: async () => action(),
      scroll: async () => action(),
      screenshot: async () => action(),
      tabList: async () => action(),
      tabSwitch: async () => action(),
      close: async () => action(),
      provider: {
        list: () => ({ providers: [], activeProvider: "local", builtIn: ["local", "custom", "browserless"] }),
        use: (name: string) => ({ success: true, provider: name, previousProvider: "local", persisted: true }),
        getActive: () => "local",
      },
    },
    terminal: {
      open: async () => action(),
      exec: async () => action(),
      type: async () => action(),
      read: async () => action(),
      snapshot: async () => action(),
      interrupt: async () => action(),
      close: async () => action(),
      resume: async () => action(),
      status: async () => action(),
    },
    fs: {
      read: async () => action(),
      write: async () => action(),
      ls: async () => action(),
      move: async () => action(),
      rm: async () => action(),
      stat: async () => action(),
    },
    session: {
      create: async () => action(),
      list: () => action(),
      use: () => action(),
      status: () => action(),
    },
    service: {
      register: async () => action(),
      list: () => action(),
      resolve: async () => action(),
      remove: () => action(),
    },
    provider: {
      list: () => ({ providers: [], activeProvider: "local", builtIn: ["local", "custom", "browserless"] }),
      use: (name: string) => ({ success: true, provider: name, previousProvider: "local", persisted: true }),
      getActive: () => "local",
    },
    debug: {
      health: async () => ({ overall: "healthy", timestamp: "2026-01-01T00:00:00.000Z", checks: [] } as any),
      bundle: () => null,
      console: () => [],
      network: () => [],
      listBundles: () => [],
    },
    config: {
      list: () => [],
      get: () => {
        throw new Error("not implemented");
      },
      set: () => {
        throw new Error("not implemented");
      },
    },
    status: async () => ({ timestamp: "2026-01-01T00:00:00.000Z" } as any),
    sessionManager: {
      evaluateAction: () => ({ allowed: true, policyDecision: "allow", risk: "low", path: "command" }),
      getMemoryStore: () => new MemoryStore({ filename: ":memory:" }),
    } as any,
    browserActions: {} as any,
    terminalActions: { list: async () => action() } as any,
    fsActions: {} as any,
    serviceActions: {} as any,
    close: () => undefined,
  };
  return api as unknown as BrowserControlAPI;
}

export function getMcpToolInventory(): unknown {
  const api = createStubApi();
  const tools = buildToolRegistry(api);
  const categories = getToolCategories(api);
  const categoryByTool = new Map<string, string>();
  for (const [category, names] of Object.entries(categories)) {
    for (const name of names) categoryByTool.set(name, category);
  }
  const inventory = tools
    .map((tool) => ({
      name: tool.name,
      category: categoryByTool.get(tool.name) ?? "unknown",
      description: tool.description,
      inputSchema: sortObject(tool.inputSchema),
      outputShape: getMcpOutputShape(tool),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    source: "mcp/tool_registry.ts",
    tools: inventory,
  };
}

function getMcpOutputShape(tool: McpTool): unknown {
  const sample = actionResultToMcpResult(
    successResult({ sample: true }, { path: "command", sessionId: "mcp-snapshot" }),
  );
  const contentText = JSON.parse(sample.content[0].text) as Record<string, unknown>;
  return {
    wrapper: {
      isError: typeof sample.isError,
      content: [
        {
          type: sample.content[0].type,
          textEncoding: "json",
          jsonFields: Object.keys(contentText).sort(),
        },
      ],
    },
    actionResultFields: [
      "success",
      "path",
      "sessionId",
      "data",
      "warning",
      "error",
      "auditId",
      "policyDecision",
      "risk",
      "completedAt",
    ],
    handlerReturn: tool.name === "bc_status" || tool.name.startsWith("bc_browser_provider_")
      ? "ActionResult-compatible object"
      : "ActionResult",
  };
}

export function getTypeScriptExportInventory(): unknown {
  const program = ts.createProgram({
    rootNames: [path.join(process.cwd(), "index.ts"), path.join(process.cwd(), "browser_control.ts")],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      skipLibCheck: true,
      strict: true,
      types: ["node"],
    },
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(path.join(process.cwd(), "index.ts"));
  if (!sourceFile) throw new Error("Could not load index.ts for export inventory.");
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error("Could not resolve index.ts module symbol.");
  const exports = checker.getExportsOfModule(moduleSymbol).map((symbol) => {
    const resolved = (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
    return {
      name: symbol.getName(),
      kind: classifyExportSymbol(resolved),
      declarations: (resolved.declarations ?? [])
        .map((declaration) => path.relative(process.cwd(), declaration.getSourceFile().fileName).replace(/\\/g, "/"))
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort(),
    };
  });
  return {
    source: "index.ts",
    exports: exports.sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind)),
    createBrowserControl: getCreateBrowserControlInventory(program, checker),
  };
}

function classifyExportSymbol(symbol: ts.Symbol): "type" | "value" | "type+value" {
  const valueFlags = ts.SymbolFlags.Function
    | ts.SymbolFlags.Class
    | ts.SymbolFlags.Enum
    | ts.SymbolFlags.ValueModule
    | ts.SymbolFlags.Variable
    | ts.SymbolFlags.BlockScopedVariable
    | ts.SymbolFlags.Property
    | ts.SymbolFlags.Method;
  const typeFlags = ts.SymbolFlags.Interface
    | ts.SymbolFlags.TypeAlias
    | ts.SymbolFlags.TypeLiteral
    | ts.SymbolFlags.TypeParameter
    | ts.SymbolFlags.Class
    | ts.SymbolFlags.Enum;
  const hasValue = (symbol.flags & valueFlags) !== 0;
  const hasType = (symbol.flags & typeFlags) !== 0;
  if (hasValue && hasType) return "type+value";
  if (hasValue) return "value";
  return "type";
}

export function getCreateBrowserControlInventory(existingProgram?: ts.Program, existingChecker?: ts.TypeChecker): unknown {
  const originalHome = process.env.BROWSER_CONTROL_HOME;
  const tmpHome = path.join(os.tmpdir(), "browser-control-public-surface");
  process.env.BROWSER_CONTROL_HOME = tmpHome;
  const api = createBrowserControl({ memoryStore: new MemoryStore({ filename: ":memory:" }) });
  try {
    const topLevel = Object.keys(api).sort();
    const namespaces: Record<string, string[]> = {};
    for (const key of ["browser", "terminal", "fs", "session", "service", "provider", "debug", "config"] as const) {
      namespaces[key] = Object.keys(api[key]).sort();
    }
    return {
      source: "browser_control.ts#createBrowserControl",
      topLevel,
      namespaces,
      typeSignatures: getBrowserControlTypeSignatures(existingProgram, existingChecker),
    };
  } finally {
    api.close();
    if (originalHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = originalHome;
  }
}

function getBrowserControlTypeSignatures(existingProgram?: ts.Program, existingChecker?: ts.TypeChecker): unknown {
  const program = existingProgram ?? ts.createProgram({
    rootNames: [path.join(process.cwd(), "browser_control.ts")],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      skipLibCheck: true,
      strict: true,
      types: ["node"],
    },
  });
  const checker = existingChecker ?? program.getTypeChecker();
  const sourceFile = program.getSourceFile(path.join(process.cwd(), "browser_control.ts"));
  if (!sourceFile) throw new Error("Could not load browser_control.ts for API signature inventory.");

  const names = [
    "BrowserControlAPI",
    "BrowserNamespace",
    "TerminalNamespace",
    "FsNamespace",
    "SessionNamespace",
    "ServiceNamespace",
    "ProviderNamespace",
    "DebugNamespace",
    "ConfigNamespace",
  ];
  const result: Record<string, Record<string, string>> = {};
  const visit = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) && names.includes(node.name.text)) {
      result[node.name.text] = {};
      for (const member of node.members) {
        const name = member.name && ts.isIdentifier(member.name) ? member.name.text : member.name?.getText(sourceFile);
        if (!name) continue;
        const type = checker.getTypeAtLocation(member);
        const call = type.getCallSignatures()[0];
        result[node.name.text][name] = call
          ? checker.signatureToString(call)
          : checker.typeToString(type);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function envExampleVars(): string[] {
  const content = readText(".env.example");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.split("=")[0])
    .sort();
}

export function getConfigKeyInventory(): unknown {
  const entries = getConfigEntries({
    env: { BROWSER_CONTROL_HOME: "BROWSER_CONTROL_HOME_PLACEHOLDER" },
    validate: false,
  }).map((entry) => ({
    key: entry.key,
    category: entry.category,
    defaultValue: entry.sensitive ? "[redacted]" : entry.defaultValue,
    sensitive: entry.sensitive,
    envVars: entry.envVars,
    description: entry.description,
  }));
  const configuredEnvVars = new Set(entries.flatMap((entry) => entry.envVars));
  const documentedEnvVars = envExampleVars();

  return {
    source: "config.ts + .env.example",
    configKeys: entries,
    envVars: documentedEnvVars.map((name) => ({
      name,
      backedByConfigRegistry: configuredEnvVars.has(name),
    })),
  };
}

export function getActionResultContract(): unknown {
  const success = successResult({ value: 1 }, {
    path: "command",
    sessionId: "session-1",
    warning: "sample warning",
    auditId: "audit-1",
    policyDecision: "allow",
    risk: "low",
  });
  const failure = failureResult("sample error", {
    path: "a11y",
    sessionId: "session-1",
    auditId: "audit-2",
    policyDecision: "deny",
    risk: "moderate",
    debugBundleId: "bundle-sample",
    debugBundlePath: "<data-home>/debug-bundles/bundle-sample.json",
    recoveryGuidance: {
      canRetry: true,
      retryReason: "sample",
      requiresConfirmation: false,
      requiresHuman: false,
    },
    partialDebug: true,
  });
  const policyDenied = policyDeniedResult("sample reason", { path: "command", sessionId: "session-1", risk: "high" });
  const confirmationRequired = confirmationRequiredResult("sample reason", { path: "command", sessionId: "session-1", risk: "high" });

  const normalize = (value: Record<string, unknown>) => ({
    ...value,
    completedAt: "<iso-timestamp>",
  });

  return {
    source: "action_result.ts",
    coreFields: [
      "success",
      "path",
      "sessionId",
      "data",
      "warning",
      "error",
      "auditId",
      "policyDecision",
      "risk",
      "completedAt",
      "debugBundleId",
      "debugBundlePath",
      "recoveryGuidance",
      "partialDebug",
    ],
    success: normalize(formatActionResult(success)),
    failure: normalize(formatActionResult(failure)),
    policyDenied: normalize(formatActionResult(policyDenied)),
    confirmationRequired: normalize(formatActionResult(confirmationRequired)),
  };
}

const sampleSerializedTerminalSession: SerializedTerminalSession = {
  sessionId: "term-1",
  name: "sample",
  shell: "bash",
  cwd: "<cwd>",
  env: { PATH: "/usr/bin", API_KEY: "<redacted>" },
  history: ["echo hello"],
  promptSignature: "\\$ $",
  scrollbackBuffer: ["hello"],
  cursorPosition: { row: 1, col: 1 },
  runningCommand: "npm test",
  processInfo: { pid: 123 },
  status: "running",
  resumeLevel: 2,
  serializedAt: "<iso-timestamp>",
  createdAt: "<iso-timestamp>",
  lastActivityAt: "<iso-timestamp>",
};

const sampleTerminalBufferRecord: TerminalBufferRecord = {
  sessionId: "term-1",
  scrollback: ["hello"],
  visibleContent: "hello",
  cursorPosition: { row: 1, col: 1 },
  capturedAt: "<iso-timestamp>",
};

const sampleDebugBundle: DebugBundle = {
  bundleId: "bundle-sample",
  taskId: "task-1",
  sessionId: "session-1",
  executionPath: "a11y",
  failedStep: {
    id: "step-1",
    action: "browser.click",
    params: { target: "@e1" },
    risk: "moderate",
  },
  recentActions: [{ action: "browser.snapshot", timestamp: "<iso-timestamp>", success: true, durationMs: 12 }],
  policyDecisions: [{ decision: "allow", reason: "sample", timestamp: "<iso-timestamp>" }],
  browser: {
    url: "https://example.test",
    title: "Example",
    snapshot: [{ ref: "e1", role: "button", name: "Submit", text: "Submit" }],
    screenshot: "<redacted-or-path>",
    consoleEntries: [{ level: "error", message: "sample", timestamp: "<iso-timestamp>" }],
    networkEntries: [{ url: "https://example.test/api", method: "GET", status: 500, timestamp: "<iso-timestamp>" }],
  },
  terminal: {
    sessionId: "term-1",
    lastOutput: "sample",
    exitCode: 1,
    promptState: "unknown",
    shell: "bash",
    cwd: "<cwd>",
  },
  filesystem: {
    path: "<path>",
    operation: "read",
    errorCode: "ENOENT",
  },
  exception: { message: "sample error", stack: "<stack>", code: "ERR_SAMPLE" },
  retrySummary: { attempts: 1, totalDurationMs: 10, backoffUsed: false, lastError: "sample error" },
  recoveryGuidance: { canRetry: true, requiresConfirmation: false, requiresHuman: false },
  assembledAt: "<iso-timestamp>",
  partial: false,
};

function shapeOf(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [shapeOf(value[0])];
  }
  if (value && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = shapeOf(item);
    }
    return result;
  }
  if (value === null) return "null";
  return typeof value;
}

export function getPersistedFormatInventory(): unknown {
  return {
    source: [
      "paths.ts",
      "services/registry.ts",
      "providers/types.ts",
      "observability/types.ts",
      "terminal_resume_types.ts",
      "terminal_buffer_store.ts",
    ],
    dataHome: {
      envOverride: "BROWSER_CONTROL_HOME",
      defaultSuffix: ".browser-control",
      publicPaths: [
        "config/config.json",
        "memory.sqlite",
        "reports/",
        "logs/",
        ".interop/chrome-debug.json",
        ".interop/daemon.pid",
        ".interop/daemon-status.json",
        "skills/",
        "policy-profiles/",
        "profiles/",
        "knowledge/interaction-skills/",
        "knowledge/domain-skills/",
        "services/registry.json",
        "providers/registry.json",
        "debug-bundles/",
        "observability/",
      ],
    },
    memoryStoreKeys: {
      observability: OBSERVABILITY_KEYS,
      terminal: {
        bufferPrefix: TERMINAL_BUFFER_KEY,
        metadataPrefix: TERMINAL_METADATA_KEY,
        pendingPrefix: TERMINAL_PENDING_KEY,
      },
    },
    serviceRegistry: {
      version: 1,
      shape: shapeOf({
        version: 1,
        updatedAt: "<iso-timestamp>",
        services: {
          sample: {
            name: "sample",
            port: 3000,
            protocol: "http",
            path: "/",
            registeredAt: "<iso-timestamp>",
            updatedAt: "<iso-timestamp>",
          },
        },
      }),
    },
    providerRegistry: {
      version: 1,
      builtIns: ["local", "custom", "browserless"],
      shape: shapeOf({
        version: 1,
        providers: [{ name: "browserless", type: "browserless", endpoint: "https://example.test", apiKey: "<secret>", options: {} }],
        activeProvider: "local",
        updatedAt: "<iso-timestamp>",
      }),
      publicListRedacts: ["apiKey", "sensitive endpoint query params"],
    },
    terminalResume: {
      serializedSessionValidates: validateSerializedSession({
        ...sampleSerializedTerminalSession,
        serializedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-01-01T00:00:00.000Z",
      }),
      serializedSession: shapeOf(sampleSerializedTerminalSession),
      bufferRecord: shapeOf(sampleTerminalBufferRecord),
    },
    debugBundle: shapeOf(sampleDebugBundle),
  };
}

export const SNAPSHOTS: SnapshotDescriptor[] = [
  { fileName: "cli-help.snapshot.json", build: getCliCommandInventory },
  { fileName: "cli-json-output-shapes.snapshot.json", build: getCliJsonOutputShapeInventory },
  { fileName: "mcp-tools.snapshot.json", build: getMcpToolInventory },
  { fileName: "typescript-exports.snapshot.json", build: getTypeScriptExportInventory },
  { fileName: "config-keys.snapshot.json", build: getConfigKeyInventory },
  { fileName: "action-result.snapshot.json", build: getActionResultContract },
  { fileName: "persisted-formats.snapshot.json", build: getPersistedFormatInventory },
];

export async function buildSnapshot(fileName: string): Promise<unknown> {
  const descriptor = SNAPSHOTS.find((snapshot) => snapshot.fileName === fileName);
  if (!descriptor) throw new Error(`Unknown public-surface snapshot: ${fileName}`);
  return descriptor.build();
}

export async function writeAllSnapshots(): Promise<void> {
  fs.mkdirSync(PUBLIC_SURFACE_FIXTURE_DIR, { recursive: true });
  for (const descriptor of SNAPSHOTS) {
    const value = await descriptor.build();
    fs.writeFileSync(path.join(PUBLIC_SURFACE_FIXTURE_DIR, descriptor.fileName), stableJson(value));
  }
}
