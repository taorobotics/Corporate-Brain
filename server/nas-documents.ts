import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { NasDocument } from "../shared/nas";

export async function parseNasDocument(
  path: string,
  data: Buffer,
  modified: string | null,
  offset: number,
  signal: AbortSignal,
): Promise<NasDocument> {
  if (data.length > 10 * 1024 * 1024) throw Error("NAS 文档请小于 10MB");
  signal.throwIfAborted();
  const name = path.split("/").at(-1)!;
  const parsed = await new Promise<{
    content: string;
    summary: string;
    warnings: string[];
    readable?: boolean;
  }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        fileURLToPath(new URL("./nas-document-worker.cjs", import.meta.url)),
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
        env: process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {},
      },
    );
    let text = "",
      finished = false;
    const finish = (error?: Error, value?: any) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      child.kill();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new Error("NAS 文档读取已取消"));
    const timer = setTimeout(
      () => finish(new Error("文档解析超时，请拆分后重试")),
      25000,
    );
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", () => finish(new Error("文档解析组件不可用")));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      text += chunk;
      if (text.length > 1000000) finish(new Error("文档解析结果过大"));
    });
    child.stdin.on("error", () => {});
    child.on("close", () => {
      try {
        const value = JSON.parse(text);
        if (value.error) throw Error(value.error);
        finish(
          undefined,
          z
            .object({
              content: z.string().max(120000),
              summary: z.string().max(300),
              warnings: z.array(z.string().max(500)).max(16),
              readable: z.boolean().optional(),
            })
            .strict()
            .parse(value),
        );
      } catch {
        finish(
          new Error(
            "文档无法解析，可能已加密、损坏或编码不受支持，请另存为可读 Word、PDF 或 UTF-8 文本。",
          ),
        );
      }
    });
    if (signal.aborted) abort();
    else
      child.stdin.end(JSON.stringify({ name, data: data.toString("base64") }));
  });
  signal.throwIfAborted();
  if (offset > parsed.content.length)
    throw Error("正文读取位置超出已解析范围，请从头读取");
  const end = Math.min(parsed.content.length, offset + 30000),
    content = parsed.content.slice(offset, end);
  return {
    path,
    name,
    content,
    summary: parsed.summary,
    warnings: [
      ...parsed.warnings,
      ...(end < parsed.content.length
        ? [
            `本次读取第 ${offset + 1}–${end} 字符，后续正文尚未发送，可继续读取。`,
          ]
        : []),
    ],
    offset,
    nextOffset: end < parsed.content.length ? end : null,
    totalCharacters: parsed.content.length,
    bytes: data.length,
    modified,
    sha256: createHash("sha256").update(data).digest("hex"),
    readable: parsed.readable !== false && !!content.trim(),
  };
}
