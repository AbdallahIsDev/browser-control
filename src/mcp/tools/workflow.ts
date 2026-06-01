/**
 * MCP Workflow & Harness Tools
 *
 * Exposes workflow and harness operations as MCP tools.
 * All tools return ActionResult-shaped responses.
 */

import type { BrowserControlAPI } from "../../browser_control";
import { failureResult } from "../../shared/action_result";
import type { McpTool } from "../types";
import { buildSchema, sessionIdSchema } from "../types";

function useRequestedSession(api: BrowserControlAPI, params: Record<string, unknown>): void {
  if (params.sessionId) api.session.use(params.sessionId as string);
}

function parseWorkflowStateValue(rawValue: string, valueType: string | undefined): string | number | boolean {
  switch (valueType ?? "string") {
    case "string":
      return rawValue;
    case "number": {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) {
        throw new Error("valueType 'number' requires a finite numeric value.");
      }
      return value;
    }
    case "boolean":
      if (rawValue === "true") return true;
      if (rawValue === "false") return false;
      throw new Error("valueType 'boolean' requires value to be 'true' or 'false'.");
    default:
      throw new Error("valueType must be one of: string, number, boolean.");
  }
}

function getCurrentSessionId(api: BrowserControlAPI): string {
  const status = api.session.status();
  return status.sessionId || "default";
}

function parseHarnessFiles(rawFiles: string): Array<{ path: string; content: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawFiles);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid files JSON: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("files must be a JSON array of {path, content} objects.");
  }
  for (const [index, file] of parsed.entries()) {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof (file as { path?: unknown }).path !== "string" ||
      typeof (file as { content?: unknown }).content !== "string"
    ) {
      throw new Error(`files[${index}] must include string path and content fields.`);
    }
  }
  return parsed as Array<{ path: string; content: string }>;
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
        approvedBy: { type: "string", description: "User who approved" },
        sessionId: sessionIdSchema,
      }, ["runId", "nodeId"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.workflow.approve(params.runId as string, params.nodeId as string, params.approvedBy as string | undefined);
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
      name: "bc_workflow_events",
      description: "Get the event stream for a workflow run.",
      inputSchema: buildSchema({
        runId: { type: "string", description: "Workflow run ID" },
        sessionId: sessionIdSchema,
      }, ["runId"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.workflow.events(params.runId as string);
      },
    },
    {
      name: "bc_workflow_edit_state",
      description: "Edit a workflow run's state value.",
      inputSchema: buildSchema({
        runId: { type: "string", description: "Workflow run ID" },
        key: { type: "string", description: "State key to edit" },
        value: { type: "string", description: "New state value. Stored as a string unless valueType is set." },
        valueType: { type: "string", enum: ["string", "number", "boolean"], default: "string", description: "How to interpret value. Defaults to string to avoid corrupting numeric-looking IDs." },
        sessionId: sessionIdSchema,
      }, ["runId", "key", "value"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        const rawValue = params.value as string;
        const value = parseWorkflowStateValue(rawValue, params.valueType as string | undefined);
        return api.workflow.editState(
          params.runId as string,
          params.key as string,
          value,
        );
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
    {
      name: "bc_harness_generate",
      description: "Generate a self-healing helper. Writes files under data home, validates in sandbox, and optionally activates.",
      inputSchema: buildSchema({
        id: { type: "string", description: "Helper ID" },
        purpose: { type: "string", description: "Helper purpose description" },
        files: { type: "string", description: "JSON array of {path, content} file objects" },
        taskTags: { type: "string", description: "Comma-separated task tags" },
        failureTypes: { type: "string", description: "Comma-separated failure types" },
        site: { type: "string", description: "Site name" },
        domains: { type: "string", description: "Comma-separated domains" },
        usage: { type: "string", description: "Usage instructions" },
        version: { type: "string", description: "Version string" },
        testCommand: { type: "string", description: "Sandbox test command" },
        activate: { type: "boolean", description: "Auto-activate after validation" },
        sessionId: sessionIdSchema,
      }, ["id", "purpose", "files"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        let files: Array<{ path: string; content: string }>;
        try {
          files = parseHarnessFiles(params.files as string);
        } catch (error: unknown) {
          return failureResult(error instanceof Error ? error.message : String(error), {
            path: "a11y",
            sessionId: getCurrentSessionId(api),
          });
        }
        return api.harness.generate({
          id: params.id as string,
          purpose: params.purpose as string,
          files,
          taskTags: (params.taskTags as string | undefined)?.split(",").filter(Boolean),
          failureTypes: (params.failureTypes as string | undefined)?.split(",").filter(Boolean),
          site: params.site as string | undefined,
          domains: (params.domains as string | undefined)?.split(",").filter(Boolean),
          usage: params.usage as string | undefined,
          version: params.version as string | undefined,
          testCommand: params.testCommand as string | undefined,
          activate: params.activate as boolean | undefined,
        });
      },
    },
    {
      name: "bc_harness_execute",
      description: "Execute a registered helper. Requires helper to be active and validated.",
      inputSchema: buildSchema({
        helperId: { type: "string", description: "Helper ID to execute" },
        input: { type: "object", description: "Input parameters for the helper" },
        sessionId: sessionIdSchema,
      }, ["helperId"]),
      handler: async (params) => {
        useRequestedSession(api, params);
        return api.harness.execute(
          params.helperId as string,
          params.input as Record<string, unknown> | undefined,
        );
      },
    },
  ];
}
