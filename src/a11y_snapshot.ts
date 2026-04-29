/**
 * A11y Snapshot — Core Types and Snapshot Generation
 *
 * Provides accessibility-first snapshot generation for browser pages.
 * Uses Playwright's accessibility tree as the primary source, with a
 * DOM-based synthetic fallback for pages that lack proper a11y data.
 *
 * Inspired by the agent-browser snapshot → ref → action model.
 * Each element gets a deterministic compact ref (e1, e2, ...) assigned
 * via depth-first traversal of the accessibility tree.
 */

import type { CDPSession, Page } from "playwright";
import { logger } from "./shared/logger";

const log = logger.withComponent("a11y_snapshot");

// ── Core Types ──────────────────────────────────────────────────────

export interface ElementBounds {
  /** X coordinate relative to viewport */
  x: number;
  /** Y coordinate relative to viewport */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Viewport width when bounds were captured */
  viewportWidth: number;
  /** Viewport height when bounds were captured */
  viewportHeight: number;
  /** Device scale factor (DPR) when bounds were captured */
  deviceScaleFactor?: number;
}

export interface A11yElement {
  /** Compact ref like "e1", "e2". Unique within a snapshot. */
  ref: string;
  /** ARIA role (button, textbox, heading, link, etc.) */
  role: string;
  /** Accessible name (aria-label, label text, alt text, etc.) */
  name?: string;
  /** Visible text content summary */
  text?: string;
  /** Heading level (1-6) for heading role */
  level?: number;
  /** Whether the element is disabled */
  disabled?: boolean;
  /** Whether the element is checked (checkbox/radio) */
  checked?: boolean;
  /** Whether the element is expanded (accordion/treeitem) */
  expanded?: boolean;
  /** Whether the element currently has focus */
  focused?: boolean;
  /** Bounding box if available (includes viewport metadata) */
  bounds?: ElementBounds;
  /** Refs of child elements (for hierarchy) */
  children?: string[];
  /** CSS selector fallback for interaction */
  selector?: string;
}

export interface A11ySnapshot {
  /** Session or page identifier */
  sessionId?: string;
  /** Current page URL at snapshot time */
  pageUrl?: string;
  /** Current page title at snapshot time */
  pageTitle?: string;
  /** Flat list of elements, ordered by DFS traversal */
  elements: A11yElement[];
  /** ISO timestamp when snapshot was generated */
  generatedAt: string;
}

// ── Interactive / Meaningful Roles ──────────────────────────────────

/** Roles we care about for agent interaction */
export const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "searchbox",
  "textarea",
  "treeitem",
  "gridcell",
  "columnheader",
  "rowheader",
  "scrollbar",
]);

/** Structural roles we keep for context */
const STRUCTURAL_ROLES = new Set([
  "heading",
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "complementary",
  "form",
  "region",
  "alert",
  "alertdialog",
  "dialog",
  "status",
  "log",
  "marquee",
  "timer",
  "progressbar",
  "img",
  "figure",
  "table",
  "row",
  "cell",
  "list",
  "listitem",
  "group",
  "separator",
  "toolbar",
  "menubar",
  "menu",
  "tablist",
  "tabpanel",
  "tree",
  "treegrid",
]);

// ── Snapshot Generation ────────────────────────────────────────────

/**
 * Generate an accessibility snapshot from a Playwright page.
 *
 * Uses Playwright's accessibility.snapshot() as the primary source.
 * Falls back to DOM-based synthetic extraction if the a11y tree is
 * empty or unusable.
 *
 * @param page - Playwright page to snapshot
 * @param options.sessionId - Optional session identifier
 * @param options.rootSelector - Scopes the snapshot to a DOM subtree.
 *   NOTE: Only effective in the DOM fallback path. The CDP a11y tree
 *   captures the full page; rootSelector filtering is not supported
 *   in the primary path. If you need subtree-scoped snapshots,
 *   prefer the DOM fallback (e.g., on pages with no a11y tree).
 * @param options.boxes - If true, includes element bounds with viewport metadata.
 *   Bounds are only captured in the DOM fallback path. Default: false.
 */
export async function snapshot(
  page: Page,
  options: { sessionId?: string; rootSelector?: string; boxes?: boolean } = {},
): Promise<A11ySnapshot> {
  const startedAt = Date.now();
  let pageUrl: string;
  let pageTitle: string;

  try {
    pageUrl = page.url();
  } catch {
    pageUrl = "about:blank";
  }

  try {
    pageTitle = await page.title();
  } catch {
    pageTitle = "";
  }

  // Primary: Playwright accessibility tree (full page, rootSelector is ignored here)
  let elements = await snapshotFromA11yTree(page);

  // Fallback: DOM-based synthetic extraction (rootSelector is honored here)
  if (elements.length === 0) {
    log.info("A11y tree empty, falling back to DOM-based synthetic snapshot");
    elements = await snapshotFromDOM(page, options.rootSelector, options.boxes);
  } else if (options.rootSelector) {
    // Note: rootSelector was requested but not applied to the CDP path
    log.info("rootSelector is only applied in DOM fallback mode; CDP path captured full page");
  } else if (options.boxes) {
    // Boxes requested but CDP path doesn't support bounds extraction yet
    // Re-run with DOM fallback to get bounds
    log.info("Boxes requested, re-running snapshot with DOM fallback for bounds");
    elements = await snapshotFromDOM(page, options.rootSelector, options.boxes);
  }

  const elapsed = Date.now() - startedAt;
  log.info(`Snapshot generated: ${elements.length} elements in ${elapsed}ms`);

  return {
    sessionId: options.sessionId,
    pageUrl,
    pageTitle,
    elements,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate snapshot from CDP Accessibility.getFullAXTree.
 * Falls back to DOM if CDP is unavailable.
 */
async function snapshotFromA11yTree(page: Page): Promise<A11yElement[]> {
  let cdp: CDPSession | null = null;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch {
    return [];
  }

  try {
    const result = await cdp.send("Accessibility.getFullAXTree") as Record<string, unknown>;
    const nodes = result?.nodes as CDPAXNode[] | undefined;
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return [];
    }

    // Build a node map for quick lookup
    const nodeMap = new Map<string, CDPAXNode>();
    for (const node of nodes) {
      if (node.nodeId) {
        nodeMap.set(node.nodeId, node as CDPAXNode);
      }
      // Also index by backendNodeId if present
      if (node.backendNodeId) {
        nodeMap.set(String(node.backendNodeId), node as CDPAXNode);
      }
    }

    // Find the root — usually has role "RootWebArea" or the first node
    let root = nodes.find((n: CDPAXNode) => n.role?.value === "RootWebArea") as CDPAXNode | undefined;
    if (!root) {
      root = nodes[0] as CDPAXNode;
    }

    // Note: rootSelector is not supported in the CDP a11y path.
    // The CDP accessibility tree covers the full page. For subtree-scoped
    // snapshots, rely on the DOM fallback path which honors rootSelector.

    const elements: A11yElement[] = [];
    let refCounter = 0;
    const nextRef = (): string => {
      refCounter += 1;
      return `e${refCounter}`;
    };

    flattenCDPNode(root, nodeMap, elements, nextRef);
    return elements;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn(`CDP a11y tree extraction failed: ${msg}`);
    return [];
  } finally {
    try {
      await cdp.detach();
    } catch {
      // Session already closed
    }
  }
}

// ── CDP Accessibility Node Types ───────────────────────────────────

interface CDPAXProperty {
  value?: string;
  type?: string;
}

interface CDPAXNode {
  nodeId: string;
  backendNodeId?: number;
  ignored?: boolean;
  role?: CDPAXProperty;
  name?: CDPAXProperty;
  description?: CDPAXProperty;
  value?: CDPAXProperty;
  properties?: Array<{ name: string; value: CDPAXProperty }>;
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

/**
 * Recursively flatten a CDP accessibility node into A11yElement array.
 */
function flattenCDPNode(
  node: CDPAXNode,
  nodeMap: Map<string, CDPAXNode>,
  elements: A11yElement[],
  nextRef: () => string,
): string | null {
  // Skip ignored nodes and generic/none roles
  if (node.ignored) {
    // Process children through
    const childRefs: string[] = [];
    for (const childId of node.childIds ?? []) {
      const child = nodeMap.get(childId);
      if (child) {
        const childRef = flattenCDPNode(child, nodeMap, elements, nextRef);
        if (childRef) {
          childRefs.push(childRef);
        }
      }
    }
    return childRefs.length > 0 ? childRefs[0] : null;
  }

  const rawRole = node.role?.value ?? "";
  const role = normalizeCDPRole(rawRole);

  // Skip certain non-useful roles
  if (!role || role === "none" || role === "presentation" || role === "generic") {
    const childRefs: string[] = [];
    for (const childId of node.childIds ?? []) {
      const child = nodeMap.get(childId);
      if (child) {
        const childRef = flattenCDPNode(child, nodeMap, elements, nextRef);
        if (childRef) {
          childRefs.push(childRef);
        }
      }
    }
    return childRefs.length > 0 ? childRefs[0] : null;
  }

  const ref = nextRef();
  const element: A11yElement = {
    ref,
    role,
  };

  if (node.name?.value) {
    element.name = node.name.value;
  }

  const valueText = node.value?.value;
  if (valueText && valueText !== node.name?.value) {
    element.text = valueText;
  }

  // Extract properties
  if (Array.isArray(node.properties)) {
    for (const prop of node.properties) {
      switch (prop.name) {
        case "level":
          if (role === "heading" && prop.value?.value) {
            element.level = parseInt(prop.value.value, 10);
          }
          break;
        case "disabled":
          if (prop.value?.value === "true") {
            element.disabled = true;
          }
          break;
        case "checked":
        case "selected":
          if (prop.value?.value === "true" || prop.value?.value === "mixed") {
            element.checked = prop.value.value === "true" || prop.value.value === "mixed";
          }
          break;
        case "expanded":
          if (prop.value?.value === "true") {
            element.expanded = true;
          } else if (prop.value?.value === "false") {
            element.expanded = false;
          }
          break;
        case "focused":
          if (prop.value?.value === "true") {
            element.focused = true;
          }
          break;
      }
    }
  }

  // Process children
  const childRefs: string[] = [];
  for (const childId of node.childIds ?? []) {
    const child = nodeMap.get(childId);
    if (child) {
      const childRef = flattenCDPNode(child, nodeMap, elements, nextRef);
      if (childRef) {
        childRefs.push(childRef);
      }
    }
  }

  if (childRefs.length > 0) {
    element.children = childRefs;
  }

  elements.push(element);
  return ref;
}

/**
 * Normalize CDP role names to standard ARIA role names.
 */
function normalizeCDPRole(cdpRole: string): string {
  const roleMap: Record<string, string> = {
    "RootWebArea": "document",
    "WebArea": "document",
    "generic": "",
    "InlineTextBox": "",
    "StaticText": "",
    "LabelText": "",
    // Common mappings
    "button": "button",
    "link": "link",
    "textbox": "textbox",
    "checkbox": "checkbox",
    "radio": "radio",
    "combobox": "combobox",
    "listbox": "listbox",
    "option": "option",
    "menuitem": "menuitem",
    "tab": "tab",
    "heading": "heading",
    "navigation": "navigation",
    "img": "img",
    "image": "img",
    "list": "list",
    "listitem": "listitem",
    "table": "table",
    "row": "row",
    "cell": "cell",
    "columnheader": "columnheader",
    "rowheader": "rowheader",
    "dialog": "dialog",
    "alert": "alert",
    "status": "status",
    "progressbar": "progressbar",
    "slider": "slider",
    "spinbutton": "spinbutton",
    "searchbox": "searchbox",
    "switch": "switch",
    "treeitem": "treeitem",
    "toolbar": "toolbar",
    "separator": "separator",
    "menubar": "menubar",
    "menu": "menu",
    "tablist": "tablist",
    "tabpanel": "tabpanel",
    "tree": "tree",
    "treegrid": "treegrid",
    "group": "group",
    "form": "form",
    "main": "main",
    "banner": "banner",
    "contentinfo": "contentinfo",
    "complementary": "complementary",
    "region": "region",
  };

  // Direct lookup
  if (cdpRole in roleMap) {
    return roleMap[cdpRole];
  }

  // If it's already a known ARIA role, use it directly
  if (cdpRole && cdpRole !== "unknown") {
    return cdpRole.toLowerCase();
  }

  return "";
}

// ── DOM-Based Synthetic Fallback ────────────────────────────────────

/**
 * Generate a synthetic snapshot by querying the DOM for interactive
 * and semantically meaningful elements.
 *
 * This is the fallback when Playwright's accessibility tree is empty
 * or incomplete (some SPAs, canvas-heavy apps, etc.).
 */
async function snapshotFromDOM(
  page: Page,
  rootSelector?: string,
  boxes?: boolean,
): Promise<A11yElement[]> {
  try {
    const rootScope = rootSelector ?? "body";

    // Capture viewport metadata if boxes are requested
    // For headful/attached browsers, page.viewportSize() may be null, so collect
    // innerWidth, innerHeight, and devicePixelRatio inside page.evaluate
    let viewportInfo: { width: number; height: number; deviceScaleFactor: number } | undefined;
    if (boxes) {
      try {
        viewportInfo = await page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
          deviceScaleFactor: window.devicePixelRatio,
        }));
      } catch {
        // Viewport capture failed, bounds will be omitted
      }
    }

    const rawElements = await page.evaluate((scope: string) => {
      const root = document.querySelector(scope);
      if (!root) {
        return [];
      }

      const results: Array<{
        tag: string;
        role: string;
        name: string;
        text: string;
        level: number | null;
        disabled: boolean;
        checked: boolean | null;
        href: string;
        rect: { x: number; y: number; width: number; height: number };
        selector: string;
      }> = [];

      function getAccessibleName(el: Element): string {
        // aria-label
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel) {
          return ariaLabel;
        }

        // aria-labelledby
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const labelEl = document.getElementById(labelledBy);
          if (labelEl) {
            return labelEl.textContent?.trim() ?? "";
          }
        }

        // <label for="...">
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          const id = el.id;
          if (id) {
            const label = document.querySelector(`label[for="${id}"]`);
            if (label) {
              return label.textContent?.trim() ?? "";
            }
          }
          // Parent <label>
          const parentLabel = el.closest("label");
          if (parentLabel) {
            return parentLabel.textContent?.trim() ?? "";
          }
          // placeholder as fallback
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            return el.placeholder ?? "";
          }
        }

        // Alt text for images
        if (el instanceof HTMLImageElement) {
          return el.alt ?? "";
        }

        // Title attribute
        const title = el.getAttribute("title");
        if (title) {
          return title;
        }

        // Visible text for controls that derive their accessible name from content
        if (
          el instanceof HTMLButtonElement ||
          el instanceof HTMLAnchorElement ||
          el.tagName.toLowerCase() === "summary" ||
          el.getAttribute("role") === "button" ||
          el.getAttribute("role") === "link"
        ) {
          return el.textContent?.trim() ?? "";
        }

        return "";
      }

      function inferRole(el: Element): string {
        // Explicit role attribute
        const explicitRole = el.getAttribute("role");
        if (explicitRole) {
          return explicitRole;
        }

        const tag = el.tagName.toLowerCase();

        // Tag-based role inference
        switch (tag) {
          case "button": return "button";
          case "a": return "link";
          case "input": {
            const type = (el as HTMLInputElement).type?.toLowerCase() ?? "text";
            switch (type) {
              case "checkbox": return "checkbox";
              case "radio": return "radio";
              case "range": return "slider";
              case "file": return "button";
              case "submit":
              case "reset":
              case "button": return "button";
              default: return "textbox";
            }
          }
          case "textarea": return "textbox";
          case "select": return "combobox";
          case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
            return "heading";
          case "img": return "img";
          case "nav": return "navigation";
          case "main": return "main";
          case "form": return "form";
          case "table": return "table";
          case "ul": case "ol": return "list";
          case "li": return "listitem";
          case "dialog": return "dialog";
          case "details": return "group";
          case "summary": return "button";
          case "progress": return "progressbar";
          default: return "";
        }
      }

      function generateSelector(el: Element): string {
        const tag = el.tagName.toLowerCase();
        // data-test
        const dataTest = el.getAttribute("data-test");
        if (dataTest) {
          return `[data-test="${dataTest}"]`;
        }
        // data-testid
        const dataTestId = el.getAttribute("data-testid");
        if (dataTestId) {
          return `[data-testid="${dataTestId}"]`;
        }
        // aria-label
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel) {
          return `[aria-label="${ariaLabel}"]`;
        }
        // id
        const htmlEl = el as HTMLElement;
        if (htmlEl.id) {
          return `#${htmlEl.id}`;
        }
        // tag + classes
        const classes = Array.from(el.classList).slice(0, 2).join(".");
        return `${tag}${classes ? `.${classes}` : ""}`;
      }

      // Interactive selectors
      const selectors = [
        "button",
        "a[href]",
        "input",
        "textarea",
        "select",
        "[role='button']",
        "[role='textbox']",
        "[role='checkbox']",
        "[role='radio']",
        "[role='combobox']",
        "[role='link']",
        "[role='tab']",
        "[role='menuitem']",
        "[role='slider']",
        "[role='switch']",
        "[role='searchbox']",
        "[tabindex]",
        "[contenteditable]",
      ];

      const allEls = Array.from(root.querySelectorAll(selectors.join(", ")));

      for (const el of allEls) {
        // Skip hidden elements
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") {
          continue;
        }

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          continue;
        }

        const tag = el.tagName.toLowerCase();
        const role = inferRole(el);
        const name = getAccessibleName(el);
        const text = el.textContent?.trim().slice(0, 200) ?? "";

        const isCheckbox = tag === "input" && (el as HTMLInputElement).type === "checkbox";
        const isRadio = tag === "input" && (el as HTMLInputElement).type === "radio";

        results.push({
          tag,
          role: role || "generic",
          name,
          text: name === text ? "" : text,
          level: tag.match(/^h([1-6])$/) ? parseInt(tag[1]) : null,
          disabled: (el as HTMLInputElement | HTMLButtonElement).disabled ?? false,
          checked: (isCheckbox || isRadio) ? (el as HTMLInputElement).checked : null,
          href: (el as HTMLAnchorElement).href ?? "",
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          selector: generateSelector(el),
        });
      }

      // Also grab headings
      for (const heading of Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
        const style = window.getComputedStyle(heading);
        if (style.display === "none" || style.visibility === "hidden") {
          continue;
        }
        const rect = heading.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          continue;
        }
        const tag = heading.tagName.toLowerCase();
        const name = heading.textContent?.trim() ?? "";
        results.push({
          tag,
          role: "heading",
          name,
          text: "",
          level: parseInt(tag[1]),
          disabled: false,
          checked: null,
          href: "",
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          selector: tag,
        });
      }

      return results;
    }, rootScope);

    // Convert raw elements to A11yElement with refs
    return rawElements.map((raw, index) => {
      const element: A11yElement = {
        ref: `e${index + 1}`,
        role: raw.role,
      };

      if (raw.name) {
        element.name = raw.name;
      }
      if (raw.text) {
        element.text = raw.text;
      }
      if (raw.level != null) {
        element.level = raw.level;
      }
      if (raw.disabled) {
        element.disabled = true;
      }
      if (raw.checked != null) {
        element.checked = raw.checked;
      }
      if (raw.rect && boxes && viewportInfo) {
        element.bounds = {
          x: raw.rect.x,
          y: raw.rect.y,
          width: raw.rect.width,
          height: raw.rect.height,
          viewportWidth: viewportInfo.width,
          viewportHeight: viewportInfo.height,
          deviceScaleFactor: viewportInfo.deviceScaleFactor,
        };
      }
      if (raw.selector) {
        element.selector = raw.selector;
      }

      return element;
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`DOM snapshot fallback failed: ${msg}`);
    return [];
  }
}

// ── Utilities ──────────────────────────────────────────────────────

/**
 * Format a snapshot as a human-readable text list.
 * Suitable for CLI output and LLM consumption.
 */
export function formatSnapshotAsText(snapshot: A11ySnapshot): string {
  const lines: string[] = [];

  if (snapshot.pageTitle) {
    lines.push(`Page: ${snapshot.pageTitle}`);
  }
  if (snapshot.pageUrl) {
    lines.push(`URL: ${snapshot.pageUrl}`);
  }
  lines.push("");

  for (const el of snapshot.elements) {
    const parts: string[] = [`- ${el.role}`];

    if (el.name) {
      parts.push(`"${el.name}"`);
    }

    const meta: string[] = [];
    if (el.level != null) {
      meta.push(`level=${el.level}`);
    }
    if (el.disabled) {
      meta.push("disabled");
    }
    if (el.checked != null) {
      meta.push(el.checked ? "checked" : "unchecked");
    }
    if (el.expanded != null) {
      meta.push(el.expanded ? "expanded" : "collapsed");
    }
    if (el.focused) {
      meta.push("focused");
    }

    parts.push(`[ref=@${el.ref}]`);

    // Add box metadata if bounds are present
    if (el.bounds) {
      const { x, y, width, height } = el.bounds;
      // Round to integers for cleaner output
      const bx = Math.round(x);
      const by = Math.round(y);
      const bw = Math.round(width);
      const bh = Math.round(height);
      meta.push(`box=${bx},${by},${bw},${bh}`);
    }

    if (meta.length > 0) {
      parts.push(`(${meta.join(", ")})`);
    }

    lines.push(parts.join(" "));
  }

  return lines.join("\n");
}

/**
 * Get the count of interactive elements in a snapshot.
 */
export function getInteractiveCount(snapshot: A11ySnapshot): number {
  return snapshot.elements.filter(
    (el) => INTERACTIVE_ROLES.has(el.role) || el.role === "heading",
  ).length;
}
