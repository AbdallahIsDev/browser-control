# Support Matrix

Docs describe current public product behavior, not future roadmap promises.

## Platforms

| Area | Supported |
|---|---|
| Windows | Yes, primary local development path |
| WSL | Supported for Chrome/CDP interop through launcher metadata and bridge behavior |
| Linux | Supported where Node.js, Chrome/Chromium, and node-pty work |
| macOS | Expected for Node/Chrome paths, less exercised than Windows in this repo |

Node.js `>=22` is required.

## Browser

| Feature | Support |
|---|---|
| Chromium/Chrome CDP | Supported |
| Managed browser launch | Supported |
| Attach to existing CDP endpoint | Supported |
| Accessibility snapshots and refs | Supported |
| Browser profiles/auth snapshots | Supported |
| Remote providers | `local`, `custom`, `browserless` |
| Firefox/WebKit native automation | Not supported as first-class product surface |
| Native desktop apps outside browser | Not supported |

## Terminal

| Feature | Support |
|---|---|
| One-shot exec | Supported |
| Persistent PTY sessions | Supported when `node-pty` works |
| Read/write/interrupt/close | Supported |
| Resume metadata/scrollback | Best-effort |
| Guaranteed recovery of killed child processes | Not supported |

## Filesystem

| Feature | Support |
|---|---|
| Read/write/list/stat | Supported |
| Move/delete | Supported and policy-governed |
| Recursive delete | Supported and high risk |
| Sandbox isolation | Not guaranteed by docs; use policy and scoped directories |

## MCP

| Feature | Support |
|---|---|
| Stdio server | Supported with `bc mcp serve` |
| Browser/session/terminal/fs/debug/status/service/provider tools | Supported |
| Setup/doctor tools | Not exposed through MCP |
| Service register/remove through MCP | Not exposed |
| Raw low-level CDP MCP tools | Not exposed |

## Degraded Mode

If Chrome/CDP is unavailable:

- browser actions fail or report degraded state
- terminal, filesystem, config, status, services, providers, and many debug paths continue

If `node-pty` is unavailable:

- terminal surfaces can fail during startup/import or when opening persistent sessions
- reinstall dependencies and run `bc doctor`; do not assume one-shot terminal execution will work until diagnostics pass

## Out of Scope

- native desktop GUI automation for arbitrary apps
- Photoshop/Illustrator control as a native app surface
- mobile device automation
- public compatibility promises beyond the current CLI/API/MCP behavior
- guaranteed end-to-end workflows for every external service or website
