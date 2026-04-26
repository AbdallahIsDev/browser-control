# TypeScript API

Primary API:

```ts
import { createBrowserControl } from "browser-control";

const bc = createBrowserControl({ policyProfile: "balanced" });

const result = await bc.terminal.exec({ command: "node --version" });
console.log(result.success, result.data);

bc.close();
```

In this source checkout, import from `./browser_control` or use package exports after building/installing.

## Namespaces

`createBrowserControl()` returns these namespaces. This example lists the public facade methods:

```ts
const bc = createBrowserControl();

bc.browser.open({ url: "https://example.com" });
bc.browser.snapshot();
bc.browser.click({ target: "@e3" });
bc.browser.fill({ target: "@e4", text: "hello" });
bc.browser.hover({ target: "@e3" });
bc.browser.type({ text: "hello" });
bc.browser.press({ key: "Enter" });
bc.browser.scroll({ direction: "down", amount: 300 });
bc.browser.screenshot({ outputPath: "page.png" });
bc.browser.tabList();
bc.browser.tabSwitch("0");
bc.browser.close();

bc.terminal.open({ shell: "powershell", cwd: "." });
bc.terminal.exec({ command: "node --version" });
bc.terminal.type({ sessionId: "term-id", text: "echo hello\n" });
bc.terminal.read({ sessionId: "term-id" });
bc.terminal.snapshot({ sessionId: "term-id" });
bc.terminal.interrupt({ sessionId: "term-id" });
bc.terminal.close({ sessionId: "term-id" });
bc.terminal.resume({ sessionId: "term-id" });
bc.terminal.status({ sessionId: "term-id" });

bc.fs.read({ path: "package.json" });
bc.fs.write({ path: "tmp/out.txt", content: "hello" });
bc.fs.ls({ path: ".", recursive: false });
bc.fs.move({ src: "tmp/out.txt", dst: "tmp/out-renamed.txt" });
bc.fs.rm({ path: "tmp/out-renamed.txt", force: true });
bc.fs.stat({ path: "package.json" });

bc.session.create("demo", { policyProfile: "balanced" });
bc.session.list();
bc.session.use("demo");
bc.session.status();

bc.service.register({ name: "app", port: 3000 });
bc.service.resolve({ name: "app" });
bc.service.list();
bc.service.remove({ name: "app" });

bc.provider.list();
bc.provider.use("local");
bc.provider.getActive();

bc.debug.health();
bc.debug.bundle("bundle-id");
bc.debug.console({ sessionId: "default" });
bc.debug.network({ sessionId: "default" });
bc.debug.listBundles();

bc.config.list();
bc.config.get("policyProfile");
bc.config.set("logLevel", "debug");

await bc.status();
bc.close();
```

`bc.browser.provider` is the same provider namespace exposed at `bc.provider`.

## ActionResult

Browser, terminal, filesystem, service, and session actions return:

```ts
interface ActionResult<T = unknown> {
  success: boolean;
  path: "command" | "a11y" | "low_level";
  sessionId: string;
  data?: T;
  warning?: string;
  error?: string;
  auditId?: string;
  policyDecision?: "allow" | "deny" | "require_confirmation" | "allow_with_audit";
  risk?: "low" | "moderate" | "high" | "critical";
  completedAt: string;
  debugBundleId?: string;
  debugBundlePath?: string;
  recoveryGuidance?: unknown;
  partialDebug?: boolean;
}
```

Failure behavior:

- `success: false` means the action did not complete.
- Policy denial uses `error: "Policy denied: ..."` and `policyDecision: "deny"`.
- Confirmation requirements use `error: "Confirmation required: ..."` and do not execute the action.
- Failed actions may include a debug bundle ID/path and recovery guidance.

## Lifecycle

Call `bc.close()` at the end of short-lived scripts. Terminal actions can use daemon-backed state and the API holds a memory-store handle until closed.

Example:

```ts
import { createBrowserControl } from "browser-control";

async function main() {
  const bc = createBrowserControl();
  try {
    const status = await bc.status();
    console.log(status.policyProfile);
  } finally {
    bc.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```
