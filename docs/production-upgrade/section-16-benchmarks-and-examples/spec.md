# Section 16: Benchmarks and Examples

## Purpose
Prove reliability and teach usage. Benchmarks validate that Browser Control works well and catches regressions. Examples reduce the cost of adoption by showing real workflows in action.

## Why This Section Matters to Browser Control
A system without benchmarks is a system without proof. A system without examples is a system that only its authors can use. This section provides both: quantitative evidence of reliability and qualitative guides for getting started.

## Priority
This is the **last** section to implement. It becomes much more useful after: action surface exists (Section 5), MCP exists (Section 7), terminal path exists (Sections 12–13), browser path is solid (Sections 6, 8), and session behavior stabilizes. Benchmarks against an unstable surface are meaningless — they test yesterday's code.

## Scope
- Real task benchmarks (not synthetic micro-benchmarks)
- Repeatable benchmark runs with success rate, latency, retry rate, path usage breakdown
- CLI usage examples
- MCP usage examples
- Codex/Hermes integration examples
- Browser workflow examples
- Terminal workflow examples
- Combined workflow examples (browser + terminal + filesystem in one task)

## Non-Goals
- Do not build benchmarks before the core surface is stable
- Do not create examples for features that don't exist yet
- Do not build a benchmark framework from scratch — use simple scripts that measure real tasks
- Do not optimize for benchmark scores over real-world reliability

## User-Facing Behavior
- `bc benchmark run` — runs the full benchmark suite, outputs results
- `bc benchmark run --suite browser` — runs browser-only benchmarks
- `bc benchmark run --suite terminal` — runs terminal-only benchmarks
- `bc benchmark results` — shows historical benchmark results
- `examples/` directory with copy-pasteable workflows

## Agent-Facing Behavior
- Agent can run benchmarks to verify environment setup
- Agent can read examples to understand how to compose Browser Control actions
- Benchmark results provide confidence metrics (success rate, average latency)

## Architecture/Design

### Benchmark Design
Benchmarks are real tasks, not synthetic loops:

**Browser benchmarks:**
- Navigate to a page and take a snapshot (tests CDP connection + a11y snapshot)
- Fill a form and submit (tests interaction + policy evaluation)
- Upload a file (tests file input handling)
- Handle a modal dialog (tests a11y snapshot + wait-for)
- Work within an iframe (tests frame switching)
- Multi-tab workflow (tests tab management)

**Terminal benchmarks:**
- Run a shell command and capture output (tests exec mode)
- Maintain an interactive session across multiple commands (tests session persistence)
- Run a long-running command and interrupt it (tests interrupt handling)
- Execute commands with different working directories (tests cwd management)

**Combined benchmarks:**
- Start a local server (terminal), open it in browser, interact, close server (mixed path)
- Download a file via browser, process it via terminal, upload result via browser (full pipeline)

### Benchmark Metrics
Per benchmark: success/fail, duration (p50, p95, p99), retry count, execution path used, policy decisions made.

Per suite: overall success rate, average duration, path usage breakdown (command %, a11y %, low-level %).

### Benchmark Storage
Results stored in `~/.browser-control/benchmarks/` with timestamps. Historical comparison possible.

### Examples Structure
```
examples/
├── browser/
│   ├── basic-navigation.md
│   ├── form-filling.md
│   ├── login-workflow.md
│   └── multi-tab-workflow.md
├── terminal/
│   ├── basic-exec.md
│   ├── interactive-session.md
│   └── background-process.md
├── combined/
│   ├── dev-server-workflow.md
│   ├── download-process-upload.md
│   └── trading-setup.md
├── mcp/
│   ├── codex-setup.md
│   ├── hermes-setup.md
│   └── claude-code-setup.md
└── skills/
    ├── creating-a-skill.md
    └── packaging-a-skill.md
```

Each example is a markdown file with:
- What it does
- Prerequisites
- Step-by-step CLI commands
- Expected output
- Common issues and fixes

### Example Quality Bar
- Every example must work against the current codebase (CI-verifiable)
- Every example must have copy-pasteable commands
- Every example must show expected output
- Every example must handle the common error case (what happens if Chrome isn't running, etc.)

## Core Components/Modules
- `benchmarks/runner.ts` — benchmark execution, timing, result collection
- `benchmarks/suites/browser.ts` — browser-specific benchmarks
- `benchmarks/suites/terminal.ts` — terminal-specific benchmarks
- `benchmarks/suites/combined.ts` — mixed-path benchmarks
- `benchmarks/results.ts` — result storage and comparison
- `examples/` — example documentation directory

## Data Models/Interfaces
```typescript
interface BenchmarkResult {
  name: string;
  suite: string;
  success: boolean;
  durationMs: number;
  retries: number;
  executionPath: "command" | "a11y" | "low_level";
  policyDecisions: number;
  error?: string;
  timestamp: string;
}

interface BenchmarkSuiteResult {
  suite: string;
  totalBenchmarks: number;
  passed: number;
  failed: number;
  successRate: number;
  avgDurationMs: number;
  pathBreakdown: {
    command: number;
    a11y: number;
    lowLevel: number;
  };
  timestamp: string;
}
```

## Session/State Implications
- Benchmarks create and destroy their own sessions (isolated from user sessions)
- Benchmark results are stored globally, not per-session
- Examples reference sessions but don't create persistent state

## Permissions/Guardrails Implications
- Benchmarks should run under the `balanced` profile by default
- Benchmarks that require `high`/`critical` permissions should be opt-in
- Examples should demonstrate the policy system (show confirmation flows, not bypass them)

## Failure/Recovery Behavior
- If a benchmark fails, record the failure with full context (same as Section 10's debug bundle)
- If benchmark infrastructure itself fails (can't connect to Chrome), report clearly and skip browser benchmarks
- If examples are outdated (commands changed), CI should catch this

## CLI/API/MCP Implications
- CLI: `bc benchmark run [--suite <name>] [--iterations <n>]`
- CLI: `bc benchmark results [--last <n>]`
- CLI: `bc benchmark compare <run1> <run2>`
- MCP: not applicable (benchmarks are developer-facing, not agent-facing)
- API: `bc.benchmark.run(suite?)`, `bc.benchmark.results()`

## Browser/Terminal/FileSystem Path Implications
- Browser benchmarks test the browser path
- Terminal benchmarks test the terminal path
- Combined benchmarks test the execution router's ability to mix paths
- Path usage breakdown in benchmark results shows whether the router is choosing paths effectively

## Dependencies on Other Sections
- **Depends on:** Section 5 (Agent Action Surface) — benchmarks exercise the action surface
- **Depends on:** Section 6 (A11y Snapshot) — browser benchmarks use snapshots
- **Depends on:** Section 7 (MCP) — MCP examples need working MCP
- **Depends on:** Section 8 (Browser Sessions) — benchmarks need browser connections
- **Depends on:** Section 12 (Terminal) — terminal benchmarks need terminal sessions
- **Depends on:** Section 10 (Observability) — benchmark failures produce debug bundles

## Risks/Tradeoffs
- **Risk:** Benchmarks become stale as features change. Mitigation: CI runs benchmarks on every release, outdated benchmarks fail visibly.
- **Risk:** Examples become outdated. Mitigation: examples are executable (testable in CI), not just documentation.
- **Risk:** Benchmark scores invite Goodhart's Law (optimizing for the metric, not the goal). Mitigation: benchmarks test real tasks, not synthetic performance.
- **Tradeoff:** This section is low-priority because it's only valuable after the surface stabilizes. Accepted — premature benchmarks waste effort.

## Open Questions
- Should benchmarks be run in CI automatically? Recommendation: yes, on release branches (not every PR — benchmarks may be flaky due to external dependencies).
- Should benchmark results be public? Recommendation: yes, for open-source credibility.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Borrow structure from upstream, write Browser Control-specific examples.**

Benchmark and example structure is well-established across the open-source automation ecosystem. Browser Control does not need to invent this layer from scratch.

**Upstream sources:**
- **browser-use** (Python) — benchmark structure, example organization, task-based benchmark design.
- Any benchmarks/examples from the linked projects.

**What to reuse:**
- Benchmark structure (real tasks, not synthetic; success rate + latency + retry metrics)
- Example organization patterns (by surface: browser, terminal, combined)
- Example quality bar (copy-pasteable, CI-verifiable, show expected output)

**What NOT to reuse:**
- Do not copy upstream benchmark content — Browser Control benchmarks must test Browser Control's actual execution model
- Do not copy upstream examples — Browser Control examples must demonstrate Browser Control's CLI/API/MCP surface
- Do not assume upstream single-path model — Browser Control benchmarks must cover command + a11y + low_level paths and mixed-path workflows

**Mixed-language note:** browser-use benchmarks are Python. Study the structure and metrics approach, then write Browser Control's benchmarks in TypeScript testing Browser Control's actual actions.

## Implementation Success Criteria
- Examples reduce onboarding cost (new user can run first automation from an example in <5 minutes)
- Benchmarks drive future optimization decisions (path usage breakdown shows where to invest)
- Benchmark suite covers all three execution paths (command, a11y, low-level)
- Examples work against the current codebase (CI-verifiable)
- Benchmark results are stored historically and comparable across versions
- At least one combined workflow example demonstrates the full vision (browser + terminal + filesystem in one task)
