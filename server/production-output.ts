import { Script } from "node:vm";
import { z } from "zod";
import { readChatResponse } from "./chat-stream";
import { createChatDeadline } from "./chat-deadline";

export class ProductionOutputError extends Error {
  constructor(
    message: string,
    public readonly repairable = true,
  ) {
    super(message);
  }
}
export type ProductionGenerationUpdates = {
  checkpoint: (text: string) => Promise<void>;
  continuing: (round: number) => void;
};
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
    .object({ source: z.string().min(20).max(2_000_000) })
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
    stream: true,
    // Current DeepSeek Flash/V4 endpoints support this budget. Other providers
    // choose their own budget instead of inheriting an arbitrary company cap.
    ...(/^deepseek-(?:flash|v4-(?:flash(?:-vision-exp)?|pro))$/i.test(model)
      ? { max_tokens: 256000 }
      : {}),
  };
}
export function productionCompletionText(result: any) {
  if (result.choices?.[0]?.finish_reason === "length")
    throw new ProductionOutputError("本段代码输出被截断，需要接续生成");
  const content = result.choices?.[0]?.message?.content;
  if (
    typeof content !== "string" ||
    !content.trim() ||
    content.length > 5_000_000
  )
    throw new ProductionOutputError("模型未返回有效的代码内容");
  return content;
}

/** Continue the exact JSON bytes, including a cut inside an escaped source string. */
export function appendProductionPart(previous: string, next: string) {
  if (!previous) return next;
  // Repeated code lines are meaningful bytes. Only recognize a replay of the
  // entire JSON prefix, never guess overlap from a repeated suffix.
  if (previous.length >= 32 && next.startsWith(previous)) return next;
  return previous + next;
}

export async function completeProduction({
  model,
  messages,
  request,
  signal,
  reasoning,
  updates,
}: {
  model: string;
  messages: { role: string; content: string }[];
  request: (
    body: ReturnType<typeof productionCompletionBody>,
    signal: AbortSignal,
  ) => Promise<Response>;
  signal: AbortSignal;
  reasoning?: (text: string, append?: boolean) => void;
  updates?: ProductionGenerationUpdates;
}) {
  const deadline = createChatDeadline({ parent: signal, maxMs: null });
  const conversation = messages.map((message) => ({ ...message }));
  let content = "",
    round = 0,
    unchanged = 0,
    writtenAt = 0;
  let saving = Promise.resolve();
  const checkpoint = (text: string, force = false) => {
    if (!text || (!force && Date.now() - writtenAt < 1000)) return;
    writtenAt = Date.now();
    saving = saving.then(() => updates?.checkpoint(text));
    void saving.catch(() => {});
  };
  try {
    while (true) {
      deadline.signal.throwIfAborted();
      let latest = content;
      const response = await request(
        productionCompletionBody(model, conversation),
        deadline.signal,
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new ProductionOutputError(
          `模型服务返回 ${response.status}，草稿已保留，请检查模型配置或余额`,
          false,
        );
      }
      const result = await readChatResponse(
        response,
        (event) => {
          if (event.type === "reasoning") {
            deadline.observe({
              ...event,
              id: `production:${round}:${event.id}`,
            });
            reasoning?.(event.text, round > 0 || event.append);
          } else if (event.type === "text") {
            latest = appendProductionPart(content, event.text);
            deadline.observe({ type: "text", text: latest });
            checkpoint(latest);
            if (latest.length > 5_000_000)
              throw new ProductionOutputError(
                "生成内容超过任务可处理的文件容量，已保留草稿",
                false,
              );
          }
        },
        { contentLimit: 5_000_001, allowEmpty: true },
      ).catch((error) => {
        checkpoint(latest, true);
        throw error;
      });
      const combined = appendProductionPart(content, result.content);
      checkpoint(combined, true);
      await saving;
      if (result.finishReason !== "length") {
        return productionCompletionText({
          choices: [
            {
              message: { content: combined },
              finish_reason: result.finishReason,
            },
          ],
        });
      }
      unchanged = combined.length > content.length ? 0 : unchanged + 1;
      if (unchanged >= 2)
        throw new ProductionOutputError(
          "模型连续未补充代码正文，已保留草稿，可以重试",
          false,
        );
      content = combined;
      round++;
      updates?.continuing(round);
      // Retain one assistant prefix rather than repeating every earlier fragment.
      conversation.splice(messages.length);
      if (content) conversation.push({ role: "assistant", content });
      conversation.push({
        role: "user",
        content: content
          ? "上次输出在服务商单次边界结束。继续同一个 JSON，从最后一个字符之后紧接着输出剩余内容；可能停在字符串、转义或代码中间。不要重复已有内容，不要重写、解释或添加 Markdown 围栏。补全源代码及 JSON 后结束；若已全部输出完整，只返回空白。"
          : "上次尚未输出代码正文。继续既定方案，直接输出完整的 JSON 和源代码，不要只给思考或说明。",
      });
    }
  } catch (error) {
    await saving;
    signal.throwIfAborted();
    if (error instanceof ProductionOutputError) throw error;
    throw new ProductionOutputError(
      deadline.signal.aborted
        ? "模型长时间没有返回新内容，生成草稿已保留，可以重试"
        : "模型连接中断，生成草稿已保留，可以重试",
      false,
    );
  } finally {
    deadline.dispose();
  }
}
