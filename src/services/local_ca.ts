import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDataHome } from "../shared/paths";

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type CommandRunner = (command: string, args: string[]) => CommandResult;

export interface LocalhostCaOptions {
  caDir?: string;
  platform?: NodeJS.Platform;
  runCommand?: CommandRunner;
}

export interface LocalhostCaCreateOptions extends LocalhostCaOptions {
  rotate?: boolean;
  days?: number;
}

export interface LocalhostCaPaths {
  caDir: string;
  caCertPath: string;
  caKeyPath: string;
  certPath: string;
  keyPath: string;
  scriptPath: string;
}

export interface LocalhostCaStatus extends LocalhostCaPaths {
  caExists: boolean;
  certExists: boolean;
  keyExists: boolean;
  ready: boolean;
  trusted: boolean | "unknown";
  trustDetails?: string;
}

export interface LocalhostCaCreateResult {
  created: boolean;
  status: LocalhostCaStatus;
}

export interface LocalhostCaTrustResult {
  trusted: boolean;
  status: LocalhostCaStatus;
  details: string;
}

const CA_NAME = "Browser Control Localhost CA";

function defaultCaDir(): string {
  return path.join(getDataHome(), "certs", "localhost-ca");
}

function defaultRunner(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function pickPowerShell(): string {
  if (process.platform === "win32") {
    const probe = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8", windowsHide: true });
    return probe.status === 0 ? "pwsh" : "powershell.exe";
  }
  return "pwsh";
}

function assertInsideDir(baseDir: string, candidate: string): void {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(candidate);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Refusing to write local CA material outside ${base}: ${resolved}`);
  }
}

function runChecked(runCommand: CommandRunner, command: string, args: string[]): CommandResult {
  const result = runCommand(command, args);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || `exit ${result.status}`;
    throw new Error(`Local CA command failed: ${detail}`);
  }
  return result;
}

function readCertificateThumbprint(certPath: string): string | undefined {
  try {
    const cert = new X509Certificate(fs.readFileSync(certPath));
    return cert.fingerprint.replace(/:/gu, "");
  } catch {
    return undefined;
  }
}

export function getLocalhostCaPaths(options: LocalhostCaOptions = {}): LocalhostCaPaths {
  const caDir = path.resolve(options.caDir ?? defaultCaDir());
  return {
    caDir,
    caCertPath: path.join(caDir, "browser-control-localhost-ca.cert.pem"),
    caKeyPath: path.join(caDir, "browser-control-localhost-ca.key.pem"),
    certPath: path.join(caDir, "localhost.cert.pem"),
    keyPath: path.join(caDir, "localhost.key.pem"),
    scriptPath: path.join(caDir, "generate-localhost-ca.ps1"),
  };
}

export function getLocalhostCaStatus(options: LocalhostCaOptions = {}): LocalhostCaStatus {
  const paths = getLocalhostCaPaths(options);
  const caExists = fs.existsSync(paths.caCertPath) && fs.existsSync(paths.caKeyPath);
  const certExists = fs.existsSync(paths.certPath);
  const keyExists = fs.existsSync(paths.keyPath);
  let trusted: boolean | "unknown" = "unknown";
  let trustDetails: string | undefined;
  const thumbprint = fs.existsSync(paths.caCertPath) ? readCertificateThumbprint(paths.caCertPath) : undefined;
  if ((options.platform ?? process.platform) === "win32" && thumbprint) {
    const command = pickPowerShell();
    const result = (options.runCommand ?? defaultRunner)(
      command,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `if (Test-Path ${JSON.stringify(`Cert:\\CurrentUser\\Root\\${thumbprint}`)}) { "trusted" } else { "untrusted" }`],
    );
    if (result.status === 0) {
      const output = result.stdout.trim();
      trusted = output.includes("trusted") && !output.includes("untrusted");
      trustDetails = output;
    }
  }
  return {
    ...paths,
    caExists,
    certExists,
    keyExists,
    ready: caExists && certExists && keyExists,
    trusted,
    ...(trustDetails ? { trustDetails } : {}),
  };
}

function buildGenerateScript(paths: LocalhostCaPaths, days: number): string {
  const subject = `CN=${CA_NAME}`;
  return `
$ErrorActionPreference = "Stop"
$caDir = ${JSON.stringify(paths.caDir)}
New-Item -ItemType Directory -Force -Path $caDir | Out-Null
$rootKey = [System.Security.Cryptography.RSA]::Create(4096)
$rootReq = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(${JSON.stringify(subject)}, $rootKey, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$rootReq.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $false, 0, $true))
$rootReq.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign, $true))
$rootReq.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($rootReq.PublicKey, $false))
$notBefore = [System.DateTimeOffset]::UtcNow.AddDays(-1)
$notAfter = $notBefore.AddDays(${days})
$root = $rootReq.CreateSelfSigned($notBefore, $notAfter)
$leafKey = [System.Security.Cryptography.RSA]::Create(2048)
$leafReq = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=*.localhost", $leafKey, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName("localhost")
$san.AddDnsName("*.localhost")
$san.AddIpAddress([System.Net.IPAddress]::Parse("127.0.0.1"))
$san.AddIpAddress([System.Net.IPAddress]::Parse("::1"))
$leafReq.CertificateExtensions.Add($san.Build())
$leafReq.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
$leafReq.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment, $true))
$eku = [System.Security.Cryptography.OidCollection]::new()
[void]$eku.Add([System.Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.1"))
$leafReq.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($eku, $true))
$serial = New-Object byte[] 16
[System.Security.Cryptography.RandomNumberGenerator]::Fill($serial)
$leafCert = $leafReq.Create($root, $notBefore, $notAfter, $serial)
$leaf = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($leafCert, $leafKey)
[System.IO.File]::WriteAllText(${JSON.stringify(paths.caCertPath)}, $root.ExportCertificatePem())
[System.IO.File]::WriteAllText(${JSON.stringify(paths.caKeyPath)}, $rootKey.ExportPkcs8PrivateKeyPem())
[System.IO.File]::WriteAllText(${JSON.stringify(paths.certPath)}, $leaf.ExportCertificatePem())
[System.IO.File]::WriteAllText(${JSON.stringify(paths.keyPath)}, $leafKey.ExportPkcs8PrivateKeyPem())
`.trimStart();
}

export function createLocalhostCa(options: LocalhostCaCreateOptions = {}): LocalhostCaCreateResult {
  const paths = getLocalhostCaPaths(options);
  for (const candidate of Object.values(paths)) assertInsideDir(paths.caDir, candidate);
  const status = getLocalhostCaStatus(options);
  if (status.ready && !options.rotate) {
    throw new Error(`Localhost CA material already exists at ${paths.caDir}. Use --rotate=true to replace it.`);
  }
  fs.rmSync(paths.caDir, { recursive: true, force: true });
  fs.mkdirSync(paths.caDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(paths.scriptPath, buildGenerateScript(paths, options.days ?? 825), { encoding: "utf8", mode: 0o600 });
  const command = pickPowerShell();
  runChecked(options.runCommand ?? defaultRunner, command, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", paths.scriptPath]);
  const nextStatus = getLocalhostCaStatus(options);
  if (!nextStatus.ready) {
    throw new Error(`Localhost CA generation did not produce complete certificate material under ${paths.caDir}.`);
  }
  return { created: true, status: nextStatus };
}

export function installLocalhostCaTrust(options: LocalhostCaOptions = {}): LocalhostCaTrustResult {
  const platform = options.platform ?? process.platform;
  const paths = getLocalhostCaPaths(options);
  if (!fs.existsSync(paths.caCertPath)) {
    throw new Error(`Localhost CA certificate not found: ${paths.caCertPath}`);
  }
  if (platform !== "win32") {
    throw new Error(`Automatic local CA trust install is currently supported only on Windows; CA certificate is at ${paths.caCertPath}.`);
  }
  const command = pickPowerShell();
  const script = `Import-Certificate -FilePath ${JSON.stringify(paths.caCertPath)} -CertStoreLocation Cert:\\CurrentUser\\Root | Out-String`;
  const output = runChecked(options.runCommand ?? defaultRunner, command, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
  return {
    trusted: true,
    status: { ...getLocalhostCaStatus(options), trusted: true, trustDetails: output.stdout.trim() },
    details: output.stdout.trim() || "Installed into CurrentUser Root trust store.",
  };
}

export function uninstallLocalhostCaTrust(options: LocalhostCaOptions = {}): LocalhostCaTrustResult {
  const platform = options.platform ?? process.platform;
  const paths = getLocalhostCaPaths(options);
  if (platform !== "win32") {
    throw new Error("Automatic local CA trust uninstall is currently supported only on Windows.");
  }
  const thumbprint = fs.existsSync(paths.caCertPath) ? readCertificateThumbprint(paths.caCertPath) : undefined;
  const script = `
$ErrorActionPreference = "Stop"
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new("Root", [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
try {
  $toRemove = @()
  foreach ($cert in $store.Certificates) {
    if (${thumbprint ? `$cert.Thumbprint -eq ${JSON.stringify(thumbprint)}` : `$cert.Subject -eq ${JSON.stringify(`CN=${CA_NAME}`)}`}) { $toRemove += $cert }
  }
  foreach ($cert in $toRemove) { $store.Remove($cert) }
  "removed=$($toRemove.Count)"
} finally {
  $store.Close()
}
`.trim();
  const output = runChecked(options.runCommand ?? defaultRunner, pickPowerShell(), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
  return {
    trusted: false,
    status: { ...getLocalhostCaStatus(options), trusted: false, trustDetails: output.stdout.trim() },
    details: output.stdout.trim() || "Removed Browser Control Localhost CA from CurrentUser Root trust store.",
  };
}
