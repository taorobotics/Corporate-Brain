import type { Skill, User } from "../shared/types";
import type { Store } from "./database";
import { connectionSelect, resolveConnection } from "./model-services";

/** A configured image API is a live company capability, never a downloaded secret. */
export function imageSkills(store: Store, actor: User): Skill[] {
  return (
    store.db
      .prepare(
        connectionSelect +
          " WHERE c.enabled=1 AND c.kind='image' ORDER BY c.rowid",
      )
      .all() as Record<string, any>[]
  )
    .map(resolveConnection)
    .filter(
      (row) =>
        row.secret &&
        (actor.role === "company_admin" ||
          !JSON.parse(row.departments).length ||
          JSON.parse(row.departments).includes(actor.departmentId)),
    )
    .map((row) => ({
      id: row.id,
      name: "图片生成 · " + row.name,
      description: `使用 ${row.model} 按需生成图片，可与对话及其他技能组合。普通聊天和图片分析不会触发出图。`,
      version: "1.0.0",
      instructions:
        "此技能提供公司图片生成能力。只有用户明确要求生成或配图时才使用；普通问答、识图和讨论能力时不生成。对话模型完成文字部分，图片生成由本轮图片技能调用完成；不得声称尚未成功的生成已完成，不要输出占位图片或编造下载链接。",
      examples: "写一段产品介绍，并生成配图。",
      testSummary: "由管理员配置的图片接口提供，实际可用性以服务调用结果为准。",
      requiredTools: [],
      authorId: "company-model-service",
      authorName: "公司模型服务",
      ownerDepartmentId: "",
      ownerDepartmentName: "公司技能",
      audience: JSON.parse(row.departments).length ? "departments" : "company",
      targetDepartments: JSON.parse(row.departments),
      status: "published",
      reviewNote: "",
      createdAt: "",
      capability: { kind: "image", connectionId: row.id, model: row.model },
    }));
}

export function generatedImage(result: any): string {
  const value = result?.data?.[0]?.b64_json;
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 28_000_000 ||
    !/^[a-zA-Z0-9+/=\r\n]+$/.test(value)
  )
    throw Error(
      "图片服务未返回有效的 base64 图片，请确认该接口支持 b64_json 输出",
    );
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > 20_000_000)
    throw Error("生成图片超过 20 MB，请降低尺寸后重试");
  const mime = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "image/jpeg"
      : bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP"
        ? "image/webp"
        : "";
  if (!mime)
    throw Error("图片服务返回了不支持的图片格式，请使用 PNG、JPEG 或 WebP");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
