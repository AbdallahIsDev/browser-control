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

// Browser connection / profiles / auth (Section 8)
export {
  BrowserConnectionManager,
  createConnectionManager,
} from "./browser_connection";

export type {
  BrowserConnectionMode,
  BrowserTargetType,
  BrowserConnectionStatus,
  BrowserConnection,
  ConnectOptions,
} from "./browser_connection";

export {
  BrowserProfileManager,
  getProfilesDir,
  getProfileDataDir,
  getProfileRegistryPath,
} from "./browser_profiles";

export type {
  ProfileType,
  BrowserProfile,
  ProfileMetadata,
} from "./browser_profiles";

export {
  exportAuthSnapshot,
  importAuthSnapshot,
  saveAuthSnapshotToStore,
  loadAuthSnapshot,
  deleteAuthSnapshot,
  listAuthSnapshots,
  saveAuthSnapshot,
  restoreAuthSnapshot,
} from "./browser_auth_state";

export type {
  AuthSnapshot,
  CookieRecord,
  ExportOptions as AuthExportOptions,
  ImportOptions as AuthImportOptions,
} from "./browser_auth_state";

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
  getProfilesDir as getProfilesDirPath,
} from "./paths";

// Config
export { loadConfig, BrowserControlConfig } from "./config";

// CLI
export { parseArgs, runCli } from "./cli";

// Policy engine
export type {
  ExecutionPath,
  RiskLevel,
  PolicyDecision,
  PolicyTaskIntent,
  RoutedStep,
  PolicyEvaluationResult,
  ExecutionContext,
  CommandPolicy,
  FilesystemPolicy,
  BrowserPolicy,
  LowLevelPolicy,
  PolicyProfile,
  ConfirmationHandler,
  PolicyAuditEntry,
  PolicyEngine,
} from "./policy";

export {
  DefaultPolicyEngine,
  getDefaultPolicyEngine,
  resetDefaultPolicyEngine,
} from "./policy_engine";

export {
  SAFE_PROFILE,
  BALANCED_PROFILE,
  TRUSTED_PROFILE,
  getBuiltInProfile,
  listBuiltInProfiles,
  getRiskDecisionMatrix,
  validateProfile,
  serializeProfile,
  deserializeProfile,
} from "./policy_profiles";

export {
  ExecutionRouter,
  defaultRouter,
} from "./execution_router";

export {
  PolicyAuditLogger,
  getDefaultAuditLogger,
  resetDefaultAuditLogger,
} from "./policy_audit";

// Section 6: A11y Snapshot + Ref Layer
export {
  snapshot,
  formatSnapshotAsText,
  getInteractiveCount,
} from "./a11y_snapshot";

export type {
  A11yElement,
  A11ySnapshot,
} from "./a11y_snapshot";

export {
  RefStore,
  getPageId,
  globalRefStore,
} from "./browser_core";

export {
  resolveRefTarget,
  resolveRefLocator,
  resolveRefBounds,
} from "./ref_store";

export type {
  RefResolutionResult,
  ResolveRefOptions,
} from "./ref_store";

export {
  queryAll,
  queryFirst,
  queryByRole,
  queryByRoleAndName,
  queryByName,
  findButton,
  findTextbox,
  findLink,
  findHeading,
  findByDescription,
} from "./semantic_query";

export type { SemanticQueryOptions } from "./semantic_query";

export {
  diffSnapshots,
  formatDiffSummary,
} from "./snapshot_diff";

export type {
  SnapshotDiffResult,
  ElementDiff,
  StateChange,
} from "./snapshot_diff";
