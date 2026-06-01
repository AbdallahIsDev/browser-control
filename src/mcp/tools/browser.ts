/**
 * MCP Browser Tools — Wrap the Browser Control browser action surface.
 *
 * Tools:
 *   - bc_browser_open
 *   - bc_browser_snapshot
 *   - bc_browser_click
 *   - bc_browser_fill
 *   - bc_browser_hover
 *   - bc_browser_type
 *   - bc_browser_paste
 *   - bc_browser_press
 *   - bc_browser_scroll
 *   - bc_browser_screenshot
 *   - bc_browser_tab_list
 *   - bc_browser_tab_switch
 *   - bc_browser_tab_close
 *   - bc_browser_close
 *   - bc_browser_launch
 *   - bc_browser_screencast_start
 *   - bc_browser_screencast_stop
 *   - bc_browser_screencast_status
 *
 * All tools use the existing BrowserActions methods and preserve ref-based
 * targeting and accessibility snapshot semantics.
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema, sessionIdSchema } from "../types";
import type { ToolParameterValidation } from "../types";
import type { ScreencastOptions } from "../../observability/types";

const BROWSER_TOOL_ALIASES: Record<string, string> = {
  bc_browser_open: "bc_open",
  bc_browser_open_many: "bc_open_many",
  bc_browser_navigate: "bc_navigate",
  bc_browser_capture: "bc_capture",
  bc_browser_capture_many: "bc_capture_many",
  bc_browser_snapshot: "bc_snapshot",
  bc_browser_click: "bc_click",
  bc_browser_fill: "bc_fill",
  bc_browser_fill_many: "bc_fill_many",
  bc_browser_hover: "bc_hover",
  bc_browser_type: "bc_type",
  bc_browser_paste: "bc_paste",
  bc_browser_press: "bc_press",
  bc_browser_scroll: "bc_scroll",
  bc_browser_screenshot: "bc_screenshot",
  bc_browser_highlight: "bc_highlight",
  bc_browser_generate_locator: "bc_generate_locator",
  bc_browser_tab_list: "bc_tab_list",
  bc_browser_tab_switch: "bc_tab_switch",
  bc_browser_tab_close: "bc_tab_close",
  bc_browser_close: "bc_close",
  bc_browser_screencast_start: "bc_screencast_start",
  bc_browser_screencast_stop: "bc_screencast_stop",
  bc_browser_screencast_status: "bc_screencast_status",
  bc_browser_list: "bc_list",
  bc_browser_attach: "bc_attach",
  bc_browser_detach: "bc_detach",
  bc_browser_launch: "bc_launch",
  bc_browser_drop: "bc_drop",
  bc_browser_downloads_list: "bc_downloads_list",
  bc_browser_dialog: "bc_dialog",
  bc_browser_cdp: "bc_cdp",
  bc_browser_state: "bc_state",
  bc_browser_act: "bc_act",
};

const WAIT_UNTIL_VALUES = ["load", "domcontentloaded", "networkidle", "commit"] as const;
const BROWSER_ACTION_VALUES = [
  "click",
  "fill",
  "press",
  "hover",
  "scroll",
  "type",
  "paste",
  "screenshot",
  "tab-close",
  "open",
  "navigate",
  "openMany",
  "capture",
  "captureMany",
  "fillMany",
  "state",
] as const;

function preferBcAct(description: string, action: typeof BROWSER_ACTION_VALUES[number]): string {
  return `${description} Deprecated single-action MCP tool; prefer \`bc_act\` with action="${action}" for lower token usage.`;
}

const WAIT_UNTIL_SCHEMA = {
  type: "string",
  description: "Navigation wait condition.",
  enum: [...WAIT_UNTIL_VALUES],
};

const URL_ENTRY_SCHEMA = {
  oneOf: [
    { type: "string" },
    {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open." },
        label: { type: "string", description: "Optional label for result correlation." },
        waitUntil: WAIT_UNTIL_SCHEMA,
      },
      required: ["url"],
    },
  ],
};

const URLS_SCHEMA = {
  type: "array",
  description: "Array of URLs or {url, label, waitUntil} objects for openMany/captureMany actions.",
  items: URL_ENTRY_SCHEMA,
};

const FILL_FIELD_SCHEMA = {
  type: "object",
  properties: {
    target: { type: "string", description: "Element ref or selector to fill." },
    text: { type: "string", description: "Text to type into the field." },
  },
  required: ["target", "text"],
};

const FIELDS_SCHEMA = {
  type: "array",
  description: "Fields for fillMany action. Each item requires target and text.",
  items: FILL_FIELD_SCHEMA,
};

const BROWSER_STEP_PROPERTIES = {
  action: {
    type: "string",
    description: "Step action: click, fill, press, hover, scroll, type, paste, screenshot, tab-close, open, navigate, openMany, capture, captureMany, fillMany, or state.",
    enum: [...BROWSER_ACTION_VALUES],
  },
  target: { type: "string", description: "Element ref or selector for click/fill/hover/type/paste/capture actions." },
  text: { type: "string", description: "Text for fill/type/paste actions." },
  key: { type: "string", description: "Keyboard key for press action." },
  timeoutMs: { type: "number", description: "Per-step timeout in milliseconds." },
  force: { type: "boolean", description: "Force click/fill-style action when supported." },
  commit: { type: "boolean", description: "Commit typed text with Enter when supported." },
  direction: { type: "string", description: "Scroll direction.", enum: ["up", "down", "left", "right"] },
  amount: { type: "number", description: "Scroll amount in pixels." },
  delayMs: { type: "number", description: "Delay between keystrokes in milliseconds." },
  tabId: { type: "string", description: "Optional browser tab ID." },
  copyTo: { type: "string", description: "Optional auxiliary screenshot copy destination. Primary save remains in Browser Control runtime." },
  url: { type: "string", description: "URL for open/navigate actions." },
  urls: URLS_SCHEMA,
  waitUntil: WAIT_UNTIL_SCHEMA,
  fields: FIELDS_SCHEMA,
  continueOnFailure: { type: "boolean", description: "Continue within fillMany after an individual field failure." },
  snapshot: { type: "boolean", description: "Include accessibility snapshot for capture/state steps." },
  screenshot: { type: "boolean", description: "Include screenshot for capture/state steps." },
  content: { type: "string", description: "Reserved for future filesystem-output steps." },
  filename: { type: "string", description: "Reserved output filename for future filesystem-output steps." },
};

const BROWSER_STEP_SCHEMA = {
  type: "object",
  description: "One deterministic browser task step. Use the matching fields for the selected action.",
  properties: BROWSER_STEP_PROPERTIES,
  required: ["action"],
  additionalProperties: false,
  oneOf: [
    { properties: { action: { const: "click" } }, required: ["action", "target"] },
    { properties: { action: { const: "fill" } }, required: ["action", "target", "text"] },
    { properties: { action: { const: "press" } }, required: ["action", "key"] },
    { properties: { action: { const: "hover" } }, required: ["action", "target"] },
    { properties: { action: { const: "scroll" } }, required: ["action", "direction"] },
    { properties: { action: { const: "type" } }, required: ["action", "text"] },
    { properties: { action: { const: "paste" } }, required: ["action", "text"] },
    { properties: { action: { const: "open" } }, required: ["action", "url"] },
    { properties: { action: { const: "navigate" } }, required: ["action", "url"] },
    { properties: { action: { const: "openMany" } }, required: ["action", "urls"] },
    { properties: { action: { const: "captureMany" } }, required: ["action", "urls"] },
    { properties: { action: { const: "fillMany" } }, required: ["action", "fields"] },
    { properties: { action: { const: "screenshot" } }, required: ["action"] },
    { properties: { action: { const: "tab-close" } }, required: ["action"] },
    { properties: { action: { const: "capture" } }, required: ["action"] },
    { properties: { action: { const: "state" } }, required: ["action"] },
  ],
} as any;

const BROWSER_ACT_VALIDATION: ToolParameterValidation = {
  forbiddenParameters: ["outputPath"],
  conditionalRequired: [
    { when: { parameter: "action", equals: "click" }, requires: ["target"] },
    { when: { parameter: "action", equals: "fill" }, requires: ["target", { parameter: "text", allowEmptyString: true }] },
    { when: { parameter: "action", equals: "press" }, requires: ["key"] },
    { when: { parameter: "action", equals: "hover" }, requires: ["target"] },
    { when: { parameter: "action", equals: "type" }, requires: [{ parameter: "text", allowEmptyString: true }] },
    { when: { parameter: "action", equals: "paste" }, requires: [{ parameter: "text", allowEmptyString: true }] },
    { when: { parameter: "action", equals: ["open", "navigate"] }, requires: ["url"] },
    { when: { parameter: "action", equals: "openMany" }, requires: [{ parameter: "urls", nonEmptyArray: true }] },
    { when: { parameter: "action", equals: "captureMany" }, requires: [{ parameter: "urls", nonEmptyArray: true }] },
    { when: { parameter: "action", equals: "fillMany" }, requires: [{ parameter: "fields", nonEmptyArray: true }] },
  ],
};

const BROWSER_TASK_RUN_VALIDATION: ToolParameterValidation = {
  arrayItems: {
    steps: BROWSER_ACT_VALIDATION,
  },
};

function withCanonicalNames(tools: McpTool[]): McpTool[] {
  return tools.map((tool) => {
    const alias = BROWSER_TOOL_ALIASES[tool.name];
    if (!alias) return tool;
    return {
      ...tool,
      name: alias,
      description: tool.description,
    };
  });
}

/**
 * Build browser MCP tools for a Browser Control instance.
 */
export function buildBrowserTools(api: BrowserControlAPI): McpTool[] {
  const tools: McpTool[] = [
    {
      name: "bc_browser_open",
      description: preferBcAct("Open a URL in the browser. If no browser is connected, attempts to attach to a running browser or launch a managed automation profile.", "open"),
      inputSchema: buildSchema({
        url: { type: "string", description: "URL to navigate to." },
        waitUntil: { type: "string", description: "Navigation wait condition: 'load', 'domcontentloaded', 'networkidle', or 'commit'. Default: 'domcontentloaded'.", enum: ["load", "domcontentloaded", "networkidle", "commit"], default: "domcontentloaded" },
        sessionId: sessionIdSchema,
      }, ["url"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.open({
          url: params.url as string,
          waitUntil: params.waitUntil as "load" | "domcontentloaded" | "networkidle" | "commit" | undefined,
        });
      },
    },

    {
      name: "bc_browser_open_many",
      description: preferBcAct("Open multiple URLs as tabs in the current browser session.", "openMany"),
      inputSchema: buildSchema({
        urls: { type: "array", description: "Array of URLs or { url, label, waitUntil } objects to open." },
        sessionId: sessionIdSchema,
      }, ["urls"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        const urls = params.urls as Array<string | { url: string; label?: string; waitUntil?: "domcontentloaded" | "load" | "networkidle" }>;
        return api.browser.openMany(urls.map((item) =>
          typeof item === "string" ? { url: item } : item,
        ));
      },
    },

    {
      name: "bc_browser_navigate",
      description: preferBcAct("Navigate the active or specified tab to a URL, replacing that tab.", "navigate"),
      inputSchema: buildSchema({
        url: { type: "string", description: "URL to navigate to." },
        waitUntil: { type: "string", description: "Navigation wait condition.", enum: ["load", "domcontentloaded", "networkidle", "commit"], default: "domcontentloaded" },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["url"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.navigate({
          url: params.url as string,
          waitUntil: params.waitUntil as "load" | "domcontentloaded" | "networkidle" | "commit" | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_capture",
      description: preferBcAct("Capture snapshot and/or screenshot evidence from the active or specified tab.", "capture"),
      inputSchema: buildSchema({
        tabId: { type: "string", description: "Optional tab ID." },
        snapshot: { type: "boolean", description: "Include an accessibility snapshot.", default: true },
        screenshot: { type: "boolean", description: "Include a screenshot.", default: false },
        fullPage: { type: "boolean", description: "Capture full-page screenshot when screenshot is true.", default: false },
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.capture({
          tabId: params.tabId as string | undefined,
          snapshot: params.snapshot as boolean | undefined,
          screenshot: params.screenshot as boolean | undefined,
          fullPage: params.fullPage as boolean | undefined,
        });
      },
    },

    {
      name: "bc_browser_capture_many",
      description: preferBcAct("Capture snapshot and/or screenshot evidence from multiple tabs.", "captureMany"),
      inputSchema: buildSchema({
        tabIds: { type: "array", description: "Tab IDs to capture." },
        snapshot: { type: "boolean", description: "Include accessibility snapshots.", default: true },
        screenshot: { type: "boolean", description: "Include screenshots.", default: false },
        fullPage: { type: "boolean", description: "Capture full-page screenshots when screenshot is true.", default: false },
        sessionId: sessionIdSchema,
      }, ["tabIds"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.captureMany(params.tabIds as string[], {
          snapshot: params.snapshot as boolean | undefined,
          screenshot: params.screenshot as boolean | undefined,
          fullPage: params.fullPage as boolean | undefined,
        });
      },
    },

    {
      name: "bc_browser_snapshot",
      description: "Take an accessibility snapshot of the current page. Returns a structured representation with stable element refs (e.g., @e1, @e2) for semantic interaction. Use this before clicking or filling elements.",
      inputSchema: buildSchema({
        rootSelector: { type: "string", description: "Optional CSS selector to scope the snapshot to a subtree." },
        boxes: { type: "boolean", description: "Include element bounds with viewport metadata in the snapshot." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.snapshot({
          rootSelector: params.rootSelector as string | undefined,
          boxes: params.boxes as boolean | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_click",
      description: preferBcAct("Click an element on the page. Target can be a ref (@e3), CSS selector, or semantic text match. Prefer refs from a snapshot for stability.", "click"),
      inputSchema: buildSchema({
        target: { type: "string", description: "Element to click: ref (@e3), CSS selector, or text match." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds. Default: 5000." },
        force: { type: "boolean", description: "Force click without actionability checks.", default: false },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["target"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.click({
          target: params.target as string,
          timeoutMs: params.timeoutMs as number | undefined,
          force: params.force as boolean | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_fill",
      description: preferBcAct("Fill a form field with text. Target can be a ref (@e3), CSS selector, or semantic text match. Use commit:true to press Tab after filling.", "fill"),
      inputSchema: buildSchema({
        target: { type: "string", description: "Element to fill: ref (@e3), CSS selector, or text match." },
        text: { type: "string", description: "Text to enter." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds. Default: 5000." },
        commit: { type: "boolean", description: "Press Tab after filling to move to the next field.", default: false },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["target", "text"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.fill({
          target: params.target as string,
          text: params.text as string,
          timeoutMs: params.timeoutMs as number | undefined,
          commit: params.commit as boolean | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_fill_many",
      description: preferBcAct("Batch fill multiple form fields sequentially. Fields should be an array of objects with 'target' and 'text'.", "fillMany"),
      inputSchema: buildSchema({
        fields: { type: "array", description: "Array of fields to fill. Each must have { target, text }." },
        timeoutMs: { type: "number", description: "Timeout per field in milliseconds. Default: 5000." },
        continueOnFailure: { type: "boolean", description: "Continue filling subsequent fields if one fails.", default: false },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["fields"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.fillMany(params.fields as any[], {
          timeoutMs: params.timeoutMs as number | undefined,
          continueOnFailure: params.continueOnFailure as boolean | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_hover",
      description: preferBcAct("Hover over an element. Target can be a ref (@e3), CSS selector, or semantic text match.", "hover"),
      inputSchema: buildSchema({
        target: { type: "string", description: "Element to hover: ref (@e3), CSS selector, or text match." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds. Default: 5000." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["target"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.hover({
          target: params.target as string,
          timeoutMs: params.timeoutMs as number | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_type",
      description: preferBcAct("Type text into the currently focused element (e.g., after clicking a textbox).", "type"),
      inputSchema: buildSchema({
        text: { type: "string", description: "Text to type." },
        delayMs: { type: "number", description: "Delay between keystrokes in milliseconds. Default: 0.", default: 0 },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["text"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.type({
          text: params.text as string,
          delayMs: params.delayMs as number | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_paste",
      description: preferBcAct("Paste/insert text into the focused element, optionally focusing a target first. Supports policy-approved secret:// refs.", "paste"),
      inputSchema: buildSchema({
        text: { type: "string", description: "Text to paste or a secret:// ref." },
        target: { type: "string", description: "Optional element to focus before pasting: ref (@e3), CSS selector, or text match." },
        timeoutMs: { type: "number", description: "Focus/click timeout in milliseconds. Default: 5000." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["text"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.paste({
          text: params.text as string,
          target: params.target as string | undefined,
          timeoutMs: params.timeoutMs as number | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_press",
      description: preferBcAct("Press a keyboard key (e.g., 'Enter', 'Tab', 'ArrowDown', 'Escape').", "press"),
      inputSchema: buildSchema({
        key: { type: "string", description: "Key to press: Enter, Tab, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Escape, Backspace, etc." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["key"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.press({
          key: params.key as string,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_scroll",
      description: preferBcAct("Scroll the page in a direction.", "scroll"),
      inputSchema: buildSchema({
        direction: { type: "string", description: "Direction to scroll: up, down, left, right.", enum: ["up", "down", "left", "right"] },
        amount: { type: "number", description: "Pixels to scroll. Default: 300.", default: 300 },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["direction"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.scroll({
          direction: params.direction as "up" | "down" | "left" | "right",
          amount: params.amount as number | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_screenshot",
      description: preferBcAct("Take a screenshot of the page or a specific element. Primary file always saves under Browser Control runtime; use copyTo only when the user requested an extra copy.", "screenshot"),
      inputSchema: buildSchema({
        copyTo: { type: "string", description: "Optional auxiliary copy destination. Primary screenshot still saves under the active session runtime screenshots directory." },
        fullPage: { type: "boolean", description: "Capture the full page instead of just the viewport.", default: false },
        target: { type: "string", description: "Element ref or selector to screenshot. If omitted, screenshots the viewport." },
        annotate: { type: "boolean", description: "Annotate screenshot with ref labels and boxes for interactive elements." },
        refs: { type: "string", description: "Comma-separated list of specific refs to annotate (if annotate is true). If omitted, annotates all interactive elements." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        const refs = params.refs ? (params.refs as string).split(",").map(r => r.trim()) : undefined;
        return api.browser.screenshot({
          copyTo: params.copyTo as string | undefined,
          fullPage: params.fullPage as boolean | undefined,
          target: params.target as string | undefined,
          annotate: params.annotate as boolean | undefined,
          refs,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_highlight",
      description: "Highlight a target element visually on the page. Injects a temporary overlay that auto-removes after 5 seconds unless persist is true.",
      inputSchema: buildSchema({
        target: { type: "string", description: "Element to highlight: ref (@e3), CSS selector, or text match." },
        style: { type: "string", description: "Custom CSS for highlight overlay." },
        persist: { type: "boolean", description: "Whether to persist the highlight (default: false)." },
        hide: { type: "boolean", description: "Whether to hide the highlight (if true, removes all highlights)." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.highlight({
          target: params.target as string | undefined,
          style: params.style as string | undefined,
          persist: params.persist as boolean | undefined,
          hide: params.hide as boolean | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_generate_locator",
      description: "Generate stable locator candidates for a target element. Returns ordered candidates by confidence (role/name, label, placeholder, text, testid, css).",
      inputSchema: buildSchema({
        target: { type: "string", description: "Element ref (@e3), CSS selector, or text match to generate locators for." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["target"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.generateLocator(params.target as string, {
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_tab_list",
      description: "List all browser tabs with their IDs, URLs, and titles.",
      inputSchema: buildSchema({
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.tabList();
      },
    },

    {
      name: "bc_browser_tab_switch",
      description: "Switch to a browser tab by tab ID.",
      inputSchema: buildSchema({
        tabId: { type: "string", description: "Browser tab ID from tab list, state, or open results." },
        sessionId: sessionIdSchema,
      }, ["tabId"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.tabSwitch(params.tabId as string);
      },
    },

    {
      name: "bc_browser_tab_close",
      description: preferBcAct("Close the current or specified browser tab. Keeps the browser session and automation lifecycle alive.", "tab-close"),
      inputSchema: buildSchema({
        tabId: { type: "string", description: "Optional tab ID or index. If omitted, closes the active tab." },
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.tabClose({
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_close",
      description: "Close the browser automation lifecycle. Managed Chrome is terminated; attached Chrome is detached without killing the user's browser.",
      inputSchema: buildSchema({
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.close();
      },
    },

    {
      name: "bc_browser_screencast_start",
      description: "Start a browser screencast recording. Primary screencast artifacts are saved to session runtime; use copyTo only for an explicit extra copy.",
      inputSchema: buildSchema({
        copyTo: { type: "string", description: "Optional extra copy path. Primary screencast save remains in session runtime and is returned as runtimePath." },
        showActions: { type: "boolean", description: "Display visible action labels during recording." },
        annotationPosition: { type: "string", description: "Position for action labels: top-left, top, top-right, bottom-left, bottom, bottom-right.", enum: ["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"] },
        retention: { type: "string", description: "Retention policy: keep, delete-on-success, debug-only.", enum: ["keep", "delete-on-success", "debug-only"] },
        sessionId: sessionIdSchema,
      }),
      validation: { forbiddenParameters: ["path"] },
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        const options: ScreencastOptions = {};
        if (params.copyTo) options.copyTo = params.copyTo as string;
        if (params.showActions) options.showActions = params.showActions as boolean;
        if (params.annotationPosition) options.annotationPosition = params.annotationPosition as "top-left" | "top" | "top-right" | "bottom-left" | "bottom" | "bottom-right";
        if (params.retention) options.retention = params.retention as "keep" | "delete-on-success" | "debug-only";
        return api.browser.screencast.start(options);
      },
    },

    {
      name: "bc_browser_screencast_stop",
      description: "Stop the current screencast recording and save the action timeline receipt.",
      inputSchema: buildSchema({
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.screencast.stop();
      },
    },

    {
      name: "bc_browser_screencast_status",
      description: "Get the current screencast recording status.",
      inputSchema: buildSchema({
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.screencast.status();
      },
    },

    // ── Browser Discovery and Attach UX ─────────────────────────────────

    {
      name: "bc_browser_list",
      description: "List attachable browsers on the local system. Probes CDP endpoints and returns browser metadata including channel, endpoint, and attachment status.",
      inputSchema: buildSchema({
        all: { type: "boolean", description: "List all discovered browsers including those not currently attached." },
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.list({
          all: params.all as boolean | undefined,
        });
      },
    },

    {
      name: "bc_browser_attach",
      description: "Explicitly attach to a running browser via CDP endpoint. Requires an explicit target (cdp or port) and never falls back to launch.",
      inputSchema: buildSchema({
        cdp: { type: "string", description: "CDP endpoint URL (e.g., http://localhost:9222)." },
        port: { type: "number", description: "CDP port number." },
        targetType: { type: "string", description: "Target type hint: chrome, chromium, msedge, electron, or unknown." },
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.attach({
          cdp: params.cdp as string | undefined,
          port: params.port as number | undefined,
          targetType: params.targetType as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_detach",
      description: "Detach from the current browser connection without closing attached browsers. For managed browsers, this is a no-op (use close instead). Returns structured detach result.",
      inputSchema: buildSchema({
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.detach();
      },
    },

    {
      name: "bc_browser_launch",
      description: "Launch a managed browser instance. Starts a new Chrome process with automation profile. Returns connection metadata including endpoint, port, profile, and provider.",
      inputSchema: buildSchema({
        port: { type: "number", description: "CDP port number for the launched browser. Default: from config (9222)." },
        profile: { type: "string", description: "Launcher profile: 'system' (uses existing profile) or 'isolated' (clean profile). Default: from config.", enum: ["system", "isolated"] },
        provider: { type: "string", description: "Provider to use for launch (e.g., 'local', 'browserless'). Default: active provider." },
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.launch({
          port: params.port as number | undefined,
          profile: params.profile as "system" | "isolated" | undefined,
          provider: params.provider as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_drop",
      description: "Drop files or data onto a page element. Supports file drop (local files) and data drop (MIME/value pairs like text/plain). Target can be a ref (@e3), CSS selector, or semantic text match.",
      inputSchema: buildSchema({
        target: { type: "string", description: "Element to drop onto: ref (@e3), CSS selector, or text match." },
        files: { type: "array", description: "Local file paths to drop." },
        data: { type: "array", description: "MIME/value pairs for clipboard-like data drop (e.g., text/plain=hello)." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["target"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.drop({
          target: params.target as string,
          files: params.files as string[] | undefined,
          data: params.data as Array<{ mimeType: string; value: string }> | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_downloads_list",
      description: "List recent downloads for the current session. Returns structured download information including filename, path, size, and status.",
      inputSchema: buildSchema({
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.downloads.list();
      },
    },
    {
      name: "bc_browser_dialog",
      description: "Detect or respond to browser dialogs (alerts, prompts, confirms). Call with action=list first to see active dialogs.",
      inputSchema: buildSchema({
        action: { type: "string", description: "Action to perform: list or respond.", enum: ["list", "respond"] },
        dialogId: { type: "string", description: "Dialog ID to respond to (required if action=respond)." },
        response: { type: "string", description: "Response type: accept or dismiss.", enum: ["accept", "dismiss"] },
        text: { type: "string", description: "Text to enter into prompt dialogs." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["action"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.dialog({
          action: params.action as "list" | "respond",
          dialog_id: params.dialogId as string | undefined,
          response: params.response as "accept" | "dismiss" | undefined,
          text: params.text as string | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_cdp",
      description: "Execute a raw CDP command via passthrough. Requires explicit timeoutMs. For page interactions, use click/fill/snapshot instead.",
      inputSchema: buildSchema({
        method: { type: "string", description: "CDP method to call (e.g., 'Network.enable')." },
        params: { type: "object", description: "CDP method parameters." },
        targetId: { type: "string", description: "CDP target ID (optional)." },
        frameId: { type: "string", description: "CDP frame ID (optional)." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: sessionIdSchema,
      }, ["method", "timeoutMs"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.cdp({
          method: params.method as string,
          params: params.params as Record<string, unknown> | undefined,
          targetId: params.targetId as string | undefined,
          frameId: params.frameId as string | undefined,
          timeoutMs: params.timeoutMs as number,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    // ── High-Level Composite Tools ──────────────────────────────────────

    {
      name: "bc_browser_state",
      description: preferBcAct("Collect compact browser state: connected flag, active URL/title, tab list, dialogs, warnings, per-section status. Returns snapshot only when snapshot=true (off by default). Replaces tab list + dialog + downloads + snapshot calls.", "state"),
      inputSchema: buildSchema({
        tabId: { type: "string", description: "Optional tab ID to snapshot." },
        snapshot: { type: "boolean", description: "Include accessibility snapshot. Default: false (compact mode).", default: false },
        screenshot: { type: "boolean", description: "Include screenshot. Default: false.", default: false },
        fullPage: { type: "boolean", description: "Capture full-page screenshot when screenshot is true.", default: false },
        dialog: { type: "boolean", description: "Include pending dialogs. Default: true.", default: true },
        downloads: { type: "boolean", description: "Include recent downloads. Default: false (opt-in — high risk under balanced policy).", default: false },
        sessionId: sessionIdSchema,
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.state({
          tabId: params.tabId as string | undefined,
          snapshot: params.snapshot as boolean | undefined,
          screenshot: params.screenshot as boolean | undefined,
          fullPage: params.fullPage as boolean | undefined,
          dialog: params.dialog as boolean | undefined,
          downloads: params.downloads as boolean | undefined,
        });
      },
    },

    {
      name: "bc_browser_act",
      description: "Perform any single action (click, fill, press, hover, scroll, type, paste, screenshot, tab-close, open, navigate, openMany, capture, captureMany, fillMany, state). Auto-returns compact page state; call bc_snapshot explicitly for the full accessibility tree.",
      inputSchema: buildSchema({
        action: { type: "string", description: "Action to perform.", enum: ["click", "fill", "press", "hover", "scroll", "type", "paste", "screenshot", "tab-close", "open", "navigate", "openMany", "capture", "captureMany", "fillMany", "state"] },
        target: { type: "string", description: "Element ref (@e3), CSS selector, or text match. Required for click/fill/hover/paste/screenshot." },
        text: { type: "string", description: "Text to enter. Required for fill/type/paste." },
        key: { type: "string", description: "Keyboard key to press. Required for press." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds. Default: 5000." },
        force: { type: "boolean", description: "Force click without actionability checks.", default: false },
        commit: { type: "boolean", description: "Press Tab after fill to move to the next field.", default: false },
        direction: { type: "string", description: "Scroll direction: up, down, left, right.", enum: ["up", "down", "left", "right"] },
        amount: { type: "number", description: "Pixels to scroll. Default: 300." },
        delayMs: { type: "number", description: "Delay between keystrokes in ms. Default: 0.", default: 0 },
        tabId: { type: "string", description: "Optional tab ID." },
        copyTo: { type: "string", description: "Optional auxiliary screenshot copy destination. Primary save remains in Browser Control runtime." },
        fullPage: { type: "boolean", description: "Full-page screenshot (screenshot action only).", default: false },
        snapshot: { type: "boolean", description: "Include snapshot for capture/state actions. Default: false (compact state only after other actions).", default: false },
        screenshot: { type: "boolean", description: "Include screenshot for capture/state actions. Default: false.", default: false },
        url: { type: "string", description: "URL for open/navigate actions." },
        urls: URLS_SCHEMA,
        waitUntil: WAIT_UNTIL_SCHEMA,
        fields: FIELDS_SCHEMA,
        continueOnFailure: { type: "boolean", description: "Continue on field failure for fillMany.", default: false },
        boxes: { type: "boolean", description: "Include element bounds for capture/state.", default: false },
        rootSelector: { type: "string", description: "Root CSS selector for scoped snapshot." },
        sessionId: sessionIdSchema,
      }, ["action"]),
      validation: BROWSER_ACT_VALIDATION,
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.act({
          action: params.action as any,
          target: params.target as string | undefined,
          text: params.text as string | undefined,
          key: params.key as string | undefined,
          timeoutMs: params.timeoutMs as number | undefined,
          force: params.force as boolean | undefined,
          commit: params.commit as boolean | undefined,
          direction: params.direction as string | undefined,
          amount: params.amount as number | undefined,
          delayMs: params.delayMs as number | undefined,
          tabId: params.tabId as string | undefined,
          copyTo: params.copyTo as string | undefined,
          fullPage: params.fullPage as boolean | undefined,
          snapshot: params.snapshot as boolean | undefined,
          screenshot: params.screenshot as boolean | undefined,
          url: params.url as string | undefined,
          urls: params.urls as (string | { url: string; label?: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" })[] | undefined,
          waitUntil: params.waitUntil as any,
          fields: params.fields as any,
          continueOnFailure: params.continueOnFailure as boolean | undefined,
          boxes: params.boxes as boolean | undefined,
          rootSelector: params.rootSelector as string | undefined,
        });
      },
    },

    {
      name: "bc_task_run",
      description: "Execute a deterministic multi-step browser task sequence. Each step runs a browser action (click, fill, press, etc.). Returns per-step results with timing, policy metadata, completed/executed/successful counts, failedStepIndex, finalState.",
      inputSchema: buildSchema({
        steps: { type: "array", description: "Array of browser task step objects. Each step must match the fields for its action.", items: BROWSER_STEP_SCHEMA },
        continueOnFailure: { type: "boolean", description: "Continue to next step if one fails. Default: false.", default: false },
        sessionId: sessionIdSchema,
      }, ["steps"]),
      validation: BROWSER_TASK_RUN_VALIDATION,
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.taskRun({
          steps: params.steps as Array<Record<string, unknown>> as any,
          continueOnFailure: params.continueOnFailure as boolean | undefined,
        });
      },
    },
  ];

  return withCanonicalNames(tools);
}
