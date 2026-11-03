import { Script } from "node:vm";
import { z } from "zod";

export class ProductionOutputError extends Error {}
export function parseProductionOutput(answer: string) {
  try {
    return JSON.parse(
      answer
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new ProductionOutputError("模型返回的代码数据不完整或格式错误");
  }
}
export function validateAnimation(value: unknown) {
  const parsed = z
    .object({ source: z.string().min(20).max(500_000) })
    .safeParse(value);
  if (!parsed.success)
    throw new ProductionOutputError("模型未返回完整的动画源代码");
  try {
    // Compile only. Generated code never executes in Node or the service process.
    new Script(`(function(){${parsed.data.source}\n;return render;})`);
  } catch {
    throw new ProductionOutputError("动画代码存在语法错误");
  }
  return parsed.data.source;
}
export function productionCompletionBody(
  model: string,
  messages: { role: string; content: string }[],
) {
  return {
    model,
    messages,
    stream: false,
    max_tokens: 12000,
    ...(model.toLowerCase().startsWith("deepseek")
      ? { thinking: { type: "disabled" } }
      : {}),
  };
}
export function productionCompletionText(result: any) {
  if (result.choices?.[0]?.finish_reason === "length")
    throw new ProductionOutputError(
      "模型输出达到长度上限，代码被截断；请缩小任务范围后重试",
    );
  const content = result.choices?.[0]?.message?.content;
  if (
    typeof content !== "string" ||
    !content.trim() ||
    content.length > 5_000_000
  )
    throw new ProductionOutputError("模型未返回有效的代码内容");
  return content;
}
