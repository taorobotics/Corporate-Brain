import type { AutomaticPlan } from "../shared/automatic";
import type { ProductionTask } from "../shared/production";
import { api } from "./api";

export async function submitAutomaticProduction(
  userId: string,
  plan: AutomaticPlan,
  prompt: string,
  files: File[],
  signal: AbortSignal,
  created: (task: ProductionTask) => void,
) {
  const bridge = window.brainDesktop?.production;
  if (!bridge) throw Error("请使用桌面客户端接收代码或视频成果。");
  let local = await bridge.state(userId);
  if (!local.directory) local = await bridge.chooseDirectory(userId);
  if (!local.directory)
    throw Error("尚未选择成果保存位置；选择本机文件夹后即可继续制作。");
  signal.throwIfAborted();
  if (prompt.length > 18000)
    throw Error("制作需求与上下文过长，请缩短说明后重新发送。");
  const task = await api<ProductionTask>(
    "/production",
    {
      kind: plan.kind,
      deviceId: local.deviceId,
      connectionId: plan.connectionId,
      prompt,
      seconds: plan.seconds,
      inputs: files.map((file) => ({
        name: file.name.normalize("NFC"),
        size: file.size,
      })),
    },
    "POST",
    30000,
    signal,
  );
  created(task);
  for (let i = 0; i < files.length; i++) {
    const response = await fetch(`/api/production/${task.id}/materials/${i}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: files[i],
      signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]),
    });
    if (!response.ok)
      throw Error((await response.json()).error ?? "素材上传失败，任务已保留");
  }
  return api<ProductionTask>(
    `/production/${task.id}/start`,
    {},
    "POST",
    30000,
    signal,
  );
}
