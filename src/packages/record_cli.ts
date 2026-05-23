import fs from "node:fs";
import path from "node:path";
import { getDataHome } from "../shared/paths";
import {
	convertRecordingToPackage,
	convertRecordingToWorkflow,
	ActionRecorder,
	type RecordedAction,
	type RecordedActionKind,
	type PackageDraft,
	type RecordingSession,
} from "../observability/recorder";
import { redactObject, redactString } from "../observability/redaction";
import { redactSecretRefs } from "../security/credential_vault";
import type { ActionResult } from "../shared/action_result";
import {
	materializePackageDraft,
	type MaterializedPackageDraft,
} from "./materialize";
import { recordDiscoveryTelemetry } from "./savings_telemetry";

interface ActiveRecording {
	id: string;
}

export interface PackageRecordingDraft {
	session: RecordingSession;
	workflow: ReturnType<typeof convertRecordingToWorkflow>;
	package: PackageDraft;
}

function recordingsRoot(dataHome?: string): string {
	return path.join(dataHome ?? getDataHome(), "packages", "recordings");
}

function sessionsDir(dataHome?: string): string {
	return path.join(recordingsRoot(dataHome), "sessions");
}

function activePath(dataHome?: string): string {
	return path.join(recordingsRoot(dataHome), "active.json");
}

function sessionPath(id: string, dataHome?: string): string {
	return path.join(sessionsDir(dataHome), `${id}.json`);
}

function ensureRecordingDirs(dataHome?: string): void {
	fs.mkdirSync(sessionsDir(dataHome), { recursive: true });
}

function readJsonFile<T>(filePath: string): T | null {
	if (!fs.existsSync(filePath)) return null;
	return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function saveSession(session: RecordingSession, dataHome?: string): void {
	ensureRecordingDirs(dataHome);
	fs.writeFileSync(
		sessionPath(session.id, dataHome),
		`${JSON.stringify(session, null, 2)}\n`,
		"utf8",
	);
}

export function startPackageRecording(
	options: { name: string; domain?: string; dataHome?: string },
): RecordingSession {
	ensureRecordingDirs(options.dataHome);
	const active = readJsonFile<ActiveRecording>(activePath(options.dataHome));
	if (active) {
		throw new Error(`Recording already active: ${active.id}`);
	}

	const recorder = new ActionRecorder();
	const session = recorder.start(options.name, options.domain);
	saveSession(session, options.dataHome);
	fs.writeFileSync(
		activePath(options.dataHome),
		`${JSON.stringify({ id: session.id }, null, 2)}\n`,
		"utf8",
	);
	return session;
}

export function stopPackageRecording(options: { dataHome?: string } = {}): RecordingSession {
	const active = readJsonFile<ActiveRecording>(activePath(options.dataHome));
	if (!active) {
		throw new Error("No active package recording.");
	}
	const session = getPackageRecording(active.id, options);
	fs.rmSync(activePath(options.dataHome), { force: true });
	recordDiscoveryTelemetry(session, options.dataHome);
	return session;
}

function redactRecordedValue(value: unknown): unknown {
	const redacted = redactObject(value);
	if (typeof redacted === "string") return redactSecretRefs(redacted);
	if (Array.isArray(redacted)) return redacted.map(redactRecordedValue);
	if (typeof redacted === "object" && redacted !== null) {
		return Object.fromEntries(
			Object.entries(redacted).map(([key, item]) => [
				key,
				redactRecordedValue(item),
			]),
		);
	}
	return redacted;
}

export function recordPackageRecordingAction(
	options: {
		kind: RecordedActionKind;
		params?: Record<string, unknown>;
		result?: ActionResult;
		dataHome?: string;
	},
): RecordedAction {
	const active = readJsonFile<ActiveRecording>(activePath(options.dataHome));
	if (!active) {
		throw new Error("No active package recording.");
	}
	const session = getPackageRecording(active.id, options);
	const result = options.result;
	const action: RecordedAction = {
		id: `act-${session.actions.length + 1}`,
		kind: options.kind,
		timestamp: new Date().toISOString(),
		params: redactRecordedValue(options.params ?? {}) as Record<string, unknown>,
		result: result?.data,
		error: result?.error
			? redactSecretRefs(redactString(result.error))
			: undefined,
		policyDecision: result?.policyDecision,
		sessionId: session.sessionId,
	};
	session.actions.push(action);
	saveSession(session, options.dataHome);
	return action;
}

export function getPackageRecording(
	id: string,
	options: { dataHome?: string } = {},
): RecordingSession {
	const session = readJsonFile<RecordingSession>(sessionPath(id, options.dataHome));
	if (!session) {
		throw new Error(`Recording not found: ${id}`);
	}
	return session;
}

export function draftPackageRecording(
	id: string,
	options: { dataHome?: string } = {},
): PackageRecordingDraft {
	const session = getPackageRecording(id, options);
	return {
		session,
		workflow: convertRecordingToWorkflow(session),
		package: convertRecordingToPackage(session),
	};
}

export function materializePackageRecording(
	id: string,
	options: { dataHome?: string; overwrite?: boolean } = {},
): MaterializedPackageDraft {
	const draft = draftPackageRecording(id, options);
	return materializePackageDraft(draft.package, {
		dataHome: options.dataHome,
		overwrite: options.overwrite,
	});
}
