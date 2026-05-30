"use strict";

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

function isSafeChildEnvName(name) {
	const normalized = String(name).toUpperCase();
	return (
		SAFE_EXACT_ENV_NAMES.has(normalized) ||
		SAFE_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))
	);
}

function assignDefined(target, source) {
	for (const [key, value] of Object.entries(source || {})) {
		if (value === undefined) continue;
		target[key] = String(value);
	}
}

function buildSafeChildEnv(source = process.env, extra = {}) {
	const env = {};
	for (const [key, value] of Object.entries(source || {})) {
		if (value === undefined || !isSafeChildEnvName(key)) continue;
		env[key] = String(value);
	}
	assignDefined(env, extra);
	return env;
}

module.exports = {
	buildSafeChildEnv,
	isSafeChildEnvName,
};
