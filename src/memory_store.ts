export * from "./runtime/memory_store";

import { MemoryStore } from "./runtime/memory_store";

async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const [command] = argv;
  if (command !== "stats") {
    console.error("[MEMORY_STORE] Unknown command. Supported commands: stats");
    return 1;
  }

  const store = new MemoryStore();
  try {
    console.log(JSON.stringify(store.getStats(), null, 2));
  } finally {
    store.close();
  }
  return 0;
}

if (require.main === module) {
  runCli().then((code) => {
    process.exit(code);
  }).catch((error: unknown) => {
    console.error(`[MEMORY_STORE] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
