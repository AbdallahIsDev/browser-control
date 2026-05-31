import type { McpTool } from "../types";
import { buildSchema, sessionIdSchema } from "../types";
import type { BrowserControlAPI } from "../../browser_control";

function useSession(api: BrowserControlAPI, args: Record<string, unknown>): void {
  if (args.sessionId) api.session.use(args.sessionId as string);
}

export function buildPackageTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_package_install",
      description: "Install an automation package from a local directory",
      inputSchema: buildSchema({
        source: { type: "string", description: "Local package directory path to install." },
        sessionId: sessionIdSchema,
      }, ["source"]),
      handler: async (args) => {
        useSession(api, args);
        const { source } = args as { source: string };
        return api.package.install(source);
      },
    },
    {
      name: "bc_package_list",
      description: "List installed automation packages",
      inputSchema: buildSchema({
        sessionId: sessionIdSchema,
      }),
      handler: async (args) => {
        useSession(api, args);
        return api.package.list();
      },
    },
    {
      name: "bc_package_info",
      description: "Get info about an installed automation package",
      inputSchema: buildSchema({
        name: { type: "string", description: "Installed package name." },
        sessionId: sessionIdSchema,
      }, ["name"]),
      handler: async (args) => {
        useSession(api, args);
        const { name } = args as { name: string };
        return api.package.info(name);
      },
    },
    {
      name: "bc_package_run",
      description: "Run a workflow from an installed package. If workflowNameOrId is omitted, the package must declare exactly one workflow.",
      inputSchema: buildSchema({
        name: { type: "string", description: "Installed package name." },
        workflowNameOrId: { type: "string", description: "Workflow id, name, or manifest path. Optional only for single-workflow packages." },
        sessionId: sessionIdSchema,
      }, ["name"]),
      handler: async (args) => {
        useSession(api, args);
        const { name, workflowNameOrId } = args as { name: string; workflowNameOrId?: string };
        return api.package.run(name, workflowNameOrId);
      },
    },
    {
      name: "bc_package_remove",
      description: "Remove an installed automation package",
      inputSchema: buildSchema({
        name: { type: "string", description: "Installed package name to remove." },
        sessionId: sessionIdSchema,
      }, ["name"]),
      handler: async (args) => {
        useSession(api, args);
        const { name } = args as { name: string };
        return api.package.remove(name);
      },
    },
    {
      name: "bc_package_update",
      description: "Update an installed automation package from its source or a provided local directory",
      inputSchema: buildSchema({
        name: { type: "string", description: "Installed package name to update." },
        source: { type: "string", description: "Optional local package directory path to update from." },
        sessionId: sessionIdSchema,
      }, ["name"]),
      handler: async (args) => {
        useSession(api, args);
        const { name, source } = args as { name: string; source?: string };
        return api.package.update(name, source);
      },
    },
    {
      name: "bc_package_grant",
      description: "Grant a declared automation package permission by kind or index",
      inputSchema: buildSchema({
        name: { type: "string", description: "Installed package name." },
        permissionRef: { type: "string", description: "Permission kind or numeric permission index to grant." },
        sessionId: sessionIdSchema,
      }, ["name", "permissionRef"]),
      handler: async (args) => {
        useSession(api, args);
        const { name, permissionRef } = args as { name: string; permissionRef: string };
        return api.package.grantPermission(name, permissionRef);
      },
    },
    {
      name: "bc_package_eval",
      description: "Evaluate an installed automation package",
      inputSchema: buildSchema({
        name: { type: "string", description: "Installed package name to evaluate." },
        sessionId: sessionIdSchema,
      }, ["name"]),
      handler: async (args) => {
        useSession(api, args);
        const { name } = args as { name: string };
        return api.package.eval(name);
      },
    },
    {
      name: "bc_package_review",
      description: "Record a trust review decision for an installed automation package",
      inputSchema: buildSchema({
        name: { type: "string", description: "Installed package name to review." },
        status: { type: "string", enum: ["unreviewed", "pending", "approved", "rejected"], description: "Trust review status to record." },
        reviewedBy: { type: "string", description: "Reviewer identifier recorded in review history." },
        reason: { type: "string", description: "Optional review rationale." },
        sessionId: sessionIdSchema,
      }, ["name", "status", "reviewedBy"]),
      handler: async (args) => {
        useSession(api, args);
        const { name, status, reviewedBy, reason } = args as {
          name: string;
          status: "unreviewed" | "pending" | "approved" | "rejected";
          reviewedBy: string;
          reason?: string;
        };
        return api.package.review(name, status, reviewedBy, reason);
      },
    },
    {
      name: "bc_package_review_history",
      description: "List trust review history for an installed automation package",
      inputSchema: buildSchema({
        name: { type: "string", description: "Installed package name." },
        sessionId: sessionIdSchema,
      }, ["name"]),
      handler: async (args) => {
        useSession(api, args);
        const { name } = args as { name: string };
        return api.package.reviewHistory(name);
      },
    },
    {
      name: "bc_package_eval_history",
      description: "List package evaluation history",
      inputSchema: buildSchema({
        name: { type: "string", description: "Optional installed package name to filter evaluation history." },
        sessionId: sessionIdSchema,
      }),
      handler: async (args) => {
        useSession(api, args);
        const { name } = args as { name?: string };
        return api.package.evalHistory(name);
      },
    },
  ];
}
