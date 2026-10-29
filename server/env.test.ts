import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { loadServerEnv } from "./env";

test("server env loader reads a local DeepSeek env file without requiring it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "corporate-brain-env-test-"));
  const file = join(root, "deepseek.env");
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousMode = process.env.BRAIN_DSH_ENABLED;
  t.after(async () => {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    if (previousMode === undefined) delete process.env.BRAIN_DSH_ENABLED;
    else process.env.BRAIN_DSH_ENABLED = previousMode;
    await rm(root, { recursive: true, force: true });
  });
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.BRAIN_DSH_ENABLED;
  await writeFile(
    file,
    "DEEPSEEK_API_KEY=local-test-key\nBRAIN_DSH_ENABLED=1\n",
  );
  assert.equal(loadServerEnv(file), true);
  assert.equal(process.env.DEEPSEEK_API_KEY, "local-test-key");
  assert.equal(process.env.BRAIN_DSH_ENABLED, "1");
  assert.equal(loadServerEnv(join(root, "missing.env")), false);
});
