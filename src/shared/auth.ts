import crypto from "node:crypto";

export function constantTimeTokenEqual(
	actual: string | null | undefined,
	expected: string | null | undefined,
): boolean {
	if (!actual || !expected) return false;

	const actualBuffer = Buffer.from(actual, "utf8");
	const expectedBuffer = Buffer.from(expected, "utf8");
	const actualDigest = crypto.createHash("sha256").update(actualBuffer).digest();
	const expectedDigest = crypto.createHash("sha256").update(expectedBuffer).digest();

	return (
		crypto.timingSafeEqual(actualDigest, expectedDigest) &&
		actualBuffer.length === expectedBuffer.length
	);
}
