import type { Message } from "./types";
import type { ProductionTask, ProductionReceipt } from "./production";
import { PRODUCTION_STATUS } from "./production";
import type { TraceItem } from "./chat-progress";

// Keep the actual reply and tool history in the employee's local conversation.
export function productionReply(
  message: Message,
  task?: ProductionTask,
): Message {
  if (!task) return message;
  const items: TraceItem[] = (message.trace?.items ?? []).filter(
    (item) =>
      !item.id.startsWith("production:") &&
      item.id !== message.productionTaskId,
  );
  for (const step of task?.steps ?? []) {
    if (!step.startedAt) continue;
    const id = `production:${task.id}:${step.id}`;
    if (step.reasoning)
      items.push({
        type: "reasoning",
        id: id + ":reasoning",
        text: step.reasoning,
      });
    items.push({
      type: "tool",
      id,
      name: step.title,
      detail: step.detail,
      status:
        step.status === "failed"
          ? "error"
          : step.status === "cancelled"
            ? "stopped"
            : step.status === "running"
              ? "running"
              : "done",
    });
  }
  const plan = task?.steps?.find(
    (step) => step.id === "plan" && step.status === "done",
  )?.detail;
  const content = plan || message.content;
  const status = task?.status ?? "saved";
  return {
    ...message,
    content,
    trace: {
      items,
      status:
        status === "failed"
          ? "error"
          : status === "cancelled"
            ? "stopped"
            : "done",
      elapsed: task
        ? Math.max(
            0,
            Math.floor(
              (Date.parse(task.updatedAt) - Date.parse(task.createdAt)) / 1000,
            ),
          )
        : (message.trace?.elapsed ?? 0),
    },
  };
}

export function productionOutcome(
  task?: ProductionTask,
  receipt?: ProductionReceipt,
  saving = false,
) {
  if (saving) return "正在保存到本机并校验文件…";
  if (receipt)
    return (
      "已保存到本机：" +
      receipt.directory +
      (task?.status === "cleaning" ? "（正在清理服务器副本）" : "")
    );
  return task ? PRODUCTION_STATUS[task.status] : "正在读取回复状态…";
}
