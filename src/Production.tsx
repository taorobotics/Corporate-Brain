import { useEffect, useRef, useState } from "react";
import {
  FilmStrip,
  Code,
  FolderOpen,
  ArrowClockwise,
  UploadSimple,
  CheckCircle,
} from "@phosphor-icons/react";
import type { User, Connection } from "../shared/types";
import type {
  ProductionTask,
  ProductionLocal,
  ProductionKind,
} from "../shared/production";
import { PRODUCTION_STATUS } from "../shared/production";
import { Button, Field, Modal } from "./components";
import { api } from "./api";
import "./production.css";

export function useProduction(user: User | null) {
  const [tasks, setTasks] = useState<ProductionTask[]>([]),
    [local, setLocal] = useState<ProductionLocal | null>(null);
  const [error, setError] = useState(""),
    [saving, setSaving] = useState("");
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
    const timer = window.setInterval(() => void refresh(), 6000);
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
    tasks,
    local,
    error,
    saving,
    choose,
    open,
    refresh: () => refreshRef.current(),
  };
}
export type ProductionController = ReturnType<typeof useProduction>;
export function ChatProduction({
  id,
  controller,
  details,
}: {
  id: string;
  controller: ProductionController;
  details: () => void;
}) {
  const task = controller.tasks.find((item) => item.id === id);
  const receipt = controller.local?.receipts.find((item) => item.id === id);
  const status = receipt ? "saved" : task?.status;
  return (
    <section
      className="chat-production"
      aria-label="对话制作任务"
      data-status={status ?? "loading"}
    >
      <strong>{task?.kind === "video" ? "视频与源代码" : "制作成果"}</strong>
      <p role="status">
        {controller.saving === id
          ? "正在保存到本机并校验文件…"
          : status
            ? PRODUCTION_STATUS[status]
            : "正在读取制作状态…"}
      </p>
      {task && ["queued", "generating", "rendering"].includes(task.status) && (
        <progress value={task.progress} max={100} />
      )}
      {receipt && <small>{receipt.directory}</small>}
      {task?.error && <small role="alert">{task.error}</small>}
      {controller.error && <small role="alert">{controller.error}</small>}
      <div className="production-actions">
        {receipt && (
          <Button onClick={() => void controller.open(id)}>
            <FolderOpen size={17} />
            打开成果文件夹
          </Button>
        )}
        <Button onClick={details}>查看任务详情</Button>
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
  return (
    <section className="production-saved">
      <h2>已保存到这台电脑</h2>
      {controller.local?.receipts.length ? (
        controller.local.receipts.map((receipt) => (
          <div className="production-receipt" key={receipt.id}>
            <CheckCircle size={22} />
            <div>
              <strong>
                {receipt.files.some((f) => f.path.endsWith("video.mp4"))
                  ? "视频与源代码"
                  : "代码成果"}
              </strong>
              <small>{receipt.directory}</small>
              <small>
                {receipt.files.length} 个文件 ·{" "}
                {new Date(receipt.savedAt).toLocaleString()}
              </small>
            </div>
            <Button onClick={() => void controller.open(receipt.id)}>
              打开文件夹
            </Button>
          </div>
        ))
      ) : (
        <p className="muted">制作中心的成果保存完成后，会出现在这里。</p>
      )}
    </section>
  );
}
export default function Production({
  user,
  connections,
  controller,
}: {
  user: User;
  connections: Connection[];
  controller: ProductionController;
}) {
  const seed = useRef(
    (() => {
      try {
        return JSON.parse(
          sessionStorage.getItem(`production-draft:${user.id}`) || "{}",
        );
      } catch {
        return {};
      }
    })(),
  );
  const [kind, setKind] = useState<ProductionKind>(
    seed.current.kind === "code" ? "code" : "video",
  );
  const [prompt, setPrompt] = useState<string>(seed.current.prompt || ""),
    [seconds, setSeconds] = useState(10),
    [connectionId, setConnectionId] = useState("");
  const [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [cancelId, setCancelId] = useState("");
  const models = connections.filter(
    (item) => item.kind === "chat" && item.enabled,
  );
  const model = models.find((item) => item.id === connectionId) || models[0];
  useEffect(() => {
    sessionStorage.setItem(
      `production-draft:${user.id}`,
      JSON.stringify({ kind, prompt }),
    );
  }, [kind, prompt, user.id]);
  async function submit() {
    if (!model || !controller.local?.directory || busy) return;
    setBusy(true);
    setMessage("正在提交…");
    try {
      if (
        files.length > 8 ||
        files.some((f) => f.size > 128 * 1024 ** 2 || !f.size) ||
        files.reduce((s, f) => s + f.size, 0) > 512 * 1024 ** 2
      )
        throw Error("最多 8 个素材，每个最多 128 MB，合计最多 512 MB");
      const task = await api<ProductionTask>("/production", {
        kind,
        prompt,
        seconds,
        deviceId: controller.local.deviceId,
        connectionId: model.id,
        inputs: files.map((f) => ({
          name: f.name.normalize("NFC"),
          size: f.size,
        })),
      });
      try {
        for (let i = 0; i < files.length; i++) {
          setMessage(`正在上传素材 ${i + 1}/${files.length}：${files[i].name}`);
          const response = await fetch(
            `/api/production/${task.id}/materials/${i}`,
            {
              method: "PUT",
              credentials: "include",
              headers: { "Content-Type": "application/octet-stream" },
              body: files[i],
              signal: AbortSignal.timeout(10 * 60_000),
            },
          );
          if (!response.ok)
            throw Error((await response.json()).error || "素材上传失败");
        }
        await api(`/production/${task.id}/start`, {});
      } catch (error) {
        // Do not silently delete successfully uploaded materials after a network failure.
        throw Error(
          `${(error as Error).message}。任务已保留，可在下方重试或取消后重新提交。`,
        );
      }
      setPrompt("");
      setFiles([]);
      setMessage("已提交。可以切换页面，成果完成后会自动保存到这台电脑。");
      await controller.refresh();
    } catch (e) {
      setMessage((e as Error).message);
      await controller.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function action(id: string, operation: "start" | "cancel") {
    try {
      await api(`/production/${id}/${operation}`, {});
      setCancelId("");
      await controller.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <div className="page production-page">
      <header className="production-heading">
        <div>
          <p className="production-eyebrow">公司大脑 · 制作中心</p>
          <h1>把想法做成文件</h1>
          <p>Mac mini 负责制作，你的电脑保存成果。</p>
        </div>
        <FilmStrip size={44} weight="duotone" />
      </header>
      {!window.brainDesktop?.production && (
        <div className="production-notice" role="status">
          自动保存需要 0.17.0
          或更高版本客户端。请先更新客户端，再选择本机文件夹。
        </div>
      )}
      <ProductionLocation controller={controller} />
      <div className="production-grid">
        <section className="production-compose">
          <div className="production-kind" role="group" aria-label="制作类型">
            <button
              disabled={busy}
              className={kind === "video" ? "active" : ""}
              onClick={() => setKind("video")}
            >
              <FilmStrip size={22} />
              <strong>代码视频</strong>
              <small>动画、字幕与图文短片</small>
            </button>
            <button
              disabled={busy}
              className={kind === "code" ? "active" : ""}
              onClick={() => setKind("code")}
            >
              <Code size={22} />
              <strong>代码文件</strong>
              <small>完整源码，保存到本机</small>
            </button>
          </div>
          <Field label="你想制作什么？">
            <textarea
              rows={7}
              value={prompt}
              maxLength={18000}
              disabled={busy}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                kind === "video"
                  ? "例如：制作一段 10 秒的产品发布视频，暖白背景，标题逐字出现，最后展示品牌口号。"
                  : "例如：生成一个可本地打开的产品介绍网页，附运行说明。"
              }
            />
          </Field>
          <div className="production-options">
            <Field label="使用模型">
              <select
                disabled={busy}
                value={model?.id || ""}
                onChange={(e) => setConnectionId(e.target.value)}
              >
                {!models.length && <option value="">请先配置对话模型</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            {kind === "video" && (
              <Field label="时长">
                <select
                  disabled={busy}
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                >
                  {[5, 10, 15, 30, 60].map((s) => (
                    <option key={s} value={s}>
                      {s} 秒
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <label className="production-upload">
            <UploadSimple size={22} />
            <span>
              添加原始素材
              <small>最多 8 个，每个 128 MB · 素材会随成果完整回传</small>
            </span>
            <input
              type="file"
              multiple
              disabled={busy}
              onChange={(e) => {
                setFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
          </label>
          {!!files.length && (
            <ul className="production-files">
              {files.map((file, i) => (
                <li key={i}>
                  <span>
                    {file.name} · {(file.size / 1024 ** 2).toFixed(1)} MB
                  </span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      setFiles((list) => list.filter((_, n) => n !== i))
                    }
                    aria-label={`移除 ${file.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="production-help">
            {kind === "video"
              ? "免费代码渲染 · 720p / 24 帧。图片、视频可入画，首个音频文件作配乐；其他素材原样回传。模型根据你的说明和文本素材编写动画。"
              : "代码生成后作为文件交付，请在本机检查后运行。"}
          </p>
          <Button
            primary
            disabled={
              busy ||
              !model ||
              prompt.trim().length < 2 ||
              !controller.local?.directory
            }
            onClick={() => void submit()}
          >
            {busy
              ? "正在提交…"
              : kind === "video"
                ? "交给 Mac mini 制作"
                : "生成代码文件"}
          </Button>
          {message && (
            <p className="production-notice" role="status">
              {message}
            </p>
          )}
        </section>
        <section className="production-tasks">
          <div className="production-section-heading">
            <h2>我的制作任务</h2>
            <Button onClick={() => void controller.refresh()}>
              <ArrowClockwise size={16} />
              刷新
            </Button>
          </div>
          {controller.error && (
            <p className="production-notice" role="alert">
              {controller.error} 文件尚未确认保存时，服务器会继续保留。
            </p>
          )}
          {!controller.tasks.length && (
            <div className="production-empty">
              <FilmStrip size={36} />
              <p>第一份成果，从一个想法开始</p>
              <small>关闭客户端不会取消制作，重新打开后继续回传。</small>
            </div>
          )}
          {controller.tasks.map((task) => {
            const here = task.deviceId === controller.local?.deviceId;
            const receipt = controller.local?.receipts.find(
              (r) => r.id === task.id,
            );
            return (
              <article className="production-task" key={task.id}>
                <div className="production-section-heading">
                  <strong>
                    {task.kind === "video" ? "代码视频" : "代码文件"}
                  </strong>
                  <time>{new Date(task.createdAt).toLocaleString()}</time>
                </div>
                <p className={`production-status status-${task.status}`}>
                  {controller.saving === task.id
                    ? "正在保存到本机并校验文件…"
                    : PRODUCTION_STATUS[task.status]}
                </p>
                {["generating", "rendering"].includes(task.status) && (
                  <progress value={task.progress} max={100} />
                )}
                {task.error && <small>{task.error}</small>}
                {!here && !["saved", "cancelled"].includes(task.status) && (
                  <small>请在提交任务的电脑上接收成果。</small>
                )}
                <div className="production-actions">
                  {receipt && (
                    <Button onClick={() => void controller.open(task.id)}>
                      打开成果文件夹
                    </Button>
                  )}
                  {["failed", "uploading"].includes(task.status) && (
                    <Button onClick={() => void action(task.id, "start")}>
                      重试制作
                    </Button>
                  )}
                  {!["saved", "cancelled", "cleaning"].includes(
                    task.status,
                  ) && (
                    <Button
                      disabled={controller.saving === task.id}
                      onClick={() => setCancelId(task.id)}
                    >
                      取消任务
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      </div>
      {cancelId && (
        <Modal title="取消这份制作任务？" close={() => setCancelId("")}>
          <p>
            取消后会停止制作，并删除 Mac mini
            上该任务的素材、代码与成果。本机已有文件会保留。
          </p>
          <div className="production-actions">
            <Button onClick={() => setCancelId("")}>继续保留</Button>
            <Button primary onClick={() => void action(cancelId, "cancel")}>
              取消并清理
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
