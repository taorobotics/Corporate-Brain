import type { Skill } from "../shared/types";

/** Provider-specific routing hints, not a claim about upstream model identity. */
export function imageModelProfile(model: string) {
  const match = /^gpt-image-2\.6-(sunburst|flare)(-c)?$/i.exec(model);
  if (!match) return undefined;
  const quality = match[1].toLowerCase() === "sunburst";
  return {
    family: "GPT Image 2.6",
    purpose: quality ? "final" : "draft",
    billing: match[2] ? "per-image" : "usage",
    description: quality
      ? "精细成图：用于正式海报、复杂细节与最终配图。"
      : "快速草稿：用于预览、构思、草稿与优先速度的需求。",
  } as const;
}

export function imageRequestOptions(model: string) {
  // These relay variants expose the DALL-E-compatible endpoint. Native GPT
  // image providers may reject response_format, so do not add it indiscriminately.
  return imageModelProfile(model) || /^dall-e/i.test(model)
    ? { response_format: "b64_json" }
    : {};
}

export function chooseImageSkill(skills: Skill[], selectedIds: string[]) {
  const available = skills.filter((s) => s.capability?.kind === "image");
  const selected = selectedIds
    .map((id) => available.find((s) => s.id === id))
    .find(Boolean);
  if (selected) return selected;
  // A bounded default if the router identifies image creation but omits an ID.
  return (
    available.find((s) => s.capability?.model === "gpt-image-2.6-sunburst-c") ??
    available.find((s) => s.capability?.model === "gpt-image-2.6-sunburst") ??
    available[0]
  );
}
