import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  ArrowDown,
  ArrowUpRight,
  CheckCircle,
  CircleNotch,
  DownloadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button, Modal } from "./components";
import { api } from "./api";
import type { UpdateFeed, UpdateState } from "../shared/updates";

const initial: UpdateState = {
  status: "idle",
  currentVersion: "",
  target: "",
  release: null,
  received: 0,
  error: "",
  checkedAt: null,
};
const labels: Record<string, string> = {
  "win32-x64": "Windows · 64 位",
  "darwin-arm64": "Mac · Apple 芯片",
  "darwin-x64": "Mac · Intel 芯片",
};
const megabytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
export function useDesktopUpdates(enabled: boolean) {
  const bridge = window.brainDesktop?.updates;
  const [state, setState] = useState(initial);
  const [open, setOpen] = useState(false);
  const [legacy, setLegacy] = useState<UpdateFeed | null>(null);
  const [actionError, setActionError] = useState("");
  const desktop = !!window.brainDesktop;
  const check = async () => {
    setActionError("");
    try {
      if (bridge) setState(await bridge.check());
      else if (desktop) {
        setState((value) => ({ ...value, status: "checking", error: "" }));
        const feed = await api<UpdateFeed>("/desktop-updates/latest");
        setLegacy(feed);
        setState({
          ...initial,
          status: feed.configured ? "available" : "unavailable",
          error: feed.configured
            ? ""
            : "公司更新服务尚未就绪，请稍后重试；持续失败请联系管理员。",
        });
      }
    } catch {
      setState((value) => ({
        ...value,
        status: "error",
        error: "暂时无法检查更新，请检查公司连接后重试",
      }));
    }
  };
  useEffect(() => {
    if (!enabled || !desktop) {
      setOpen(false);
      return;
    }
    let active = true,
      last = 0,
      failed = false,
      checking = false;
    const unsubscribe = bridge?.onState((value) => {
      if (active) {
        setState(value);
        failed = ["error", "unavailable"].includes(value.status);
      }
    });
    const poll = (force = false) => {
      if (
        !active ||
        checking ||
        (!force && Date.now() - last < (failed ? 60_000 : 5 * 60_000))
      )
        return;
      last = Date.now();
      checking = true;
      void check().finally(() => {
        checking = false;
      });
    };
    if (bridge)
      void bridge.state().then((value) => {
        if (active) {
          setState(value);
          poll();
        }
      });
    else poll();
    const interval = setInterval(() => poll(), 60_000);
    const online = () => poll(true);
    const focus = () => poll();
    window.addEventListener("online", online);
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearInterval(interval);
      unsubscribe?.();
      window.removeEventListener("online", online);
      window.removeEventListener("focus", focus);
    };
  }, [enabled, desktop]);
  return {
    desktop,
    bridge,
    state,
    open,
    legacy,
    actionError,
    check,
    show: () => {
      setOpen(true);
      if (!["checking", "downloading", "ready"].includes(state.status))
        void check();
    },
    close: () => setOpen(false),
    act: async (
      action: "download" | "cancel" | "install",
      beforeInstall?: () => Promise<void>,
    ) => {
      setActionError("");
      try {
        if (action === "install") await beforeInstall?.();
        await bridge?.[action]();
      } catch (error) {
        setActionError(
          (error as Error).message.replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            "",
          ),
        );
      }
    },
  };
}
type Controller = ReturnType<typeof useDesktopUpdates>;
export function UpdateButton({ model }: { model: Controller }) {
  if (!model.desktop) return null;
  const { state, bridge, legacy } = model;
  const available = !!state.release || (!bridge && !!legacy?.release);
  const downloading = state.status === "downloading";
  const ready = state.status === "ready";
  const title = downloading
    ? "正在下载更新"
    : ready
      ? "更新已准备好"
      : available
        ? "有可用更新"
        : "检查更新";
  const version = state.release?.version ?? legacy?.release?.version;
  const percent = state.release
    ? Math.min(
        100,
        Math.floor((state.received / state.release.asset.bytes) * 100),
      )
    : 0;
  return (
    <button
      className={`sidebar-update ${available ? "has-update" : ""}`}
      onClick={model.show}
      aria-label={title}
    >
      <span className="update-icon">
        {downloading ? (
          <CircleNotch size={18} className="spin" />
        ) : ready ? (
          <CheckCircle size={18} />
        ) : (
          <ArrowDown size={18} />
        )}
      </span>
      <span className="update-button-copy">
        <strong>{title}</strong>
        {available && (
          <small>
            {downloading ? `${percent}% · 可继续工作` : `v${version}`}
          </small>
        )}
      </span>
      {available ? (
        <span className="update-dot" />
      ) : (
        <span className="update-shortcut">↗</span>
      )}
    </button>
  );
}
export function UpdateDialog({
  model,
  beforeInstall,
}: {
  model: Controller;
  beforeInstall: () => Promise<void>;
}) {
  if (!model.open || !model.desktop) return null;
  const { state, bridge, legacy } = model;
  const release = state.release;
  const busy = state.status === "checking";
  const downloading = state.status === "downloading";
  const ready = state.status === "ready";
  const percent = release
    ? Math.min(100, Math.floor((state.received / release.asset.bytes) * 100))
    : 0;
  const latest = release ?? legacy?.release;
  const subtitle = downloading
    ? percent === 100
      ? "正在校验安装包…"
      : "正在下载，可以继续工作"
    : ready
      ? "已下载，校验通过"
      : latest
        ? "让工作空间保持最新"
        : state.status === "current"
          ? "当前已经是最新版本"
          : "客户端更新";
  return (
    <Modal title="更新公司大脑" close={model.close}>
      <div className="update-dialog">
        <div className={`update-hero ${ready ? "is-ready" : ""}`}>
          <div className="update-hero-icon">
            {busy || downloading ? (
              <CircleNotch size={28} className="spin" />
            ) : ready || state.status === "current" ? (
              <CheckCircle size={28} />
            ) : (
              <DownloadSimple size={28} />
            )}
          </div>
          <div>
            <h3>
              {latest
                ? `公司大脑 v${latest.version}`
                : busy
                  ? "正在检查新版本…"
                  : subtitle}
            </h3>
            <p>{latest ? subtitle : "通过公司工作空间获取已发布的版本"}</p>
          </div>
        </div>
        <div className="update-version-row">
          <span>
            {state.currentVersion
              ? `当前 v${state.currentVersion}`
              : "旧版客户端"}
          </span>
          <span>{labels[state.target] ?? "桌面客户端"}</span>
        </div>
        {latest && (
          <>
            {latest.publishedAt && (
              <p className="update-published">
                发布于{" "}
                {new Date(latest.publishedAt).toLocaleDateString("zh-CN")}
              </p>
            )}
            <section className="update-notes" aria-label="版本更新说明">
              <h4>本次更新</h4>
              <div>
                {(
                  latest.notes.match(
                    /(?:^|\n)## 员工端更新\s*\n([\s\S]*?)(?=\n## |$)/,
                  )?.[1] ||
                  latest.notes ||
                  "此版本包含功能改进与问题修复。"
                )
                  .trim()
                  .replace(/^- /gm, "• ")}
              </div>
            </section>
          </>
        )}
        {downloading && release && (
          <div className="update-download" role="status">
            <div>
              <span>
                {percent === 100 ? "正在校验 SHA-256…" : "下载安装包"}
              </span>
              <strong>{percent}%</strong>
            </div>
            <progress
              value={state.received}
              max={release.asset.bytes}
              aria-label="安装包下载进度"
            />
            <small>
              {megabytes(state.received)} / {megabytes(release.asset.bytes)}
            </small>
          </div>
        )}
        {ready && (
          <p className="update-verified">
            <CheckCircle size={16} />
            安装包完整性校验通过
          </p>
        )}
        {(state.error || model.actionError) && (
          <p className="update-error" role="status">
            <WarningCircle size={18} />
            <span>{model.actionError || state.error}</span>
          </p>
        )}
        {latest && (
          <p className="update-footnote">
            {bridge
              ? "本地对话和个人草稿保留在这台电脑。"
              : "这版客户端需手动安装一次；安装后即可在这里下载并打开后续更新。"}
            {ready &&
              state.target.startsWith("darwin") &&
              "打开 DMG 后，请退出应用并拖入 Applications 替换。"}
          </p>
        )}
        <footer>
          {bridge && (
            <Button
              disabled={busy || downloading}
              onClick={() => void model.check()}
            >
              <ArrowClockwise size={15} />
              重新检查
            </Button>
          )}
          {downloading ? (
            <Button onClick={() => void model.act("cancel")}>取消下载</Button>
          ) : ready ? (
            <Button
              primary
              onClick={() => void model.act("install", beforeInstall)}
            >
              <ArrowUpRight size={16} />
              {state.target.startsWith("darwin") ? "打开安装包" : "退出并安装"}
            </Button>
          ) : release ? (
            <Button
              primary
              disabled={busy}
              onClick={() => void model.act("download")}
            >
              <DownloadSimple size={16} />
              下载更新 · {megabytes(release.asset.bytes)}
            </Button>
          ) : !bridge && legacy?.release ? (
            <div className="legacy-update-links">
              {Object.entries(legacy.release.assets)
                .filter(([target]) =>
                  target.startsWith(
                    document.documentElement.dataset.desktop || "",
                  ),
                )
                .map(([target]) => (
                  <a
                    className="button primary"
                    key={target}
                    href={`/api/desktop-updates/${legacy.release!.version}/${target}`}
                    download
                  >
                    <DownloadSimple size={16} />
                    {labels[target]}
                  </a>
                ))}
            </div>
          ) : !bridge ? (
            <Button disabled={busy} onClick={() => void model.check()}>
              重新检查
            </Button>
          ) : null}
        </footer>
      </div>
    </Modal>
  );
}
