// Run after the complete, verified GitHub Release has been published.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import mirror from "../shared/update-mirror.cjs";

const env = process.env;
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const tag = env.RELEASE_TAG || `v${version}`;
assert.match(tag, /^v\d+\.\d+\.\d+$/);
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    timeout: 300000,
    stdio: ["ignore", "pipe", "pipe"],
  });
const repo = env.GH_REPO || "taorobotics/Corporate-Brain";
const release = JSON.parse(gh("api", `repos/${repo}/releases/tags/${tag}`));
assert.equal(release.draft, false);
assert.equal(release.prerelease, false);
assert.equal(release.tag_name, tag);
assert.equal(
  JSON.parse(gh("api", `repos/${repo}/releases/latest`)).tag_name,
  tag,
  "Only latest published version may be distributed",
);
const folder = resolve(env.BRAIN_RELEASE_ASSETS || "release-assets");
await mkdir(folder, { recursive: true });
const assets = {};
for (const target of mirror.targets) {
  const name = mirror.installerName(tag.slice(1), target),
    asset = release.assets.find((item) => item.name === name);
  assert.ok(
    asset &&
      asset.state === "uploaded" &&
      /^sha256:[0-9a-f]{64}$/.test(asset.digest),
    "Missing verified GitHub asset",
  );
  assets[target] = { name, bytes: asset.size, sha256: asset.digest.slice(7) };
  try {
    await mirror.verifyAsset(join(folder, name), assets[target]);
  } catch {
    gh(
      "release",
      "download",
      tag,
      "--repo",
      repo,
      "--pattern",
      name,
      "--dir",
      folder,
      "--clobber",
    );
    await mirror.verifyAsset(join(folder, name), assets[target]);
  }
}
const manifest = mirror.validateRelease({
  version: tag.slice(1),
  notes: String(release.body || "").slice(0, 30000),
  publishedAt: release.published_at,
  assets,
});
assert.match(env.BRAIN_UPDATE_HOST || "", /^[a-zA-Z0-9.-]+$/);
assert.match(env.BRAIN_UPDATE_USER || "", /^[a-z_][a-z0-9_-]*$/);
assert.ok(
  env.BRAIN_UPDATE_SSH_KEY && env.BRAIN_UPDATE_KNOWN_HOSTS,
  "Publisher key and pinned SSH host key are required",
);
const temporary = await mkdtemp(join(tmpdir(), "brain-publisher-"));
try {
  const key = join(temporary, "identity"),
    known = join(temporary, "known_hosts");
  await writeFile(key, env.BRAIN_UPDATE_SSH_KEY.trim() + "\n", { mode: 0o600 });
  await writeFile(known, env.BRAIN_UPDATE_KNOWN_HOSTS.trim() + "\n", {
    mode: 0o600,
  });
  let report;
  for (let attempt = 0; attempt < 3; attempt++) {
    const child = spawn(
      "ssh",
      [
        "-i",
        key,
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${known}`,
        "-o",
        "ConnectTimeout=30",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        "-o",
        "IPQoS=none",
        `${env.BRAIN_UPDATE_USER}@${env.BRAIN_UPDATE_HOST}`,
        "publish",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (bytes) => {
      if (output.length < 65536) output += bytes.toString();
    });
    // Never print SSH diagnostics which can contain credential paths or config.
    child.stderr.resume();
    const done = new Promise((accept, reject) => {
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? accept()
          : reject(new Error("Company mirror transfer failed")),
      );
    });
    const timer = setTimeout(() => child.kill(), 20 * 60_000);
    async function* bundle() {
      yield Buffer.from(JSON.stringify(manifest) + "\n");
      for (const target of mirror.targets)
        yield* createReadStream(join(folder, assets[target].name));
    }
    const result = await Promise.allSettled([
      pipeline(Readable.from(bundle()), child.stdin),
      done,
    ]);
    clearTimeout(timer);
    if (result.every((value) => value.status === "fulfilled")) {
      report = JSON.parse(output.trim());
      assert.equal(report.version, manifest.version);
      assert.equal(report.verified, true);
      assert.deepEqual(report.assets, assets);
      break;
    }
    if (attempt === 2)
      throw new Error(
        "Release published, but company distribution failed after 3 attempts. Rerun the sync job; previous mirror remains available.",
      );
    await new Promise((accept) => setTimeout(accept, 5000 * (attempt + 1)));
  }
  await writeFile(
    join(folder, "company-update-distribution.json"),
    JSON.stringify(
      {
        ...report,
        verifiedAt: new Date().toISOString(),
        release: release.html_url,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Company update mirror verified: ${tag}, Windows x64 and both Mac installers`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
