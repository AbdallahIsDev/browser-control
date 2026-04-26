**Browser Control Final Roadmap**
This is the final product roadmap based on the clarified vision:

Browser Control is a unified automation engine for AI agents.  
It is not only a browser library. It is a system that lets agents choose the best execution surface for the job:

- `Command path`: native terminal sessions plus file/system operations
- `A11y path`: browser pages, Chromium/Electron apps, and browser-rendered terminals
- `Low-level fallback`: CDP, DOM, network, screenshots, coordinate/vision tools when higher-level paths are insufficient

For `v1`, Browser Control directly owns:

- browser / Chromium / Electron automation
- native terminal sessions
- file / system operations
- permissions / guardrails as a first-class core layer

For `post-v1`, Browser Control may later expand into:

- full desktop GUI automation outside Chromium
- Photoshop / Illustrator native desktop control
- generalized OS mouse/keyboard automation for non-browser apps

The goal for `v1` is simple:

An agent should be able to use Browser Control as one unified engine to complete complex real-world work safely, reliably, and fast.

---

## **Product Principles**

1. Browser Control is an `execution system`, not a demo framework.
2. Terminal-first is the default when commands are faster, safer, and more deterministic.
3. Browser automation is used when the workflow is visual, website-dependent, or UI-bound.
4. Accessibility snapshots are the preferred interaction model for agents.
5. Raw CDP / DOM / coordinate tools are fallbacks, not the default mental model.
6. Permissions are part of the core architecture, not an afterthought.
7. State must survive restarts, disconnects, reloads, and long-running workflows.
8. The system must be consumable by both humans and agents.
9. The system must be composable enough that Codex, Hermes, OpenCloud, or a custom orchestrator can all use the same core.
10. Reliability matters more than novelty.

---

## **Core Architecture**

Before the feature sections, the intended system shape should be explicit.

### **Execution Model**
Every task flows through the same pipeline:

1. `Task intent`
2. `Policy evaluation`
3. `Execution routing`
4. `Path execution`
5. `Observation / verification`
6. `Retry / recovery / escalation`
7. `State persistence`
8. `Telemetry / audit logging`

### **Execution Router**
The router decides which path should run the task or task step.

Preferred order:

1. `Command path`
If the task can be solved cleanly by shell commands, scripts, CLI tools, filesystem operations, or service control, use this first.

2. `A11y path`
If the task requires a browser page or browser-rendered terminal and the necessary targets are available through accessibility snapshot / semantic references, use this.

3. `Low-level fallback`
If the task cannot be completed reliably through command or accessibility layers, fall back to CDP, DOM, network interception, screenshot-based verification, or coordinate tools.

### **Shared Cross-Cutting Layers**
All paths share:

- policy engine
- session manager
- state persistence
- audit logging
- observability / debugging
- MCP integration
- knowledge capture
- retries / recovery

---

## **Priority Order**

### **Mandatory v1**
1. Section 4: Policy Engine + Execution Router
2. Section 5: Agent Action Surface
3. Section 6: Accessibility Snapshot + Ref Layer
4. Section 7: MCP Integration Layer
5. Section 12: Native Terminal Automation Layer
6. Section 13: Terminal Resume and State Serialization
7. Section 8: Real Browser, Profiles, and Session UX
8. Section 9: Knowledge System
9. Section 10: Self-Debugging and Observability
10. Section 11: Operator UX

### **Strong but Later**
11. Section 14: Stable Local URLs
12. Section 15: Remote Browser Provider Layer

### **Last**
13. Section 16: Benchmarks and Examples

---

# **Section 4: Policy Engine + Execution Router**
This is the architectural foundation for the whole product.

## **Purpose**
Browser Control must never behave like an unbounded local agent with silent machine authority by default.  
It must be powerful, but intentionally powerful.

This section defines:

- how tasks are routed
- how risk is classified
- how permissions are enforced
- how users can safely widen authority over time

## **What This Section Must Deliver**
- a policy model that applies across command, browser, and low-level paths
- a router that selects the right path for each task or step
- a risk taxonomy for actions
- allowlists, denylists, and confirmation rules
- profile-based execution modes
- auditability and reproducibility of permissions decisions

## **Default Policy Model**
Use the `Hybrid` model.

Built-in profiles:

- `safe`
- `balanced`
- `trusted`

Even in `trusted`, some operations still require confirmation unless explicitly pre-authorized.

## **Policy Categories**
Policies should be structured, not ad hoc.

### **Command Policies**
Examples:
- allow shell command execution
- deny destructive commands unless confirmed
- allow only a subset of binaries
- restrict write access to approved directories
- restrict network calls from the shell
- restrict process spawning
- restrict service control / daemon control

### **Filesystem Policies**
Examples:
- read-only paths
- writable paths
- deny recursive delete by default
- allow temp directories automatically
- require confirmation for home directory writes
- require confirmation for system-level paths

### **Browser Policies**
Examples:
- allowed domains
- blocked domains
- file upload allowed / denied
- download allowed / denied
- screenshot allowed / denied
- clipboard access allowed / denied
- popup handling behavior
- allow login pages but require confirmation before submitting credentials
- allow browser automation only in explicit sessions

### **Low-Level Policies**
Examples:
- raw CDP access allowed / denied
- coordinate actions allowed / denied
- JS evaluation allowed / denied
- network interception allowed / denied
- cookie export/import allowed / denied
- performance trace allowed / denied
- console/network capture allowed / denied

## **Risk Levels**
Every action should carry one of:

- `low`
- `moderate`
- `high`
- `critical`

Examples:
- `low`: open URL, read title, list files in allowed directory
- `moderate`: type text, create file in allowed directory, run read-only shell command
- `high`: click submit button, upload file, overwrite file, export cookies
- `critical`: delete files recursively, transfer funds, place trade, modify system config, run raw elevated shell commands

## **Decision Behavior**
Policy engine returns one of:

- `allow`
- `allow_with_audit`
- `require_confirmation`
- `deny`

## **Execution Router Responsibilities**
The router is not just a dispatcher. It is a planner at the execution-surface level.

It must decide:

- can this be completed by shell commands faster?
- does this require a browser?
- is the browser target accessible through a11y snapshot?
- is low-level fallback needed?
- should a multi-step task mix paths?

Example:
“Set up my trading environment and open the broker dashboard”

Router output:
- command path: install/check deps
- command path: prepare config files
- browser path: log into dashboard
- low-level path only if browser workflow hits unsupported UI behavior

## **Suggested Interfaces**
```ts
type ExecutionPath = "command" | "a11y" | "low_level";

type PolicyDecision = "allow" | "allow_with_audit" | "require_confirmation" | "deny";

interface TaskIntent {
  goal: string;
  actor: "human" | "agent";
  sessionId: string;
  requestedPath?: ExecutionPath;
  metadata?: Record<string, unknown>;
}

interface RoutedStep {
  id: string;
  path: ExecutionPath;
  action: string;
  params: Record<string, unknown>;
  risk: "low" | "moderate" | "high" | "critical";
}

interface PolicyEngine {
  evaluate(step: RoutedStep, context: ExecutionContext): PolicyDecision;
}
```

## **User Experience**
The user should be able to:
- pick a session policy profile
- inspect effective permissions
- pre-authorize a task scope
- approve a one-off risky action
- revoke a prior grant
- export/import policy presets

## **Non-Goals**
- no invisible “trust me” mode by default
- no free-form string-based permission checks
- no browser-only permission model
- no command-only permission model

## **Success Criteria**
- every action runs through one policy engine
- every risky action is explainable after the fact
- the same policy model governs browser, terminal, and file/system work
- no path bypasses policy because it is “internal”

---

# **Section 5: Agent Action Surface**
This is the first major user-facing feature layer.

## **Purpose**
Browser Control currently has runtime-oriented capabilities, but it needs an action-oriented surface that an agent or human can use directly.

This section makes Browser Control feel immediately useful.

## **What This Section Must Deliver**
A direct command and API surface for:
- navigation
- interaction
- extraction
- tab management
- session management
- waiting / synchronization
- file upload/download
- cookies/storage
- shell/session execution
- snapshots and screenshots

## **Why This Matters**
Right now, the internal architecture is stronger than the UX surface.

To an agent, the ideal shape is:
- short command
- deterministic output
- composable
- persistent session
- machine-readable

## **Design Goals**
- every action can be called from CLI
- every action can be called from MCP
- every action can be called from TypeScript API
- outputs can be human-readable or JSON
- sessions persist across commands
- command names are short and obvious

## **CLI Shape**
The CLI should have clear subcommands by surface:

### Browser
- `bc open <url>`
- `bc snapshot`
- `bc click <ref-or-selector>`
- `bc fill <ref-or-selector> <text>`
- `bc type <text>`
- `bc hover <ref-or-selector>`
- `bc press <key>`
- `bc scroll down`
- `bc screenshot`
- `bc tab list`
- `bc tab switch <tabId>`
- `bc close`

### Terminal
- `bc term open`
- `bc term exec "<cmd>"`
- `bc term type "<text>"`
- `bc term snapshot`
- `bc term read`
- `bc term interrupt`
- `bc term close`

### Filesystem / System
- `bc fs ls <path>`
- `bc fs read <path>`
- `bc fs write <path>`
- `bc fs move <src> <dst>`
- `bc fs rm <path>`
- `bc sys process list`
- `bc sys service status <name>`

### Sessions
- `bc session list`
- `bc session create <name>`
- `bc session use <name>`
- `bc session status`

### Common
- `--json`
- `--session <name>`
- `--profile <policy-profile>`
- `--confirm`
- `--headed`

## **API Shape**
The TypeScript API should mirror the CLI.

```ts
const bc = createBrowserControl();

await bc.browser.open("https://example.com");
const snap = await bc.browser.snapshot();
await bc.browser.click("@e3");

const shell = await bc.terminal.open();
await shell.exec("ls -la");

await bc.fs.write("/tmp/test.txt", "hello");
```

## **Output Contracts**
All actions should return structured results.

Example:
```ts
interface ActionResult<T = unknown> {
  success: boolean;
  path: "command" | "a11y" | "low_level";
  sessionId: string;
  data?: T;
  warning?: string;
  error?: string;
  auditId?: string;
}
```

## **Session Model**
Sessions must not be browser-only.
A session should bind:
- policy profile
- browser state
- terminal state
- task history
- filesystem working context
- audit log references

## **Non-Goals**
- do not bury direct browser actions behind only “skills”
- do not force all users through daemon/task scheduling for simple use
- do not create separate tools with separate mental models for browser vs terminal

## **Success Criteria**
- a human can use Browser Control manually without reading internals
- an agent can discover and compose actions quickly
- session persistence works across repeated invocations
- CLI, MCP, and API are consistent

---

# **Section 6: Accessibility Snapshot + Ref Layer**
This is the preferred interaction model for agents.

## **Purpose**
Agents should not default to brittle CSS selectors or screenshots when a stable semantic interaction surface is available.

The a11y snapshot layer gives the agent:
- a compact structural representation of the page or terminal surface
- stable references like `@e1`, `@e2`
- semantic actions with low ambiguity

## **What This Section Must Deliver**
- accessibility snapshot generation
- stable element refs
- ref-based interaction APIs
- semantic filters
- terminal-compatible a11y snapshots for browser-rendered terminals
- snapshot diffing and invalidation

## **Snapshot Output Design**
A snapshot should include:
- element ref
- role
- accessible name
- text content summary
- state metadata
- hierarchy
- interactivity
- optional bounding box metadata

Example:
```json
[
  { "ref": "e1", "role": "heading", "name": "Dashboard", "level": 1 },
  { "ref": "e2", "role": "textbox", "name": "Search" },
  { "ref": "e3", "role": "button", "name": "Submit" }
]
```

CLI view:
```text
- heading "Dashboard" [ref=@e1]
- textbox "Search" [ref=@e2]
- button "Submit" [ref=@e3]
```

## **Ref Semantics**
Refs should be:
- deterministic per snapshot
- short
- session-local
- invalidated or refreshed when DOM meaningfully changes

The agent should not assume refs survive arbitrary navigations unless explicitly stated.

## **Ref Actions**
- `click @e3`
- `fill @e2 "query"`
- `hover @e5`
- `get text @e1`
- `is visible @e7`

## **Fallback Chain**
When the user or agent supplies an action target:

1. ref if present
2. semantic query if present
3. CSS locator if present
4. DOM query
5. coordinate / screenshot fallback only when necessary

## **Terminal A11y Use**
For browser-rendered terminals, the same snapshot concept should work.
This is where `wterm` or similar rendering becomes relevant:
- terminal content exposed as semantic DOM
- cursor, prompt, cells, line structure, copyable text available to snapshot layer
- refs can target lines, prompts, buttons embedded around terminal shells, etc.

## **Important Architectural Boundary**
The a11y snapshot layer is not only for websites.
It is the semantic interaction layer for:
- normal web apps
- Electron apps
- browser-rendered terminals
- rich web editors

## **Implementation Suggestions**
Add modules like:
- `a11y_snapshot.ts`
- `ref_store.ts`
- `semantic_query.ts`
- `snapshot_diff.ts`

## **Snapshot Diff**
Agents need to know whether the page changed.
Provide:
- new elements
- removed elements
- renamed elements
- state changes
- route/title change

This helps:
- reduce unnecessary full snapshots
- drive retries
- detect modal/popover appearance
- detect task completion

## **Non-Goals**
- do not attempt pixel-perfect vision as the default
- do not overfit refs to CSS selectors
- do not make refs globally stable across all time

## **Success Criteria**
- agents can operate mostly via snapshot + refs
- CSS selector usage drops dramatically
- terminal-like browser surfaces can use the same interaction model
- snapshots are compact enough to be LLM-friendly

---

# **Section 7: MCP Integration Layer**
This is how Browser Control becomes agent-native across ecosystems.

## **Purpose**
Browser Control must be easy to plug into:
- Codex
- Hermes
- Cursor
- Claude Code
- Gemini CLI
- OpenCloud
- custom orchestrators

The cleanest way to do this is a first-party MCP server.

## **What This Section Must Deliver**
- Browser Control MCP server
- stable tool schemas
- browser, terminal, and file/system tools exposed over MCP
- session-aware MCP operations
- install docs for major agents
- versioned compatibility promises

## **Why This Matters**
Without MCP, Browser Control remains a library.  
With MCP, it becomes infrastructure.

## **Tool Categories**
### Browser tools
- open page
- snapshot
- click
- fill
- press key
- tab list/switch
- take screenshot
- evaluate script
- wait for condition

### Terminal tools
- open terminal
- run command
- read output
- write input
- interrupt process
- snapshot terminal state

### File/system tools
- read file
- write file
- list directory
- move file
- delete file
- process list
- process kill
- service start/stop/status where supported

### Session tools
- create session
- list sessions
- select session
- get session status
- get session audit trail

### Debug tools
- get console logs
- get network events
- record trace
- get browser health
- export failure bundle

## **MCP Tool Design Rules**
- tools should be narrow and composable
- names should be stable
- results should be structured
- risky tools must still honor policy engine
- all tools should support `sessionId`
- tool descriptions should guide agents toward best-practice usage

## **Example MCP Tool Names**
- `bc_browser_open`
- `bc_browser_snapshot`
- `bc_browser_click`
- `bc_terminal_exec`
- `bc_terminal_snapshot`
- `bc_fs_read`
- `bc_fs_write`
- `bc_session_list`
- `bc_debug_get_console`

## **Versioning**
Tool schemas must be versioned carefully.
Do not break clients casually.

Suggested strategy:
- semantic versioning for MCP surface
- add new tools freely
- do not rename core tools lightly
- keep legacy aliases for a transition period

## **Relationship to chrome-devtools-mcp**
Browser Control should not simply wrap Google’s MCP server and stop there.

Instead:
- borrow good ideas from their tool structure
- optionally interoperate with existing Chrome DevTools MCP setups
- expose Browser Control’s own higher-level browser + terminal + file/system model

## **Non-Goals**
- do not implement ACP now
- do not create a custom protocol before delivering MCP well
- do not make MCP browser-only

## **Success Criteria**
- Codex/Hermes/OpenCloud can use Browser Control directly
- Browser Control tools cover browser, terminal, and file/system work
- setup instructions are clear and tested
- MCP clients can use one session model across all surfaces

---

# **Section 8: Real Browser, Profiles, and Session UX**
This section makes real-world authenticated workflows practical.

## **Purpose**
Most useful automations rely on:
- existing logins
- persistent browser identity
- repeatable sessions
- stable attachment to real Chrome / Chromium

## **What This Section Must Deliver**
- connect to existing browser via CDP
- browser profile reuse
- automation profile management
- saved auth/session state
- isolation modes
- clear UX around shared vs isolated sessions

## **Connection Modes**
1. `Managed automation profile`
Browser Control launches and owns a dedicated automation profile.

2. `Attach to running browser`
Browser Control connects to an existing Chrome/Chromium/Electron session via CDP.

3. `Session restore`
Browser Control rehydrates prior state into a managed browser context.

## **Profile Modes**
- shared automation profile
- isolated temp profile
- named persistent profiles
- import/export auth state

## **What Must Be Clear**
The user should always understand:
- which browser profile is in use
- whether this is their real browser or a dedicated automation browser
- whether cookies/logins persist
- whether this session is isolated
- whether the agent can see all tabs or only controlled tabs

## **Session State**
Persist:
- cookies
- local storage
- session storage where feasible
- tab metadata
- preferred connection target
- auth snapshots where allowed

## **Security**
- exporting auth state is high-risk
- importing auth state is high-risk
- connecting to a real browser with existing tabs is high-risk
- policy engine must govern all of it

## **Electron Support**
Electron and Chromium-based apps should fit into this same connection model when CDP is available.

## **Non-Goals**
- do not overcomplicate with too many browser identity abstractions in v1
- do not pretend all profile reuse is equally safe
- do not mix real-user and automation contexts silently

## **Success Criteria**
- real browser attachment is reliable
- login-heavy workflows are practical
- Electron apps fit naturally into the browser path
- the user always understands what session they are using

---

# **Section 9: Knowledge System**
This is Browser Control’s long-term compounding layer.

## **Purpose**
The system should learn durable browser knowledge from real runs so future runs are faster and less flaky.

## **What This Section Must Deliver**
- reusable interaction mechanics
- reusable domain/site knowledge
- agent-readable formats
- contribution workflow
- validation rules for stored knowledge

## **Knowledge Types**
### `interaction-skills/`
Reusable patterns like:
- dialogs
- dropdowns
- iframes
- cross-origin frames
- uploads
- downloads
- infinite scroll
- shadow DOM
- browser-rendered terminals
- login walls
- file picker flows

### `domain-skills/`
Site-specific knowledge like:
- stable selectors
- route patterns
- hidden pitfalls
- waits
- API endpoints
- navigation shortcuts
- DOM quirks
- framework-specific behavior

## **Storage Rules**
Each knowledge entry should prefer:
- durable facts
- repeatable patterns
- safe information
- non-secret observations

Never store:
- tokens
- cookies
- user-specific content
- step-by-step diary of one run unless explicitly marked as a transient report

## **Capture Triggers**
Knowledge capture should happen when:
- the agent solves a non-obvious interaction
- a selector needed stabilization
- a site had a hidden quirk
- a wait condition was discovered
- a reliable shortcut was found
- a low-level fallback was necessary and should be avoidable later

## **Knowledge Consumer Behavior**
Before starting work on a known domain:
1. search domain knowledge
2. search interaction knowledge
3. apply known patterns
4. only rediscover if needed

## **Validation**
Knowledge files should be linted for:
- missing fields
- secrets
- invalid examples
- duplicate entries
- stale references

## **Non-Goals**
- do not turn this into a giant prompt dump
- do not save everything
- do not confuse site knowledge with session-specific state

## **Success Criteria**
- repeated tasks get faster over time
- low-level fallbacks decrease on known domains
- the system develops reusable site memory
- another AI can read a skill file and use it immediately

---

# **Section 10: Self-Debugging and Observability**
This is how Browser Control stays reliable in long, real workflows.

## **Purpose**
Real automation fails. The system must explain why.

## **What This Section Must Deliver**
- structured logs
- console capture
- network capture
- screenshots
- a11y snapshots
- task trace bundles
- browser health status
- terminal health status
- performance capture where useful
- failure reports for agent retry

## **Debug Bundle**
When a step fails, the system should be able to produce a bundle containing:
- task id
- session id
- execution path
- recent action history
- policy decisions
- browser URL/title
- browser snapshot
- screenshot
- console errors
- network errors
- terminal output tail if relevant
- exception stack
- retry summary

## **Health Checks**
### Browser health
- CDP reachability
- tab/session integrity
- console crash signals
- detached frame detection
- reconnect viability

### Terminal health
- PTY process alive
- shell prompt recognized
- scrollback still attached
- session buffer integrity
- idle/running/interrupted state

### System health
- disk space
- memory usage
- queue pressure
- worker health
- policy/config integrity

## **Performance Instrumentation**
Useful, but not the default for every task.
Should support:
- traces
- network timing
- slow step detection
- memory snapshots where relevant

## **Agent Recovery**
A failed step should not only say “failed.”
It should provide enough structured evidence to answer:
- retry same step?
- choose another path?
- escalate for confirmation?
- require human intervention?

## **Non-Goals**
- do not overload every normal action with expensive tracing
- do not depend entirely on one external debug tool
- do not make observability browser-only

## **Success Criteria**
- failures are diagnosable
- agents can self-correct more often
- long workflows are debuggable after the fact
- browser and terminal paths have equivalent observability quality

---

# **Section 11: Operator UX**
This is what makes the product feel complete.

## **Purpose**
Even a powerful engine feels unfinished if install, config, sessions, and diagnostics are confusing.

## **What This Section Must Deliver**
- `doctor`
- `setup`
- `config`
- `status`
- `sessions`
- clear docs
- polished install flow
- root cleanup and package identity cleanup

## **Doctor**
`bc doctor` should check:
- runtime dependencies
- browser availability
- CDP attachability
- terminal backend availability
- PTY support
- writable data dirs
- policy config validity
- MCP server readiness
- session store integrity

## **Setup**
`bc setup` should guide through:
- install path
- data dir
- browser mode
- automation profile creation
- shell support
- default policy profile
- optional MCP setup
- optional browser attach test
- optional terminal execution test

## **Config**
`bc config` should expose:
- browser settings
- terminal settings
- policy defaults
- session defaults
- logs/telemetry settings
- MCP settings

## **Status**
`bc status` should show:
- active browser sessions
- active terminal sessions
- queued/running tasks
- daemon state
- health summary
- current policy profile

## **Docs Cleanup**
The repo must clearly separate:
- core runtime
- agent-facing usage
- browser usage
- terminal usage
- skill/knowledge system
- operator commands
- examples

## **Non-Goals**
- do not build a GUI dashboard for v1
- do not create wizard-only setup with no scriptable alternative
- do not hide important state in undocumented files

## **Success Criteria**
- install is understandable
- support burden drops
- users trust the system more quickly
- the repo feels product-ready

---

# **Section 12: Native Terminal Automation Layer**
This is a core v1 surface.

## **Purpose**
Agents prefer terminal-first execution whenever possible because it is:
- faster
- cheaper
- less flaky
- more composable
- often more complete than UI control

Browser Control must own native terminal sessions directly.

## **What This Section Must Deliver**
- PTY-backed terminal sessions
- shell lifecycle control
- command execution
- interactive mode
- output capture
- prompt detection
- session persistence
- path routing into terminal by default when appropriate

## **Execution Modes**
### Structured exec mode
Run a command and capture:
- exit code
- stdout
- stderr
- duration
- working directory

### Interactive session mode
Maintain a real shell session:
- prompt
- process state
- long-running command
- streaming output
- stdin input

## **Terminal Abstraction**
A terminal session should expose:
- `open`
- `exec`
- `write`
- `read`
- `snapshot`
- `interrupt`
- `close`
- `cwd`
- `env`
- `history`
- `status`

## **Why PTY Matters**
A true PTY is needed because many tools behave differently without one:
- shell prompts
- full-screen apps
- color output
- REPLs
- trading CLIs
- SSH sessions
- package managers
- interactive setup tools

## **Command Model**
Browser Control must support:
- one-shot commands
- persistent shells
- environment-scoped sessions
- working-directory-aware sessions
- long-running background sessions

## **File/System Ops Relationship**
File and system operations should not all be shell-only.
There should be first-class APIs for:
- reading files
- writing files
- moving files
- listing directories
- deleting files
- stat metadata
- process listing
- process control where appropriate

The router can still choose shell commands internally, but the public model should support structured operations too.

## **Safety Model**
Terminal execution is the highest leverage surface and therefore must be tightly guarded.

Examples:
- harmless reads can be low-risk
- arbitrary shell execution is moderate or high
- recursive delete is critical
- package installs may be high depending on scope
- `sudo`, service modification, registry/system config changes are critical

## **Session State**
Each terminal session should persist:
- shell type
- cwd
- env overlays
- process tree metadata
- prompt signature
- scrollback buffer
- current running command state if possible

## **Cross-Platform**
v1 should define support expectations clearly.
Minimum:
- Windows PowerShell / pwsh
- bash / sh
- maybe zsh where available

Do not assume every shell behaves identically.

## **Non-Goals**
- do not try to support every terminal emulator feature in v1
- do not build a full tmux clone
- do not hide filesystem operations exclusively behind shell commands

## **Success Criteria**
- terminal-first tasks are practical
- agents can use shell sessions predictably
- interactive tools work
- file/system work integrates naturally with terminal sessions

---

# **Section 13: Terminal Resume and State Serialization**
This is core because terminal sessions must survive disruption.

## **Purpose**
If Browser Control owns terminal sessions, it must preserve continuity across:
- frontend reloads
- process restarts
- orchestrator reconnects
- long-running task interruption

## **What This Section Must Deliver**
- terminal state serialization
- resumable terminal sessions
- scrollback preservation
- command continuity
- reconnect behavior
- browser-rendered terminal synchronization when applicable

## **Resume Levels**
### Level 1: Session metadata resume
Restore:
- cwd
- env
- history
- session identity

### Level 2: Buffer resume
Restore:
- current visible content
- scrollback
- cursor position
- prompt state

### Level 3: Process continuity
Detect and reconnect to:
- still-running child process
- shell process
- active job state

## **Native Terminal Resume**
For PTY-owned sessions, Browser Control should try to maintain:
- process handle
- session id
- scrollback buffer
- shell state metadata

If exact process continuity is impossible, it should degrade gracefully:
- restore buffer
- mark session as “reattached” or “reconstructed”
- expose what continuity was lost

## **Browser-Rendered Terminal Resume**
If Browser Control later uses browser-rendered terminals:
- a11y snapshot continuity should survive page reload
- rendered state should be restorable from serialized terminal state
- this is where `wterm` or xterm serialization ideas become useful

## **State Storage**
Persist serialized terminal state in the same durable store as other session state.
Suggested parts:
- `terminal_sessions`
- `terminal_buffers`
- `terminal_jobs`
- `terminal_audit`

## **User/Agent Experience**
The agent should be able to:
- reconnect to a terminal session by name
- inspect whether it is resumed or reconstructed
- know whether a command is still running
- continue from prior buffer state

## **Important Boundary**
Terminal resume is not only visual.
It must preserve enough semantic execution context that the agent can continue confidently.

## **Non-Goals**
- do not promise magical perfect restoration for every arbitrary TUI in v1
- do not overengineer serialization for apps you do not yet support
- do not make browser-rendered terminal resume a dependency for native terminal resume

## **Success Criteria**
- normal shell sessions survive restarts well
- agents can reconnect without losing context
- resume metadata is explicit and trustworthy
- browser and native terminal surfaces can eventually share the same continuity model

---

# **Section 14: Stable Local URLs**
Useful, but not core.

## **Purpose**
Agents struggle with changing localhost ports. Stable local URLs reduce friction during development and local service orchestration.

## **What This Section Must Deliver**
- optional stable local URL support
- named local services
- predictable service endpoints for agents

## **Examples**
- `api.localhost`
- `trading.localhost`
- `dashboard.localhost`

## **Why It Helps**
- better prompts
- easier bookmarks
- more deterministic local service routing
- cleaner multi-service task flows

## **Non-Goals**
- do not make this required for Browser Control v1
- do not block core work behind this

## **Success Criteria**
- local service names are stable when enabled
- agents can refer to services semantically instead of by random ports

---

# **Section 15: Remote Browser Provider Layer**
Useful for scale and deployment.

## **Purpose**
Browser Control should eventually run both:
- locally
- against remote/cloud browser providers

## **What This Section Must Deliver**
- provider abstraction
- provider-specific connection adapters
- common session model above providers

## **Providers**
Examples:
- local Chrome / Chromium
- Browserless-like provider
- Browser Use cloud-like provider
- Browserbase-like provider
- internal provider later

## **Why It Matters**
- CI/CD
- parallel agent execution
- cloud deployment
- shared remote sessions
- region/proxy choice

## **Non-Goals**
- do not make this a v1 blocker
- do not overfit to one external provider

## **Success Criteria**
- provider can change without changing higher-level agent workflow
- Browser Control retains one consistent action surface

---

# **Section 16: Benchmarks and Examples**
This is useful, but intentionally later.

## **Purpose**
Prove reliability and teach usage.

## **What This Section Must Deliver**
### Benchmarks
- real tasks
- repeatable runs
- success rate
- latency
- retry rates
- path usage breakdown

### Examples
- CLI usage
- MCP usage
- Codex/Hermes usage
- browser workflows
- terminal workflows
- combined workflows

## **Why It Matters**
- validates regressions
- makes adoption easier
- helps compare path strategies

## **Why It Is Later**
It becomes much more useful after:
- action surface exists
- MCP exists
- terminal path exists
- browser path exists
- session behavior stabilizes

## **Success Criteria**
- examples reduce onboarding cost
- benchmarks drive future optimization decisions

---

## **Out of Scope for v1**
The following are explicitly not part of the first milestone:

- Photoshop native desktop automation outside Chromium
- raw full-desktop mouse/keyboard automation
- generalized accessibility automation for arbitrary native OS apps
- ACP as a core integration requirement
- IDE-specific companion products like VS Code-only control panels

---

## **Suggested Implementation Phases**

### **Phase A: Foundation**
- Section 4
- Section 5
- Section 6
- Section 7

### **Phase B: Terminal Core**
- Section 12
- Section 13

### **Phase C: Browser Reality**
- Section 8
- Section 10
- Section 11

### **Phase D: Compounding Intelligence**
- Section 9

### **Phase E: Optional Expansion**
- Section 14
- Section 15

### **Phase F: Proof and Adoption**
- Section 16

---

## **Final Product Statement**
When v1 is done, Browser Control should feel like this:

An agent asks for a goal.  
Browser Control routes the work to the best path.  
It executes safely under a built-in permission system.  
It can use native terminal sessions, browser pages, Electron apps, and structured file/system operations.  
It prefers semantic accessibility interactions where possible.  
It falls back to lower-level browser control only when needed.  
It preserves state, explains failures, and gets smarter over time through reusable knowledge.

That is the correct shape of the product.
