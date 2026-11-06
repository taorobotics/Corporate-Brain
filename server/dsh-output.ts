import { readdir, lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export class DshLoopError extends Error {
  constructor() {
    super(
      "执行器重复调用过多，已停止继续检查；已生成的文件会保留并尝试回传。请根据已有成果继续调整。",
    );
    this.name = "DshLoopError";
  }
}

/** Bound tool loops without storing or exposing tool arguments. */
export function dshRunGuard(sessionId: string, stop: () => void, limit = 64) {
  const calls = new Set<string>();
  return ({
    method,
    params,
  }: {
    method: string;
    params: Record<string, any>;
  }) => {
    if (method !== "session.event" || params.sessionId !== sessionId) return;
    const event = params.event;
    if (event?.type !== "tool/call" || typeof event.data?.callId !== "string")
      return;
    calls.add(event.data.callId);
    if (calls.size > limit) stop();
  };
}

/** Only this turn's dedicated export folder can become an employee download. */
export async function dshOutputFiles(directory: string) {
  const root = resolve(directory);
  const files: string[] = [];
  let total = 0;
  const rootStat = await lstat(root).catch(() => undefined);
  if (!rootStat) return files;
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    (await realpath(root)) !== root
  )
    throw Error("成果目录含链接，无法回传");
  const walk = async (dir: string, depth: number) => {
    if (depth > 12) throw Error("成果目录层级过深");
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name.startsWith("skill-")
      )
        continue;
      const file = join(dir, entry.name),
        path = relative(root, file).replaceAll("\\", "/");
      if (isAbsolute(path) || path.startsWith("../"))
        throw Error("成果路径无效");
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw Error("成果文件含链接，无法回传");
      if (info.isDirectory()) await walk(file, depth + 1);
      else if (info.isFile()) {
        if (info.nlink !== 1 || info.size > 128 * 1024 ** 2)
          throw Error("成果文件过大或含异常链接");
        total += info.size;
        if (total > 512 * 1024 ** 2 || files.length >= 64)
          throw Error("成果超过 64 个文件或 512 MB，请分批制作");
        files.push(path);
      }
    }
  };
  await walk(root, 0);
  return files;
}
