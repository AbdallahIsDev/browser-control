import type { McpTool } from "../types";
import { buildSchema } from "../types";
import type { BrowserControlAPI } from "../../browser_control";

export function buildPackageTools(api: BrowserControlAPI): McpTool[] {
  return [
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
  ];
}
