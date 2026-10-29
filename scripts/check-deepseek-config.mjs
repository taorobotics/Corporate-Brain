import { existsSync } from "node:fs";

const file =
  process.env.BRAIN_ENV_FILE ??
  (existsSync("config/deepseek.env") ? "config/deepseek.env" : "");
if (!file) {
  console.error("找不到 config/deepseek.env，请先复制 config/deepseek.env.example");
  process.exit(1);
}
try {
  process.loadEnvFile(file);
} catch (error) {
  console.error(`无法读取 ${file}: ${(error).message}`);
  process.exit(1);
}
const key = process.env.DEEPSEEK_API_KEY?.trim();
if (!key) {
  console.error(`已读取 ${file}，但 DEEPSEEK_API_KEY 为空`);
  process.exit(1);
}
console.log(
  JSON.stringify({
    file,
    dshEnabled: process.env.BRAIN_DSH_ENABLED !== "0",
    syncModels: process.env.DEEPSEEK_SYNC_MODELS === "1",
    chatBaseUrl:
      process.env.DEEPSEEK_CHAT_BASE_URL ?? "https://api.deepseek.com/v1",
    searchBaseUrl:
      process.env.DEEPSEEK_SEARCH_BASE_URL ??
      "https://api.deepseek.com/anthropic/v1",
    apiKey: "configured (value hidden)",
  }, null, 2),
);
