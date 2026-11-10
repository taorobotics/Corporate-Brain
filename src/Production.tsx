import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  ArrowClockwise,
  FileText,
  Eye,
} from "@phosphor-icons/react";
import type { User, Message, LocalState } from "../shared/types";
import type {
  ProductionTask,
  ProductionLocal,
  ProductionFile,
} from "../shared/production";
import { productionReply, productionOutcome } from "../shared/production-reply";
import { ThinkingProcess } from "./ChatLoading";
import MessageContent from "./MessageContent";
import { Button, Modal } from "./components";
import { api } from "./api";
import { cancelProduction } from "./automatic";
import "./production.css";

export function useProduction(user: User | null, profile: LocalState) {
  const currentUser = useRef(user);
  currentUser.current = user;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const [tasks, setTasks] = useState<ProductionTask[]>([]),
    [local, setLocal] = useState<ProductionLocal | null>(null);
  const [error, setError] = useState(""),
    [saving, setSaving] = useState("");
  const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({});
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const actionLocks = useRef(new Set<string>());
  const taskRevision = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    setTasks([]);
    setLocal(null);
    setError("");
    setSaving("");
    actionLocks.current.clear();
    setActionBusy({});
    setTaskErrors({});
    if (!user || user.mustChange) return;
    let active = true,
      busy = false;
    const refresh = async () => {
      if (busy || !active) return;
      busy = true;
      try {
        const revision = taskRevision.current;
        const list = await api<ProductionTask[]>("/production");
        const bridge = window.brainDesktop?.production;
        const state = bridge ? await bridge.state(user.id) : null;
        if (!active) return;
        if (revision !== taskRevision.current) return;
        setTasks(list);
        setLocal(state);
        if (bridge && state) {
          const ready = list.find(
            (task) =>
              task.deviceId === state.deviceId &&
              ["ready", "cleaning"].includes(task.status) &&
              profileRef.current.conversations.some((c) =>
                c.messages.some((m) => m.productionTaskId === task.id),
              ),
          );
          if (ready) {
            const profile = profileRef.current;
            const conversation = profile.conversations.find((c) =>
              c.messages.some((m) => m.productionTaskId === ready.id),
            );
            const workspace = profile.workspaces.find(
              (w) => w.id === conversation?.workspaceId,
            );
            if (workspace?.folder && !bridge.workspaceFolders)
              throw Error(
                "请先更新客户端，才能把成果保存到对应工作区；服务器文件会保留。",
              );
            if (!workspace?.folder && !state.directory) return;
            setSaving(ready.id);
            await bridge.collect(
              user.id,
              ready.id,
              bridge.workspaceFolders ? workspace?.id : undefined,
            );
            if (!active) return;
            setLocal(await bridge.state(user.id));
            const revision = taskRevision.current;
            const refreshed = await api<ProductionTask[]>("/production");
            if (active && revision === taskRevision.current)
              setTasks(refreshed);
          }
        }
        if (active) setError("");
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        busy = false;
        if (active) setSaving("");
      }
    };
    refreshRef.current = refresh;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    const online = () => void refresh();
    window.addEventListener("online", online);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", online);
      refreshRef.current = async () => {};
    };
  }, [user?.id, user?.mustChange]);
  const choose = async () => {
    if (!user || !window.brainDesktop?.production) return;
    try {
      setLocal(await window.brainDesktop.production.chooseDirectory(user.id));
      setError("");
      void refreshRef.current();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const open = async (id?: string) => {
    if (!user) return;
    try {
      await window.brainDesktop?.production?.open(user.id, id);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return {
    userId: user?.id ?? "",
    tasks,
    local,
    error,
    saving,
    choose,
    open,
    reveal: async (id: string, path: string) => {
      if (!user) return;
      try {
        const bridge = window.brainDesktop?.production;
        if (bridge?.reveal) await bridge.reveal(user.id, id, path);
        else await bridge?.open(user.id, id);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      }
    },
    actionBusy,
    taskErrors,
    track: (task: ProductionTask) => {
      if (!user || currentUser.current?.id !== user.id) return;
      taskRevision.current++;
      setTasks((list) => [task, ...list.filter((item) => item.id !== task.id)]);
    },
    action: async (id: string, operation: "start" | "cancel") => {
      if (!user || currentUser.current?.id !== user.id) return false;
      if (actionLocks.current.has(id)) return false;
      actionLocks.current.add(id);
      taskRevision.current++;
      setActionBusy((all) => ({ ...all, [id]: true }));
      try {
        const task =
          operation === "cancel"
            ? await cancelProduction(id)
            : await api<ProductionTask>(`/production/${id}/${operation}`, {});
        if (currentUser.current?.id !== user.id) return false;
        taskRevision.current++;
        setTasks((list) => [
          task,
          ...list.filter((item) => item.id !== task.id),
        ]);
        setTaskErrors((all) => ({ ...all, [id]: "" }));
        await refreshRef.current();
        return true;
      } catch (e) {
        if (currentUser.current?.id === user.id)
          setTaskErrors((all) => ({ ...all, [id]: (e as Error).message }));
        return false;
      } finally {
        actionLocks.current.delete(id);
        setActionBusy((all) => ({ ...all, [id]: false }));
      }
    },
    refresh: () => refreshRef.current(),
    save: async (id: string) => {
      if (!user || !window.brainDesktop?.production) return;
      try {
        const bridge = window.brainDesktop.production;
        let chosen = await bridge.state(user.id);
        if (!chosen.directory) chosen = await bridge.chooseDirectory(user.id);
        if (!chosen.directory) return;
        await bridge.collect(user.id, id);
        await refreshRef.current();
      } catch (e) {
        setError((e as Error).message);
      }
    },
  };
}
export type ProductionController = ReturnType<typeof useProduction>;
function SavedImage({
  file,
  id,
  controller,
  show,
}: {
  file: ProductionFile;
  id: string;
  controller: ProductionController;
  show: () => void;
}) {
  const target = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      loaded = false,
      objectUrl = "";
    setUrl("");
    setError("");
    const load = async () => {
      if (loaded) return;
      loaded = true;
      try {
        const result = await window.brainDesktop!.production!.preview!(
          controller.userId,
          id,
          file.path,
        );
        if (!active) return;
        if (
          !result.bytes ||
          !/^image\/(?:gif|png|jpeg|webp)$/.test(result.mime)
        )
          throw Error("图片预览暂不可用");
        objectUrl = URL.createObjectURL(
          new Blob([new Uint8Array(result.bytes)], { type: result.mime }),
        );
        setUrl(objectUrl);
      } catch {
        if (active) setError("图片暂无法预览，点击重试");
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "150px" },
    );
    if (target.current) observer.observe(target.current);
    return () => {
      active = false;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [controller.userId, id, file.path, file.sha256]);
  return (
    <figure className="production-image">
      <button
        ref={target}
        type="button"
        className="production-thumbnail"
        aria-label={`预览图片：${file.path}`}
        onClick={show}
      >
        {url && !error ? (
          <img
            src={url}
            alt={file.path.split("/").at(-1)}
            loading="lazy"
            onError={() => setError("图片无法显示，可打开本地文件")}
          />
        ) : (
          <span>{error || "正在读取图片…"}</span>
        )}
      </button>
      <figcaption>
        <button
          type="button"
          className="production-file-link"
          title="在文件夹中显示"
          onClick={() => void controller.reveal(id, file.path)}
        >
          {file.path.split("/").at(-1)}
        </button>
      </figcaption>
    </figure>
  );
}
export function ChatProduction({
  id,
  controller,
  message,
}: {
  id: string;
  controller: ProductionController;
  message?: Message;
}) {
  const [preview, setPreview] = useState<{
    url?: string;
    text?: string;
    mime?: string;
    name: string;
  } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  useEffect(
    () => () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    },
    [preview?.url],
  );
  const task = controller.tasks.find((item) => item.id === id);
  const receipt = controller.local?.receipts.find((item) => item.id === id);
  let imageBytes = 0;
  const images = window.brainDesktop?.production?.preview
    ? (receipt?.files ?? [])
        .filter((file) => {
          if (
            !file.path.startsWith("files/") ||
            !/\.(?:gif|png|jpe?g|webp)$/i.test(file.path) ||
            file.size > 8 * 1024 ** 2 ||
            imageBytes + file.size > 32 * 1024 ** 2
          )
            return false;
          imageBytes += file.size;
          return true;
        })
        .slice(0, 8)
    : [];
  const status = task?.status ?? (receipt ? "saved" : undefined);
  const saving = controller.saving === id;
  const terminal = status && ["saved", "failed", "cancelled"].includes(status);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (terminal) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [terminal]);
  const reply = productionReply(
    message ?? {
      id,
      role: "assistant",
      content: "",
      productionTaskId: id,
      at: task?.createdAt ?? "",
    },
    task,
  );
  const previewFile = async (path: string) => {
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const bridge = window.brainDesktop?.production;
      if (!bridge?.preview)
        throw Error(
          "当前客户端请使用“打开成果文件夹”；安装新版客户端后可在这里预览。",
        );
      const result = await bridge.preview(controller.userId, id, path);
      setPreview(
        result.bytes
          ? {
              name: path,
              mime: result.mime,
              url: URL.createObjectURL(
                new Blob([new Uint8Array(result.bytes)], { type: result.mime }),
              ),
            }
          : { name: path, text: result.content ?? "" },
      );
    } catch (e) {
      setPreviewError((e as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  };
  return (
    <section
      className="chat-production"
      aria-label="对话回复"
      data-status={status ?? "loading"}
    >
      <ThinkingProcess
        items={reply.trace?.items ?? []}
        status={terminal ? (reply.trace?.status ?? "done") : "running"}
        elapsed={
          terminal
            ? (reply.trace?.elapsed ?? 0)
            : task
              ? Math.max(
                  0,
                  Math.floor((now - Date.parse(task.createdAt)) / 1000),
                )
              : 0
        }
        answerStarted={!!reply.content}
      />
      <MessageContent content={reply.content} />
      <p className="production-outcome" role="status">
        {receipt && !saving ? (
          <>
            已保存到本机：{" "}
            <button
              type="button"
              className="production-folder-link"
              title="打开成果文件夹"
              onClick={() => void controller.open(id)}
            >
              <FolderOpen size={15} />
              {receipt.directory}
            </button>
            {task?.status === "cleaning" ? "（正在清理服务器副本）" : ""}
          </>
        ) : (
          productionOutcome(task, receipt, saving)
        )}
      </p>
      {task?.error && <small role="alert">{task.error}</small>}
      {(controller.taskErrors[id] || controller.error) && (
        <small role="alert">
          {controller.taskErrors[id] || controller.error}
        </small>
      )}
      {!!images.length && (
        <div className="production-gallery" aria-label="成果图片预览">
          {images.map((file) => (
            <SavedImage
              key={file.path}
              file={file}
              id={id}
              controller={controller}
              show={() => void previewFile(file.path)}
            />
          ))}
        </div>
      )}
      {!!receipt?.files.length && (
        <div
          className="production-file-shortcuts"
          aria-label="成果文件快捷入口"
        >
          {receipt.files
            .filter((file) => !/\.(?:gif|png|jpe?g|webp)$/i.test(file.path))
            .sort(
              (a, b) =>
                Number(/\.zip$/i.test(b.path)) - Number(/\.zip$/i.test(a.path)),
            )
            .slice(0, 6)
            .map((file) => (
              <div className="production-output-file" key={file.path}>
                <button
                  type="button"
                  className="production-file-link"
                  title={`在文件夹中显示：${file.path}`}
                  onClick={() => void controller.reveal(id, file.path)}
                >
                  <FileText size={22} />
                  <span className="production-file-copy">
                    <strong>{file.path.split("/").at(-1)}</strong>
                    <small>
                      {file.path.split(".").at(-1)?.toUpperCase()} ·{" "}
                      {Math.max(1, Math.ceil(file.size / 1024))} KB
                    </small>
                  </span>
                </button>
                <div className="production-file-quick-actions">
                  {(file.path.startsWith("code/") ||
                    file.path === "output/video.mp4" ||
                    file.path === "plan.md" ||
                    (file.path.startsWith("files/") &&
                      /\.(?:mp4|webm|txt|md|json|csv|js|ts|tsx|jsx|py|html|css|svg)$/i.test(
                        file.path,
                      ))) && (
                    <button
                      type="button"
                      disabled={previewBusy}
                      onClick={() => void previewFile(file.path)}
                      title={`预览：${file.path}`}
                    >
                      <Eye size={13} />
                      预览
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void controller.reveal(id, file.path)}
                    title={`在文件夹中显示：${file.path}`}
                  >
                    <FolderOpen size={13} />
                    打开文件夹
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
      {!!receipt?.files.length && (
        <details className="workflow-files">
          <summary>成果文件 · {receipt.files.length} 个</summary>
          <ul>
            {receipt.files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className="production-file-link"
                  title="在文件夹中显示"
                  onClick={() => void controller.reveal(id, file.path)}
                >
                  {file.path}
                </button>
                <small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small>
                {(file.path.startsWith("code/") ||
                  file.path === "output/video.mp4" ||
                  (file.path.startsWith("files/") &&
                    /\.(?:gif|png|jpe?g|webp|mp4|webm|txt|md|json|csv|js|ts|tsx|jsx|py|html|css|svg)$/i.test(
                      file.path,
                    )) ||
                  file.path === "plan.md") && (
                  <Button
                    title={`预览：${file.path}`}
                    disabled={previewBusy}
                    onClick={() => void previewFile(file.path)}
                  >
                    预览
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {preview?.url && preview.mime?.startsWith("image/") ? (
        <Modal title={preview.name} close={() => setPreview(null)} wide>
          <img
            src={preview.url}
            alt={preview.name}
            className="workflow-image-preview production-image-full"
          />
          <Button onClick={() => void controller.reveal(id, preview.name)}>
            <FolderOpen size={17} />
            在文件夹中显示
          </Button>
        </Modal>
      ) : (
        preview && (
          <div className="workflow-preview">
            <div>
              <strong>{preview.name}</strong>
              <Button onClick={() => setPreview(null)}>关闭预览</Button>
            </div>
            {preview.url ? (
              <video
                src={preview.url}
                controls
                preload="metadata"
                aria-label="制作成片预览"
              />
            ) : (
              <pre>
                <code>{preview.text}</code>
              </pre>
            )}
          </div>
        )
      )}
      {previewError && <small role="alert">{previewError}</small>}
      <div className="production-actions">
        {receipt && (
          <Button onClick={() => void controller.open(id)}>
            <FolderOpen size={17} />
            打开成果文件夹
          </Button>
        )}
        {task && ["failed", "uploading"].includes(task.status) && (
          <Button
            disabled={!!controller.actionBusy[id]}
            onClick={() => void controller.action(id, "start")}
          >
            <ArrowClockwise size={17} />
            在此重试
          </Button>
        )}
        {task?.status === "ready" && (
          <Button disabled={saving} onClick={() => void controller.save(id)}>
            {controller.local?.directory
              ? "保存到默认文件夹"
              : "选择保存文件夹"}
          </Button>
        )}
      </div>
    </section>
  );
}
export function ProductionLocation({
  controller,
}: {
  controller: ProductionController;
}) {
  return (
    <div className="setting-row production-location">
      <div>
        <span>默认成果保存位置</span>
        <small>
          {controller.local?.directory ||
            "选择此电脑的文件夹，代码、素材、成片都会保存到这里"}
        </small>
        <small>
          已选文件夹的工作区优先保存到工作区内。完整保存并校验后，Mac mini
          清理该任务文件。
        </small>
      </div>
      <Button
        disabled={!window.brainDesktop?.production || !!controller.saving}
        onClick={() => void controller.choose()}
      >
        <FolderOpen size={18} />
        {controller.local?.directory ? "更换文件夹" : "选择文件夹"}
      </Button>
    </div>
  );
}
export function ProductionWorks({
  controller,
}: {
  controller: ProductionController;
}) {
  const ids = [
    ...new Set([
      ...controller.tasks.map((task) => task.id),
      ...(controller.local?.receipts.map((receipt) => receipt.id) ?? []),
    ]),
  ];
  return (
    <section className="production-saved">
      <h2>对话制作成果</h2>
      <p className="muted">
        直接在 AI
        对话中描述需求，执行进度与成果会显示在原对话。这里保留任务记录，方便继续接收和查看。
      </p>
      {ids.map((id) => (
        <ChatProduction key={id} id={id} controller={controller} />
      ))}
      {!ids.length && (
        <p className="muted">在对话中制作代码或视频后，成果会出现在这里。</p>
      )}
    </section>
  );
}
