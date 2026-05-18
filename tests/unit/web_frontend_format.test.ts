import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
	formatCellValue,
	formatDateTime,
	formatTerminalActionResult,
} from "../../src/shared/format";

test("frontend date helper renders ISO timestamps as local human-readable values", () => {
	const rendered = formatDateTime("2026-05-07T14:56:41.113Z");

	assert.match(rendered, /2026/);
	assert.doesNotMatch(rendered, /T14:56:41\.113Z/);
	assert.doesNotMatch(rendered, /Invalid Date/);
	assert.match(rendered, /\b(UTC|GMT|[A-Z]{2,5})/);
});

test("frontend table formatting keeps invalid and missing dates graceful", () => {
	assert.equal(formatDateTime("not-a-date"), "Unknown time");
	assert.equal(formatDateTime(null), "Unknown time");
	assert.equal(
		formatCellValue("2026-05-07T14:56:41.113Z", "timestamp"),
		formatDateTime("2026-05-07T14:56:41.113Z"),
	);
	assert.equal(
		formatCellValue("browser-control", "runtime"),
		"browser-control",
	);
});

test("terminal summary hides raw JSON from primary output", () => {
	const summary = formatTerminalActionResult({
		success: true,
		data: {
			stdout: "v22.1.0\n",
			stderr: "",
			exitCode: 0,
			durationMs: 12,
			cwd: "C:\\repo",
		},
	});

	assert.match(summary, /stdout/);
	assert.match(summary, /v22\.1\.0/);
	assert.match(summary, /exit code: 0/i);
	assert.doesNotMatch(summary, /"stdout"/);
	assert.doesNotMatch(summary, /raw/i);
});

test("frontend exposes primary product views in simplified sidebar", () => {
	const appSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/App.tsx"),
		"utf8",
	);

	// Primary sidebar nav labels
	for (const label of [
		"Home",
		"Tasks",
		"Browser",
		"Workflows",
		"Skills",
		"Evidence",
		"Settings",
	]) {
		assert.match(
			appSource,
			new RegExp(`label: "${label}"`),
			`${label} nav item missing from sidebar`,
		);
	}

	// All page routes still exist (even if not in primary nav)
	for (const pageId of [
		"command",
		"terminal",
		"tasks",
		"automations",
		"browser",
		"trading",
		"workflows",
		"packages",
		"evidence",
		"settings",
		"advanced",
	]) {
		assert.match(
			appSource,
			new RegExp(`"${pageId}"`),
			`${pageId} page route missing`,
		);
	}

	// Old developer-focused labels should not be in primary nav
	assert.doesNotMatch(
		appSource,
		/label: "Command"/,
		"Command should be renamed to Home in nav",
	);
	assert.doesNotMatch(
		appSource,
		/label: "Packages"/,
		"Packages should be renamed to Skills in nav",
	);
	assert.doesNotMatch(
		appSource,
		/label: "Trading"/,
		"Trading should not be a primary sidebar item",
	);
});

test("home view has product-focused prompt composer UI", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/CommandView.tsx"),
		"utf8",
	);

	// New product elements must exist
	assert.match(source, /What should your agent do\?/);
	assert.match(source, /Run/);

	// Old developer elements must not exist
	assert.doesNotMatch(source, /Submit Intent/);
	assert.doesNotMatch(source, /System Load/);
	assert.doesNotMatch(source, /CDP Bridge/);
});

test("toolbar does not show Health unknown", () => {
	const appSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/App.tsx"),
		"utf8",
	);

	assert.doesNotMatch(
		appSource,
		/"Unknown"/,
		"App should not display raw 'Unknown' health text",
	);
	assert.match(appSource, /Runtime ready/, "Healthy state should show ready");
	assert.match(
		appSource,
		/Runtime starting/,
		"Loading state should show starting",
	);
});

test("toolbar exposes concrete runtime status labels", () => {
	const appSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/App.tsx"),
		"utf8",
	);

	for (const expected of [
		"Runtime ready",
		"Runtime starting",
		"Runtime offline",
		"Runtime degraded",
		"Browser disconnected",
		"API unavailable",
		'role="status"',
		"aria-label",
	]) {
		assert.match(appSource, new RegExp(expected));
	}
});

test("toolbar hides Provider and Policy pills when no token exists", () => {
	const appSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/App.tsx"),
		"utf8",
	);

	// Provider and Policy pills should be inside an authState !== "no-token" conditional
	assert.match(
		appSource,
		/authState !== "no-token"/,
		"Provider/Policy pills must be conditional on authState !== 'no-token'",
	);

	// Forget button must be conditional on storedTokenExists
	assert.match(
		appSource,
		/storedTokenExists/,
		"Forget button must only appear when a stored token exists",
	);

	// No-token hint text should exist (toolbar hint)
	assert.match(
		appSource,
		/to get a tokenized URL/,
		"No-token state should show a hint to the user",
	);
});

test("no-token state shows locked dashboard with CLI guidance", () => {
	const appSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/App.tsx"),
		"utf8",
	);

	// Locked dashboard title
	assert.match(
		appSource,
		/Local dashboard locked/,
		"No-token state should show locked dashboard title",
	);

	// CLI command hint — primary installed command
	assert.match(
		appSource,
		/bc web open/,
		"No-token state should show installed CLI command hint (bc)",
	);

	// Dev fallback command hint
	assert.match(
		appSource,
		/npm run cli -- web open/,
		"No-token state should show dev fallback command hint",
	);

	// Tokenized URL hint in locked dashboard
	assert.match(
		appSource,
		/tokenized URL/,
		"No-token state should explain tokenized URL format",
	);

	// Locked dashboard replaces page content
	assert.match(
		appSource,
		/authState === "no-token" \? \(/,
		"Locked dashboard should be rendered instead of page content when no token",
	);

	// Toolbar shows visible command hint
	assert.match(
		appSource,
		/bc web open/,
		"Toolbar no-token hint should reference installed CLI command (bc)",
	);
});

test("toolbar shows Forget button for unauthorized and api-error states", () => {
	const appSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/App.tsx"),
		"utf8",
	);

	// hasToken() is used to control Forget visibility
	assert.match(
		appSource,
		/const storedTokenExists = hasToken\(\);/,
		"storedTokenExists must be derived from hasToken()",
	);

	// Verify Auth labels exist for all states
	for (const label of [
		"Signed in",
		"Unauthorized",
		"Sign-in required",
		"API unavailable",
	]) {
		assert.match(
			appSource,
			new RegExp(label.replace(/[-]/g, "[-]")),
			`${label} auth label must be present`,
		);
	}
});

test("settings view exposes credential vault and network rule controls", () => {
	const settingsSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/SettingsView.tsx"),
		"utf8",
	);

	for (const expected of [
		"Credential Vault",
		"Privacy Network Rules",
		"/api/vault",
		"/api/vault/grants",
		"/api/network/rules",
		"STORE_SECRET",
		"raw values are never displayed",
	]) {
		assert.match(settingsSource, new RegExp(expected.replace("/", "\\/")));
	}
});

test("skills view relocates TradingView as an optional automation skill", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/PackagesView.tsx"),
		"utf8",
	);

	assert.match(source, /Optional automation skills/);
	assert.match(source, /TradingView ICT Analysis/);
	assert.match(source, /Optional skill/);
	assert.match(source, /Analysis only/);
	assert.match(source, /Live orders still require exact explicit approval/);
	assert.match(source, /Open tools/);
});

test("settings view exposes browser provider health dashboard", () => {
	const settingsSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/SettingsView.tsx"),
		"utf8",
	);

	for (const expected of [
		"Provider Health",
		"/api/browser/providers",
		"/api/browser/providers/catalog",
		"/api/browser/providers/health",
		"Provider Catalog",
		"Refresh Health",
		"Remote providers are opt-in",
		"explicit configuration and policy approval",
		"diagnostics do not switch",
		"launchSupported",
		"attachSupported",
	]) {
		assert.match(
			settingsSource,
			new RegExp(expected.replaceAll("/", "\\/")),
			`${expected} missing from SettingsView`,
		);
	}
});

test("terminal view uses shared components and real terminal control APIs", () => {
	const terminalSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/TerminalView.tsx"),
		"utf8",
	);

	for (const expected of [
		"@/components/ui/button",
		"@/components/common/ConfirmDialog",
		"@/components/common/EmptyState",
		"@/components/common/ErrorState",
		"@/components/common/LoadingState",
		"/api/terminal/sessions",
		"/render",
		"/resize",
		"submit: false",
		"requiresPasteConfirmation",
		"Paste Terminal Input",
		"multiline or destructive-looking input",
		"ResizeObserver",
		"scrollWidth <= innerWidth",
		"explainTerminalError",
		"Terminal runtime is busy.",
		"Terminal runtime is offline.",
		"Technical details:",
	]) {
		assert.match(
			terminalSource,
			new RegExp(expected.replaceAll("/", "\\/")),
			`${expected} missing from TerminalView`,
		);
	}

	assert.doesNotMatch(terminalSource, /className="button button-primary"/);
});

test("workflow view exposes v2 controls with shared components", () => {
	const workflowSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/WorkflowsView.tsx"),
		"utf8",
	);

	for (const expected of [
		"@/components/ui/button",
		"@/components/common/DataTable",
		"@/components/common/StatusBadge",
		"@/components/common/EmptyState",
		"@/components/ui/input",
		"@/components/ui/label",
		"/api/workflows/run",
		"/api/workflows/runs/",
		"/events",
		"/state",
		"/api/harness/generate",
		"/execute",
	]) {
		assert.match(
			workflowSource,
			new RegExp(expected.replaceAll("/", "\\/")),
			`${expected} missing from WorkflowsView`,
		);
	}

	assert.doesNotMatch(workflowSource, /className="panel"/);
});

test("workflow view does not submit workflow id as graph JSON", () => {
	const workflowSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/WorkflowsView.tsx"),
		"utf8",
	);
	const typeSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/types.ts"),
		"utf8",
	);

	assert.match(
		typeSource,
		/graph:/,
		"WorkflowDef must expose stored graph data",
	);
	assert.doesNotMatch(
		workflowSource,
		/body:\s*JSON\.stringify\(\{\s*graph:\s*workflowId\s*\}\)/,
		"Run action must submit a workflow graph or run-by-id payload, not the workflow id as graph JSON",
	);
});

test("evidence view uses shared Select component", () => {
	const evidenceSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/EvidenceView.tsx"),
		"utf8",
	);

	assert.match(
		evidenceSource,
		/@\/components\/ui\/select/,
		"EvidenceView should import shared Select component",
	);
});

test("evidence view exposes replay execution controls", () => {
	const evidenceSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/EvidenceView.tsx"),
		"utf8",
	);

	assert.match(evidenceSource, /Execute Replay/);
	assert.match(evidenceSource, /\/api\/debug\/replays\/.*\/execute/);
});

test("settings view uses shared Select component", () => {
	const settingsSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/SettingsView.tsx"),
		"utf8",
	);

	assert.match(
		settingsSource,
		/@\/components\/ui\/select/,
		"SettingsView should import shared Select component",
	);
});

test("settings network rule removal requires confirmation", () => {
	const settingsSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/SettingsView.tsx"),
		"utf8",
	);

	assert.match(settingsSource, /pendingNetworkRuleRemoval/);
	assert.match(settingsSource, /Disable Network Rule/);
	assert.match(settingsSource, /Remove Network Rule/);
	assert.match(settingsSource, /This changes real browser traffic filtering/);
	assert.doesNotMatch(
		settingsSource,
		/onClick=\{\(\) => removeNetworkRule\(rule\.(id|ID)\)\}/,
		"Network rules must not be removed directly from the row button",
	);
});

test("sidebar has responsive class for mobile toggle", () => {
	const sidebarSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/components/layout/AppSidebar.tsx"),
		"utf8",
	);

	assert.match(
		sidebarSource,
		/app-sidebar/,
		"AppSidebar must include app-sidebar class for responsive CSS",
	);
});

test("workflows view does not use raw HTML input elements outside shared Input", () => {
	const workflowSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/WorkflowsView.tsx"),
		"utf8",
	);

	// Only the shared Input import should be present, not raw <input> JSX
	assert.doesNotMatch(
		workflowSource,
		/<input\s/,
		"WorkflowsView must use shared Input instead of raw <input>",
	);
});

test("pages avoid legacy panel and nested card anti-patterns", () => {
	const evidenceSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/EvidenceView.tsx"),
		"utf8",
	);
	const packagesSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/PackagesView.tsx"),
		"utf8",
	);
	const settingsSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/SettingsView.tsx"),
		"utf8",
	);
	const workflowSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/WorkflowsView.tsx"),
		"utf8",
	);
	const commandSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/CommandView.tsx"),
		"utf8",
	);
	const browserSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/BrowserView.tsx"),
		"utf8",
	);
	const automationsSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/AutomationsView.tsx"),
		"utf8",
	);
	const tradingSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/TradingView.tsx"),
		"utf8",
	);
	const advancedSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/AdvancedView.tsx"),
		"utf8",
	);
	const tasksSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/TasksView.tsx"),
		"utf8",
	);

	for (const source of [
		evidenceSource,
		packagesSource,
		settingsSource,
		workflowSource,
		commandSource,
		browserSource,
		automationsSource,
		tradingSource,
		advancedSource,
		tasksSource,
	]) {
		assert.doesNotMatch(
			source,
			/className="panel"/,
			"No page should use className=panel",
		);
	}
});
test("command view uses shared components and PageShell", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/CommandView.tsx"),
		"utf8",
	);

	for (const expected of [
		"@/components/layout/PageShell",
		"@/components/ui/button",
		"@/components/ui/textarea",
		"ArrowRight",
		"Paperclip",
		"What should your agent do?",
	]) {
		assert.match(
			source,
			new RegExp(expected.replaceAll("/", "\\/")),
			`${expected} missing from CommandView`,
		);
	}

	assert.doesNotMatch(source, /className="panel"/);
	assert.doesNotMatch(source, /<button\s/);
	assert.doesNotMatch(source, /<textarea\s/);
	assert.doesNotMatch(
		source,
		/<div className="hidden">/,
		"No hidden compliance test markup should exist",
	);
});

test("browser view uses shared components and PageShell", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/BrowserView.tsx"),
		"utf8",
	);

	for (const expected of [
		"@/components/layout/PageShell",
		"@/components/ui/card",
		"@/components/ui/button",
		"@/components/common/EmptyState",
		"@/components/common/ErrorState",
		"See the browser sessions Browser Control is using for live work.",
		"Start from Home with a website task",
	]) {
		assert.match(
			source,
			new RegExp(expected.replaceAll("/", "\\/")),
			`${expected} missing from BrowserView`,
		);
	}

	assert.doesNotMatch(source, /className="panel"/);
	assert.doesNotMatch(source, /<button\s/);
});

test("automations view uses shared components and DataTable", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/AutomationsView.tsx"),
		"utf8",
	);

	for (const expected of [
		"@/components/layout/PageShell",
		"@/components/ui/card",
		"@/components/ui/badge",
		"@/components/common/EmptyState",
		"@/components/common/DataTable",
		"@/components/common/ErrorState",
		"Review saved jobs Browser Control can run again later.",
		"Saved automations",
		"Technical ID",
		"What it does",
		"Full instructions",
	]) {
		assert.match(
			source,
			new RegExp(expected.replaceAll("/", "\\/")),
			`${expected} missing from AutomationsView`,
		);
	}

	assert.doesNotMatch(source, /className="panel"/);
	assert.doesNotMatch(source, /<table\s/);
});

test("trading view uses shared components and PageShell", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/TradingView.tsx"),
		"utf8",
	);

	for (const expected of [
		"@/components/layout/PageShell",
		"@/components/ui/card",
		"@/components/ui/button",
		"@/components/ui/badge",
		"@/components/common/DataTable",
		"@/components/common/StatusBadge",
		"@/components/common/EmptyState",
		"@/components/common/ErrorState",
	]) {
		assert.match(
			source,
			new RegExp(expected.replaceAll("/", "\\/")),
			`${expected} missing from TradingView`,
		);
	}

	for (const expected of [
		"TradingView analysis skill",
		"without making trading a primary Browser Control workflow",
		"TechnicalIdDetails",
		"Technical job ID",
		"Technical ticket ID",
		"Showing latest 12",
	]) {
		assert.match(source, new RegExp(expected));
	}

	assert.doesNotMatch(source, /className="panel"/);
	assert.doesNotMatch(source, /<button\s/);
	assert.doesNotMatch(source, /<table\s/);
});

test("advanced view uses shared components and ConfirmDialog", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/AdvancedView.tsx"),
		"utf8",
	);

	for (const expected of [
		"@/components/layout/PageShell",
		"@/components/ui/card",
		"@/components/ui/button",
		"@/components/ui/input",
		"@/components/common/ConfirmDialog",
	]) {
		assert.match(
			source,
			new RegExp(expected.replaceAll("/", "\\/")),
			`${expected} missing from AdvancedView`,
		);
	}

	assert.doesNotMatch(source, /className="panel"/);
	assert.doesNotMatch(source, /<button\s/);
	assert.doesNotMatch(source, /<input\s/);
});

test("tasks view uses shared components and PageShell", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/TasksView.tsx"),
		"utf8",
	);

	for (const expected of [
		"@/components/layout/PageShell",
		"@/components/ui/card",
		"@/components/ui/table",
		"@/components/common/EmptyState",
		"@/components/common/ErrorState",
		"@/components/common/LoadingState",
		"@/components/common/StatusBadge",
	]) {
		assert.match(
			source,
			new RegExp(expected.replaceAll("/", "\\/")),
			`${expected} missing from TasksView`,
		);
	}

	assert.doesNotMatch(source, /className="panel"/);
	assert.doesNotMatch(source, /<button\s/);
	assert.doesNotMatch(source, /<table\s/);
});

test("tasks view has a broker-unavailable recovery state", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/TasksView.tsx"),
		"utf8",
	);

	for (const expected of [
		"TaskListResponse",
		"Task runtime offline",
		"Start Browser Control daemon",
		"Task history will load automatically",
	]) {
		assert.match(source, new RegExp(expected));
	}
});

test("evidence view explains evidence for non-technical users", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/pages/EvidenceView.tsx"),
		"utf8",
	);

	for (const expected of [
		"Review screenshots, page changes, policy decisions, and audit events produced while Browser Control works.",
		"Visual comparison",
		"Page changes",
		"Policy and safety decisions",
		"Technical details",
		"plain-language summary",
		"<details",
	]) {
		assert.match(source, new RegExp(expected.replaceAll("/", "\\/")));
	}
});

test("screenshot script handles auth token and rejects Unauthorized", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../scripts/capture_ui_screenshots.cjs"),
		"utf8",
	);

	for (const expected of [
		"sessionStorage",
		"bc-token",
		"Unauthorized",
		"BROWSER_CONTROL_WEB_TOKEN",
		"tokenProvided",
		"command",
		"browser",
		"automations",
		"trading",
		"advanced",
		"tasks",
	]) {
		assert.match(
			source,
			new RegExp(expected),
			`Screenshot script should handle ${expected}`,
		);
	}
	assert.ok(
		source.includes('packages: "skills"'),
		"Screenshot script should map Packages page id to Skills sidebar label",
	);
	assert.ok(
		source.includes('localStorage.setItem("bc-page", pageId)'),
		"Screenshot script should preserve page id when fallback navigation reloads",
	);
});

test("pages use responsive mobile-first patterns for buttons and forms", () => {
	const pages = [
		"WorkflowsView.tsx",
		"SettingsView.tsx",
		"EvidenceView.tsx",
		"BrowserView.tsx",
		"TradingView.tsx",
		"AdvancedView.tsx",
	];

	for (const pageFile of pages) {
		const source = fs.readFileSync(
			path.resolve(__dirname, `../../web/src/pages/${pageFile}`),
			"utf8",
		);
		// Each page should use PageShell
		assert.match(
			source,
			/@\/components\/layout\/PageShell/,
			`${pageFile} should import PageShell`,
		);
	}
});

test("PageShell provides content wrapper with responsive padding", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/components/layout/PageShell.tsx"),
		"utf8",
	);

	assert.match(
		source,
		/px-4 py-5 sm:px-6 lg:px-8/,
		"PageShell should have responsive padding for mobile gutters",
	);
	assert.match(
		source,
		/flex-1 min-w-0/,
		"PageShell should fill available space without overflow",
	);
});

test("react doctor quality gate is available as a non-blocking dashboard audit", () => {
	const rootPackage = JSON.parse(
		fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
	) as { scripts?: Record<string, string> };
	const scriptPath = path.resolve(__dirname, "../../scripts/react_doctor.cjs");

	assert.equal(
		rootPackage.scripts?.["react:doctor"],
		"node scripts/react_doctor.cjs",
	);
	assert.equal(fs.existsSync(scriptPath), true);

	const source = fs.readFileSync(scriptPath, "utf8");
	assert.match(source, /web\/src/);
	assert.match(source, /accessibility/i);
	assert.match(source, /React dashboard doctor/);
});
