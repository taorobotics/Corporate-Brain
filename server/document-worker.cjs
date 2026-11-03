// Pure, bounded Office extraction. No Office macros, external relations or files are executed.
const yauzl = require("yauzl");
const { SaxesParser } = require("saxes");
const posix = require("node:path").posix;
const MAX_TEXT = 120_000,
  MAX_RAW = 10 * 1024 * 1024;
function xml(text, callbacks) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => {
    throw Error("DTD is not allowed");
  });
  for (const [event, handler] of Object.entries(callbacks))
    parser.on(event, handler);
  parser.write(text).close();
}
function textXml(text) {
  let result = "",
    inText = 0;
  xml(text, {
    opentag: (tag) => {
      if (tag.local === "t") inText++;
      if (["tab", "br", "cr"].includes(tag.local))
        result += tag.local === "tab" ? "\t" : "\n";
    },
    text: (value) => {
      if (inText && result.length < MAX_TEXT + 1) result += value;
    },
    closetag: (tag) => {
      if (tag.local === "t") inText--;
      if (["p", "tr"].includes(tag.local)) result += "\n";
      if (tag.local === "tc") result += "\t";
    },
  });
  return result;
}
function zipXml(buffer) {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error) return reject(error);
        const files = new Map();
        let count = 0,
          expanded = 0,
          failed = false;
        const stop = (error) => {
          if (failed) return;
          failed = true;
          zip.close();
          reject(error);
        };
        zip.on("error", stop);
        zip.on("end", () => {
          if (!failed) resolve(files);
        });
        zip.on("entry", (entry) => {
          if (
            ++count > 3000 ||
            entry.fileName.includes("\\") ||
            entry.fileName.split("/").some((p) => p === "..") ||
            entry.fileName.startsWith("/") ||
            entry.generalPurposeBitFlag & 1
          )
            return stop(Error("Invalid archive"));
          expanded += entry.uncompressedSize;
          if (expanded > 40 * 1024 * 1024)
            return stop(Error("Archive expansion limit"));
          if (
            !/^(?:(?:word\/(document|header\d+|footer\d+)|ppt\/(presentation|slides\/slide\d+)|xl\/(sharedStrings|workbook|worksheets\/sheet\d+))\.xml|(?:ppt\/_rels\/presentation|xl\/_rels\/workbook)\.xml\.rels)$/.test(
              entry.fileName,
            )
          )
            return zip.readEntry();
          if (
            files.has(entry.fileName) ||
            entry.uncompressedSize > 6 * 1024 * 1024
          )
            return stop(Error("XML limit"));
          zip.openReadStream(entry, (error, stream) => {
            if (error) return stop(error);
            const chunks = [];
            let size = 0;
            stream.on("data", (chunk) => {
              size += chunk.length;
              if (size > 6 * 1024 * 1024) {
                stream.destroy();
                stop(Error("XML limit"));
              } else chunks.push(chunk);
            });
            stream.on("error", stop);
            stream.on("end", () => {
              if (failed) return;
              const bytes = Buffer.concat(chunks);
              try {
                files.set(
                  entry.fileName,
                  new TextDecoder(
                    bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : "utf-8",
                    { fatal: true },
                  ).decode(bytes),
                );
                zip.readEntry();
              } catch (error) {
                stop(error);
              }
            });
          });
        });
        zip.readEntry();
      },
    ),
  );
}
async function extractDocument(name, buffer) {
  if (!buffer.length || buffer.length > MAX_RAW) throw Error("File size limit");
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
  let text = "",
    units = 0;
  const warnings = [];
  if (ext === "doc") {
    if (!buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")))
      throw Error("Not a Word document");
    const WordExtractor = require("word-extractor");
    const document = await new WordExtractor().extract(buffer);
    text = [
      document.getBody(),
      document.getHeaders(),
      document.getFootnotes(),
      document.getEndnotes(),
    ]
      .filter(Boolean)
      .join("\n\n");
  } else {
    if (
      !["docx", "pptx", "xlsx"].includes(ext) ||
      buffer.readUInt32LE(0) !== 0x04034b50
    )
      throw Error("Not an Office archive");
    const files = await zipXml(buffer);
    if (ext === "docx") {
      if (!files.has("word/document.xml")) throw Error("Missing document");
      text = textXml(files.get("word/document.xml"));
      for (const [path, source] of files)
        if (/word\/(header|footer)/.test(path)) text += "\n" + textXml(source);
    } else if (ext === "pptx") {
      const slides = orderedParts(
        files,
        "ppt",
        "presentation",
        "sldId",
        /^ppt\/slides\/slide\d+\.xml$/,
      );
      units = slides.length;
      text = slides
        .slice(0, 100)
        .map(([_, source], i) => `## 第 ${i + 1} 张幻灯片\n${textXml(source)}`)
        .join("\n\n");
      if (units > 100) warnings.push("仅提取前 100 张幻灯片。");
    } else {
      const strings = [];
      let inSi = false,
        value = "",
        inT = false;
      if (files.has("xl/sharedStrings.xml"))
        xml(files.get("xl/sharedStrings.xml"), {
          opentag: (tag) => {
            if (tag.local === "si") {
              inSi = true;
              value = "";
            }
            if (tag.local === "t") inT = true;
          },
          text: (text) => {
            if (inSi && inT) value += text;
          },
          closetag: (tag) => {
            if (tag.local === "t") inT = false;
            if (tag.local === "si") {
              strings.push(value);
              inSi = false;
            }
          },
        });
      const sheets = orderedParts(
        files,
        "xl",
        "workbook",
        "sheet",
        /^xl\/worksheets\/sheet\d+\.xml$/,
      );
      units = sheets.length;
      let cells = 0;
      for (const [path, source, title] of sheets.slice(0, 30)) {
        text += `\n## 工作表 ${title || /sheet(\d+)/.exec(path)[1]}\n`;
        let cell = null,
          capture = false;
        xml(source, {
          opentag: (tag) => {
            if (tag.local === "c")
              cell = {
                type: tag.attributes.t?.value,
                ref: tag.attributes.r?.value || "",
                value: "",
              };
            if (["v", "t"].includes(tag.local)) capture = true;
          },
          text: (value) => {
            if (cell && capture) cell.value += value;
          },
          closetag: (tag) => {
            if (["v", "t"].includes(tag.local)) capture = false;
            if (tag.local === "c" && cell) {
              if (++cells <= 20000 && text.length < MAX_TEXT + 1) {
                const v =
                  cell.type === "s"
                    ? (strings[Number(cell.value)] ?? "")
                    : cell.value;
                text += `${cell.ref}: ${v}\t`;
              }
              cell = null;
            }
            if (tag.local === "row" && text.length < MAX_TEXT + 1) text += "\n";
          },
        });
      }
      warnings.push(
        "读取工作表已保存的单元格值，不执行公式或宏；日期可能显示为原始数值。",
      );
      if (cells > 20000 || units > 30)
        warnings.push("仅提取前 30 个工作表、最多 20000 个单元格。");
    }
  }
  if (!text.trim()) throw Error("No readable text");
  if (text.length > MAX_TEXT)
    warnings.push("文档较长，仅提取前 120000 字符；请拆分文件以分析其余内容。");
  warnings.push("提取正文和表格文字，不包含内嵌图片、批注或完整排版。");
  return {
    content: text.slice(0, MAX_TEXT),
    summary: `已提取 ${Math.min(text.length, MAX_TEXT)} 字符${units ? ` · ${units} ${ext === "xlsx" ? "个工作表" : "张幻灯片"}` : ""}`,
    warnings,
  };
}
function orderedParts(files, prefix, root, element, pattern) {
  const rels = new Map(),
    order = [];
  const relation = files.get(`${prefix}/_rels/${root}.xml.rels`),
    index = files.get(`${prefix}/${root}.xml`);
  if (relation && index) {
    xml(relation, {
      opentag: (tag) => {
        if (
          tag.local === "Relationship" &&
          tag.attributes.TargetMode?.value !== "External"
        ) {
          const target = tag.attributes.Target?.value || "",
            path = target.startsWith("/")
              ? target.slice(1)
              : posix.normalize(prefix + "/" + target);
          if (pattern.test(path)) rels.set(tag.attributes.Id?.value, path);
        }
      },
    });
    xml(index, {
      opentag: (tag) => {
        if (tag.local === element) {
          const path = rels.get(tag.attributes["r:id"]?.value);
          if (path && files.has(path))
            order.push([
              path,
              files.get(path),
              tag.attributes.name?.value?.slice(0, 100),
            ]);
        }
      },
    });
  }
  return order.length
    ? order
    : [...files]
        .filter(([p]) => pattern.test(p))
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}
module.exports = { extractDocument };
if (require.main === module) {
  let size = 0;
  const chunks = [];
  process.stdin.on("data", (chunk) => {
    size += chunk.length;
    if (size > 14_500_000) process.exit(1);
    chunks.push(chunk);
  });
  process.stdin.on("end", async () => {
    try {
      const { name, data } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const result = await extractDocument(name, Buffer.from(data, "base64"));
      process.stdout.write(JSON.stringify(result));
    } catch {
      process.stdout.write(
        JSON.stringify({
          error:
            "无法解析该文档。请确认文件未损坏、未加密，或另存为 DOCX / PDF 后重试。",
        }),
      );
      process.exitCode = 1;
    }
  });
}
