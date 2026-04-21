/**
 * Knowledge Query — Search and Filter Knowledge Artifacts
 *
 * Provides helpers for:
 * - listing all knowledge
 * - searching by domain, kind, tags
 * - full-text search across body/entries
 * - loading specific artifacts
 */

import {
  listAllKnowledge,
  listByKind,
  findByDomain,
  findByName,
  loadArtifact,
} from "./knowledge_store";
import type {
  KnowledgeKind,
  KnowledgeArtifact,
  KnowledgeSummary,
  KnowledgeQueryFilter,
  KnowledgeEntry,
  EntryType,
} from "./knowledge_types";

// ── Query Helpers ───────────────────────────────────────────────────

export interface KnowledgeQueryResult {
  summary: KnowledgeSummary;
  artifact?: KnowledgeArtifact;
}

/**
 * Query knowledge with filters. Returns summaries; pass load=true to include full artifacts.
 */
export function queryKnowledge(
  filter: KnowledgeQueryFilter = {},
  options: { load?: boolean } = {},
): KnowledgeQueryResult[] {
  let summaries = listAllKnowledge();

  // Filter by kind
  if (filter.kind) {
    summaries = summaries.filter((s) => s.kind === filter.kind);
  }

  // Filter by domain (substring match)
  if (filter.domain) {
    const domainLower = filter.domain.toLowerCase();
    summaries = summaries.filter((s) =>
      s.kind === "domain-skill" && s.identifier.toLowerCase().includes(domainLower)
    );
  }

  // Filter by tags
  if (filter.tags && filter.tags.length > 0) {
    const tagSet = new Set(filter.tags.map((t) => t.toLowerCase()));
    summaries = summaries.filter((s) =>
      s.tags.some((t) => tagSet.has(t.toLowerCase()))
    );
  }

  // Filter by verified
  if (filter.verified !== undefined) {
    summaries = summaries.filter((s) => s.verified === filter.verified);
  }

  // Full-text search
  if (filter.search) {
    const searchLower = filter.search.toLowerCase();
    summaries = summaries.filter((s) => {
      // Always check identifier
      if (s.identifier.toLowerCase().includes(searchLower)) return true;

      // If loading artifacts, check body and entries
      if (options.load) {
        const artifact = loadArtifact(s.filePath);
        if (!artifact) return false;
        if (artifact.body.toLowerCase().includes(searchLower)) return true;
        return artifact.entries.some((e) =>
          e.description.toLowerCase().includes(searchLower)
        );
      }

      // Without loading, we can only match on identifier
      return s.identifier.toLowerCase().includes(searchLower);
    });
  }

  if (options.load) {
    return summaries.map((s) => ({
      summary: s,
      artifact: loadArtifact(s.filePath) ?? undefined,
    }));
  }

  return summaries.map((s) => ({ summary: s }));
}

/**
 * Search interaction skills by topic/keyword.
 */
export function searchInteractionSkills(keyword: string): KnowledgeQueryResult[] {
  return queryKnowledge({ kind: "interaction-skill", search: keyword }, { load: true });
}

/**
 * Search domain skills for a specific domain.
 */
export function searchDomainKnowledge(domain: string): KnowledgeArtifact | null {
  return findByDomain(domain);
}

/**
 * Get all entries of a specific type across all domain skills.
 */
export function getEntriesByType(type: EntryType): Array<{ domain: string; entry: KnowledgeEntry }> {
  const results: Array<{ domain: string; entry: KnowledgeEntry }> = [];
  const domains = listByKind("domain-skill");

  for (const summary of domains) {
    const artifact = loadArtifact(summary.filePath);
    if (!artifact) continue;
    for (const entry of artifact.entries) {
      if (entry.type === type) {
        results.push({ domain: summary.identifier, entry });
      }
    }
  }

  return results;
}

/**
 * Get knowledge for a specific domain, returning null if not found.
 */
export function getDomainSkill(domain: string): KnowledgeArtifact | null {
  return findByDomain(domain);
}

/**
 * Get a specific interaction skill by name.
 */
export function getInteractionSkill(name: string): KnowledgeArtifact | null {
  return findByName(name);
}

/**
 * List all known domains that have knowledge stored.
 */
export function listKnownDomains(): string[] {
  return listByKind("domain-skill").map((s) => s.identifier);
}

/**
 * List all interaction skill names.
 */
export function listInteractionSkillNames(): string[] {
  return listByKind("interaction-skill").map((s) => s.identifier);
}

/**
 * Get a lightweight stats summary of the knowledge base.
 */
export function getKnowledgeStats(): {
  totalFiles: number;
  interactionSkills: number;
  domainSkills: number;
  totalEntries: number;
  verifiedEntries: number;
} {
  const all = listAllKnowledge();
  const interactionSkills = all.filter((s) => s.kind === "interaction-skill").length;
  const domainSkills = all.filter((s) => s.kind === "domain-skill").length;

  let totalEntries = 0;
  let verifiedEntries = 0;
  for (const summary of all) {
    totalEntries += summary.entryCount;
    if (summary.verified) verifiedEntries += summary.entryCount;
  }

  return {
    totalFiles: all.length,
    interactionSkills,
    domainSkills,
    totalEntries,
    verifiedEntries,
  };
}
