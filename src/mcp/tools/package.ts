import type { McpTool } from "../types";
import { buildSchema } from "../types";
import type { BrowserControlAPI } from "../../browser_control";

export function buildPackageTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_package_install",
      description: "Install an automation package from a local directory",
      inputSchema: buildSchema({
        source: { type: "string" },
      }, ["source"]),
      handler: async (args) => {
        const { source } = args as { source: string };
        return api.package.install(source);
      },
    },
    {
      name: "bc_package_list",
      description: "List installed automation packages",
      inputSchema: buildSchema({}),
      handler: async () => {
        return api.package.list();
      },
    },
    {
      name: "bc_package_info",
      description: "Get info about an installed automation package",
      inputSchema: buildSchema({
        name: { type: "string" },
      }, ["name"]),
      handler: async (args) => {
        const { name } = args as { name: string };
        return api.package.info(name);
      },
    },
    {
      name: "bc_package_run",
      description: "Run a workflow from an installed package",
      inputSchema: buildSchema({
        name: { type: "string" },
        workflowNameOrId: { type: "string" },
      }, ["name", "workflowNameOrId"]),
      handler: async (args) => {
        const { name, workflowNameOrId } = args as { name: string; workflowNameOrId: string };
        return api.package.run(name, workflowNameOrId);
      },
    },
    {
      name: "bc_package_remove",
      description: "Remove an installed automation package",
      inputSchema: buildSchema({
        name: { type: "string" },
      }, ["name"]),
      handler: async (args) => {
        const { name } = args as { name: string };
        return api.package.remove(name);
      },
    },
    {
      name: "bc_package_update",
      description: "Update an installed automation package from its source or a provided local directory",
      inputSchema: buildSchema({
        name: { type: "string" },
        source: { type: "string" },
      }, ["name"]),
      handler: async (args) => {
        const { name, source } = args as { name: string; source?: string };
        return api.package.update(name, source);
      },
    },
    {
      name: "bc_package_grant",
      description: "Grant a declared automation package permission by kind or index",
      inputSchema: buildSchema({
        name: { type: "string" },
        permissionRef: { type: "string" },
      }, ["name", "permissionRef"]),
      handler: async (args) => {
        const { name, permissionRef } = args as { name: string; permissionRef: string };
        return api.package.grantPermission(name, permissionRef);
      },
    },
    {
      name: "bc_package_eval",
      description: "Evaluate an installed automation package",
      inputSchema: buildSchema({
        name: { type: "string" },
      }, ["name"]),
      handler: async (args) => {
        const { name } = args as { name: string };
        return api.package.eval(name);
      },
    },
    {
      name: "bc_package_review",
      description: "Record a trust review decision for an installed automation package",
      inputSchema: buildSchema({
        name: { type: "string" },
        status: { type: "string", enum: ["unreviewed", "pending", "approved", "rejected"] },
        reviewedBy: { type: "string" },
        reason: { type: "string" },
      }, ["name", "status", "reviewedBy"]),
      handler: async (args) => {
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
        name: { type: "string" },
      }, ["name"]),
      handler: async (args) => {
        const { name } = args as { name: string };
        return api.package.reviewHistory(name);
      },
    },
    {
      name: "bc_package_eval_history",
      description: "List package evaluation history",
      inputSchema: buildSchema({
        name: { type: "string" },
      }),
      handler: async (args) => {
        const { name } = args as { name?: string };
        return api.package.evalHistory(name);
      },
    },
  ];
}
