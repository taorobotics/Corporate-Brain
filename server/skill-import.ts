import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";
import { parseDocument } from "yaml";
import type {
  SkillImportCandidate,
  SkillImportPreview,
} from "../shared/skill-import";

export const MAX_ZIP = 32 * 1024 * 1024;
const MAX_TOTAL = 192 * 1024 * 1024,
  MAX_FILE = 20 * 1024 * 1024,
  MAX_FILES = 4096;
export class SkillImportError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function reject(message: string): never {
  throw new SkillImportError(message);
}
export type PackageFile = { path: string; size: number; sha256: string };
export type PreparedImport = {
  source: SkillImportPreview["source"];
  candidates: SkillImportCandidate[];
  files: PackageFile[];
};

export function safePackagePath(path: string) {
  if (path.toLowerCase() === ".corporate-manifest.json")
    reject("技能包使用了保留文件名");
  if (
    !path ||
    path.length > 420 ||
    /[\\\x00-\x1f\x7f:]/.test(path) ||
    path.startsWith("/") ||
    path
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[. ]$/.test(p) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  )
    reject("技能包包含不安全的文件路径");
  if (
    path
      .split("/")
      .some((p) => /^(?:\.git|node_modules|\.ssh|\.data|profiles)$/i.test(p)) ||
    (/(^|\/)\.env(?:\.|$)/i.test(path) && !path.endsWith(".env.example")) ||
    /\.(?:pem|key|pfx|p12|sqlite|db)$/i.test(path)
  )
    reject("技能包包含依赖缓存、个人数据或密钥文件，请移除后重试");
  return path;
}

function writer(root: string) {
  const files: PackageFile[] = [],
    seen = new Set<string>();
  let total = 0;
  return {
    files,
    async put(path: string, content: Buffer) {
      safePackagePath(path);
      const key = path.normalize("NFC").toLowerCase();
      if (
        seen.has(key) ||
        [...seen].some(
          (p) => p.startsWith(key + "/") || key.startsWith(p + "/"),
        )
      )
        reject("技能包存在重复或冲突路径");
      seen.add(key);
      total += content.length;
      if (
        files.length >= MAX_FILES ||
        content.length > MAX_FILE ||
        total > MAX_TOTAL
      )
        reject("技能包超过限制：最多 4096 个文件、单文件 20MB、展开后 192MB");
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, content, { flag: "wx", mode: 0o600 });
      files.push({
        path,
        size: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    },
  };
}

export function parseGithubUrl(value: string) {
  try {
    if (
      value.includes("\\") ||
      decodeURIComponent(value)
        .split("/")
        .some((p) => p === "." || p === "..")
    )
      reject("GitHub 链接包含不安全路径");
  } catch {
    return reject("GitHub 链接格式无效");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return reject("请输入完整的 GitHub 仓库链接");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    reject("仅支持 https://github.com 的公开仓库或技能目录链接");
  const parts = url.pathname
    .replace(/\/$/, "")
    .split("/")
    .slice(1)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return reject("GitHub 链接格式无效");
      }
    });
  const [owner, rawRepo, type, ref, ...tail] = parts,
    repo = rawRepo?.replace(/\.git$/, "");
  if (
    !owner ||
    !repo ||
    !/^[\w.-]+$/.test(owner) ||
    !/^[\w.-]+$/.test(repo) ||
    (parts.length > 2 && (type !== "tree" || !ref || !/^[\w.-]+$/.test(ref)))
  )
    reject("请使用仓库链接或 /tree/分支/目录 链接；含斜杠的分支请使用提交号");
  const path = tail.join("/");
  if (path) safePackagePath(path);
  return { repo: `${owner}/${repo}`, ref, path };
}

async function boundedResponse(response: Response, limit: number) {
  if (!response.ok)
    throw new SkillImportError(
      response.status === 404
        ? "仓库、分支或目录不存在，或不是公开仓库"
        : response.status === 403 || response.status === 429
          ? "GitHub 暂时限制请求，请稍后重试或上传 ZIP"
          : "无法从 GitHub 下载，请稍后重试或上传 ZIP",
      502,
    );
  if (Number(response.headers.get("content-length")) > limit)
    reject("下载文件超过大小限制");
  const chunks: Buffer[] = [];
  let size = 0;
  if (!response.body) reject("下载内容为空");
  const reader = response.body!.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) reject("下载文件超过大小限制");
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

export async function prepareGithub(
  value: string,
  root: string,
  fetcher: typeof fetch = fetch,
): Promise<PreparedImport> {
  const { repo, ref, path } = parseGithubUrl(value),
    controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  const get = async (url: string, limit: number): Promise<Buffer> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetcher(url, {
          redirect: "error",
          signal: controller.signal,
          headers: {
            "User-Agent": "Corporate-Brain-Skill-Importer",
            Accept: "application/vnd.github+json",
          },
        });
        if (response.status >= 500 && attempt < 2) {
          await response.body?.cancel();
        } else return await boundedResponse(response, limit);
      } catch (error) {
        if (
          error instanceof SkillImportError ||
          controller.signal.aborted ||
          attempt >= 2
        )
          throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  };
  const api = async (suffix: string) =>
    JSON.parse(
      (
        await get(
          `https://api.github.com/repos/${repo}${suffix}`,
          6 * 1024 * 1024,
        )
      ).toString("utf8"),
    );
  try {
    const meta = await api("");
    const commit = (
      await api(`/commits/${encodeURIComponent(ref || meta.default_branch)}`)
    ).sha;
    if (!/^[a-f0-9]{40}$/.test(commit)) reject("GitHub 未返回有效的固定提交号");
    const tree = await api(`/git/trees/${commit}?recursive=1`);
    if (tree.truncated || !Array.isArray(tree.tree))
      reject("仓库目录过大，请使用具体技能目录链接或上传 ZIP");
    let files = tree.tree.filter(
      (f: any) => f.type !== "tree" && (!path || f.path.startsWith(path + "/")),
    );
    const notes: string[] = [];
    // These libraries publish large demonstration galleries separately from their working skill resources.
    if (!path && repo.toLowerCase() === "lemomo-ai/lemo-opuscar") {
      files = files.filter(
        (f: any) =>
          !/^(?:docs|styleboard|\.github|tools\/directory)\//.test(f.path) &&
          !/^styles\/[^/]+\/(?:demo\/|poster\.)/.test(f.path),
      );
      notes.push(
        "文库版：保留核心工具、风格手册与许可；未下载演示片源码、海报和展示网站。",
      );
    }
    if (!path && repo.toLowerCase() === "vincentwei1021/mg-styles-15") {
      files = files.filter(
        (f: any) =>
          !/^(?:videos|docs|site)\//.test(f.path) && f.path !== "index.html",
      );
      notes.push(
        "保留提示词、示例源码、渲染器、素材和许可；不下载成片视频与展示网站。新增公司大脑技能入口，原项目未提供 SKILL.md。",
      );
    }
    files = files.filter(
      (f: any) =>
        !/(^|\/)(?:\.gitignore|\.github|\.claude-plugin|\.nojekyll)(\/|$)/.test(
          f.path,
        ),
    );
    // A directory import still retains the repository-level license.
    const licenses = tree.tree.filter(
      (f: any) =>
        f.type === "blob" &&
        /^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:\.[^/]+)?$/i.test(f.path),
    );
    if (path)
      files.push(...licenses.map((f: any) => ({ ...f, licenseRoot: true })));
    if (
      !files.length ||
      files.length > MAX_FILES ||
      files.reduce((n: number, f: any) => n + (f.size || 0), 0) > MAX_TOTAL
    )
      reject("仓库资源过大，请选择具体技能目录或精简 ZIP");
    for (const f of files) {
      if (
        f.type !== "blob" ||
        !["100644", "100755"].includes(f.mode) ||
        !Number.isSafeInteger(f.size) ||
        f.size < 0 ||
        f.size > MAX_FILE ||
        !/^[a-f0-9]{40}$/.test(f.sha)
      )
        reject("仓库含不支持的链接、子模块或过大文件");
      safePackagePath(f.path);
    }
    const out = writer(root);
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(8, files.length) },
      async () => {
        while (cursor < files.length) {
          controller.signal.throwIfAborted();
          const f = files[cursor++];
          const data = await get(
            `https://raw.githubusercontent.com/${repo}/${commit}/${f.path.split("/").map(encodeURIComponent).join("/")}`,
            MAX_FILE,
          );
          const gitHash = createHash("sha1")
            .update(`blob ${data.length}\0`)
            .update(data)
            .digest("hex");
          if (data.length !== f.size || gitHash !== f.sha)
            reject("GitHub 文件完整性校验失败");
          await out.put(
            path
              ? f.licenseRoot
                ? `REPOSITORY-${f.path}`
                : f.path.slice(path.length + 1)
              : f.path,
            data,
          );
        }
      },
    );
    const results = await Promise.allSettled(
      workers.map((p) =>
        p.catch((e) => {
          controller.abort();
          throw e;
        }),
      ),
    );
    const failure = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (failure) throw failure.reason;
    return await inspectPackage(root, out.files, {
      kind: "github",
      label: repo,
      url: `https://github.com/${repo}`,
      commit,
      notes,
    });
  } catch (e) {
    if (e instanceof SkillImportError) throw e;
    const error = new SkillImportError(
      "GitHub 导入未完成，请检查网络后重试或上传 ZIP",
      502,
    );
    error.cause = e;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function prepareZip(
  bytes: Buffer,
  root: string,
  name: string,
): Promise<PreparedImport> {
  if (!bytes.length || bytes.length > MAX_ZIP)
    reject("请选择 32MB 以内的 ZIP 技能包");
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      bytes,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (e, zip) => (e ? reject(e) : resolve(zip!)),
    ),
  ).catch(() => reject("ZIP 文件损坏或格式不受支持"));
  const out = writer(root),
    entries: Entry[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        entries.push(entry);
        if (entries.length > MAX_FILES + 1024) {
          reject(new SkillImportError("ZIP 条目过多"));
          zip.close();
        } else zip.readEntry();
      });
      zip.on("end", resolve);
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  // Reopen because lazy enumeration closes the first handle. No archive entry is extracted by its raw name.
  const regular = entries.filter((e) => !e.fileName.endsWith("/"));
  const prefix = regular[0]?.fileName.split("/")[0];
  const strip =
    prefix && regular.every((e) => e.fileName.startsWith(prefix + "/"))
      ? prefix.length + 1
      : 0;
  let total = 0;
  for (const e of entries) {
    safePackagePath(e.fileName.replace(/\/$/, ""));
    const mode = (e.externalFileAttributes >>> 16) & 0xf000;
    if (
      e.generalPurposeBitFlag & 1 ||
      (mode && mode !== 0x8000 && mode !== 0x4000)
    )
      reject("不支持加密 ZIP、符号链接或特殊文件");
    total += e.uncompressedSize;
    if (
      e.uncompressedSize > MAX_FILE ||
      total > MAX_TOTAL ||
      e.uncompressedSize > Math.max(e.compressedSize * 250, 1024 * 1024)
    )
      reject("ZIP 展开体积或压缩比超过限制");
  }
  if (!regular.length || regular.length > MAX_FILES)
    reject("ZIP 没有技能文件或文件过多");
  const handle = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      bytes,
      { lazyEntries: true, autoClose: false, strictFileNames: true },
      (e, zip) => (e ? reject(e) : resolve(zip!)),
    ),
  );
  try {
    for (const e of regular) {
      const stream = await new Promise<NodeJS.ReadableStream>(
        (resolve, reject) =>
          handle.openReadStream(e, (err, stream) =>
            err ? reject(err) : resolve(stream!),
          ),
      );
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > e.uncompressedSize || size > MAX_FILE)
          reject("ZIP 实际展开大小异常");
        chunks.push(chunk);
      }
      if (size !== e.uncompressedSize) reject("ZIP 文件大小校验失败");
      const content = Buffer.concat(chunks);
      if (crc32(content) !== e.crc32) reject("ZIP 文件校验失败");
      await out.put(e.fileName.slice(strip), content);
    }
    return await inspectPackage(root, out.files, {
      kind: "zip",
      label: name,
      notes: [],
    });
  } finally {
    handle.close();
  }
}

function crc32(bytes: Buffer) {
  let crc = -1;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

async function inspectPackage(
  root: string,
  files: PackageFile[],
  origin: Pick<
    SkillImportPreview["source"],
    "kind" | "label" | "url" | "commit" | "notes"
  >,
): Promise<PreparedImport> {
  const text = async (path: string) => {
    const f = files.find((f) => f.path === path);
    if (!f || f.size > 200_000) reject("技能入口或许可文件缺失、过大");
    return (await readFile(join(root, path)))
      .toString("utf8")
      .replace(/^\uFEFF/, "");
  };
  const candidates: SkillImportCandidate[] = [];
  const paths = files.map((f) => f.path),
    entries = paths.includes("SKILL.md")
      ? ["SKILL.md"]
      : paths.filter((p) => /(^|\/)SKILL\.md$/i.test(p));
  for (const entry of entries.slice(0, 50)) {
    const content = await text(entry),
      match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!match) reject("SKILL.md 需要包含 name 和 description 的 YAML 开头");
    const document = parseDocument(match[1], { uniqueKeys: true });
    if (document.errors.length) reject("技能 YAML 格式不正确");
    let meta: any;
    try {
      meta = document.toJS({ maxAliasCount: 0 });
    } catch {
      return reject("技能 YAML 不支持别名引用");
    }
    if (
      typeof meta?.name !== "string" ||
      !meta.name.trim() ||
      meta.name.length > 100 ||
      typeof meta.description !== "string" ||
      !meta.description.trim() ||
      meta.description.length > 2000
    )
      reject("技能名称或描述缺失、过长");
    const instructions = content.slice(match[0].length).trim();
    if (instructions.length < 10 || instructions.length > 60000)
      reject("技能正文需为 10–60000 个字符");
    const version = String(meta.version ?? meta.metadata?.version ?? "1.0.0");
    candidates.push({
      entry,
      name: meta.name.trim(),
      description: meta.description.trim().slice(0, 1000),
      version: /^\d+\.\d+\.\d+$/.test(version) ? version : "1.0.0",
      instructions,
    });
  }
  if (
    !candidates.length &&
    paths.includes("harness/render.mjs") &&
    paths.includes("template.md") &&
    paths.includes("rubric.md") &&
    paths.some((p) => /^prompts\/.+\.md$/.test(p))
  ) {
    const instructions =
      "根据 MG Styles 15 的提示词与源码创作动效。先阅读 README.zh-CN.md 和 template.md，向用户确认用途、时长、画幅和风格；列出 prompts/ 中的风格供选择。读取选定的提示词及对应 demos/ 源码，保留标志性风格并替换用户内容。使用 rubric.md 检查成果。渲染需先检查 Node、Chrome、Python、FFmpeg；3D 风格另需 Blender。依赖缺失时说明缺项，先交付分镜、提示词或 HTML 源码，不声称已生成视频。不自动安装系统软件，不发送用户素材到未授权的外部服务。所有新作品写入当前工作区，遵守资料与工具权限。";
    candidates.push({
      entry: "CORPORATE-SKILL.md",
      name: "MG Styles 15 · 动效设计",
      description:
        "15 种 MG 动效风格、提示词与示例源码；支持风格选择、分镜和代码创作，视频渲染需另行核对环境。",
      version: "1.0.0",
      instructions,
    });
    const content = Buffer.from(
      `---\nname: mg-styles-15\ndescription: MG motion design workflow adapted by Corporate Brain\n---\n\n${instructions}\n\nAdaptation: Corporate Brain. Original project and resources retain their original licenses.\n`,
    );
    await writeFile(join(root, "CORPORATE-SKILL.md"), content, {
      flag: "wx",
      mode: 0o600,
    });
    files.push({
      path: "CORPORATE-SKILL.md",
      size: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    origin.notes.push("MG 动效库已增加流程入口；原文件内容保持不变。");
  }
  if (!candidates.length)
    reject("未找到 SKILL.md；普通代码仓库需要先整理成技能包");
  const licenseFiles = paths.filter((p) =>
    /(^|\/)(?:REPOSITORY-)?(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[.-][^/]*)?$/i.test(
      p,
    ),
  );
  const rootLicense = licenseFiles.find((p) => !p.includes("/"));
  const licenseText = rootLicense ? await text(rootLicense) : "";
  const license =
    /MIT License|Permission is hereby granted, free of charge/i.test(
      licenseText,
    )
      ? "MIT（附带素材以各自许可为准）"
      : rootLicense
        ? "自定义许可，请阅读原文"
        : "未发现许可，发布前需确认授权";
  const hasScripts = paths.some((p) =>
    /\.(?:py|sh|bash|ps1|bat|cmd|js|cjs|mjs|ts|tsx|jsx)$/i.test(p),
  );
  const notes = [
    ...origin.notes,
    ...(hasScripts
      ? ["附带脚本仅保存，不自动执行；浏览器、Python、FFmpeg 等依赖尚未验证。"]
      : []),
    ...(!rootLicense
      ? ["没有根许可文件，不能直接上架共享；请补充合法授权。"]
      : []),
  ];
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const digest = createHash("sha256")
    .update(JSON.stringify(files))
    .digest("hex");
  return {
    files,
    candidates,
    source: {
      ...origin,
      notes,
      digest,
      fileCount: files.length,
      bytes: files.reduce((s, f) => s + f.size, 0),
      license,
      licenseFiles,
      hasScripts,
    },
  };
}
