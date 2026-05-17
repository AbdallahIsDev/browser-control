import crypto from "node:crypto";

export interface ProofOfWorkChallenge {
  algorithm: "sha256";
  challenge: string;
  difficulty: number;
  expiresAt: string;
}

export interface ProofOfWorkSolution {
  challenge: string;
  nonce: string;
}

export interface ProofOfWorkVerification {
  ok: boolean;
  hash?: string;
  error?: string;
}

export interface ProofOfWorkOptions {
  difficulty?: number;
  ttlMs?: number;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}

const DEFAULT_DIFFICULTY = 4;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_DIFFICULTY = 8;

export function createProofOfWorkChallenge(options: ProofOfWorkOptions = {}): ProofOfWorkChallenge {
  const difficulty = normalizeDifficulty(options.difficulty ?? DEFAULT_DIFFICULTY);
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? crypto.randomBytes;
  return {
    algorithm: "sha256",
    challenge: randomBytes(24).toString("base64url"),
    difficulty,
    expiresAt: new Date(now() + (options.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
  };
}

export function verifyProofOfWork(
  challenge: ProofOfWorkChallenge,
  solution: ProofOfWorkSolution,
  options: { now?: () => number } = {},
): ProofOfWorkVerification {
  if (challenge.algorithm !== "sha256") {
    return { ok: false, error: `Unsupported proof-of-work algorithm: ${challenge.algorithm}` };
  }
  if (solution.challenge !== challenge.challenge) {
    return { ok: false, error: "Proof-of-work challenge mismatch." };
  }
  if (!solution.nonce || solution.nonce.length > 256) {
    return { ok: false, error: "Proof-of-work nonce is missing or too large." };
  }
  const now = options.now ?? Date.now;
  const expiresAtMs = new Date(challenge.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now()) {
    return { ok: false, error: "Proof-of-work challenge expired." };
  }

  const difficulty = normalizeDifficulty(challenge.difficulty);
  const hash = hashProofOfWork(challenge.challenge, solution.nonce);
  const ok = hash.startsWith("0".repeat(difficulty));
  return ok ? { ok, hash } : { ok, hash, error: "Proof-of-work difficulty target not met." };
}

export function solveProofOfWorkForTest(
  challenge: ProofOfWorkChallenge,
  options: { maxAttempts?: number } = {},
): ProofOfWorkSolution {
  const maxAttempts = options.maxAttempts ?? 1_000_000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const nonce = String(attempt);
    if (hashProofOfWork(challenge.challenge, nonce).startsWith("0".repeat(challenge.difficulty))) {
      return { challenge: challenge.challenge, nonce };
    }
  }
  throw new Error(`Unable to solve proof-of-work challenge within ${maxAttempts} attempts.`);
}

function hashProofOfWork(challenge: string, nonce: string): string {
  return crypto
    .createHash("sha256")
    .update(challenge)
    .update(":")
    .update(nonce)
    .digest("hex");
}

function normalizeDifficulty(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DIFFICULTY) {
    throw new Error(`Proof-of-work difficulty must be an integer from 1 to ${MAX_DIFFICULTY}.`);
  }
  return value;
}
