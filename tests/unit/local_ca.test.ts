import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLocalhostCa,
  getLocalhostCaPaths,
  getLocalhostCaStatus,
  installLocalhostCaTrust,
  uninstallLocalhostCaTrust,
} from "../../src/services/local_ca";

test("localhost CA creation writes only under the requested CA directory", () => {
  const caDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-local-ca-"));
  const commands: string[] = [];
  try {
    const result = createLocalhostCa({
      caDir,
      runCommand: (command, args) => {
        commands.push(`${command} ${args.join(" ")}`);
        const paths = getLocalhostCaPaths({ caDir });
        fs.writeFileSync(paths.caCertPath, "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n");
        fs.writeFileSync(paths.caKeyPath, "-----BEGIN PRIVATE KEY-----\nca\n-----END PRIVATE KEY-----\n");
        fs.writeFileSync(paths.certPath, "-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----\n");
        fs.writeFileSync(paths.keyPath, "-----BEGIN PRIVATE KEY-----\nleaf\n-----END PRIVATE KEY-----\n");
        return { status: 0, stdout: "ok", stderr: "" };
      },
    });

    assert.equal(result.created, true);
    assert.equal(result.status.ready, true);
    assert.ok(result.status.caCertPath.startsWith(caDir));
    assert.ok(result.status.certPath.startsWith(caDir));
    assert.equal(commands.length, 1);
    assert.match(commands[0], /powershell|pwsh/i);
  } finally {
    fs.rmSync(caDir, { recursive: true, force: true });
  }
});

test("localhost CA creation refuses to overwrite existing material without rotation", () => {
  const caDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-local-ca-existing-"));
  try {
    const paths = getLocalhostCaPaths({ caDir });
    fs.mkdirSync(caDir, { recursive: true });
    fs.writeFileSync(paths.caCertPath, "ca");
    fs.writeFileSync(paths.caKeyPath, "key");
    fs.writeFileSync(paths.certPath, "cert");
    fs.writeFileSync(paths.keyPath, "leaf-key");

    assert.throws(
      () => createLocalhostCa({ caDir }),
      /already exists/i,
    );
  } finally {
    fs.rmSync(caDir, { recursive: true, force: true });
  }
});

test("localhost CA trust install and uninstall use current-user trust store commands", () => {
  const caDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-local-ca-trust-"));
  const commands: string[] = [];
  try {
    const paths = getLocalhostCaPaths({ caDir });
    fs.writeFileSync(paths.caCertPath, "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n");

    const install = installLocalhostCaTrust({
      caDir,
      platform: "win32",
      runCommand: (command, args) => {
        commands.push(`${command} ${args.join(" ")}`);
        return { status: 0, stdout: "trusted", stderr: "" };
      },
    });
    assert.equal(install.trusted, true);

    const uninstall = uninstallLocalhostCaTrust({
      caDir,
      platform: "win32",
      runCommand: (command, args) => {
        commands.push(`${command} ${args.join(" ")}`);
        return { status: 0, stdout: "removed", stderr: "" };
      },
    });
    assert.equal(uninstall.trusted, false);
    assert.match(commands.join("\n"), /Import-Certificate/);
    assert.match(commands.join("\n"), /X509Store/);
    assert.match(commands.join("\n"), /\.Remove\(/);
  } finally {
    fs.rmSync(caDir, { recursive: true, force: true });
  }
});

test("localhost CA status reports missing and ready certificate material", () => {
  const caDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-local-ca-status-"));
  try {
    assert.equal(getLocalhostCaStatus({ caDir }).ready, false);

    const paths = getLocalhostCaPaths({ caDir });
    fs.writeFileSync(paths.caCertPath, "ca");
    fs.writeFileSync(paths.caKeyPath, "key");
    fs.writeFileSync(paths.certPath, "cert");
    fs.writeFileSync(paths.keyPath, "leaf-key");

    const status = getLocalhostCaStatus({ caDir });
    assert.equal(status.ready, true);
    assert.equal(status.trusted, "unknown");
  } finally {
    fs.rmSync(caDir, { recursive: true, force: true });
  }
});
