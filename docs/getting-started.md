# Getting Started

Browser Control is a unified automation engine for agents and operators. It exposes terminal, filesystem, system, semantic browser, and low-level CDP tools through one runtime.

## Install

```bash
npm install
npm run typecheck
```

Node.js must satisfy the `engines.node` field in `package.json`.

## First Setup

```bash
bc setup --non-interactive --profile balanced
bc doctor
bc status
```

`bc setup` creates the Browser Control data home and user config. Runtime data is stored in `~/.browser-control` by default, or in `BROWSER_CONTROL_HOME` when set.

## First Automation

Start the daemon for broker-backed workflows:

```bash
bc daemon start
bc status
```

For browser workflows, use managed browser mode or attach to an existing Chrome debug session. For terminal-only and filesystem-only workflows, Chrome does not need to be running.

