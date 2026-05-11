# Upstream Sources Catalog

This document catalogs upstream projects that can inform Browser Control. It is not a dependency list. Each entry records the best reuse mode, current Browser Control coverage, and remaining gaps.

Last reviewed: 2026-05-09

---

## Reuse Modes

- **Adopt as dependency:** maintained, license-compatible, and naturally fits Browser Control.
- **Wrap as optional provider:** useful external runtime or service, but not core.
- **Vendor/adapt:** copy or translate a narrow compatible part with provenance.
- **Study/adapt:** borrow architecture, UX, data model, or tests. Do not copy code.
- **Study only:** useful context, but license, language, scope, risk, or product shape makes code reuse wrong.
- **Avoid:** not useful enough, too risky, unstable, license-hostile, or outside product direction.

---

## Current Implementation Audit

| Area | Current Browser Control Status | Main Evidence | Missing / Partial |
|---|---|---|---|
| A11y browser action model | Implemented concept | `src/a11y_snapshot.ts`, `src/browser/actions.ts`, MCP ref tools | Needs stronger iframe/shadow DOM, React tree introspection, SPA navigation helpers, Web Vitals, init scripts, resource route filtering. |
| Native terminal engine | Implemented | `src/terminal/*`, terminal resume tests | Browser-rendered terminal is a simple semantic adapter, not full wterm/libghostty terminal rendering. |
| Browser terminal view | Partial | `src/terminal/render.ts`, `web/src/pages/*` | Simple semantic render adapter exists. No full VT renderer, DOM-native terminal input, multiplexed terminal panes, or wterm/localterm integration. |
| Stable local URLs | Partial | `src/services/*`, `bc service register/resolve`, `bc://name` | No real `.localhost` proxy, HTTPS CA, OS startup, hidden random ports, worktree subdomains, Tailscale/public sharing. |
| Remote browser providers | Partial | `src/providers/local.ts`, `custom.ts`, `browserless.ts` | No Browserbase provider, no provider health scoring, no provider marketplace, no anti-detect provider policy profile. |
| Workflow graph | Implemented v1 | `src/workflows/*`, API/CLI/MCP workflow surface | Linear graph only. No conditional branching, loops, typed state transitions, graph UI editor, event streaming, or LangGraph-compatible persistence model. |
| Self-healing harness | Implemented v1 | `src/harness/*`, local-temp sandbox | Registry/validation exists. Missing agent helper generation loop, hot-load execution adapter, browser replay tests, Docker/CubeSandbox/E2B providers. |
| Automation packages | Implemented v1 | `src/packages/*`, `automation-packages/tradingview-ict-analysis/` | Local install/run/eval only. Missing registry/marketplace, signing, trust review workflow, package UI generation, remote package sources. |
| Package/eval proof | Partial | `src/packages/eval.ts`, `src/benchmarks/*` | Needs real benchmark suites, browser-use/Webwright comparison tasks, dashboards, pass-rate reporting. |
| Pro dashboard / generated UI | Partial | `web/src/App.tsx`, `src/web/server.ts`, `src/operator/generated_ui.ts` | Custom React UI plus native allowlisted JSON UI schema/action dispatcher exists. No json-render runtime, devtools, directives, renderer catalog, generated package config UI, or terminal-grade UI polish. |
| Credential safety | Partial | redaction, policy credential gate, data-home `secrets/` folder | No real credential vault, OS keychain/DPAPI, per-site secret grants, reveal/typing approvals, rotation, or secret-use audit UI. |
| Privacy/network control | Partial | `src/browser/network_interceptor.ts`, `src/observability/network_capture.ts`, policy blocked domains | Request intercept/block/mock/capture primitives exist. No uBlock/Pi-hole-style filter-list engine, subscriptions, tracker/ad profiles, request audit UI, or DNS/proxy rule packs. |
| Memory / site knowledge | Implemented v1 | `src/knowledge/*` | Markdown/local query only. No Qdrant/PageIndex backend, semantic/site-memory ranking, stale locator scoring, or package-level memory sync. |
| Local model / provider router | Partial | `src/ai_agent.ts`, OpenRouter/Stagehand config | Goal executor, OpenRouter model config, Stagehand hooks, and cost cap exist. No Ollama/OpenAI-compatible local API, multi-provider router, fallback graph, or chat-agent provider abstraction. |
| Record/replay builder | Partial | screencast/action timeline in `src/observability/screencast.ts` | No workflow recorder that turns live actions into package/workflow drafts. |
| Visual diff/debug | Partial | screenshots, debug bundles, screencast receipts, `src/snapshot_diff.ts` | A11y snapshot diff exists. No screenshot pixel diff, DOM structural diff, before/after visual comparison, visual regression gate, or replay debugger. |
| CAPTCHA solver | Implemented v1 | `src/captcha_solver.ts`, `tests/unit/captcha_solver.test.ts` | 2captcha/Anti-Captcha/CapSolver support exists. Cap-style proof-of-work anti-abuse for public APIs/marketplace is separate and missing. |
| Stealth / anti-detect controls | Partial and opt-in | `src/stealth.ts`, local provider stealth capability | Native stealth init-script controls exist. No Camofox/Cloak/Obscura provider; these remain risky/experimental and should not be defaults. |

---

## High-Priority Sources

### vercel-labs/json-render
- **Repo:** https://github.com/vercel-labs/json-render
- **Use for:** Pro dashboard, generated automation package UIs, config forms, devtools, component catalog, custom directives such as secret masking.
- **Recommended mode:** Adopt as dependency for web/dashboard layer if API stays stable. Keep core engine independent.
- **Current status:** Partial native equivalent. `src/operator/generated_ui.ts` validates allowlisted JSON UI components and action dispatch, but the project does not use the json-render package, devtools, directives, or renderer catalog.
- **Best next feature:** `JsonRenderPackagePanel` that renders package config/actions from manifest `uiSpec`.

### vercel-labs/wterm
- **Repo:** https://github.com/vercel-labs/wterm
- **Use for:** Browser-rendered terminal, semantic DOM terminal, full VT rendering, web dashboard terminal.
- **Recommended mode:** Vendor/adapt or dependency behind `src/terminal/render.ts`.
- **Current status:** Partial native adapter only.
- **Best next feature:** Full browser terminal pane backed by Browser Control PTY sessions.

### microsoft/Webwright
- **Repo:** https://github.com/microsoft/Webwright
- **Use for:** Terminal-native web-agent harness where model writes reusable Playwright scripts instead of one-click-at-a-time actions.
- **Recommended mode:** Study/adapt. Do not replace Browser Control action model.
- **Current status:** Missing.
- **Best next feature:** "scripted web workflow" node in workflow graph: agent can generate, run, save, and re-run bounded Playwright scripts through policy.

### browser-use/browser-harness
- **Repo:** https://github.com/browser-use/browser-harness
- **Use for:** Self-healing helper generation, interaction skills, domain skills.
- **Recommended mode:** Study/adapt.
- **Current status:** Partial. Registry, validation, and local-temp sandbox exist.
- **Missing:** Automatic helper authoring, task replay validation, activation into current browser workflow.

### browser-use/workflow-use
- **Repo:** https://github.com/browser-use/workflow-use
- **Use for:** Deterministic/self-healing browser workflow patterns and RPA-style workflow generation.
- **Recommended mode:** Study/adapt.
- **Current status:** Partial via Browser Control workflow/package system.
- **Missing:** Workflow generation from task or recording, self-healing browser replay loop.

### langchain-ai/langgraph
- **Repo:** https://github.com/langchain-ai/langgraph
- **Use for:** Durable graph workflows, human-in-loop, persistence, resumable state.
- **Recommended mode:** Study/adapt first. Consider optional JS dependency only if it fits.
- **Current status:** Implemented v1 linear graph.
- **Missing:** Branching, loops, durable state editing, human approval UI, event-stream observability.

### TencentCloud/CubeSandbox
- **Repo:** https://github.com/TencentCloud/CubeSandbox
- **Use for:** Future isolated sandbox provider for generated helpers and unsafe package tests.
- **Recommended mode:** Study/adapt interface now; wrap as optional provider later.
- **Current status:** Missing except local-temp sandbox abstraction.
- **Missing:** Docker/E2B/CubeSandbox provider adapters, network isolation, resource quotas.

### vercel-labs/just-bash
- **Repo:** https://github.com/vercel-labs/just-bash
- **Use for:** In-process bash/virtual filesystem sandbox for helper tests and package evals.
- **Recommended mode:** Adopt or vendor/adapt if compatible.
- **Current status:** Missing.
- **Best next feature:** Safer local sandbox backend before heavy CubeSandbox.

### vercel-labs/quickjs-wasi
- **Repo:** https://github.com/vercel-labs/quickjs-wasi
- **Use for:** Lightweight JS/WASI sandbox for untrusted package helpers.
- **Recommended mode:** Study/adapt or optional sandbox backend.
- **Current status:** Missing.

### vercel-labs/portless
- **Repo:** https://github.com/vercel-labs/portless
- **Use for:** `.localhost` stable names, HTTPS, hidden app ports, worktree subdomains, OS startup, Tailscale/public sharing.
- **Recommended mode:** Optional dependency/wrapper. Keep `bc://name` default.
- **Current status:** Partial native service registry only.
- **Missing:** Full Portless-style proxy.

### LocalCan/LocalCanApp
- **Repo:** https://github.com/LocalCan/LocalCanApp
- **Use for:** Local domains, HTTPS, persistent public URLs, developer-friendly proxy UI.
- **Recommended mode:** Study/adapt alongside Portless.
- **Current status:** Missing.

### gorhill/uBlock
- **Repo:** https://github.com/gorhill/uBlock
- **Use for:** Request filtering model, filter-list semantics, per-site switches, tracker/ad blocking.
- **Recommended mode:** Study only. GPL-3 code must not be copied into MIT Browser Control.
- **Current status:** Partial. Browser Control has Playwright request intercept/block/mock/capture primitives and policy blocked domains. It does not have a filter-list engine or tracker/ad profile system.
- **Best next feature:** Native light network blocker that consumes safe blocklists through Browser Control policy.

### pi-hole/pi-hole
- **Repo:** https://github.com/pi-hole/pi-hole
- **Use for:** DNS sinkhole model, blocklist management, privacy dashboard concepts.
- **Recommended mode:** Study only.
- **Current status:** Missing as DNS/proxy feature. Some browser-level request blocking primitives exist.

### Open-WebUI/Open-WebUI
- **Repo:** https://github.com/Open-WebUI/Open-WebUI
- **Use for:** Local chat UX, model provider settings, tool/plugin UX, OpenAI-compatible provider patterns.
- **Recommended mode:** Study only. Do not clone product.
- **Current status:** Missing as chat product/API surface. Browser Control has an OpenRouter-backed goal executor but no Open-WebUI-style provider settings UI or OpenAI-compatible local API.

### ollama/ollama
- **Repo:** https://github.com/ollama/ollama
- **Use for:** Local/offline model backend.
- **Recommended mode:** Wrap as optional provider.
- **Current status:** Missing. Current AI agent path is OpenRouter/Stagehand-oriented, not Ollama/local-first.

### qdrant/qdrant
- **Repo:** https://github.com/qdrant/qdrant
- **Use for:** Optional vector memory backend for site knowledge, package retrieval, debug search.
- **Recommended mode:** Optional adapter, not default.
- **Current status:** Missing.

### VectifyAI/PageIndex
- **Repo:** https://github.com/VectifyAI/PageIndex
- **Use for:** Vectorless long-document/site-doc memory, tree-index reasoning.
- **Recommended mode:** Study/adapt. Good alternative to default vector DB.
- **Current status:** Missing.

### run-llama/llama_index
- **Repo:** https://github.com/run-llama/llama_index
- **Use for:** RAG ingestion/query patterns.
- **Recommended mode:** Study only. Python-heavy.
- **Current status:** Missing.

### vibrantlabsai/ragas
- **Repo:** https://github.com/vibrantlabsai/ragas
- **Use for:** RAG/answer quality evaluation ideas.
- **Recommended mode:** Study/adapt after memory/RAG exists.
- **Current status:** Missing.

### firecrawl/firecrawl
- **Repo:** https://github.com/mendableai/firecrawl
- **Use for:** LLM-ready web crawling/extraction pipeline design.
- **Recommended mode:** Study only or optional external connector. AGPL code should not be copied.
- **Current status:** Missing.

### vercel-labs/agent-skills / vercel-labs/skills
- **Repos:** https://github.com/vercel-labs/agent-skills, https://github.com/vercel-labs/skills
- **Use for:** Automation package install UX, package metadata, marketplace/registry patterns.
- **Recommended mode:** Study/adapt.
- **Current status:** Partial via `src/packages/*`.
- **Missing:** Remote install command, registry search, package signing, trust UI.

### vercel-labs/open-agents
- **Repo:** https://github.com/vercel-labs/open-agents
- **Use for:** Cloud agent architecture, sandbox/executor separation, GitHub app workflow.
- **Recommended mode:** Study only for future cloud/team mode.
- **Current status:** Missing.

### vercel-labs/agent-browser
- **Repo:** https://github.com/vercel-labs/agent-browser
- **Use for:** A11y snapshot/ref action model, React introspection, Web Vitals, SPA nav, init scripts, resource filtering, cookie import.
- **Recommended mode:** Study/adapt. Browser Control owns TypeScript implementation.
- **Current status:** Core a11y/ref model implemented. Newer advanced diagnostics missing.

### browser-use/browser-use
- **Repo:** https://github.com/browser-use/browser-use
- **Use for:** Agent-browser UX, auth profile sync concepts, setup/doctor flows, benchmarks.
- **Recommended mode:** Study/adapt, no Python architecture dependency.
- **Current status:** Partial.

### browser-use/desktop
- **Repo:** https://github.com/browser-use/desktop
- **Use for:** Desktop packaging and operator app UX.
- **Recommended mode:** Study only.
- **Current status:** Partial Electron desktop wrapper exists.

### browser-use/web-ui
- **Repo:** https://github.com/browser-use/web-ui
- **Use for:** Browser automation UI flows, task panel, run history.
- **Recommended mode:** Study only.
- **Current status:** Partial custom dashboard exists.

### browser-use/react-pdf-highlighter
- **Repo:** https://github.com/browser-use/react-pdf-highlighter
- **Use for:** PDF evidence annotation and review UI.
- **Recommended mode:** Adopt/adapt only if PDF evidence becomes priority.
- **Current status:** Missing.

### Browserbase / Stagehand
- **Repos:** https://github.com/browserbase/stagehand, https://github.com/browserbase/mcp-server-browserbase
- **Use for:** Browserbase provider, AI-native browser actions, remote browser sessions, extraction.
- **Recommended mode:** Optional provider/integration. Browser Control already has Stagehand peer dependency.
- **Current status:** Partial. Browserless/custom providers exist; Browserbase missing.

### tiagozip/cap
- **Repo:** https://github.com/tiagozip/cap
- **Use for:** Marketplace/API anti-abuse, proof-of-work challenge, M2M public endpoint protection.
- **Recommended mode:** Adopt later for public website/API, not local core.
- **Current status:** Missing and not needed yet. Do not confuse with existing CAPTCHA solving support in `src/captcha_solver.ts`.

### deepsec
- **Source:** https://vercel.com/blog/introducing-deepsec-find-and-fix-vulnerabilities-in-your-code-base
- **Use for:** Security harness, sandbox fanout, pluggable coding agents, audit packages.
- **Recommended mode:** Study/adapt for future `bc audit security`.
- **Current status:** Missing.

### react-doctor
- **Source:** `npx react-doctor@latest`
- **Use for:** Dashboard/web package quality checks.
- **Recommended mode:** Optional dev/CI tool only.
- **Current status:** Missing.

### vercel-labs/ai-cli
- **Repo:** https://github.com/vercel-labs/ai-cli
- **Use for:** CLI AI model tooling and multimodal generation patterns.
- **Recommended mode:** Study only.
- **Current status:** Missing.

---

## Medium-Priority / Later Sources

| Project | Use For | Recommended Mode | Current Status |
|---|---|---|---|
| langchain-ai/langchain | Provider/integration ecosystem, docs patterns | Study only | Missing |
| crewAIInc/crewAI | Enterprise positioning, flows/crews vocabulary | Study only | Missing |
| taracodlabs/aiden | Local-first AI OS UX, installer, provider routing, memory graph | Study only due likely copyleft/product mismatch | Missing |
| punkpeye/awesome-mcp-servers | Distribution/listing, integration categories | Study/adapt docs/marketing | Missing |
| Shubhamsaboo/awesome-llm-apps | Automation package examples/templates | Study/adapt package ideas | Missing |
| levelsio/superlevels | OSS catalog/discovery inspiration | Study only | Missing |
| clash-verge-rev/clash-verge-rev | Proxy profiles/rule UI | Study/adapt for network profiles | Partial proxy manager exists |
| trailbaseio/trailbase | Single-binary local backend, SQLite/auth/admin UI ideas | Study only | Partial SQLite/local app exists |
| voidzero-dev/rolldown | Faster web build pipeline | Adopt later if Vite/Rolldown migration is easy | Web app currently Vite; no explicit Rolldown migration |
| vercel-labs/zero-native | Future lightweight desktop/mobile shell | Study only; Electron works now | Electron desktop exists |
| millionco/localterm | Browser terminal UX | Study/adapt with wterm | Partial render adapter only |
| open-mercato/open-mercato | Admin/CRM package example category | Study only | Missing |
| n8n-io/n8n | Workflow automation catalog and integration UX | Study only | Browser Control should not become n8n |
| promptfoo/promptfoo | LLM prompt/tool evals | Optional dev dependency later | Missing |
| microsoft/markitdown | Document-to-markdown ingestion for package knowledge | Optional helper/package dependency | Missing |
| crawl4ai / trafilatura | Web extraction for site knowledge | Optional connector/package | Missing |
| litellm / LocalAI / LM Studio / Jan | OpenAI-compatible local/provider patterns | Study/wrap later | Missing |

---

## Experimental / Risky Browser Providers

| Project | Use For | Recommendation | Reason |
|---|---|---|---|
| jo-inc/camofox-browser | Optional anti-detect/headless provider | Experimental only, never default | Native stealth scripts exist, but anti-detect provider positioning raises abuse/support risk. |
| CloakHQ/CloakBrowser | Patched Chromium/fingerprint provider | Avoid for now | High abuse risk, binary trust/licensing concerns, not needed for safe automation product. |
| h4ckf0r0day/obscura | Lightweight/stealth browser backend | Avoid or experimental only | Reported instability and anti-detect risk. |

---

## Low-Fit / Do Not Prioritize

| Project | Decision | Reason |
|---|---|---|
| iv-org/invidious | Avoid | Privacy frontend for YouTube. AGPL/legal friction. Not Browser Control core. |
| abus-aikorea/voice-pro | Avoid | Media dubbing stack, unrelated to browser/terminal automation core. |
| caamer20/Telegram-Drive | Avoid | Storage workaround, unrelated and policy-risky. |
| nativefier | Avoid | Archived/unmaintained; use Electron/Tauri/zero-native study instead. |
| py-ai | Avoid | Python SDK not relevant to TypeScript core. |
| AI beginner/tutorial repos | Avoid for implementation | Useful learning material only, not production source. |
| Fine-tuning stacks such as unsloth/axolotl/trl | Avoid for now | Browser Control should route models, not train them. |
| GPU inference stacks such as vLLM/Ray Serve/Triton | Avoid for now | Overkill for local automation engine. |
| Game engines, media apps, ERP/CRM products from generic OSS lists | Avoid unless used as test targets | Not Browser Control infrastructure. |

---

## Section -> Source Mapping

| Section / Future Area | Primary Sources | Recommended Mode |
|---|---|---|
| 04 Policy Engine | None | Reimplement; Browser Control differentiator |
| 05 Action Surface | browser-use, agent-browser, Webwright | Study/adapt |
| 06 A11y Snapshot | agent-browser, camofox-browser concepts | Study/adapt; avoid anti-detect defaults |
| 07 MCP Integration | chrome-devtools-mcp, awesome-mcp-servers, Browserbase MCP | Study/adapt |
| 08 Browser Profiles | browser-use, Browserbase, agent-browser cookie import | Study/adapt |
| 09 Knowledge System | browser-harness, Qdrant, PageIndex, LlamaIndex | Study/adapt; optional adapters |
| 10 Observability | chrome-devtools-mcp, Browserbase trace ideas, Webwright evidence | Study/adapt |
| 11 Operator UX | browser-use, agent-browser doctor, Open-WebUI settings | Study/adapt |
| 12 Browser Terminal | wterm, localterm | Adopt/adapt |
| 13 Terminal Resume | wterm, just-bash | Study/adapt |
| 14 Stable URLs | portless, LocalCan | Optional dependency/wrapper |
| 15 Remote Provider | Browserbase, Browserless, Stagehand, Camofox experimental | Wrap providers |
| 16 Benchmarks | browser-use, Webwright, agent-eval, promptfoo | Study/adapt |
| 28 Pro Dashboard | json-render, Open-WebUI, browser-use web-ui | Adopt/study |
| 29 Workflow + Harness | LangGraph, workflow-use, browser-harness, just-bash, CubeSandbox | Study/adapt; optional sandbox providers |
| 30 Packages + Marketplace | agent-skills, skills, awesome-llm-apps, Cap | Study/adapt; Cap later |
| 31 Privacy + Credential Safety | uBlock, Pi-hole, Clash Verge, OS keychain patterns | Study/adapt; reimplement policy core |
| 32 Record/Replay + Memory | Webwright, workflow-use, Qdrant, PageIndex | Study/adapt |
| 33 Local Model Router/API | Open-WebUI, Ollama, LiteLLM, LocalAI | Wrap optional providers |
| 34 Visual Diff + Audit UI | Browserbase trace, react-pdf-highlighter, debug tooling | Study/adapt |
| 35 Localhost Proxy + Team/Cloud | portless, LocalCan, open-agents, Cap | Optional wrappers/study |

---

## License / Risk Rules

- GPL/AGPL projects such as uBlock, Pi-hole, Firecrawl, Invidious, and some app products are **study only** unless Browser Control intentionally accepts reciprocal-license obligations.
- Anti-detect/fingerprint-bypass projects are **never default providers**. If ever added, they need explicit policy, abuse warnings, and opt-in configuration.
- Browser Control core owns policy, execution router, session model, CLI/API/MCP contracts, audit model, package permission model, and local data-home layout.
- Before vendoring code, verify current license, copy only narrow code, add provenance, and isolate behind adapter interfaces.
