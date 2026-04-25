# TypeScript API Example

```ts
import { createBrowserControl } from "browser-control";

async function main() {
  const bc = createBrowserControl({ policyProfile: "balanced" });

  try {
    const status = await bc.status();
    console.log("policy:", status.policyProfile);

    const nodeVersion = await bc.terminal.exec({ command: "node --version" });
    if (!nodeVersion.success) throw new Error(nodeVersion.error);
    console.log(nodeVersion.data?.stdout);

    const files = await bc.fs.ls({ path: ".", recursive: false });
    if (!files.success) throw new Error(files.error);
    console.log(files.data?.totalEntries);
  } finally {
    bc.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```
