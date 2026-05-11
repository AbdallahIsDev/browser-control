# Browser Basic Navigation

Runs a visible browser action through Browser Control.

## Prerequisites

- Chrome or Chromium available.
- Browser Control configured with `bc setup --non-interactive --profile balanced`.

## Commands

```powershell
bc browser launch --profile default
bc open https://example.com
bc snapshot
bc screenshot
```

## Expected Output

- `open` returns an `ActionResult` with the page URL and title.
- `snapshot` returns accessibility refs such as `@e3`.
- `screenshot` writes an image under the Browser Control data home.

## Common Issues

If Chrome cannot attach, run:

```powershell
bc browser status
```
