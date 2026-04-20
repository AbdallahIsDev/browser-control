import fs from "node:fs";
import path from "node:path";

import type { SkillManifest, SkillAction, ActionParam, ActionParamType } from "./skill";

// ── Minimal YAML Parser ─────────────────────────────────────────────
// Supports the flat + one-level-nested structure needed for skill.yaml:
//   - Top-level key-value pairs
//   - Lists of objects (e.g., `actions:` with `- name: ...` items)
//   - One level of nested list within a list item (e.g., `params:` under an action)
//   - Inline arrays (`[a, b, c]`), quoted strings, booleans, null, numbers
//
// Does NOT handle:
//   - Block scalars (|, > multi-line strings)
//   - Anchors (&/*) or merge keys (<<)
//   - Explicit type tags (!!str, !!int)
//   - Flow mappings inside lists
//   - More than one level of list nesting
//
// If you need any of the above, switch to a full YAML library (js-yaml).

function indentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function stripComment(value: string): string {
  // Remove inline comments (# ...) but preserve # inside quotes
  const result: string[] = [];
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (inQuote) {
      result.push(ch);
      if (ch === quoteChar) inQuote = false;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      result.push(ch);
    } else if (ch === "#") {
      break;
    } else {
      result.push(ch);
    }
  }
  return result.join("").trimEnd();
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Quoted string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  // Array [a, b, c]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => parseValue(s.trim()));
  }

  // Plain string
  return trimmed;
}

interface ListContext {
  listKey: string;
  list: unknown[];
  listItem: Record<string, unknown> | null;
  listItemIndent: number;
  parentObj: Record<string, unknown>;
}

export function parseSimpleYaml(text: string): Record<string, unknown> {
  const lines = text.split("\n");
  const root: Record<string, unknown> = {};
  const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [
    { obj: root, indent: -1 },
  ];

  // Stack of list contexts for nested lists (e.g., actions → params)
  const listStack: ListContext[] = [];

  // Track which empty-valued keys might start a list — we only create
  // a ListContext lazily when the first `- ` item appears.
  let pendingListKey: string | null = null;
  let pendingListParent: Record<string, unknown> | null = null;

  function currentListCtx(): ListContext | undefined {
    return listStack[listStack.length - 1];
  }

  for (const rawLine of lines) {
    const line = stripComment(rawLine);
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const indent = indentLevel(rawLine);
    const content = line.trim();

    // ── List item (`- key: value` or `- plain`) ─────────────────────
    if (content.startsWith("- ")) {
      const itemRaw = content.slice(2).trim();
      const colonIdx = itemRaw.indexOf(":");

      // Pop list contexts whose scope we've exited (indent strictly less than their items)
      // A new list item at the same indent as the previous one is a sibling, not an exit
      while (listStack.length > 0 && indent < (currentListCtx()?.listItemIndent ?? Infinity)) {
        const poppedCtx = listStack.pop()!;
        poppedCtx.parentObj[poppedCtx.listKey] = poppedCtx.list;
      }

      let ctx = currentListCtx();
      if (!ctx) {
        // No active list context — create one from the pending list key
        if (pendingListKey !== null && pendingListParent !== null) {
          ctx = { listKey: pendingListKey, list: [], listItem: null, listItemIndent: -1, parentObj: pendingListParent };
          listStack.push(ctx);
          pendingListKey = null;
          pendingListParent = null;
        } else {
          // Orphan list item with no parent key — attach to current stack top.
          // This handles malformed YAML where a `- ` item appears without a preceding
          // `key:` line. The list is stored under the synthetic key "_unnamed".
          const parent = stack[stack.length - 1].obj;
          ctx = { listKey: "_unnamed", list: [], listItem: null, listItemIndent: -1, parentObj: parent };
          listStack.push(ctx);
        }
      }

      // Starting a new list item — the previous one is complete
      ctx.listItem = null;

      if (colonIdx !== -1) {
        const itemKey = itemRaw.slice(0, colonIdx).trim();
        const itemValRaw = itemRaw.slice(colonIdx + 1).trim();
        const obj: Record<string, unknown> = {};
        if (itemValRaw !== "" && itemValRaw !== "|" && itemValRaw !== ">") {
          obj[itemKey] = parseValue(itemValRaw);
        }
        ctx.list.push(obj);
        ctx.listItem = obj;
        ctx.listItemIndent = indent;
      } else {
        ctx.list.push(parseValue(itemRaw));
        ctx.listItem = null;
      }
      continue;
    }

    // ── Key-value pair ───────────────────────────────────────────────
    const colonIdx = content.indexOf(":");
    if (colonIdx === -1) continue;

    const key = content.slice(0, colonIdx).trim();
    const valueRaw = content.slice(colonIdx + 1).trim();

    // Check if this line belongs to a current list item (multi-field list item)
    const ctx = currentListCtx();
    if (ctx && ctx.listItem !== null && indent > ctx.listItemIndent) {
      // This key-value belongs to the current list item object
      if (valueRaw === "" || valueRaw === "|" || valueRaw === ">") {
        // Start a sub-list (e.g., params: with nested items)
        ctx.listItem[key] = [];
        listStack.push({
          listKey: key,
          list: ctx.listItem[key] as unknown[],
          listItem: null,
          listItemIndent: -1,
          parentObj: ctx.listItem,
        });
      } else {
        ctx.listItem[key] = parseValue(valueRaw);
      }
      continue;
    }

    // Regular key-value — not part of a list item
    // Clear any pending list key since a non-list value follows
    pendingListKey = null;
    pendingListParent = null;

    // Pop list contexts that are above this indent (strictly less — same indent is still in scope)
    while (listStack.length > 0 && indent < (currentListCtx()?.listItemIndent ?? Infinity)) {
      const poppedCtx = listStack.pop()!;
      poppedCtx.parentObj[poppedCtx.listKey] = poppedCtx.list;
    }

    // Pop the object stack to find the right parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (valueRaw === "" || valueRaw === "|" || valueRaw === ">") {
      // Nested mapping or list follows — don't preemptively create a ListContext.
      // Instead, track the pending list key so we can create it lazily when
      // the first `- ` item appears.
      parent[key] = {};
      stack.push({ obj: parent[key] as Record<string, unknown>, indent });
      pendingListKey = key;
      pendingListParent = parent;  // Track the PARENT object, not parent[key]
    } else {
      parent[key] = parseValue(valueRaw);
    }
  }

  // Flush remaining list contexts
  while (listStack.length > 0) {
    const ctx = listStack.pop()!;
    ctx.parentObj[ctx.listKey] = ctx.list;
  }

  return root;
}

// ── Skill YAML to Manifest ──────────────────────────────────────────

interface YamlActionParam {
  name?: string;
  type?: string;
  required?: boolean;
  description?: string;
  default?: unknown;
}

interface YamlAction {
  name?: string;
  description?: string;
  params?: YamlActionParam[];
}

export interface SkillYaml {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  requiredEnv?: string[];
  allowedDomains?: string[];
  actions?: YamlAction[];
  requiresFreshPage?: boolean;
  configSchema?: string;
  entry?: string;
}

export function yamlToManifest(yaml: SkillYaml): SkillManifest {
  const actions: SkillAction[] = (yaml.actions ?? []).map((a) => ({
    name: a.name ?? "",
    description: a.description ?? "",
    params: (a.params ?? []).map((p) => ({
      name: p.name ?? "",
      type: (p.type ?? "string") as ActionParamType,
      required: p.required ?? false,
      ...(p.description ? { description: p.description } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
    })),
  }));

  return {
    name: yaml.name ?? "",
    version: yaml.version ?? "0.0.0",
    description: yaml.description ?? "",
    ...(yaml.author ? { author: yaml.author } : {}),
    requiredEnv: Array.isArray(yaml.requiredEnv)
      ? yaml.requiredEnv.map(String)
      : [],
    allowedDomains: Array.isArray(yaml.allowedDomains)
      ? yaml.allowedDomains.map(String)
      : [],
    ...(actions.length > 0 ? { actions } : {}),
    ...(yaml.requiresFreshPage ? { requiresFreshPage: true } : {}),
    ...(yaml.configSchema ? { configSchema: yaml.configSchema } : {}),
  };
}

// ── Packaged Skill Directory ────────────────────────────────────────

export interface PackagedSkillMeta {
  manifest: SkillManifest;
  entryPath: string;
  dirPath: string;
  hasConfigSchema: boolean;
}

export function loadPackagedSkillDir(dirPath: string): PackagedSkillMeta | null {
  const yamlPath = path.join(dirPath, "skill.yaml");
  if (!fs.existsSync(yamlPath)) {
    return null;
  }

  const yamlText = fs.readFileSync(yamlPath, "utf8");
  const parsed = parseSimpleYaml(yamlText) as SkillYaml;
  const manifest = yamlToManifest(parsed);

  const entryPath = parsed.entry
    ? path.join(dirPath, parsed.entry)
    : path.join(dirPath, "index.ts");

  // Check for config schema
  let hasConfigSchema = false;
  if (manifest.configSchema) {
    const schemaPath = path.join(dirPath, manifest.configSchema);
    hasConfigSchema = fs.existsSync(schemaPath);
  }

  return {
    manifest,
    entryPath,
    dirPath: path.resolve(dirPath),
    hasConfigSchema,
  };
}

export function isPackagedSkillDir(dirPath: string): boolean {
  return fs.existsSync(path.join(dirPath, "skill.yaml"));
}
