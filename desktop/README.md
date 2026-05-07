# Browser Control Desktop

Windows desktop shell for the Browser Control operator dashboard.

The shell uses Electron main process ownership for the local app server and loads the same web UI served by `src/web/server.ts`.

Security defaults:

- renderer has `nodeIntegration: false`
- `contextIsolation: true`
- sandbox enabled
- navigation locked to the local Browser Control app origin
- external HTTP(S) links open in the OS browser
- privileged operations go through the local app server and existing Browser Control policy engine

Dev run:

```powershell
npm run web:build
npm run desktop:dev
```

Build verification:

```powershell
npm run desktop:build
```
