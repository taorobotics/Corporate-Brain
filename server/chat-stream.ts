import type { ChatProgress, ChatUsage } from "../shared/chat-progress";

export function chatUsage(value: any): ChatUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const inputTokens =
    value.inputTokens ?? value.prompt_tokens ?? value.input_tokens;
  const outputTokens =
    value.outputTokens ?? value.completion_tokens ?? value.output_tokens;
  const totalTokens = value.totalTokens ?? value.total_tokens;
  return {
    ...(Number.isFinite(inputTokens) ? { inputTokens } : {}),
    ...(Number.isFinite(outputTokens) ? { outputTokens } : {}),
    ...(Number.isFinite(totalTokens) ? { totalTokens } : {}),
  };
}

/** Consume the provider's exposed reasoning field, never manufacture a rationale. */
export async function readChatResponse(
  response: Response,
  emit: (event: ChatProgress) => void,
) {
  let content = "",
    usage: ChatUsage | undefined;
  const consume = (value: any, full = false) => {
    if (value.error) throw new Error("模型响应中断，请稍后重试");
    const delta = full
      ? value.choices?.[0]?.message
      : value.choices?.[0]?.delta;
    const reasoning = delta?.reasoning_content ?? delta?.reasoning;
    if (typeof reasoning === "string" && reasoning)
      emit({
        type: "reasoning",
        id: "direct-reasoning",
        text: reasoning,
        append: !full,
      });
    if (typeof delta?.content === "string") {
      content = (full ? delta.content : content + delta.content).slice(
        0,
        160_000,
      );
      emit({ type: "text", text: content });
    }
    if (value.usage) usage = chatUsage(value.usage);
  };
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    consume(await response.json(), true);
  } else {
    if (!response.body) throw new Error("模型没有返回响应流");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      data: string[] = [],
      ended = false;
    const dispatch = () => {
      const value = data.join("\n").trim();
      data = [];
      if (!value || ended) return;
      if (value === "[DONE]") {
        ended = true;
        return;
      }
      consume(JSON.parse(value));
    };
    const line = (value: string) => {
      if (!value) dispatch();
      else if (value.startsWith("data:")) data.push(value.slice(5).trimStart());
    };
    try {
      while (!ended) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        if (buffer.length > 1_000_000) throw new Error("模型返回的数据过大");
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          line(buffer.slice(0, index).replace(/\r$/, ""));
          buffer = buffer.slice(index + 1);
        }
        if (done) {
          if (buffer) line(buffer.replace(/\r$/, ""));
          dispatch();
          break;
        }
      }
      if (!ended) throw new Error("模型连接中断，已保留收到的内容");
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  if (!content.trim()) throw new Error("模型未返回可显示的文本");
  return { content, usage };
}
