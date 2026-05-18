/**
 * Browser Control Auth Flow Verification
 * Tests all 7 auth states with real screenshots using Playwright.
 *
 * Usage:
 *   node scripts/verify-auth-flows.mjs
 *
 * Requires a running server on PORT with TOKEN.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

const PORT = process.env.VERIFY_PORT || "59444";
const TOKEN = process.env.VERIFY_TOKEN || "test-token-abc";
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = resolve("reports", "auth-verification-2");
mkdirSync(OUT, { recursive: true });

const summary = [];

function screenshot(name) {
  return resolve(OUT, `${name}.png`);
}

async function verify(page, { label, url, setup, checks }) {
  console.log(`\n=== ${label} ===`);

  if (setup) {
    await setup(page);
  }

  await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
  // Extra settle time for SPA re-render
  await page.waitForTimeout(1000);

  const path = screenshot(label.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  await page.screenshot({ path, fullPage: true });
  console.log(`  Screenshot: ${path}`);

  const results = {};
  for (const [key, fn] of Object.entries(checks)) {
    try {
      results[key] = await fn(page);
    } catch (e) {
      results[key] = `ERROR: ${e.message}`;
    }
    console.log(`  ${key}: ${results[key]}`);
  }

  summary.push({ label, screenshot: path, results });
  return results;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    // ── Flow 1: No token → locked state ──
    const flow1 = await verify(await context.newPage(), {
      label: "1-no-token-locked",
      url: BASE + "/",
      checks: {
        title: async (p) => p.title() || "(no title)",
        locked: async (p) =>
          (await p.locator("text=Local dashboard locked").count()) > 0
            ? "PASS: locked text visible"
            : "FAIL: no locked text",
        cliHint: async (p) =>
          (await p.locator("text=bc web open").count()) > 0
            ? "PASS: CLI hint (bc web open) visible"
            : "FAIL: no bc web open CLI hint",
        copyButton: async (p) =>
          (await p.locator('button[aria-label="Copy bc web open command"]').count()) > 0
            ? "PASS: copy button visible"
            : "FAIL: no copy button",
        fallbackCommand: async (p) =>
          (await p.locator("text=bc web open --port=0").count()) > 0
            ? "PASS: fallback command visible"
            : "FAIL: no fallback command",
        lockIcon: async (p) =>
          (await p.locator("svg.lucide-lock,.lucide-lock").count()) > 0
            ? "PASS: lock icon"
            : "FAIL: no lock icon",
        providerPill: async (p) =>
          (await p.locator("text=Provider:").count()) > 0
            ? "FAIL: Provider pill visible (should be hidden)"
            : "PASS: Provider pill hidden",
        policyPill: async (p) =>
          (await p.locator("text=Policy:").count()) > 0
            ? "FAIL: Policy pill visible (should be hidden)"
            : "PASS: Policy pill hidden",
        forgetButton: async (p) =>
          (await p.locator("text=Forget").count()) > 0
            ? "FAIL: Forget button visible (should be hidden)"
            : "PASS: Forget button hidden",
        hasToken: async (p) =>
          (await p.evaluate(() => !!sessionStorage.getItem("bc-token")))
            ? "FAIL: token exists in sessionStorage"
            : "PASS: no token in sessionStorage",
        sidebarNavHidden: async (p) =>
          (await p.locator("aside nav button, aside nav a, .app-sidebar").count()) > 0
            ? "FAIL: nav items visible in locked state"
            : "PASS: nav items hidden when locked",
      },
    });

    // ── Flow 2: Valid token → signed-in state ──
    const flow2Page = await context.newPage();
    const flow2 = await verify(flow2Page, {
      label: "2-valid-token-signed-in",
      url: BASE + "/#token=" + TOKEN,
      checks: {
        title: async (p) => p.title() || "(no title)",
        sidebar: async (p) =>
          (await p.locator("nav a, nav button, [role=navigation] a").count()) > 0
            ? "PASS: sidebar navigation visible"
            : "FAIL: no sidebar navigation",
        authLabel: async (p) => {
          const text = await p.locator("text=Auth:").textContent();
          return text ? `Auth label: ${text.trim()}` : "FAIL: no Auth label";
        },
        providerPill: async (p) => {
          const text = await p.locator("text=Provider:").textContent();
          return text ? `Provider: ${text.trim()}` : "FAIL: no Provider pill";
        },
        policyPill: async (p) => {
          const text = await p.locator("text=Policy:").textContent();
          return text ? `Policy: ${text.trim()}` : "FAIL: no Policy pill";
        },
        forgetButton: async (p) =>
          (await p.locator("text=Forget").count()) > 0
            ? "PASS: Forget button visible"
            : "FAIL: no Forget button",
        hasToken: async (p) =>
          (await p.evaluate(() => !!sessionStorage.getItem("bc-token")))
            ? `PASS: token="${await p.evaluate(() => sessionStorage.getItem("bc-token"))}"`
            : "FAIL: no token in sessionStorage",
        hashRemoved: async (p) =>
          (await p.evaluate(() => window.location.hash)) === ""
            ? "PASS: hash removed from URL"
            : `FAIL: hash still present: ${await p.evaluate(() => window.location.hash)}`,
      },
    });

    // ── Flow 3: Same tab, navigate to bare URL (session persists) ──
    const flow3 = await verify(flow2Page, {
      label: "3-same-tab-bare-url-after-bootstrap",
      url: BASE + "/",
      checks: {
        locked: async (p) =>
          (await p.locator("text=Local dashboard locked").count()) > 0
            ? "FAIL: locked page shown (should be signed in)"
            : "PASS: not locked (session persists)",
        sidebar: async (p) =>
          (await p.locator("nav a, nav button, [role=navigation] a").count()) > 0
            ? "PASS: sidebar visible"
            : "FAIL: no sidebar",
        authLabel: async (p) => {
          const el = p.locator("text=Auth:");
          const text = await el.textContent();
          return text ? `Auth: ${text.trim()}` : "FAIL: no Auth label";
        },
        hasToken: async (p) =>
          (await p.evaluate(() => !!sessionStorage.getItem("bc-token")))
            ? "PASS: token persists"
            : "FAIL: token lost after bare URL nav",
      },
    });

    // ── Flow 4: Forget → locked state ──
    const flow4 = await verify(flow2Page, {
      label: "4-forget-returns-to-locked",
      url: BASE + "/",
      setup: async (p) => {
        // Verify token exists first, then click Forget
        const exists = await p.evaluate(() => !!sessionStorage.getItem("bc-token"));
        if (!exists) {
          // Re-bootstrap
          await p.goto(BASE + "/#token=" + TOKEN, { waitUntil: "networkidle" });
          await p.waitForTimeout(1000);
        }
      },
      checks: {
        forgetClicked: async (p) => {
          const btn = p.locator("text=Forget");
          if ((await btn.count()) === 0) return "FAIL: no Forget button to click";
          await btn.click();
          await p.waitForTimeout(1500);
          return "PASS: Forget clicked";
        },
        lockedAfterForget: async (p) =>
          (await p.locator("text=Local dashboard locked").count()) > 0
            ? "PASS: locked after Forget"
            : "FAIL: not locked after Forget",
        hasToken: async (p) =>
          (await p.evaluate(() => !!sessionStorage.getItem("bc-token")))
            ? "FAIL: token still exists after Forget"
            : "PASS: token cleared after Forget",
      },
    });

    // ── Flow 5: Invalid token → unauthorized ──
    const flow5Page = await context.newPage();
    const flow5 = await verify(flow5Page, {
      label: "5-invalid-token-unauthorized",
      url: BASE + "/#token=bad-token",
      checks: {
        locked: async (p) =>
          (await p.locator("text=Local dashboard locked").count()) > 0
            ? "FAIL: locked page shown (should show unauthorized)"
            : "PASS: not locked",
        authLabel: async (p) => {
          const el = p.locator("text=Auth:");
          const text = await el.textContent();
          return text ? `Auth: ${text.trim()}` : "FAIL: no Auth label";
        },
        forgetButton: async (p) =>
          (await p.locator("text=Forget").count()) > 0
            ? "PASS: Forget button visible"
            : "FAIL: no Forget button (should show recovery option)",
        hasToken: async (p) =>
          (await p.evaluate(() => !!sessionStorage.getItem("bc-token")))
            ? `PASS: token="${await p.evaluate(() => sessionStorage.getItem("bc-token"))}"`
            : "FAIL: no token in sessionStorage",
      },
    });

    // ── Flow 6: Browser page signed in ──
    const flow6Page = await context.newPage();
    const flow6 = await verify(flow6Page, {
      label: "6-browser-page-signed-in",
      url: BASE + "/#token=" + TOKEN,
      checks: {
        signedIn: async (p) =>
          (await p.evaluate(() => !!sessionStorage.getItem("bc-token")))
            ? "PASS: signed in"
            : "FAIL: not signed in",
      },
    });
    // Navigate to Browser page
    await verify(flow6Page, {
      label: "6b-browser-page-content",
      url: BASE + "/#/browser",
      checks: {
        pageVisible: async (p) =>
          (await p.locator("text=Browser Control").count()) > 0 ||
          (await p.locator("text=Browser Automation").count()) > 0 ||
          (await p.locator("text=Website").count()) > 0
            ? "PASS: browser page content visible"
            : "INFO: checking generic content",
        title: async (p) => p.title() || "(no title)",
        hasToken: async (p) =>
          (await p.evaluate(() => !!sessionStorage.getItem("bc-token")))
            ? "PASS: token persists on navigation"
            : "FAIL: token lost on navigation",
      },
    });

    // ── Flow 7: Skills page signed in ──
    const flow7Page = await context.newPage();
    await verify(flow7Page, {
      label: "7-skills-page-signed-in",
      url: BASE + "/#token=" + TOKEN,
      checks: {
        signedIn: async (p) =>
          (await p.evaluate(() => !!sessionStorage.getItem("bc-token")))
            ? "PASS: signed in"
            : "FAIL: not signed in",
      },
    });
    // Try Skills/Packages page
    const packagesUrls = [
      BASE + "/#/packages",
      BASE + "/#/skills",
      BASE + "/#packages",
    ];
    let packagesResult = null;
    for (const u of packagesUrls) {
      try {
        packagesResult = await verify(flow7Page, {
          label: "7b-skills-page-content",
          url: u,
          checks: {
            pageLoaded: async (p) =>
              (await p.locator("body").innerText()).length > 50
                ? "PASS: page content loaded"
                : "WARN: little content",
            hasToken: async (p) =>
              (await p.evaluate(() => !!sessionStorage.getItem("bc-token")))
                ? "PASS: token persists"
                : "FAIL: token lost",
            text: async (p) => {
              const body = await p.locator("body").innerText();
              return body.substring(0, 200).replace(/\n/g, " | ");
            },
          },
        });
        break;
      } catch (e) {
        console.log(`  URL ${u} failed: ${e.message}, trying next`);
      }
    }

    // ── Generate summary ──
    console.log("\n\n==========================================");
    console.log("        AUTH FLOW VERIFICATION SUMMARY");
    console.log("==========================================\n");

    for (const s of summary) {
      console.log(`[${s.label}]`);
      for (const [k, v] of Object.entries(s.results)) {
        const status = v.startsWith("PASS")
          ? "✅"
          : v.startsWith("FAIL")
            ? "❌"
            : "ℹ️";
        console.log(`  ${status} ${k}: ${v}`);
      }
      console.log(`  📷 ${s.screenshot}\n`);
    }

    const passes = summary.flatMap((s) =>
      Object.values(s.results).filter((v) => v.startsWith("PASS"))
    ).length;
    const fails = summary.flatMap((s) =>
      Object.values(s.results).filter((v) => v.startsWith("FAIL"))
    ).length;

    console.log("==========================================");
    console.log(`  Total: ${passes} passes, ${fails} fails`);
    console.log("==========================================");

    // Write summary JSON
    writeFileSync(
      resolve(OUT, "summary.json"),
      JSON.stringify({ summary, passes, fails, timestamp: new Date().toISOString() }, null, 2)
    );
    console.log(`\nSummary written to ${resolve(OUT, "summary.json")}`);
  } finally {
    await browser.close();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
