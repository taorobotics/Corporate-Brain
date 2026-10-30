import type { ReactNode } from "react";

type TableBlock = {
  kind: "table";
  headers: string[];
  alignments: ("left" | "center" | "right")[];
  rows: string[][];
};

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string; value: string }
  | { kind: "rule" }
  | TableBlock;

function splitTableRow(line: string) {
  const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const char of value) {
    if (char === "|" && !escaped) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    if (char === "\\" && !escaped) {
      escaped = true;
      cell += char;
      continue;
    }
    escaped = false;
    cell += char;
  }
  cells.push(cell.trim());
  return cells.map((item) => item.replace(/\\\|/g, "|"));
}

function isTableDivider(line: string) {
  const cells = splitTableRow(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))
  );
}

function tableAlignment(cell: string): "left" | "center" | "right" {
  const value = cell.replace(/\s/g, "");
  if (value.startsWith(":") && value.endsWith(":")) return "center";
  if (value.endsWith(":")) return "right";
  return "left";
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index] ?? "";
  return (
    /^ {0,3}#{1,6}\s+/.test(line) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
    /^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(line) ||
    /^ {0,3}>/.test(line) ||
    /^ {0,3}```/.test(line) ||
    (line.includes("|") && isTableDivider(lines[index + 1] ?? ""))
  );
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^ {0,3}```\s*([^\s`]*)\s*$/);
    if (fence) {
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !/^ {0,3}```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language: fence[1] || "", value: code.join("\n") });
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }
    if (line.includes("|") && isTableDivider(lines[index + 1] ?? "")) {
      const headers = splitTableRow(line);
      const divider = splitTableRow(lines[index + 1]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        const row = splitTableRow(lines[index]);
        rows.push(headers.map((_, cellIndex) => row[cellIndex] ?? ""));
        index += 1;
      }
      blocks.push({
        kind: "table",
        headers,
        alignments: headers.map((_, cellIndex) => tableAlignment(divider[cellIndex] ?? "")),
        rows,
      });
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index])) {
        quote.push(lines[index].replace(/^ {0,3}>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quote });
      continue;
    }
    const listItem = line.match(/^ {0,3}([-+*]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      const ordered = /^\d/.test(listItem[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^ {0,3}([-+*]|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(item[2]);
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const paragraph: string[] = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines, index)
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

function safeHref(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function inlineText(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = value;
  let key = 0;
  const patterns = [
    { regex: /`([^`]+)`/, render: (match: RegExpExecArray) => <code key={`${keyPrefix}-code-${key++}`}>{match[1]}</code> },
    { regex: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/, render: (match: RegExpExecArray) => {
      const href = safeHref(match[2]);
      return href ? <a key={`${keyPrefix}-link-${key++}`} href={href} target="_blank" rel="noreferrer">{match[1]}</a> : match[1];
    } },
    { regex: /\*\*([^*]+)\*\*/, render: (match: RegExpExecArray) => <strong key={`${keyPrefix}-strong-${key++}`}>{inlineText(match[1], `${keyPrefix}-strong`)}</strong> },
    { regex: /__([^_]+)__/, render: (match: RegExpExecArray) => <strong key={`${keyPrefix}-strong-${key++}`}>{inlineText(match[1], `${keyPrefix}-strong`)}</strong> },
    { regex: /\*([^*]+)\*/, render: (match: RegExpExecArray) => <em key={`${keyPrefix}-em-${key++}`}>{inlineText(match[1], `${keyPrefix}-em`)}</em> },
    { regex: /_([^_]+)_/, render: (match: RegExpExecArray) => <em key={`${keyPrefix}-em-${key++}`}>{inlineText(match[1], `${keyPrefix}-em`)}</em> },
  ];
  while (rest) {
    let earliest: { index: number; match: RegExpExecArray; render: (match: RegExpExecArray) => ReactNode } | null = null;
    for (const pattern of patterns) {
      const match = pattern.regex.exec(rest);
      if (match && (!earliest || match.index < earliest.index)) {
        earliest = { index: match.index, match, render: pattern.render };
      }
    }
    if (!earliest) {
      nodes.push(rest);
      break;
    }
    if (earliest.index > 0) nodes.push(rest.slice(0, earliest.index));
    nodes.push(earliest.render(earliest.match));
    rest = rest.slice(earliest.index + earliest.match[0].length);
  }
  return nodes;
}

function plainText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function chartValue(value: string) {
  const plain = plainText(value).replace(/,/g, "");
  const matches = plain.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (matches.length !== 1) return null;
  const number = Number(matches[0]);
  if (!Number.isFinite(number)) return null;
  return { number, unit: plain.replace(matches[0], "").replace(/\s+/g, " ").trim() };
}

function TableChart({ table }: { table: TableBlock }) {
  if (table.rows.length < 3) return null;
  const valueColumn = table.headers.findIndex(
    (_, index) => index > 0 && table.rows.some((row) => chartValue(row[index] ?? "")),
  );
  if (valueColumn < 0) return null;
  const data = table.rows
    .map((row) => {
      const value = chartValue(row[valueColumn] ?? "");
      return value
        ? {
            label: plainText(row[0] ?? "").slice(0, 16),
            display: plainText(row[valueColumn] ?? ""),
            ...value,
          }
        : null;
    })
    .filter((item): item is { label: string; display: string; number: number; unit: string } => Boolean(item));
  if (data.length < 3) return null;
  const unitCounts = new Map<string, number>();
  for (const item of data) unitCounts.set(item.unit, (unitCounts.get(item.unit) ?? 0) + 1);
  const primaryUnit = [...unitCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
  const chartData = data.filter((item) => item.unit === primaryUnit);
  if (chartData.length < 3) return null;
  const min = Math.min(...chartData.map((item) => item.number));
  const max = Math.max(...chartData.map((item) => item.number));
  const span = max - min || Math.abs(max) || 1;
  return (
    <div className="message-table-chart" aria-label="表格数据图表">
      <div className="message-table-chart-heading">
        <strong>数据概览</strong>
        <span>{table.headers[valueColumn] || "数值"}</span>
      </div>
      <div className="message-table-bars">
        {chartData.map((item) => (
          <div className="message-table-bar-row" key={`${item.label}-${item.number}`}>
            <span title={item.label}>{item.label || "项目"}</span>
            <div className="message-table-bar-track">
              <i style={{ width: `${Math.max(4, ((item.number - min) / span) * 100)}%` }} />
            </div>
            <b>{item.display || String(item.number)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Heading = `h${Math.min(block.level, 4)}` as "h1" | "h2" | "h3" | "h4";
      return <Heading key={index}>{inlineText(block.text, `heading-${index}`)}</Heading>;
    }
    case "paragraph":
      return <p key={index}>{block.lines.map((line, lineIndex) => <span key={lineIndex}>{inlineText(line, `paragraph-${index}-${lineIndex}`)}{lineIndex < block.lines.length - 1 && <br />}</span>)}</p>;
    case "quote":
      return <blockquote key={index}>{inlineText(block.lines.join("\n"), `quote-${index}`)}</blockquote>;
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineText(item, `list-${index}-${itemIndex}`)}</li>)}</List>;
    }
    case "code":
      return <pre key={index}><code data-language={block.language || undefined}>{block.value}</code></pre>;
    case "rule":
      return <hr key={index} />;
    case "table":
      return (
        <div className="message-table-group" key={index}>
          <div className="message-table-scroll">
            <table className="message-table">
              <thead><tr>{block.headers.map((header, cellIndex) => <th key={cellIndex} style={{ textAlign: block.alignments[cellIndex] }}>{inlineText(header, `table-head-${index}-${cellIndex}`)}</th>)}</tr></thead>
              <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{block.headers.map((_, cellIndex) => <td key={cellIndex} style={{ textAlign: block.alignments[cellIndex] }}>{inlineText(row[cellIndex] ?? "", `table-cell-${index}-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <TableChart table={block} />
        </div>
      );
  }
}

export default function MessageContent({ content }: { content: string }) {
  return <div className="message-markdown">{parseBlocks(content).map(renderBlock)}</div>;
}
