# UI Plan

## Navigation Model

Use a dense operator layout:

- left sidebar for primary views
- top status strip for daemon/broker/policy/current session
- content area for tables, panels, terminal, evidence viewers

Primary views:

- Overview
- Browser Sessions
- Tasks
- Automations
- Terminal
- Filesystem
- Logs / Audit
- Debug Evidence
- Settings
- Health / Doctor

## Dashboard Layout

Overview shows compact panels:

- runtime status
- daemon/broker status
- active browser sessions
- active terminal sessions
- recent tasks
- recent automation runs
- recent errors
- policy profile
- MCP/tool status
- quick actions

No marketing hero. No decorative background. Dense, readable, responsive.

## Pages and Views

### Browser Sessions

Panels:

- session/page list
- open URL form
- snapshot refs table
- action controls: click/fill/press/type/scroll
- screenshot/debug evidence panel
- failure details panel

States:

- no browser connected
- CDP unavailable
- policy denied
- confirmation required
- snapshot stale

### Tasks

Panels:

- task list table
- create/run task form
- status/result details
- event/log timeline
- debug evidence links

### Automations

Panels:

- schedule table
- create/edit form
- enable/disable/run-now actions
- run logs and history

Delete requires confirmation.

### Terminal

Behavior:

- terminal session tabs
- fixed-height terminal viewport
- scrollback
- command input
- stream output
- interrupt/close controls
- status/exit code badge
- resize if supported
- reconnect/poll fallback
- raw JSON only in collapsible details, not as primary terminal output
- selected session ID auto-filled after open/list

Use semantic rows from `BrowserTerminalView` when available. Keep text selectable.

### Filesystem

Panels:

- allowed roots/workspace selector
- directory tree/table
- file preview/editor
- write/move/delete controls
- permission and confirmation dialogs

Recursive delete requires explicit confirmation text.

### Logs / Audit

Behavior:

- live follow toggle
- filters: level, component, session, action, task, policy
- redaction indicator
- link to evidence/task/session
- copy/export selected redacted entries
- primary tables format ISO timestamps as local time with timezone; raw API/details can keep exact ISO

### Debug Evidence

Views:

- screenshots
- debug bundles
- console capture
- network capture
- screencast receipts/timelines
- redaction status

### Settings / Policy

Views:

- effective config table
- runtime paths
- provider status
- policy profile and risk matrix
- safe editable settings
- restart-required labels

Never show provider tokens or env secrets.

### Health / Doctor

Views:

- doctor run button
- check table
- Chrome/CDP status
- terminal/filesystem availability
- MCP status
- package/runtime version
- actionable fix text

## Tables, Panels, Forms Needed

- status cards with small metrics
- sessions table
- tasks table
- schedules table
- log table
- filesystem table/tree
- config table
- policy matrix
- doctor checks table
- terminal session tabs
- browser snapshot refs table
- debug bundle list

## Empty/Loading/Error States

Every page needs:

- loading skeleton or compact spinner
- empty state with next available action
- disconnected state
- policy denied state
- confirmation required state
- backend capability unavailable state
- retry affordance

## Task Runner Behavior

- validate form before submit
- show submitted task ID immediately
- stream events if available
- poll status if stream disconnected
- show `ActionResult` raw details in collapsible panel

## Automation Editor Behavior

- cron expression field
- human-readable next-run preview if backend provides it
- pause/resume toggles
- destructive delete confirmation
- show unsupported fields as disabled with reason

## Desktop App Shell Behavior

- splash/loading while server starts
- clear startup failure screen
- port conflict recovery: connect to existing verified app server or choose next port
- window title includes runtime state
- no external navigation
- links open externally only after allowlist check

## Responsive Behavior

- desktop: sidebar + multi-column dashboard
- tablet: collapsible sidebar, two-column panels
- mobile: top nav/menu, single-column panels, terminal full-width
- tables become compact with horizontal scroll only where unavoidable

## Accessibility

- keyboard-accessible controls
- labels for icon buttons
- focus trap in dialogs
- color not only signal
- semantic headings and table headers
- terminal output uses readable contrast and ARIA-friendly structure
