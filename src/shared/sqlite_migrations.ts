import type { DatabaseSync } from "node:sqlite";

export interface SqliteMigration {
	version: number;
	statements: string[];
}

interface RunSqliteMigrationsOptions {
	component: string;
	currentVersion: number;
	migrations: SqliteMigration[];
}

export function getSqliteUserVersion(db: DatabaseSync): number {
	const row = db.prepare("PRAGMA user_version").get() as
		| { user_version: number }
		| undefined;
	return row?.user_version ?? 0;
}

export function runSqliteMigrations(
	db: DatabaseSync,
	options: RunSqliteMigrationsOptions,
): void {
	const { component, currentVersion, migrations } = options;
	const sorted = [...migrations].sort((a, b) => a.version - b.version);
	let previousVersion = 0;
	for (const migration of sorted) {
		if (!Number.isInteger(migration.version) || migration.version <= 0) {
			throw new Error(`${component} SQLite migration version must be a positive integer`);
		}
		if (migration.version === previousVersion) {
			throw new Error(`${component} SQLite migration version ${migration.version} is duplicated`);
		}
		if (migration.version > currentVersion) {
			throw new Error(`${component} SQLite migration ${migration.version} exceeds current version ${currentVersion}`);
		}
		previousVersion = migration.version;
	}

	let appliedVersion = getSqliteUserVersion(db);
	if (appliedVersion > currentVersion) {
		throw new Error(`${component} SQLite database version ${appliedVersion} is newer than supported version ${currentVersion}`);
	}

	for (const migration of sorted) {
		if (migration.version <= appliedVersion) continue;
		db.exec("BEGIN IMMEDIATE");
		try {
			for (const statement of migration.statements) {
				if (statement.trim()) db.exec(statement);
			}
			db.exec(`PRAGMA user_version = ${migration.version}`);
			db.exec("COMMIT");
			appliedVersion = migration.version;
		} catch (error) {
			try {
				db.exec("ROLLBACK");
			} catch {
				/* ignore rollback failure */
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`${component} SQLite migration ${migration.version} failed: ${message}`);
		}
	}
}
