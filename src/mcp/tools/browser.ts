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
 *   - bc_browser_press
 *   - bc_browser_scroll
 *   - bc_browser_screenshot
 *   - bc_browser_tab_list
 *   - bc_browser_tab_switch
 *   - bc_browser_close
 *
 * All tools use the existing BrowserActions methods and preserve ref-based
 * targeting and snapshot semantics from Section 6.
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema } from "../types";

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
      name: "bc_browser_snapshot",
      description: "Take an accessibility snapshot of the current page. Returns a structured representation with stable element refs (e.g., @e1, @e2) for semantic interaction. Use this before clicking or filling elements.",
      inputSchema: buildSchema({
        rootSelector: { type: "string", description: "Optional CSS selector to scope the snapshot to a subtree." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.snapshot({
          rootSelector: params.rootSelector as string | undefined,
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
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["target"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.click({
          target: params.target as string,
          timeoutMs: params.timeoutMs as number | undefined,
          force: params.force as boolean | undefined,
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
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["target", "text"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.fill({
          target: params.target as string,
          text: params.text as string,
          timeoutMs: params.timeoutMs as number | undefined,
          commit: params.commit as boolean | undefined,
        });
      },
    },

    {
      name: "bc_browser_hover",
      description: "Hover over an element. Target can be a ref (@e3), CSS selector, or semantic text match.",
      inputSchema: buildSchema({
        target: { type: "string", description: "Element to hover: ref (@e3), CSS selector, or text match." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds. Default: 5000." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["target"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.hover({
          target: params.target as string,
          timeoutMs: params.timeoutMs as number | undefined,
        });
      },
    },

    {
      name: "bc_browser_type",
      description: "Type text into the currently focused element (e.g., after clicking a textbox).",
      inputSchema: buildSchema({
        text: { type: "string", description: "Text to type." },
        delayMs: { type: "number", description: "Delay between keystrokes in milliseconds. Default: 0.", default: 0 },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["text"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.type({
          text: params.text as string,
          delayMs: params.delayMs as number | undefined,
        });
      },
    },

    {
      name: "bc_browser_press",
      description: "Press a keyboard key (e.g., 'Enter', 'Tab', 'ArrowDown', 'Escape').",
      inputSchema: buildSchema({
        key: { type: "string", description: "Key to press: Enter, Tab, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Escape, Backspace, etc." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["key"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.press({
          key: params.key as string,
        });
      },
    },

    {
      name: "bc_browser_scroll",
      description: "Scroll the page in a direction.",
      inputSchema: buildSchema({
        direction: { type: "string", description: "Direction to scroll: up, down, left, right.", enum: ["up", "down", "left", "right"] },
        amount: { type: "number", description: "Pixels to scroll. Default: 300.", default: 300 },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["direction"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.scroll({
          direction: params.direction as "up" | "down" | "left" | "right",
          amount: params.amount as number | undefined,
        });
      },
    },

    {
      name: "bc_browser_screenshot",
      description: "Take a screenshot of the page or a specific element.",
      inputSchema: buildSchema({
        outputPath: { type: "string", description: "File path to save the screenshot. Default: auto-generated in reports directory." },
        fullPage: { type: "boolean", description: "Capture the full page instead of just the viewport.", default: false },
        target: { type: "string", description: "Element ref or selector to screenshot. If omitted, screenshots the viewport." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.screenshot({
          outputPath: params.outputPath as string | undefined,
          fullPage: params.fullPage as boolean | undefined,
          target: params.target as string | undefined,
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
      name: "bc_browser_close",
      description: "Close the current browser tab.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.browser.close();
      },
    },
  ];
}