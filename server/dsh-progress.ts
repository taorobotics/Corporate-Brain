import { safeSources, type ChatProgress } from "../shared/chat-progress";

/** Never forward tool arguments, runtime logs, hidden prompts or raw tool results. */
export function dshProgress(
  sessionId: string,
  emit: (event: ChatProgress) => void,
) {
  let stepKey = "",
    texts = new Map<number, string>();
  let started = new Set<string>();
  const tools = new Map<string, string>();
  return ({
    method,
    params,
  }: {
    method: string;
    params: Record<string, any>;
  }) => {
    if (params.sessionId !== sessionId) return;
    const event = params.event;
    if (method === "corporate.assistant" && event) {
      if (event.type === "start") {
        stepKey = `${event.turn}:${event.step}`;
        texts = new Map();
        started = new Set();
        emit({ type: "text", text: "" });
      } else if (Number.isInteger(event.index)) {
        const reasoning =
          event.type === "reasoning-delta" || event.block?.type === "reasoning";
        const text =
          event.type === "block-end" ? event.block?.text : event.text;
        if (typeof text !== "string") return;
        const id = `reasoning:${stepKey}:${event.index}`;
        if (reasoning) {
          emit({
            type: "reasoning",
            id,
            text,
            append: event.type !== "block-end" && started.has(id),
          });
          started.add(id);
        } else {
          texts.set(
            event.index,
            event.type === "block-end"
              ? text
              : (texts.get(event.index) ?? "") + text,
          );
          emit({
            type: "text",
            text: [...texts.values()].join("\n").slice(0, 160_000),
          });
        }
      }
    }
    if (method !== "session.event" || !event?.data) return;
    const data = event.data;
    if (event.type === "assistant/message") {
      data.message?.content?.forEach((block: any, index: number) => {
        if (block.type === "reasoning" && typeof block.text === "string")
          emit({
            type: "reasoning",
            id: `reasoning:${data.turn}:${data.step}:${index}`,
            text: block.text,
          });
      });
    } else if (event.type === "tool/call") {
      const name = String(data.name ?? "工具").slice(0, 100);
      tools.set(data.callId, name);
      emit({ type: "tool", id: data.callId, name, status: "running" });
    } else if (event.type === "tool/result") {
      const id = data.message?.source?.callId;
      if (!tools.has(id)) return;
      emit({
        type: "tool",
        id,
        name: tools.get(id)!,
        status: data.error || data.message?.isError ? "error" : "done",
        sources: safeSources(data.meta?.sources),
      });
    }
  };
}
