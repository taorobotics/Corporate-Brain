export type ProductionKind = "code" | "video" | "files";
export type ProductionStatus =
  | "uploading"
  | "queued"
  | "planning"
  | "generating"
  | "rendering"
  | "verifying"
  | "ready"
  | "cleaning"
  | "saved"
  | "failed"
  | "cancelled";
export type ProductionFile = { path: string; size: number; sha256: string };
export type ProductionStep = {
  id: "plan" | "generate" | "render" | "verify" | "save";
  title: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  detail?: string;
  startedAt?: string;
  completedAt?: string;
  reasoning?: string;
};
export function productionSteps(kind: ProductionKind): ProductionStep[] {
  return [
    { id: "plan", title: "制定执行计划", status: "pending" },
    {
      id: "generate",
      title: kind === "video" ? "生成分镜与动画代码" : "生成项目源文件",
      status: "pending",
    },
    {
      id: "render",
      title: kind === "video" ? "Mac mini 渲染视频" : "检查源文件",
      status: "pending",
    },
    { id: "verify", title: "校验成果并整理素材", status: "pending" },
    { id: "save", title: "保存到本机并清理服务器", status: "pending" },
  ];
}
export type ProductionTask = {
  id: string;
  kind: ProductionKind;
  deviceId: string;
  status: ProductionStatus;
  progress: number;
  error: string;
  createdAt: string;
  updatedAt: string;
  bytes: number;
  steps?: ProductionStep[];
};
export type ProductionManifest = {
  task: ProductionTask;
  files: ProductionFile[];
  token: string;
};
export type ProductionReceipt = {
  id: string;
  directory: string;
  savedAt: string;
  files: ProductionFile[];
};
export type ProductionLocal = {
  deviceId: string;
  directory: string;
  receipts: ProductionReceipt[];
};
export type ProductionBridge = {
  state(userId: string): Promise<ProductionLocal>;
  chooseDirectory(userId: string): Promise<ProductionLocal>;
  collect(userId: string, taskId: string): Promise<ProductionReceipt>;
  open(userId: string, taskId?: string): Promise<void>;
  reveal?(userId: string, taskId: string, path: string): Promise<void>;
  preview?(
    userId: string,
    taskId: string,
    path: string,
  ): Promise<{
    mime: string;
    bytes?: Uint8Array;
    content?: string;
  }>;
};
export const PRODUCTION_STATUS: Record<ProductionStatus, string> = {
  uploading: "等待素材上传",
  queued: "等待制作",
  planning: "正在制定执行计划",
  generating: "正在编写代码",
  rendering: "Mac mini 正在渲染",
  verifying: "正在校验成果",
  ready: "等待保存到本机",
  cleaning: "本机已保存，正在清理服务器",
  saved: "已保存，服务器已清理",
  failed: "制作未完成",
  cancelled: "已取消并清理",
};
