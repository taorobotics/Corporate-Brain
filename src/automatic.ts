import type { AutomaticPlan } from "../shared/automatic";
import type { ProductionTask } from "../shared/production";
import { api } from "./api";

export async function cancelProduction(id: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api<ProductionTask>(
        `/production/${id}/cancel`,
        { activeOnly: true },
        "POST",
        30000,
      );
    } catch (error) {
      // An aborted upload can take a moment to release its server-side lock.
      if (
        attempt >= 9 ||
        (error as Error).message !== "当前正在传输，请完成后重试"
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

export async function submitAutomaticProduction(
  userId: string,
  plan: AutomaticPlan,
  prompt: string,
  files: File[],
  signal: AbortSignal,
  created: (task: ProductionTask) => void,
  workspaceFolder?: string | null,
) {
  const bridge = window.brainDesktop?.production;
  if (!bridge) throw Error("请使用桌面客户端接收代码或视频成果。");
  let local = await bridge.state(userId);
  if (workspaceFolder && !bridge.workspaceFolders)
    throw Error("请先更新客户端，才能把成果保存到当前工作区。");
  if (!workspaceFolder && !local.directory)
    local = await bridge.chooseDirectory(userId);
  if (!workspaceFolder && !local.directory)
    throw Error("尚未选择成果保存位置；选择本机文件夹后即可继续制作。");
  signal.throwIfAborted();
  if (prompt.length > 18000)
    throw Error("制作需求与上下文过长，请缩短说明后重新发送。");
  // Receive the created ID even if stop is clicked during creation, then cancel it.
  const task = await api<ProductionTask>(
    "/production",
    {
      kind: plan.kind,
      deviceId: local.deviceId,
      connectionId: plan.connectionId,
      prompt,
      seconds: plan.seconds,
      skillIds: plan.skillIds ?? [],
      inputs: files.map((file) => ({
        name: file.name.normalize("NFC"),
        size: file.size,
      })),
    },
    "POST",
    30000,
  );
  created(task);
  try {
    signal.throwIfAborted();
    for (let i = 0; i < files.length; i++) {
      const response = await fetch(
        `/api/production/${task.id}/materials/${i}`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/octet-stream" },
          body: files[i],
          signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]),
        },
      );
      if (!response.ok)
        throw Error(
          (await response.json()).error ?? "素材上传失败，任务已保留",
        );
    }
    return await api<ProductionTask>(
      `/production/${task.id}/start`,
      {},
      "POST",
      30000,
      signal,
    );
  } catch (error) {
    if (signal.aborted) created(await cancelProduction(task.id));
    throw error;
  }
}
