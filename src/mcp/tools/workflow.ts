/**
 * MCP Workflow & Harness Tools — Section 29
 *
 * Exposes workflow and harness operations as MCP tools.
 * All tools return ActionResult-shaped responses.
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema, sessionIdSchema } from "../types";

function useRequestedSession(api: BrowserControlAPI, params: Record<string, unknown>): void {
  if (params.sessionId) api.session.use(params.sessionId as string);
}

export function buildWorkflowTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_workflow_run",
      description: "Start a workflow from a graph definition (JSON). Returns the workflow run state.",
      inputSchema: buildSchema({
        graph: { type: "string", description: "JSON-encoded workflow graph definition" },
        sessionId: sessionIdSchema,
      }, ["graph"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.workflow.run(params.graph as string);
      },
    },
    {
      name: "bc_workflow_status",
      description: "Get the status of a workflow run by run ID.",
      inputSchema: buildSchema({
        runId: { type: "string", description: "Workflow run ID" },
        sessionId: sessionIdSchema,
      }, ["runId"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.workflow.status(params.runId as string);
      },
    },
    {
      name: "bc_workflow_resume",
      description: "Resume a paused or failed workflow run.",
      inputSchema: buildSchema({
        runId: { type: "string", description: "Workflow run ID to resume" },
        sessionId: sessionIdSchema,
      }, ["runId"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.workflow.resume(params.runId as string);
      },
    },
    {
      name: "bc_workflow_approve",
      description: "Approve a paused workflow node and continue the workflow run.",
      inputSchema: buildSchema({
        runId: { type: "string", description: "Workflow run ID to approve" },
        nodeId: { type: "string", description: "Paused approval node ID" },
        sessionId: sessionIdSchema,
      }, ["runId", "nodeId"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.workflow.approve(params.runId as string, params.nodeId as string);
      },
    },
    {
      name: "bc_workflow_cancel",
      description: "Cancel a workflow run.",
      inputSchema: buildSchema({
        runId: { type: "string", description: "Workflow run ID to cancel" },
        sessionId: sessionIdSchema,
      }, ["runId"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.workflow.cancel(params.runId as string);
      },
    },
    {
      name: "bc_harness_list",
      description: "List registered self-healing helpers.",
      inputSchema: buildSchema({
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.harness.list();
      },
    },
    {
      name: "bc_harness_find_helper",
      description: "Find registered helpers matching domain, task tag, or failure type.",
      inputSchema: buildSchema({
        domain: { type: "string", description: "Domain to match helpers against" },
        taskTag: { type: "string", description: "Task tag to match" },
        failureType: { type: "string", description: "Failure type to match" },
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.harness.find({
          domain: params.domain as string | undefined,
          taskTag: params.taskTag as string | undefined,
          failureType: params.failureType as string | undefined,
        });
      },
    },
    {
      name: "bc_harness_validate_helper",
      description: "Validate a registered helper by ID. Returns validation checks and status.",
      inputSchema: buildSchema({
        helperId: { type: "string", description: "Helper ID to validate" },
        sessionId: sessionIdSchema,
      }, ["helperId"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.harness.validate(params.helperId as string);
      },
    },
    {
      name: "bc_harness_rollback",
      description: "Rollback a registered helper to a previous version.",
      inputSchema: buildSchema({
        helperId: { type: "string", description: "Helper ID to rollback" },
        version: { type: "string", description: "Version to rollback to" },
        sessionId: sessionIdSchema,
      }, ["helperId", "version"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.harness.rollback(params.helperId as string, params.version as string);
      },
    },
  ];
}
