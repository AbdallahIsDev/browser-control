import crypto from "node:crypto";
import { redactString } from "../observability/redaction";
import type { PolicyDecision } from "../policy/types";
import {
	type StateStorage,
	type StoredSecretAuditEvent,
	type StoredSecretGrant,
	getStateStorage,
} from "../state/index";
import { logger } from "../shared/logger";
import {
	type CredentialProtectionProviderStatus,
	type CredentialProtectionService,
	createCredentialProtectionService,
} from "./credential_provider";

const log = logger.withComponent("credential-vault");
const REDACTED_SECRET = "[REDACTED_SECRET]";

export class SecretString {
	private readonly _value: string;

	constructor(value: string) {
		this._value = value;
	}

	reveal(): string {
		return this._value;
	}

	toString(): string {
		return REDACTED_SECRET;
	}

	toJSON(): string {
		return REDACTED_SECRET;
	}

	[Symbol.toPrimitive](_hint: string): string {
		return REDACTED_SECRET;
	}

	get length(): number {
		return 0;
	}

	valueOf(): never {
		throw new Error(
			"SecretString.valueOf() is forbidden to prevent accidental leaks",
		);
	}
}

export type SecretScope = "site" | "package" | "workflow";

export type SecretAction =
	| "reveal"
	| "type"
	| "paste"
	| "use-as-header"
	| "use-as-form-value";

const SECRET_ACTIONS = new Set<SecretAction>([
	"reveal",
	"type",
	"paste",
	"use-as-header",
	"use-as-form-value",
]);

export interface SecretReference {
	scope: SecretScope;
	scopeName: string;
	secretName: string;
}

export interface SecretGrant {
	id: string;
	secretId: string;
	action: SecretAction;
	actions: SecretAction[];
	siteScope?: string;
	domainScope?: string;
	packageScope?: string;
	workflowScope?: string;
	domain?: string;
	expiresAt?: string;
	revoked: boolean;
	revokedAt?: string;
	createdAt: string;
}

export interface SecretGrantInput {
	action?: SecretAction;
	actions?: SecretAction[];
	siteScope?: string;
	domainScope?: string;
	packageScope?: string;
	workflowScope?: string;
	domain?: string;
	expiresAt?: string;
}

export interface SecretUseContext {
	action: SecretAction;
	targetDomain?: string;
	site?: string;
	packageName?: string;
	workflowId?: string;
	sessionId?: string;
	policyDecision?: PolicyDecision | "allow" | "deny";
}

export type SecretUseResolution =
	| {
			success: true;
			id: string;
			value: SecretString;
			grantId: string;
			redactedValue: typeof REDACTED_SECRET;
	  }
	| {
			success: false;
			id: string;
			error: string;
	  };

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
	provider?: string;
}

function normalizeEncryptedValue(value: unknown): Buffer {
	if (Buffer.isBuffer(value)) return value;
	if (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "Buffer" &&
		Array.isArray((value as { data?: unknown }).data)
	) {
		return Buffer.from((value as { data: number[] }).data);
	}
	return Buffer.alloc(0);
}

export function parseSecretRef(ref: string): SecretReference | null {
	const match = /^secret:\/\/(site|package|workflow)\/([^/]+)\/(.+)$/u.exec(ref);
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

export function containsSecretRef(value: unknown): boolean {
	if (typeof value === "string") return parseSecretRef(value) !== null;
	if (Array.isArray(value)) return value.some(containsSecretRef);
	if (typeof value === "object" && value !== null) {
		return Object.values(value).some(containsSecretRef);
	}
	return false;
}

export function redactSecretRefs(value: string): string {
	return value.replace(
		/secret:\/\/(?:site|package|workflow)\/[^/\s]+\/[^\s"'<>]+/gu,
		REDACTED_SECRET,
	);
}

export function redactKnownSecretValues(
	value: unknown,
	secretValues: string[],
): unknown {
	const activeSecrets = secretValues.filter(Boolean);
	if (activeSecrets.length === 0) return value;
	if (typeof value === "string") {
		let out = value;
		for (const secret of activeSecrets) {
			out = out.split(secret).join(REDACTED_SECRET);
		}
		return redactString(redactSecretRefs(out));
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactKnownSecretValues(item, activeSecrets));
	}
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				redactKnownSecretValues(item, activeSecrets),
			]),
		);
	}
	return value;
}

function isSecretAction(action: unknown): action is SecretAction {
	return typeof action === "string" && SECRET_ACTIONS.has(action as SecretAction);
}

function normalizeGrantActions(input: SecretGrantInput): SecretAction[] {
	const raw = input.actions?.length ? input.actions : [input.action ?? "reveal"];
	const actions = Array.from(new Set(raw)).filter(isSecretAction);
	if (actions.length === 0) throw new Error("Grant requires at least one action");
	return actions;
}

function normalizeHost(value?: string): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) return undefined;
	try {
		return new URL(trimmed).hostname.toLowerCase();
	} catch {
		return trimmed.replace(/^\*\./u, "");
	}
}

function domainMatches(scope: string | undefined, target: string | undefined): boolean {
	const normalizedScope = normalizeHost(scope);
	const normalizedTarget = normalizeHost(target);
	if (!normalizedScope) return true;
	if (!normalizedTarget) return false;
	return (
		normalizedTarget === normalizedScope ||
		normalizedTarget.endsWith(`.${normalizedScope}`)
	);
}

function scopeMatches(expected: string | undefined, actual: string | undefined): boolean {
	if (!expected) return true;
	if (!actual) return false;
	return expected === actual;
}

function storedGrantToGrant(grant: StoredSecretGrant): SecretGrant {
	const rawActions = Array.isArray(grant.actions) ? grant.actions : [grant.action];
	const actions = rawActions.filter(isSecretAction);
	const action = actions[0] ?? "reveal";
	return {
		id: grant.id,
		secretId: grant.secretId,
		action,
		actions: actions.length > 0 ? actions : [action],
		siteScope: grant.siteScope ?? undefined,
		domainScope: grant.domainScope ?? grant.domain ?? undefined,
		packageScope: grant.packageScope ?? undefined,
		workflowScope: grant.workflowScope ?? undefined,
		domain: grant.domain ?? undefined,
		expiresAt: grant.expiresAt ?? undefined,
		revoked: grant.revoked,
		revokedAt: grant.revokedAt ?? undefined,
		createdAt: grant.createdAt,
	};
}

export class CredentialVault {
	private readonly storage: StateStorage;
	private readonly protector: CredentialProtectionService;

	constructor(storage?: StateStorage, protector?: CredentialProtectionService) {
		this.storage = storage ?? getStateStorage();
		this.protector = protector ?? createCredentialProtectionService();
	}

	providerStatus(): CredentialProtectionProviderStatus[] {
		return this.protector.status();
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
		const encrypted = this.protector.protect(value);

		await this.storage.saveSecret({
			id,
			scope,
			scopeName,
			secretName,
			encryptedValue: encrypted,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		});

		log.info("Secret stored", { id });
		return {
			id,
			scope,
			scopeName,
			secretName,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
	}

	async getValue(ref: string): Promise<string | null> {
		const stored = await this.storage.getSecret(ref);
		if (!stored) return null;
		try {
			return this.protector.unprotect(
				normalizeEncryptedValue(stored.encryptedValue),
			);
		} catch {
			log.error("Failed to decrypt secret", { id: ref });
			return null;
		}
	}

	async delete(ref: string): Promise<boolean> {
		await this.storage.deleteSecret(ref);
		log.info("Secret deleted", { id: ref });
		return true;
	}

	async list(): Promise<SecretEntry[]> {
		const stored = await this.storage.listSecrets();
		return stored.map((secret) => ({
			id: secret.id,
			scope: secret.scope,
			scopeName: secret.scopeName,
			secretName: secret.secretName,
			createdAt: secret.createdAt,
			updatedAt: secret.updatedAt,
			hasValue: normalizeEncryptedValue(secret.encryptedValue).length > 0,
		}));
	}

	async resolve(ref: string): Promise<{ id: string; value: SecretString } | null> {
		const value = await this.getValue(ref);
		if (!value) return null;
		return { id: ref, value: new SecretString(value) };
	}

	async grant(
		secretRef: string,
		actionOrInput: SecretAction | SecretGrantInput,
		domain?: string,
		expiresAt?: string,
	): Promise<SecretGrant> {
		const input: SecretGrantInput =
			typeof actionOrInput === "string"
				? { action: actionOrInput, domain, domainScope: domain, expiresAt }
				: actionOrInput;
		const actions = normalizeGrantActions(input);
		const now = new Date().toISOString();
		const grant: SecretGrant = {
			id: `grant-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
			secretId: secretRef,
			action: actions[0],
			actions,
			siteScope: input.siteScope,
			domainScope: input.domainScope ?? input.domain,
			packageScope: input.packageScope,
			workflowScope: input.workflowScope,
			domain: input.domain ?? input.domainScope,
			expiresAt: input.expiresAt,
			revoked: false,
			createdAt: now,
		};

		await this.storage.saveGrant({
			id: grant.id,
			secretId: grant.secretId,
			action: grant.action,
			actions: grant.actions,
			domain: grant.domain ?? null,
			siteScope: grant.siteScope ?? null,
			domainScope: grant.domainScope ?? null,
			packageScope: grant.packageScope ?? null,
			workflowScope: grant.workflowScope ?? null,
			expiresAt: grant.expiresAt ?? null,
			revoked: false,
			revokedAt: null,
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
		return stored.map(storedGrantToGrant);
	}

	checkGrant(
		secretRef: string,
		action: SecretAction,
		grant: SecretGrant,
		contextOrDomain: Partial<SecretUseContext> | string = {},
	): boolean {
		const context: SecretUseContext =
			typeof contextOrDomain === "string"
				? { targetDomain: contextOrDomain, action }
				: { ...contextOrDomain, action: contextOrDomain.action ?? action };
		if (grant.revoked) return false;
		if (grant.secretId !== secretRef) return false;
		if (!grant.actions.includes(action)) return false;
		if (grant.expiresAt && new Date(grant.expiresAt) < new Date()) return false;
		if (!domainMatches(grant.domainScope ?? grant.domain, context.targetDomain)) {
			return false;
		}
		if (!domainMatches(grant.siteScope, context.site ?? context.targetDomain)) {
			return false;
		}
		if (!scopeMatches(grant.packageScope, context.packageName)) return false;
		if (!scopeMatches(grant.workflowScope, context.workflowId)) return false;
		return true;
	}

	async isActionGranted(
		secretRef: string,
		action: SecretAction,
		contextOrDomain?: Partial<SecretUseContext> | string,
	): Promise<boolean> {
		const grants = await this.listGrants(secretRef);
		return grants.some((grant) =>
			this.checkGrant(secretRef, action, grant, contextOrDomain ?? {}),
		);
	}

	async resolveForUse(
		secretRef: string,
		context: SecretUseContext,
	): Promise<SecretUseResolution> {
		const parsed = parseSecretRef(secretRef);
		if (!parsed) {
			return this.deny(secretRef, context, "Invalid secret reference");
		}

		const grants = await this.listGrants(secretRef);
		const grant = grants.find((candidate) =>
			this.checkGrant(secretRef, context.action, candidate, context),
		);
		if (!grant) {
			return this.deny(secretRef, context, "No active grant permits secret use");
		}

		const value = await this.getValue(secretRef);
		if (value === null) {
			return this.deny(secretRef, context, "Secret is missing or unreadable");
		}

		await this.auditSecretUse(secretRef, context, "allow", grant.id);
		return {
			success: true,
			id: secretRef,
			value: new SecretString(value),
			grantId: grant.id,
			redactedValue: REDACTED_SECRET,
		};
	}

	private async deny(
		secretRef: string,
		context: SecretUseContext,
		error: string,
	): Promise<SecretUseResolution> {
		await this.auditSecretUse(secretRef, context, "deny", undefined, error);
		return { success: false, id: secretRef, error };
	}

	private async auditSecretUse(
		secretRef: string,
		context: SecretUseContext,
		policyDecision: "allow" | "deny",
		grantId?: string,
		deniedReason?: string,
	): Promise<void> {
		const event: StoredSecretAuditEvent = {
			id: `secret-audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
			secretId: secretRef,
			action: context.action,
			targetDomain: normalizeHost(context.targetDomain) ?? null,
			policyDecision,
			sessionId: context.sessionId ?? null,
			timestamp: new Date().toISOString(),
			grantId: grantId ?? null,
			packageName: context.packageName ?? null,
			workflowId: context.workflowId ?? null,
			site: context.site ?? null,
			deniedReason: deniedReason ?? null,
			redaction: { rawSecretStored: false, output: REDACTED_SECRET },
		};
		await this.storage.saveSecretAuditEvent(event);
	}

	close(): void {
		// StateStorage is owned by the state singleton or API container.
	}
}

let defaultVault: CredentialVault | null = null;

export function getCredentialVault(): CredentialVault {
	if (!defaultVault) defaultVault = new CredentialVault();
	return defaultVault;
}

export function resetCredentialVault(): void {
	if (defaultVault) {
		defaultVault.close();
		defaultVault = null;
	}
}
