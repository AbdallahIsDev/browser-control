import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { logger } from "./logger";
import { getDataHome } from "./paths";

const log = logger.withComponent("sqlite-util");

/**
 * Safely initialize a SQLite database with malformed detection and quarantine.
 * If the database is malformed, it is moved to a recovery/quarantine location.
 */
export function safeInitDatabase(
	dbPath: string,
	options: { component?: string; dataHome?: string } = {},
): DatabaseSync {
	try {
		const db = new DatabaseSync(dbPath);

		try {
			// A simple PRAGMA to check if the file is readable and not obviously malformed
			db.exec("PRAGMA integrity_check(1)");
			return db;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (isMalformedError(message)) {
				db.close();
				quarantineDatabase(dbPath, message, options);
				return new DatabaseSync(dbPath);
			}
			throw error;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isMalformedError(message)) {
			quarantineDatabase(dbPath, message, options);
			return new DatabaseSync(dbPath);
		}
		throw error;
	}
}

/**
 * Check if an error message indicates a malformed SQLite database.
 */
export function isMalformedError(message: string): boolean {
	const lower = message.toLowerCase();
	return (
		lower.includes("malformed") ||
		lower.includes("disk image is malformed") ||
		lower.includes("database disk image is malformed") ||
		lower.includes("file is not a database")
	);
}

/**
 * Move a malformed database and its sidecars to a quarantine folder
 * and write a recovery report.
 */
export function quarantineDatabase(
	dbPath: string,
	reason: string,
	options: { component?: string; dataHome?: string } = {},
): void {
	const dbDir = path.dirname(dbPath);
	const dbName = path.basename(dbPath);
	
	// Derive dataHome: explicit > derived from path > default global
	let dataHome = options.dataHome;
	if (!dataHome) {
		const parentDir = path.basename(dbDir);
		if (parentDir === "state" || parentDir === "memory") {
			dataHome = path.resolve(dbDir, "..");
		} else {
			dataHome = getDataHome();
		}
	}

	const reportsDir = path.join(dataHome, "reports");
	const recoveryDir = path.join(reportsDir, "sqlite-recovery");
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const recoveryId = `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
	const corruptDir = path.join(recoveryDir, recoveryId);

	log.warn(`SQLite database malformed, quarantining: ${dbPath}`, { reason });

	try {
		if (!fs.existsSync(corruptDir)) {
			fs.mkdirSync(corruptDir, { recursive: true, mode: 0o700 });
		}

		// Move the corrupt file and its sidecars (WAL, SHM)
		const filesToMove = [dbName, `${dbName}-wal`, `${dbName}-shm`];
		const movedFiles: string[] = [];

		for (const file of filesToMove) {
			const src = path.join(dbDir, file);
			if (fs.existsSync(src)) {
				const dest = path.join(corruptDir, file);
				
				// Retry rename up to 5 times with small delay to handle Windows EBUSY
				let attempts = 0;
				const maxAttempts = 5;
				let lastErr: unknown;

				while (attempts < maxAttempts) {
					try {
						fs.renameSync(src, dest);
						movedFiles.push(file);
						log.info(`Quarantined file: ${file} -> ${dest}`);
						lastErr = null;
						break;
					} catch (renameErr) {
						lastErr = renameErr;
						const isBusy = (renameErr as { code?: string }).code === "EBUSY" || 
						              (renameErr as { code?: string }).code === "EPERM";
						if (isBusy && attempts < maxAttempts - 1) {
							attempts++;
							// Small blocking sleep
							const start = Date.now();
							while (Date.now() - start < 100) { /* sleep */ }
							continue;
						}
						break;
					}
				}

				if (lastErr) {
					// If it's the main DB file, we MUST throw if it fails to move.
					// Sidecars are best-effort.
					if (file === dbName) {
						throw lastErr;
					}
					log.error(`Failed to move sidecar ${file}: ${lastErr}`);
				}
			}
		}

		// Save the recovery report
		const report = {
			timestamp: new Date().toISOString(),
			component: options.component ?? "unknown",
			originalPath: dbPath,
			dataHome,
			quarantinePath: corruptDir,
			sidecarPaths: movedFiles,
			reason,
			actionTaken: "quarantined_and_recreated",
		};

		fs.writeFileSync(
			path.join(corruptDir, "recovery-report.json"),
			JSON.stringify(report, null, 2),
			"utf8",
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error(`Failed to quarantine corrupt database: ${message}`);
		
		// Re-throw to ensure the caller knows quarantine failed.
		// We do NOT delete the original DB if we can't move it.
		throw new Error(
			`SQLite database at ${dbPath} is malformed and could not be quarantined: ${message}. Manual intervention required.`,
		);
	}
}
