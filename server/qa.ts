// A disposable server for Electron interaction tests; never opens the company's database.
import { createPlatform } from "./platform";
import express from "express";
import { resolve, join } from "node:path";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { installerName } from "./updates";
const origins: string[] = [];
const current = JSON.parse(readFileSync("package.json", "utf8"))
  .version.split(".")
  .map(Number);
const next = `${current[0]}.${current[1]}.${current[2] + 1}`;
const payload = Buffer.alloc(
  256 * 1024,
  "INERT UPDATE QA FIXTURE. NEVER EXECUTE. ",
);
const skillRoot = mkdtempSync(join(tmpdir(), "corporate-brain-skill-qa-"));
const fixtureCommit = "a".repeat(40);
const fixtureFiles: Record<string, string> = {
  "SKILL.md":
    "---\nname: GitHub 导入验收\ndescription: 隔离测试技能，不调用模型\n---\n先读取 references/guide.md，依据用户素材制作方案。",
  LICENSE:
    "MIT License\nCopyright (c) Corporate Brain QA\nPermission is hereby granted, free of charge, to any person obtaining a copy.\n",
  "references/guide.md": "这是随技能一起导入的参考资料，不包含员工数据。",
};
const { app, library } = createPlatform({
  database: ":memory:",
  origins,
  nas: {
    list: async (_source, path, search) => ({
      entries: (path
        ? [
            {
              name: "使用说明.txt",
              directory: false,
              blocked: false,
              bytes: 1200,
              modified: "2026-11-03T00:00:00Z",
            },
          ]
        : [
            {
              name: "项目手册",
              directory: true,
              blocked: false,
              bytes: 0,
              modified: null,
            },
            {
              name: "部门说明.txt",
              directory: false,
              blocked: false,
              bytes: 256,
              modified: "2026-11-03T00:00:00Z",
            },
            {
              name: "受限链接",
              directory: true,
              blocked: true,
              bytes: 0,
              modified: null,
            },
          ]
      ).filter((e) => e.name.includes(search)),
      truncated: false,
    }),
  },
  skillLibrary: {
    root: skillRoot,
    fetch: async (input) => {
      const url = String(input);
      if (url === "https://api.github.com/repos/corporate-qa/import-fixture")
        return Response.json({ default_branch: "main" });
      if (url.endsWith("/commits/main"))
        return Response.json({ sha: fixtureCommit });
      if (url.includes("/git/trees/"))
        return Response.json({
          tree: Object.entries(fixtureFiles).map(([path, content]) => ({
            path,
            type: "blob",
            mode: "100644",
            size: Buffer.byteLength(content),
            sha: createHash("sha1")
              .update(`blob ${Buffer.byteLength(content)}\0`)
              .update(content)
              .digest("hex"),
          })),
        });
      if (
        url.startsWith(
          `https://raw.githubusercontent.com/corporate-qa/import-fixture/${fixtureCommit}/`,
        )
      )
        return new Response(fixtureFiles[url.split(fixtureCommit + "/")[1]]);
      return new Response("Not found", { status: 404 });
    },
  },
  updates: {
    token: "in-memory-update-fixture",
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith("/latest"))
        return Response.json({
          tag_name: `v${next}`,
          draft: false,
          prerelease: false,
          body: "测试更新：验证左侧更新提示、下载进度和完整性校验。\n此为隔离验收素材，不是真实发布，也不会运行安装程序。",
          published_at: "2026-10-19T00:00:00Z",
          assets: ["win32-x64", "darwin-arm64", "darwin-x64"].map(
            (target, i) => ({
              id: i + 1,
              name: installerName(next, target),
              size: payload.length,
              state: "uploaded",
              digest:
                "sha256:" + createHash("sha256").update(payload).digest("hex"),
            }),
          ),
        });
      if (url.includes("/releases/assets/")) return new Response(payload);
      throw new Error("Unexpected QA request");
    },
  },
});
app.get("/model-service-fixture/models", (req, res) => {
  if (req.headers.authorization !== "Bearer synthetic-model-service-ui-key")
    return res.status(401).json({ error: "Synthetic key required" });
  res.json({
    data: [
      { id: "qa-service-model-a" },
      { id: "qa-service-model-b" },
      { id: "qa-service-model-c" },
    ],
  });
});
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1", () => {
  const port = (server.address() as any).port;
  origins.push(`http://127.0.0.1:${port}`);
  process.send?.({ port });
});
process.on("disconnect", () =>
  server.close(() => {
    void library.close().finally(() => {
      rmSync(skillRoot, { recursive: true, force: true });
      process.exit(0);
    });
  }),
);
