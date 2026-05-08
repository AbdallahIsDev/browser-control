# Section 13: Terminal Resume and State Serialization — Implementation Checklist

## Section

- Section: `13 — Terminal Resume and State Serialization`
- Spec: `spec.md`
- Status: `implemented; verification passing; awaiting orchestrator acceptance`

## Implementation Tasks

### Types & Core Modules
- [x] Create `terminal_resume_types.ts` with `SerializedTerminalSession`, `TerminalResumeResult`, `TerminalBufferRecord`, `TerminalResumeStatus`
- [x] Create `terminal_serialize.ts` — capture metadata and buffer from live sessions, produce durable serialized model
- [x] Create `terminal_buffer_store.ts` — save/load buffers to MemoryStore with max size / truncation rules
- [x] Create `terminal_resume.ts` — load serialized state, determine resume level, reconstruct logical session with same id

### Extend Terminal Session Model
- [x] Extend `terminal_types.ts` — add `TerminalResumeStatus`, `TerminalResumeMetadata`, `SerializedTerminalSession`
- [x] Extend `terminal_session.ts` — support optional supplied logical session id, expose history, expose buffer for serialization
- [x] Extend `config.ts` — add `terminalResumePolicy`, `terminalMaxScrollbackLines`, `terminalMaxSerializedSessions`

### Daemon Integration
- [x] Extend `daemon.ts` — serialize active terminal sessions before shutdown, restore pending sessions on startup
- [x] Extend `daemon.ts` `stop()` — enumerate, serialize, persist, then close PTYs
- [x] Extend `daemon.ts` `start()` — scan persisted records, reconstruct sessions, preserve logical ids

### Broker / Action Surface / API / CLI
- [x] Extend `broker_server.ts` — add `resume` and `status` terminal subcommand handlers
- [x] Extend `session_manager.ts` `TerminalRuntime` — add `resume()` and `status()` methods
- [x] Extend `terminal_actions.ts` — add `resume()` and `status()` actions
- [x] Extend `browser_control.ts` — add `bc.terminal.resume()` and `bc.terminal.status()` to API
- [x] Extend MCP terminal tools — add `bc_terminal_resume` and `bc_terminal_status`
- [x] Extend `cli.ts` — add `bc term resume <sessionId>` and `bc term status <sessionId>`
- [x] Update `bc term list` to show resume state
- [x] Update `index.ts` exports

### Tests
- [x] Add `terminal_resume.test.ts` — serialization unit tests, resume decision tests, logical identity tests
- [x] Add daemon lifecycle tests for terminal resume
- [x] Run targeted terminal resume tests
- [x] Run affected terminal / daemon tests
- [x] Run `npm run typecheck`
- [x] Run `npm test`

## Notes

- v1 resume means metadata/buffer continuity, NOT magical process continuity. The spec is explicit about this.
- Secrets in env are redacted during serialization (keys matching common secret patterns are excluded).
- Buffer truncation removes oldest lines first when limit is exceeded.
- Logical session id is preserved across daemon restarts by allowing `TerminalSessionManager.create()` to accept an optional `id`.

## Orchestrator-Only Completion

- [x] Section implementation reviewed and accepted by orchestrator
- [x] Changes committed and pushed by orchestrator with final commit message
