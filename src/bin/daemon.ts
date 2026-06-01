import { startStandaloneDaemon } from "../runtime/daemon";
import { logger } from "../shared/logger";

if (require.main === module) {
	void startStandaloneDaemon(process.argv).catch((error: unknown) => {
		logger.critical(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
