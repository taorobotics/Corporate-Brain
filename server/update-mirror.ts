import type { Express } from "express";
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import mirror from "../shared/update-mirror.cjs";

export function mountUpdateMirror(app: Express, directory: string) {
  const root = resolve(directory);
  const verified = new Map<string, string>();
  async function releaseAt(version?: string) {
    if ((await lstat(root)).isSymbolicLink())
      throw new Error("Invalid mirror root");
    const release = await mirror.readManifest(
      join(root, version ? `${version}/manifest.json` : "latest.json"),
    );
    if (version && release.version !== version)
      throw new Error("Version mismatch");
    const folder = join(root, release.version),
      stat = await lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Invalid release folder");
    for (const target of mirror.targets) {
      const asset = release.assets[target],
        file = join(folder, asset.name),
        info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== asset.bytes)
        throw new Error("Invalid installer");
      const fingerprint = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:${asset.sha256}`;
      if (verified.get(file) !== fingerprint) {
        await mirror.verifyAsset(file, asset);
        verified.set(file, fingerprint);
      }
    }
    if (verified.size > 30) verified.clear();
    return release;
  }
  // Same authenticated API as v0.2.0+, including v0.9.0. No GitHub access on
  // employee devices or production server, and no private download URLs exposed.
  app.get("/api/desktop-updates/latest", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json({ configured: true, release: await releaseAt() });
    } catch {
      res
        .status(503)
        .json({
          configured: true,
          release: null,
          reason: "provider-unavailable",
          error: "更新正在准备或暂时不可用，请稍后重试；持续失败请联系管理员。",
        });
    }
  });
  app.get("/api/desktop-updates/:version/:target", async (req, res) => {
    if (
      !mirror.versionPattern.test(req.params.version) ||
      !mirror.targets.includes(req.params.target)
    ) {
      res.status(400).json({ error: "更新版本或平台无效" });
      return;
    }
    try {
      const release = await releaseAt(req.params.version),
        asset = release.assets[req.params.target];
      res.setHeader("Cache-Control", "private, no-cache");
      res.setHeader("ETag", `"${asset.sha256}"`);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${asset.name}"`,
      );
      res.sendFile(
        join(root, release.version, asset.name),
        { acceptRanges: true, cacheControl: false, lastModified: false },
        (error) => {
          if (!error) return;
          if (res.headersSent) res.destroy();
          else
            res
              .status((error as { status?: number }).status === 416 ? 416 : 503)
              .end();
        },
      );
    } catch {
      res.status(409).json({ error: "此安装包暂不可用，请重新检查更新" });
    }
  });
}
