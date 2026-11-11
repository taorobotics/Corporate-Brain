import type { DshMode } from "./types";

export type AutomaticPlan = {
  pluginIds?: string[];
  kind: "chat" | "image" | "video" | "code";
  mode: DshMode;
  seconds: number;
  connectionId: string;
  skillIds?: string[];
  imageSkillId?: string;
  execution?: "answer" | "agent";
  workspaceContext?: boolean;
  usePreviousAttachments?: boolean;
  routingFallback?: boolean;
  companyLookup?: import("./company-context").CompanyLookup;
};
