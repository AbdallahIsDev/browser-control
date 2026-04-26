/**
 * Semantic Query — Query snapshots by role, name, and state
 *
 * Provides ergonomic helpers for finding elements in an A11ySnapshot
 * without parsing the full element list each time. These helpers are
 * the foundation for Section 5's agent action surface and Section 7's
 * MCP tools.
 */

import type { A11yElement, A11ySnapshot } from "./a11y_snapshot";

// ── Query Options ──────────────────────────────────────────────────

export interface SemanticQueryOptions {
  /** Filter by role (e.g., "button", "textbox") */
  role?: string;
  /** Filter by accessible name (exact match or substring) */
  name?: string;
  /** Match name exactly (default: false, which means substring match) */
  exactName?: boolean;
  /** Filter by disabled state */
  disabled?: boolean;
  /** Filter by checked state */
  checked?: boolean;
  /** Filter by expanded state */
  expanded?: boolean;
  /** Filter by focused state */
  focused?: boolean;
}

// ── Query Functions ────────────────────────────────────────────────

/**
 * Find all elements matching the given criteria.
 * Returns elements in snapshot order.
 */
export function queryAll(
  snapshot: A11ySnapshot,
  options: SemanticQueryOptions,
): A11yElement[] {
  return snapshot.elements.filter((el) => matchesQuery(el, options));
}

/**
 * Find the first element matching the given criteria.
 * Returns undefined if no match is found.
 */
export function queryFirst(
  snapshot: A11ySnapshot,
  options: SemanticQueryOptions,
): A11yElement | undefined {
  return snapshot.elements.find((el) => matchesQuery(el, options));
}

/**
 * Find all elements with a specific role.
 */
export function queryByRole(
  snapshot: A11ySnapshot,
  role: string,
): A11yElement[] {
  return snapshot.elements.filter((el) => el.role === role);
}

/**
 * Find the first element with a specific role and name.
 */
export function queryByRoleAndName(
  snapshot: A11ySnapshot,
  role: string,
  name: string,
  exact = false,
): A11yElement | undefined {
  return snapshot.elements.find(
    (el) => el.role === role && nameMatches(el.name, name, exact),
  );
}

/**
 * Find all elements with a specific accessible name.
 */
export function queryByName(
  snapshot: A11ySnapshot,
  name: string,
  exact = false,
): A11yElement[] {
  return snapshot.elements.filter(
    (el) => nameMatches(el.name, name, exact),
  );
}

/**
 * Find all buttons (role=button) with the given name.
 */
export function findButton(
  snapshot: A11ySnapshot,
  name?: string,
  exact = false,
): A11yElement | undefined {
  if (!name) {
    return queryFirst(snapshot, { role: "button" });
  }
  return queryByRoleAndName(snapshot, "button", name, exact);
}

/**
 * Find all textboxes (role=textbox) with the given name.
 */
export function findTextbox(
  snapshot: A11ySnapshot,
  name?: string,
  exact = false,
): A11yElement | undefined {
  if (!name) {
    return queryFirst(snapshot, { role: "textbox" });
  }
  return queryByRoleAndName(snapshot, "textbox", name, exact);
}

/**
 * Find a link (role=link) with the given name.
 */
export function findLink(
  snapshot: A11ySnapshot,
  name?: string,
  exact = false,
): A11yElement | undefined {
  if (!name) {
    return queryFirst(snapshot, { role: "link" });
  }
  return queryByRoleAndName(snapshot, "link", name, exact);
}

/**
 * Find a heading with the given name and optional level.
 */
export function findHeading(
  snapshot: A11ySnapshot,
  name?: string,
  level?: number,
): A11yElement | undefined {
  return snapshot.elements.find((el) => {
    if (el.role !== "heading") {
      return false;
    }
    if (level != null && el.level !== level) {
      return false;
    }
    if (name && !nameMatches(el.name, name)) {
      return false;
    }
    return true;
  });
}

/**
 * Find the element matching a "role named X" description.
 * E.g., "button Submit", "textbox Email", "link Sign in".
 */
export function findByDescription(
  snapshot: A11ySnapshot,
  description: string,
): A11yElement | undefined {
  // Try to parse "role name" pattern
  const trimmed = description.trim();

  // Direct ref lookup (e.g., "e3" or "@e3")
  const cleanRef = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const byRef = snapshot.elements.find((el) => el.ref === cleanRef);
  if (byRef) {
    return byRef;
  }

  // Parse "role name" or "role 'name with spaces'"
  const quotedMatch = /^(\w+)\s+["'](.+?)["']$/.exec(trimmed);
  if (quotedMatch) {
    return queryByRoleAndName(snapshot, quotedMatch[1].toLowerCase(), quotedMatch[2], true);
  }

  // Parse "role name" (first word is role, rest is name)
  const spaceMatch = /^(\w+)\s+(.+)$/.exec(trimmed);
  if (spaceMatch) {
    const role = spaceMatch[1].toLowerCase();
    const name = spaceMatch[2];
    return queryByRoleAndName(snapshot, role, name);
  }

  // Try as role only
  return queryFirst(snapshot, { role: trimmed.toLowerCase() });
}

// ── Internal Helpers ───────────────────────────────────────────────

function matchesQuery(el: A11yElement, options: SemanticQueryOptions): boolean {
  if (options.role && el.role !== options.role) {
    return false;
  }

  if (options.name !== undefined) {
    if (!nameMatches(el.name, options.name, options.exactName)) {
      return false;
    }
  }

  if (options.disabled !== undefined && el.disabled !== options.disabled) {
    return false;
  }

  if (options.checked !== undefined && el.checked !== options.checked) {
    return false;
  }

  if (options.expanded !== undefined && el.expanded !== options.expanded) {
    return false;
  }

  if (options.focused !== undefined && el.focused !== options.focused) {
    return false;
  }

  return true;
}

function nameMatches(
  elementName: string | undefined,
  queryName: string,
  exact = false,
): boolean {
  if (!elementName) {
    return false;
  }

  if (exact) {
    return elementName.toLowerCase() === queryName.toLowerCase();
  }

  return elementName.toLowerCase().includes(queryName.toLowerCase());
}
