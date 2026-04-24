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

// ── Section 9: Knowledge System ──────────────────────────────────────

export type {
  KnowledgeKind,
  KnowledgeFrontmatter,
  KnowledgeArtifact,
  KnowledgeEntry,
  KnowledgeSummary,
  KnowledgeQueryFilter,
  ValidationResult as KnowledgeValidationResult,
  ValidationIssue as KnowledgeValidationIssue,
} from "./knowledge_types";

export {
  loadArtifact,
  saveArtifact,
  deleteArtifact,
  pruneArtifact,
  listAllKnowledge,
  listByKind,
  findByDomain,
  findByName,
} from "./knowledge_store";

export { validateArtifact } from "./knowledge_validator";

export {
  queryKnowledge,
  searchInteractionSkills,
  searchDomainKnowledge,
  getEntriesByType,
  getDomainSkill,
  getInteractionSkill,
  listKnownDomains,
  listInteractionSkillNames,
  getKnowledgeStats,
} from "./knowledge_query";

// Knowledge paths
export {
  getKnowledgeDir,
  getInteractionSkillsDir,
  getDomainSkillsDir,
} from "./paths";

// ── Section 12: Native Terminal Automation Layer ──────────────────────

// Terminal session management
export {
  TerminalSessionManager,
  getDefaultSessionManager,
  resetDefaultSessionManager,
  execCommand,
} from "./terminal_session";

export type {
  TerminalSession,
  TerminalSessionConfig,
  TerminalSessionStatus,
  ExecOptions,
  ExecResult,
  TerminalSnapshot,
} from "./terminal_types";

// Terminal exec helpers
export {
  exec,
  execStdout,
  execTest,
  execSequence,
  ExecError,
} from "./terminal_exec";

export type {
  StructuredExecOptions,
  StructuredExecResult,
} from "./terminal_exec";

// Terminal snapshot
export {
  captureSessionSnapshot,
  captureAllSnapshots,
  formatSnapshot,
  formatSnapshotCollection,
} from "./terminal_snapshot";

export type {
  SessionSnapshotCollection,
} from "./terminal_snapshot";

// Terminal prompt detection
export {
  isPromptDetected,
  extractCwdFromPrompt,
  registerCustomPrompt,
  unregisterCustomPrompt,
} from "./terminal_prompt";

// Cross-platform shell detection
export {
  detectShell,
  resolveNamedShell,
  platformShellName,
  isWindowsPlatform,
} from "./cross_platform";

export type { ShellInfo } from "./cross_platform";

// ── Section 13: Terminal Resume and State Serialization ────────────────

export type {
  SerializedTerminalSession,
  TerminalBufferRecord,
  TerminalResumeLevel,
  TerminalResumeStatus,
  TerminalResumeMetadata,
  TerminalResumeResult,
  TerminalResumeConfig,
} from "./terminal_resume_types";

export type { ResumeDecision } from "./terminal_resume";

export {
  serializeTerminalSession,
  validateSerializedSession,
} from "./terminal_serialize";

export {
  TerminalBufferStore,
  TERMINAL_BUFFER_KEY,
  TERMINAL_METADATA_KEY,
  TERMINAL_PENDING_KEY,
} from "./terminal_buffer_store";

export {
  decideResume,
  buildResumeResult,
  loadPersistedState,
  rebuildOutputBuffer,
} from "./terminal_resume";

// Filesystem operations
export {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  listDir as fsListDir,
  moveFile as fsMoveFile,
  deletePath as fsDeletePath,
  statPath as fsStatPath,
  listProcesses,
  killProcess,
  FsError,
} from "./fs_operations";

export type {
  FileReadResult,
  FileWriteResult,
  FileStatResult,
  ListResult,
  ListEntry,
  MoveResult,
  DeleteResult,
  ReadFileOptions,
  WriteFileOptions,
  ListOptions,
  DeleteOptions,
  ProcessInfo,
} from "./fs_operations";

// ── Section 5: Agent Action Surface ────────────────────────────────────

// ActionResult — canonical result model
export {
  successResult,
  failureResult,
  policyDeniedResult,
  confirmationRequiredResult,
  formatActionResult,
} from "./action_result";

export type { ActionResult } from "./action_result";

// Session manager — unified session surface
export {
  SessionManager,
  getDefaultSessionManager as getDefaultActionSessionManager,
  resetDefaultSessionManager as resetDefaultActionSessionManager,
} from "./session_manager";

export type {
  SessionState,
  SessionListEntry,
  PolicyAllowResult,
  PolicyEvalResult,
  TerminalRuntime,
} from "./session_manager";

export {
  isPolicyAllowed,
  probeDaemonHealth,
  LocalTerminalRuntime,
  DaemonTerminalRuntime,
  BrokerTerminalRuntime,
} from "./session_manager";

// Browser actions — canonical browser action surface
export { BrowserActions } from "./browser_actions";

export type {
  BrowserActionContext,
  OpenOptions,
  SnapshotOptions,
  ClickOptions,
  FillOptions,
  HoverOptions,
  TypeOptions as BrowserTypeOptions,
  PressOptions,
  ScrollOptions,
  ScreenshotOptions,
} from "./browser_actions";

// Terminal actions — canonical terminal action surface
export { TerminalActions } from "./terminal_actions";

export type {
  TerminalActionContext,
  TermOpenOptions,
  TermExecOptions,
  TermTypeOptions,
  TermReadOptions,
  TermSnapshotOptions,
  TermInterruptOptions,
  TermCloseOptions,
  TermResumeOptions,
  TermStatusOptions,
} from "./terminal_actions";

// FS actions — canonical filesystem action surface
export { FsActions } from "./fs_actions";

export type {
  FsActionContext,
  FsReadOptions,
  FsWriteOptions,
  FsListOptions,
  FsMoveOptions,
  FsRmOptions,
  FsStatOptions,
} from "./fs_actions";

// Daemon cleanup helpers (shared between CLI and tests)
export {
  isPidAlive,
  killProcessTree,
  killAutomationBrowser,
  cleanupStaleDaemonFiles,
  stopDaemon,
} from "./daemon_cleanup";

// ── Section 14: Stable Local URLs ────────────────────────────────────

export { ServiceRegistry } from "./services/registry";
export type {
  ServiceEntry,
  ServiceRegistryData,
} from "./services/registry";

export {
  resolveServiceUrl,
  isServiceRef,
  mightBeServiceRef,
} from "./services/resolver";
export type { ResolveResult } from "./services/resolver";

export {
  detectDevServer,
  tryDetectDefaultPort,
} from "./services/detector";

export { ServiceActions } from "./service_actions";
export type {
  ServiceActionContext,
  ServiceRegisterOptions,
  ServiceResolveOptions,
  ServiceRemoveOptions,
} from "./service_actions";

// Top-level API facade
export {
  createBrowserControl,
} from "./browser_control";

export type {
  BrowserControlOptions,
  BrowserNamespace,
  TerminalNamespace,
  FsNamespace,
  SessionNamespace,
  ServiceNamespace,
  BrowserControlAPI,
} from "./browser_control";

// ── Section 7: MCP Integration Layer ───────────────────────────────────

export { createMcpServer, startMcpServer } from "./mcp/server";
export { buildToolRegistry, getToolCategories } from "./mcp/tool_registry";
export {
  actionResultToMcpContent,
  actionResultToMcpResult,
  buildSchema,
  sessionIdSchema,
  normalizeError,
  mcpErrorResult,
} from "./mcp/types";
export type { McpTool, McpToolCategory, JSONSchema } from "./mcp/types";

export { buildSessionTools } from "./mcp/tools/session";
export { buildBrowserTools } from "./mcp/tools/browser";
export { buildTerminalTools } from "./mcp/tools/terminal";
export { buildFsTools } from "./mcp/tools/fs";
export { buildDebugTools } from "./mcp/tools/debug";
export { buildServiceTools } from "./mcp/tools/service";
export { buildProviderTools } from "./mcp/tools/provider";

// ── Paths (additional Section 14 helpers) ────────────────────────────

export {
  getServicesDir,
  getServiceRegistryPath,
  getProviderRegistryPath,
} from "./paths";

// ── Section 15: Remote Browser Provider Layer ──────────────────────────

export {
  ProviderRegistry,
} from "./providers/registry";

export type {
  ProviderConfig,
  ProviderRegistryData,
  ProviderSelectionResult,
  ProviderListResult,
} from "./providers/types";

export type {
  BrowserProvider,
  ProviderCapabilities,
  ProviderLaunchOptions,
  ProviderAttachOptions,
  ActiveConnection,
} from "./providers/interface";

export {
  LocalBrowserProvider,
} from "./providers/local";

export {
  CustomBrowserProvider,
} from "./providers/custom";

export {
  BrowserlessProvider,
} from "./providers/browserless";

export {
  ProviderError,
  ProviderConfigError,
  ProviderConnectionError,
  ProviderNotSupportedError,
} from "./providers/errors";

export type {
  ProviderNamespace,
} from "./browser_control";
