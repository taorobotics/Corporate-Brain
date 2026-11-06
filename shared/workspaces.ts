import type {
  DshMode,
  LocalState,
  LocalWorkspace,
  WorkspaceAccess,
} from "./types";
import { normalizeSkin } from "./skins";
import { normalizeTrace } from "./chat-progress";

export const DSH_MODE_OPTIONS: ReadonlyArray<{
  value: DshMode;
  label: string;
  description: string;
}> = [
  {
    value: "standard",
    label: "标准模式",
    description: "处理代码、文件和资料，适合大多数任务。",
  },
  {
    value: "ptc",
    label: "PTC 模式",
    description: "适合批量调用工具，并整理、筛选和汇总结果。",
  },
  {
    value: "minimal",
    label: "极简模式",
    description: "保留基础对话、图片和网页能力，适合测试对比。",
  },
  {
    value: "creative",
    label: "创造模式",
    description: "用于编写技能、插件和扩展方案。",
  },
];

export const WORKSPACE_ACCESS_OPTIONS: ReadonlyArray<{
  value: WorkspaceAccess;
  label: string;
  description: string;
}> = [
  {
    value: "view",
    label: "仅可查看",
    description: "可以读取当前项目，不能写入或修改文件。",
  },
  {
    value: "edit",
    label: "项目内修改",
    description: "可以在当前项目内创建和修改文件。",
  },
  {
    value: "full",
    label: "完全权限",
    description: "按服务器策略开放完整工具权限，仍受系统账号限制。",
  },
];

export function defaultWorkspace(): LocalWorkspace {
  return {
    id: "default-workspace",
    name: "默认工作区",
    description: "本机项目与文件夹设置",
    folder: null,
    access: "edit",
  };
}

export function normalizeMode(value: unknown): DshMode {
  if (value === "ptc" || value === "minimal" || value === "creative")
    return value;
  if (value === "规划" || value === "执行") return "standard";
  return "standard";
}

export function normalizeAccess(value: unknown): WorkspaceAccess {
  if (value === "view" || value === "full") return value;
  return "edit";
}

export function normalizeLocalState(
  value: Partial<LocalState> | null | undefined,
): LocalState {
  const workspaceInput = Array.isArray(value?.workspaces)
    ? value.workspaces
    : [];
  const workspaces = workspaceInput
    .filter((workspace): workspace is LocalWorkspace => {
      if (!workspace || typeof workspace !== "object") return false;
      const item = workspace as Partial<LocalWorkspace>;
      return typeof item.id === "string" && typeof item.name === "string";
    })
    .map((workspace) => ({
      id: workspace.id,
      name:
        workspace.id === "default-workspace" && workspace.name === "默认项目"
          ? "默认工作区"
          : workspace.name.trim().slice(0, 100) || "未命名项目",
      description: (workspace.description ?? "").slice(0, 500),
      folder: typeof workspace.folder === "string" ? workspace.folder : null,
      access: normalizeAccess(workspace.access),
    }));
  const normalizedWorkspaces = workspaces.length
    ? workspaces
    : [defaultWorkspace()];
  const activeWorkspaceId = normalizedWorkspaces.some(
    (workspace) => workspace.id === value?.activeWorkspaceId,
  )
    ? value?.activeWorkspaceId!
    : normalizedWorkspaces[0].id;
  const settings = (value?.settings ?? {}) as Partial<LocalState["settings"]>;
  return {
    conversations: Array.isArray(value?.conversations)
      ? value.conversations.map((conversation) => ({
          ...conversation,
          workspaceId: normalizedWorkspaces.some(
            (w) => w.id === conversation.workspaceId,
          )
            ? conversation.workspaceId
            : (
                normalizedWorkspaces.find(
                  (w) => w.id === "default-workspace",
                ) ?? normalizedWorkspaces[0]
              ).id,
          messages: conversation.messages.map((message) => ({
            ...message,
            trace: normalizeTrace(message.trace),
          })),
        }))
      : [],
    drafts: Array.isArray(value?.drafts) ? value.drafts : [],
    installed: Array.isArray(value?.installed) ? value.installed : [],
    projects: Array.isArray(value?.projects) ? value.projects : [],
    workspaces: normalizedWorkspaces,
    activeWorkspaceId,
    settings: {
      theme:
        settings.theme === "dark"
          ? "dark"
          : settings.theme === "light"
            ? "light"
            : "default",
      skin: normalizeSkin(settings.skin),
      model: typeof settings.model === "string" ? settings.model : "",
      mode: normalizeMode(settings.mode),
      skillMode: settings.skillMode === "manual" ? "manual" : "auto",
      skillIds: Array.isArray(settings.skillIds)
        ? [
            ...new Set(
              settings.skillIds.filter(
                (id): id is string => typeof id === "string",
              ),
            ),
          ].slice(0, 16)
        : [],
    },
  };
}

export function estimateTokens(value: string): number {
  const text = value.trim();
  return text ? Math.max(1, Math.ceil(text.length / 4)) : 0;
}
