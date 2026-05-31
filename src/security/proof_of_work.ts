import crypto from "node:crypto";

export interface ProofOfWorkChallenge {
  algorithm: "sha256";
  challenge: string;
  difficulty: number;
  expiresAt: string;
  signature: string;
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
  secret?: string | Buffer;
}

const DEFAULT_DIFFICULTY = 4;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_DIFFICULTY = 8;
const PROCESS_PROOF_OF_WORK_SECRET = crypto.randomBytes(32);

export function createProofOfWorkChallenge(options: ProofOfWorkOptions = {}): ProofOfWorkChallenge {
  const difficulty = normalizeDifficulty(options.difficulty ?? DEFAULT_DIFFICULTY);
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? crypto.randomBytes;
  const challenge = {
    algorithm: "sha256",
    challenge: randomBytes(24).toString("base64url"),
    difficulty,
    expiresAt: new Date(now() + (options.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
  } satisfies Omit<ProofOfWorkChallenge, "signature">;
  return {
    ...challenge,
    signature: signProofOfWorkChallenge(challenge, options.secret),
  };
}

export function verifyProofOfWork(
  challenge: ProofOfWorkChallenge,
  solution: ProofOfWorkSolution,
  options: { now?: () => number; secret?: string | Buffer } = {},
): ProofOfWorkVerification {
  if (challenge.algorithm !== "sha256") {
    return { ok: false, error: `Unsupported proof-of-work algorithm: ${challenge.algorithm}` };
  }
  if (!verifyChallengeSignature(challenge, options.secret)) {
    return { ok: false, error: "Proof-of-work challenge integrity check failed." };
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

  let difficulty: number;
  try {
    difficulty = normalizeDifficulty(challenge.difficulty);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const hash = hashProofOfWork(challenge.challenge, difficulty, solution.nonce);
  const ok = hash.startsWith("0".repeat(difficulty));
  return ok ? { ok, hash } : { ok, hash, error: "Proof-of-work difficulty target not met." };
}

export function solveProofOfWorkForTest(
  challenge: ProofOfWorkChallenge,
  options: { maxAttempts?: number } = {},
): ProofOfWorkSolution {
  const maxAttempts = options.maxAttempts ?? 1_000_000;
  const difficulty = normalizeDifficulty(challenge.difficulty);
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

function signProofOfWorkChallenge(
  challenge: Omit<ProofOfWorkChallenge, "signature">,
  secret: string | Buffer = PROCESS_PROOF_OF_WORK_SECRET,
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(challenge.algorithm)
    .update(":")
    .update(challenge.challenge)
    .update(":")
    .update(String(challenge.difficulty))
    .update(":")
    .update(challenge.expiresAt)
    .digest("base64url");
}

function verifyChallengeSignature(
  challenge: ProofOfWorkChallenge,
  secret: string | Buffer = PROCESS_PROOF_OF_WORK_SECRET,
): boolean {
  if (!challenge.signature) {
    return false;
  }
  const expected = signProofOfWorkChallenge(challenge, secret);
  const actualBytes = Buffer.from(challenge.signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function normalizeDifficulty(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DIFFICULTY) {
    throw new Error(`Proof-of-work difficulty must be an integer from 1 to ${MAX_DIFFICULTY}.`);
  }
  return value;
}
