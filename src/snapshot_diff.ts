/**
 * Snapshot Diff — Detect changes between two accessibility snapshots
 *
 * Compares two A11ySnapshot instances and reports:
 * - Added elements
 * - Removed elements
 * - Renamed elements (name changed)
 * - State changes (disabled, checked, expanded, focused)
 * - Route/title changes
 *
 * Used by retries, state detection, observability, and agent
 * action surfaces to know whether an interaction changed the page.
 */

import type { A11yElement, A11ySnapshot } from "./a11y_snapshot";

// ── Diff Types ─────────────────────────────────────────────────────

export interface StateChange {
  /** Which property changed */
  property: "disabled" | "checked" | "expanded" | "focused" | "text" | "level";
  /** Previous value */
  oldValue: unknown;
  /** New value */
  newValue: unknown;
}

export interface ElementDiff {
  ref: string;
  changes: StateChange[];
}

export interface SnapshotDiffResult {
  /** Elements present in `after` but not in `before` */
  added: A11yElement[];
  /** Elements present in `before` but not in `after` */
  removed: A11yElement[];
  /** Elements whose accessible name changed */
  renamed: Array<{ ref: string; oldName: string; newName: string }>;
  /** Elements whose state properties changed */
  stateChanged: ElementDiff[];
  /** Page URL changed */
  routeChanged?: { from: string; to: string };
  /** Page title changed */
  titleChanged?: { from: string; to: string };
  /** True if any changes were detected */
  hasChanges: boolean;
}

// ── Diff Function ──────────────────────────────────────────────────

/**
 * Compare two snapshots and return a structured diff.
 *
 * Matching strategy: elements with the same ref and role are compared.
 * Refs are deterministic per snapshot — a changed ref indicates a
 * structural change, not just a state change.
 *
 * For more robust matching across re-renders where refs might shift,
 * use `diffBySignature` (future enhancement).
 */
export function diffSnapshots(
  before: A11ySnapshot,
  after: A11ySnapshot,
): SnapshotDiffResult {
  const beforeMap = new Map<string, A11yElement>();
  for (const el of before.elements) {
    beforeMap.set(el.ref, el);
  }

  const afterMap = new Map<string, A11yElement>();
  for (const el of after.elements) {
    afterMap.set(el.ref, el);
  }

  const added: A11yElement[] = [];
  const removed: A11yElement[] = [];
  const renamed: Array<{ ref: string; oldName: string; newName: string }> = [];
  const stateChanged: ElementDiff[] = [];

  // Find removed elements (in before but not in after)
  for (const [ref, beforeEl] of Array.from(beforeMap)) {
    if (!afterMap.has(ref)) {
      removed.push(beforeEl);
    }
  }

  // Find added elements and changes
  for (const [ref, afterEl] of Array.from(afterMap)) {
    const beforeEl = beforeMap.get(ref);

    if (!beforeEl) {
      added.push(afterEl);
      continue;
    }

    // Check rename
    if (beforeEl.name !== afterEl.name) {
      renamed.push({
        ref,
        oldName: beforeEl.name ?? "",
        newName: afterEl.name ?? "",
      });
    }

    // Check state changes
    const changes: StateChange[] = [];

    if (beforeEl.disabled !== afterEl.disabled) {
      changes.push({
        property: "disabled",
        oldValue: beforeEl.disabled,
        newValue: afterEl.disabled,
      });
    }

    if (beforeEl.checked !== afterEl.checked) {
      changes.push({
        property: "checked",
        oldValue: beforeEl.checked,
        newValue: afterEl.checked,
      });
    }

    if (beforeEl.expanded !== afterEl.expanded) {
      changes.push({
        property: "expanded",
        oldValue: beforeEl.expanded,
        newValue: afterEl.expanded,
      });
    }

    if (beforeEl.focused !== afterEl.focused) {
      changes.push({
        property: "focused",
        oldValue: beforeEl.focused,
        newValue: afterEl.focused,
      });
    }

    if (beforeEl.text !== afterEl.text) {
      changes.push({
        property: "text",
        oldValue: beforeEl.text,
        newValue: afterEl.text,
      });
    }

    if (beforeEl.level !== afterEl.level) {
      changes.push({
        property: "level",
        oldValue: beforeEl.level,
        newValue: afterEl.level,
      });
    }

    if (changes.length > 0) {
      stateChanged.push({ ref, changes });
    }
  }

  // Check route/title changes
  let routeChanged: { from: string; to: string } | undefined;
  let titleChanged: { from: string; to: string } | undefined;

  if (before.pageUrl && after.pageUrl && before.pageUrl !== after.pageUrl) {
    routeChanged = { from: before.pageUrl, to: after.pageUrl };
  }

  if (before.pageTitle !== after.pageTitle) {
    if (before.pageTitle || after.pageTitle) {
      titleChanged = {
        from: before.pageTitle ?? "",
        to: after.pageTitle ?? "",
      };
    }
  }

  const hasChanges =
    added.length > 0 ||
    removed.length > 0 ||
    renamed.length > 0 ||
    stateChanged.length > 0 ||
    routeChanged != null ||
    titleChanged != null;

  return {
    added,
    removed,
    renamed,
    stateChanged,
    routeChanged,
    titleChanged,
    hasChanges,
  };
}

// ── Diff Summary ───────────────────────────────────────────────────

/**
 * Format a diff result as a human-readable summary.
 */
export function formatDiffSummary(diff: SnapshotDiffResult): string {
  if (!diff.hasChanges) {
    return "No changes detected.";
  }

  const lines: string[] = [];

  if (diff.routeChanged) {
    lines.push(`Route: ${diff.routeChanged.from} → ${diff.routeChanged.to}`);
  }

  if (diff.titleChanged) {
    lines.push(`Title: "${diff.titleChanged.from}" → "${diff.titleChanged.to}"`);
  }

  if (diff.added.length > 0) {
    lines.push(`Added (${diff.added.length}):`);
    for (const el of diff.added) {
      const desc = el.name ? `${el.role} "${el.name}"` : el.role;
      lines.push(`  + @${el.ref} ${desc}`);
    }
  }

  if (diff.removed.length > 0) {
    lines.push(`Removed (${diff.removed.length}):`);
    for (const el of diff.removed) {
      const desc = el.name ? `${el.role} "${el.name}"` : el.role;
      lines.push(`  - @${el.ref} ${desc}`);
    }
  }

  if (diff.renamed.length > 0) {
    lines.push(`Renamed (${diff.renamed.length}):`);
    for (const r of diff.renamed) {
      lines.push(`  @${r.ref}: "${r.oldName}" → "${r.newName}"`);
    }
  }

  if (diff.stateChanged.length > 0) {
    lines.push(`State changed (${diff.stateChanged.length}):`);
    for (const sc of diff.stateChanged) {
      const changeDescs = sc.changes.map(
        (c) => `${c.property}: ${c.oldValue} → ${c.newValue}`,
      );
      lines.push(`  @${sc.ref}: ${changeDescs.join(", ")}`);
    }
  }

  return lines.join("\n");
}
