import { useEffect, useRef, useState } from "react";
import { FolderOpen, ArrowClockwise } from "@phosphor-icons/react";
import type { User, Message } from "../shared/types";
import type { ProductionTask, ProductionLocal } from "../shared/production";
import { productionReply, productionOutcome } from "../shared/production-reply";
import { ThinkingProcess } from "./ChatLoading";
import MessageContent from "./MessageContent";
import { Button, Modal } from "./components";
import { api } from "./api";
import "./production.css";

export function useProduction(user: User | null) {
  const [tasks, setTasks] = useState<ProductionTask[]>([]),
    [local, setLocal] = useState<ProductionLocal | null>(null);
  const [error, setError] = useState(""),
    [saving, setSaving] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    setTasks([]);
    setLocal(null);
    setError("");
    setSaving("");
    if (!user || user.mustChange) return;
    let active = true,
      busy = false;
    const refresh = async () => {
      if (busy || !active) return;
      busy = true;
      try {
        const list = await api<ProductionTask[]>("/production");
        const bridge = window.brainDesktop?.production;
        const state = bridge ? await bridge.state(user.id) : null;
        if (!active) return;
        setTasks(list);
        setLocal(state);
        if (bridge && state?.directory) {
          const ready = list.find(
            (task) =>
              task.deviceId === state.deviceId &&
              ["ready", "cleaning"].includes(task.status),
          );
          if (ready) {
            setSaving(ready.id);
            await bridge.collect(user.id, ready.id);
            if (!active) return;
            setLocal(await bridge.state(user.id));
            setTasks(await api<ProductionTask[]>("/production"));
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
    actionBusy,
    track: (task: ProductionTask) =>
      setTasks((list) => [task, ...list.filter((item) => item.id !== task.id)]),
    action: async (id: string, operation: "start" | "cancel") => {
      if (actionBusy) return;
      setActionBusy(id);
      try {
        await api(`/production/${id}/${operation}`, {});
        setError("");
        await refreshRef.current();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setActionBusy("");
      }
    },
    refresh: () => refreshRef.current(),
  };
}
export type ProductionController = ReturnType<typeof useProduction>;
export function ChatProduction({
  id,
  controller,
  message,
}: {
  id: string;
  controller: ProductionController;
  message?: Message;
}) {
  const [cancel, setCancel] = useState(false);
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
        {productionOutcome(task, receipt, saving)}
      </p>
      {task?.error && <small role="alert">{task.error}</small>}
      {controller.error && <small role="alert">{controller.error}</small>}
      {!!receipt?.files.length && (
        <details className="workflow-files">
          <summary>成果文件 · {receipt.files.length} 个</summary>
          <ul>
            {receipt.files.map((file) => (
              <li key={file.path}>
                <span>{file.path}</span>
                <small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small>
                {(file.path.startsWith("code/") ||
                  file.path === "output/video.mp4" ||
                  (file.path.startsWith("files/") &&
                    /\.(?:gif|png|jpe?g|webp|mp4|webm|txt|md|json|csv|js|ts|tsx|jsx|py|html|css|svg)$/i.test(
                      file.path,
                    )) ||
                  file.path === "plan.md") && (
                  <Button
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
      {preview && (
        <div className="workflow-preview">
          <div>
            <strong>{preview.name}</strong>
            <Button onClick={() => setPreview(null)}>关闭预览</Button>
          </div>
          {preview.url && preview.mime?.startsWith("image/") ? (
            <img
              src={preview.url}
              alt={preview.name}
              className="workflow-image-preview"
            />
          ) : preview.url ? (
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
            disabled={!!controller.actionBusy}
            onClick={() => void controller.action(id, "start")}
          >
            <ArrowClockwise size={17} />
            在此重试
          </Button>
        )}
        {task && !["saved", "cancelled", "cleaning"].includes(task.status) && (
          <Button
            disabled={saving || !!controller.actionBusy}
            onClick={() => setCancel(true)}
          >
            停止任务
          </Button>
        )}
        {task?.status === "ready" && !controller.local?.directory && (
          <Button onClick={() => void controller.choose()}>选择保存位置</Button>
        )}
      </div>
      {cancel && (
        <Modal title="停止这份任务？" close={() => setCancel(false)}>
          <p>
            将停止制作并清理 Mac mini
            上该任务的临时文件，已经保存到本机的文件会保留。
          </p>
          <div className="production-actions">
            <Button onClick={() => setCancel(false)}>继续制作</Button>
            <Button
              primary
              disabled={!!controller.actionBusy}
              onClick={() => {
                setCancel(false);
                void controller.action(id, "cancel");
              }}
            >
              停止并清理
            </Button>
          </div>
        </Modal>
      )}
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
        <span>成果自动保存位置</span>
        <small>
          {controller.local?.directory ||
            "选择此电脑的文件夹，代码、素材、成片都会保存到这里"}
        </small>
        <small>完整保存并校验后，Mac mini 立即清理该任务文件。</small>
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
