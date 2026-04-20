/**
 * browser-control — Public API
 *
 * Re-exports the key runtime surfaces so consumers can:
 *   import { connectBrowser, smartClick, Daemon, ... } from "browser-control";
 */

// Browser core — connection, actions, stealth
export {
  connectBrowser,
  createAutomationContext,
  getAllPages,
  findPageByUrl,
  getOrOpenPage,
  getFramerPage,
  smartClick,
  rawDomClick,
  smartFill,
  keyboardFill,
  retryAction,
  waitForElement,
  waitForAny,
  readText,
  screenshotElement,
  isDebugPortReady,
  resolveDebugEndpointUrl,
  getDebugEndpointCandidates,
  readNameserverCandidates,
  readRouteGatewayCandidates,
} from "./browser_core";

export type {
  DebugInteropState,
  AutomationContextOptions,
} from "./browser_core";

// Stagehand multi-session manager
export {
  StagehandManager,
  connectStagehand,
  disconnectStagehand,
  getActiveStagehand,
} from "./stagehand_core";

// Task engine
export { TaskEngine } from "./task_engine";
export type { Task, TaskResult, TaskContext } from "./task_engine";

// Telemetry
export { Telemetry, createTelegramAlertHandler } from "./telemetry";

// Health checks
export { HealthCheck } from "./health_check";
export type { HealthReport } from "./health_check";

// Memory store
export { MemoryStore } from "./memory_store";

// Skill system
export type {
  Skill,
  SkillContext,
  SkillManifest,
  SkillAction,
  ActionParam,
  ActionParamType,
  ManifestValidationResult,
} from "./skill";

export { SkillRegistry, validateManifest } from "./skill_registry";
export { SkillMemoryStore } from "./skill_memory";

// Built-in skills
export { publishSite, openCmsCollection, setResponsiveBreakpoint, openLayerPanel, openStylePanel } from "./skills/framer_skill";
export type { FramerSkillResult } from "./skills/framer_skill";

// Daemon
export { Daemon } from "./daemon";
export type {
  DaemonConfig,
  DaemonStatus,
  DaemonStatusRecord,
  TaskIntent,
  ResumePolicy,
} from "./daemon";

// Scheduler
export { Scheduler } from "./scheduler";
export type { ScheduledTask } from "./scheduler";

// Proxy management
export {
  ProxyManager,
  loadProxyConfigs,
  toPlaywrightProxySettings,
} from "./proxy_manager";
export type { ProxyConfig } from "./proxy_manager";

// Captcha solving
export { CaptchaSolver } from "./captcha_solver";

// Stealth
export { createStealthContext } from "./stealth";

// Network interception
export {
  NetworkInterceptor,
  captureJsonResponse,
  blockResource,
  mockResponse,
} from "./network_interceptor";
export type { RouteHandler } from "./network_interceptor";

// File helpers
export {
  DownloadManager,
  uploadFile,
  uploadFiles,
  uploadWithDragDrop,
  validateFilePath,
} from "./file_helpers";

// AI agent
export { AIAgent, GuardrailError } from "./ai_agent";

// Paths / data directory
export {
  getDataHome,
  ensureDataHome,
  ensureDataHomeAtPath,
  getMemoryStorePath,
  getReportsDir,
  getInteropDir,
  getChromeDebugPath,
  getPidFilePath,
  getLogsDir,
  getSkillsDataDir,
  getDaemonStatusPath,
} from "./paths";

// Config
export { loadConfig, BrowserControlConfig } from "./config";

// CLI
export { parseArgs, runCli } from "./cli";
