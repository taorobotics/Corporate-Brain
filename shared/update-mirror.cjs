// The wire format is one bounded JSON line, then the three installers in target order.
// No archive paths, shell commands, links or executable metadata are accepted.
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const { join, resolve } = require("node:path");
const targets = ["win32-x64", "darwin-arm64", "darwin-x64"];
const versionPattern = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const installerName = (version, target) =>
  target === "win32-x64"
    ? `Corporate-Brain-Setup-${version}-x64.exe`
    : `Corporate-Brain-${version}-macOS-${target.split("-")[1]}.dmg`;
const compare = (a, b) => {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
};
// Full releases always require all three installers. A private per-platform
// channel is validated against exactly one explicitly selected target.
function channelTargets(target) {
  if (target === undefined) return targets;
  if (!targets.includes(target)) throw new Error("Invalid update target");
  return [target];
}
function validateRelease(value, channelTarget) {
  const expectedTargets = channelTargets(channelTarget);
  if (
    !value ||
    !versionPattern.test(value.version) ||
    typeof value.notes !== "string" ||
    value.notes.length > 30000 ||
    typeof value.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(value.publishedAt)) ||
    !value.assets ||
    Object.keys(value.assets).sort().join() !==
      [...expectedTargets].sort().join()
  )
    throw new Error("Invalid update manifest");
  const assets = {};
  for (const target of expectedTargets) {
    const asset = value.assets[target];
    if (
      !asset ||
      asset.name !== installerName(value.version, target) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      asset.bytes > 2 * 1024 ** 3 ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      throw new Error("Invalid installer manifest");
    assets[target] = {
      name: asset.name,
      bytes: asset.bytes,
      sha256: asset.sha256,
    };
  }
  return {
    version: value.version,
    notes: value.notes,
    publishedAt: value.publishedAt,
    assets,
  };
}
async function readManifest(file, channelTarget) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
    throw new Error("Invalid manifest file");
  return validateRelease(
    JSON.parse(await fs.readFile(file, "utf8")),
    channelTarget,
  );
}
async function verifyAsset(file, asset) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== asset.bytes)
    throw new Error("Invalid installer file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest("hex") !== asset.sha256)
    throw new Error("Installer checksum mismatch");
}
async function importBundle(input, directory, channelTarget) {
  const expectedTargets = channelTargets(channelTarget);
  const root = resolve(directory);
  await fs.mkdir(root, { recursive: true, mode: 0o755 });
  if ((await fs.lstat(root)).isSymbolicLink())
    throw new Error("Mirror root cannot be a link");
  const stage = await fs.mkdtemp(join(root, ".incoming-"));
  let handle,
    release,
    received = 0,
    index = 0,
    hash,
    header = Buffer.alloc(0);
  try {
    for await (const raw of input) {
      let chunk = Buffer.from(raw);
      if (!release) {
        const end = chunk.indexOf(10);
        if (header.length + (end < 0 ? chunk.length : end) > 65536)
          throw new Error("Manifest too large");
        header = Buffer.concat([
          header,
          end < 0 ? chunk : chunk.subarray(0, end),
        ]);
        if (end < 0) continue;
        release = validateRelease(
          JSON.parse(header.toString("utf8")),
          channelTarget,
        );
        const current = await readManifest(
          join(root, "latest.json"),
          channelTarget,
        ).catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (current && compare(release.version, current.version) < 0)
          throw new Error("Update downgrade rejected");
        chunk = chunk.subarray(end + 1);
      }
      while (chunk.length) {
        if (index >= expectedTargets.length)
          throw new Error("Unexpected bundle data");
        const asset = release.assets[expectedTargets[index]];
        if (!handle) {
          handle = await fs.open(join(stage, asset.name), "wx", 0o644);
          hash = createHash("sha256");
        }
        const count = Math.min(chunk.length, asset.bytes - received),
          part = chunk.subarray(0, count);
        await handle.writeFile(part);
        hash.update(part);
        received += count;
        chunk = chunk.subarray(count);
        if (received === asset.bytes) {
          await handle.sync();
          await handle.close();
          handle = null;
          if (hash.digest("hex") !== asset.sha256)
            throw new Error("Installer checksum mismatch");
          received = 0;
          index++;
        }
      }
    }
    if (!release || index !== expectedTargets.length || received !== 0)
      throw new Error("Incomplete update bundle");
    const manifest = JSON.stringify(release) + "\n";
    await fs.writeFile(join(stage, "manifest.json"), manifest, { mode: 0o644 });
    await fs.chmod(stage, 0o755);
    const destination = join(root, release.version);
    const existing = await fs.lstat(destination).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing) {
      if (
        !existing.isDirectory() ||
        existing.isSymbolicLink() ||
        JSON.stringify(
          await readManifest(join(destination, "manifest.json"), channelTarget),
        ) !== JSON.stringify(release)
      )
        throw new Error("Published version is immutable");
      for (const target of expectedTargets)
        await verifyAsset(
          join(destination, release.assets[target].name),
          release.assets[target],
        );
    } else await fs.rename(stage, destination);
    const temporary = join(root, `.latest-${randomUUID()}`);
    await fs.writeFile(temporary, manifest, { mode: 0o644 });
    await fs.rename(temporary, join(root, "latest.json"));
    // Retain three complete versions for clients already downloading. Open file
    // descriptors remain readable during later cleanup on the Linux publisher.
    const versions = (await fs.readdir(root, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          versionPattern.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort((a, b) => compare(b, a));
    for (const version of versions.slice(3)) {
      if (version !== release.version)
        await fs.rm(join(root, version), { recursive: true });
    }
    return release;
  } finally {
    await handle?.close();
    // stage is an absolute, locally generated direct child of the checked root.
    await fs.rm(stage, { recursive: true, force: true });
  }
}
module.exports = {
  targets,
  versionPattern,
  installerName,
  compare,
  validateRelease,
  readManifest,
  verifyAsset,
  importBundle,
};
if (require.main === module) {
  if (![3, 4].includes(process.argv.length))
    throw new Error(
      "Expected fixed update directory and optional private channel target",
    );
  importBundle(process.stdin, process.argv[2], process.argv[3])
    .then((release) => {
      console.log(
        JSON.stringify({
          version: release.version,
          verified: true,
          assets: release.assets,
        }),
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
