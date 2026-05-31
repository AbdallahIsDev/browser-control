import crypto from "node:crypto";

import type { ProofOfWorkChallenge, ProofOfWorkSolution } from "../../../src/security/proof_of_work";

export function solveProofOfWorkForTest(
  challenge: ProofOfWorkChallenge,
  options: { maxAttempts?: number } = {},
): ProofOfWorkSolution {
  const maxAttempts = options.maxAttempts ?? 1_000_000;
  const difficulty = challenge.difficulty;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const nonce = String(attempt);
    if (hashProofOfWork(challenge.challenge, difficulty, nonce).startsWith("0".repeat(difficulty))) {
      return { challenge: challenge.challenge, nonce };
    }
  }
  throw new Error(`Unable to solve proof-of-work challenge within ${maxAttempts} attempts.`);
}

function hashProofOfWork(challenge: string, difficulty: number, nonce: string): string {
  return crypto
    .createHash("sha256")
    .update(challenge)
    .update(":")
    .update(String(difficulty))
    .update(":")
    .update(nonce)
    .digest("hex");
}
