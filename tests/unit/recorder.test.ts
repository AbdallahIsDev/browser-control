import assert from "node:assert/strict";
import test from "node:test";

import {
	ActionRecorder,
	convertRecordingToPackage,
	convertRecordingToWorkflow,
	getRecorder,
	recordIfActive,
	resetRecorder,
} from "../../src/observability/recorder";

test("ActionRecorder redacts nested secret refs from recorded params and errors", () => {
	const recorder = new ActionRecorder();
	recorder.start("Login capture", "example.test");

	const action = recorder.record(
		"browser-fill",
		{
			target: "#password",
			text: "secret://site/example.test/password",
			metadata: { token: "secret://site/example.test/token" },
		},
		{
			success: false,
			error: "failed with secret://site/example.test/password",
		} as never,
	);

	const serialized = JSON.stringify(action);
	assert.doesNotMatch(serialized, /secret:\/\/site/u);
	assert.match(serialized, /\[REDACTED_SECRET\]/u);
});

test("convertRecordingToWorkflow builds ordered replay nodes from recorded actions", () => {
	const recorder = new ActionRecorder();
	const session = recorder.start("Checkout replay", "shop.test");
	recorder.record("browser-open", { url: "https://shop.test/cart" });
	recorder.record("browser-snapshot", {});
	recorder.record("browser-click", { target: "button[name=checkout]" });
	recorder.record("terminal-exec", { command: "echo verify" });
	recorder.stop();

	const workflow = convertRecordingToWorkflow(session);

	assert.equal(workflow.nodes.length, 4);
	assert.deepEqual(
		workflow.nodes.map(node => node.kind),
		["browser", "browser", "browser", "terminal"],
	);
	assert.equal(workflow.nodes[0].input.action, "open");
	assert.equal(workflow.nodes[0].input.url, "https://shop.test/cart");
	assert.equal(workflow.nodes[1].input.action, "snapshot");
	assert.equal(workflow.nodes[2].input.action, "click");
	assert.equal(workflow.nodes[2].input.target, "button[name=checkout]");
	assert.equal(workflow.nodes[3].input.command, "echo verify");
	assert.deepEqual(workflow.edges, [
		{ from: "node-1", to: "node-2" },
		{ from: "node-2", to: "node-3" },
		{ from: "node-3", to: "node-4" },
	]);
	assert.equal(workflow.entryNodeId, "node-1");
});

test("convertRecordingToPackage emits manifest permissions with valid minimum shape", () => {
	const recorder = new ActionRecorder();
	const session = recorder.start("Package draft", "example.test");
	recorder.record("browser-open", { url: "https://example.test" });
	recorder.record("terminal-exec", { command: "npm test" });
	recorder.record("fs-write", { path: "reports/output.txt", content: "ok" });
	recorder.stop();

	const draft = convertRecordingToPackage(session);

	assert.deepEqual(draft.manifest.permissions, [
		{ kind: "browser", domains: ["example.test"] },
		{ kind: "terminal", commands: ["npm test"] },
		{ kind: "filesystem", paths: ["reports/output.txt"], access: "write" },
	]);
	assert.equal(draft.manifest.workflows[0], `workflows/${draft.workflow.id}.json`);
	assert.equal(draft.manifest.evals[0], "evals/eval-basic.json");
	assert.equal(draft.evalDefinition.workflow, draft.workflow.id);
});

test("convertRecordingToPackage omits unused permission groups and infers browser domains", () => {
	const recorder = new ActionRecorder();
	const session = recorder.start("Browser only draft");
	recorder.record("browser-open", { url: "https://example.test/login" });
	recorder.record("browser-click", { target: "button[type=submit]" });
	recorder.stop();

	const draft = convertRecordingToPackage(session);

	assert.deepEqual(draft.manifest.permissions, [
		{ kind: "browser", domains: ["example.test"] },
	]);
});

test("resetRecorder stops an active singleton recording before replacing it", () => {
	const recorder = getRecorder();
	recorder.start("Reset capture", "example.test");

	resetRecorder();

	assert.equal(recordIfActive("browser-snapshot", {}), null);
});
