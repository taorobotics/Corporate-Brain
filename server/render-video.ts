import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { mkdir, rm, writeFile, access } from "node:fs/promises";
const require = createRequire(import.meta.url);
export class RenderFailure extends Error {}
export type RenderRequest = {
  directory: string;
  seconds: number;
  signal: AbortSignal;
  progress: (value: number) => void;
};
export interface VideoRenderer {
  id: "canvas" | "remotion";
  render(request: RenderRequest): Promise<void>;
}

// Remotion can implement this interface after the company obtains its licence.
// Only the free Canvas adapter is registered and enabled in this release.
export async function renderCanvasVideo(request: RenderRequest) {
  const electron = process.env.BRAIN_RENDER_ELECTRON || require("electron");
  const ffmpeg = process.env.BRAIN_RENDER_FFMPEG || require("ffmpeg-static");
  if (!electron || !ffmpeg)
    throw new RenderFailure("渲染组件尚未安装，请联系管理员");
  try {
    await access(electron);
    await access(ffmpeg);
  } catch {
    throw new RenderFailure("渲染组件文件不可用，请联系管理员");
  }
  const scratch = join(request.directory, ".render");
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const config = join(scratch, "config.json");
  await writeFile(
    config,
    JSON.stringify({
      directory: request.directory,
      seconds: request.seconds,
      ffmpeg,
      parentPid: process.pid,
    }),
  );
  const environment: NodeJS.ProcessEnv = {
    PATH:
      process.platform === "win32"
        ? (process.env.SystemRoot || "C:\\Windows") + "\\System32"
        : "/usr/bin:/bin",
    HOME: scratch,
    TMPDIR: scratch,
    TMP: scratch,
    TEMP: scratch,
    LANG: "en_US.UTF-8",
    XDG_CACHE_HOME: scratch,
    ...(process.platform === "win32"
      ? {
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          SystemDrive: process.env.SystemDrive,
          COMSPEC: process.env.COMSPEC,
          USERNAME: process.env.USERNAME,
          USERPROFILE: scratch,
          LOCALAPPDATA: scratch,
          APPDATA: scratch,
        }
      : {}),
  };
  try {
    request.signal.throwIfAborted();
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(
        electron,
        [resolve("server/canvas-renderer.cjs"), config],
        {
          cwd: scratch,
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          detached: process.platform !== "win32",
        },
      );
      let errorText = "",
        buffer = "",
        escalation: NodeJS.Timeout | undefined;
      const stop = () => {
        if (!child.pid) return;
        if (process.platform === "win32") {
          spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
        } else {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {}
          escalation = setTimeout(() => {
            try {
              process.kill(-child.pid!, "SIGKILL");
            } catch {}
          }, 2000);
        }
      };
      const timer = setTimeout(stop, 15 * 60_000);
      request.signal.addEventListener("abort", stop, { once: true });
      child.stdout.on("data", (chunk) => {
        buffer = (buffer + chunk.toString()).slice(-10000);
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines)
          if (line.startsWith("PROGRESS "))
            request.progress(Number(line.slice(9)) || 0);
      });
      child.stderr.on("data", (chunk) => {
        errorText = (errorText + chunk.toString()).slice(-3000);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        clearTimeout(escalation);
        request.signal.removeEventListener("abort", stop);
        if (request.signal.aborted) reject(new Error("渲染已取消"));
        else if (code === 0) resolvePromise();
        else
          reject(
            new RenderFailure(
              /SyntaxError/.test(errorText)
                ? "视频渲染失败：动画代码存在语法错误"
                : /ReferenceError/.test(errorText)
                  ? "视频渲染失败：动画使用了未定义的变量或不支持的接口"
                  : /Encoder failed/.test(errorText)
                    ? "视频编码失败，请重试或检查素材格式"
                    : "视频渲染未完成，请重试；原始素材已保留",
            ),
          );
      });
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
export const videoRenderers: VideoRenderer[] = [
  { id: "canvas", render: renderCanvasVideo },
];
