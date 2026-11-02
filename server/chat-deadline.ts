import type { ChatProgress } from "../shared/chat-progress";

export const CHAT_IDLE_TIMEOUT_MS = 180_000;
export const CHAT_MAX_DURATION_MS = 15 * 60_000;

export class ChatTimeoutError extends Error {
  constructor(public readonly kind: "idle" | "duration") {
    super(
      kind === "idle"
        ? "模型或工具长时间未返回新内容，已结束本次请求并保留收到的内容。请稍后重试，或将图片、问题拆分后再发送。"
        : "本次任务已达到最长处理时间，已保留收到的内容。请缩小问题范围或分批处理图片后重试。",
    );
    this.name = "ChatTimeoutError";
  }
}

/** Heartbeats and empty stream events are not model or tool progress. */
export function createChatDeadline({
  parent,
  idleMs = CHAT_IDLE_TIMEOUT_MS,
  maxMs = CHAT_MAX_DURATION_MS,
}: {
  parent?: AbortSignal;
  idleMs?: number;
  maxMs?: number;
} = {}) {
  const controller = new AbortController();
  const signal = parent
    ? AbortSignal.any([parent, controller.signal])
    : controller.signal;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const maximum = setTimeout(
    () => controller.abort(new ChatTimeoutError("duration")),
    maxMs,
  );
  maximum.unref();
  const armIdle = () => {
    if (disposed || signal.aborted) return;
    clearTimeout(idle);
    idle = setTimeout(
      () => controller.abort(new ChatTimeoutError("idle")),
      idleMs,
    );
    idle.unref();
  };
  const dispose = () => {
    disposed = true;
    clearTimeout(idle);
    clearTimeout(maximum);
    signal.removeEventListener("abort", dispose);
  };
  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted) dispose();
  else armIdle();
  return {
    signal,
    observe(event: ChatProgress) {
      if (
        event.type === "tool" ||
        ((event.type === "reasoning" || event.type === "text") &&
          event.text.trim())
      )
        armIdle();
    },
    dispose,
  };
}
