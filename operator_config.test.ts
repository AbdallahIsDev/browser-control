import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getConfigEntries,
  getConfigValue,
  loadConfig,
  loadUserConfig,
  saveUserConfig,
  setUserConfigValue,
  validateConfigValue,
} from "./config";
import { getConfigDir, getUserConfigPath } from "./paths";

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bc-operator-config-"));
}

test("effective config precedence is defaults < user config < environment", () => {
  const home = makeHome();
  try {
    const env = { BROWSER_CONTROL_HOME: home };
    saveUserConfig({
      brokerPort: 9000,
      policyProfile: "safe",
      terminalCols: 100,
    }, { env });

    const userConfig = loadConfig({ env, validate: false });
    assert.equal(userConfig.brokerPort, 9000);
    assert.equal(userConfig.policyProfile, "safe");
    assert.equal(userConfig.terminalCols, 100);

    const envConfig = loadConfig({
      env: {
        ...env,
        BROKER_PORT: "9999",
        POLICY_PROFILE: "trusted",
      },
      validate: false,
    });
    assert.equal(envConfig.brokerPort, 9999);
    assert.equal(envConfig.policyProfile, "trusted");
    assert.equal(envConfig.terminalCols, 100);

    const entries = getConfigEntries({
      env: {
        ...env,
        BROKER_PORT: "9999",
      },
    });
    assert.equal(entries.find((entry) => entry.key === "brokerPort")?.source, "env");
    assert.equal(entries.find((entry) => entry.key === "policyProfile")?.source, "user");
    assert.equal(entries.find((entry) => entry.key === "chromeDebugPort")?.source, "default");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("config validation rejects invalid values before writing", () => {
  assert.throws(
    () => validateConfigValue("policyProfile", "reckless"),
    /policyProfile.*safe, balanced, trusted/i,
  );
  assert.throws(
    () => validateConfigValue("brokerPort", "70000"),
    /brokerPort.*between 1 and 65535/i,
  );
  assert.throws(
    () => validateConfigValue("terminalAutoResume", "maybe"),
    /terminalAutoResume.*boolean/i,
  );
  assert.throws(
    () => validateConfigValue("browserMode", "remote"),
    /browserMode.*managed, attach/i,
  );
});

test("sensitive config values are redacted in list and get output", () => {
  const home = makeHome();
  try {
    const env = { BROWSER_CONTROL_HOME: home };
    saveUserConfig({
      openrouterApiKey: "sk-or-secret",
      browserlessApiKey: "browserless-secret",
    }, { env });

    const entries = getConfigEntries({ env });
    const openrouter = entries.find((entry) => entry.key === "openrouterApiKey");
    assert.equal(openrouter?.sensitive, true);
    assert.equal(openrouter?.value, "[redacted]");
    assert.equal(openrouter?.source, "user");

    const single = getConfigValue("browserlessApiKey", { env });
    assert.equal(single.sensitive, true);
    assert.equal(single.value, "[redacted]");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("config set persists to the user config file with atomic temp cleanup", () => {
  const home = makeHome();
  try {
    const env = { BROWSER_CONTROL_HOME: home };
    const result = setUserConfigValue("terminalRows", "40", { env });
    assert.equal(result.key, "terminalRows");
    assert.equal(result.value, 40);
    assert.equal(result.source, "user");

    const userConfig = loadUserConfig({ env });
    assert.equal(userConfig.terminalRows, 40);

    const configPath = getUserConfigPath(home);
    assert.equal(fs.existsSync(configPath), true);
    assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).terminalRows, 40);

    const tempFiles = fs.readdirSync(getConfigDir(home)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(tempFiles, []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("user config file is private on POSIX when secrets can be stored", () => {
  const home = makeHome();
  try {
    const env = { BROWSER_CONTROL_HOME: home };
    const result = setUserConfigValue("openrouterApiKey", "sk-or-secret", { env });
    assert.equal(result.value, "[redacted]");

    if (process.platform !== "win32") {
      const dirMode = fs.statSync(getConfigDir(home)).mode & 0o777;
      const mode = fs.statSync(getUserConfigPath(home)).mode & 0o777;
      assert.equal(dirMode, 0o700);
      assert.equal(mode, 0o600);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
