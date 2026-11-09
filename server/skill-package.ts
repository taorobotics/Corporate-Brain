import { z } from "zod";
import { parseDocument, stringify } from "yaml";
import type { SkillPackage } from "../shared/types";

export const skillDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(1000),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    instructions: z.string().trim().min(10).max(60000),
    examples: z.string().max(12000).default(""),
    testSummary: z.string().max(4000).default(""),
    requiredTools: z.array(z.string().max(60)).max(12).default([]),
  })
  .strict();

export function hasPrivateSkillContent(data: SkillPackage) {
  return /(?:[A-Z]:[\\/](?:Users|Open_Source_Project)|\/(?:Users|home)\/[^\s/]+|sk-[A-Za-z0-9_-]{16,}|(?:api[_-]?key|password|token)\s*[:=]\s*["']?[^\s"']{8,})/i.test(
    [data.instructions, data.examples, data.testSummary].join("\n"),
  );
}

// Retain tool declarations and other frontmatter supplied by the original skill.
export function skillMarkdown(data: SkillPackage, original = "") {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(original);
  const meta = match ? parseDocument(match[1]).toJS({ maxAliasCount: 0 }) : {};
  return `---\n${stringify({
    ...meta,
    name: data.name,
    description: data.description,
    version: data.version,
    metadata: {
      ...(meta?.metadata && typeof meta.metadata === "object"
        ? meta.metadata
        : {}),
      version: data.version,
    },
  }).trimEnd()}\n---\n\n${data.instructions}\n${data.examples ? `\n## 示例\n\n${data.examples}\n` : ""}`;
}
