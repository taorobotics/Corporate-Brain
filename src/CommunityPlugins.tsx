import { useEffect, useRef, useState } from "react";
import {
  ArrowSquareOut,
  CheckCircle,
  DownloadSimple,
  Plug,
  ArrowClockwise,
  Trash,
} from "@phosphor-icons/react";
import { api } from "./api";
import { Button, Empty, IconButton, Modal, Search } from "./components";
import { SelectField } from "./Dropdown";
import type {
  CommunityPlugin,
  CommunityPluginPage,
} from "../shared/community-plugins";
import "./community-plugins.css";

const scopes = [
  { id: "adapted", name: "已适配" },
  { id: "community", name: "全部社区" },
  { id: "installed", name: "我的插件" },
] as const;
export default function CommunityPlugins({
  notify,
  navigate,
}: {
  notify: (message: string) => void;
  navigate: (page: string) => void;
}) {
  const [scope, setScope] = useState<string>("adapted");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [offset, setOffset] = useState(0);
  const [generation, setGeneration] = useState(0);
  const refreshCatalog = useRef(false);
  const [data, setData] = useState<CommunityPluginPage | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState("");
  const [detail, setDetail] = useState<CommunityPlugin | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        scope,
        text: search,
        category,
        offset: String(offset),
      });
      if (refreshCatalog.current) {
        query.set("refresh", "true");
        refreshCatalog.current = false;
      }
      void api<CommunityPluginPage>(
        `/community-plugins?${query}`,
        undefined,
        "GET",
        40000,
        controller.signal,
      )
        .then(setData)
        .catch((error) => {
          if (!controller.signal.aborted) {
            setError(error.message);
            setData(null);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [scope, search, category, offset, generation]);
  async function change(
    plugin: CommunityPlugin,
    action: "install" | "enabled" | "remove",
  ) {
    setChanging(plugin.id);
    try {
      const path = `/community-plugins/${encodeURIComponent(plugin.id)}`;
      if (action === "remove") await api(path, {}, "DELETE", 20000);
      else
        await api(
          `${path}/${action}`,
          action === "enabled" ? { enabled: !plugin.enabled } : {},
          "POST",
          20000,
        );
      setDetail(null);
      setGeneration((g) => g + 1);
      notify(
        action === "install"
          ? "已安装到当前账号，AI 对话会按需调用。"
          : action === "remove"
            ? "插件已卸载，下次发送消息生效。"
            : plugin.enabled
              ? "插件已停用，下次发送消息生效。"
              : "插件已启用。",
      );
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setChanging("");
    }
  }
  const actions = (plugin: CommunityPlugin) =>
    plugin.availability !== "adapted" ? (
      <span className="muted">需要适配后才能安装</span>
    ) : plugin.installed ? (
      <>
        <Button
          disabled={!!changing}
          onClick={() => void change(plugin, "enabled")}
        >
          {plugin.enabled ? "停用" : "启用"}
        </Button>
        <IconButton
          label={`卸载${plugin.name}`}
          disabled={!!changing}
          onClick={() => setDetail(plugin)}
        >
          <Trash size={16} />
        </IconButton>
      </>
    ) : (
      <Button
        primary
        disabled={!!changing}
        onClick={() => void change(plugin, "install")}
      >
        <DownloadSimple size={16} />
        {changing === plugin.id ? "安装中…" : "安装"}
      </Button>
    );
  return (
    <div className="community-plugins">
      <header className="page-header">
        <div>
          <div className="community-eyebrow">
            <Plug size={17} />
            公司大脑 · 开源生态
          </div>
          <h1>开源社区插件</h1>
          <p className="muted">发现并安装适用于公司大脑的开源插件</p>
        </div>
        <IconButton
          label="刷新插件列表"
          disabled={busy}
          onClick={() => {
            refreshCatalog.current = true;
            setGeneration((g) => g + 1);
          }}
        >
          <ArrowClockwise size={19} />
        </IconButton>
      </header>
      <div className="community-toolbar">
        <div className="community-tabs" role="group" aria-label="插件范围">
          {scopes.map((s) => (
            <button
              key={s.id}
              aria-pressed={scope === s.id}
              onClick={() => {
                setScope(s.id);
                setCategory("");
                setOffset(0);
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
        <span className="muted">按账号安装 · 对话中按需调用</span>
      </div>
      <div className="community-search">
        <Search
          value={search}
          onChange={(value) => {
            setSearch(value);
            setOffset(0);
          }}
          placeholder="搜索插件名称、作者或功能"
        />
        <SelectField
          label="插件分类"
          value={category}
          onValueChange={(value) => {
            setCategory(value);
            setOffset(0);
          }}
          options={[
            { value: "", label: "全部分类" },
            ...(data?.categories ?? []).map((value) => ({
              value,
              label: value,
            })),
          ]}
        />
      </div>
      {scope === "community" && (
        <p className="community-source">
          目录来自开源社区。仅「已适配」插件可在公司大脑安装；其他条目保留原项目入口。收录不代表官方认证。
        </p>
      )}
      {data?.warning && (
        <p role="status" className="community-source">
          {data.warning}
        </p>
      )}
      {error ? (
        <div role="alert" className="community-empty">
          <p>{error}</p>
          <Button onClick={() => setGeneration((g) => g + 1)}>重试</Button>
        </div>
      ) : busy ? (
        <div className="community-empty" role="status">
          正在读取插件…
        </div>
      ) : !data?.items.length ? (
        <Empty
          icon={<Plug size={32} />}
          title={scope === "installed" ? "还没有安装插件" : "没有匹配的插件"}
          detail={
            scope === "installed"
              ? "在已适配列表中安装，随后即可在对话中按需使用。"
              : "试试其他名称或分类。"
          }
        />
      ) : (
        <div className="community-grid">
          {data.items.map((plugin) => (
            <article
              className="community-card"
              key={plugin.id}
              data-community-plugin={plugin.id}
            >
              <div className="community-card-top">
                <span className="community-plugin-icon">
                  <Plug size={22} />
                </span>
                <span
                  className={`community-status ${plugin.availability === "adapted" ? "verified" : ""}`}
                >
                  {plugin.installed
                    ? plugin.enabled
                      ? "已安装 · 已启用"
                      : "已安装 · 已停用"
                    : plugin.availability === "adapted"
                      ? "已适配公司大脑"
                      : "待适配"}
                </span>
              </div>
              <button
                className="community-title"
                onClick={() => setDetail(plugin)}
              >
                {plugin.name}
              </button>
              <div className="community-author">
                {plugin.author || "社区开发者"}
                {plugin.version &&
                  ` · ${plugin.availability === "adapted" ? "适配版 " : ""}v${plugin.version}`}
              </div>
              <p className="community-description">
                {plugin.description || "查看原项目了解功能与使用方式。"}
              </p>
              <footer>
                <span className="muted">{plugin.category}</span>
                <div className="inline-actions">{actions(plugin)}</div>
              </footer>
            </article>
          ))}
        </div>
      )}
      {!busy && data && (
        <div className="community-pagination">
          <span className="muted">
            共 {data.total.toLocaleString()} 个
            {data.fetchedAt &&
              ` · 读取于 ${new Date(data.fetchedAt).toLocaleString()}`}
          </span>
          <div className="inline-actions">
            <Button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 24))}
            >
              上一页
            </Button>
            <span>
              {Math.floor(offset / 24) + 1} /{" "}
              {Math.max(1, Math.ceil(data.total / 24))}
            </span>
            <Button
              disabled={offset + 24 >= data.total}
              onClick={() => setOffset(offset + 24)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
      {detail && (
        <Modal wide title={detail.name} close={() => setDetail(null)}>
          <div className="community-detail">
            <p>{detail.description}</p>
            <div className="community-detail-status">
              {detail.availability === "adapted" ? (
                <CheckCircle size={19} />
              ) : (
                <Plug size={19} />
              )}
              <span>
                {detail.availability === "adapted"
                  ? "已通过公司大脑适配与工具调用验证"
                  : "尚未适配公司大脑，当前不能安装或执行"}
              </span>
            </div>
            <dl>
              <dt>原作者</dt>
              <dd>{detail.author}</dd>
              <dt>适配状态</dt>
              <dd>
                {detail.availability === "adapted"
                  ? "公司大脑适配版 " + detail.version
                  : "待适配"}
              </dd>
              <dt>开源许可</dt>
              <dd>{detail.license}</dd>
              {detail.revision && (
                <>
                  <dt>来源版本</dt>
                  <dd>{detail.revision}</dd>
                </>
              )}
            </dl>
            <a href={detail.repository} target="_blank" rel="noreferrer">
              查看原项目 <ArrowSquareOut size={15} />
            </a>
            <p className="muted">
              安装仅对当前公司账号生效。启用后，AI
              根据问题和上下文选择需要的插件；不会在每条消息中执行全部插件。停用或卸载不打断已开始的请求。
            </p>
            <footer>
              {detail.installed ? (
                <>
                  <Button
                    disabled={!!changing}
                    onClick={() => void change(detail, "remove")}
                  >
                    卸载插件
                  </Button>
                  <Button
                    onClick={() => {
                      setDetail(null);
                      navigate("chat");
                    }}
                  >
                    前往 AI 对话
                  </Button>
                </>
              ) : (
                actions(detail)
              )}
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}
