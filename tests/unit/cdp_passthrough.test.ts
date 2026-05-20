import assert from "node:assert/strict";
import test from "node:test";
import { executeCdpCommand } from "../../src/browser/cdp_passthrough";

function getMockPage(sendResult: unknown = {}): any {
	return {
		context: () => ({
			newCDPSession: async () => ({
				send: async () => sendResult,
				detach: async () => {},
			}),
		}),
	};
}

test("cdp_passthrough: validates method format - valid", async () => {
	const mockPage = getMockPage({});
	const result = await executeCdpCommand(mockPage, { method: "Target.getTargets", timeoutMs: 5000 });
	assert.ok(result.success);
});

test("cdp_passthrough: rejects invalid method format", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "invalid", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("Invalid CDP method format"));
});

test("cdp_passthrough: rejects method without domain", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: ".method", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("Invalid CDP method format"));
});

test("cdp_passthrough: blocks dangerous method Browser.close", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "Browser.close", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("blocked for security"));
});

test("cdp_passthrough: blocks dangerous method Target.closeTarget", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "Target.closeTarget", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("blocked for security"));
});

test("cdp_passthrough: blocks dangerous method Security.disable", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "Security.disable", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("blocked for security"));
});

test("cdp_passthrough: rejects non-serializable params", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, {
		method: "DOM.getDocument",
		params: { fn: () => {} } as any,
		timeoutMs: 5000,
	});
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("JSON-serializable"));
});

test("cdp_passthrough: rejects targetId with capability error", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, {
		method: "Target.getTargets",
		targetId: "some-target-id",
		timeoutMs: 5000,
	});
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("targetId"));
	assert.ok(result.error?.includes("not supported"));
});

test("cdp_passthrough: rejects frameId with capability error", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, {
		method: "Target.getTargets",
		frameId: "some-frame-id",
		timeoutMs: 5000,
	});
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("frameId"));
	assert.ok(result.error?.includes("not supported"));
});

test("cdp_passthrough: rejects missing timeoutMs", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "Target.getTargets" } as any);
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("timeoutMs"));
});

test("cdp_passthrough: safe method not blocked", async () => {
	const mockPage = getMockPage({});
	const result = await executeCdpCommand(mockPage, { method: "DOM.getDocument", timeoutMs: 5000 });
	assert.ok(result.success);
});


test("cdp_passthrough: returns failure result on send error", async () => {
	const mockPage = { context: () => ({ newCDPSession: async () => ({ send: async () => { throw new Error("CDP error"); }, detach: async () => {} }) }) } as any;
	const result = await executeCdpCommand(mockPage, { method: "Target.getTargets", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("CDP command failed"));
});

test("cdp_passthrough: redacts sensitive data in error messages", async () => {
	const mockPage = { context: () => ({ newCDPSession: async () => ({ send: async () => { throw new Error("secret: abc123_def_ghi_jkl_mno_pqr_stu"); }, detach: async () => {} }) }) } as any;
	const result = await executeCdpCommand(mockPage, { method: "Target.getTargets", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(!result.error?.includes("abc123_def_ghi_jkl_mno_pqr_stu"));
});

test("cdp_passthrough: enforces timeout cap", async () => {
	const mockPage = getMockPage({});
	const result = await executeCdpCommand(mockPage, { method: "Target.getTargets", timeoutMs: 999999 });
	assert.ok(result.success);
});

test("cdp_passthrough: blocks domain-less method", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "noDot", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("Invalid CDP method format"));
});

test("cdp_passthrough: blocks Page.navigate", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "Page.navigate", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("blocked for security"));
});

test("cdp_passthrough: blocks Page.captureScreenshot", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "Page.captureScreenshot", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("blocked for security"));
});

test("cdp_passthrough: blocks Storage.clearDataForOrigin", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "Storage.clearDataForOrigin", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("blocked for security"));
});

test("cdp_passthrough: blocks Network.setCookie", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "Network.setCookie", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("blocked for security"));
});

test("cdp_passthrough: blocks Network.deleteCookies", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "Network.deleteCookies", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("blocked for security"));
});

test("cdp_passthrough: blocks Runtime.evaluate", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "Runtime.evaluate", timeoutMs: 5000 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("blocked for security"));
});

test("cdp_passthrough: rejects negative timeout", async () => {
	const mockPage = {} as any;
	const result = await executeCdpCommand(mockPage, { method: "Target.getTargets", timeoutMs: -1 });
	assert.equal(result.success, false);
	assert.ok(result.error?.includes("timeoutMs"));
});
