import { existsSync } from "node:fs";

function defaultEnvFile() {
  if (process.env.BRAIN_ENV_FILE) return process.env.BRAIN_ENV_FILE;
  return existsSync("config/deepseek.env") ? "config/deepseek.env" : ".env";
}

/** Load an optional local deployment env file without replacing explicit env vars. */
export function loadServerEnv(file = defaultEnvFile()) {
  try {
    process.loadEnvFile(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
