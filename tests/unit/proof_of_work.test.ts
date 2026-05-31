import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createProofOfWorkChallenge,
  verifyProofOfWork,
} from "../../src/security/proof_of_work";
import { solveProofOfWorkForTest } from "./helpers/proof_of_work";

describe("proof-of-work anti-abuse primitive", () => {
  it("creates bounded sha256 challenges and verifies solved nonces", () => {
    const challenge = createProofOfWorkChallenge({
      difficulty: 2,
      ttlMs: 60_000,
      now: () => 1_000,
      randomBytes: () => Buffer.from("deterministic-challenge-123"),
    });
    const solution = solveProofOfWorkForTest(challenge);
    const result = verifyProofOfWork(challenge, solution, { now: () => 2_000 });

    assert.equal(challenge.algorithm, "sha256");
    assert.equal(typeof challenge.signature, "string");
    assert.ok(challenge.signature.length > 0);
    assert.equal(result.ok, true);
    assert.match(result.hash ?? "", /^00/);
  });

  it("rejects expired, mismatched, and under-difficulty solutions", () => {
    const challenge = createProofOfWorkChallenge({
      difficulty: 2,
      ttlMs: 1_000,
      now: () => 1_000,
      randomBytes: () => Buffer.from("deterministic-challenge-456"),
    });

    assert.equal(
      verifyProofOfWork(challenge, { challenge: "other", nonce: "1" }, { now: () => 1_500 }).ok,
      false,
    );
    assert.equal(
      verifyProofOfWork(challenge, { challenge: challenge.challenge, nonce: "1" }, { now: () => 1_500 }).ok,
      false,
    );
    assert.match(
      verifyProofOfWork(challenge, { challenge: challenge.challenge, nonce: "1" }, { now: () => 3_000 }).error ?? "",
      /expired/i,
    );
  });

  it("bounds difficulty to prevent accidental local denial of service", () => {
    assert.throws(() => createProofOfWorkChallenge({ difficulty: 0 }), /difficulty/i);
    assert.throws(() => createProofOfWorkChallenge({ difficulty: 99 }), /difficulty/i);
  });

  it("rejects client-side challenge difficulty tampering", () => {
    const challenge = createProofOfWorkChallenge({
      difficulty: 3,
      ttlMs: 60_000,
      now: () => 1_000,
      randomBytes: () => Buffer.from("deterministic-challenge-789"),
    });
    const tampered = { ...challenge, difficulty: 1 };
    const solution = solveProofOfWorkForTest(tampered);
    const result = verifyProofOfWork(tampered, solution, { now: () => 2_000 });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /integrity/i);
  });
});
