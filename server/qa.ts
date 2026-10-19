// A disposable server for Electron interaction tests; never opens the company's database.
import { createPlatform } from "./platform";
import express from "express";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
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
const { app } = createPlatform({
  database: ":memory:",
  origins,
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
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1", () => {
  const port = (server.address() as any).port;
  origins.push(`http://127.0.0.1:${port}`);
  process.send?.({ port });
});
process.on("disconnect", () => server.close(() => process.exit(0)));
