import fs from "node:fs";
import path from "node:path";
import { PackageRegistry } from "./registry";
import { WorkflowRuntime } from "../workflows/runtime";
import type { MemoryStore } from "../runtime/memory_store";
import type { WorkflowGraph } from "../workflows/types";
import { failureResult } from "../shared/action_result";
import type { ActionResult } from "../shared/action_result";
import { safeResolveRelativePath } from "./manifest";
import type { InstalledAutomationPackage, PackagePermissionDecision } from "./types";

function isWithinAllowedPath(rawPath: string, allowedPath: string): boolean {
  const resolvedPath = path.resolve(rawPath);
  const resolvedAllowed = path.resolve(allowedPath);
  const relative = path.relative(resolvedAllowed, resolvedPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class PackageRunner {
  constructor(
    private readonly registry: PackageRegistry,
    private readonly memoryStore: MemoryStore,
    private readonly sessionId: string,
    private readonly runtime: WorkflowRuntime
  ) {}

  async runWorkflow(
    packageName: string,
    workflowNameOrId: string,
    options: { maxNodeTimeoutMs?: number } = {},
  ): Promise<ActionResult> {
    const pkg = this.registry.get(packageName);
    if (!pkg) {
      return failureResult(`Package not found: ${packageName}`, { path: "command", sessionId: this.sessionId });
    }

    if (!pkg.enabled || pkg.validationStatus !== "valid") {
      return failureResult(`Package ${packageName} is not enabled or valid`, { path: "command", sessionId: this.sessionId });
    }

    let targetWorkflowPath: string | null = null;

    // Try to find matching workflow
    for (const relPath of pkg.workflows) {
      try {
        const fullPath = safeResolveRelativePath(pkg.installedPath, relPath);
        if (fs.existsSync(fullPath)) {
          const content = JSON.parse(fs.readFileSync(fullPath, "utf8")) as WorkflowGraph;
          if (content.id === workflowNameOrId || content.name === workflowNameOrId) {
            targetWorkflowPath = fullPath;
            break;
          }
        }
      } catch {
        // ignore errors during search
      }
    }

    if (!targetWorkflowPath) {
      // Check if it's a direct path
      const directMatch = pkg.workflows.find(w => w === workflowNameOrId);
      if (directMatch) {
        try {
          targetWorkflowPath = safeResolveRelativePath(pkg.installedPath, directMatch);
        } catch {
          // ignore
        }
      }
    }

    if (!targetWorkflowPath || !fs.existsSync(targetWorkflowPath)) {
      return failureResult(`Workflow ${workflowNameOrId} not found in package ${packageName}`, { path: "command", sessionId: this.sessionId });
    }

    let graph: WorkflowGraph;
    try {
      graph = JSON.parse(fs.readFileSync(targetWorkflowPath, "utf8"));
    } catch (err) {
      return failureResult(`Failed to parse workflow file: ${(err as Error).message}`, { path: "command", sessionId: this.sessionId });
    }

    if (options.maxNodeTimeoutMs !== undefined) {
      graph = this.applyExecutionBounds(graph, options.maxNodeTimeoutMs);
    }

    // ENFORCE PERMISSIONS
    const permissionErrors = this.checkPermissions(pkg, graph);
    if (permissionErrors.length > 0) {
      return failureResult(`Permission denied for package ${packageName}: ${permissionErrors.join("; ")}`, {
        path: "command",
        sessionId: this.sessionId
      });
    }

    return this.runtime.run(graph);
  }

  private applyExecutionBounds(graph: WorkflowGraph, maxNodeTimeoutMs: number): WorkflowGraph {
    const boundedTimeout = Math.max(1, Math.min(maxNodeTimeoutMs, 600000));
    return {
      ...graph,
      nodes: graph.nodes.map(node => ({
        ...node,
        timeoutMs: node.timeoutMs === undefined ? boundedTimeout : Math.min(node.timeoutMs, boundedTimeout),
        input: node.kind === "wait" && Number(node.input.ms) > boundedTimeout
          ? { ...node.input, ms: boundedTimeout }
          : node.input,
      })),
    };
  }

  private checkPermissions(pkg: InstalledAutomationPackage, graph: WorkflowGraph): string[] {
    const errors: string[] = [];

    for (const node of graph.nodes) {
      const granted = this.findGrantedPermission(pkg.permissions, node);
      if (!granted) {
        const permissionKind = this.mapNodeKindToPermission(node.kind);
        if (permissionKind) {
          errors.push(`Node "${node.id}" requires granted "${permissionKind}" permission`);
        }
      }
    }

    return errors;
  }

  private findGrantedPermission(permissions: PackagePermissionDecision[], node: WorkflowGraph["nodes"][number]): PackagePermissionDecision | null {
    const candidates = permissions.filter(p => p.granted);
    switch (node.kind) {
      case "terminal": {
        const command = String(node.input.command ?? "").trim();
        if (/[;&|<>`]/.test(command) || command.includes("$(")) {
          return null;
        }
        return candidates.find(p => {
          if (p.permission.kind !== "terminal") return false;
          return p.permission.commands.some(allowed => command === allowed || command.startsWith(`${allowed} `));
        }) ?? null;
      }
      case "browser": {
        const rawUrl = typeof node.input.url === "string" ? node.input.url : undefined;
        if (!rawUrl) return candidates.find(p => p.permission.kind === "browser") ?? null;
        let hostname = "";
        try {
          hostname = new URL(rawUrl).hostname.toLowerCase();
        } catch {
          return null;
        }
        return candidates.find(p => {
          if (p.permission.kind !== "browser") return false;
          return p.permission.domains.some(domain => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`));
        }) ?? null;
      }
      case "filesystem": {
        const rawPath = typeof node.input.path === "string" ? node.input.path : undefined;
        const op = String(node.input.operation ?? node.input.action ?? "read");
        return candidates.find(p => {
          if (p.permission.kind !== "filesystem") return false;
          const accessAllowed = op.includes("write")
            ? p.permission.access === "write" || p.permission.access === "read-write"
            : p.permission.access === "read" || p.permission.access === "read-write";
          if (!accessAllowed) return false;
          if (!rawPath) return true;
          return p.permission.paths.some(allowed => isWithinAllowedPath(rawPath, allowed));
        }) ?? null;
      }
      case "helper": {
        const helperId = typeof node.input.helperId === "string" ? node.input.helperId : "";
        return candidates.find(p => p.permission.kind === "helper" && p.permission.helperIds.includes(helperId)) ?? null;
      }
      default:
        return null;
    }
  }

  private mapNodeKindToPermission(kind: string): string | null {
    switch (kind) {
      case "terminal": return "terminal";
      case "browser": return "browser";
      case "filesystem": return "filesystem";
      case "helper": return "helper";
      default: return null;
    }
  }
}
