import {
  MAX_ATTACHMENT_IMAGES,
  MAX_ATTACHMENT_TEXT,
  visualInputs,
  type Attachment,
} from "./attachments";

export type WorkspaceSnapshot = {
  root: string;
  files: { name: string; size: number; content: string; image?: string }[];
  skipped: number;
  truncated: boolean;
};

const FILE_TEXT_LIMIT = 16_000;
// Reserve space for the summary and warnings added by modelAttachments.
const BODY_LIMIT = MAX_ATTACHMENT_TEXT - 4_000;
const shorten = (text: string, limit: number) =>
  text.length <= limit ? text : text.slice(0, limit - 1) + "…";

function priority(name: string) {
  if (/(?:^|\/)(?:[^/]*lock[^/]*|[^/]*\.min\.[^/]+)$/i.test(name)) return 90;
  if (/(?:^|\/)(?:generated|vendor)(?:[./]|$)/i.test(name)) return 80;
  if (/(?:^|\/)readme(?:\.[^/]*)?$/i.test(name)) return 0;
  if (
    /^(?:package\.json|[^/]*config[^/]*|pyproject\.toml|cargo\.toml|go\.mod)$/i.test(
      name,
    )
  )
    return 10;
  if (/(?:^|\/)(?:main|index|app)\.[^/]+$/i.test(name)) return 20;
  return 30;
}

export function workspaceAttachments(
  snapshot: WorkspaceSnapshot,
  existing: Attachment[] = [],
): Attachment[] {
  const slots = Math.max(0, 8 - existing.length);
  if (!slots) return [];
  const warnings: string[] = [];
  if (snapshot.truncated || snapshot.skipped)
    warnings.push(
      `目录扫描有范围限制；已跳过 ${snapshot.skipped} 个不支持或受保护的文件/目录，扫描上限以外的内容未读取。请指定子目录或具体文件继续。`,
    );
  const visuals = existing.flatMap(visualInputs);
  let imageCount = visuals.length;
  let imageChars = visuals.reduce((sum, item) => sum + item.image.length, 0);
  const pictures: Attachment[] = [];
  const imageFiles = snapshot.files.filter((file) => file.image);
  for (const file of imageFiles) {
    if (
      pictures.length >= Math.min(2, slots - 1) ||
      imageCount >= MAX_ATTACHMENT_IMAGES ||
      imageChars + file.image!.length > 10_000_000
    )
      continue;
    pictures.push({
      name: shorten(`workspace/${file.name}`, 200),
      content: "",
      image: file.image,
    });
    imageCount++;
    imageChars += file.image!.length;
  }
  if (pictures.length < imageFiles.length)
    warnings.push(
      `目录中的 ${imageFiles.length - pictures.length} 张图片未发送；自动附图最多 2 张，并优先保留手动上传的附件和画面额度。`,
    );

  const parts = [
    "# 本地工作区读取摘要",
    `工作区：${shorten(snapshot.root, 200)}`,
    "这是桌面客户端只读扫描后附加的资料，模型不能直接访问员工电脑路径。只能依据以下实际内容分析，不能声称已读完未提供的文件。",
    `本次扫描返回 ${snapshot.files.length} 个可识别文件；文件清单不代表正文已全部读取。`,
    "\n## 文件清单",
  ];
  let length = parts.join("\n").length;
  let listed = 0;
  for (const file of snapshot.files) {
    const line = `- ${shorten(file.name, 500)}（${file.size} bytes${file.image ? "；图片" : ""}）`;
    // The native scanner returns at most 48 files. Bound imported snapshots too.
    if (length + line.length + 1 > BODY_LIMIT / 2) break;
    parts.push(line);
    length += line.length + 1;
    listed++;
  }
  if (listed < snapshot.files.length)
    warnings.push(`文件清单仅显示前 ${listed} 项，其余名称超出本次展示范围。`);
  if (snapshot.files.some((file) => file.name.length > 500))
    warnings.push("过长的文件名已缩短展示，请在原目录核对完整名称。");
  parts.push("\n## 文件内容（说明文档、配置及入口文件优先）");
  length = parts.join("\n").length;
  let excerpted = 0,
    omitted = 0;
  const textFiles = snapshot.files
    .filter((file) => !file.image)
    .sort((a, b) => priority(a.name) - priority(b.name));
  for (const file of textFiles) {
    const header = `\n### ${shorten(file.name, 500)}\n`;
    const remaining = BODY_LIMIT - length - header.length - 160;
    if (remaining <= 0) {
      omitted++;
      continue;
    }
    const count = Math.min(file.content.length, FILE_TEXT_LIMIT, remaining);
    const partial = count < file.content.length;
    if (partial) excerpted++;
    const section =
      header +
      (partial
        ? `正文节选：仅提供前 ${count} / ${file.content.length} 字符，剩余正文未读取。\n`
        : "正文完整提供（限本次扫描返回的文件）。\n") +
      "```text\n" +
      file.content.slice(0, count) +
      "\n```";
    parts.push(section);
    length += section.length + 1;
  }
  if (excerpted || omitted)
    warnings.push(
      `本次目录正文受长度预算限制：${excerpted} 个文件使用节选，${omitted} 个文件仅列名称、正文未读取。需要细节时请指定子目录或具体文件继续。`,
    );
  const summary = `扫描返回 ${snapshot.files.length} 个文件；提供 ${textFiles.length - omitted} 个文本文件${excerpted ? "（含节选）" : ""}和 ${pictures.length} 张图片。`;
  return [
    {
      name: shorten(`workspace-${snapshot.root}`, 197) + ".md",
      content: parts.join("\n"),
      summary,
      warnings,
    },
    ...pictures,
  ];
}
