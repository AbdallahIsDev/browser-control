# API Contract

## Conventions

Base URL defaults to:

```text
http://127.0.0.1:<appPort>
```

Every browser-origin request must include:

```http
Authorization: Bearer <local-app-token>
```

or:

```http
X-API-Key: <local-app-token>
```

Responses are JSON. Privileged action responses wrap or directly return `ActionResult`.

## Error Schema

```ts
interface ApiError {
  success: false;
  error: string;
  code:
    | "bad_request"
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "policy_denied"
    | "confirmation_required"
    | "capability_unavailable"
    | "internal_error";
  actionResult?: ActionResult;
  details?: unknown;
}
```

## ActionResult Mapping

`ActionResult` fields map without renaming:

```ts
interface ActionResult<T = unknown> {
  success: boolean;
  path: "command" | "a11y" | "low_level";
  sessionId: string;
  data?: T;
  warning?: string;
  error?: string;
  auditId?: string;
  policyDecision?: "allow" | "deny" | "require_confirmation" | "allow_with_audit";
  risk?: "low" | "moderate" | "high" | "critical";
  completedAt: string;
  debugBundleId?: string;
  debugBundlePath?: string;
  recoveryGuidance?: unknown;
  partialDebug?: boolean;
}
```

## HTTP Endpoints

### Status and Capabilities

- `GET /api/status`
- `GET /api/capabilities`
- `GET /api/health`
- `POST /api/doctor/run`

### Config and Policy

- `GET /api/config`
- `GET /api/config/:key`
- `POST /api/config/:key`
- `GET /api/policy/profile`
- `GET /api/policy/profiles`
- `GET /api/audit`

### Sessions

- `GET /api/sessions`
- `POST /api/sessions`
- `POST /api/sessions/use`
- `GET /api/sessions/:id/status`

### Browser

- `GET /api/browser/sessions`
- `POST /api/browser/open`
- `POST /api/browser/snapshot`
- `POST /api/browser/screenshot`
- `POST /api/browser/click`
- `POST /api/browser/fill`
- `POST /api/browser/press`
- `POST /api/browser/type`
- `POST /api/browser/scroll`
- `GET /api/browser/tabs`
- `POST /api/browser/tabs/switch`
- `POST /api/browser/tabs/close`
- `POST /api/browser/close`
- `GET /api/browser/providers`
- `POST /api/browser/providers/use`

### Terminal

- `GET /api/terminal/sessions`
- `POST /api/terminal/sessions`
- `GET /api/terminal/sessions/:id/status`
- `POST /api/terminal/sessions/:id/exec`
- `POST /api/terminal/sessions/:id/input`
- `GET /api/terminal/sessions/:id/read`
- `GET /api/terminal/sessions/:id/snapshot`
- `POST /api/terminal/sessions/:id/resize`
- `POST /api/terminal/sessions/:id/interrupt`
- `DELETE /api/terminal/sessions/:id`

### Filesystem

- `GET /api/fs/list?path=...`
- `GET /api/fs/read?path=...`
- `POST /api/fs/write`
- `POST /api/fs/move`
- `DELETE /api/fs/delete`
- `GET /api/fs/stat?path=...`

### Tasks and Automations

- `GET /api/tasks`
- `POST /api/tasks`
- `POST /api/tasks/:id/run`
- `POST /api/tasks/:id/cancel`
- `GET /api/tasks/:id`
- `GET /api/tasks/:id/events`
- `GET /api/automations`
- `POST /api/automations`
- `POST /api/automations/:id/pause`
- `POST /api/automations/:id/resume`
- `POST /api/automations/:id/run`
- `DELETE /api/automations/:id`

### Logs and Evidence

- `GET /api/logs`
- `GET /api/debug/bundles`
- `GET /api/debug/bundles/:id`
- `GET /api/debug/console`
- `GET /api/debug/network`
- `GET /api/debug/receipts`
- `GET /api/debug/receipts/:id`
- `GET /api/screenshots`

## Request/Response Examples

```ts
interface TerminalExecRequest {
  command: string;
  timeoutMs?: number;
  confirmed?: boolean;
}

type TerminalExecResponse = ActionResult<{
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}>;
```

```ts
interface BrowserSnapshotRequest {
  sessionId?: string;
  rootSelector?: string;
  boxes?: boolean;
}
```

```ts
interface AutomationCreateRequest {
  id: string;
  name: string;
  cronExpression: string;
  skill?: string;
  action?: string;
  params?: Record<string, unknown>;
  enabled?: boolean;
}
```

## WebSocket Endpoints

- `GET /events`
- `GET /api/events`

WebSocket auth uses same token header. If browser WebSocket header constraints require it, token may be accepted as `?token=` only for loopback and redacted from logs.

## Event Stream Schema

```ts
type DashboardEvent =
  | TerminalEvent
  | LogEvent
  | TaskEvent
  | BrowserSessionEvent
  | PolicyAuditEvent
  | RuntimeEvent;

interface BaseEvent {
  id: string;
  type: string;
  timestamp: string;
  sessionId?: string;
  taskId?: string;
  actionId?: string;
}
```

## Terminal Session Event Format

```ts
interface TerminalEvent extends BaseEvent {
  type:
    | "terminal.session.created"
    | "terminal.output"
    | "terminal.status"
    | "terminal.exit"
    | "terminal.closed";
  terminalSessionId: string;
  payload: {
    output?: string;
    rows?: unknown[];
    status?: string;
    exitCode?: number;
  };
}
```

## Log Event Format

```ts
interface LogEvent extends BaseEvent {
  type: "log.entry";
  level: "debug" | "info" | "warn" | "error" | "critical";
  component?: string;
  message: string;
  fields?: Record<string, unknown>;
  redacted: boolean;
}
```

## Task Event Format

```ts
interface TaskEvent extends BaseEvent {
  type:
    | "task.created"
    | "task.started"
    | "task.progress"
    | "task.completed"
    | "task.failed"
    | "task.cancelled";
  taskId: string;
  payload: unknown;
}
```

## Browser Session Event Format

```ts
interface BrowserSessionEvent extends BaseEvent {
  type:
    | "browser.connected"
    | "browser.disconnected"
    | "browser.page.updated"
    | "browser.snapshot"
    | "browser.screenshot"
    | "browser.action";
  payload: {
    url?: string;
    title?: string;
    debugBundleId?: string;
    screenshotPath?: string;
    refs?: unknown[];
  };
}
```

## Policy/Audit Event Format

```ts
interface PolicyAuditEvent extends BaseEvent {
  type: "policy.decision" | "audit.entry";
  action: string;
  policyDecision: string;
  risk: string;
  auditId?: string;
  reason?: string;
}
```

## Auth and Local Access Assumptions

- Loopback only by default.
- Token required for browser-origin HTTP and all event endpoints.
- CORS allowlist defaults to the served app origin only.
- Desktop renderer receives a token scoped to the app-server lifetime.
- No remote access support in first implementation.
