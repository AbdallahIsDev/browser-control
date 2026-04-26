export * from "./runtime/daemon";

import { Daemon } from "./runtime/daemon";
import { logger } from "./shared/logger";

if (require.main === module) {
  const daemon = new Daemon({
    schedulerEnabled: !process.argv.includes("--dev"),
  });

  daemon.start().catch((error: unknown) => {
    logger.critical(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
