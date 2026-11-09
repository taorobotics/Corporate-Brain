import express, { type Express, type Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  lstat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { zipSync } from "fflate";
import {
  skillDraftSchema,
  skillMarkdown,
  hasPrivateSkillContent,
} from "./skill-package";
import type { Store } from "./database";
import type { Skill, User } from "../shared/types";
import type {
  SkillImportPreview,
  ImportedSkillSource,
} from "../shared/skill-import";
import {
  MAX_ZIP,
  prepareGithub,
  prepareZip,
  prepareUrl,
  inspectPackage,
  safePackagePath,
  SkillImportError,
  type PreparedImport,
  type PackageFile,
} from "./skill-import";

export type SkillLibraryOptions = { root: string; fetch?: typeof fetch };
export type SkillResources = {
  root: string;
  files: PackageFile[];
  source: ImportedSkillSource;
};

export function mountSkillLibrary(
  app: Express,
  store: Store,
  actorOf: (req: Request) => User,
  skillById: (id: string) => Skill,
  canView: (skill: Skill, actor: User) => boolean,
  options: SkillLibraryOptions,
) {
  const root = resolve(options.root),
    previews = new Map<
      string,
      {
        actor: string;
        department: string;
        dir: string;
        data: PreparedImport;
        expires: number;
        busy: boolean;
      }
    >();
  const active = new Set<string>(),
    attempts = new Map<string, { count: number; reset: number }>();
  function error(message: string, status = 400): never {
    throw new SkillImportError(message, status);
  }
  const cleanup = async () => {
    for (const [id, p] of previews)
      if (!p.busy && p.expires < Date.now()) {
        previews.delete(id);
        await rm(p.dir, { recursive: true, force: true });
      }
  };
  const timer = setInterval(() => {
    void cleanup().catch(() => {});
  }, 60_000);
  timer.unref();
  function own(req: Request) {
    const id = z.string().uuid().parse(req.params.id),
      p = previews.get(id),
      actor = actorOf(req);
    if (!p || p.expires < Date.now()) error("预览已过期，请重新解析", 410);
    if (p.actor !== actor.id || p.department !== actor.departmentId)
      error("无权访问此预览", 403);
    return p;
  }
  async function preview(
    req: Request,
    prepare: (dir: string) => Promise<PreparedImport>,
  ) {
    const actor = actorOf(req);
    if (active.has(actor.id) || active.size >= 2)
      error("已有导入任务正在解析，请稍后重试", 429);
    const limit = attempts.get(actor.id);
    if (limit && limit.reset > Date.now() && limit.count >= 12)
      error("本小时解析次数已达上限，请稍后重试", 429);
    for (const [id, value] of attempts)
      if (value.reset <= Date.now()) attempts.delete(id);
    attempts.set(actor.id, {
      count: (attempts.get(actor.id)?.count ?? 0) + 1,
      reset: attempts.get(actor.id)?.reset ?? Date.now() + 3600_000,
    });
    active.add(actor.id);
    let dir: string | undefined;
    try {
      await cleanup();
      if (
        previews.size >= 6 ||
        [...previews.values()].filter((p) => p.actor === actor.id).length >= 2
      )
        error("请先完成或取消已有预览", 429);
      await mkdir(join(root, "staging"), { recursive: true, mode: 0o700 });
      dir = await mkdtemp(join(root, "staging", "import-"));
      const data = await prepare(dir),
        id = randomUUID(),
        expires = Date.now() + 30 * 60_000;
      previews.set(id, {
        actor: actor.id,
        department: actor.departmentId,
        dir,
        data,
        expires,
        busy: false,
      });
      store.audit(actor.id, "skill.import_preview", id);
      return {
        id,
        expiresAt: new Date(expires).toISOString(),
        source: data.source,
        candidates: data.candidates,
        files: data.files.map((f) => f.path),
      } satisfies SkillImportPreview;
    } catch (e) {
      if (dir) await rm(dir, { recursive: true, force: true });
      throw e;
    } finally {
      active.delete(actor.id);
    }
  }
  app.post("/api/skill-imports/github", async (req, res) => {
    const { url } = z
      .object({ url: z.string().trim().min(1).max(1000) })
      .strict()
      .parse(req.body);
    res.json(
      await preview(req, (dir) => prepareGithub(url, dir, options.fetch)),
    );
  });
  app.post("/api/skill-imports/url", async (req, res) => {
    const { url } = z
      .object({ url: z.string().trim().min(1).max(1000) })
      .strict()
      .parse(req.body);
    res.json(await preview(req, (dir) => prepareUrl(url, dir, options.fetch)));
  });
  app.post(
    "/api/skill-imports/zip",
    express.raw({ type: "application/zip", limit: MAX_ZIP }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body)) error("需要上传 ZIP 文件");
      const name = z
        .string()
        .min(1)
        .max(160)
        .parse(req.query.name ?? "skill.zip");
      res.json(await preview(req, (dir) => prepareZip(req.body, dir, name)));
    },
  );
  app.delete("/api/skill-imports/:id", async (req, res) => {
    const p = own(req);
    if (p.busy) error("正在导入，请稍后重试", 409);
    previews.delete(String(req.params.id));
    await rm(p.dir, { recursive: true, force: true });
    res.json({ ok: true });
  });
  app.get("/api/skill-imports/:id/file", async (req, res) => {
    const p = own(req),
      path = z.string().max(420).parse(req.query.path);
    res.json(await readText(p.dir, p.data.files, path));
  });
  const editSchema = z
    .object({ entry: z.string().max(420), edits: skillDraftSchema.optional() })
    .strict();
  function validatedEdits(edits: z.infer<typeof skillDraftSchema> | undefined) {
    if (edits && hasPrivateSkillContent(edits))
      error("技能内容疑似包含个人路径或凭据，请检查后再打包");
  }
  async function revised(
    p: ReturnType<typeof own>,
    entry: string,
    edits?: z.infer<typeof skillDraftSchema>,
  ) {
    if (!p.data.candidates.some((c) => c.entry === entry))
      error("请选择有效的技能入口");
    validatedEdits(edits);
    if (!edits) return { dir: p.dir, data: p.data };
    const dir = await mkdtemp(join(root, "staging", "edited-"));
    try {
      const files: PackageFile[] = [];
      for (const file of p.data.files) {
        const original = await verifiedFile(p.dir, file);
        const bytes =
          file.path === entry
            ? Buffer.from(skillMarkdown(edits, original.toString("utf8")))
            : original;
        await mkdir(join(dir, file.path, ".."), {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(join(dir, file.path), bytes, {
          flag: "wx",
          mode: 0o600,
        });
        files.push({
          path: file.path,
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
      const data = await inspectPackage(dir, files, {
        ...p.data.source,
        notes: [
          ...p.data.source.notes,
          "技能入口由导入者编辑，配套资源和原许可保留。",
        ],
      });
      return { dir, data };
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
  }
  async function zipped(dir: string, files: PackageFile[]) {
    const contents: Record<string, Uint8Array> = Object.create(null);
    for (const file of files)
      contents[file.path] = await verifiedFile(dir, file);
    const bytes = Buffer.from(zipSync(contents));
    if (bytes.length > MAX_ZIP)
      error("导出的 ZIP 超过 32MB，请精简项目资源后重试");
    return bytes;
  }
  app.post("/api/skill-imports/:id/export", async (req, res) => {
    const p = own(req);
    if (p.busy) error("正在打包，请稍后重试", 409);
    const { entry, edits } = editSchema.parse(req.body);
    p.busy = true;
    let value: Awaited<ReturnType<typeof revised>> | undefined;
    let bytes: Buffer;
    try {
      value = await revised(p, entry, edits);
      bytes = await zipped(value.dir, value.data.files);
    } finally {
      try {
        if (value && value.dir !== p.dir)
          await rm(value.dir, { recursive: true, force: true });
      } finally {
        p.busy = false;
      }
    }
    res.type("application/zip").set("Cache-Control", "no-store").send(bytes);
  });
  app.post("/api/skill-packages/export", (req, res) => {
    const actor = actorOf(req),
      data = skillDraftSchema.parse(req.body);
    validatedEdits(data);
    res
      .type("application/zip")
      .set("Cache-Control", "no-store")
      .send(
        Buffer.from(
          zipSync({
            "SKILL.md": Buffer.from(skillMarkdown(data)),
            "LICENSE.txt": Buffer.from(
              `内部使用许可\n\n本技能由 ${actor.name} 创建，仅授权其所属公司内部使用。未经作者许可不得对外分发；第三方资料仍适用其原许可。\n`,
            ),
          }),
        ),
      );
  });
  app.post("/api/skill-imports/:id/commit", async (req, res) => {
    const p = own(req),
      actor = actorOf(req);
    if (p.busy) error("正在导入，请勿重复提交", 409);
    const data = z
      .object({
        entry: z.string().max(420),
        audience: z.enum(["department", "departments", "company"]),
        targetDepartments: z.array(z.string().uuid()).max(100).default([]),
        publish: z.boolean().default(false),
        acknowledge: z.literal(true),
        edits: skillDraftSchema.optional(),
      })
      .strict()
      .parse(req.body);
    const candidate = p.data.candidates.find((c) => c.entry === data.entry);
    if (!candidate) error("请选择有效的技能入口");
    if (data.publish && actor.role !== "company_admin")
      error("只有公司管理员可以直接上架；员工需提交审核", 403);
    if (!p.data.source.licenseFiles.some((path) => !path.includes("/")))
      error("没有根许可文件，请先补充合法授权后再导入");
    const targets =
      data.audience === "company"
        ? []
        : data.audience === "department"
          ? [actor.departmentId]
          : [...new Set(data.targetDepartments)];
    if (data.audience === "departments" && !targets.length)
      error("请选择共享部门");
    for (const id of targets)
      if (
        !store.db
          .prepare("SELECT id FROM departments WHERE id=? AND enabled=1")
          .get(id)
      )
        error("部门不存在或已停用");
    validatedEdits(data.edits);
    p.busy = true;
    let compiled: Awaited<ReturnType<typeof revised>> | undefined;
    try {
      compiled = await revised(p, data.entry, data.edits);
      const packageData = compiled.data;
      const source: ImportedSkillSource = {
        ...packageData.source,
        entry: data.entry,
      };
      const existing = store.db
        .prepare(
          "SELECT id FROM skills WHERE owner_department_id=? AND json_extract(import_source,'$.digest')=? AND json_extract(import_source,'$.entry')=?",
        )
        .get(actor.departmentId, source.digest, source.entry);
      if (existing)
        error("这个技能包已经导入，请在技能中心或审核列表查看", 409);
      await mkdir(join(root, "packages"), { recursive: true, mode: 0o700 });
      await writeFile(
        join(compiled.dir, ".corporate-manifest.json"),
        JSON.stringify(packageData.files),
        { flag: "wx", mode: 0o600 },
      );
      const dest = join(root, "packages", source.digest);
      try {
        await rename(compiled.dir, dest);
      } catch (e) {
        if (
          !["EEXIST", "ENOTEMPTY", "EPERM"].includes(
            (e as NodeJS.ErrnoException).code || "",
          )
        )
          throw e;
        const stored = await readFile(
          join(dest, ".corporate-manifest.json"),
          "utf8",
        );
        if (stored !== JSON.stringify(packageData.files))
          error("已存储的技能包校验不一致", 409);
        await rm(compiled.dir, { recursive: true, force: true });
      }
      const id = randomUUID(),
        status = data.publish ? "published" : "pending";
      store.db
        .prepare(
          "INSERT INTO skills(id,name,description,version,instructions,examples,test_summary,required_tools,author_id,owner_department_id,audience,targets,status,review_note,created_at,import_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          data.edits?.name ?? candidate.name,
          data.edits?.description ?? candidate.description,
          data.edits?.version ?? candidate.version,
          data.edits?.instructions ?? candidate.instructions,
          data.edits?.examples ?? "",
          data.edits?.testSummary ||
            "导入已验证包结构、文件完整性与入口格式；脚本未执行，渲染依赖和最终作品效果尚未验收。",
          JSON.stringify(data.edits?.requiredTools ?? []),
          actor.id,
          actor.departmentId,
          data.audience,
          JSON.stringify(targets),
          status,
          data.publish ? "公司管理员确认来源、许可与共享范围后上架" : "",
          new Date().toISOString(),
          JSON.stringify(source),
        );
      store.audit(
        actor.id,
        data.publish ? "skill.import_published" : "skill.import_submitted",
        id,
      );
      previews.delete(String(req.params.id));
      if (compiled.dir !== p.dir)
        await rm(p.dir, { recursive: true, force: true });
      res.status(201).json(skillById(id));
    } finally {
      if (compiled && compiled.dir !== p.dir)
        await rm(compiled.dir, { recursive: true, force: true });
      else await rm(join(p.dir, ".corporate-manifest.json"), { force: true });
      p.busy = false;
    }
  });

  async function resources(
    source: ImportedSkillSource,
  ): Promise<SkillResources> {
    if (!/^[a-f0-9]{64}$/.test(source.digest)) error("技能包校验标识无效");
    const dir = join(root, "packages", source.digest);
    if (
      !(await lstat(dir)).isDirectory() ||
      (await lstat(dir)).isSymbolicLink()
    )
      error("技能包目录无效");
    if ((await lstat(join(dir, ".corporate-manifest.json"))).isSymbolicLink())
      error("技能清单包含链接");
    const files = JSON.parse(
      await readFile(join(dir, ".corporate-manifest.json"), "utf8"),
    ) as PackageFile[];
    if (
      createHash("sha256").update(JSON.stringify(files)).digest("hex") !==
      source.digest
    )
      error("技能资源清单校验失败");
    return { root: dir, files, source };
  }
  app.get("/api/skills/:id/resources", async (req, res) => {
    const skill = skillById(z.string().uuid().parse(req.params.id));
    if (!canView(skill, actorOf(req))) error("技能不存在或无权访问", 404);
    if (!skill.imported) return res.json({ files: [] });
    const value = await resources(skill.imported);
    if (req.query.path !== undefined)
      res.json(
        await readText(
          value.root,
          value.files,
          z.string().max(420).parse(req.query.path),
        ),
      );
    else
      res.json({
        files: value.files.map((f) => ({ path: f.path, size: f.size })),
      });
  });
  return {
    resources,
    async close() {
      clearInterval(timer);
      for (const p of previews.values())
        await rm(p.dir, { recursive: true, force: true });
      previews.clear();
    },
  };
}

async function readText(root: string, files: PackageFile[], path: string) {
  const file = files.find((f) => f.path === path);
  if (!file || file.size > 200_000)
    throw new SkillImportError("文件不存在或超过文本预览限制");
  const bytes = await verifiedFile(root, file);
  if (bytes.includes(0)) throw new SkillImportError("此文件不是可预览文本");
  return { path, content: bytes.toString("utf8") };
}
export async function verifiedFile(root: string, file: PackageFile) {
  safePackagePath(file.path);
  let current = root;
  for (const part of file.path.split("/")) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new SkillImportError("技能资源包含链接，读取已停止");
  }
  const bytes = await readFile(current);
  if (
    bytes.length !== file.size ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new SkillImportError("技能资源被修改，请重新导入");
  return bytes;
}

export async function materializeSkill(
  resources: SkillResources,
  workspace: string,
) {
  const dir = await mkdtemp(join(workspace, "skill-"));
  try {
    for (const file of resources.files) {
      const bytes = await verifiedFile(resources.root, file);
      const parts = file.path.split("/");
      parts.pop();
      await mkdir(join(dir, ...parts), { recursive: true, mode: 0o700 });
      await writeFile(join(dir, file.path), bytes, { flag: "wx", mode: 0o600 });
    }
    return dir;
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}
