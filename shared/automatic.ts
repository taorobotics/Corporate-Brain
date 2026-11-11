import type { DshMode } from "./types";

export type AutomaticPlan = {
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
