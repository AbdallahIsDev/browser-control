# Golden Local Workflow

Run the deterministic local web app workflow as part of the golden suite:

```bash
npm run test:e2e
```

The workflow starts the fixture server from `e2e/fixtures/local-app/server.cjs`, registers it as a Browser Control service, opens it through `bc://golden-local-app`, snapshots the page, fills the form, clicks the save button, verifies app state, writes a reliability report, and checks scoped cleanup.

Browser-dependent assertions skip only when a browser or CDP endpoint is unavailable.
