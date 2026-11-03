import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowClockwise,
  Folder,
  File,
  HardDrives,
  Plus,
  ShieldCheck,
} from "@phosphor-icons/react";
import type { Department } from "../shared/types";
import type {
  NasAdminSource,
  NasEntry,
  NasListing,
  NasSource,
} from "../shared/nas";
import { api } from "./api";
import { Button, Busy, Empty, Field, Modal, Search } from "./components";
import "./knowledge.css";

const sizeText = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(1)} KB`
      : bytes < 1024 ** 3
        ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
        : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const dateText = (value: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : "—";
export default function Knowledge({
  admin,
  navigate,
}: {
  admin: boolean;
  navigate: (page: string) => void;
}) {
  const [sources, setSources] = useState<NasSource[]>([]),
    [source, setSource] = useState<NasSource | null>(null);
  const [path, setPath] = useState(""),
    [search, setSearch] = useState(""),
    [listing, setListing] = useState<NasListing | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<NasEntry | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    void loadSources();
    return () => {
      sequence.current++;
    };
  }, []);
  async function loadSources() {
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    setListing(null);
    setSource(null);
    setPath("");
    setSearch("");
    try {
      const result = await api<NasSource[]>("/knowledge/sources");
      if (request === sequence.current) setSources(result);
    } catch (e) {
      if (request === sequence.current) setError((e as Error).message);
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  async function open(s: NasSource, p = "", q = "") {
    const request = ++sequence.current;
    setSource(s);
    setPath(p);
    setSearch(q);
    setListing(null);
    setError("");
    setBusy(true);
    try {
      const result = await api<NasListing>(
        `/knowledge/sources/${s.id}/files?${new URLSearchParams({ path: p, search: q })}`,
        undefined,
        undefined,
        22000,
      );
      if (request === sequence.current) setListing(result);
    } catch (e) {
      if (request === sequence.current) setError((e as Error).message);
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  const entries = [...(listing?.entries ?? [])].sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) ||
      a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
  );
  return (
    <div className="knowledge-browser">
      <div className="knowledge-scope">
        <ShieldCheck size={18} />
        <span>
          只显示你所在部门获准的资料。当前开放目录浏览，文件内容不会发送给 AI。
        </span>
      </div>
      <div className="knowledge-toolbar">
        <nav aria-label="资料目录" className="knowledge-breadcrumbs">
          <button disabled={busy} onClick={() => void loadSources()}>
            公司资料
          </button>
          {source && (
            <>
              <span>/</span>
              <button disabled={busy} onClick={() => void open(source)}>
                {source.name}
              </button>
            </>
          )}
          {source &&
            path
              .split("/")
              .filter(Boolean)
              .map((part, i, all) => (
                <span key={i} className="knowledge-crumb">
                  <span>/</span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void open(source, all.slice(0, i + 1).join("/"))
                    }
                  >
                    {part}
                  </button>
                </span>
              ))}
        </nav>
        <Button
          disabled={busy}
          onClick={() =>
            source ? void open(source, path, search) : void loadSources()
          }
        >
          <ArrowClockwise size={17} />
          刷新
        </Button>
      </div>
      {source && (
        <form
          className="knowledge-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void open(source, path, search);
          }}
        >
          <Button
            disabled={busy}
            onClick={() =>
              path
                ? void open(source, path.split("/").slice(0, -1).join("/"))
                : void loadSources()
            }
          >
            <ArrowLeft size={16} />
            上一级
          </Button>
          <Search
            value={search}
            onChange={setSearch}
            placeholder="搜索当前目录的名称"
          />
          <Button type="submit" disabled={busy}>
            搜索
          </Button>
        </form>
      )}
      {busy && (
        <div className="knowledge-loading" role="status">
          <Busy />
          正在读取{source ? "目录" : "资料源"}…
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          <span>{error}</span>
          <Button
            onClick={() =>
              source ? void open(source, path, search) : void loadSources()
            }
          >
            重试
          </Button>
        </div>
      )}
      {!busy &&
        !error &&
        !source &&
        (sources.length ? (
          <div className="knowledge-sources">
            {sources.map((s) => (
              <button
                className="knowledge-source"
                key={s.id}
                onClick={() => void open(s)}
              >
                <HardDrives size={28} />
                <strong>{s.name}</strong>
                <span>部门资料 · 只读浏览</span>
                <span className="muted">打开目录 →</span>
              </button>
            ))}
          </div>
        ) : (
          <Empty
            icon={<HardDrives size={32} />}
            title="暂无获准的资料源"
            detail="请管理员确认你的部门归属，并启用对应的 NAS 资料源。"
            action={
              admin ? (
                <Button onClick={() => navigate("admin-knowledge")}>
                  管理资料源
                </Button>
              ) : undefined
            }
          />
        ))}
      {!busy && listing && (
        <>
          <div className="knowledge-count">
            {entries.length} 项
            {listing.truncated
              ? " · 当前仅展示前 500 项，请按名称搜索缩小范围"
              : ""}
          </div>
          {entries.length ? (
            <div className="table-scroll knowledge-files">
              <table>
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>类型</th>
                    <th>大小</th>
                    <th>修改时间</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.name}>
                      <td>
                        <button
                          className="knowledge-entry"
                          disabled={entry.blocked}
                          title={
                            entry.blocked
                              ? "链接或特殊路径暂不支持打开"
                              : entry.name
                          }
                          onClick={() =>
                            entry.directory
                              ? void open(
                                  source!,
                                  [path, entry.name].filter(Boolean).join("/"),
                                )
                              : setDetail(entry)
                          }
                        >
                          {entry.directory ? (
                            <Folder size={21} weight="duotone" />
                          ) : (
                            <File size={21} />
                          )}
                          <span>{entry.name}</span>
                        </button>
                      </td>
                      <td>
                        {entry.blocked
                          ? "链接 / 受限项"
                          : entry.directory
                            ? "文件夹"
                            : "文件"}
                      </td>
                      <td>{entry.directory ? "—" : sizeText(entry.bytes)}</td>
                      <td>{dateText(entry.modified)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={<Folder size={30} />}
              title={search ? "没有匹配的项目" : "这个目录是空的"}
              detail={
                search
                  ? "尝试其他名称关键词；搜索范围为当前目录。"
                  : "可返回上一级或刷新目录。"
              }
            />
          )}
        </>
      )}
      {detail && (
        <Modal title="文件信息" close={() => setDetail(null)}>
          <div className="knowledge-file-info">
            <File size={30} />
            <h3>{detail.name}</h3>
            <p>大小：{sizeText(detail.bytes)}</p>
            <p>修改时间：{dateText(detail.modified)}</p>
            <p className="muted">
              当前开放目录和文件信息浏览，尚未开放内容预览、下载或 AI 读取。
            </p>
          </div>
          <footer>
            <Button onClick={() => setDetail(null)}>关闭</Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

export function KnowledgeAdmin({
  departments,
  notify,
}: {
  departments: Department[];
  notify: (message: string) => void;
}) {
  const [sources, setSources] = useState<NasAdminSource[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [editing, setEditing] = useState<NasAdminSource | null | undefined>(
      undefined,
    ),
    [saving, setSaving] = useState(false),
    [testing, setTesting] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [formError, setFormError] = useState("");
  useEffect(() => {
    void load();
  }, []);
  async function load() {
    setLoading(true);
    setError("");
    try {
      setSources(await api("/admin/knowledge"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  function edit(source: NasAdminSource | null) {
    setEditing(source);
    setSelected(source?.departmentIds ?? []);
    setFormError("");
  }
  async function test(source: NasAdminSource) {
    setTesting(source.id);
    setError("");
    let failure = "";
    try {
      await api(`/admin/knowledge/${source.id}/test`, {}, "POST", 22000);
      notify("连接成功，账号可浏览配置的根目录");
    } catch (e) {
      failure = (e as Error).message;
    } finally {
      setTesting("");
      await load();
      if (failure) setError(failure);
    }
  }
  return (
    <div className="knowledge-admin">
      <div className="knowledge-scope">
        <ShieldCheck size={20} />
        <span>
          NAS
          账号决定可读范围，部门授权进一步限制员工访问。管理员可维护配置，浏览资料仍需所属部门获得授权。
        </span>
      </div>
      <div className="toolbar">
        <Button primary onClick={() => edit(null)}>
          <Plus size={17} />
          添加资料源
        </Button>
        <Button disabled={loading} onClick={() => void load()}>
          刷新
        </Button>
        <span className="muted">密码仅加密保存在公司服务器</span>
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {loading ? (
        <div className="knowledge-loading">
          <Busy />
          正在读取资料源…
        </div>
      ) : sources.length ? (
        <div className="table-scroll">
          <table className="knowledge-admin-table">
            <thead>
              <tr>
                <th>资料源 / 共享目录</th>
                <th>授权部门</th>
                <th>开放状态</th>
                <th>连接检查</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <small>
                      {s.share}
                      {s.basePath ? " / " + s.basePath : ""}
                    </small>
                  </td>
                  <td>
                    {s.departmentIds
                      .map(
                        (id) =>
                          departments.find((d) => d.id === id)?.name ??
                          "已移除部门",
                      )
                      .join("、")}
                  </td>
                  <td>
                    <span className={`status ${s.enabled ? "good" : ""}`}>
                      {s.enabled ? "已启用" : "已停用"}
                    </span>
                  </td>
                  <td>
                    <span>
                      {s.status === "connected"
                        ? "连接正常"
                        : s.status === "error"
                          ? s.statusMessage
                          : "待检查"}
                    </span>
                    <small>{dateText(s.lastChecked)}</small>
                  </td>
                  <td>
                    <div className="inline-actions">
                      <Button disabled={!!testing} onClick={() => void test(s)}>
                        {testing === s.id ? "检查中…" : "检查连接"}
                      </Button>
                      <Button onClick={() => edit(s)}>配置</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon={<HardDrives size={30} />}
          title="尚未添加资料源"
          detail="为各部门配置各自的 NAS 账号与共享目录。"
        />
      )}
      {editing !== undefined && (
        <Modal
          title={editing ? "配置 NAS 资料源" : "添加 NAS 资料源"}
          close={() => {
            if (!saving) setEditing(undefined);
          }}
          wide
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (saving) return;
              const data = new FormData(e.currentTarget);
              setSaving(true);
              setFormError("");
              try {
                await api(
                  editing
                    ? `/admin/knowledge/${editing.id}`
                    : "/admin/knowledge",
                  {
                    name: String(data.get("name")),
                    host: String(data.get("host")),
                    share: String(data.get("share")),
                    basePath: String(data.get("basePath")),
                    username: String(data.get("username")),
                    domain: String(data.get("domain")),
                    password: String(data.get("password")),
                    departmentIds: selected,
                    enabled: data.has("enabled"),
                    ...(editing ? { revision: editing.revision } : {}),
                  },
                  editing ? "PATCH" : "POST",
                );
                setEditing(undefined);
                notify("资料源已保存");
                await load();
              } catch (e) {
                setFormError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <div className="knowledge-form">
              <Field label="显示名称">
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={editing?.name}
                />
              </Field>
              <Field label="NAS 内网 IP">
                <input
                  name="host"
                  required
                  placeholder="192.168.1.10"
                  defaultValue={editing?.host}
                />
              </Field>
              <Field label="共享目录">
                <input
                  name="share"
                  required
                  maxLength={255}
                  defaultValue={editing?.share}
                />
              </Field>
              <Field label="共享内子目录（可选）">
                <input
                  name="basePath"
                  placeholder="例如：部门资料/公开"
                  defaultValue={editing?.basePath}
                />
              </Field>
              <Field label="NAS 账号">
                <input
                  name="username"
                  required
                  autoComplete="off"
                  defaultValue={editing?.username}
                />
              </Field>
              <Field label="域或工作组（可选）">
                <input name="domain" defaultValue={editing?.domain} />
              </Field>
              <Field label={editing ? "NAS 密码（留空保持原值）" : "NAS 密码"}>
                <input
                  name="password"
                  type="password"
                  required={!editing}
                  autoComplete="new-password"
                  maxLength={1024}
                />
              </Field>
            </div>
            <fieldset className="knowledge-departments">
              <legend>允许浏览的部门</legend>
              {departments
                .filter((d) => d.enabled)
                .map((d) => (
                  <label key={d.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, d.id]
                            : selected.filter((id) => id !== d.id),
                        )
                      }
                    />
                    {d.name}
                  </label>
                ))}
            </fieldset>
            <label className="knowledge-enable">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={editing?.enabled ?? false}
              />
              启用资料源，向选中的部门开放只读目录浏览
            </label>
            <p className="muted">
              保存后请检查连接。NAS 需支持 SMB 3 加密；目录浏览不会修改 NAS
              文件，也不会发送资料给模型。
            </p>
            {formError && (
              <p role="alert" className="error">
                {formError}
              </p>
            )}
            <footer>
              <Button disabled={saving} onClick={() => setEditing(undefined)}>
                取消
              </Button>
              <Button
                primary
                type="submit"
                disabled={saving || !selected.length}
              >
                {saving ? "保存中…" : "保存"}
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  );
}
