import type { Attachment } from "../shared/attachments";
import { MAX_ATTACHMENT_TEXT } from "../shared/attachments";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type Progress = (message: string) => void;
function size(file: File, megabytes: number) {
  if (!file.size || file.size > megabytes * 1024 * 1024)
    throw new Error(`文件为空或超过 ${megabytes}MB，请拆分后再添加。`);
}
function dataUrl(blob: Blob, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    reader.onload = () => {
      signal.removeEventListener("abort", abort);
      resolve(String(reader.result));
    };
    reader.onerror = reader.onabort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("文件读取失败或已取消"));
    };
    signal.addEventListener("abort", abort, { once: true });
    signal.throwIfAborted();
    reader.readAsDataURL(blob);
  });
}
function canvasImage(canvas: HTMLCanvasElement) {
  const result = canvas.toDataURL("image/jpeg", 0.82);
  if (result.length > 1_400_000)
    throw new Error("画面内容过大，请降低文件分辨率后重试");
  return result;
}
function mediaEvent(
  media: HTMLMediaElement,
  event: string,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      media.removeEventListener(event, done);
      media.removeEventListener("error", failed);
      signal.removeEventListener("abort", failed);
    };
    const done = () => {
      clean();
      resolve();
    };
    const failed = () => {
      clean();
      reject(new Error("视频无法解码或读取已取消，请转成 H.264 MP4 后重试。"));
    };
    const timer = setTimeout(failed, 15000);
    media.addEventListener(event, done, { once: true });
    media.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", failed, { once: true });
    if (signal.aborted) failed();
  });
}
export async function readAttachment(
  file: File,
  progress: Progress,
  signal: AbortSignal,
): Promise<Attachment> {
  signal.throwIfAborted();
  if (file.name.length > 200)
    throw new Error("文件名过长，请缩短到 200 字符以内。");
  const ext = file.name.split(".").pop()?.toLowerCase(),
    base = { name: file.name, content: "" };
  if (["doc", "docx", "xlsx", "pptx"].includes(ext ?? "")) {
    size(file, 10);
    progress("正在读取正文和表格…");
    const data = (await dataUrl(file, signal)).split(",")[1];
    const response = await fetch("/api/attachments/document", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, data }),
      signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "文档解析失败");
    return { ...base, ...result, kind: "document" };
  }
  if (ext === "pdf") {
    size(file, 25);
    progress("正在打开 PDF…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-"))
      throw new Error("文件内容不是有效 PDF。");
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const task = pdfjs.getDocument({
      data: bytes,
      cMapUrl: new URL("/pdf-assets/cmaps/", location.origin).href,
      cMapPacked: true,
      standardFontDataUrl: new URL(
        "/pdf-assets/standard_fonts/",
        location.origin,
      ).href,
      useWasm: false,
      enableXfa: false,
    });
    let password = false;
    task.onPassword = () => {
      password = true;
      void task.destroy();
    };
    const abort = () => {
      void task.destroy();
    };
    signal.addEventListener("abort", abort, { once: true });
    const warnings: string[] = [],
      images: NonNullable<Attachment["images"]> = [];
    let content = "",
      scanned = 0;
    try {
      const pdf = await task.promise;
      for (
        let pageNumber = 1;
        pageNumber <= Math.min(pdf.numPages, 80);
        pageNumber++
      ) {
        signal.throwIfAborted();
        progress(`正在读取 PDF · ${pageNumber} / ${pdf.numPages} 页`);
        const page = await pdf.getPage(pageNumber),
          raw = await page.getTextContent();
        const text = raw.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("")
          .trim();
        if (text.length < 30) scanned++;
        if (content.length < MAX_ATTACHMENT_TEXT)
          content += `\n\n## 第 ${pageNumber} 页\n${text || "（无可提取文字；仅在下方包含该页图片时才能识别）"}`;
        if (images.length < 8 && (text.length < 30 || pageNumber <= 2)) {
          try {
            const original = page.getViewport({ scale: 1 }),
              scale = Math.min(
                2,
                1440 / Math.max(original.width, original.height),
              );
            const viewport = page.getViewport({ scale }),
              canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const rendering = page.render({
              canvas,
              viewport,
              background: "white",
              annotationMode: pdfjs.AnnotationMode.DISABLE,
            });
            const cancel = () => rendering.cancel();
            signal.addEventListener("abort", cancel, { once: true });
            try {
              await rendering.promise;
              images.push({
                label: `PDF 第 ${pageNumber} 页`,
                image: canvasImage(canvas),
              });
            } finally {
              signal.removeEventListener("abort", cancel);
              canvas.width = canvas.height = 0;
            }
          } catch {
            signal.throwIfAborted();
            warnings.push(
              `第 ${pageNumber} 页画面无法渲染；该页只提供提取到的文字。`,
            );
          }
        }
        page.cleanup();
        if (content.length >= MAX_ATTACHMENT_TEXT) {
          warnings.push(
            `文字达到 120000 字符，仅读取到第 ${pageNumber} 页；请拆分后分析后续内容。`,
          );
          break;
        }
      }
      if (pdf.numPages > 80)
        warnings.push("仅处理前 80 页，请拆分 PDF 以分析后续页面。");
      if (scanned)
        warnings.push(
          "含扫描或图文页面：最多附带 8 页画面供视觉模型识别，未附带页面不保证可读。",
        );
      return {
        ...base,
        kind: "pdf",
        content: content.slice(0, MAX_ATTACHMENT_TEXT),
        images,
        summary: `${pdf.numPages} 页 · ${Math.min(content.length, MAX_ATTACHMENT_TEXT)} 字符 · ${images.length} 页画面`,
        warnings,
      };
    } catch (error) {
      if (password) throw new Error("PDF 有密码保护，请解密后重新添加。");
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      await task.destroy();
    }
  }
  if (["mp4", "mov", "webm", "m4v"].includes(ext ?? "")) {
    size(file, 200);
    progress("正在读取视频信息…");
    const video = document.createElement("video"),
      url = URL.createObjectURL(file);
    video.muted = true;
    video.preload = "auto";
    try {
      const loaded = mediaEvent(video, "loadedmetadata", signal);
      video.src = url;
      video.load();
      await loaded;
      if (
        !Number.isFinite(video.duration) ||
        video.duration <= 0 ||
        video.duration > 600
      )
        throw new Error("视频需在 10 分钟以内；请剪成短片段后添加。");
      if (!video.videoWidth || !video.videoHeight)
        throw new Error("没有可读取的视频画面。");
      const duration = video.duration,
        count = Math.min(8, Math.max(1, Math.ceil(duration / 2))),
        images: NonNullable<Attachment["images"]> = [];
      const scale = Math.min(
          1,
          1280 / Math.max(video.videoWidth, video.videoHeight),
        ),
        canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      for (let i = 0; i < count; i++) {
        signal.throwIfAborted();
        const time = Math.min(
          Math.max(0, duration - 0.05),
          ((i + 0.5) * duration) / count,
        );
        progress(`正在提取视频画面 · ${i + 1} / ${count}`);
        if (Math.abs(video.currentTime - time) < 0.001) {
          if (video.readyState < 2)
            await mediaEvent(video, "loadeddata", signal);
        } else {
          const seek = mediaEvent(video, "seeked", signal);
          video.currentTime = time;
          await seek;
        }
        canvas
          .getContext("2d")!
          .drawImage(video, 0, 0, canvas.width, canvas.height);
        const label = `${Math.floor(time / 60)
          .toString()
          .padStart(2, "0")}:${(time % 60).toFixed(2).padStart(5, "0")}`;
        images.push({ label, image: canvasImage(canvas) });
      }
      canvas.width = canvas.height = 0;
      return {
        ...base,
        kind: "video",
        images,
        content: `视频时长 ${duration.toFixed(2)} 秒。只提供 ${images.length} 张等间隔抽样画面，时间点为 ${images.map((x) => x.label).join("、")}。没有读取音轨，不能根据这些画面推断声音或未采样瞬间。`,
        summary: `${duration.toFixed(1)} 秒 · ${images.length} 张画面`,
        warnings: [
          "仅分析抽样画面，不读取声音；可能遗漏短暂动作。可同时添加 SRT / VTT 字幕补充对白。",
        ],
      };
    } finally {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }
  }
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext ?? "")) {
    size(file, 20);
    progress("正在读取图片…");
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 80_000_000)
        throw new Error("图片像素过大，请缩小后重试");
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height)),
        canvas = document.createElement("canvas");
      canvas.width = Math.ceil(bitmap.width * scale);
      canvas.height = Math.ceil(bitmap.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return {
        ...base,
        kind: "image",
        image: canvasImage(canvas),
        summary: `${bitmap.width} × ${bitmap.height}`,
        warnings: ext === "gif" ? ["GIF 只读取第一帧。"] : [],
      };
    } finally {
      bitmap.close();
    }
  }
  if (["txt", "md", "csv", "json", "log", "srt", "vtt"].includes(ext ?? "")) {
    size(file, 5);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text: string;
    try {
      text = new TextDecoder(
        bytes[0] === 255 && bytes[1] === 254
          ? "utf-16le"
          : bytes[0] === 254 && bytes[1] === 255
            ? "utf-16be"
            : "utf-8",
        { fatal: true },
      ).decode(bytes);
    } catch {
      text = new TextDecoder("gb18030").decode(bytes);
    }
    if (text.includes("\0"))
      throw new Error("文件包含二进制内容，请选择实际文本文件");
    return {
      ...base,
      kind: "text",
      content: text.slice(0, MAX_ATTACHMENT_TEXT),
      summary: `${Math.min(text.length, MAX_ATTACHMENT_TEXT)} 字符`,
      warnings:
        text.length > MAX_ATTACHMENT_TEXT
          ? ["仅提取前 120000 字符，请拆分后分析其余内容。"]
          : [],
    };
  }
  throw new Error(
    "支持 DOC、DOCX、PDF、XLSX、PPTX、文本、图片和 MP4 / MOV / WebM 视频。旧版 XLS / PPT 请另存为 XLSX / PPTX。",
  );
}
