export type ProductionKind = "code" | "video";
export type ProductionStatus =
  | "uploading"
  | "queued"
  | "generating"
  | "rendering"
  | "ready"
  | "cleaning"
  | "saved"
  | "failed"
  | "cancelled";
export type ProductionFile = { path: string; size: number; sha256: string };
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
};
export const PRODUCTION_STATUS: Record<ProductionStatus, string> = {
  uploading: "等待素材上传",
  queued: "等待制作",
  generating: "正在编写代码",
  rendering: "Mac mini 正在渲染",
  ready: "等待保存到本机",
  cleaning: "本机已保存，正在清理服务器",
  saved: "已保存，服务器已清理",
  failed: "制作未完成",
  cancelled: "已取消并清理",
};
