import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCredentialProtectionService } from "../../src/security/credential_provider";

function tempDataHome(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "bc-credential-provider-"));
}

function vaultKeyPath(dataHome: string): string {
	return path.join(dataHome, "secrets", ".vault-key");
}

test("local credential provider writes new vault key via temp file then rename", () => {
	const home = tempDataHome();
	const keyPath = vaultKeyPath(home);
	const originalWriteFileSync = fs.writeFileSync;
	const originalRenameSync = fs.renameSync;
	const keyWrites: string[] = [];
	const keyRenames: Array<{ from: string; to: string }> = [];

	fs.writeFileSync = ((file, data, options) => {
		const target = String(file);
		if (target.includes(".vault-key")) keyWrites.push(target);
		return originalWriteFileSync(file, data, options);
	}) as typeof fs.writeFileSync;
	fs.renameSync = ((from, to) => {
		const source = String(from);
		const target = String(to);
		if (source.includes(".vault-key") || target.includes(".vault-key")) {
			keyRenames.push({ from: source, to: target });
		}
		return originalRenameSync(from, to);
	}) as typeof fs.renameSync;

	try {
		const service = createCredentialProtectionService({
			dataHome: home,
			preferWindowsDpapi: false,
		});
		const protectedValue = service.protect("secret");

		assert.equal(keyWrites.length, 1);
		assert.notEqual(keyWrites[0], keyPath);
		assert.match(keyWrites[0], /\.vault-key\.\d+\.\d+\..+\.tmp$/u);
		assert.deepEqual(keyRenames, [{ from: keyWrites[0], to: keyPath }]);
		assert.equal(fs.readFileSync(keyPath).length, 64);
		assert.equal(service.unprotect(protectedValue), "secret");
	} finally {
		fs.writeFileSync = originalWriteFileSync;
		fs.renameSync = originalRenameSync;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("local credential provider derives new vault key with current PBKDF2 work factor", () => {
	const home = tempDataHome();
	const originalPbkdf2Sync = crypto.pbkdf2Sync;
	let iterations: number | undefined;

	crypto.pbkdf2Sync = ((...args: Parameters<typeof crypto.pbkdf2Sync>) => {
		iterations = args[2];
		return originalPbkdf2Sync(...args);
	}) as typeof crypto.pbkdf2Sync;

	try {
		const service = createCredentialProtectionService({
			dataHome: home,
			preferWindowsDpapi: false,
		});

		service.protect("secret");

		assert.equal(iterations, 600_000);
	} finally {
		crypto.pbkdf2Sync = originalPbkdf2Sync;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("local credential provider rejects corrupted vault key instead of regenerating", () => {
	const home = tempDataHome();
	const keyPath = vaultKeyPath(home);

	try {
		fs.mkdirSync(path.dirname(keyPath), { recursive: true });
		fs.writeFileSync(keyPath, "corrupt", { mode: 0o600 });
		const before = fs.readFileSync(keyPath);
		const service = createCredentialProtectionService({
			dataHome: home,
			preferWindowsDpapi: false,
		});

		assert.throws(
			() => service.protect("secret"),
			/Invalid local vault key file/u,
		);
		assert.deepEqual(fs.readFileSync(keyPath), before);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("credential provider reports Windows DPAPI fallback to local encryption", () => {
	const home = tempDataHome();

	try {
		const service = createCredentialProtectionService({
			dataHome: home,
			preferWindowsDpapi: true,
		});
		(service as unknown as {
			windows: {
				name: "windows-dpapi";
				isAvailable: () => boolean;
				protect: () => string;
				unprotect: () => string;
			};
		}).windows = {
			name: "windows-dpapi",
			isAvailable: () => true,
			protect: () => {
				throw new Error("simulated DPAPI failure");
			},
			unprotect: () => {
				throw new Error("not used");
			},
		};

		const protectedValue = service.protect("secret");
		assert.equal(service.unprotect(protectedValue), "secret");

		const localStatus = service.status().find((provider) => provider.name === "local-aes-gcm");
		assert.ok(localStatus);
		assert.equal(localStatus.selected, true);
		assert.match(localStatus.reason ?? "", /simulated DPAPI failure/u);
		assert.equal(localStatus.fallback?.from, "windows-dpapi");
		assert.equal(localStatus.fallback?.to, "local-aes-gcm");
		assert.match(localStatus.fallback?.timestamp ?? "", /^\d{4}-\d{2}-\d{2}T/u);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});
