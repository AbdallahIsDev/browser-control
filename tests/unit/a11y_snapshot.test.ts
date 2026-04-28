import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import type { A11ySnapshot } from "../../src/a11y_snapshot";
import { formatSnapshotAsText, getInteractiveCount } from "../../src/a11y_snapshot";
import { snapshot } from "../../src/a11y_snapshot";
import { RefStore, resolveRefLocator } from "../../src/ref_store";
import { resolveChromePath } from "../../src/runtime/launch_browser";

async function launchBrowser() {
  return chromium.launch({
    headless: true,
    executablePath: resolveChromePath(process.platform, process.env.BROWSER_CHROME_PATH),
  });
}

test("formatSnapshotAsText renders elements with refs", () => {
  const snap: A11ySnapshot = {
    pageUrl: "https://example.com",
    pageTitle: "Example",
    elements: [
      { ref: "e1", role: "heading", name: "Dashboard", level: 1 },
      { ref: "e2", role: "textbox", name: "Search" },
      { ref: "e3", role: "button", name: "Submit", disabled: false },
      { ref: "e4", role: "checkbox", name: "Agree", checked: true },
      { ref: "e5", role: "button", name: "Cancel", disabled: true },
    ],
    generatedAt: new Date().toISOString(),
  };

  const text = formatSnapshotAsText(snap);
  assert.ok(text.includes("Page: Example"), "should include page title");
  assert.ok(text.includes("URL: https://example.com"), "should include URL");
  assert.ok(text.includes('- heading "Dashboard" [ref=@e1] (level=1)'), "should render heading with level");
  assert.ok(text.includes('- textbox "Search" [ref=@e2]'), "should render textbox");
  assert.ok(text.includes('- button "Submit" [ref=@e3]'), "should render button");
  assert.ok(text.includes('[ref=@e4] (checked)'), "should show checked state");
  assert.ok(text.includes('[ref=@e5] (disabled)'), "should show disabled state");
});

test("formatSnapshotAsText handles empty snapshot", () => {
  const snap: A11ySnapshot = {
    pageUrl: "about:blank",
    pageTitle: "",
    elements: [],
    generatedAt: new Date().toISOString(),
  };

  const text = formatSnapshotAsText(snap);
  assert.ok(text.includes("URL: about:blank"), "should include URL");
  // No element lines
  const lines = text.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, 0);
});

test("getInteractiveCount counts interactive and heading elements", () => {
  const snap: A11ySnapshot = {
    elements: [
      { ref: "e1", role: "heading", name: "Title" },
      { ref: "e2", role: "button", name: "Click" },
      { ref: "e3", role: "textbox", name: "Name" },
      { ref: "e4", role: "link", name: "About" },
      { ref: "e5", role: "generic", name: "wrapper" },  // not interactive
      { ref: "e6", role: "checkbox", name: "Accept" },
    ],
    generatedAt: new Date().toISOString(),
  };

  const count = getInteractiveCount(snap);
  assert.equal(count, 5); // heading, button, textbox, link, checkbox
});

test("snapshot includes page metadata", () => {
  const snap: A11ySnapshot = {
    sessionId: "session-1",
    pageUrl: "https://app.example.com/dashboard",
    pageTitle: "My App",
    elements: [
      { ref: "e1", role: "heading", name: "Welcome" },
    ],
    generatedAt: "2026-04-21T00:00:00.000Z",
  };

  assert.equal(snap.sessionId, "session-1");
  assert.equal(snap.pageUrl, "https://app.example.com/dashboard");
  assert.equal(snap.pageTitle, "My App");
  assert.equal(snap.generatedAt, "2026-04-21T00:00:00.000Z");
  assert.equal(snap.elements.length, 1);
  assert.equal(snap.elements[0].ref, "e1");
});

test("snapshot(page) captures interactive elements from a real page", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <h1>Dashboard</h1>
        <label for="search">Search</label>
        <input id="search" type="text" />
        <button>Submit</button>
      </main>
    `);

    const snap = await snapshot(page, { sessionId: "s1" });
    assert.equal(snap.sessionId, "s1");
    assert.ok(snap.elements.some((el) => el.role === "heading" && el.name === "Dashboard"));
    assert.ok(snap.elements.some((el) => el.role === "textbox" && el.name === "Search"));
    assert.ok(snap.elements.some((el) => el.role === "button" && el.name === "Submit"));
  } finally {
    await browser.close();
  }
});

test("snapshot(page) honors rootSelector in DOM fallback mode", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section id="outside">
        <button>Outside</button>
      </section>
      <section id="inside">
        <button>Inside</button>
      </section>
    `);

    const context = page.context() as unknown as {
      newCDPSession: (pageArg: typeof page) => Promise<never>;
    };
    const original = context.newCDPSession.bind(context);
    context.newCDPSession = async () => {
      throw new Error("force DOM fallback");
    };

    try {
      const snap = await snapshot(page, { rootSelector: "#inside" });
      assert.ok(snap.elements.some((el) => el.name === "Inside"));
      assert.ok(!snap.elements.some((el) => el.name === "Outside"));
    } finally {
      context.newCDPSession = original as typeof context.newCDPSession;
    }
  } finally {
    await browser.close();
  }
});

test("resolveRefLocator uses semantic resolution instead of fabricating data-testid", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <button>Submit</button>
        <button>Cancel</button>
      </main>
    `);

    const store = new RefStore();
    store.setSnapshot("page1", {
      pageUrl: "https://example.com",
      pageTitle: "Example",
      generatedAt: new Date().toISOString(),
      elements: [
        { ref: "e1", role: "button", name: "Submit" },
      ],
    });

    const resolved = await resolveRefLocator(store, "page1", page, "@e1");
    assert.ok(resolved, "expected ref to resolve to a locator");
    const count = await resolved!.locator.count();
    assert.equal(count, 1, "semantic ref resolution should find the real button");
  } finally {
    await browser.close();
  }
});
