export type Role =
  | "company_admin"
  | "department_admin"
  | "department_reviewer"
  | "company_reviewer"
  | "employee";
export const roleNames: Record<Role, string> = {
  company_admin: "公司管理员",
  department_admin: "部门管理员",
  department_reviewer: "部门审核员",
  company_reviewer: "公司发布审核员",
  employee: "员工",
};
export type Department = { id: string; name: string; enabled: number };
export type User = {
  id: string;
  username: string;
  name: string;
  departmentId: string;
  avatar?: string;
  departmentName: string;
  role: Role;
  enabled: number;
  mustChange: number;
  distributed: number;
  accountNote?: string;
};
export type Audience = "department" | "departments" | "company";
export type DshMode = "standard" | "ptc" | "minimal" | "creative";
export type WorkspaceAccess = "view" | "edit" | "full";
export type LocalWorkspace = {
  id: string;
  name: string;
  description: string;
  folder: string | null;
  access: WorkspaceAccess;
};
export type SkillPackage = {
  name: string;
  description: string;
  version: string;
  instructions: string;
  examples: string;
  testSummary: string;
  requiredTools: string[];
};
export type Skill = SkillPackage & {
  ownerUserId?: string;
  capability?: { kind: "image"; connectionId: string; model: string };
  imported?: import("./skill-import").ImportedSkillSource;
  id: string;
  authorId: string;
  authorName: string;
  ownerDepartmentId: string;
  ownerDepartmentName: string;
  audience: Audience;
  targetDepartments: string[];
  status: "pending" | "published" | "rejected" | "disabled";
  reviewNote: string;
  createdAt: string;
};
export type Connection = {
  personal?: boolean;
  sourceServiceId?: string;
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  kind: "chat" | "image";
  departments: string[];
  hasKey: boolean;
  enabled: number;
  serviceId?: string;
  serviceName?: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
  productionTaskId?: string;
  promptText?: string;
  connectionId?: string;
  modelName?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  feedback?: import("./feedback").FeedbackReceipt;
  attachments?: import("./attachments").Attachment[];
  trace?: import("./chat-progress").ChatTrace;
  at: string;
};
export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
};
export type Draft = SkillPackage & {
  id: string;
  sourceIds: string[];
  audience: Audience;
  targetDepartments: string[];
};
export type LocalState = {
  conversations: Conversation[];
  drafts: Draft[];
  installed: Skill[];
  projects: { id: string; name: string; description: string }[];
  workspaces: LocalWorkspace[];
  activeWorkspaceId: string;
  settings: {
    theme: string;
    skin?: string;
    model: string;
    mode: DshMode;
    skillMode?: "auto" | "manual";
    skillIds?: string[];
  };
};
