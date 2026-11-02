import type { Express } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DesktopRelease, UpdateFeed } from "../shared/updates";
import { mountUpdateMirror } from "./update-mirror";

export type UpdateOptions = {
  directory?: string;
  token?: string;
  publicSource?: boolean;
  fetch?: typeof fetch;
};
const repository = "taorobotics/Corporate-Brain";
const apiRoot = `https://api.github.com/repos/${repository}`;
const versionPattern = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const targets = ["win32-x64", "darwin-arm64", "darwin-x64"];
export function installerName(version: string, target: string) {
  return target === "win32-x64"
    ? `Corporate-Brain-Setup-${version}-x64.exe`
    : `Corporate-Brain-${version}-macOS-${target.split("-")[1]}.dmg`;
}

// Mounted after company authentication. GitHub credentials and signed CDN URLs
// never cross this boundary into the employee renderer or desktop package.
export function mountUpdates(app: Express, options: UpdateOptions = {}) {
  const directory = options.directory ?? process.env.BRAIN_UPDATE_DIRECTORY;
  if (directory) {
    mountUpdateMirror(app, directory);
    return;
  }
  const token = options.token ?? process.env.BRAIN_GITHUB_TOKEN ?? "";
  // Optional GitHub proxy for other deployments. Private repositories require
  // a server-only credential; company deployments prefer the local mirror.
  const configured =
    !!token ||
    (options.publicSource ??
      (() => {
        const source = process.env.BRAIN_UPDATE_SOURCE?.trim().toLowerCase();
        return (
          source !== "private" &&
          source !== "disabled" &&
          source !== "off" &&
          source !== "false"
        );
      })());
  const request = options.fetch ?? fetch;
  type Cached = { release: DesktopRelease; ids: Record<string, number> };
  let cached: Cached | null = null;
  let expires = 0,
    retryAfter = 0;
  let pending: Promise<Cached> | null = null;
  const headers = (binary = false) => ({
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: binary ? "application/octet-stream" : "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "Corporate-Brain-Updates",
  });
  async function latest() {
    if (!configured) return null;
    if (cached && Date.now() < expires) return cached;
    if (Date.now() < retryAfter)
      throw new Error(
        "更新服务暂时不可用，请稍后重试或联系管理员检查 GitHub 连接。",
      );
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await request(`${apiRoot}/releases/latest`, {
          headers: headers(),
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("GitHub unavailable");
        const data = await response.json();
        const version = String(data.tag_name ?? "").replace(/^v/, "");
        if (
          data.draft ||
          data.prerelease ||
          !versionPattern.test(version) ||
          !Array.isArray(data.assets)
        )
          throw new Error("Invalid published release");
        const assets: DesktopRelease["assets"] = {},
          ids: Record<string, number> = {};
        for (const target of targets) {
          const asset = data.assets.find(
            (item: any) => item.name === installerName(version, target),
          );
          if (
            !asset ||
            asset.state !== "uploaded" ||
            !Number.isSafeInteger(asset.id) ||
            asset.id <= 0 ||
            !Number.isSafeInteger(asset.size) ||
            asset.size <= 0 ||
            asset.size > 2 * 1024 ** 3 ||
            !/^sha256:[0-9a-f]{64}$/.test(asset.digest)
          )
            throw new Error("Missing verified installer");
          assets[target] = {
            name: asset.name,
            bytes: asset.size,
            sha256: asset.digest.slice(7),
          };
          ids[target] = asset.id;
        }
        cached = {
          release: {
            version,
            notes: String(data.body ?? "").slice(0, 30000),
            publishedAt: String(data.published_at ?? ""),
            assets,
          },
          ids,
        };
        expires = Date.now() + 5 * 60_000;
        return cached;
      } catch {
        retryAfter = Date.now() + 30_000;
        throw new Error(
          "更新服务暂时不可用，请稍后重试或联系管理员检查 GitHub 连接。",
        );
      } finally {
        pending = null;
      }
    })();
    return pending;
  }
  app.get("/api/desktop-updates/latest", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const data = await latest();
      res.json({
        configured,
        release: data?.release ?? null,
        ...(configured ? {} : { reason: "not-configured" as const }),
      } satisfies UpdateFeed);
    } catch (error) {
      res.status(503).json({
        configured,
        release: null,
        reason: "provider-unavailable" as const,
        error: (error as Error).message,
      } satisfies UpdateFeed & { error: string });
    }
  });
  app.get("/api/desktop-updates/:version/:target", async (req, res) => {
    if (
      !versionPattern.test(req.params.version) ||
      !targets.includes(req.params.target)
    ) {
      res.status(400).json({ error: "更新版本或平台无效" });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15 * 60_000);
    const closed = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", closed);
    try {
      const data = await latest();
      if (!data || data.release.version !== req.params.version) {
        res.status(409).json({ error: "更新版本已变化，请重新检查更新" });
        return;
      }
      const asset = data.release.assets[req.params.target];
      let upstream = await request(
        `${apiRoot}/releases/assets/${data.ids[req.params.target]}`,
        {
          headers: headers(true),
          redirect: "manual",
          signal: controller.signal,
        },
      );
      if (upstream.status === 302) {
        const location = new URL(upstream.headers.get("location") ?? "");
        await upstream.body?.cancel();
        if (
          location.protocol !== "https:" ||
          location.username ||
          location.password ||
          ![
            "release-assets.githubusercontent.com",
            "objects.githubusercontent.com",
          ].includes(location.hostname)
        )
          throw new Error("Unexpected asset host");
        // The redirected request carries no GitHub Authorization header.
        upstream = await request(location.href, {
          redirect: "error",
          signal: controller.signal,
        });
      }
      if (!upstream.ok || !upstream.body)
        throw new Error("Download unavailable");
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${asset.name}"`,
      );
      res.setHeader("Content-Length", asset.bytes);
      await pipeline(Readable.fromWeb(upstream.body as any), res, {
        signal: controller.signal,
      });
    } catch {
      if (res.headersSent) res.destroy();
      else if (!res.destroyed)
        res.status(503).json({ error: "安装包下载失败，请检查连接后重试" });
    } finally {
      clearTimeout(timer);
      res.off("close", closed);
    }
  });
}
