/**
 * Shared test helpers for daemon, terminal session, and browser cleanup.
 *
 * Used by cli_term_exit.test.ts, api_term_exit.test.ts, and other
 * test files that need to stop the daemon and close terminal sessions
 * after each test.
 *
 * The actual implementation lives in daemon_cleanup.ts (shared with cli.ts).
 * This module re-exports those helpers and provides thin convenience wrappers
 * for test-specific defaults (default home dir, default port).
 */

// Re-export all shared helpers from the canonical module
export {
  isPidAlive,
  killProcessTree,
  killAutomationBrowser,
  cleanupStaleDaemonFiles,
  stopDaemon,
} from "../../src/runtime/daemon_cleanup";

import { stopDaemon } from "../../src/runtime/daemon_cleanup";

/**
 * Stop the daemon running on the default port.
 *
 * Convenience wrapper for `stopDaemon()` with no arguments — reads
 * defaults from `BROWSER_CONTROL_HOME` / `BROKER_PORT` env vars.
 */
export async function stopDefaultDaemon(): Promise<void> {
  await stopDaemon();
}

/**
 * Stop the daemon running in an isolated test environment.
 *
 * Convenience wrapper for `stopDaemon()` with explicit home and port.
 *
 * @param homeDir The isolated test's BROWSER_CONTROL_HOME directory
 * @param port The isolated test's BROKER_PORT
 */
export async function stopIsolatedDaemon(homeDir: string, port: number): Promise<void> {
  await stopDaemon({ homeDir, port });
}
