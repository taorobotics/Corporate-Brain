import type { LocalState } from "../shared/types";
import { defaultWorkspace, normalizeLocalState } from "../shared/workspaces";
export const emptyState = (): LocalState => ({
  conversations: [],
  drafts: [],
  installed: [],
  projects: [],
  workspaces: [defaultWorkspace()],
  activeWorkspaceId: defaultWorkspace().id,
  settings: { theme: "light", model: "", mode: "standard" },
});
export const localKey = (userId: string) => `${location.origin}:${userId}`;
let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("corporate-brain-device", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("profiles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export async function readLocal(userId: string): Promise<LocalState> {
  if (window.brainDesktop)
    return normalizeLocalState(await window.brainDesktop.readState(userId));
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("profiles")
      .objectStore("profiles")
      .get(localKey(userId));
      request.onsuccess = () => resolve(normalizeLocalState(request.result));
    request.onerror = () => reject(request.error);
  });
}
export async function writeLocal(userId: string, state: LocalState) {
  if (window.brainDesktop) return window.brainDesktop.writeState(userId, state);
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("profiles", "readwrite");
    tx.objectStore("profiles").put(state, localKey(userId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export function validateImport(value: unknown): LocalState {
  const data = value as any;
  if (
    data?.format !== "corporate-brain-local-v1" ||
    !data.state ||
    !Array.isArray(data.state.conversations) ||
    !Array.isArray(data.state.drafts) ||
    !Array.isArray(data.state.installed) ||
    !Array.isArray(data.state.projects)
  )
    throw new Error("文件不是有效的公司大脑本地备份");
  for (const conversation of data.state.conversations)
    if (
      typeof conversation.id !== "string" ||
      typeof conversation.title !== "string" ||
      !Array.isArray(conversation.messages) ||
      conversation.messages.some(
        (m: any) =>
          typeof m.id !== "string" ||
          typeof m.content !== "string" ||
          !["user", "assistant"].includes(m.role),
      )
    )
      throw new Error("备份中的对话格式有误");
  for (const draft of data.state.drafts)
    if (
      typeof draft.id !== "string" ||
      typeof draft.name !== "string" ||
      typeof draft.instructions !== "string" ||
      !Array.isArray(draft.sourceIds)
    )
      throw new Error("备份中的技能草稿格式有误");
  // Installed packages are re-authorized by downloading from the platform; never trust imports as grants.
  return normalizeLocalState({
    ...emptyState(),
    conversations: data.state.conversations,
    drafts: data.state.drafts,
    projects: data.state.projects,
    workspaces: data.state.workspaces,
    activeWorkspaceId: data.state.activeWorkspaceId,
    installed: [],
    settings: data.state.settings,
  });
}
