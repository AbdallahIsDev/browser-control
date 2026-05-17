import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	CredentialVault,
	redactKnownSecretValues,
	resetCredentialVault,
} from "../../src/security/credential_vault";
import { createCredentialProtectionService } from "../../src/security/credential_provider";
import { getStateStorage, resetStateStorage } from "../../src/state/index";

describe("CredentialVault", () => {
	let dataHome: string;
	let originalHome: string | undefined;
	let originalBackend: string | undefined;

	beforeEach(() => {
		originalHome = process.env.BROWSER_CONTROL_HOME;
		originalBackend = process.env.BROWSER_CONTROL_STATE_BACKEND;
		dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-vault-test-"));
		process.env.BROWSER_CONTROL_HOME = dataHome;
		process.env.BROWSER_CONTROL_STATE_BACKEND = "json";
		resetStateStorage();
		resetCredentialVault();
	});

	afterEach(() => {
		resetCredentialVault();
		resetStateStorage();
		if (originalHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = originalHome;
		if (originalBackend === undefined)
			delete process.env.BROWSER_CONTROL_STATE_BACKEND;
		else process.env.BROWSER_CONTROL_STATE_BACKEND = originalBackend;
		fs.rmSync(dataHome, { recursive: true, force: true });
	});

	it("uses encrypted local fallback without storing raw values", async () => {
		const storage = getStateStorage(dataHome);
		const vault = new CredentialVault(
			storage,
			createCredentialProtectionService({
				dataHome,
				preferWindowsDpapi: false,
			}),
		);

		const stored = await vault.set(
			"site",
			"example.test",
			"login",
			"super-secret-value",
		);
		const rawStored = await storage.getSecret(stored.id);

		assert.equal(stored.id, "secret://site/example.test/login");
		assert.ok(rawStored);
		assert.doesNotMatch(JSON.stringify(rawStored), /super-secret-value/);
		assert.equal(await vault.getValue(stored.id), "super-secret-value");
		assert.equal(
			vault.providerStatus().some(
				(status) => status.name === "local-aes-gcm" && status.selected,
			),
			true,
		);
	});

	it("enforces grant actions, scope, expiry/revoke, and redacted audit", async () => {
		const storage = getStateStorage(dataHome);
		const vault = new CredentialVault(
			storage,
			createCredentialProtectionService({
				dataHome,
				preferWindowsDpapi: false,
			}),
		);
		const secret = await vault.set(
			"site",
			"example.test",
			"password",
			"secret-pass-123",
		);
		const grant = await vault.grant(secret.id, {
			actions: ["type", "use-as-form-value"],
			siteScope: "example.test",
			domainScope: "example.test",
			packageScope: "pkg.alpha",
			workflowScope: "workflow.login",
		});

		const allowed = await vault.resolveForUse(secret.id, {
			action: "type",
			targetDomain: "sub.example.test",
			site: "example.test",
			packageName: "pkg.alpha",
			workflowId: "workflow.login",
			sessionId: "session-1",
			policyDecision: "allow",
		});
		assert.equal(allowed.success, true);
		assert.equal(allowed.value, "secret-pass-123");
		assert.equal(allowed.grantId, grant.id);

		const denied = await vault.resolveForUse(secret.id, {
			action: "type",
			targetDomain: "evil.test",
			site: "evil.test",
			packageName: "pkg.alpha",
			workflowId: "workflow.login",
			sessionId: "session-1",
			policyDecision: "allow",
		});
		assert.equal(denied.success, false);

		await vault.revokeGrant(grant.id);
		const revoked = await vault.listGrants(secret.id);
		assert.equal(revoked[0]?.revoked, true);
		assert.ok(revoked[0]?.revokedAt);

		const afterRevoke = await vault.resolveForUse(secret.id, {
			action: "type",
			targetDomain: "example.test",
			site: "example.test",
			packageName: "pkg.alpha",
			workflowId: "workflow.login",
			sessionId: "session-1",
			policyDecision: "allow",
		});
		assert.equal(afterRevoke.success, false);

		const audit = await storage.listSecretAuditEvents(10);
		const auditJson = JSON.stringify(audit);
		assert.match(auditJson, /REDACTED_SECRET/);
		assert.doesNotMatch(auditJson, /secret-pass-123/);
		assert.equal(audit.some((event) => event.policyDecision === "allow"), true);
		assert.equal(audit.some((event) => event.policyDecision === "deny"), true);
	});

	it("persists revoked grants in SQLite JSON payloads", async () => {
		const sqliteHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-vault-sqlite-"));
		process.env.BROWSER_CONTROL_HOME = sqliteHome;
		process.env.BROWSER_CONTROL_STATE_BACKEND = "sqlite";
		resetStateStorage();
		resetCredentialVault();

		try {
			const storage = getStateStorage(sqliteHome);
			const vault = new CredentialVault(
				storage,
				createCredentialProtectionService({
					dataHome: sqliteHome,
					preferWindowsDpapi: false,
				}),
			);
			const secret = await vault.set("site", "example.test", "api", "sqlite-secret");
			const grant = await vault.grant(secret.id, {
				actions: ["type"],
				domainScope: "example.test",
			});
			await vault.revokeGrant(grant.id);
			resetStateStorage();

			const reopened = getStateStorage(sqliteHome);
			const grants = await reopened.listGrants(secret.id);

			assert.equal(grants[0]?.revoked, true);
			assert.ok(grants[0]?.revokedAt);
		} finally {
			resetCredentialVault();
			resetStateStorage();
			process.env.BROWSER_CONTROL_HOME = dataHome;
			process.env.BROWSER_CONTROL_STATE_BACKEND = "json";
			fs.rmSync(sqliteHome, { recursive: true, force: true });
		}
	});

	it("redacts raw secret values and refs from nested output", () => {
		const redacted = redactKnownSecretValues(
			{
				message:
					"token secret-pass-123 secret://site/example.test/password",
			},
			["secret-pass-123"],
		);

		const serialized = JSON.stringify(redacted);
		assert.doesNotMatch(serialized, /secret-pass-123/);
		assert.doesNotMatch(serialized, /secret:\/\/site/);
		assert.match(serialized, /REDACTED_SECRET/);
	});
});
