import { randomUUID } from "node:crypto";
import type { Store } from "./database";

const models = [
  { name: "DeepSeek Flash", model: "deepseek-flash" },
  { name: "DeepSeek Pro", model: "deepseek-v4-pro" },
] as const;

export type DeepSeekSyncEnv = {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_SYNC_MODELS?: string;
  DEEPSEEK_CHAT_BASE_URL?: string;
};

function baseUrl(env: DeepSeekSyncEnv) {
  const value = (env.DEEPSEEK_CHAT_BASE_URL ?? "https://api.deepseek.com/v1").trim();
  const parsed = new URL(value);
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    (parsed.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("DEEPSEEK_CHAT_BASE_URL 必须是 HTTPS 地址（本机可使用 HTTP）");
  return value.replace(/\/$/, "");
}

/** Sync the explicitly enabled DeepSeek model set into encrypted company connections. */
export function syncDeepSeekConnections(
  store: Store,
  env: DeepSeekSyncEnv = process.env,
) {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey || env.DEEPSEEK_SYNC_MODELS !== "1") return 0;
  const url = baseUrl(env);
  const update = store.db.prepare(
    "UPDATE connections SET base_url=?,model=?,kind='chat',departments='[]',secret=?,enabled=1 WHERE id=?",
  );
  const insert = store.db.prepare(
    "INSERT INTO connections VALUES(?,?,?,?,?,?,?,1)",
  );
  for (const item of models) {
    const existing = store.db
      .prepare("SELECT id FROM connections WHERE name=?")
      .get(item.name) as { id: string } | undefined;
    const secret = store.encrypt(apiKey);
    if (existing) update.run(url, item.model, secret, existing.id);
    else
      insert.run(
        randomUUID(),
        item.name,
        url,
        item.model,
        "chat",
        "[]",
        secret,
      );
  }
  return models.length;
}
