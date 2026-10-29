import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "./database";
import { syncDeepSeekConnections } from "./deepseek-sync";

test("syncs DeepSeek Flash and Pro as encrypted company chat connections", () => {
  const store = createStore(":memory:");
  try {
    const synced = syncDeepSeekConnections(store, {
      DEEPSEEK_API_KEY: "deepseek-sync-test-key",
      DEEPSEEK_SYNC_MODELS: "1",
      DEEPSEEK_CHAT_BASE_URL: "https://api.deepseek.com/v1",
    });
    assert.equal(synced, 2);
    const rows = store.db
      .prepare(
        "SELECT name,base_url,model,kind,departments,secret,enabled FROM connections ORDER BY model",
      )
      .all() as any[];
    assert.deepEqual(
      rows.map((row) => [row.name, row.base_url, row.model, row.kind, row.departments, row.enabled]),
      [
        ["DeepSeek Flash", "https://api.deepseek.com/v1", "deepseek-flash", "chat", "[]", 1],
        ["DeepSeek Pro", "https://api.deepseek.com/v1", "deepseek-v4-pro", "chat", "[]", 1],
      ],
    );
    assert.ok(rows.every((row) => row.secret !== "deepseek-sync-test-key"));
    assert.equal(store.decrypt(rows[0].secret), "deepseek-sync-test-key");
    assert.equal(syncDeepSeekConnections(store, { DEEPSEEK_API_KEY: "rotated-key", DEEPSEEK_SYNC_MODELS: "1" }), 2);
    assert.equal(store.decrypt((store.db.prepare("SELECT secret FROM connections LIMIT 1").get() as any).secret), "rotated-key");
  } finally {
    store.close();
  }
});

test("does not create DeepSeek connections without explicit sync configuration", () => {
  const store = createStore(":memory:");
  try {
    assert.equal(syncDeepSeekConnections(store, { DEEPSEEK_API_KEY: "key" }), 0);
    assert.equal(
      (store.db.prepare("SELECT COUNT(*) AS count FROM connections").get() as { count: number }).count,
      0,
    );
  } finally {
    store.close();
  }
});
