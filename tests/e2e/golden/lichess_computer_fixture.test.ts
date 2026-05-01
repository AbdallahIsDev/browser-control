import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBrowserControl } from "../../../src/browser_control";

async function rmWithRetry(target: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

function startLichessFixture(): Promise<{ url: string; close(): Promise<void> }> {
  const html = `<!doctype html>
<html>
<head>
  <title>Lichess Fixture</title>
  <style>
    body { font-family: sans-serif; margin: 0; min-height: 1200px; }
    main { padding: 24px; }
    [hidden] { display: none !important; }
    dialog { display: block; position: fixed; top: 16px; left: 16px; width: 320px; max-height: 220px; overflow: auto; }
    .spacer { height: 260px; }
    label { display: block; margin: 16px 0; }
    input[type="radio"] { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
    input[type="radio"]:checked + span { outline: 2px solid #4078f2; }
  </style>
</head>
<body>
  <main>
    <h1>Play Chess</h1>
    <button id="computer">Play against computer</button>
  </main>
  <dialog id="setup" hidden aria-label="Computer setup">
    <h2>Computer setup</h2>
    <fieldset>
      <legend>Stockfish level</legend>
      ${Array.from({ length: 8 }, (_, index) => {
        const level = index + 1;
        return `<input id="sf_level_${level}" type="radio" name="level" value="${level}"><label for="sf_level_${level}"><span>Level ${level}</span></label>`;
      }).join("")}
    </fieldset>
    <div class="spacer"></div>
    <fieldset>
      <legend>Color</legend>
      <input id="color-picker-white" type="radio" name="color" value="white"><label for="color-picker-white"><span>White</span></label>
      <input id="color-picker-black" type="radio" name="color" value="black"><label for="color-picker-black"><span>Black</span></label>
    </fieldset>
    <span id="play-slot"><button id="play-a">Play against computer</button></span>
  </dialog>
  <section id="game" hidden>
    <h1>Game versus Stockfish level 5</h1>
    <p>White to move</p>
  </section>
  <script>
    computer.addEventListener("click", () => setup.hidden = false);
    setup.addEventListener("change", () => {
      playSlot.innerHTML = '<button id="play-b">Play against computer</button>';
    });
    setup.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLButtonElement) || !event.target.id.startsWith('play-')) return;
      if (document.querySelector('input[name="level"][value="5"]:checked') && document.querySelector('input[name="color"][value="white"]:checked')) {
        setup.hidden = true;
        game.hidden = false;
      }
    });
  </script>
</body>
</html>`;

  const server = http.createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Fixture server did not expose a TCP port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

test("lichess computer modal workflow selects Stockfish level 5 as White through public API", async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-lichess-fixture-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const previousDebugPort = process.env.BROWSER_DEBUG_PORT;
  const previousBrowserMode = process.env.BROWSER_MODE;
  const fixture = await startLichessFixture();
  const debugPort = String(22000 + Math.floor(Math.random() * 1000));
  process.env.BROWSER_CONTROL_HOME = homeDir;
  process.env.BROWSER_DEBUG_PORT = debugPort;
  process.env.BROWSER_MODE = "managed";
  const bc = createBrowserControl({ policyProfile: "trusted" });

  try {
    const opened = await bc.browser.open({ url: fixture.url, waitUntil: "domcontentloaded" });
    if (!opened.success && /No browser available|auto-launch failed|Chrome did not become ready|Chrome executable/i.test(opened.error ?? "")) {
      t.skip(`Browser unavailable for Lichess fixture workflow: ${opened.error}`);
      return;
    }
    assert.equal(opened.success, true, opened.error);

    const start = await bc.browser.snapshot();
    assert.equal(start.success, true, start.error);
    const computer = start.data?.elements.find((element) => element.role === "button" && element.name === "Play against computer");
    assert.ok(computer?.ref, "Expected Play against computer button");
    assert.equal((await bc.browser.click({ target: `@${computer.ref}` })).success, true);

    const dialog = await bc.browser.snapshot({ boxes: true });
    assert.equal(dialog.success, true, dialog.error);
    const level5 = dialog.data?.elements.find((element) => element.role === "radio" && element.name === "Level 5");
    const white = dialog.data?.elements.find((element) => element.role === "radio" && element.name === "White");
    const stalePlay = dialog.data?.elements
      .filter((element) => element.role === "button" && element.name === "Play against computer")
      .at(-1);
    assert.ok(level5?.ref, "Expected Stockfish level 5 radio");
    assert.ok(white?.ref, "Expected White radio");
    assert.ok(stalePlay?.ref, "Expected initial modal play button");

    const levelClick = await bc.browser.click({ target: `@${level5.ref}` });
    assert.equal(levelClick.success, true, levelClick.error);
    const whiteClick = await bc.browser.click({ target: `@${white.ref}` });
    assert.equal(whiteClick.success, true, whiteClick.error);

    const selected = await bc.browser.snapshot({ boxes: true });
    assert.equal(selected.success, true, selected.error);
    assert.equal(selected.data?.elements.find((element) => element.role === "radio" && element.name === "Level 5")?.checked, true);
    assert.equal(selected.data?.elements.find((element) => element.role === "radio" && element.name === "White")?.checked, true);

    const playClick = await bc.browser.click({ target: `@${stalePlay.ref}` });
    assert.equal(playClick.success, true, playClick.error);

    const game = await bc.browser.snapshot();
    assert.equal(game.success, true, game.error);
    assert.ok(game.data?.elements.some((element) => element.name === "Game versus Stockfish level 5"));
  } finally {
    await bc.browser.close().catch(() => undefined);
    await bc.sessionManager.getBrowserManager().disconnect().catch(() => undefined);
    bc.close();
    await fixture.close();
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    if (previousDebugPort === undefined) delete process.env.BROWSER_DEBUG_PORT;
    else process.env.BROWSER_DEBUG_PORT = previousDebugPort;
    if (previousBrowserMode === undefined) delete process.env.BROWSER_MODE;
    else process.env.BROWSER_MODE = previousBrowserMode;
    await rmWithRetry(homeDir);
  }
});
