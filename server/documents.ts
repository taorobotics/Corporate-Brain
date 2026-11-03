import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Express, Request } from "express";
import { z } from "zod";
import type { User } from "../shared/types";
import { tokenHash, type Store } from "./database";

export function parseOffice(name: string, data: string, signal: AbortSignal) {
  return new Promise<{ content: string; summary: string; warnings: string[] }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=128",
          fileURLToPath(new URL("./document-worker.cjs", import.meta.url)),
        ],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "ignore"],
          env: {
            ...(process.env.SystemRoot
              ? { SystemRoot: process.env.SystemRoot }
              : {}),
          },
        },
      );
      let output = "",
        settled = false;
      const finish = (error?: Error, result?: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        child.kill();
        error ? reject(error) : resolve(result);
      };
      const abort = () => finish(new Error("文档读取已取消"));
      const timer = setTimeout(
        () =>
          finish(new Error("文档解析超时，请拆分文件或另存为 PDF 后重试。")),
        20000,
      );
      signal.addEventListener("abort", abort, { once: true });
      child.on("error", () => finish(new Error("文档解析服务暂不可用")));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
        if (output.length > 1_000_000) finish(new Error("文档解析结果过大"));
      });
      child.stdin.on("error", () => {});
      child.on("close", () => {
        if (settled) return;
        try {
          const value = JSON.parse(output);
          if (value.error) throw Error(value.error);
          const checked = z
            .object({
              content: z.string().max(120000),
              summary: z.string().max(200),
              warnings: z.array(z.string().max(300)).max(8),
            })
            .strict()
            .parse(value);
          finish(undefined, checked);
        } catch {
          finish(
            new Error(
              "无法解析该文档。请确认文件未损坏、未加密，或另存为 DOCX / PDF 后重试。",
            ),
          );
        }
      });
      if (signal.aborted) abort();
      else child.stdin.end(JSON.stringify({ name, data }));
    },
  );
}

export function mountDocuments(
  app: Express,
  store: Store,
  getActor: (req: Request) => User,
  fail: (status: number, message: string) => never,
) {
  const active = new Set<string>();
  app.post("/api/attachments/document", async (req, res) => {
    const actor = getActor(req);
    const input = z
      .object({
        name: z
          .string()
          .min(1)
          .max(200)
          .regex(/\.(doc|docx|xlsx|pptx)$/i),
        data: z
          .string()
          .min(4)
          .max(14_000_000)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/)
          .refine((s) => s.length % 4 === 0),
      })
      .strict()
      .parse(req.body);
    if (Buffer.byteLength(input.data, "base64") > 10 * 1024 * 1024)
      fail(413, "Office 文档请小于 10MB");
    if (active.has(actor.id) || active.size >= 2)
      fail(429, "文档解析正在进行，请稍后再试");
    active.add(actor.id);
    const controller = new AbortController();
    const close = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", close);
    try {
      const result = await parseOffice(
        input.name,
        input.data,
        controller.signal,
      );
      const valid = store.db
        .prepare(
          "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN departments d ON d.id=u.department_id WHERE s.token_hash=? AND s.auth_version=u.auth_version AND u.enabled=1 AND d.enabled=1 AND s.expires_at>?",
        )
        .get(tokenHash(req.cookies.brain_session), Date.now());
      if (!valid) {
        res.status(401).json({ error: "登录或权限已变更，请重新登录" });
        return;
      }
      res.json(result);
    } catch (error) {
      if (!res.destroyed)
        res.status(422).json({ error: (error as Error).message });
    } finally {
      active.delete(actor.id);
      res.off("close", close);
    }
  });
}
