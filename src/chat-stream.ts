import type { ChatProgress, ChatUsage } from "../shared/chat-progress";

export async function streamChat(
  body: unknown,
  signal: AbortSignal,
  receive: (event: ChatProgress) => void,
): Promise<{ content: string; image?: string; usage?: ChatUsage }> {
  const encoded = JSON.stringify(body);
  if (new TextEncoder().encode(encoded).length > 15 * 1024 * 1024)
    throw new Error("对话与附件内容过大，请减少附件或在新对话中分批分析。");
  const response = await fetch("/api/generate/chat", {
    method: "POST",
    credentials: "include",
    signal,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: encoded,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? `请求失败 ${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const data = await response.json();
    if (typeof data.content !== "string")
      throw new Error("公司服务没有返回有效回答");
    return data;
  }
  if (!response.body) throw new Error("公司服务没有返回响应流");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    result: { content: string; image?: string; usage?: ChatUsage } | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ChatProgress;
    if (event.type === "error") throw new Error(event.message);
    receive(event);
    if (event.type === "done")
      result = {
        content: event.content,
        image: event.image,
        usage: event.usage,
      };
  };
  try {
    while (!result) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 32_000_000)
        throw new Error("响应内容过大，请缩小问题范围");
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
      if (done) {
        if (buffer.trim()) consume(buffer);
        break;
      }
    }
    if (!result) throw new Error("连接中断，已保留收到的内容");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
