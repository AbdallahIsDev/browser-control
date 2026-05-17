import fs from "node:fs";
import path from "node:path";
import { getDataHome } from "../shared/paths";
import { PACKAGE_NAME_REGEX, validatePackageManifest, computePackageDigest } from "./manifest";
import type { InstalledAutomationPackage, PackagePermissionDecision, TrustReviewRecord, PackageEvalRecord } from "./types";

const PACKAGES_DIR_NAME = "packages";
const REGISTRY_FILE = "registry.json";
const MAX_PACKAGE_FILES = 1000;
const MAX_PACKAGE_SIZE_BYTES = 1024 * 1024 * 50; // 50 MB

export function getPackagesDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), PACKAGES_DIR_NAME);
}

export function getPackageRegistryPath(dataHome?: string): string {
  return path.join(getPackagesDir(dataHome), REGISTRY_FILE);
}

export function getInstalledPackageDir(packageName: string, dataHome?: string): string {
  assertPackageName(packageName);
  return path.join(getPackagesDir(dataHome), "installed", packageName);
}

function assertPackageName(packageName: string): void {
  if (!PACKAGE_NAME_REGEX.test(packageName)) {
    throw new Error(`Invalid package name: ${packageName}`);
  }
}

function safeInstalledDir(packageName: string, dataHome?: string): string {
  const installedRoot = path.resolve(getPackagesDir(dataHome), "installed");
  const installDir = path.resolve(getInstalledPackageDir(packageName, dataHome));
  const relative = path.relative(installedRoot, installDir);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Package install path escapes installed root: ${packageName}`);
  }
  return installDir;
}

function ensurePackagesDir(dataHome?: string): void {
  const dir = getPackagesDir(dataHome);
  fs.mkdirSync(path.join(dir, "installed"), { recursive: true });
}

export class PackageRegistry {
  constructor(private readonly dataHome?: string) {}

  /**
   * Load all installed packages.
   */
  list(): InstalledAutomationPackage[] {
    const registryPath = getPackageRegistryPath(this.dataHome);
    if (!fs.existsSync(registryPath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /**
   * Get a specific package by name.
   */
  get(packageName: string): InstalledAutomationPackage | null {
    if (!PACKAGE_NAME_REGEX.test(packageName)) return null;
    return this.list().find(p => p.name === packageName) ?? null;
  }

  /**
   * Install a package from a local directory.
   */
  install(sourcePath: string): { success: boolean; package?: InstalledAutomationPackage; error?: string } {
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `Source path not found: ${sourcePath}` };
    }

    // Determine manifest path
    let manifestPath = path.join(sourcePath, "automation-package.json");
    if (!fs.existsSync(manifestPath)) {
      manifestPath = path.join(sourcePath, "package.browser-control.json");
    }

    const validation = validatePackageManifest(manifestPath, sourcePath);
    if (!validation.valid || !validation.manifest) {
      return { success: false, error: `Manifest validation failed: ${validation.errors.join("; ")}` };
    }

    const manifest = validation.manifest;
    const existing = this.get(manifest.name);
    if (existing) {
      return { success: false, error: `Package ${manifest.name} is already installed. Use update.` };
    }

    ensurePackagesDir(this.dataHome);
    const installDir = safeInstalledDir(manifest.name, this.dataHome);

    if (fs.existsSync(installDir)) {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
    fs.mkdirSync(installDir, { recursive: true });

    try {
      this.copyDirectorySafely(sourcePath, installDir);
    } catch (err) {
      fs.rmSync(installDir, { recursive: true, force: true });
      return { success: false, error: `Installation failed: ${(err as Error).message}` };
    }

    // Compute package digest after installation
    let digestResult;
    try {
      digestResult = computePackageDigest(installDir);
    } catch {
      digestResult = undefined;
    }

    const permissions: PackagePermissionDecision[] = manifest.permissions.map(p => ({
      permission: p,
      granted: false, // Default deny
    }));

    const installedPackage: InstalledAutomationPackage = {
      name: manifest.name,
      version: manifest.version,
      source: sourcePath,
      installedPath: installDir,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      enabled: true,
      permissions,
      validationStatus: "valid",
      validationErrors: [],
      workflows: manifest.workflows ?? [],
      helpers: manifest.helpers ?? [],
      evals: manifest.evals ?? [],
      digest: digestResult?.digest,
      signer: manifest.trust?.signer,
    };

    const registry = this.list();
    registry.push(installedPackage);
    this.saveRegistry(registry);

    return { success: true, package: installedPackage };
  }

  /**
   * Update an existing package.
   */
  update(packageName: string, sourcePath?: string): { success: boolean; package?: InstalledAutomationPackage; error?: string } {
    if (!PACKAGE_NAME_REGEX.test(packageName)) {
      return { success: false, error: `Invalid package name: ${packageName}` };
    }

    const existing = this.get(packageName);
    if (!existing) {
      return { success: false, error: `Package not found: ${packageName}` };
    }

    const targetSource = sourcePath ?? existing.source;
    if (!fs.existsSync(targetSource)) {
      return { success: false, error: `Source path not found: ${targetSource}` };
    }

    let manifestPath = path.join(targetSource, "automation-package.json");
    if (!fs.existsSync(manifestPath)) {
      manifestPath = path.join(targetSource, "package.browser-control.json");
    }

    const validation = validatePackageManifest(manifestPath, targetSource);
    if (!validation.valid || !validation.manifest) {
      return { success: false, error: `Manifest validation failed: ${validation.errors.join("; ")}` };
    }

    if (validation.manifest.name !== packageName) {
      return { success: false, error: `Manifest package name mismatch: expected ${packageName}, got ${validation.manifest.name}` };
    }

    const installDir = safeInstalledDir(packageName, this.dataHome);
    
    const backupDir = `${installDir}.backup-${Date.now()}`;
    if (fs.existsSync(installDir)) {
      fs.renameSync(installDir, backupDir);
    }
    
    fs.mkdirSync(installDir, { recursive: true });
    
    try {
      this.copyDirectorySafely(targetSource, installDir);
      
      const manifest = validation.manifest;
      
      const permissions: PackagePermissionDecision[] = manifest.permissions.map(p => {
        const existingGrant = existing.permissions.find(ep => JSON.stringify(ep.permission) === JSON.stringify(p));
        return {
          permission: p,
          granted: existingGrant ? existingGrant.granted : false,
        };
      });

      const updatedPackage: InstalledAutomationPackage = {
        ...existing,
        version: manifest.version,
        source: targetSource,
        installedPath: installDir, // Re-enforce safety
        updatedAt: new Date().toISOString(),
        permissions,
        validationStatus: "valid",
        validationErrors: [],
        workflows: manifest.workflows ?? [],
        helpers: manifest.helpers ?? [],
        evals: manifest.evals ?? [],
      };

      const registry = this.list();
      const idx = registry.findIndex(p => p.name === packageName);
      registry[idx] = updatedPackage;
      this.saveRegistry(registry);

      fs.rmSync(backupDir, { recursive: true, force: true });
      return { success: true, package: updatedPackage };
    } catch (err) {
      fs.rmSync(installDir, { recursive: true, force: true });
      if (fs.existsSync(backupDir)) {
        fs.renameSync(backupDir, installDir);
      }
      return { success: false, error: `Update failed: ${(err as Error).message}` };
    }
  }

  /**
   * Remove a package.
   */
  remove(packageName: string): { success: boolean; error?: string } {
    if (!PACKAGE_NAME_REGEX.test(packageName)) {
      return { success: false, error: `Invalid package name: ${packageName}` };
    }

    const existing = this.get(packageName);
    if (!existing) {
      return { success: false, error: `Package not found: ${packageName}` };
    }

    const expectedDir = safeInstalledDir(packageName, this.dataHome);
    if (fs.existsSync(expectedDir)) {
      fs.rmSync(expectedDir, { recursive: true, force: true });
    }

    const registry = this.list().filter(p => p.name !== packageName);
    this.saveRegistry(registry);

    return { success: true };
  }

  /**
   * Grant a permission for a package.
   */
  grantPermission(packageName: string, permissionRef: string | number): { success: boolean; error?: string } {
    if (!PACKAGE_NAME_REGEX.test(packageName)) {
      return { success: false, error: `Invalid package name: ${packageName}` };
    }

    const registry = this.list();
    const pkg = registry.find(p => p.name === packageName);
    if (!pkg) return { success: false, error: "Package not found" };

    const index = typeof permissionRef === "number"
      ? permissionRef
      : Number.isInteger(Number(permissionRef))
        ? Number(permissionRef)
        : -1;

    if (index >= 0) {
      if (!pkg.permissions[index]) {
        return { success: false, error: `Permission index ${index} not found` };
      }
      pkg.permissions[index].granted = true;
      this.saveRegistry(registry);
      return { success: true };
    }

    const matches = pkg.permissions
      .map((decision, idx) => ({ decision, idx }))
      .filter(item => item.decision.permission.kind === permissionRef);

    if (matches.length === 0) {
      return { success: false, error: `Permission kind ${permissionRef} not found in manifest` };
    }
    if (matches.length > 1) {
      return { success: false, error: `Permission kind ${permissionRef} is ambiguous; grant by permission index` };
    }

    pkg.permissions[matches[0].idx].granted = true;
    this.saveRegistry(registry);
    return { success: true };
  }

  /**
   * Check if a package has a specific permission granted.
   */
  checkPermission(packageName: string, kind: string): boolean {
    if (!PACKAGE_NAME_REGEX.test(packageName)) return false;
    const pkg = this.get(packageName);
    if (!pkg) return false;
    return pkg.permissions.some(p => p.permission.kind === kind && p.granted);
  }

  /**
   * Record eval results
   */
  updateEvalSummary(packageName: string, summary: import("./types").PackageEvalSummary): void {
    const registry = this.list();
    const idx = registry.findIndex(p => p.name === packageName);
    if (idx >= 0) {
      registry[idx].lastEvalResult = summary;
      this.saveRegistry(registry);
    }
  }

  public saveRegistry(packages: InstalledAutomationPackage[]): void {
    ensurePackagesDir(this.dataHome);
    fs.writeFileSync(getPackageRegistryPath(this.dataHome), JSON.stringify(packages, null, 2), "utf8");
  }

  /**
   * Submit a trust review for a package with risk analysis.
   */
  submitReview(
    packageName: string,
    status: import("./types").TrustReviewStatus,
    reviewedBy: string,
    reason?: string,
  ): { success: boolean; record?: TrustReviewRecord; error?: string } {
    if (!PACKAGE_NAME_REGEX.test(packageName)) {
      return { success: false, error: `Invalid package name: ${packageName}` };
    }
    const pkg = this.get(packageName);
    if (!pkg) return { success: false, error: "Package not found" };

    const installDir = pkg.installedPath;
    let digestResult;
    let fileEntries: import("./types").PackageFileEntry[] = [];
    try {
      digestResult = computePackageDigest(installDir);
      fileEntries = digestResult.files;
    } catch {
      // Digest computation may fail if files are missing
    }

    // Generate risk summary based on requested permissions and provenance.
    // Reviews happen before grants, so requested capability is the risk signal.
    const warnings: string[] = [];
    let riskLevel: "low" | "medium" | "high" | "critical" = "low";
    const raiseRisk = (next: typeof riskLevel) => {
      const rank = { low: 0, medium: 1, high: 2, critical: 3 };
      if (rank[next] > rank[riskLevel]) riskLevel = next;
    };

    if (pkg.permissions.some(p => p.permission.kind === "terminal")) {
      warnings.push("Terminal access requested");
      raiseRisk("medium");
    }
    if (
      pkg.permissions.some(
        p =>
          p.permission.kind === "filesystem" &&
          ((p.permission as import("./types").FilesystemPermission).access ===
            "write" ||
            (p.permission as import("./types").FilesystemPermission).access ===
              "read-write"),
      )
    ) {
      warnings.push("Filesystem write access requested");
      raiseRisk("high");
    }
    if (pkg.permissions.some(p => p.permission.kind === "helper")) {
      warnings.push("Helper execution requested");
      raiseRisk("medium");
    }
    if (!pkg.signer && !digestResult) {
      warnings.push("No signer or digest available");
      raiseRisk("high");
    }

    const record: TrustReviewRecord = {
      id: `review-${Date.now()}-${packageName}`,
      packageName,
      version: pkg.version,
      status,
      reviewedAt: new Date().toISOString(),
      reviewedBy,
      riskSummary: {
        riskLevel,
        warnings,
        details: `Review of ${packageName}@${pkg.version}. ${reason ?? "No additional notes."}`,
      },
      permissions: pkg.permissions,
      files: fileEntries.slice(0, 100), // Cap file list for display
      digest: digestResult?.digest ?? "",
      decisionAudit: [{ action: `review:${status}`, timestamp: new Date().toISOString(), by: reviewedBy, reason }],
    };

    // Persist review record
    this.saveReviewRecord(record);

    // Update package trust status
    const registry = this.list();
    const idx = registry.findIndex(p => p.name === packageName);
    if (idx >= 0) {
      registry[idx].trustStatus = status;
      registry[idx].signer = registry[idx].signer || (status === "approved" ? "manual-review" : undefined);
      this.saveRegistry(registry);
    }

    return { success: true, record };
  }

  /**
   * Get trust review history for a package.
   */
  getReviewHistory(packageName: string): TrustReviewRecord[] {
    if (!PACKAGE_NAME_REGEX.test(packageName)) return [];
    const reviewPath = this.getReviewHistoryPath(packageName);
    if (!fs.existsSync(reviewPath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /**
   * Get eval history records.
   */
  getEvalHistory(packageName?: string): PackageEvalRecord[] {
    const evalPath = this.getEvalHistoryPath();
    if (!fs.existsSync(evalPath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(evalPath, "utf8"));
      const records: PackageEvalRecord[] = Array.isArray(data) ? data : [];
      return packageName ? records.filter(r => r.packageName === packageName) : records;
    } catch {
      return [];
    }
  }

  /**
   * Record an eval run in history.
   */
  recordEvalRun(record: PackageEvalRecord): void {
    const evalPath = this.getEvalHistoryPath();
    let records: PackageEvalRecord[] = [];
    if (fs.existsSync(evalPath)) {
      try { records = JSON.parse(fs.readFileSync(evalPath, "utf8")); } catch { /* ignore */ }
    }
    records.unshift(record);
    // Keep last 100 records
    if (records.length > 100) records = records.slice(0, 100);
    fs.mkdirSync(path.dirname(evalPath), { recursive: true });
    fs.writeFileSync(evalPath, JSON.stringify(records, null, 2), "utf8");
  }

  private getReviewHistoryPath(packageName: string): string {
    return path.join(getPackagesDir(this.dataHome), "reviews", `${packageName}.json`);
  }

  private getEvalHistoryPath(): string {
    return path.join(getPackagesDir(this.dataHome), "eval-history.json");
  }

  private saveReviewRecord(record: TrustReviewRecord): void {
    const reviewPath = this.getReviewHistoryPath(record.packageName);
    let history: TrustReviewRecord[] = [];
    if (fs.existsSync(reviewPath)) {
      try { history = JSON.parse(fs.readFileSync(reviewPath, "utf8")); } catch { /* ignore */ }
    }
    history.unshift(record);
    if (history.length > 50) history = history.slice(0, 50);
    fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
    fs.writeFileSync(reviewPath, JSON.stringify(history, null, 2), "utf8");
  }

  private copyDirectorySafely(src: string, dest: string, state = { count: 0, size: 0 }): void {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "src") {
        continue;
      }
      
      if (entry.isSymbolicLink()) {
        continue;
      }

      state.count++;
      if (state.count > MAX_PACKAGE_FILES) {
        throw new Error(`Package exceeds file count limit of ${MAX_PACKAGE_FILES}`);
      }

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyDirectorySafely(srcPath, destPath, state);
      } else if (entry.isFile()) {
        const stat = fs.statSync(srcPath);
        state.size += stat.size;
        if (state.size > MAX_PACKAGE_SIZE_BYTES) {
           throw new Error(`Package exceeds size limit of ${MAX_PACKAGE_SIZE_BYTES} bytes`);
        }
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
