# Browser Control Monetization Strategy

Date: 2026-04-28

Purpose: define how Browser Control can become a premium product without requiring cloud infrastructure first.

## Positioning

Browser Control is not just a browser agent library.

Browser Control is a local automation engine for AI agents:

- browser control
- terminal execution
- filesystem operations
- policy enforcement
- MCP integration
- daemon/session state
- debug evidence
- automation packaging

Simple positioning:

> Browser Control lets Codex, Claude, Cursor, and other agents safely control your browser, terminal, and files from one local engine.

Competitive positioning:

- Browser-use is primarily a browser automation agent framework.
- Browser Control is a local agent operating layer.
- Browser Control owns browser, terminal, filesystem, policy, sessions, MCP, and debugging in one product.

Do not position it as a browser-use clone. Position it as the local automation layer for coding agents and business automations.

## Reality Constraint

Current situation:

- no cloud budget
- no paid model budget
- no hosted browser fleet
- project already works locally
- Codex MCP production smoke passed
- Windows behavior is a strong differentiator

Best path:

- open-source core
- paid local Pro product
- paid automation marketplace
- paid custom automation services
- cloud later, after revenue

Do not start by building SaaS. SaaS adds hosting cost, security burden, model cost, browser infrastructure, support burden, and trust problems.

## Product Model

### Free Open Source Core

Free local engine:

- CLI
- MCP server
- local browser automation
- terminal tools
- filesystem tools
- policy profiles
- debug bundles
- basic knowledge system
- basic automation runner

Goal:

- build trust
- get GitHub stars
- make viral demos possible
- make developers adopt it
- make agencies and power users build on it

### Paid Pro Desktop

Paid local app:

- Windows app first
- Mac app later
- no terminal required for normal users
- chat-style task input
- MCP setup wizard
- browser/profile manager
- automation library
- task history
- screenshots and debug bundle viewer
- skill/automation manager
- safe local API key storage
- one-click update

This is what non-technical users pay for.

### Paid Automation Marketplace

Use the name "Automation Marketplace", not "Skill Marketplace".

Reason:

- "skill" sounds like a prompt file or agent instruction.
- "automation" sounds like a product that performs work.
- users pay for outcomes, not files.

Marketplace sells automation packages:

- lead generation automation
- YouTube Shorts maker
- GitHub PR assistant
- ecommerce admin workflow
- CRM data entry workflow
- report generator
- browser QA workflow
- local app testing workflow
- invoice processing workflow
- content research workflow

Marketplace value:

- creators can sell automations
- Browser Control takes marketplace fee
- users get ready-made workflows
- no cloud browser required at first
- automations run locally through Browser Control

### Paid Custom Automation Service

Fastest money path.

Offer:

- "I automate your workflow using Browser Control."
- customer pays setup fee
- customer runs locally
- you deliver automation package and support

Suggested price:

- simple workflow: $300-$500
- medium workflow: $750-$1500
- business-critical workflow: $2000-$5000

This can make money before SaaS, before marketplace scale, and before polished desktop app.

## Automation Package Definition

Do not call paid items "skills" in marketing.

Internal names can stay technical:

- skill
- domain-skill
- interaction-skill
- helper
- workflow

Public name:

- Automation
- Automation Package
- Workflow
- Bot
- Mission

Recommended final public term:

> Automation Package

Definition:

An Automation Package is a versioned bundle that tells Browser Control how to complete a real task.

It can include:

- metadata
- human description
- required permissions
- required credentials
- supported websites
- browser steps
- terminal steps
- filesystem steps
- selectors and wait rules
- retry rules
- verification checks
- screenshots/debug examples
- generated helper code
- tests

Example package layout:

```text
automation-package/
  manifest.json
  README.md
  workflow.md
  domain-knowledge.md
  helpers/
    index.ts
  tests/
    smoke.test.ts
  examples/
    input.example.json
  permissions.json
```

## Marketplace Rules

Marketplace must protect users.

Every automation package should declare:

- what websites it controls
- what files it reads/writes
- whether it runs terminal commands
- whether it needs login
- whether it handles money/trading/financial actions
- whether it uploads/downloads files
- whether it uses AI model calls
- required API keys
- expected output

Risk labels:

- Safe
- Moderate
- High Risk
- Financial
- Account Access

Marketplace review:

- automated scan
- permission manifest
- smoke test
- user reviews
- version history
- signed package hash

Do not allow "make money while you sleep" trading packages without strong warnings and controls. Financial automation is high-risk and legally sensitive.

Safer wording:

- "trading assistant automation"
- "market monitoring workflow"
- "trade preparation workflow"
- require manual confirmation before real trade execution

## Self-Healing Strategy

Self-healing should not patch Browser Control core.

Correct architecture:

- core stays stable
- harness layer is editable
- generated helpers run in sandbox
- successful helpers can become automation package updates

### Editable Harness

Harness is separate from core.

It can live inside the repo first:

```text
packages/
  core/
  cli/
  mcp/
  harness/
```

The agent may edit:

- harness helpers
- automation package files
- temp generated tools
- tests for generated helpers

The agent must not edit:

- Browser Control core while running user tasks
- policy engine
- filesystem guardrails
- provider registry
- daemon core
- MCP core

### Failure To Helper Loop

Plain meaning:

1. task fails
2. Browser Control classifies failure
3. if failure means "missing helper", agent generates helper in harness
4. helper runs in sandbox
5. helper passes tests
6. helper hot-loads into current task
7. task retries
8. if successful, helper becomes draft automation package update

Example:

- user asks agent to upload CSV to a web app
- existing tools cannot handle custom file picker flow
- agent creates `uploadCsvToWidget()` helper in harness
- helper passes replay test
- task retries and succeeds
- Browser Control offers: "Save this as automation package knowledge?"

### Controlled Self-Patching Sandbox

Plain meaning:

- generated code runs in a controlled temp area
- it cannot silently alter the installed product
- it has limited filesystem and network permission
- it is versioned
- it can be rolled back

Required controls:

- temp workspace
- permission manifest
- policy scan
- typecheck
- smoke test
- replay test when possible
- audit log
- version number
- rollback command

### Domain Knowledge Generation

After a successful task, Browser Control can produce a draft:

- site name
- task type
- reliable selectors
- wait conditions
- known pitfalls
- required login state
- verification steps
- screenshots/debug bundle references

This becomes an Automation Package improvement, not just a markdown note.

## LLM Quickstart

Browser Control needs an LLM quickstart like browser-use.

Goal:

User should be able to tell any coding agent:

> Read this AGENTS.md and install Browser Control for me.

Files needed:

- `AGENTS.md`
- `docs/quickstart/llm.md`
- `docs/quickstart/human.md`

LLM quickstart should include:

- install from npm or GitHub
- run doctor
- configure MCP
- launch browser
- run production smoke test
- cleanup daemon/browser
- common failures
- exact success criteria

Human quickstart should include:

- manual install
- first browser task
- first terminal task
- first filesystem task
- cleanup

This is marketing and onboarding at the same time.

## Pricing

Start simple.

### Free

Price: $0

Includes:

- open-source core
- CLI
- MCP server
- local browser/terminal/filesystem tools
- basic docs
- basic automations

Goal:

- adoption
- trust
- demos
- community

### Pro Desktop

Early price:

- $99 lifetime early access, limited time
- later $19/month or $149/year

Includes:

- desktop app
- local chat UI
- automation manager
- dashboard
- task history
- screenshot/debug viewer
- one-click MCP setup
- one-click updates
- Pro automation templates
- self-healing harness preview

### Automation Packages

Price:

- simple package: $19-$49
- advanced package: $79-$199
- business package: $299+

Marketplace fee:

- 20%-30% platform fee

Creator payout:

- 70%-80%

### Custom Automation Service

Price:

- simple: $300-$500
- medium: $750-$1500
- advanced: $2000-$5000

This should be first revenue channel.

### Business License

Price:

- $99/month to $299/month

Includes:

- commercial use license
- priority support
- private automation packages
- team settings
- longer update window
- onboarding call

## Licensing For Local Product

Do not overbuild DRM.

Use light licensing:

- online activation for Pro
- local cached license for 7-30 days
- signed license file
- disable Pro UI/features when expired
- keep free core working
- paid downloads behind account login
- updates require active license

Reason:

- pirates can bypass local apps
- heavy DRM wastes time
- serious users pay for support, updates, reliability, and business use

Best paid value:

- updates
- marketplace access
- Pro UI
- support
- workflow packs
- commercial license

## API Keys And Trust

BYOK should be default at first.

Message:

> Your AI keys stay on your machine. Browser Control stores them locally and never sends them to our servers.

Support:

- OpenAI
- OpenRouter
- Anthropic
- Google
- Ollama
- LM Studio

Do not pay model costs yourself before revenue.

Later:

- add hosted credits
- add team key vault
- add cloud browser

But not now.

## Viral Demo Strategy

Best first viral demo:

> Codex controls my browser, terminal, and files through one local MCP engine.

Show:

1. Codex calls Browser Control MCP.
2. Browser opens `example.com`.
3. Snapshot returns semantic refs.
4. Codex clicks link by ref.
5. Browser Control takes screenshot.
6. Codex runs `node --version`.
7. Filesystem write gets blocked by policy.
8. Codex creates trusted Temp-scoped session.
9. Filesystem write/read/delete succeeds.
10. Final summary shows all calls.

Why this works:

- visual
- real
- not cloud
- shows safety
- shows multi-surface automation
- shows Codex integration

Comparison video:

- do side-by-side only after Browser Control docs and quickstart are polished
- avoid hostile tone
- say "different design goals"
- benchmark real tasks
- show Browser Control advantage on local terminal/filesystem/policy/MCP workflows

## 30 Day Plan

### Week 1: Trust And Onboarding

Goal: make project easy for humans and agents to install.

Tasks:

- write root `AGENTS.md`
- write human quickstart
- write LLM quickstart
- update README positioning
- add "Use with Codex" section
- record Codex MCP production smoke
- add cleanup instructions
- keep Windows manual test doc current

Success:

- user can tell Codex: "install Browser Control"
- Codex can configure MCP and run smoke test
- human can install manually in under 10 minutes

### Week 2: Viral Demo And Landing Page

Goal: make people understand product in 60 seconds.

Tasks:

- create landing page copy
- create demo script
- record Codex MCP demo
- record policy-block recovery demo
- record browser + terminal + fs workflow demo
- publish Twitter/X thread
- publish GitHub README update

Success:

- one clear video
- one clear CTA
- people understand Browser Control is local agent automation engine

### Week 3: Pro Pack Shape

Goal: define first paid thing without cloud.

Tasks:

- design Pro Desktop MVP
- define Pro features
- define early access offer
- create Gumroad/Lemon Squeezy/Polar page if needed
- create "custom automation service" page
- define automation package format
- create 3 example automation packages

Success:

- someone can pay for early access or custom workflow
- product has clear free vs paid split

### Week 4: Marketplace Foundation

Goal: prepare automation marketplace without building full marketplace yet.

Tasks:

- rename public concept from "skills" to "automation packages"
- keep internal skill APIs if needed
- write automation package manifest spec
- write package permission model
- write package review checklist
- add local package install/list/run docs
- create first paid-ready package examples

Success:

- Browser Control can explain what it sells
- creators can understand how to package automations
- buyers can understand risk and value

## First Three Automation Packages

Build these first because they are demo-friendly and safer than financial automation.

### GitHub PR Assistant

Use case:

- open PR
- inspect checks/comments
- summarize issues
- run local commands
- prepare fix plan

Why:

- fits Codex users
- technical audience
- easy to demo

### Local Web App QA

Use case:

- open local app
- click through user flow
- capture screenshots
- report console/network errors

Why:

- Browser Control already has service registry and debug evidence
- useful for developers

### Lead Research Assistant

Use case:

- visit public websites
- collect company/contact info
- export CSV

Why:

- business value is obvious
- sellable as custom service

Avoid first:

- trading bot
- payments bot
- credential-heavy banking tasks
- spam automation

Those create legal, ethical, and safety risk too early.

## Product Principles

1. Local-first wins trust.
2. Open core wins adoption.
3. Pro UI wins non-technical users.
4. Automation packages create marketplace revenue.
5. Custom services create first cash.
6. Cloud waits until revenue.
7. Safety is part of the product, not a warning label.
8. Browser Control sells outcomes, not tools.

## Immediate Next Actions

Do these next:

1. Create root `AGENTS.md` for LLM install.
2. Create `docs/quickstart/human.md`.
3. Create `docs/quickstart/llm.md`.
4. Update README positioning.
5. Write first demo script.
6. Record Codex MCP demo.
7. Create first automation package spec.
8. Create custom automation service offer.

Do not do yet:

- cloud browser hosting
- paid hosted model credits
- complex DRM
- full marketplace website
- financial/trading automations
- enterprise features

## One Sentence Product

Browser Control is the local automation engine that lets AI agents safely use your browser, terminal, and files to complete real work.

## One Sentence Business

Make the core free, sell the polished local app, paid automation packages, and custom workflow implementation, then build cloud only after revenue.
