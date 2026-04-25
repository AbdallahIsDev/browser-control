# API

The TypeScript API exposes config and status helpers:

```ts
import { createBrowserControl } from "browser-control";

const bc = createBrowserControl();

const config = bc.config.list();
const logLevel = bc.config.get("logLevel");
bc.config.set("logLevel", "debug");

const status = await bc.status();
await bc.close();
```

Config values merge in this order:

1. built-in defaults
2. user config at `~/.browser-control/config.json`
3. environment variables and `.env` compatibility

Sensitive values are redacted from config list/get output. The API does not expose interactive setup.

## Compatibility

The stable public TypeScript contract is the export set from `index.ts`, `createBrowserControl()`, its documented namespaces, and `ActionResult`. Public changes must follow `docs/compatibility.md`; accidental export/API/result-shape changes are guarded by `npm run compat:test`.

