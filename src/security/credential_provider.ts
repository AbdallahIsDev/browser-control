import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getSecretsDir } from "../shared/paths";
import { logger } from "../shared/logger";

const LOCAL_VAULT_KEY_PBKDF2_ITERATIONS = 600_000;
const LOCAL_VAULT_PASSPHRASE_ENV = "BROWSER_CONTROL_VAULT_PASSPHRASE";
const log = logger.withComponent("credential-provider");

export type CredentialProtectionProviderName =
	| "windows-dpapi"
	| "local-aes-gcm";

export interface CredentialProtectionProviderStatus {
	name: CredentialProtectionProviderName;
	available: boolean;
	selected: boolean;
	reason?: string;
	fallback?: CredentialProtectionFallbackEvent;
}

export interface CredentialProtectionFallbackEvent {
	from: CredentialProtectionProviderName;
	to: CredentialProtectionProviderName;
	reason: string;
	timestamp: string;
}

interface CredentialEnvelope {
	version: 1;
	provider: CredentialProtectionProviderName;
	payload: string;
}

interface LocalVaultKeyDescriptor {
	version: 2;
	provider: "local-aes-gcm";
	keySource: "passphrase" | "random-file";
	kdf?: "pbkdf2-sha256";
	iterations?: number;
	salt?: string;
	key?: string;
	createdAt: string;
}

interface LocalEncryptedPayload {
	version: 2;
	ciphertext: string;
}

export interface CredentialProtectionServiceOptions {
	dataHome?: string;
	preferWindowsDpapi?: boolean;
}

function vaultKeyPath(dataHome?: string): string {
	return path.join(getSecretsDir(dataHome), ".vault-key");
}

function writeVaultKeyAtomic(keyPath: string, value: Buffer): boolean {
	const tmpPath = `${keyPath}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`;
	fs.writeFileSync(tmpPath, value, { mode: 0o600 });
	if (process.platform !== "win32") fs.chmodSync(tmpPath, 0o600);
	if (fs.existsSync(keyPath)) {
		fs.rmSync(tmpPath, { force: true });
		return false;
	}
	fs.renameSync(tmpPath, keyPath);
	if (process.platform !== "win32") fs.chmodSync(keyPath, 0o600);
	return true;
}

function isLocalVaultKeyDescriptor(value: unknown): value is LocalVaultKeyDescriptor {
	if (!value || typeof value !== "object") return false;
	const descriptor = value as Partial<LocalVaultKeyDescriptor>;
	return (
		descriptor.version === 2 &&
		descriptor.provider === "local-aes-gcm" &&
		(descriptor.keySource === "passphrase" ||
			descriptor.keySource === "random-file") &&
		typeof descriptor.createdAt === "string"
	);
}

function parseLocalVaultKeyDescriptor(value: Buffer): LocalVaultKeyDescriptor | null {
	try {
		const parsed = JSON.parse(value.toString("utf8")) as unknown;
		return isLocalVaultKeyDescriptor(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isLocalEncryptedPayload(value: unknown): value is LocalEncryptedPayload {
	if (!value || typeof value !== "object") return false;
	const payload = value as Partial<LocalEncryptedPayload>;
	return payload.version === 2 && typeof payload.ciphertext === "string";
}

function parseLocalEncryptedPayload(value: string): LocalEncryptedPayload | null {
	try {
		const parsed = JSON.parse(value) as unknown;
		return isLocalEncryptedPayload(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function readLocalVaultKeyFile(filePath: string): Buffer | null {
	try {
		return fs.readFileSync(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function readLegacyVaultKey(dataHome?: string): Buffer | null {
	const keyPath = vaultKeyPath(dataHome);
	const stored = readLocalVaultKeyFile(keyPath);
	if (!stored) return null;
	if (parseLocalVaultKeyDescriptor(stored)) return null;
	if (stored.length === 64) return stored.subarray(32);
	if (stored.length === 32) return stored;
	throw new Error(
		`Invalid local vault key file at ${keyPath}: expected JSON descriptor, 32 bytes, or 64 bytes; found ${stored.length}. Refusing to regenerate because existing vault data would become undecryptable.`,
	);
}

function currentVaultKeyDescriptorPath(dataHome?: string): string {
	const keyPath = vaultKeyPath(dataHome);
	const stored = readLocalVaultKeyFile(keyPath);
	if (!stored || parseLocalVaultKeyDescriptor(stored)) return keyPath;
	return `${keyPath}.v2`;
}

function readCurrentVaultKeyDescriptor(dataHome?: string): LocalVaultKeyDescriptor | null {
	const keyPath = currentVaultKeyDescriptorPath(dataHome);
	const stored = readLocalVaultKeyFile(keyPath);
	if (!stored) return null;
	const descriptor = parseLocalVaultKeyDescriptor(stored);
	if (descriptor) return descriptor;
	throw new Error(
		`Invalid local vault key descriptor at ${keyPath}: expected JSON descriptor. Refusing to regenerate because existing vault data would become undecryptable.`,
	);
}

function getVaultPassphrase(): string | null {
	const passphrase = process.env[LOCAL_VAULT_PASSPHRASE_ENV];
	if (typeof passphrase !== "string" || passphrase.length === 0) {
		return null;
	}
	return passphrase;
}

function writeVaultKeyDescriptorAtomic(
	keyPath: string,
	descriptor: LocalVaultKeyDescriptor,
): boolean {
	return writeVaultKeyAtomic(keyPath, Buffer.from(JSON.stringify(descriptor), "utf8"));
}

function ensureCurrentVaultKey(dataHome?: string): Buffer {
	const passphrase = getVaultPassphrase();
	const keyPath = currentVaultKeyDescriptorPath(dataHome);
	const existing = readCurrentVaultKeyDescriptor(dataHome);
	const descriptor = existing ?? (
		passphrase
			? {
				version: 2,
				provider: "local-aes-gcm",
				keySource: "passphrase",
				kdf: "pbkdf2-sha256",
				iterations: LOCAL_VAULT_KEY_PBKDF2_ITERATIONS,
				salt: crypto.randomBytes(32).toString("base64"),
				createdAt: new Date().toISOString(),
			}
			: {
				version: 2,
				provider: "local-aes-gcm",
				keySource: "random-file",
				key: crypto.randomBytes(32).toString("base64"),
				createdAt: new Date().toISOString(),
			}
	) satisfies LocalVaultKeyDescriptor;

	if (!existing) {
		fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
		if (!writeVaultKeyDescriptorAtomic(keyPath, descriptor)) {
			return ensureCurrentVaultKey(dataHome);
		}
	}

	if (descriptor.keySource === "random-file") {
		const key = Buffer.from(descriptor.key ?? "", "base64");
		if (key.length !== 32) {
			throw new Error(
				`Invalid local vault key descriptor at ${keyPath}: expected 32-byte random key.`,
			);
		}
		return key;
	}

	if (!passphrase) {
		throw new Error(
			`Local AES-GCM credential protection requires ${LOCAL_VAULT_PASSPHRASE_ENV} for this passphrase-protected vault key.`,
		);
	}
	if (
		descriptor.kdf !== "pbkdf2-sha256" ||
		descriptor.iterations !== LOCAL_VAULT_KEY_PBKDF2_ITERATIONS ||
		typeof descriptor.salt !== "string"
	) {
		throw new Error(
			`Invalid local vault key descriptor at ${keyPath}: expected passphrase KDF metadata.`,
		);
	}
	const descriptorSalt = Buffer.from(descriptor.salt, "base64");
	if (descriptorSalt.length !== 32) {
		throw new Error(
			`Invalid local vault key descriptor at ${keyPath}: expected 32-byte salt.`,
		);
	}
	return crypto.pbkdf2Sync(
		passphrase,
		descriptorSalt,
		LOCAL_VAULT_KEY_PBKDF2_ITERATIONS,
		32,
		"sha256",
	);
}

function decryptWithKey(payload: string | Buffer, key: Buffer): string {
	const ciphertext = Buffer.isBuffer(payload)
		? payload
		: Buffer.from(payload, "base64");
	const iv = ciphertext.subarray(0, 16);
	const authTag = ciphertext.subarray(16, 32);
	const encrypted = ciphertext.subarray(32);
	const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([
		decipher.update(encrypted),
		decipher.final(),
	]).toString("utf8");
}

function localEncrypt(plaintext: string, dataHome?: string): string {
	const key = ensureCurrentVaultKey(dataHome);
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const ciphertext = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
	return JSON.stringify({ version: 2, ciphertext } satisfies LocalEncryptedPayload);
}

function localDecrypt(payload: string | Buffer, dataHome?: string): string {
	if (typeof payload === "string") {
		const structured = parseLocalEncryptedPayload(payload);
		if (structured) return decryptWithKey(structured.ciphertext, ensureCurrentVaultKey(dataHome));
	}

	const legacyKey = readLegacyVaultKey(dataHome);
	if (legacyKey) return decryptWithKey(payload, legacyKey);
	return decryptWithKey(payload, ensureCurrentVaultKey(dataHome));
}

function dpapiScript(mode: "protect" | "unprotect"): string {
	if (mode === "protect") {
		return [
			"$ErrorActionPreference = 'Stop'",
			"Add-Type -AssemblyName System.Security",
			"$inputText = [Console]::In.ReadToEnd()",
			"$bytes = [Text.Encoding]::UTF8.GetBytes($inputText)",
			"$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
			"[Console]::Out.Write([Convert]::ToBase64String($protected))",
		].join("; ");
	}

	return [
		"$ErrorActionPreference = 'Stop'",
		"Add-Type -AssemblyName System.Security",
		"$payload = [Console]::In.ReadToEnd().Trim()",
		"$bytes = [Convert]::FromBase64String($payload)",
		"$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
		"[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
	].join("; ");
}

function runPowerShellDpapi(mode: "protect" | "unprotect", input: string): string {
	const result = spawnSync(
		"powershell.exe",
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			dpapiScript(mode),
		],
		{
			encoding: "utf8",
			input,
			timeout: 10_000,
			windowsHide: true,
		},
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error((result.stderr || "DPAPI command failed").trim());
	}
	return result.stdout;
}

class WindowsDpapiProvider {
	readonly name = "windows-dpapi" as const;

	isAvailable(): boolean {
		return process.platform === "win32";
	}

	protect(plaintext: string): string {
		if (!this.isAvailable()) throw new Error("Windows DPAPI unavailable");
		return runPowerShellDpapi("protect", plaintext).trim();
	}

	unprotect(payload: string): string {
		if (!this.isAvailable()) throw new Error("Windows DPAPI unavailable");
		return runPowerShellDpapi("unprotect", payload);
	}
}

class LocalAesGcmProvider {
	readonly name = "local-aes-gcm" as const;

	constructor(private readonly dataHome?: string) {}

	isAvailable(): boolean {
		return true;
	}

	protect(plaintext: string): string {
		return localEncrypt(plaintext, this.dataHome);
	}

	unprotect(payload: string | Buffer): string {
		return localDecrypt(payload, this.dataHome);
	}
}

function encodeEnvelope(envelope: CredentialEnvelope): Buffer {
	return Buffer.from(JSON.stringify(envelope), "utf8");
}

function parseEnvelope(value: Buffer): CredentialEnvelope | null {
	try {
		const parsed = JSON.parse(value.toString("utf8")) as Partial<CredentialEnvelope>;
		if (
			parsed.version === 1 &&
			(parsed.provider === "windows-dpapi" ||
				parsed.provider === "local-aes-gcm") &&
			typeof parsed.payload === "string"
		) {
			return parsed as CredentialEnvelope;
		}
	} catch {
		return null;
	}
	return null;
}

export class CredentialProtectionService {
	private readonly windows = new WindowsDpapiProvider();
	private readonly local: LocalAesGcmProvider;
	private readonly preferWindowsDpapi: boolean;
	private lastSelected: CredentialProtectionProviderName | null = null;
	private lastFallback: CredentialProtectionFallbackEvent | null = null;

	constructor(options: CredentialProtectionServiceOptions = {}) {
		this.preferWindowsDpapi = options.preferWindowsDpapi ?? true;
		this.local = new LocalAesGcmProvider(options.dataHome);
	}

	protect(plaintext: string): Buffer {
		if (this.preferWindowsDpapi && this.windows.isAvailable()) {
			try {
				const payload = this.windows.protect(plaintext);
				this.lastSelected = this.windows.name;
				return encodeEnvelope({
					version: 1,
					provider: this.windows.name,
					payload,
				});
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				this.lastFallback = {
					from: this.windows.name,
					to: this.local.name,
					reason,
					timestamp: new Date().toISOString(),
				};
				log.warn("Windows DPAPI protect failed; falling back to local AES-GCM", {
					error: reason,
				});
			}
		}

		const payload = this.local.protect(plaintext);
		this.lastSelected = this.local.name;
		return encodeEnvelope({ version: 1, provider: this.local.name, payload });
	}

	unprotect(value: Buffer): string {
		const envelope = parseEnvelope(value);
		if (!envelope) return this.local.unprotect(value);

		if (envelope.provider === "windows-dpapi") {
			return this.windows.unprotect(envelope.payload);
		}
		return this.local.unprotect(envelope.payload);
	}

	status(): CredentialProtectionProviderStatus[] {
		const windowsAvailable = this.windows.isAvailable();
		return [
			{
				name: this.windows.name,
				available: windowsAvailable,
				selected: this.lastSelected === this.windows.name,
				...(windowsAvailable ? {} : { reason: "Windows DPAPI requires win32" }),
			},
			{
				name: this.local.name,
				available: true,
				selected:
					this.lastSelected === this.local.name ||
					(this.lastSelected === null &&
						(!this.preferWindowsDpapi || !windowsAvailable)),
				...(this.lastFallback && this.lastSelected === this.local.name
					? {
						reason: `Selected after ${this.lastFallback.from} failed: ${this.lastFallback.reason}`,
						fallback: { ...this.lastFallback },
					}
					: {}),
			},
		];
	}
}

export function createCredentialProtectionService(
	options: CredentialProtectionServiceOptions = {},
): CredentialProtectionService {
	return new CredentialProtectionService(options);
}
