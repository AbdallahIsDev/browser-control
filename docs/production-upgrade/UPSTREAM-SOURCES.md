# Upstream Sources Catalog

This document catalogs upstream projects that can inform Browser Control. It is not a dependency list. Each entry records the best reuse mode, current Browser Control coverage, and remaining gaps.

Last reviewed: 2026-05-16

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
| Browser terminal view | Implemented for current scope | `src/terminal/render.ts`, `web/src/pages/TerminalView.tsx`, terminal/web tests | Semantic VT rendering, resize, copy/paste confirmation, attach/detach, and dashboard API surfaces exist. Full wterm/libghostty-grade rendering remains optional future work. |
| Stable local URLs | Implemented for current scope | `src/services/*`, `src/proxy_manager.ts`, CLI/API/proxy tests | `bc://name` remains default; opt-in HTTP `.localhost`, explicit HTTPS/local CA, startup file management, stable backend restart routing, and doctor checks exist. Tailscale/public sharing remains later-only. |
| Remote browser providers | Partial | `src/providers/*`, provider health/API/CLI/MCP/UI tests | Browserless/custom and Browserbase adapter/health/catalog exist with redaction and policy gates. Real Browserbase launch/attach remains blocked until credentials are configured. |
| Workflow graph | Implemented for current scope | `src/workflows/*`, API/CLI/MCP/UI workflow tests | Branches, loops, state edits, event streams, approvals, helper nodes, and runtime persistence exist. A full visual graph editor remains future UX work. |
| Self-healing harness | Implemented for current scope | `src/harness/*`, local-temp sandbox, workflow helper tests | Helper generation, sandbox validation, activation/rollback, and helper execution evidence exist. Heavy Docker/CubeSandbox/E2B providers remain later-only. |
| Automation packages | Implemented for current scope | `src/packages/*`, package/web tests | Local and fixture registry abstractions, digest/signature/trust review, permission grants, generated UI spec safety, eval history, CLI/API/UI surfaces exist. Public marketplace hosting remains future work. |
| Package/eval proof | Implemented for current scope | `src/packages/eval.ts`, package eval tests, UI evidence | Eval history persists and is exposed through API/UI. Broader benchmark suites and third-party task comparisons remain future work. |
| Pro dashboard / generated UI | Implemented for current scope | `web/src/components/*`, `web/src/pages/*`, screenshot artifacts | Dashboard now uses reusable shadcn/Radix-style primitives, shared layout/common components, loading/empty/error states, mobile screenshots, and generated package config surfaces. json-render remains optional future reuse. |
| Credential safety | Implemented for current scope | `src/security/credential_provider.ts`, `src/security/credential_vault.ts`, vault/API/MCP/workflow/browser tests | OS-backed/fallback vault, secret grants, execution-time `secret://` resolution, redaction, and audit integration exist. Rotation UX remains future work. |
| Privacy/network control | Implemented for current scope | `src/security/network_rules.ts`, `src/browser/network_interceptor.ts`, web tests | Catch-all request routing, hostname/resource evaluation, allow/deny/tracker precedence, redacted blocked evidence, API/UI management, and browser-action wiring exist. Full uBlock-compatible filter subscriptions/DNS packs remain future work. |
| Memory / site knowledge | Implemented v2 | `src/knowledge/backends.ts`, `tests/unit/knowledge_backends.test.ts` | Local markdown knowledge with deterministic ranking and stale locator scoring. Qdrant/PageIndex adapters implemented with health checks, search/rank endpoints, CLI commands, and Web API endpoints. Local markdown remains default; external adapters require endpoint configuration. |
| Local model / provider router | Partial | `src/model_router.ts`, `src/ai_agent.ts`, model/web tests | OpenRouter/Ollama/OpenAI-compatible router, fallback, local-only mode, loopback local API, bearer auth, token redaction, and doctor checks exist. Real OpenRouter/Ollama product runs remain blocked by missing API key/unreachable Ollama. |
| Record/replay builder | Implemented for current scope | `src/observability/recorder.ts`, web recorder/replay tests | Browser/terminal/filesystem/API actions record into redacted workflow/package drafts with waits/assertions and replay execution through workflow runtime. Broader site-memory productization remains future work. |
| Visual diff/debug | Implemented for current scope | `src/observability/visual_diff.ts`, `src/web/server.ts`, `web/src/pages/EvidenceView.tsx` | Decoded PNG pixel diff, DOM diff redaction, audit filters, replay debugger data, debug bundles, and UI evidence exist. |
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

### tinyhumansai/openhuman
- **Repo:** https://github.com/tinyhumansai/openhuman
- **Use for:** Local-first personal AI UX, private memory, connector onboarding, model/provider settings, desktop product framing.
- **Recommended mode:** Study only. GPL-3.0 and product-scope mismatch mean no code copy.
- **Current status:** Missing as personal-AI product. Browser Control has site knowledge, receipts, and model routing pieces, but no private user memory surface or connector-style onboarding.
- **Best next feature:** Add a local memory/knowledge workspace view that links browser actions, receipts, learned selectors, and user preferences without turning Browser Control into a general personal AI app.

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

### rohitg00/agentmemory
- **Repo:** https://github.com/rohitg00/agentmemory
- **Use for:** Persistent agent memory, MCP/REST memory surface, lifecycle hooks, hybrid search, session replay, memory governance UI.
- **Recommended mode:** Study/adapt architecture and UX. Do not replace Browser Control state with a generic memory product.
- **Current status:** Missing as shared memory service. Browser Control has SQLite state, site knowledge, screencast receipts, and debug logs, but not cross-session semantic memory with replayable agent/tool timelines.
- **Best next feature:** Build a Browser Control memory timeline that indexes browser/terminal/filesystem actions, debug receipts, learned selectors, package runs, and policy decisions with explicit retention/delete controls.

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
- **Current status:** Partial. Browserbase adapter, provider catalog, policy-gated health diagnostics, and redaction are implemented. Real credential-backed launch/attach remains blocked until `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` are configured.

### bytedance/UI-TARS-desktop
- **Repo:** https://github.com/bytedance/UI-TARS-desktop
- **Use for:** Multimodal GUI/browser operator architecture, hybrid DOM+vision fallback, event-stream viewer, remote computer/browser operator UX, VLM-backed desktop automation.
- **Recommended mode:** Study/adapt selectively. Browser Control should remain a11y-first and policy-gated; vision fallback must be explicit and recorded.
- **Current status:** Missing as multimodal/vision operator. Browser Control has a11y snapshots, screenshots, recordings, and Playwright/CDP control, but no VLM planner or event-stream operator viewer.
- **Best next feature:** Add optional policy-gated vision-assisted fallback for canvas/visual-only pages, with screenshot evidence and replay metadata.

### trycua/cua
- **Repo:** https://github.com/trycua/cua
- **Use for:** Computer-use sandboxes, desktop-control SDK patterns, replayable trajectories, benchmark/eval harnesses for agents controlling full desktops.
- **Recommended mode:** Study/adapt provider and eval ideas. Optional sandbox provider later.
- **Current status:** Missing as isolated desktop sandbox/eval layer. Browser Control has local browser providers and tests, but no OS-level sandbox provider or computer-use benchmark harness.
- **Best next feature:** Extend provider interfaces and CI fixtures so Browser Control can run browser tasks inside isolated desktop/browser sandboxes and export trajectories for regression testing.

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
| apernet/hysteria | QUIC/proxy transport design, proxy diagnostics, access-control/traffic-stat ideas | Study only; do not bundle default proxy | Proxy manager exists; privacy/network rules are browser-level and need better provider diagnostics |
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
| influxdata/telegraf | Plugin-style metrics/log collection, input/processor/output pipeline, config UX | Study/adapt observability architecture | Browser Control has logs/receipts but no pluggable telemetry pipeline/exporter model |
| supertone-inc/supertonic | On-device multilingual TTS for future voice operator feedback | Study only, optional later | No voice interface; not core automation infrastructure |
| danielmiessler/Personal_AI_Infrastructure | Personal AI infrastructure taxonomy, privacy/security framing, local-agent roadmap ideas | Study only | Useful strategy reference, not an implementation dependency |

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
| AUTOMATIC1111/stable-diffusion-webui | Avoid for core | Stable Diffusion image UI/plugin ecosystem, not browser/terminal automation. Can inspire extension UX only; AGPL means no code copy. |
| Lordog/dive-into-llms | Avoid for implementation | Educational LLM tutorial, not production Browser Control infrastructure. |
| datawhalechina/easy-vibe | Avoid for implementation | Beginner vibe-coding course, not reusable runtime architecture. |
| yikart/AiToEarn | Avoid for implementation | AI monetization/resource list, not Browser Control infrastructure. |
| ton-blockchain/acton | Avoid | TON smart-contract toolchain; unrelated to browser automation except generic CLI/test-UI inspiration. |
| rasbt/LLMs-from-scratch | Avoid for implementation | Strong learning repo, but Browser Control should route/use models, not build or train LLMs from scratch. |
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
| 09 Knowledge System | browser-harness, Qdrant, PageIndex, LlamaIndex, agentmemory, openhuman | Study/adapt; optional adapters |
| 10 Observability | chrome-devtools-mcp, Browserbase trace ideas, Webwright evidence, Telegraf | Study/adapt |
| 11 Operator UX | browser-use, agent-browser doctor, Open-WebUI settings, UI-TARS-desktop | Study/adapt |
| 12 Browser Terminal | wterm, localterm | Adopt/adapt |
| 13 Terminal Resume | wterm, just-bash | Study/adapt |
| 14 Stable URLs | portless, LocalCan | Optional dependency/wrapper |
| 15 Remote Provider | Browserbase, Browserless, Stagehand, Camofox experimental, Cua | Wrap providers |
| 16 Benchmarks | browser-use, Webwright, agent-eval, promptfoo, Cua-Bench | Study/adapt |
| 28 Pro Dashboard | json-render, Open-WebUI, browser-use web-ui | Adopt/study |
| 29 Workflow + Harness | LangGraph, workflow-use, browser-harness, just-bash, CubeSandbox | Study/adapt; optional sandbox providers |
| 30 Packages + Marketplace | agent-skills, skills, awesome-llm-apps, Cap | Study/adapt; Cap later |
| 31 Privacy + Credential Safety | uBlock, Pi-hole, Clash Verge, Hysteria, OS keychain patterns | Study/adapt; reimplement policy core |
| 32 Record/Replay + Memory | Webwright, workflow-use, Qdrant, PageIndex, agentmemory, Cua trajectories | Study/adapt |
| 33 Local Model Router/API | Open-WebUI, Ollama, LiteLLM, LocalAI, openhuman | Wrap optional providers |
| 34 Visual Diff + Audit UI | Browserbase trace, react-pdf-highlighter, debug tooling | Study/adapt |
| 35 Localhost Proxy + Team/Cloud | portless, LocalCan, open-agents, Cap | Optional wrappers/study |

---

## License / Risk Rules

- GPL/AGPL projects such as uBlock, Pi-hole, Firecrawl, Invidious, and some app products are **study only** unless Browser Control intentionally accepts reciprocal-license obligations.
- Anti-detect/fingerprint-bypass projects are **never default providers**. If ever added, they need explicit policy, abuse warnings, and opt-in configuration.
- Browser Control core owns policy, execution router, session model, CLI/API/MCP contracts, audit model, package permission model, and local data-home layout.
- Before vendoring code, verify current license, copy only narrow code, add provenance, and isolate behind adapter interfaces.
