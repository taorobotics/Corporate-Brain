// Extract document text in a bounded child process; never execute macros, scripts or links.
const { extractDocument } = require("./document-worker.cjs");
const { dirname, join } = require("node:path");
const MAX_TEXT = 120000;
async function extract(name, bytes) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw Error("size");
  const ext = name.split(".").at(-1).toLowerCase();
  if (["doc", "docx", "xlsx", "pptx"].includes(ext)) {
    const result = await extractDocument(name, bytes);
    result.warnings.push(
      "只提取正文和表格文字，不包含原版式、嵌入图片或批注。",
    );
    return result;
  }
  if (ext === "pdf") {
    if (!bytes.subarray(0, 1024).toString("latin1").includes("%PDF-"))
      throw Error("format");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const base = dirname(require.resolve("pdfjs-dist/package.json"));
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      enableXfa: false,
      useWasm: false,
      useWorkerFetch: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: true,
      verbosity: 0,
      cMapUrl: join(base, "cmaps") + "/",
      cMapPacked: true,
      standardFontDataUrl: join(base, "standard_fonts") + "/",
    });
    try {
      const pdf = await task.promise;
      let text = "",
        readPages = 0,
        scanned = 0;
      for (
        let n = 1;
        n <= Math.min(pdf.numPages, 80) && text.length < MAX_TEXT;
        n++
      ) {
        const page = await pdf.getPage(n),
          content = await page.getTextContent();
        const value = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("")
          .trim();
        readPages = n;
        if (!value) scanned++;
        text += "\n\n## 第 " + n + " 页\n" + (value || "（此页未提取到文字）");
        page.cleanup();
      }
      const warnings = [
        "仅提取 PDF 可选文字，图片、图表及扫描画面未进行 OCR。",
      ];
      if (scanned)
        warnings.push(scanned + " 页没有可提取文字，请上传清晰图片进行识别。");
      if (readPages < pdf.numPages || text.length > MAX_TEXT)
        warnings.push(
          "当前仅解析前 " +
            readPages +
            " 页、最多 " +
            MAX_TEXT +
            " 字符，未读取其余范围。",
        );
      return {
        content: text.slice(0, MAX_TEXT),
        summary: `PDF · 读取 ${readPages} / ${pdf.numPages} 页`,
        warnings,
        readable: scanned < readPages,
      };
    } finally {
      await task.destroy();
    }
  }
  if (
    ![
      "txt",
      "md",
      "csv",
      "json",
      "log",
      "srt",
      "vtt",
      "js",
      "ts",
      "py",
      "html",
      "css",
    ].includes(ext)
  )
    throw Error("unsupported");
  let text,
    warnings = [];
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff)
    text = new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("gb18030", { fatal: true }).decode(bytes);
      warnings.push("文件按 GB18030 中文编码读取。");
    }
  }
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw Error("binary");
  if (text.length > MAX_TEXT)
    warnings.push("当前仅解析前 " + MAX_TEXT + " 字符，未读取其余范围。");
  return {
    content: text.slice(0, MAX_TEXT),
    summary: "文本 · " + Math.min(text.length, MAX_TEXT) + " 字符",
    warnings,
  };
}
module.exports = { extract };
if (require.main === module) {
  let size = 0;
  const chunks = [];
  process.stdin.on("data", (chunk) => {
    size += chunk.length;
    if (size > 14500000) process.exit(1);
    chunks.push(chunk);
  });
  process.stdin.on("end", async () => {
    try {
      const { name, data } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const value = await extract(name, Buffer.from(data, "base64"));
      process.stdout.write(JSON.stringify(value));
    } catch {
      process.stdout.write(
        JSON.stringify({
          error:
            "文档无法解析，可能已加密、损坏、编码不支持或没有可提取文字。请另存为可读的 Word、PDF 或 UTF-8 文本。",
        }),
      );
      process.exitCode = 1;
    }
  });
}
