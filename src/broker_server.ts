export * from "./runtime/broker_server";

import { startStandaloneBroker } from "./runtime/broker_server";
import { Logger } from "./shared/logger";

const brokerLog = new Logger({ component: "broker-server" });

if (require.main === module) {
  void startStandaloneBroker().catch((error: unknown) => {
    brokerLog.critical(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
