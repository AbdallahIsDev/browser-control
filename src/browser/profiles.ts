/**
 * Browser Profiles — Profile management for Browser Control.
 *
 * Supports three profile types:
 *  - shared: persistent automation profile shared across runs
 *  - isolated: temporary profile discarded on close (default)
 *  - named: user-created persistent profiles for different identities
 *
 * Profile data directories live under <data-home>/browser/profiles/<profile-id>/.
 * Profile metadata is stored in <data-home>/browser/profiles/registry.json.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../shared/logger";
import { getProfilesDir as getCanonicalProfilesDir } from "../shared/paths";

const log = logger.withComponent("browser_profiles");

// ── Types ───────────────────────────────────────────────────────────

export type ProfileType = "shared" | "isolated" | "named";

export interface BrowserProfile {
  /** Unique profile identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Profile type */
  type: ProfileType;
  /** Filesystem path for Chrome user-data-dir */
  dataDir: string;
  /** ISO timestamp when profile was created */
  createdAt: string;
  /** ISO timestamp of last use */
  lastUsedAt: string;
}

export interface ProfileMetadata {
  id: string;
  name: string;
  type: ProfileType;
  createdAt: string;
  lastUsedAt: string;
}

export interface ProfilePurgeCandidate {
  id: string;
  name: string;
  type: ProfileType;
  dataDir: string;
  lastUsedAt: string;
  ageDays: number;
  sizeBytes: number;
}

export interface ProfilePurgeResult {
  dryRun: boolean;
  olderThanDays: number;
  candidates: ProfilePurgeCandidate[];
  deleted: ProfilePurgeCandidate[];
  reclaimedBytes: number;
}

// ── Path Helpers ────────────────────────────────────────────────────

/** Get the root directory for all browser profiles. */
export function getProfilesDir(): string {
  return getCanonicalProfilesDir();
}

/** Get the data directory for a specific profile. */
export function getProfileDataDir(profileId: string): string {
  // Sanitize profileId to prevent path traversal
  const safe = profileId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(getProfilesDir(), safe);
}

/** Get the metadata file path for profile registry. */
export function getProfileRegistryPath(): string {
  return path.join(getProfilesDir(), "registry.json");
}

// ── Default Profile ─────────────────────────────────────────────────

const DEFAULT_SHARED_PROFILE_ID = "default";
const DEFAULT_SHARED_PROFILE_NAME = "default";
const ISOLATED_PROFILE_PREFIX = "isolated-";

// ── Profile Registry ────────────────────────────────────────────────

interface ProfileRegistry {
  profiles: ProfileMetadata[];
  updatedAt: string;
}

function loadRegistry(): ProfileRegistry {
  const registryPath = getProfileRegistryPath();
  try {
    if (fs.existsSync(registryPath)) {
      return JSON.parse(fs.readFileSync(registryPath, "utf8")) as ProfileRegistry;
    }
  } catch {
    // Silently handle corrupt registry
  }
  return { profiles: [], updatedAt: new Date().toISOString() };
}

function saveRegistry(registry: ProfileRegistry): void {
  const registryPath = getProfileRegistryPath();
  const dir = path.dirname(registryPath);
  fs.mkdirSync(dir, { recursive: true });
  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

function sizeOfPath(target: string): number {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return 0;
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    let total = 0;
    for (const entry of fs.readdirSync(target)) {
      total += sizeOfPath(path.join(target, entry));
    }
    return total;
  } catch {
    return 0;
  }
}

// ── Profile Manager ─────────────────────────────────────────────────

export class BrowserProfileManager {
  private registry: ProfileRegistry;

  constructor() {
    this.registry = loadRegistry();
    this.ensureDefaultProfile();
  }

	/** Ensure the default profile exists. */
	private ensureDefaultProfile(): void {
		fs.mkdirSync(getProfileDataDir(DEFAULT_SHARED_PROFILE_ID), { recursive: true });
		if (!this.registry.profiles.find((p) => p.id === DEFAULT_SHARED_PROFILE_ID)) {
			const now = new Date().toISOString();
			this.registry.profiles.push({
				id: DEFAULT_SHARED_PROFILE_ID,
				name: DEFAULT_SHARED_PROFILE_NAME,
				type: "isolated",
				createdAt: now,
				lastUsedAt: now,
			});
			this.save();
		}
	}

  /** Create a new browser profile. */
  createProfile(name: string, type: ProfileType = "named"): BrowserProfile {
    // Check for duplicate name
    const existing = this.registry.profiles.find((p) => p.name === name);
    if (existing) {
      log.info(`Profile "${name}" already exists — returning existing.`);
      return this.metadataToProfile(existing);
    }

    const id = type === "isolated"
      ? `${ISOLATED_PROFILE_PREFIX}${Date.now()}-${randomUUID()}`
      : name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();

    const now = new Date().toISOString();
    const meta: ProfileMetadata = {
      id,
      name,
      type,
      createdAt: now,
      lastUsedAt: now,
    };

    // Create the profile data directory
    const dataDir = getProfileDataDir(id);
    fs.mkdirSync(dataDir, { recursive: true });

    this.registry.profiles.push(meta);
    this.save();

    log.info(`Profile "${name}" created (type: ${type}, id: ${id})`);
    return this.metadataToProfile(meta);
  }

  /** Get a profile by its ID. */
  getProfile(id: string): BrowserProfile | null {
    const meta = this.registry.profiles.find((p) => p.id === id);
    if (!meta) {
      return null;
    }
    return this.metadataToProfile(meta);
  }

  /** Get a profile by name. */
  getProfileByName(name: string): BrowserProfile | null {
    const meta = this.registry.profiles.find((p) => p.name === name);
    if (!meta) {
      return null;
    }
    return this.metadataToProfile(meta);
  }

  /** Get the default shared profile. */
  getDefaultProfile(): BrowserProfile {
    return this.getProfile(DEFAULT_SHARED_PROFILE_ID)!;
  }

  /** List all profiles, optionally filtered by type. */
  listProfiles(type?: ProfileType): BrowserProfile[] {
    let profiles = this.registry.profiles;
    if (type) {
      profiles = profiles.filter((p) => p.type === type);
    }
    return profiles.map((p) => this.metadataToProfile(p));
  }

  /** Delete a profile by ID. Cannot delete the default profile. */
  deleteProfile(id: string): boolean {
    if (id === DEFAULT_SHARED_PROFILE_ID) {
      log.warn("Cannot delete the default profile.");
      return false;
    }

    const index = this.registry.profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      return false;
    }

    const meta = this.registry.profiles[index];
    this.registry.profiles.splice(index, 1);
    this.save();

    // Remove profile data directory
    const dataDir = getProfileDataDir(id);
    try {
      if (fs.existsSync(dataDir)) {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    } catch (error: unknown) {
      log.warn(`Failed to remove profile data directory: ${error instanceof Error ? error.message : String(error)}`);
    }

    log.info(`Profile "${meta.name}" (${id}) deleted.`);
    return true;
  }

  /** Delete a profile by name. */
  deleteProfileByName(name: string): boolean {
    const meta = this.registry.profiles.find((p) => p.name === name);
    if (!meta) {
      return false;
    }
    return this.deleteProfile(meta.id);
  }

  /** Update the last-used timestamp for a profile. */
  touchProfile(id: string): void {
    const meta = this.registry.profiles.find((p) => p.id === id);
    if (meta) {
      meta.lastUsedAt = new Date().toISOString();
      this.save();
    }
  }

  /** Create a temporary isolated profile. */
  createIsolatedProfile(): BrowserProfile {
    const name = `isolated-${Date.now()}-${randomUUID()}`;
    return this.createProfile(name, "isolated");
  }

  /** Clean up expired isolated profiles (older than given age in ms). */
  cleanIsolatedProfiles(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const meta of this.registry.profiles) {
      if (meta.type !== "isolated") {
        continue;
      }
      const age = now - new Date(meta.lastUsedAt).getTime();
      if (age > maxAgeMs) {
        toDelete.push(meta.id);
      }
    }

    for (const id of toDelete) {
      this.deleteProfile(id);
    }

    if (toDelete.length > 0) {
      log.info(`Cleaned ${toDelete.length} expired isolated profile(s).`);
    }

    return toDelete.length;
  }

  /** Purge non-default profiles not used within the retention window. */
  purgeStaleProfiles(options: {
    olderThanDays?: number;
    dryRun?: boolean;
    now?: Date;
  } = {}): ProfilePurgeResult {
    const olderThanDays = options.olderThanDays ?? 30;
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
      throw new RangeError("olderThanDays must be a non-negative number");
    }
    const nowMs = (options.now ?? new Date()).getTime();
    const dryRun = options.dryRun !== false;
    const candidates: ProfilePurgeCandidate[] = [];

    for (const meta of this.registry.profiles) {
      if (meta.id === DEFAULT_SHARED_PROFILE_ID) continue;
      const lastUsedMs = new Date(meta.lastUsedAt).getTime();
      if (Number.isNaN(lastUsedMs)) continue;
      const ageDays = (nowMs - lastUsedMs) / 86_400_000;
      if (ageDays < olderThanDays) continue;
      const dataDir = getProfileDataDir(meta.id);
      candidates.push({
        id: meta.id,
        name: meta.name,
        type: meta.type,
        dataDir,
        lastUsedAt: meta.lastUsedAt,
        ageDays,
        sizeBytes: sizeOfPath(dataDir),
      });
    }

    const deleted: ProfilePurgeCandidate[] = [];
    let reclaimedBytes = 0;
    if (!dryRun) {
      for (const candidate of candidates) {
        if (this.deleteProfile(candidate.id)) {
          deleted.push(candidate);
          reclaimedBytes += candidate.sizeBytes;
        }
      }
    }

    return {
      dryRun,
      olderThanDays,
      candidates,
      deleted,
      reclaimedBytes,
    };
  }

  /** Reload registry from disk. */
  reload(): void {
    this.registry = loadRegistry();
    this.ensureDefaultProfile();
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private metadataToProfile(meta: ProfileMetadata): BrowserProfile {
    return {
      id: meta.id,
      name: meta.name,
      type: meta.type,
      dataDir: getProfileDataDir(meta.id),
      createdAt: meta.createdAt,
      lastUsedAt: meta.lastUsedAt,
    };
  }

  private save(): void {
    try {
      saveRegistry(this.registry);
    } catch (error: unknown) {
      log.error(`Failed to save profile registry: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
