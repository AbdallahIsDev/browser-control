#!/usr/bin/env ts-node

export * from "./src/cli";
import { runCli } from "./src/cli";

if (require.main === module) {
  runCli().catch((error) => {
    console.error("Fatal error:", error.message);
    process.exit(1);
  });
}
