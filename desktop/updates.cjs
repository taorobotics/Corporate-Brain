// Native update state machine. No renderer-supplied URL, executable or path.
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const { createHash } = require("node:crypto");
const { join } = require("node:path");
const pattern = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const newer = (a, b) => {
  if (!pattern.test(a) || !pattern.test(b)) return false;
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] > right[i];
  return false;
};
class DesktopUpdates {
  constructor({ version, platform, arch, directory, request, notify }) {
    this.directory = directory;
    this.request = request;
    this.notify = notify;
    this.state = {
      status: "idle",
      currentVersion: version,
      target: `${platform}-${arch}`,
      release: null,
      received: 0,
      error: "",
      checkedAt: null,
    };
    this.operation = null;
    this.controller = null;
  }
  set(values) {
    Object.assign(this.state, values);
    this.notify(this.snapshot());
  }
  snapshot() {
    return structuredClone(this.state);
  }
  async check() {
    if (this.operation) {
      await this.operation;
      return this.snapshot();
    }
    this.set({ status: "checking", error: "" });
    this.operation = (async () => {
      try {
        const response = await this.request("/api/desktop-updates/latest", {
          signal: AbortSignal.timeout(20000),
        });
        if (response.status === 401) throw new Error("请重新登录后检查更新");
        if (response.status === 404)
          throw new Error("公司服务器尚未升级，请联系管理员更新服务器");
        if (!response.ok) throw new Error("暂时无法检查更新，请稍后重试");
        const feed = await response.json();
        if (!feed.configured) {
          this.set({
            status: "unavailable",
            release: null,
            error: "公司尚未启用客户端更新，请联系管理员配置更新源",
          });
          return;
        }
        const release = feed.release;
        if (!release || !pattern.test(release.version))
          throw new Error("更新信息无效，请联系管理员");
        if (!newer(release.version, this.state.currentVersion)) {
          this.set({
            status: "current",
            release: null,
            received: 0,
            checkedAt: new Date().toISOString(),
          });
          return;
        }
        const asset = release.assets?.[this.state.target];
        const expected =
          this.state.target === "win32-x64"
            ? `Corporate-Brain-Setup-${release.version}-x64.exe`
            : `Corporate-Brain-${release.version}-macOS-${this.state.target.split("-")[1]}.dmg`;
        if (
          !["win32-x64", "darwin-arm64", "darwin-x64"].includes(
            this.state.target,
          ) ||
          !asset ||
          asset.name !== expected ||
          !/^[0-9a-f]{64}$/.test(asset.sha256) ||
          !Number.isSafeInteger(asset.bytes) ||
          asset.bytes <= 0 ||
          asset.bytes > 2 * 1024 ** 3
        )
          throw new Error("没有适用于这台电脑的已校验安装包");
        this.set({
          release: {
            version: release.version,
            notes: String(release.notes ?? "").slice(0, 30000),
            publishedAt: String(release.publishedAt ?? ""),
            asset,
          },
          received: 0,
          checkedAt: new Date().toISOString(),
        });
        const valid = await this.verify().then(
          () => true,
          () => false,
        );
        this.set({
          status: valid ? "ready" : "available",
          received: valid ? asset.bytes : 0,
        });
      } catch (error) {
        this.set({ status: "error", error: error.message });
      }
    })().finally(() => {
      this.operation = null;
    });
    await this.operation;
    return this.snapshot();
  }
  path() {
    if (!this.state.release) throw new Error("请先检查更新");
    const { asset } = this.state.release;
    return join(this.directory, `${asset.sha256.slice(0, 16)}-${asset.name}`);
  }
  async verify() {
    const file = this.path(),
      asset = this.state.release.asset;
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== asset.bytes)
      throw new Error("安装包不完整，请重新下载");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest("hex") !== asset.sha256)
      throw new Error("安装包校验失败，请重新下载");
    return file;
  }
  async download() {
    if (this.operation) {
      await this.operation;
      return this.snapshot();
    }
    if (
      !this.state.release ||
      !["available", "error", "ready"].includes(this.state.status)
    )
      throw new Error("请先检查更新");
    const file = this.path(),
      partial = `${file}.part`,
      { version, asset } = this.state.release;
    this.controller = new AbortController();
    const controller = this.controller;
    const timer = setTimeout(() => controller.abort(), 15 * 60_000);
    this.set({ status: "downloading", received: 0, error: "" });
    this.operation = (async () => {
      let handle;
      try {
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
        await fs.rm(partial, { force: true });
        const response = await this.request(
          `/api/desktop-updates/${version}/${this.state.target}`,
          { signal: controller.signal },
        );
        if (!response.ok || !response.body)
          throw new Error("下载失败，请重新登录或检查网络后重试");
        handle = await fs.open(partial, "wx", 0o600);
        const hash = createHash("sha256");
        let received = 0,
          lastNotified = 0;
        for await (const chunk of response.body) {
          if (controller.signal.aborted) throw new Error("下载已取消");
          received += chunk.length;
          if (received > asset.bytes)
            throw new Error("安装包大小不符，请重新检查更新");
          hash.update(chunk);
          await handle.writeFile(chunk);
          if (Date.now() - lastNotified > 150) {
            this.set({ received });
            lastNotified = Date.now();
          }
        }
        await handle.close();
        handle = null;
        if (controller.signal.aborted) throw new Error("下载已取消");
        if (received !== asset.bytes || hash.digest("hex") !== asset.sha256)
          throw new Error("安装包校验失败，请重新下载");
        await fs.rm(file, { force: true });
        await fs.rename(partial, file);
        // Keep only the current installer; never traverse employee profile data.
        for (const entry of await fs.readdir(this.directory, {
          withFileTypes: true,
        })) {
          if (
            entry.isFile() &&
            /^[0-9a-f]{16}-Corporate-Brain-(?:Setup-\d+\.\d+\.\d+-x64\.exe|\d+\.\d+\.\d+-macOS-(?:arm64|x64)\.dmg)$/.test(
              entry.name,
            ) &&
            join(this.directory, entry.name) !== file
          )
            await fs.unlink(join(this.directory, entry.name)).catch(() => {});
        }
        this.set({ status: "ready", received: asset.bytes });
      } catch (error) {
        this.set({
          status: controller.signal.aborted ? "available" : "error",
          received: 0,
          error: controller.signal.aborted
            ? "下载已取消，可随时重新下载"
            : error.message,
        });
      } finally {
        clearTimeout(timer);
        await handle?.close();
        await fs.rm(partial, { force: true });
        this.controller = null;
      }
    })().finally(() => {
      this.operation = null;
    });
    await this.operation;
    return this.snapshot();
  }
  async cancel() {
    this.controller?.abort();
    await this.operation;
  }
}
module.exports = { DesktopUpdates, newer };
