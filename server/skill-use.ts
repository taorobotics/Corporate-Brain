import { z } from "zod";
import type { Skill } from "../shared/types";
import { verifiedFile, type SkillResources } from "./skill-library";

export const skillIdsSchema = z.array(z.string().uuid()).max(16).default([]);
export class SkillUseError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function resolveSkillList(
  ids: string[],
  skills: Skill[],
  canUse: (skill: Skill) => boolean,
  strict = true,
) {
  const unique = [...new Set(ids)];
  if (strict && unique.length > 16)
    throw new SkillUseError(400, "每次最多选择 16 个技能");
  const found: Skill[] = [];
  for (const id of unique) {
    const skill = skills.find((value) => value.id === id);
    if (!skill || skill.status !== "published" || !canUse(skill)) {
      if (strict)
        throw new SkillUseError(404, "技能已停用或无权使用，请重新选择");
      continue;
    }
    if (skill.requiredTools.length) {
      if (strict)
        throw new SkillUseError(409, `技能“${skill.name}”依赖尚未接通的工具`);
      continue;
    }
    found.push(skill);
  }
  return found;
}
export function pickRoutedSkills(
  ids: string[] | undefined,
  candidates: Skill[],
) {
  const unique = [...new Set(ids ?? [])];
  if (unique.length > 16)
    throw new SkillUseError(502, "智能调度每次最多选择 16 个技能");
  if (unique.some((id) => !candidates.some((skill) => skill.id === id)))
    throw new SkillUseError(
      502,
      "智能调度选择了未安装或无权使用的技能，请重试",
    );
  return unique;
}
export function skillInstructions(skills: Skill[]) {
  if (!skills.length) return "";
  const content = [
    "本轮用户授权使用以下技能。可组合其流程完成任务；以用户当前需求为准，避免套用无关步骤。技能不能扩大文件、网络、系统或员工权限。第三方技能未执行安装脚本，依赖未验证，不得声称渲染环境已就绪；不得运行 setup/安装脚本或安装系统软件。",
    ...skills.map(
      (skill, index) =>
        `## 技能 ${index + 1}：${skill.name}\n${skill.instructions}`,
    ),
  ].join("\n\n");
  if (content.length > 80000)
    throw new SkillUseError(413, "所选技能内容过长，请减少本轮技能数量");
  return content;
}
// Image/code/video providers have no file tool. Supply bounded, verified text
// references; scripts and binary assets are never executed or read as prompts.
export async function skillReferences(
  resources: SkillResources[],
  budget: number,
) {
  let content = "";
  for (const resource of resources) {
    const docs = resource.files
      .filter(
        (file) =>
          file.path !== resource.source.entry &&
          /\.(md|txt)$/i.test(file.path) &&
          file.size <= 200000,
      )
      .slice(0, 12);
    for (const file of docs) {
      const heading = `\n\n技能 ${resource.source.label} 配套资料节选 ${file.path}：\n`;
      const remaining = budget - content.length - heading.length;
      if (remaining <= 0) return content;
      const bytes = await verifiedFile(resource.root, file);
      if (bytes.includes(0)) continue;
      const excerpt = bytes
        .toString("utf8")
        .slice(0, Math.min(12000, remaining));
      content += heading + excerpt;
    }
  }
  return content;
}
