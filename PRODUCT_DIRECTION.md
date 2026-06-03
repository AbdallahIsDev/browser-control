# PRODUCT_DIRECTION

## Current Strategic Direction

Browser Control is a reusable browser workflow runtime for AI agents.
It is not a coding agent, not an IDE, not a general AI chat application, and not a replacement for Codex, Claude Code, Cursor, or similar agent products.
Browser Control should integrate with those agents, not compete with them.

## Core Product Thesis

General agents repeatedly rediscover the same browser workflows from scratch.
Browser Control exists to reduce that waste.
A successful browser task should become a reusable Automation Package that can be replayed, repaired, versioned, reviewed, and shared.

## Main Value Proposition

Browser Control helps agents:

1. discover a browser workflow once
2. capture the important steps, selectors, screenshots, waits, outputs, and verification rules
3. replay the workflow later with fewer tool calls
4. recover when the website changes
5. save evidence and reports
6. package the workflow for reuse

The main business value is reduced time, reduced token usage, better repeatability, and reusable automation assets.

## Primary Product Surface

The primary product is Automation Packages.
The dashboard and desktop app are experimental/internal operator surfaces for managing packages, runs, evidence, permissions, failures, and repairs.
They should not become a general chat app or AI coding IDE.
They must not be presented as the main production product until stable and redesigned around Automation Packages.

## Supporting Surfaces

CLI, MCP, TypeScript API, terminal, filesystem, workflows, harness, and dashboard exist to support reusable browser automation packages.
CLI, MCP, and API are integration surfaces for existing agents. They exist to create, run, replay, repair, evaluate, and review Automation Packages.
Terminal and filesystem tools exist to support browser workflows, evidence files, reports, package helper scripts, and local verification output.
They are not the product story by themselves.

## What Browser Control Is Not

Browser Control is not:

- a Codex clone
- a Claude Code clone
- a Cursor clone
- a general AI coding assistant
- a general desktop automation tool
- a native OS GUI automation product
- a cloud browser SaaS first
- a general agent app with every possible feature
- a trading bot platform

## Near-Term Target Niche

Focus first on one or two repeatable browser workflow niches:

1. Web app QA automation for developers/agencies
2. CRM/admin/reporting workflows for business operations

Do not build a marketplace, cloud platform, or broad consumer app before proving repeatable workflow value in one niche.

## Priority Rule

When choosing what to build, prioritize features that help with:

1. reliable browser workflow replay
2. automation package creation
3. fewer tool calls on repeated runs
4. evidence/screenshot/report output
5. failure recovery and package repair
6. permission/trust review
7. simple CLI/MCP usage by existing agents

Deprioritize features that make Browser Control look like a full AI agent app.

## Experimental Dashboard Direction

The future dashboard should be package-first and focus on:

- installed automation packages
- run Automation Package
- create package from successful run
- run history
- screenshot/evidence viewer
- failure and repair suggestions
- permissions and risk labels
- token/time/tool-call savings

The dashboard should not be centered around a generic “What should your agent do?” prompt box as the main product identity.

Until this redesign is stable, hide generic prompt-first UI, trading pages, broad terminal-first UX, provider/model-router UI, and non-core advanced surfaces from production/default navigation.

## Automation Package Definition

An Automation Package is a versioned bundle that tells Browser Control how to complete a repeatable browser workflow.

It may include:

- supported websites
- human-readable purpose
- required permissions
- browser steps
- selectors and stable refs
- wait rules
- verification checks
- screenshot/evidence rules
- terminal/filesystem helpers when needed
- repair notes
- tests
- example inputs/outputs

## Development Guardrails

Before implementing any new feature, ask:

1. Does this improve reusable browser workflows?
2. Does this help create, run, repair, evaluate, or share Automation Packages?
3. Does this reduce repeated agent discovery/tool calls?
4. Does this strengthen trust, evidence, or safety?
5. Does this avoid turning Browser Control into a Codex/Claude Code clone?

If the answer is no, do not implement it now.
