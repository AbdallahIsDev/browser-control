import type { BrowserControlAPI } from "../../browser_control";
import { CredentialVault } from "../../security/credential_vault";
import { NetworkRuleEngine } from "../../security/network_rules";
import { successResult } from "../../shared/action_result";
import { buildSchema, type McpTool } from "../types";

export function buildSecurityTools(api: BrowserControlAPI): McpTool[] {
	return [
		{
			name: "bc_vault_list",
			description:
				"List credential vault entries without secret values. Raw secrets are never returned.",
			inputSchema: buildSchema({}),
			handler: async () => {
				const vault = new CredentialVault(api.state);
				return successResult(await vault.list(), {
					path: "command",
					sessionId: "system",
				});
			},
		},
		{
			name: "bc_network_rules_list",
			description:
				"List privacy network rules, including user rules and built-in tracker rules.",
			inputSchema: buildSchema({}),
			handler: async () => {
				const engine = new NetworkRuleEngine(api.state);
				return successResult(await engine.listRules(), {
					path: "command",
					sessionId: "system",
				});
			},
		},
		{
			name: "bc_network_blocked_requests",
			description:
				"List recent blocked/aborted network request evidence for a session.",
			inputSchema: buildSchema({
				sessionId: {
					type: "string",
					description: "Session ID. Default: default.",
					default: "default",
				},
			}),
			handler: async (params) => {
				const sessionId =
					typeof params.sessionId === "string" ? params.sessionId : "default";
				const entries = api.debug.network({ sessionId }).filter((entry) => {
					const status = (entry as { status?: number | string }).status;
					const errorText = String((entry as { error?: unknown }).error ?? "");
					return status === 0 || /blocked|abort|deny/iu.test(errorText);
				});
				return successResult(entries, {
					path: "command",
					sessionId,
				});
			},
		},
	];
}
