import assert from "node:assert/strict";
import test from "node:test";

import { MemoryStore } from "../../memory_store";
import { SkillMemoryStore } from "../../skill_memory";

test("SkillMemoryStore prefixes keys with skill:{name}:", () => {
  const store = new MemoryStore({ filename: ":memory:" });
  try {
    const scoped = new SkillMemoryStore(store, "framer");
    scoped.set("positions", { x: 10, y: 20 });

    // Raw store should have the prefixed key
    const raw = store.get("skill:framer:positions");
    assert.deepEqual(raw, { x: 10, y: 20 });

    // Scoped store should return the same value via simple key
    const value = scoped.get<{ x: number; y: number }>("positions");
    assert.deepEqual(value, { x: 10, y: 20 });
  } finally {
    store.close();
  }
});

test("SkillMemoryStore delete removes the prefixed key", () => {
  const store = new MemoryStore({ filename: ":memory:" });
  try {
    const scoped = new SkillMemoryStore(store, "exness");
    scoped.set("token", "abc123");
    assert.ok(scoped.get("token") !== null);

    scoped.delete("token");
    assert.equal(scoped.get("token"), null);
    assert.equal(store.get("skill:exness:token"), null);
  } finally {
    store.close();
  }
});

test("SkillMemoryStore keys returns unprefixed keys", () => {
  const store = new MemoryStore({ filename: ":memory:" });
  try {
    const scoped = new SkillMemoryStore(store, "adobe");
    scoped.set("lastUpload", "file1.png");
    scoped.set("lastStatus", "approved");

    const keys = scoped.keys();
    assert.ok(keys.includes("lastUpload"));
    assert.ok(keys.includes("lastStatus"));
    assert.equal(keys.length, 2);
  } finally {
    store.close();
  }
});

test("SkillMemoryStore keys with prefix filter", () => {
  const store = new MemoryStore({ filename: ":memory:" });
  try {
    const scoped = new SkillMemoryStore(store, "my-skill");
    scoped.set("config:theme", "dark");
    scoped.set("config:lang", "en");
    scoped.set("state:step", 3);

    const configKeys = scoped.keys("config:");
    assert.ok(configKeys.includes("config:theme"));
    assert.ok(configKeys.includes("config:lang"));
    assert.equal(configKeys.length, 2);
  } finally {
    store.close();
  }
});

test("SkillMemoryStore clear removes all scoped keys but not other keys", () => {
  const store = new MemoryStore({ filename: ":memory:" });
  try {
    const scoped1 = new SkillMemoryStore(store, "skill-a");
    const scoped2 = new SkillMemoryStore(store, "skill-b");

    scoped1.set("data", "from-a");
    scoped2.set("data", "from-b");
    store.set("global:key", "global-val");

    scoped1.clear();

    assert.equal(scoped1.get("data"), null);
    assert.equal(scoped2.get("data"), "from-b");
    assert.equal(store.get("global:key"), "global-val");
  } finally {
    store.close();
  }
});

test("SkillMemoryStore isolates skills from each other", () => {
  const store = new MemoryStore({ filename: ":memory:" });
  try {
    const scopedA = new SkillMemoryStore(store, "alpha");
    const scopedB = new SkillMemoryStore(store, "beta");

    scopedA.set("shared-key", "value-a");
    scopedB.set("shared-key", "value-b");

    assert.equal(scopedA.get("shared-key"), "value-a");
    assert.equal(scopedB.get("shared-key"), "value-b");
  } finally {
    store.close();
  }
});

test("SkillMemoryStore getPrefix returns the expected prefix", () => {
  const store = new MemoryStore({ filename: ":memory:" });
  try {
    const scoped = new SkillMemoryStore(store, "test");
    assert.equal(scoped.getPrefix(), "skill:test:");
  } finally {
    store.close();
  }
});

test("SkillMemoryStore getRawStore returns the underlying store", () => {
  const store = new MemoryStore({ filename: ":memory:" });
  try {
    const scoped = new SkillMemoryStore(store, "test");
    assert.equal(scoped.getRawStore(), store);
  } finally {
    store.close();
  }
});

test("SkillMemoryStore TTL is passed through to the raw store", () => {
  const store = new MemoryStore({ filename: ":memory:" });
  try {
    const scoped = new SkillMemoryStore(store, "ttl-test");
    scoped.set("temp", "data", 1000); // 1 second TTL

    // Key should exist immediately
    assert.equal(scoped.get("temp"), "data");

    // Raw key should also exist
    assert.equal(store.get("skill:ttl-test:temp"), "data");
  } finally {
    store.close();
  }
});
