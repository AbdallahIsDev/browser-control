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

function vaultKeyDescriptorV2Path(dataHome: string): string {
	return `${vaultKeyPath(dataHome)}.v2`;
}

function withVaultPassphrase<T>(passphrase: string | undefined, fn: () => T): T {
	const original = process.env.BROWSER_CONTROL_VAULT_PASSPHRASE;
	if (passphrase === undefined) delete process.env.BROWSER_CONTROL_VAULT_PASSPHRASE;
	else process.env.BROWSER_CONTROL_VAULT_PASSPHRASE = passphrase;
	try {
		return fn();
	} finally {
		if (original === undefined) delete process.env.BROWSER_CONTROL_VAULT_PASSPHRASE;
		else process.env.BROWSER_CONTROL_VAULT_PASSPHRASE = original;
	}
}

function legacyEncrypt(plaintext: string, key: Buffer): string {
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

test("local credential provider preserves a competing vault key created during publish", () => {
	const home = tempDataHome();
	const keyPath = vaultKeyPath(home);
	const originalRenameSync = fs.renameSync;
	const originalLinkSync = fs.linkSync;
	const originalWriteFileSync = fs.writeFileSync;
	const competingKey = crypto.randomBytes(32);
	const competingDescriptor = {
		version: 2,
		provider: "local-aes-gcm",
		keySource: "random-file",
		key: competingKey.toString("base64"),
		createdAt: "2026-01-01T00:00:00.000Z",
	};
	let injectedCompetingKey = false;

	function injectCompetingKey(): void {
		if (injectedCompetingKey) return;
		injectedCompetingKey = true;
		fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
		originalWriteFileSync(keyPath, JSON.stringify(competingDescriptor), {
			mode: 0o600,
		});
	}

	fs.renameSync = ((from, to) => {
		if (String(to) === keyPath) injectCompetingKey();
		return originalRenameSync(from, to);
	}) as typeof fs.renameSync;
	fs.linkSync = ((from, to) => {
		if (String(to) === keyPath) injectCompetingKey();
		return originalLinkSync(from, to);
	}) as typeof fs.linkSync;

	try {
		withVaultPassphrase(undefined, () => {
			const service = createCredentialProtectionService({
				dataHome: home,
				preferWindowsDpapi: false,
			});
			const protectedValue = service.protect("secret");
			const descriptor = JSON.parse(fs.readFileSync(keyPath, "utf8"));

			assert.deepEqual(descriptor, competingDescriptor);
			assert.equal(injectedCompetingKey, true);
			assert.equal(
				createCredentialProtectionService({
					dataHome: home,
					preferWindowsDpapi: false,
				}).unprotect(protectedValue),
				"secret",
			);
		});
	} finally {
		fs.renameSync = originalRenameSync;
		fs.linkSync = originalLinkSync;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("local credential provider writes a passphrase descriptor via atomic temp-file link", () => {
	const home = tempDataHome();
	const keyPath = vaultKeyPath(home);
	const originalWriteFileSync = fs.writeFileSync;
	const originalLinkSync = fs.linkSync;
	const keyWrites: string[] = [];
	const keyLinks: Array<{ from: string; to: string }> = [];

	fs.writeFileSync = ((file, data, options) => {
		const target = String(file);
		if (target.includes(".vault-key")) keyWrites.push(target);
		return originalWriteFileSync(file, data, options);
	}) as typeof fs.writeFileSync;
	fs.linkSync = ((from, to) => {
		const source = String(from);
		const target = String(to);
		if (source.includes(".vault-key") || target.includes(".vault-key")) {
			keyLinks.push({ from: source, to: target });
		}
		return originalLinkSync(from, to);
	}) as typeof fs.linkSync;

	try {
		withVaultPassphrase("correct horse battery staple", () => {
			const service = createCredentialProtectionService({
				dataHome: home,
				preferWindowsDpapi: false,
			});
			const protectedValue = service.protect("secret");

			assert.equal(keyWrites.length, 1);
			assert.notEqual(keyWrites[0], keyPath);
			assert.match(keyWrites[0], /\.vault-key\.\d+\.\d+\..+\.tmp$/u);
			assert.deepEqual(keyLinks, [{ from: keyWrites[0], to: keyPath }]);
			const descriptor = JSON.parse(fs.readFileSync(keyPath, "utf8")) as {
				version: number;
				keySource: string;
				salt: string;
			};
			assert.equal(descriptor.version, 2);
			assert.equal(descriptor.keySource, "passphrase");
			assert.equal(Buffer.from(descriptor.salt, "base64").length, 32);
			assert.equal(service.unprotect(protectedValue), "secret");
		});
	} finally {
		fs.writeFileSync = originalWriteFileSync;
		fs.linkSync = originalLinkSync;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("local credential provider derives new vault key with current PBKDF2 work factor", () => {
	const home = tempDataHome();
	const originalPbkdf2Sync = crypto.pbkdf2Sync;
	let iterations: number | undefined;
	let secretInput: unknown;

	crypto.pbkdf2Sync = ((...args: Parameters<typeof crypto.pbkdf2Sync>) => {
		secretInput = args[0];
		iterations = args[2];
		return originalPbkdf2Sync(...args);
	}) as typeof crypto.pbkdf2Sync;

	try {
		withVaultPassphrase("vault-passphrase", () => {
			const service = createCredentialProtectionService({
				dataHome: home,
				preferWindowsDpapi: false,
			});

			service.protect("secret");
		});

		assert.equal(iterations, 600_000);
		assert.equal(secretInput, "vault-passphrase");
	} finally {
		crypto.pbkdf2Sync = originalPbkdf2Sync;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("local credential provider without passphrase writes a random-file descriptor", () => {
	const home = tempDataHome();

	try {
		withVaultPassphrase(undefined, () => {
			const service = createCredentialProtectionService({
				dataHome: home,
				preferWindowsDpapi: false,
			});
			const protectedValue = service.protect("secret");
			const descriptor = JSON.parse(fs.readFileSync(vaultKeyPath(home), "utf8")) as {
				version: number;
				keySource: string;
				key: string;
			};

			assert.equal(descriptor.version, 2);
			assert.equal(descriptor.keySource, "random-file");
			assert.equal(Buffer.from(descriptor.key, "base64").length, 32);
			assert.equal(service.unprotect(protectedValue), "secret");
		});
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("local credential provider decrypts legacy vault-key files without deriving machine identity", () => {
	const home = tempDataHome();
	const keyPath = vaultKeyPath(home);
	const legacyKey = crypto.randomBytes(32);

	try {
		fs.mkdirSync(path.dirname(keyPath), { recursive: true });
		fs.writeFileSync(keyPath, legacyKey, { mode: 0o600 });
		const service = createCredentialProtectionService({
			dataHome: home,
			preferWindowsDpapi: false,
		});
		const envelope = Buffer.from(JSON.stringify({
			version: 1,
			provider: "local-aes-gcm",
			payload: legacyEncrypt("secret", legacyKey),
		}));

		assert.equal(service.unprotect(envelope), "secret");
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("local credential provider keeps legacy key and writes v2 descriptor separately", () => {
	const home = tempDataHome();
	const keyPath = vaultKeyPath(home);
	const legacyKey = crypto.randomBytes(32);

	try {
		fs.mkdirSync(path.dirname(keyPath), { recursive: true });
		fs.writeFileSync(keyPath, legacyKey, { mode: 0o600 });
		withVaultPassphrase("new-passphrase", () => {
			const service = createCredentialProtectionService({
				dataHome: home,
				preferWindowsDpapi: false,
			});
			const protectedValue = service.protect("secret");

			assert.deepEqual(fs.readFileSync(keyPath), legacyKey);
			assert.equal(fs.existsSync(vaultKeyDescriptorV2Path(home)), true);
			assert.equal(service.unprotect(protectedValue), "secret");
		});
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("credential provider reports Windows DPAPI fallback to local encryption", () => {
	const home = tempDataHome();

	try {
		withVaultPassphrase("fallback-passphrase", () => {
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
		});
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});
