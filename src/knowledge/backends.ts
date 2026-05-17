import { getEntriesByType, queryKnowledge } from "./query";
import type { EntryType, KnowledgeEntry, KnowledgeQueryFilter } from "./types";
import { sanitizeString } from "../providers/utils";

export type KnowledgeBackendType = "local-markdown" | "qdrant" | "pageindex";

export interface KnowledgeBackendConfig {
  type: KnowledgeBackendType;
  endpoint?: string;
  apiKey?: string;
  collection?: string;
  embedText?: (text: string) => Promise<number[]> | number[];
  fetch?: typeof fetch;
}

export interface KnowledgeBackendCatalogEntry {
  type: KnowledgeBackendType;
  label: string;
  default: boolean;
  remote: boolean;
  requiresEndpoint: boolean;
  requiresAuth: boolean;
  status: "available" | "extension-point";
  setupHint: string;
}

export interface KnowledgeBackendHealth {
  type: KnowledgeBackendType;
  ok: boolean;
  checkedAt: string;
  summary: string;
}

export interface RankedKnowledgeEntry {
  domain: string;
  entry: KnowledgeEntry;
  score: number;
  reasons: string[];
}

export interface KnowledgeBackend {
  readonly type: KnowledgeBackendType;
  health(): Promise<KnowledgeBackendHealth>;
  search(filter: KnowledgeQueryFilter): Promise<ReturnType<typeof queryKnowledge>>;
  rankEntries(input: {
    domain?: string;
    query: string;
    entryType?: EntryType;
    limit?: number;
  }): Promise<RankedKnowledgeEntry[]>;
}

export function getKnowledgeBackendCatalog(): KnowledgeBackendCatalogEntry[] {
  return [
    {
      type: "local-markdown",
      label: "Local Markdown Knowledge",
      default: true,
      remote: false,
      requiresEndpoint: false,
      requiresAuth: false,
      status: "available",
      setupHint: "Default data-home markdown knowledge store. No external service required.",
    },
    {
      type: "qdrant",
      label: "Qdrant Vector Memory",
      default: false,
      remote: true,
      requiresEndpoint: true,
      requiresAuth: false,
      status: "extension-point",
      setupHint: "Optional future adapter for semantic vector ranking. Not default-enabled.",
    },
    {
      type: "pageindex",
      label: "PageIndex Site Memory",
      default: false,
      remote: true,
      requiresEndpoint: true,
      requiresAuth: false,
      status: "extension-point",
      setupHint: "Optional future adapter for tree-index site memory. Not default-enabled.",
    },
  ];
}

export class LocalMarkdownKnowledgeBackend implements KnowledgeBackend {
  readonly type = "local-markdown";

  async health(): Promise<KnowledgeBackendHealth> {
    return {
      type: this.type,
      ok: true,
      checkedAt: new Date().toISOString(),
      summary: "Local markdown knowledge backend is available.",
    };
  }

  async search(filter: KnowledgeQueryFilter): Promise<ReturnType<typeof queryKnowledge>> {
    return queryKnowledge(filter, { load: true });
  }

  async rankEntries(input: {
    domain?: string;
    query: string;
    entryType?: EntryType;
    limit?: number;
  }): Promise<RankedKnowledgeEntry[]> {
    const terms = tokenize(input.query);
    const source = input.entryType
      ? getEntriesByType(input.entryType)
      : collectAllEntries(input.domain);
    const now = Date.now();
    const staleThresholdMs = 30 * 24 * 60 * 60 * 1000; // 30 days
    const ranked = source
      .filter((item) => !input.domain || item.domain.toLowerCase().includes(input.domain.toLowerCase()))
      .map((item) => {
        const base = scoreEntry(item, terms);
        // Apply stale locator scoring: reduce score for entries not verified recently
        // For unverified entries, use capturedAt (lastVerified is set to "now" for all entries during parsing)
        const lastVerifiedMs = item.entry.verified && item.entry.lastVerified
          ? new Date(item.entry.lastVerified).getTime()
          : new Date(item.entry.capturedAt).getTime();
        const ageMs = now - lastVerifiedMs;
        if (!item.entry.verified && ageMs > staleThresholdMs) {
          // Unverified entries older than 30 days get a significant penalty
          base.score = Math.max(0, base.score - 10);
          base.reasons.push("stale:unverified-older-than-30d");
        } else if (item.entry.verified && ageMs > staleThresholdMs * 3) {
          // Verified entries older than 90 days get a mild penalty
          base.score = Math.max(0, base.score - 3);
          base.reasons.push("stale:verified-older-than-90d");
        }
        return base;
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
    return ranked.slice(0, input.limit ?? 10);
  }
}

export class UnsupportedKnowledgeBackend implements KnowledgeBackend {
  readonly type: Exclude<KnowledgeBackendType, "local-markdown">;

  constructor(
    type: Exclude<KnowledgeBackendType, "local-markdown">,
    private readonly config: KnowledgeBackendConfig,
  ) {
    this.type = type;
  }

  async health(): Promise<KnowledgeBackendHealth> {
    const endpoint = this.config.endpoint ? "endpoint configured" : "endpoint missing";
    return {
      type: this.type,
      ok: false,
      checkedAt: new Date().toISOString(),
      summary: `${this.type} knowledge backend adapter is not implemented in this build (${endpoint}).`,
    };
  }

  async search(_filter: KnowledgeQueryFilter): Promise<ReturnType<typeof queryKnowledge>> {
    throw new Error(`${this.type} knowledge backend adapter is not implemented in this build.`);
  }

  async rankEntries(): Promise<RankedKnowledgeEntry[]> {
    throw new Error(`${this.type} knowledge backend adapter is not implemented in this build.`);
  }
}

export class QdrantKnowledgeBackend implements KnowledgeBackend {
  readonly type = "qdrant";

  private readonly endpoint: string;
  private readonly collection: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: KnowledgeBackendConfig) {
    if (!config.endpoint) throw new Error("Qdrant knowledge backend requires an endpoint.");
    this.endpoint = config.endpoint.replace(/\/+$/u, "");
    this.collection = config.collection ?? "browser-control-knowledge";
    this.fetchImpl = config.fetch ?? fetch;
  }

  async health(): Promise<KnowledgeBackendHealth> {
    try {
      const response = await this.fetchImpl(`${this.endpoint}/collections/${encodeURIComponent(this.collection)}`, {
        headers: this.headers(),
      });
      return {
        type: this.type,
        ok: response.ok,
        checkedAt: new Date().toISOString(),
        summary: response.ok
          ? `Qdrant collection "${this.collection}" is reachable.`
          : `Qdrant collection "${this.collection}" returned HTTP ${response.status}.`,
      };
    } catch (error) {
      return {
        type: this.type,
        ok: false,
        checkedAt: new Date().toISOString(),
        summary: `Qdrant health check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async search(filter: KnowledgeQueryFilter): Promise<ReturnType<typeof queryKnowledge>> {
    const ranked = await this.rankEntries({
      domain: filter.domain,
      query: filter.search ?? filter.domain ?? "",
      limit: 10,
    });
    return ranked.map((item) => ({
      summary: {
        kind: "domain-skill",
        identifier: item.domain,
        filePath: `qdrant://${this.collection}/${item.domain}`,
        capturedAt: item.entry.capturedAt,
        verified: item.entry.verified,
        entryCount: 1,
        tags: item.reasons,
      },
    }));
  }

  async rankEntries(input: {
    domain?: string;
    query: string;
    entryType?: EntryType;
    limit?: number;
  }): Promise<RankedKnowledgeEntry[]> {
    if (!this.config.embedText) {
      throw new Error("Qdrant knowledge backend requires an embedText function for ranking.");
    }
    const vector = await this.config.embedText(input.query);
    const response = await this.fetchImpl(`${this.endpoint}/collections/${encodeURIComponent(this.collection)}/points/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.headers(),
      },
      body: JSON.stringify({
        query: vector,
        limit: input.limit ?? 10,
        with_payload: true,
        ...(input.domain || input.entryType ? { filter: buildQdrantFilter(input.domain, input.entryType) } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`Qdrant query failed with HTTP ${response.status}.`);
    }
    const payload = await response.json() as {
      result?: { points?: QdrantPoint[] } | QdrantPoint[];
    };
    const points = Array.isArray(payload.result)
      ? payload.result
      : payload.result?.points ?? [];
    return points.map((point) => qdrantPointToRanked(point)).filter((entry): entry is RankedKnowledgeEntry => Boolean(entry));
  }

  private headers(): Record<string, string> {
    return this.config.apiKey ? { "api-key": this.config.apiKey } : {};
  }
}

export class PageIndexKnowledgeBackend implements KnowledgeBackend {
  readonly type = "pageindex";

  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: KnowledgeBackendConfig) {
    if (!config.endpoint) throw new Error("PageIndex knowledge backend requires an endpoint.");
    this.endpoint = config.endpoint.replace(/\/+$/u, "");
    this.fetchImpl = config.fetch ?? fetch;
  }

  async health(): Promise<KnowledgeBackendHealth> {
    try {
      const response = await this.fetchImpl(`${this.endpoint}/health`, {
        headers: this.headers(),
      });
      return {
        type: this.type,
        ok: response.ok,
        checkedAt: new Date().toISOString(),
        summary: response.ok
          ? "PageIndex service is reachable."
          : `PageIndex returned HTTP ${response.status}.`,
      };
    } catch (error) {
      return {
        type: this.type,
        ok: false,
        checkedAt: new Date().toISOString(),
        summary: `PageIndex health check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async search(filter: KnowledgeQueryFilter): Promise<ReturnType<typeof queryKnowledge>> {
    const query = filter.search ?? filter.domain ?? "";
    const response = await this.fetchImpl(`${this.endpoint}/api/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.headers(),
      },
      body: JSON.stringify({
        query,
        domain: filter.domain,
        tags: filter.tags,
        limit: 10,
      }),
    });
    if (!response.ok) {
      throw new Error(`PageIndex search failed with HTTP ${response.status}.`);
    }
    const payload = await response.json() as {
      results?: Array<{ domain: string; type: string; description: string; selector?: string; score?: number }>;
    };
    const results = payload.results ?? [];
    return results.map((r) => ({
      summary: {
        kind: "domain-skill",
        identifier: r.domain,
        filePath: `pageindex://${r.domain}`,
        capturedAt: new Date().toISOString(),
        verified: false,
        entryCount: 1,
        tags: [],
      },
    }));
  }

  async rankEntries(input: {
    domain?: string;
    query: string;
    entryType?: EntryType;
    limit?: number;
  }): Promise<RankedKnowledgeEntry[]> {
    const response = await this.fetchImpl(`${this.endpoint}/api/rank`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.headers(),
      },
      body: JSON.stringify({
        query: input.query,
        domain: input.domain,
        entryType: input.entryType,
        limit: input.limit ?? 10,
      }),
    });
    if (!response.ok) {
      throw new Error(`PageIndex ranking failed with HTTP ${response.status}.`);
    }
    const payload = await response.json() as {
      results?: Array<{ domain: string; type: string; description: string; selector?: string; role?: string; name?: string; pattern?: string; waitCondition?: string; verified?: boolean; capturedAt?: string; lastVerified?: string; score?: number }>;
    };
    const results = payload.results ?? [];
    return results.map((r) => {
      const entry: KnowledgeEntry = {
        type: (r.type as EntryType) ?? "stable-selector",
        description: r.description ?? "",
        selector: r.selector,
        role: r.role,
        name: r.name,
        pattern: r.pattern,
        waitCondition: r.waitCondition,
        verified: r.verified === true,
        capturedAt: r.capturedAt ?? new Date().toISOString(),
        lastVerified: r.lastVerified ?? new Date().toISOString(),
      };
      return {
        domain: r.domain ?? "unknown",
        entry,
        score: typeof r.score === "number" ? r.score : 0,
        reasons: ["pageindex"],
      };
    }).filter((r) => r.entry.description.length > 0);
  }

  private headers(): Record<string, string> {
    return this.config.apiKey ? { "api-key": this.config.apiKey } : {};
  }
}

export function createKnowledgeBackend(config: KnowledgeBackendConfig = { type: "local-markdown" }): KnowledgeBackend {
  switch (config.type) {
    case "local-markdown":
      return new LocalMarkdownKnowledgeBackend();
    case "qdrant":
      return config.endpoint
        ? new QdrantKnowledgeBackend(config)
        : new UnsupportedKnowledgeBackend("qdrant", sanitizeBackendConfig(config));
    case "pageindex":
      return config.endpoint
        ? new PageIndexKnowledgeBackend(config)
        : new UnsupportedKnowledgeBackend("pageindex", sanitizeBackendConfig(config));
  }
}

interface QdrantPoint {
  score?: number;
  payload?: Record<string, unknown>;
}

function buildQdrantFilter(domain?: string, entryType?: EntryType): Record<string, unknown> {
  const must: Array<Record<string, unknown>> = [];
  if (domain) must.push({ key: "domain", match: { value: domain } });
  if (entryType) must.push({ key: "type", match: { value: entryType } });
  return { must };
}

function qdrantPointToRanked(point: QdrantPoint): RankedKnowledgeEntry | null {
  const payload = point.payload ?? {};
  const domain = typeof payload.domain === "string" ? payload.domain : "unknown";
  const type = typeof payload.type === "string" ? payload.type as EntryType : "stable-selector";
  const description = typeof payload.description === "string" ? payload.description : "";
  if (!description) return null;
  const entry: KnowledgeEntry = {
    type,
    description,
    selector: typeof payload.selector === "string" ? payload.selector : undefined,
    role: typeof payload.role === "string" ? payload.role : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    pattern: typeof payload.pattern === "string" ? payload.pattern : undefined,
    waitCondition: typeof payload.waitCondition === "string" ? payload.waitCondition : undefined,
    verified: payload.verified === true,
    capturedAt: typeof payload.capturedAt === "string" ? payload.capturedAt : new Date().toISOString(),
    lastVerified: typeof payload.lastVerified === "string" ? payload.lastVerified : new Date().toISOString(),
  };
  return {
    domain,
    entry,
    score: typeof point.score === "number" ? point.score : 0,
    reasons: ["qdrant"],
  };
}

function collectAllEntries(domain?: string): Array<{ domain: string; entry: KnowledgeEntry }> {
  const results: Array<{ domain: string; entry: KnowledgeEntry }> = [];
  for (const result of queryKnowledge(
    { kind: "domain-skill", ...(domain ? { domain } : {}) },
    { load: true },
  )) {
    if (!result.artifact) continue;
    for (const entry of result.artifact.entries) {
      results.push({ domain: result.summary.identifier, entry });
    }
  }
  return results;
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      sanitizeString(text)
        .toLowerCase()
        .split(/[^a-z0-9.-]+/u)
        .filter((term) => term.length >= 2),
    ),
  );
}

function scoreEntry(item: { domain: string; entry: KnowledgeEntry }, terms: string[]): RankedKnowledgeEntry {
  const haystack = [
    item.domain,
    item.entry.type,
    item.entry.description,
    item.entry.selector,
    item.entry.role,
    item.entry.name,
    item.entry.pattern,
    item.entry.waitCondition,
  ].filter(Boolean).join(" ").toLowerCase();
  let score = item.entry.verified ? 5 : 0;
  const reasons: string[] = item.entry.verified ? ["verified"] : [];
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += term.length;
      reasons.push(`matched:${term}`);
    }
  }
  return { ...item, score, reasons };
}

function sanitizeBackendConfig(config: KnowledgeBackendConfig): KnowledgeBackendConfig {
  const { apiKey: _apiKey, embedText: _embedText, fetch: _fetch, ...safe } = config;
  return safe;
}
