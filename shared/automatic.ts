import type { DshMode } from "./types";

export type AutomaticPlan = {
  kind: "chat" | "image" | "video" | "code";
  mode: DshMode;
  seconds: number;
  connectionId: string;
};
