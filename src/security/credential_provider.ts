import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSecretsDir } from "../shared/paths";

const LOCAL_VAULT_KEY_PBKDF2_ITERATIONS = 600_000;

export type CredentialProtectionProviderName =
	| "windows-dpapi"
	| "local-aes-gcm";

export interface CredentialProtectionProviderStatus {
	name: CredentialProtectionProviderName;
	available: boolean;
	selected: boolean;
	reason?: string;
}

interface CredentialEnvelope {
	version: 1;
	provider: CredentialProtectionProviderName;
	payload: string;
}

export interface CredentialProtectionServiceOptions {
	dataHome?: string;
	preferWindowsDpapi?: boolean;
}

function machineIdentity(): string {
	const userInfo = os.userInfo();
	return `${os.hostname()}:${userInfo.username}:${os.homedir()}`;
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

function ensureVaultKey(dataHome?: string): Buffer {
	const keyPath = vaultKeyPath(dataHome);
	if (fs.existsSync(keyPath)) {
		const stored = fs.readFileSync(keyPath);
		if (stored.length === 64) return stored.subarray(32);
		if (stored.length === 32) return stored;
		throw new Error(
			`Invalid local vault key file at ${keyPath}: expected 32 or 64 bytes, found ${stored.length}. Refusing to regenerate because existing vault data would become undecryptable.`,
		);
	}

	fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
	const salt = crypto.randomBytes(32);
	const key = crypto.pbkdf2Sync(
		machineIdentity(),
		salt,
		LOCAL_VAULT_KEY_PBKDF2_ITERATIONS,
		32,
		"sha256",
	);
	if (!writeVaultKeyAtomic(keyPath, Buffer.concat([salt, key]))) {
		return ensureVaultKey(dataHome);
	}
	return key;
}

function localEncrypt(plaintext: string, dataHome?: string): string {
	const key = ensureVaultKey(dataHome);
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function localDecrypt(payload: string | Buffer, dataHome?: string): string {
	const ciphertext = Buffer.isBuffer(payload)
		? payload
		: Buffer.from(payload, "base64");
	const key = ensureVaultKey(dataHome);
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
			} catch {
				// Fall back to local encryption. The caller never receives raw values.
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
			},
		];
	}
}

export function createCredentialProtectionService(
	options: CredentialProtectionServiceOptions = {},
): CredentialProtectionService {
	return new CredentialProtectionService(options);
}
