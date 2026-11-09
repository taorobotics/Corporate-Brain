import { zipSync, strToU8 } from "fflate";
function xml(text: string) {
  return text
    .replace(/[\uD800-\uDFFF]/gu, "�")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(
      /[<>&"']/g,
      (c) =>
        (
          ({
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            '"': "&quot;",
            "'": "&apos;",
          }) as Record<string, string>
        )[c]!,
    );
}
export function draftDocx(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const body: string[] = [];
  let code = false;
  const text = (v: string) =>
    v.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
  const paragraph = (value: string, bold = false, size = 22) =>
    `<w:p><w:pPr><w:spacing w:after="120" w:line="300"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${code ? "Consolas" : "Calibri"}" w:eastAsia="Microsoft YaHei"/>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(text(value))}</w:t></w:r></w:p>`;
  const cells = (v: string) =>
    v
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((s) => s.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      code = !code;
      continue;
    }
    if (
      !code &&
      line.includes("|") &&
      /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")
    ) {
      const rows = [cells(line)];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(cells(lines[i]));
        i++;
      }
      i--;
      body.push(
        '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/></w:tblBorders></w:tblPr>' +
          rows
            .map(
              (r, n) =>
                "<w:tr>" +
                r
                  .map((c) => "<w:tc>" + paragraph(c, n === 0) + "</w:tc>")
                  .join("") +
                "</w:tr>",
            )
            .join("") +
          "</w:tbl>",
      );
      continue;
    }
    const heading = !code && /^(#{1,6})\s+(.+)$/.exec(line);
    body.push(
      heading
        ? paragraph(heading[2], true, Math.max(24, 34 - heading[1].length * 2))
        : paragraph(line.replace(/^[-*]\s+/, "• ")),
    );
  }
  const files: { [key: string]: string } = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      body.join("") +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
  };
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([p, s]) => [p, strToU8(s)]),
      ),
    ),
  );
}
