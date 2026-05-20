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
 * targeting and snapshot semantics from Section 6.
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema } from "../types";
import type { ActionResult } from "../../shared/action_result";
import type { A11ySnapshot } from "../../a11y_snapshot";
import type { LocatorCandidate } from "../../browser/actions";
import type { ScreencastOptions } from "../../observability/types";
import type { JSONSchema } from "../../mcp/types";

/**
 * Build browser MCP tools for a Browser Control instance.
 */
export function buildBrowserTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_browser_open",
      description: "Open a URL in the browser. If no browser is connected, attempts to attach to a running browser or launch a managed automation profile.",
      inputSchema: buildSchema({
        url: { type: "string", description: "URL to navigate to." },
        waitUntil: { type: "string", description: "Navigation wait condition: 'load', 'domcontentloaded', 'networkidle', or 'commit'. Default: 'domcontentloaded'.", enum: ["load", "domcontentloaded", "networkidle", "commit"], default: "domcontentloaded" },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Open multiple URLs as tabs in the current browser session.",
      inputSchema: buildSchema({
        urls: { type: "array", description: "Array of URLs or { url, label, waitUntil } objects to open." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Navigate the active or specified tab to a URL, replacing that tab.",
      inputSchema: buildSchema({
        url: { type: "string", description: "URL to navigate to." },
        waitUntil: { type: "string", description: "Navigation wait condition.", enum: ["load", "domcontentloaded", "networkidle", "commit"], default: "domcontentloaded" },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Capture snapshot and/or screenshot evidence from the active or specified tab.",
      inputSchema: buildSchema({
        tabId: { type: "string", description: "Optional tab ID." },
        snapshot: { type: "boolean", description: "Include an accessibility snapshot.", default: true },
        screenshot: { type: "boolean", description: "Include a screenshot.", default: false },
        fullPage: { type: "boolean", description: "Capture full-page screenshot when screenshot is true.", default: false },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Capture snapshot and/or screenshot evidence from multiple tabs.",
      inputSchema: buildSchema({
        tabIds: { type: "array", description: "Tab IDs to capture." },
        snapshot: { type: "boolean", description: "Include accessibility snapshots.", default: true },
        screenshot: { type: "boolean", description: "Include screenshots.", default: false },
        fullPage: { type: "boolean", description: "Capture full-page screenshots when screenshot is true.", default: false },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Click an element on the page. Target can be a ref (@e3), CSS selector, or semantic text match. Prefer refs from a snapshot for stability.",
      inputSchema: buildSchema({
        target: { type: "string", description: "Element to click: ref (@e3), CSS selector, or text match." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds. Default: 5000." },
        force: { type: "boolean", description: "Force click without actionability checks.", default: false },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Fill a form field with text. Target can be a ref (@e3), CSS selector, or semantic text match. Use commit:true to press Tab after filling.",
      inputSchema: buildSchema({
        target: { type: "string", description: "Element to fill: ref (@e3), CSS selector, or text match." },
        text: { type: "string", description: "Text to enter." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds. Default: 5000." },
        commit: { type: "boolean", description: "Press Tab after filling to move to the next field.", default: false },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Batch fill multiple form fields sequentially. Fields should be an array of objects with 'target' and 'text'.",
      inputSchema: buildSchema({
        fields: { type: "array", description: "Array of fields to fill. Each must have { target, text }." },
        timeoutMs: { type: "number", description: "Timeout per field in milliseconds. Default: 5000." },
        continueOnFailure: { type: "boolean", description: "Continue filling subsequent fields if one fails.", default: false },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Hover over an element. Target can be a ref (@e3), CSS selector, or semantic text match.",
      inputSchema: buildSchema({
        target: { type: "string", description: "Element to hover: ref (@e3), CSS selector, or text match." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds. Default: 5000." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Type text into the currently focused element (e.g., after clicking a textbox).",
      inputSchema: buildSchema({
        text: { type: "string", description: "Text to type." },
        delayMs: { type: "number", description: "Delay between keystrokes in milliseconds. Default: 0.", default: 0 },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Paste/insert text into the focused element, optionally focusing a target first. Supports policy-approved secret:// refs.",
      inputSchema: buildSchema({
        text: { type: "string", description: "Text to paste or a secret:// ref." },
        target: { type: "string", description: "Optional element to focus before pasting: ref (@e3), CSS selector, or text match." },
        timeoutMs: { type: "number", description: "Focus/click timeout in milliseconds. Default: 5000." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Press a keyboard key (e.g., 'Enter', 'Tab', 'ArrowDown', 'Escape').",
      inputSchema: buildSchema({
        key: { type: "string", description: "Key to press: Enter, Tab, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Escape, Backspace, etc." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Scroll the page in a direction.",
      inputSchema: buildSchema({
        direction: { type: "string", description: "Direction to scroll: up, down, left, right.", enum: ["up", "down", "left", "right"] },
        amount: { type: "number", description: "Pixels to scroll. Default: 300.", default: 300 },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Take a screenshot of the page or a specific element.",
      inputSchema: buildSchema({
        outputPath: { type: "string", description: "Optional custom screenshot file path. If omitted, Browser Control saves under the active session runtime screenshots directory." },
        fullPage: { type: "boolean", description: "Capture the full page instead of just the viewport.", default: false },
        target: { type: "string", description: "Element ref or selector to screenshot. If omitted, screenshots the viewport." },
        annotate: { type: "boolean", description: "Annotate screenshot with ref labels and boxes for interactive elements." },
        refs: { type: "string", description: "Comma-separated list of specific refs to annotate (if annotate is true). If omitted, annotates all interactive elements." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        const refs = params.refs ? (params.refs as string).split(",").map(r => r.trim()) : undefined;
        return api.browser.screenshot({
          outputPath: params.outputPath as string | undefined,
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
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["target"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.highlight({
          target: params.target as string,
          style: params.style as string | undefined,
          persist: params.persist as boolean | undefined,
          hide: params.hide as boolean | undefined,
          tabId: params.tabId as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_generate_locator",
      description: "Generate stable locator candidates for a target element. Returns ordered candidates by confidence (role/name, label, placeholder, text, testid, css, xpath).",
      inputSchema: buildSchema({
        target: { type: "string", description: "Element ref (@e3), CSS selector, or text match to generate locators for." },
        tabId: { type: "string", description: "Optional tab ID." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.tabList();
      },
    },

    {
      name: "bc_browser_tab_switch",
      description: "Switch to a browser tab by index.",
      inputSchema: buildSchema({
        tabId: { type: "string", description: "Tab index to activate (0-based)." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["tabId"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.tabSwitch(params.tabId as string);
      },
    },

    {
      name: "bc_browser_tab_close",
      description: "Close the current browser tab. Keeps the browser session and automation lifecycle alive.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.tabClose();
      },
    },

    {
      name: "bc_browser_close",
      description: "Close the browser automation lifecycle. Managed Chrome is terminated; attached Chrome is detached without killing the user's browser.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.close();
      },
    },

    {
      name: "bc_browser_screencast_start",
      description: "Start a browser screencast recording. Opt-in recording with action timeline support.",
      inputSchema: buildSchema({
        path: { type: "string", description: "Optional output file path for the screencast." },
        showActions: { type: "boolean", description: "Display visible action labels during recording." },
        annotationPosition: { type: "string", description: "Position for action labels: top-left, top, top-right, bottom-left, bottom, bottom-right.", enum: ["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"] },
        retention: { type: "string", description: "Retention policy: keep, delete-on-success, debug-only.", enum: ["keep", "delete-on-success", "debug-only"] },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        const options: ScreencastOptions = {};
        if (params.path) options.path = params.path as string;
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
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.screencast.status();
      },
    },

    // ── Section 27: Browser Discovery and Attach UX ─────────────────────

    {
      name: "bc_browser_list",
      description: "List attachable browsers on the local system. Probes CDP endpoints and returns browser metadata including channel, endpoint, and attachment status.",
      inputSchema: buildSchema({
        all: { type: "boolean", description: "List all discovered browsers including those not currently attached." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
      description: "Explicitly attach to a running browser via CDP endpoint. Requires an explicit target (--cdp, --endpoint, or --port) and never falls back to launch.",
      inputSchema: buildSchema({
        cdp: { type: "string", description: "CDP endpoint URL (e.g., http://localhost:9222)." },
        endpoint: { type: "string", description: "CDP endpoint URL alias (same as cdp)." },
        port: { type: "number", description: "CDP port number." },
        targetType: { type: "string", description: "Target type hint: chrome, chromium, msedge, electron, or unknown." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.attach({
          cdp: params.cdp as string | undefined,
          endpoint: params.endpoint as string | undefined,
          port: params.port as number | undefined,
          targetType: params.targetType as string | undefined,
        });
      },
    },

    {
      name: "bc_browser_detach",
      description: "Detach from the current browser connection without closing attached browsers. For managed browsers, this is a no-op (use close instead). Returns structured detach result.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["target"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.drop({
          target: params.target as string,
          files: params.files as string[] | undefined,
          data: params.data as Array<{ mimeType: string; value: string }> | undefined,
        });
      },
    },

    {
      name: "bc_browser_downloads_list",
      description: "List recent downloads for the current session. Returns structured download information including filename, path, size, and status.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
        dialog_id: { type: "string", description: "Dialog ID to respond to (required if action=respond)." },
        response: { type: "string", description: "Response type: accept or dismiss.", enum: ["accept", "dismiss"] },
        text: { type: "string", description: "Text to enter into prompt dialogs." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["action"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.dialog({
          action: params.action as "list" | "respond",
          dialog_id: params.dialog_id as string | undefined,
          response: params.response as "accept" | "dismiss" | undefined,
          text: params.text as string | undefined,
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
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
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
  ];
}
