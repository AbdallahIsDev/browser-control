const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execSync } = require("child_process");
const http = require("http");

const WEB_URL = process.env.WEB_URL || "http://localhost:3000";
const API_BASE = "http://localhost:4000";
const API_URL = `${API_BASE}/api`;
const WEB_PORT = 3000;
const API_PORT = 4000;
const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "apps", "api");
const WEB_DIR = path.join(ROOT, "apps", "web");
const SCREENSHOT_DIR = path.join(
  ROOT,
  "artifacts",
  "verification",
  new Date().toISOString().slice(0, 10),
);

let failures = 0;
let screenshotsTaken = 0;
const manifest = [];

function log(msg) {
  console.log(`[e2e] ${msg}`);
}

function fail(msg) {
  console.error(`[e2e] FAIL: ${msg}`);
  failures++;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sha256(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function waitForServer(url, maxRetries = 60, delayMs = 2000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function tryConnect() {
      attempts++;
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 400) resolve();
          else retryOrFail();
        })
        .on("error", () => retryOrFail());
    }
    function retryOrFail() {
      if (attempts >= maxRetries) reject(new Error(`${url} not ready after ${maxRetries} attempts`));
      else setTimeout(tryConnect, delayMs);
    }
    tryConnect();
  });
}

function killPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr ":${port}"`, { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split("\n")) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
      }
      for (const pid of pids) {
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" }); } catch {}
      }
      return pids.size;
    }
  } catch {}
  return 0;
}

// Direct API login via fetch to port 4000.
// Navigates to the web app FIRST so the page has a valid origin (http://localhost:3000)
// for CORS. Otherwise fetch from about:blank sends Origin: null which is rejected.
async function loginViaApi(page, email, password) {
  // Navigate to web app so fetch has correct origin for CORS
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1000);

  const result = await page.evaluate(async ({ API_BASE, email, password }) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        return { ok: false, error: body?.message || body?.error || res.statusText };
      }
      const data = await res.json();
      return { ok: true, role: data.user?.role, token: data.access_token };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, { API_BASE, email, password });
  return result;
}

// Login via the login page form (simulates real user login flow)
async function loginViaForm(page, email, password) {
  await page.goto(`${WEB_URL}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);

  const emailField = page.locator('input[type="email"], input[name="email"]');

  if ((await emailField.count()) === 0) {
    fail(`No email field found on login page`);
    return false;
  }

  await emailField.fill(email);
  const passwordField = page.locator('input[type="password"]');
  await passwordField.fill(password);

  const submitBtn = page.locator('button[type="submit"]');
  if ((await submitBtn.count()) === 0) {
    fail("No submit button found on login page");
    return false;
  }

  await submitBtn.click();
  // Wait for navigation after login (redirect to dashboard)
  await page.waitForTimeout(4000);
  return true;
}

async function assertAuthenticated(page, label) {
  const url = page.url();
  const bodyText = await page.textContent("body");

  if (
    bodyText.includes("Sign in to your account") ||
    bodyText.includes("Please sign in") ||
    url.includes("/login")
  ) {
    fail(`${label} - page is login/redirect, not authenticated (URL: ${url})`);
    return false;
  }

  // Verify auth via direct API call to port 4000 (where the HttpOnly cookie lives)
  // The cookie is sameSite="lax", so it's sent for same-site cross-origin requests
  // (localhost:3000 => localhost:4000 are same-site, different ports)
  try {
    const meRes = await page.evaluate(async () => {
      const res = await fetch("http://localhost:4000/api/me", {
        credentials: "include",
      });
      return { status: res.status, ok: res.ok };
    });
    if (!meRes.ok) {
      fail(`${label} - /api/me returned ${meRes.status} (not authenticated)`);
      return false;
    }
  } catch (err) {
    fail(`${label} - /api/me fetch failed: ${err.message}`);
    return false;
  }

  log(`${label} - authenticated`);
  return true;
}

// Reload the current page and verify auth persists after full page reload
async function assertAuthSurvivesReload(page, label) {
  await page.reload({ waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  return assertAuthenticated(page, `${label} (after reload)`);
}

// Screenshot a public page (no auth needed, create fresh context)
async function screenshotPublic(browser, name, route, viewport = { width: 1280, height: 720 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const filePath = path.join(SCREENSHOT_DIR, name);

  try {
    await page.goto(`${WEB_URL}${route}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: filePath, fullPage: false });
    screenshotsTaken++;

    const hash = sha256(filePath);
    manifest.push({
      filename: name,
      route,
      role: "public",
      viewport,
      verifiedText: (await page.textContent("body")).slice(0, 200).replace(/\s+/g, " ").trim(),
      finalUrl: page.url(),
      sha256: hash,
      timestamp: new Date().toISOString(),
    });
    log(`Screenshot: ${name} (${hash.slice(0, 8)})`);
  } catch (err) {
    fail(`${name} - screenshot failed: ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }
}

// Screenshot an authenticated page (use existing logged-in page)
async function screenshotAuthenticated(page, name, route, role, viewport = { width: 1280, height: 720 }) {
  const filePath = path.join(SCREENSHOT_DIR, name);

  try {
    await page.goto(`${WEB_URL}${route}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: filePath, fullPage: false });
    screenshotsTaken++;

    const hash = sha256(filePath);
    manifest.push({
      filename: name,
      route,
      role,
      viewport,
      verifiedText: (await page.textContent("body")).slice(0, 200).replace(/\s+/g, " ").trim(),
      finalUrl: page.url(),
      sha256: hash,
      timestamp: new Date().toISOString(),
    });
    log(`Screenshot: ${name} (${hash.slice(0, 8)})`);

    // Check for duplicate hashes (stale/redirect screenshots)
    const priorHashes = manifest.filter((m) => m.filename !== name).map((m) => m.sha256);
    if (priorHashes.includes(hash)) {
      fail(`${name} - duplicate hash ${hash.slice(0, 8)} with a prior screenshot (stale/redirect)`);
    }

    // Verify auth
    await assertAuthenticated(page, name);
  } catch (err) {
    fail(`${name} - screenshot failed: ${err.message}`);
  }
}

async function main() {
  let apiProcess = null;
  let webProcess = null;
  let startedApi = false;
  let startedWeb = false;
  let browser = null;

  try {
    ensureDir(SCREENSHOT_DIR);
    log(`Screenshots will be saved to ${SCREENSHOT_DIR}`);

    // Clean ports
    killPort(API_PORT);
    killPort(WEB_PORT);
    await new Promise((r) => setTimeout(r, 2000));

    // Start API with NODE_ENV=test to disable rate limiting
    log("Starting API server (NODE_ENV=test)...");
    apiProcess = spawn("node", ["-r", "ts-node/register", "-r", "tsconfig-paths/register", "src/main.ts"], {
      cwd: API_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "test" },
    });
    startedApi = true;

    await waitForServer(`${API_URL}/public/clinics`, 40, 2000);
    log("API is ready");

    // Start Web
    log("Starting Web server...");
    webProcess = spawn("npx", ["next", "dev", "-p", String(WEB_PORT)], {
      cwd: WEB_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "development" },
      shell: process.platform === "win32",
    });
    startedWeb = true;

    await waitForServer(WEB_URL, 60, 3000);
    log("Web is ready");

    // Launch browser
    browser = await chromium.launch({ headless: true });

    // ============================================================
    // 1. PUBLIC PAGES (no login required)
    // ============================================================
    log("=== Capturing public pages ===");

    await screenshotPublic(browser, "public-home-light.png", "/");

    // Dark mode
    const darkContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      colorScheme: "dark",
      deviceScaleFactor: 1,
    });
    const darkPage = await darkContext.newPage();
    try {
      await darkPage.goto(`${WEB_URL}/`, { waitUntil: "networkidle", timeout: 30000 });
      await darkPage.waitForTimeout(2000);
      const darkFilePath = path.join(SCREENSHOT_DIR, "public-home-dark.png");
      await darkPage.screenshot({ path: darkFilePath, fullPage: false });
      screenshotsTaken++;
      manifest.push({
        filename: "public-home-dark.png",
        route: "/",
        role: "public",
        viewport: { width: 1280, height: 720 },
        verifiedText: (await darkPage.textContent("body")).slice(0, 200).replace(/\s+/g, " ").trim(),
        finalUrl: darkPage.url(),
        sha256: sha256(darkFilePath),
        timestamp: new Date().toISOString(),
      });
      log("Screenshot: public-home-dark.png");
    } finally {
      await darkPage.close();
      await darkContext.close();
    }

    await screenshotPublic(browser, "clinics-list.png", "/clinics");
    await screenshotPublic(browser, "clinic-profile-modern-specialty.png", "/clinics/nile-dermatology-center");
    await screenshotPublic(browser, "clinic-profile-aesthetic-clinic.png", "/clinics/aesthetic-glow-clinic");
    await screenshotPublic(browser, "clinic-profile-family-care.png", "/clinics/madar-family-clinic");
    await screenshotPublic(browser, "booking-form.png", "/clinics/nile-dermatology-center/book");

    // ============================================================
    // 2. PATIENT
    // ============================================================
    log("=== Logging in as patient (via API) ===");
    const patientCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const patientPage = await patientCtx.newPage();

    // Login via API to set HttpOnly cookie on port 4000.
    // loginViaApi navigates to web app first for correct CORS origin.
    const patientApiLogin = await loginViaApi(patientPage, "patient@madarcare.test", "MadarCare123!");
    if (!patientApiLogin.ok) {
      fail(`Patient API login failed: ${patientApiLogin.error}`);
    } else {
      log(`Patient logged in, role: ${patientApiLogin.role}`);
    }

    // Navigate to patient appointments so auth context picks up the cookie
    await patientPage.goto(`${WEB_URL}/me/appointments`, { waitUntil: "networkidle", timeout: 30000 });
    await patientPage.waitForTimeout(2000);

    await screenshotAuthenticated(patientPage, "patient-appointments-authenticated.png", "/me/appointments", "patient");

    // === RELOAD TEST ===
    log("=== Testing auth survives full page reload ===");
    // Only verify auth survives reload - no need to re-take screenshot (would have same hash)
    await assertAuthSurvivesReload(patientPage, "patient-appointments (reload)");
    // Navigate back to appointments page for booking step
    await patientPage.goto(`${WEB_URL}/me/appointments`, { waitUntil: "networkidle", timeout: 30000 });
    await patientPage.waitForTimeout(1000);

    // Booking success
    log("Submitting booking form for success screenshot...");
    await patientPage.goto(`${WEB_URL}/clinics/nile-dermatology-center/book`, { waitUntil: "networkidle", timeout: 30000 });
    await patientPage.waitForTimeout(1500);

    // Fill form fields
    const nameInput = patientPage.locator('input#patientName, input[name="patientName"]');
    if (await nameInput.count() > 0) {
      await nameInput.fill("Mona Ali");
    }
    const phoneInput = patientPage.locator('input#patientPhone, input[name="patientPhone"]');
    if (await phoneInput.count() > 0) {
      await phoneInput.fill(`+2010999999${Date.now().toString().slice(-4)}`);
    }

    // Set datetime
    const dateInput = patientPage.locator('input[type="datetime-local"]');
    if (await dateInput.count() > 0) {
      const futureDate = new Date(Date.now() + 86400000 * 14);
      const dateStr = futureDate.toISOString().slice(0, 16);
      await dateInput.fill(dateStr);
    }

    // Submit form
    const submitBtn = patientPage.locator('button[type="submit"]');
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      await patientPage.waitForTimeout(3000);
      log("Booking form submitted");
    }

    const bookingSuccessPath = path.join(SCREENSHOT_DIR, "booking-success-with-selected-service-doctor.png");
    await patientPage.screenshot({ path: bookingSuccessPath, fullPage: true });
    screenshotsTaken++;
    manifest.push({
      filename: "booking-success-with-selected-service-doctor.png",
      route: "/clinics/nile-dermatology-center/book",
      role: "patient",
      viewport: { width: 1280, height: 720 },
      verifiedText: (await patientPage.textContent("body")).slice(0, 200).replace(/\s+/g, " ").trim(),
      finalUrl: patientPage.url(),
      sha256: sha256(bookingSuccessPath),
      timestamp: new Date().toISOString(),
    });
    log("Screenshot: booking-success-with-selected-service-doctor.png");

    await patientPage.close();
    await patientCtx.close();

    // ============================================================
    // 3. CLINIC OWNER - share the SAME context for all clinic pages
    // ============================================================
    log("=== Logging in as clinic owner (form flow) ===");
    const clinicCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const clinicPage = await clinicCtx.newPage();

    // Use form login flow to test the real user path
    const clinicFormLogin = await loginViaForm(clinicPage, "clinic@madarcare.test", "MadarCare123!");
    if (!clinicFormLogin) {
      fail("Clinic owner form login failed");
    }

    await assertAuthenticated(clinicPage, "clinic owner pre-check");

    // === RELOAD TEST ===
    log("Testing clinic owner auth survives reload...");
    await assertAuthSurvivesReload(clinicPage, "clinic owner (reload)");

    // Take all clinic screenshots using the same logged-in page
    const clinicPages = [
      { name: "clinic-dashboard.png", route: "/clinic" },
      { name: "clinic-services.png", route: "/clinic/services" },
      { name: "clinic-doctors.png", route: "/clinic/doctors" },
      { name: "clinic-availability.png", route: "/clinic/availability" },
      { name: "clinic-appointments.png", route: "/clinic/appointments" },
      { name: "clinic-patients.png", route: "/clinic/patients" },
      { name: "clinic-revenue.png", route: "/clinic/revenue" },
      { name: "clinic-analytics.png", route: "/clinic/analytics" },
      { name: "clinic-staff.png", route: "/clinic/staff" },
      { name: "clinic-audit-log.png", route: "/clinic/audit-log" },
    ];

    for (const cp of clinicPages) {
      await screenshotAuthenticated(clinicPage, cp.name, cp.route, "clinic_owner");
    }

    await clinicPage.close();
    await clinicCtx.close();

    // ============================================================
    // 4. PLATFORM OWNER - share the SAME context for all owner pages
    // ============================================================
    log("=== Logging in as platform owner ====");
    const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const ownerPage = await ownerCtx.newPage();

    const ownerApiLogin = await loginViaApi(ownerPage, "owner@madarcare.test", "MadarCare123!");
    if (!ownerApiLogin.ok) {
      fail(`Platform owner API login failed: ${ownerApiLogin.error}`);
    } else {
      log(`Platform owner logged in, role: ${ownerApiLogin.role}`);
    }

    // Navigate to owner dashboard so auth context picks up the cookie
    await ownerPage.goto(`${WEB_URL}/owner`, { waitUntil: "networkidle", timeout: 30000 });
    await ownerPage.waitForTimeout(2000);

    await assertAuthenticated(ownerPage, "platform owner pre-check");

    // === RELOAD TEST ===
    log("Testing platform owner auth survives reload...");
    await assertAuthSurvivesReload(ownerPage, "platform owner (reload)");

    // Take all owner screenshots using the same logged-in page
    const ownerPages = [
      { name: "owner-dashboard.png", route: "/owner" },
      { name: "owner-clinics.png", route: "/owner/clinics" },
      { name: "owner-approvals.png", route: "/owner/approvals" },
      { name: "owner-analytics.png", route: "/owner/analytics" },
      { name: "owner-settings.png", route: "/owner/settings" },
    ];

    for (const op of ownerPages) {
      await screenshotAuthenticated(ownerPage, op.name, op.route, "platform_owner");
    }

    // Owner clinic detail - fetch a clinic ID first
    log("Fetching clinic ID for owner-clinic-detail...");
    const clinicId = await ownerPage.evaluate(async () => {
      try {
        const res = await fetch("http://localhost:4000/api/owner/clinics", {
          credentials: "include",
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data[0].id || data[0].clinic?.id || null;
        }
        return null;
      } catch { return null; }
    });

    if (clinicId) {
      log(`Owner clinic detail ID: ${clinicId}`);
      await screenshotAuthenticated(ownerPage, "owner-clinic-detail.png", `/owner/clinics/${clinicId}`, "platform_owner");
    } else {
      fail("owner-clinic-detail - could not fetch clinic ID");
    }

    await ownerPage.close();
    await ownerCtx.close();

    // ============================================================
    // 5. MOBILE SCREENSHOTS
    // ============================================================
    log("=== Capturing mobile screenshots ===");

    await screenshotPublic(browser, "mobile-home.png", "/", { width: 375, height: 667 });

    // Mobile dashboard - login with clinic owner
    const mobileCtx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
    const mobilePage = await mobileCtx.newPage();
    const mobileLogin = await loginViaApi(mobilePage, "clinic@madarcare.test", "MadarCare123!");
    if (!mobileLogin.ok) {
      fail(`Mobile login failed: ${mobileLogin.error}`);
    }

    // Navigate to clinic dashboard so auth context picks up the cookie
    await mobilePage.goto(`${WEB_URL}/clinic`, { waitUntil: "networkidle", timeout: 30000 });
    await mobilePage.waitForTimeout(2000);

    await screenshotAuthenticated(mobilePage, "mobile-dashboard.png", "/clinic", "clinic_owner", { width: 375, height: 667 });
    await mobilePage.close();
    await mobileCtx.close();

    // ============================================================
    // 6. WRITE MANIFEST
    // ============================================================
    fs.writeFileSync(path.join(SCREENSHOT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
    log(`Manifest written with ${manifest.length} entries`);
    log(`Total screenshots: ${screenshotsTaken}`);

    // Check for duplicate hashes across all screenshots (excluding public pages)
    const nonPublic = manifest.filter((m) => m.role !== "public");
    const hashes = nonPublic.map((m) => m.sha256);
    const uniqueHashes = new Set(hashes);
    if (hashes.length !== uniqueHashes.size) {
      const dupes = hashes.filter((h, i) => hashes.indexOf(h) !== i);
      fail(`Duplicate screenshot hashes detected in authenticated pages: ${[...new Set(dupes)].map((h) => h.slice(0, 8)).join(", ")}`);
    }

    // Verify all required screenshots exist
    const requiredFiles = [
      "public-home-light.png",
      "public-home-dark.png",
      "clinics-list.png",
      "clinic-profile-modern-specialty.png",
      "clinic-profile-aesthetic-clinic.png",
      "clinic-profile-family-care.png",
      "booking-form.png",
      "booking-success-with-selected-service-doctor.png",
      "patient-appointments-authenticated.png",
      "clinic-dashboard.png",
      "clinic-services.png",
      "clinic-doctors.png",
      "clinic-availability.png",
      "clinic-appointments.png",
      "clinic-patients.png",
      "clinic-revenue.png",
      "clinic-analytics.png",
      "clinic-staff.png",
      "clinic-audit-log.png",
      "owner-dashboard.png",
      "owner-clinics.png",
      "owner-approvals.png",
      "owner-clinic-detail.png",
      "owner-analytics.png",
      "owner-settings.png",
      "mobile-home.png",
      "mobile-dashboard.png",
    ];

    let missingCount = 0;
    for (const f of requiredFiles) {
      const fp = path.join(SCREENSHOT_DIR, f);
      if (!fs.existsSync(fp)) {
        fail(`Required screenshot missing: ${f}`);
        missingCount++;
      }
    }

    if (missingCount === 0) {
      log("All required screenshots present");
    }

    if (failures === 0) {
      log("=== ALL E2E VERIFICATIONS PASSED ===");
    } else {
      log(`=== ${failures} FAILURES DETECTED ===`);
    }
  } catch (err) {
    log(`Fatal error: ${err.message}`);
    console.error(err);
    failures++;
  } finally {
    // Cleanup
    if (browser) await browser.close();

    if (startedApi && apiProcess) {
      log("Stopping API server...");
      apiProcess.kill("SIGTERM");
    }
    if (startedWeb && webProcess) {
      log("Stopping Web server...");
      webProcess.kill("SIGTERM");
    }

    await new Promise((r) => setTimeout(r, 3000));

    try { if (apiProcess && !apiProcess.killed) apiProcess.kill("SIGKILL"); } catch {}
    try { if (webProcess && !webProcess.killed) webProcess.kill("SIGKILL"); } catch {}

    killPort(API_PORT);
    killPort(WEB_PORT);

    log("Port cleanup done");
    process.exit(failures > 0 ? 1 : 0);
  }
}

main();
