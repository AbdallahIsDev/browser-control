import crypto from "node:crypto";

export function constantTimeTokenEqual(
	actual: string | null | undefined,
	expected: string | null | undefined,
): boolean {
	if (!actual || !expected) return false;

	const actualBuffer = Buffer.from(actual, "utf8");
	const expectedBuffer = Buffer.from(expected, "utf8");
	if (actualBuffer.length !== expectedBuffer.length) return false;

	return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
