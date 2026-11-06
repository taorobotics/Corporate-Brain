const fs = require("node:fs/promises");
const { createReadStream, constants } = require("node:fs");
const { join, dirname, relative, isAbsolute, resolve } = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function syncDirectory(directory) {
  // Windows does not expose directory fsync through Node; regular file
  // handles are flushed there. POSIX also flushes the published names.
  if (process.platform === "win32") return;
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
function safePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 220 ||
    value !== value.normalize("NFC") ||
    value.includes("\\") ||
    /[\x00-\x1f<>:"|?*]/.test(value) ||
    value
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[ .]$/.test(p) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p),
      )
  )
    throw Error("成果包含不安全的文件名");
  return value;
}
async function checkedDirectory(root, rel = "") {
  const base = resolve(root),
    target = resolve(base, rel);
  if (
    relative(base, target).startsWith("..") ||
    isAbsolute(relative(base, target))
  )
    throw Error("成果目录越界");
  for (const folder of [
    base,
    ...rel
      .split(/[\\/]/)
      .filter(Boolean)
      .map((_, i, parts) => join(base, ...parts.slice(0, i + 1))),
  ]) {
    await fs.mkdir(folder, { recursive: false }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    const stat = await fs.lstat(folder);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      resolve(await fs.realpath(folder)) !== resolve(folder)
    )
      throw Error("保存目录含链接或已被移动，请重新选择");
  }
  return target;
}
async function digest(file) {
  const stat = await fs.lstat(file).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw Error("成果文件不是普通独立文件，已停止保存");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, {
    flags: constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  }))
    hash.update(chunk);
  return { size: stat.size, sha256: hash.digest("hex") };
}
class ProductionLocal {
  constructor({ file, origin, fetch, verify }) {
    this.file = file;
    this.origin = origin;
    this.fetch = fetch;
    this.verify = verify;
    this.busy = false;
  }
  async config() {
    if (!this.initializing) this.initializing = this.loadConfig();
    await this.initializing;
    return JSON.parse(await fs.readFile(this.file, "utf8"));
  }
  async loadConfig() {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const initial = {
        deviceId: randomUUID(),
        directory: "",
        receipts: [],
        pending: {},
      };
      await this.write(initial);
      return initial;
    }
  }
  async write(value) {
    await fs.mkdir(dirname(this.file), { recursive: true });
    const temp = this.file + "." + randomUUID() + ".tmp";
    const handle = await fs.open(temp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, this.file);
    await syncDirectory(dirname(this.file));
  }
  async state() {
    await this.verify();
    const c = await this.config();
    return {
      deviceId: c.deviceId,
      directory: c.directory,
      receipts: c.receipts,
    };
  }
  async choose(directory) {
    await this.verify();
    if (this.busy) throw Error("正在保存成果，请稍后更换目录");
    const canonical = await fs.realpath(directory);
    await checkedDirectory(canonical);
    const config = await this.config();
    config.directory = canonical;
    await this.write(config);
    return this.state();
  }
  async json(path, config, body) {
    const response = await this.fetch(this.origin + "/api/production" + path, {
      credentials: "include",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-Brain-Device": config.deviceId,
        ...(body === undefined
          ? {}
          : { "Content-Type": "application/json", Origin: this.origin }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok) throw Error(value.error || "成果服务暂时不可用");
    return value;
  }
  async preview(id, path) {
    await this.verify();
    if (!uuid.test(id)) throw Error("任务标识无效");
    safePath(path);
    const config = await this.config();
    const receipt = config.receipts.find((item) => item.id === id);
    const file = receipt?.files.find((item) => item.path === path);
    if (
      !file ||
      !(
        path === "output/video.mp4" ||
        path.startsWith("code/") ||
        path === "plan.md" ||
        (path.startsWith("files/") &&
          /\.(?:gif|png|jpe?g|webp|mp4|webm|txt|md|json|csv|js|ts|tsx|jsx|py|html|css|svg)$/i.test(
            path,
          ))
      )
    )
      throw Error("只能预览当前账号已保存的成果文件");
    const mediaType = /\.gif$/i.test(path)
      ? "image/gif"
      : /\.png$/i.test(path)
        ? "image/png"
        : /\.jpe?g$/i.test(path)
          ? "image/jpeg"
          : /\.webp$/i.test(path)
            ? "image/webp"
            : /\.mp4$/i.test(path)
              ? "video/mp4"
              : /\.webm$/i.test(path)
                ? "video/webm"
                : undefined;
    if (file.size > (mediaType ? 64 * 1024 ** 2 : 512 * 1024))
      throw Error("文件较大，请打开成果文件夹查看");
    const target = join(receipt.directory, path);
    if (resolve(await fs.realpath(target)) !== resolve(target))
      throw Error("预览文件含链接或已移动");
    const handle = await fs.open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== file.size)
        throw Error("预览文件已变化");
      const bytes = await handle.readFile();
      if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw Error("文件已被修改，请在成果文件夹中查看");
      if (
        mediaType === "image/gif" &&
        !/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
      )
        throw Error("GIF 文件格式无效");
      if (
        mediaType === "image/png" &&
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw Error("PNG 文件格式无效");
      return mediaType
        ? { mime: mediaType, bytes: new Uint8Array(bytes) }
        : { mime: "text/plain", content: bytes.toString("utf8") };
    } finally {
      await handle.close();
    }
  }
  async collect(id) {
    if (!uuid.test(id)) throw Error("任务标识无效");
    if (this.busy) throw Error("正在保存另一份成果");
    this.busy = true;
    try {
      await this.verify();
      const config = await this.config();
      if (!config.directory) throw Error("请先选择成果保存位置");
      let pending = config.pending[id];
      let manifest;
      const previous = config.receipts.find((item) => item.id === id);
      if (previous && pending?.token) {
        // The server may already have deleted files while the ACK response was lost.
        for (const file of previous.files) {
          await checkedDirectory(
            previous.directory,
            dirname(safePath(file.path)) === "." ? "" : dirname(file.path),
          );
          const actual = await digest(join(previous.directory, file.path));
          if (actual?.size !== file.size || actual?.sha256 !== file.sha256)
            throw Error("本机成果已移动或修改，暂未发送清理确认");
        }
        await this.verify();
        await this.json(`/${id}/ack`, config, {
          deviceId: config.deviceId,
          token: pending.token,
          files: previous.files,
        });
        delete config.pending[id];
        await this.write(config);
        return previous;
      }
      manifest = await this.json(`/${id}/manifest`, config);
      if (
        manifest.task?.id !== id ||
        manifest.task.deviceId !== config.deviceId ||
        !Array.isArray(manifest.files) ||
        !manifest.files.length ||
        manifest.files.length > 64 ||
        !/^[a-f0-9]{64}$/.test(manifest.token)
      )
        throw Error("成果清单无效");
      const seen = new Set();
      let total = 0;
      for (const file of manifest.files) {
        safePath(file.path);
        if (
          seen.has(file.path.toLowerCase()) ||
          !Number.isSafeInteger(file.size) ||
          file.size < 0 ||
          !/^[a-f0-9]{64}$/.test(file.sha256)
        )
          throw Error("成果清单存在冲突");
        seen.add(file.path.toLowerCase());
        total += file.size;
      }
      if (total > 2 * 1024 ** 3) throw Error("成果超过本机单任务容量限制");
      if (!pending) {
        const root = await checkedDirectory(config.directory);
        const folder = join(
          root,
          `公司大脑-${new Date().toISOString().slice(0, 10)}-${id}`,
        );
        // Reserve a fresh task directory. Never adopt an existing user folder.
        await fs.mkdir(folder, { mode: 0o700 });
        pending = config.pending[id] = {
          directory: folder,
          token: manifest.token,
        };
        await this.write(config);
      }
      await checkedDirectory(pending.directory);
      const disk = await fs.statfs(pending.directory);
      if (disk.bavail * disk.bsize < total + 100 * 1024 ** 2)
        throw Error("本机可用空间不足，服务器文件仍保留");
      for (const [index, file] of manifest.files.entries()) {
        await this.verify();
        const parent = dirname(file.path);
        await checkedDirectory(pending.directory, parent === "." ? "" : parent);
        const target = join(pending.directory, file.path),
          existing = await digest(target);
        if (existing) {
          if (existing.size === file.size && existing.sha256 === file.sha256)
            continue;
          throw Error("本机同名成果已被修改，为避免覆盖，已停止自动保存");
        }
        const response = await this.fetch(
          `${this.origin}/api/production/${id}/files/${index}`,
          {
            credentials: "include",
            redirect: "error",
            headers: { "X-Brain-Device": config.deviceId },
            signal: AbortSignal.timeout(10 * 60_000),
          },
        );
        if (!response.ok || !response.body)
          throw Error("成果下载中断，重新连接后会继续");
        const temp = target + ".part-" + randomUUID();
        const handle = await fs.open(
          temp,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            (constants.O_NOFOLLOW || 0),
          0o600,
        );
        let size = 0;
        const hash = createHash("sha256");
        try {
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > file.size) throw Error("成果大小超出清单");
            hash.update(chunk);
            let offset = 0;
            while (offset < chunk.length) {
              const written = await handle.write(
                chunk,
                offset,
                chunk.length - offset,
              );
              offset += written.bytesWritten;
            }
          }
          if (size !== file.size || hash.digest("hex") !== file.sha256)
            throw Error("成果完整性校验未通过，服务器文件仍保留");
          await handle.sync();
          await handle.close();
          // Hard-link then unlink is an atomic no-replace publication, unlike rename.
          await fs.link(temp, target);
          await fs.unlink(temp);
          await syncDirectory(dirname(target));
        } catch (error) {
          await handle.close().catch(() => {});
          await fs.rm(temp, { force: true });
          throw error;
        }
      }
      // Re-check all final files just before committing a durable receipt.
      for (const file of manifest.files) {
        const check = await digest(join(pending.directory, file.path));
        if (check?.size !== file.size || check?.sha256 !== file.sha256)
          throw Error("本机文件发生变化，服务器文件仍保留");
      }
      const receipt = {
        id,
        directory: pending.directory,
        savedAt: new Date().toISOString(),
        files: manifest.files,
      };
      config.receipts = [
        receipt,
        ...config.receipts.filter((item) => item.id !== id),
      ].slice(0, 1000);
      pending.token = manifest.token;
      await this.write(config);
      await this.verify();
      await this.json(`/${id}/ack`, config, {
        deviceId: config.deviceId,
        token: manifest.token,
        files: manifest.files,
      });
      delete config.pending[id];
      await this.write(config);
      return receipt;
    } finally {
      this.busy = false;
    }
  }
  async directory(id) {
    await this.verify();
    const config = await this.config();
    const folder = id
      ? config.receipts.find((item) => item.id === id)?.directory
      : config.directory;
    if (!folder) throw Error("本机没有此任务的保存记录");
    await checkedDirectory(folder);
    return folder;
  }
  async fileLocation(id, path) {
    await this.verify();
    if (!uuid.test(id)) throw Error("任务标识无效");
    safePath(path);
    const receipt = (await this.config()).receipts.find(
      (item) => item.id === id,
    );
    if (!receipt?.files.some((file) => file.path === path))
      throw Error("只能定位当前账号已保存的成果文件");
    const target = join(receipt.directory, path);
    const stat = await fs.lstat(target);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      resolve(await fs.realpath(target)) !== resolve(target)
    )
      throw Error("成果文件含链接或已移动");
    return target;
  }
}
module.exports = { ProductionLocal, safePath, checkedDirectory };
