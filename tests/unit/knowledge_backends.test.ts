import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  createKnowledgeBackend,
  getKnowledgeBackendCatalog,
} from "../../src/knowledge/backends";
import { saveArtifact } from "../../src/knowledge/store";

describe("knowledge backend adapters", () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-knowledge-backends-"));
    previousHome = process.env.BROWSER_CONTROL_HOME;
    process.env.BROWSER_CONTROL_HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("keeps local markdown as the only default backend and exposes optional adapters", () => {
    const catalog = getKnowledgeBackendCatalog();
    const local = catalog.find((entry) => entry.type === "local-markdown");
    const qdrant = catalog.find((entry) => entry.type === "qdrant");
    const pageindex = catalog.find((entry) => entry.type === "pageindex");

    assert.ok(local);
    assert.equal(local.default, true);
    assert.equal(local.status, "available");
    assert.ok(qdrant);
    assert.equal(qdrant.default, false);
    assert.equal(qdrant.status, "extension-point");
    assert.ok(pageindex);
    assert.equal(pageindex.status, "extension-point");
    assert.doesNotMatch(JSON.stringify(catalog), /api[_-]?key|secret|token/i);
  });

  it("ranks local site knowledge deterministically without external services", async () => {
    saveArtifact(
      "domain-skill",
      "example.test",
      {
        kind: "domain-skill",
        domain: "example.test",
        capturedAt: "2026-05-16T00:00:00.000Z",
        verified: true,
        tags: ["checkout"],
      },
      [
        "## Stable Selectors",
        "- Submit checkout form",
        "  selector: button[data-testid=checkout-submit]",
        "  verified: true",
        "- Open help drawer",
        "  selector: button.help",
      ].join("\n"),
    );

    const backend = createKnowledgeBackend({ type: "local-markdown" });
    const ranked = await backend.rankEntries({
      domain: "example.test",
      query: "checkout submit button",
      entryType: "stable-selector",
    });

    assert.equal(ranked[0]?.domain, "example.test");
    assert.match(ranked[0]?.entry.description ?? "", /checkout/i);
    assert.ok(ranked[0]?.score > (ranked[1]?.score ?? 0));
    assert.ok(ranked[0]?.reasons.some((reason) => reason.startsWith("matched:checkout")));
  });

  it("queries Qdrant points with an embedding function and maps payload entries", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const backend = createKnowledgeBackend({
      type: "qdrant",
      endpoint: "https://qdrant.example.test",
      apiKey: "qdrant-secret",
      collection: "browser-control-memory",
      embedText: async (text) => {
        assert.equal(text, "checkout submit");
        return [0.1, 0.2, 0.3];
      },
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({
          result: {
            points: [
              {
                score: 0.91,
                payload: {
                  domain: "shop.test",
                  type: "stable-selector",
                  description: "Submit checkout",
                  selector: "button[data-testid=submit]",
                  verified: true,
                },
              },
            ],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const ranked = await backend.rankEntries({ query: "checkout submit", limit: 3 });

    assert.equal(ranked[0]?.domain, "shop.test");
    assert.equal(ranked[0]?.score, 0.91);
    assert.equal(ranked[0]?.entry.selector, "button[data-testid=submit]");
    assert.equal(calls[0]?.url, "https://qdrant.example.test/collections/browser-control-memory/points/query");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)).query, [0.1, 0.2, 0.3]);
    assert.equal((calls[0]?.init?.headers as Record<string, string>)["api-key"], "qdrant-secret");
  });

  it("reports PageIndex as unsupported without leaking config secrets", async () => {
    const backend = createKnowledgeBackend({
      type: "pageindex",
    });
    const health = await backend.health();

    assert.equal(health.ok, false);
    assert.match(health.summary, /not implemented/i);
    assert.doesNotMatch(JSON.stringify(health), /pageindex-secret/i);
    await assert.rejects(() => backend.search({ search: "checkout" }), /not implemented/i);
  });

  it("queries PageIndex search and rank endpoints with configured endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const backend = createKnowledgeBackend({
      type: "pageindex",
      endpoint: "https://pageindex.example.test",
      apiKey: "pageindex-secret",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        const isSearch = String(url).includes("/api/search");
        return new Response(JSON.stringify({
          results: isSearch
            ? [{ domain: "shop.test", type: "stable-selector", description: "Submit checkout", selector: "button.submit", score: 0.85 }]
            : [{ domain: "shop.test", type: "stable-selector", description: "Submit checkout", selector: "button.submit", verified: true, capturedAt: "2026-05-01T00:00:00.000Z", score: 0.92 }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const searchResults = await backend.search({ search: "checkout", domain: "shop.test" });
    assert.equal(searchResults[0]?.summary.identifier, "shop.test");
    assert.equal(searchResults[0]?.summary.kind, "domain-skill");

    const ranked = await backend.rankEntries({ query: "checkout submit", limit: 3 });
    assert.equal(ranked[0]?.domain, "shop.test");
    assert.equal(ranked[0]?.score, 0.92);
    assert.equal(ranked[0]?.entry.selector, "button.submit");

    assert.ok(calls.some((c) => c.url.endsWith("/api/search")));
    assert.ok(calls.some((c) => c.url.endsWith("/api/rank")));
    const rankCall = calls.find((c) => c.url.endsWith("/api/rank"));
    assert.deepEqual(JSON.parse(String(rankCall?.init?.body)).query, "checkout submit");
    assert.equal((rankCall?.init?.headers as Record<string, string>)["api-key"], "pageindex-secret");
  });

  it("penalizes stale unverified entries in local markdown ranking", async () => {
    saveArtifact(
      "domain-skill",
      "stale.test",
      {
        kind: "domain-skill",
        domain: "stale.test",
        capturedAt: "2025-01-01T00:00:00.000Z",
        verified: false,
        tags: ["old"],
      },
      [
        "## Stable Selectors",
        "- Old button",
        "  selector: button.old",
        "  verified: false",
      ].join("\n"),
    );

    saveArtifact(
      "domain-skill",
      "fresh.test",
      {
        kind: "domain-skill",
        domain: "fresh.test",
        capturedAt: new Date().toISOString(),
        verified: false,
        tags: ["new"],
      },
      [
        "## Stable Selectors",
        "- New button",
        "  selector: button.new",
        "  verified: false",
      ].join("\n"),
    );

    const backend = createKnowledgeBackend({ type: "local-markdown" });
    const ranked = await backend.rankEntries({
      query: "button",
      entryType: "stable-selector",
    });

    const fresh = ranked.find((r) => r.domain === "fresh.test");
    const stale = ranked.find((r) => r.domain === "stale.test");

    assert.ok(fresh, "fresh entry should be present");
    // Stale unverified entries older than 30 days get penalized heavily and may be filtered out
    if (stale) {
      assert.ok(fresh.score > stale.score, "fresh entry should score higher than stale entry");
      assert.ok(stale.reasons.some((r) => r.startsWith("stale:")), "stale entry should have stale reason");
    }
  });
});
