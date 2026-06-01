const SAFE_EXACT_ENV_NAMES = new Set([
	"COMSPEC",
	"HOME",
	"PATH",
	"PATHEXT",
	"SYSTEMROOT",
	"TEMP",
	"TMP",
	"USERPROFILE",
	"WINDIR",
]);

const SAFE_ENV_PREFIXES = ["BROWSER_CONTROL_", "BROKER_", "NODE_"];

export function isSafeChildEnvName(name: string): boolean {
	const normalized = String(name).toUpperCase();
	return (
		SAFE_EXACT_ENV_NAMES.has(normalized) ||
		SAFE_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))
	);
}

function assignDefined(
	target: NodeJS.ProcessEnv,
	source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): void {
	for (const [key, value] of Object.entries(source || {})) {
		if (value === undefined) continue;
		target[key] = String(value);
	}
}

export function buildSafeChildEnv(
	source: NodeJS.ProcessEnv = process.env,
	extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(source || {})) {
		if (value === undefined || !isSafeChildEnvName(key)) continue;
		env[key] = String(value);
	}
	assignDefined(env, extra);
	return env;
}
