import { z } from "zod";
import type { ActionResult } from "../shared/action_result";
import { failureResult, confirmationRequiredResult } from "../shared/action_result";

const CommonProps = z.object({
  id: z.string().optional(),
  tone: z.enum(["primary", "secondary", "neutral", "danger", "success"]).optional(),
  size: z.enum(["small", "medium", "large"]).optional(),
  density: z.enum(["compact", "normal", "spacious"]).optional(),
}).strict();

const PanelPropsSchema = CommonProps.extend({
  title: z.string().optional(),
  collapsible: z.boolean().optional(),
}).strict();

const ButtonPropsSchema = CommonProps.extend({
  label: z.string(),
  actionId: z.string(),
  variant: z.enum(["primary", "secondary", "danger"]).optional(),
}).strict();

const LogPropsSchema = CommonProps.extend({
  content: z.string().optional(),
  follow: z.boolean().optional(),
}).strict();

const TablePropsSchema = CommonProps.extend({
  headers: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())).optional(),
}).strict();

const TextInputPropsSchema = CommonProps.extend({
  value: z.string().optional(),
  placeholder: z.string().optional(),
  bindTo: z.string().optional(),
}).strict();

const TogglePropsSchema = CommonProps.extend({
  checked: z.boolean().optional(),
  label: z.string().optional(),
  bindTo: z.string().optional(),
}).strict();

const FilePickerPropsSchema = CommonProps.extend({
  accept: z.string().optional(),
  bindTo: z.string().optional(),
}).strict();

const ArtifactViewerPropsSchema = CommonProps.extend({
  artifactId: z.string().optional(),
  kind: z.string().optional(),
}).strict();

// We need a recursive schema with depth limit
export interface JsonUiNode {
  type: "panel" | "log" | "button" | "toggle" | "textInput" | "filePicker" | "artifactViewer" | "table";
  props?: Record<string, unknown>;
  children?: JsonUiNode[];
}

type LazyNode = z.ZodType<JsonUiNode>;

export const MAX_CHILDREN_PER_NODE = 50;

const createComponentSchema = (maxDepth: number): LazyNode => {
  const childrenSchema = maxDepth > 0 ? z.lazy(() => z.array(createComponentSchema(maxDepth - 1)).max(MAX_CHILDREN_PER_NODE)).optional() : z.undefined();

  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("panel"), props: PanelPropsSchema.optional(), children: childrenSchema }).strict(),
    z.object({ type: z.literal("log"), props: LogPropsSchema.optional(), children: childrenSchema }).strict(),
    z.object({ type: z.literal("button"), props: ButtonPropsSchema.optional(), children: childrenSchema }).strict(),
    z.object({ type: z.literal("table"), props: TablePropsSchema.optional(), children: childrenSchema }).strict(),
    z.object({ type: z.literal("textInput"), props: TextInputPropsSchema.optional(), children: childrenSchema }).strict(),
    z.object({ type: z.literal("toggle"), props: TogglePropsSchema.optional(), children: childrenSchema }).strict(),
    z.object({ type: z.literal("filePicker"), props: FilePickerPropsSchema.optional(), children: childrenSchema }).strict(),
    z.object({ type: z.literal("artifactViewer"), props: ArtifactViewerPropsSchema.optional(), children: childrenSchema }).strict(),
  ]) as LazyNode;
};

export const JsonUiNodeSchema = createComponentSchema(10);

export const AutomationActionBindingSchema = z.object({
  description: z.string().optional(),
  requiresApproval: z.boolean().optional()
}).strict();

export type AutomationActionBinding = z.infer<typeof AutomationActionBindingSchema>;

export const AutomationUiSpecSchema = z.object({
  version: z.string(),
  packageName: z.string(),
  components: z.array(JsonUiNodeSchema).max(100),
  actions: z.record(AutomationActionBindingSchema),
  stateSchema: z.unknown().optional()
}).strict();

export type AutomationUiSpec = z.infer<typeof AutomationUiSpecSchema>;

export interface GeneratedUiActionResult {
  actionId: string;
  status: "completed" | "failed" | "requires-approval";
  message?: string;
  artifacts?: Array<{ kind: string; path: string }>;
}

/**
 * Validates a generated UI spec against the allowlisted schema.
 * Rejects unknown or unsafe component types, and cross-validates that component actions are declared.
 */
export function validateUiSpec(spec: unknown): AutomationUiSpec {
  const parsed = AutomationUiSpecSchema.parse(spec);
  
  // Recursively validate component actions
  const validateNodeActions = (node: JsonUiNode) => {
    if (node.type === "button" && node.props?.actionId) {
      if (!parsed.actions[node.props.actionId as string]) {
        throw new Error(`Button references undeclared actionId: ${node.props.actionId}`);
      }
    }
    if (node.children) {
      node.children.forEach(validateNodeActions);
    }
  };
  parsed.components.forEach(validateNodeActions);
  
  return parsed;
}

/**
 * Safe action routing foundation for generated UI actions.
 */
export async function dispatchUiAction(
  rawSpec: unknown,
  actionId: string,
  payload: unknown,
  handler: (actionId: string, binding: AutomationActionBinding, payload: unknown) => Promise<ActionResult>
): Promise<ActionResult> {
  let spec: AutomationUiSpec;
  try {
    spec = validateUiSpec(rawSpec);
  } catch (err) {
    return failureResult(`Invalid UI spec: ${(err as Error).message}`, {
      path: "command",
      sessionId: "system",
    });
  }

  const binding = spec.actions[actionId];
  if (!binding) {
    return failureResult(`Action ID '${actionId}' not declared in UI spec`, {
      path: "command",
      sessionId: "system",
    });
  }

  if (binding.requiresApproval) {
    return confirmationRequiredResult(`Action '${actionId}' requires human approval`, {
      path: "command",
      sessionId: "system",
    });
  }

  return handler(actionId, binding, payload);
}
