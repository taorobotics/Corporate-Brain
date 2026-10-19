import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const home = resolve(".cache/dsh-smoke-home");
const workspace = resolve(".cache/dsh-smoke-workspace");
await mkdir(home, { recursive: true });
await mkdir(workspace, { recursive: true });
const env = {};
for (const [key, value] of Object.entries(process.env))
  if (
    [
      "path",
      "systemroot",
      "windir",
      "comspec",
      "temp",
      "tmp",
      "pathext",
      "userprofile",
      "localappdata",
      "appdata",
    ].includes(key.toLowerCase())
  )
    env[key] = value;
const harness = new DeepSeekHarness({
  profile: "sdk-minimal",
  dshHome: home,
  processCwd: workspace,
  cwd: workspace,
  env,
  initializeTimeoutMs: 20000,
  requestTimeoutMs: 20000,
});
const report = {
  version: "0.2.0-rc.2",
  profile: "sdk-minimal",
  home,
  workspace,
  initialize: "pending",
  modelTurn: "not run; no production model credential supplied",
};
try {
  await harness.start();
  report.initialize = "passed";
} catch (error) {
  report.initialize = "failed";
  report.error = error.message.slice(0, 6000);
  process.exitCode = 1;
} finally {
  await harness.close();
}
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/dsh-verification.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
