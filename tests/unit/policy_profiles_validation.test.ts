import assert from "node:assert/strict";
import test from "node:test";

import { TRUSTED_PROFILE, validateProfile } from "../../src/policy/profiles";
import type { PolicyProfile } from "../../src/policy/types";

test("validateProfile rejects malformed policy field types", () => {
	const malformed = {
		...TRUSTED_PROFILE,
		name: "malformed_types",
		commandPolicy: {
			...TRUSTED_PROFILE.commandPolicy,
			deniedCommands: "rm",
		},
		lowLevelPolicy: {
			...TRUSTED_PROFILE.lowLevelPolicy,
			rawCdpAllowed: "false",
		},
		credentialPolicy: {
			...TRUSTED_PROFILE.credentialPolicy,
			secretRevealAllowed: "false",
		},
	} as unknown as PolicyProfile;

	const validation = validateProfile(malformed);

	assert.equal(validation.valid, false);
	assert.match(validation.errors.join("\n"), /commandPolicy\.deniedCommands/);
	assert.match(validation.errors.join("\n"), /lowLevelPolicy\.rawCdpAllowed/);
	assert.match(validation.errors.join("\n"), /credentialPolicy\.secretRevealAllowed/);
});

test("validateProfile rejects malformed enum and scalar fields", () => {
	const malformed = {
		...TRUSTED_PROFILE,
		name: "malformed_scalars",
		filesystemPolicy: {
			...TRUSTED_PROFILE.filesystemPolicy,
			recursiveDeleteDefaultBehavior: "allow",
		},
		browserPolicy: {
			...TRUSTED_PROFILE.browserPolicy,
			dialogHandling: "ignore",
			dialogTimeoutMs: "5000",
		},
		privacyPolicy: {
			...TRUSTED_PROFILE.privacyPolicy,
			profile: "public",
		},
	} as unknown as PolicyProfile;

	const validation = validateProfile(malformed);

	assert.equal(validation.valid, false);
	assert.match(validation.errors.join("\n"), /filesystemPolicy\.recursiveDeleteDefaultBehavior/);
	assert.match(validation.errors.join("\n"), /browserPolicy\.dialogHandling/);
	assert.match(validation.errors.join("\n"), /browserPolicy\.dialogTimeoutMs/);
	assert.match(validation.errors.join("\n"), /privacyPolicy\.profile/);
});

