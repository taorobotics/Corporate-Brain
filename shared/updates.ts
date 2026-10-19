export type UpdateAsset = {
  name: string;
  bytes: number;
  sha256: string;
};
export type DesktopRelease = {
  version: string;
  notes: string;
  publishedAt: string;
  assets: Record<string, UpdateAsset>;
};
export type UpdateFeed = {
  configured: boolean;
  release: DesktopRelease | null;
};
export type UpdateState = {
  status:
    | "idle"
    | "checking"
    | "current"
    | "unavailable"
    | "available"
    | "downloading"
    | "ready"
    | "error";
  currentVersion: string;
  target: string;
  release: (Omit<DesktopRelease, "assets"> & { asset: UpdateAsset }) | null;
  received: number;
  error: string;
  checkedAt: string | null;
};
export type UpdateBridge = {
  state(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  cancel(): Promise<void>;
  install(): Promise<boolean>;
  onState(callback: (state: UpdateState) => void): () => void;
};
