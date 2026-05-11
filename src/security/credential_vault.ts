import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDataHome, getSecretsDir } from "../shared/paths";
import { logger } from "../shared/logger";
import { redactString } from "../observability/redaction";
import {
	type StateStorage,
	getStateStorage,
	resetStateStorage,
} from "../state/index";

const log = logger.withComponent("credential-vault");

// ── Types ───────────────────────────────────────────────────────────

export type SecretScope = "site" | "package" | "workflow";

export type SecretAction =
	| "reveal"
	| "type"
	| "paste"
	| "use-as-header"
	| "use-as-form-value";

export interface SecretReference {
	scope: SecretScope;
	scopeName: string;
	secretName: string;
}

export interface SecretGrant {
	id: string;
	secretId: string;
	action: SecretAction;
	domain?: string;
	expiresAt?: string;
	revoked: boolean;
	createdAt: string;
}

export interface StoredSecret {
	id: string;
	scope: SecretScope;
	scopeName: string;
	secretName: string;
	createdAt: string;
	updatedAt: string;
}

export interface SecretEntry {
	id: string;
	scope: SecretScope;
	scopeName: string;
	secretName: string;
	createdAt: string;
	updatedAt: string;
	hasValue: boolean;
}

// ── Encryption ──────────────────────────────────────────────────────

function deriveKey(password: string, salt: Buffer): Buffer {
	return crypto.pbkdf2Sync(password, salt, 100_000, 32, "sha256");
}

function machineIdentity(): string {
	const hostname = os.hostname();
	const homedir = os.homedir();
	const userInfo = os.userInfo();
	return `${hostname}:${userInfo.username}:${homedir}`;
}

function getVaultKeyPath(): string {
	return path.join(getSecretsDir(), ".vault-key");
}

function ensureVaultKey(): Buffer {
	const keyPath = getVaultKeyPath();
	if (fs.existsSync(keyPath)) {
		return fs.readFileSync(keyPath);
	}
	fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
	const salt = crypto.randomBytes(32);
	const identity = machineIdentity();
	const key = crypto.pbkdf2Sync(identity, salt, 100_000, 32, "sha256");
	const storedKey = Buffer.concat([salt, key]);
	fs.writeFileSync(keyPath, storedKey, { mode: 0o600 });
	if (process.platform !== "win32") {
		fs.chmodSync(keyPath, 0o600);
	}
	return key;
}

function encrypt(plaintext: string): Buffer {
	const key = ensureVaultKey();
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(ciphertext: Buffer): string {
	const key = ensureVaultKey();
	const iv = ciphertext.subarray(0, 16);
	const authTag = ciphertext.subarray(16, 32);
	const encrypted = ciphertext.subarray(32);
	const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ── Secret Reference Parsing ────────────────────────────────────────

export function parseSecretRef(ref: string): SecretReference | null {
	const match = /^secret:\/\/(site|package|workflow)\/([^/]+)\/(.+)$/.exec(ref);
	if (!match) return null;
	return {
		scope: match[1] as SecretScope,
		scopeName: decodeURIComponent(match[2]),
		secretName: decodeURIComponent(match[3]),
	};
}

export function formatSecretRef(ref: SecretReference): string {
	return `secret://${ref.scope}/${encodeURIComponent(ref.scopeName)}/${encodeURIComponent(ref.secretName)}`;
}

// ── CredentialVault ─────────────────────────────────────────────────

export class CredentialVault {
	private storage: StateStorage;

	constructor(storage?: StateStorage) {
		this.storage = storage ?? getStateStorage();
	}

	async set(
		scope: SecretScope,
		scopeName: string,
		secretName: string,
		value: string,
	): Promise<StoredSecret> {
		const ref: SecretReference = { scope, scopeName, secretName };
		const id = formatSecretRef(ref);
		const now = new Date().toISOString();
		const existing = await this.storage.getSecret(id);
		const encrypted = encrypt(value);

		const stored: StoredSecret & { encryptedValue: Buffer } = {
			id,
			scope,
			scopeName,
			secretName,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			encryptedValue: encrypted,
		};

		await this.storage.saveSecret({
			id,
			scope,
			scopeName,
			secretName,
			encryptedValue: encrypted,
			createdAt: stored.createdAt,
			updatedAt: stored.updatedAt,
		});

		log.info(`Secret stored: ${id}`);
		return stored;
	}

	async getValue(ref: string): Promise<string | null> {
		const stored = await this.storage.getSecret(ref);
		if (!stored) return null;
		try {
			return decrypt(stored.encryptedValue);
		} catch {
			log.error(`Failed to decrypt secret: ${ref}`);
			return null;
		}
	}

	async delete(ref: string): Promise<boolean> {
		await this.storage.deleteSecret(ref);
		log.info(`Secret deleted: ${ref}`);
		return true;
	}

	async list(): Promise<SecretEntry[]> {
		const stored = await this.storage.listSecrets();
		return stored.map((s) => ({
			id: s.id,
			scope: s.scope,
			scopeName: s.scopeName,
			secretName: s.secretName,
			createdAt: s.createdAt,
			updatedAt: s.updatedAt,
			hasValue: s.encryptedValue.length > 0,
		}));
	}

	async resolve(ref: string): Promise<{ id: string; value: string } | null> {
		const value = await this.getValue(ref);
		if (!value) return null;
		return { id: ref, value };
	}

	// ── Grants ──────────────────────────────────────────────────────

	async grant(
		secretRef: string,
		action: SecretAction,
		domain?: string,
		expiresAt?: string,
	): Promise<SecretGrant> {
		const grant: SecretGrant = {
			id: `grant-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
			secretId: secretRef,
			action,
			domain: domain || undefined,
			expiresAt,
			revoked: false,
			createdAt: new Date().toISOString(),
		};
		await this.storage.saveGrant({
			id: grant.id,
			secretId: grant.secretId,
			action: grant.action,
			domain: grant.domain ?? null,
			expiresAt: grant.expiresAt ?? null,
			revoked: false,
			createdAt: grant.createdAt,
		});
		return grant;
	}

	async revokeGrant(grantId: string): Promise<boolean> {
		await this.storage.revokeGrant(grantId);
		return true;
	}

	async listGrants(secretRef?: string): Promise<SecretGrant[]> {
		const stored = await this.storage.listGrants(secretRef);
		return stored.map((g) => ({
			id: g.id,
			secretId: g.secretId,
			action: g.action as SecretAction,
			domain: g.domain ?? undefined,
			expiresAt: g.expiresAt ?? undefined,
			revoked: g.revoked,
			createdAt: g.createdAt,
		}));
	}

	checkGrant(
		secretRef: string,
		action: SecretAction,
		grant: SecretGrant,
		domain?: string,
	): boolean {
		if (grant.revoked) return false;
		if (grant.secretId !== secretRef) return false;
		if (grant.action !== action) return false;
		if (grant.expiresAt && new Date(grant.expiresAt) < new Date()) return false;
		if (grant.domain && domain && grant.domain !== domain) return false;
		if (grant.domain && !domain) return false;
		if (!grant.domain && domain) return true;
		return true;
	}

	async isActionGranted(
		secretRef: string,
		action: SecretAction,
		domain?: string,
	): Promise<boolean> {
		const grants = await this.listGrants(secretRef);
		return grants.some((g) => this.checkGrant(secretRef, action, g, domain));
	}

	close(): void {
		// StateStorage managed by getStateStorage singleton
	}
}

// ── Singleton ───────────────────────────────────────────────────────

let _defaultVault: CredentialVault | null = null;

export function getCredentialVault(): CredentialVault {
	if (!_defaultVault) {
		_defaultVault = new CredentialVault();
	}
	return _defaultVault;
}

export function resetCredentialVault(): void {
	if (_defaultVault) {
		_defaultVault.close();
		_defaultVault = null;
	}
}
