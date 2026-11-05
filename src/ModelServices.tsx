import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, Plug, Plus } from "@phosphor-icons/react";
import type { Department } from "../shared/types";
import {
  modelProviders,
  type ModelService,
  type ModelProviderId,
  type ServiceModel,
} from "../shared/model-services";
import { api } from "./api";
import { Button, Field, Modal, Search } from "./components";
import { SelectField } from "./Dropdown";

export function ModelServiceDialog({
  service,
  departments,
  close,
  saved,
  personal = false,
  catalog,
}: {
  service?: ModelService;
  departments: Department[];
  close: () => void;
  saved: () => Promise<void>;
  personal?: boolean;
  catalog?: ModelService;
}) {
  const [provider, setProvider] = useState<ModelProviderId>(
    service?.provider ?? "linoroute",
  );
  const preset = modelProviders.find((p) => p.id === provider)!;
  const [name, setName] = useState(service?.name ?? "LinoRoute");
  const [baseUrl, setBaseUrl] = useState(service?.baseUrl ?? preset.baseUrl);
  const [key, setKey] = useState("");
  const [scope, setScope] = useState(service?.departments ?? []);
  const [selected, setSelected] = useState<ServiceModel[]>(
    (catalog ?? service)?.models ?? [],
  );
  const [available, setAvailable] = useState<string[]>(
    (catalog ?? service)?.models.map((m) => m.model) ?? [],
  );
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [kind, setKind] = useState<"chat" | "image">("chat");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const alive = useRef(true);
  const endpoint = personal ? "/my-model-services" : "/model-services";
  useEffect(() => {
    alive.current = true;
    const timer = catalog ? setTimeout(() => void discover(), 0) : undefined;
    return () => {
      clearTimeout(timer);
      alive.current = false;
    };
  }, []);
  function choose(id: ModelProviderId) {
    const p = modelProviders.find((p) => p.id === id)!;
    setProvider(id);
    setName(p.name);
    setBaseUrl(p.baseUrl);
    setKey("");
    setAvailable([]);
    setSelected([]);
    setError("");
    setStatus("");
    setQuery("");
  }
  function settings() {
    return {
      provider,
      name,
      baseUrl,
      ...(key.trim() ? { apiKey: key.trim() } : {}),
      ...(service ? { serviceId: service.id } : {}),
    };
  }
  async function discover() {
    if (
      !catalog &&
      (!baseUrl.trim() ||
        (!key.trim() && (!service || service.baseUrl !== baseUrl)))
    ) {
      setError("请先填写服务地址和 API 密钥。");
      return;
    }
    setBusy("discover");
    setError("");
    setStatus("");
    try {
      const result = await api<{ models: string[] }>(
        catalog
          ? `/company-model-catalogs/${catalog.id}/discover`
          : endpoint + "/discover",
        catalog ? {} : settings(),
        undefined,
        25000,
      );
      if (!alive.current) return;
      setAvailable([
        ...new Set([...result.models, ...selected.map((m) => m.model)]),
      ]);
      setStatus(
        result.models.length
          ? `已获取 ${result.models.length} 个模型，请勾选需要开放的模型。`
          : "该服务未返回可用模型，可手动添加模型标识。",
      );
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy("");
    }
  }
  function toggle(model: string) {
    setSelected((items) =>
      items.some((m) => m.model === model)
        ? items.filter((m) => m.model !== model)
        : [...items, { model, kind: "chat" }],
    );
  }
  const shown = available.filter((id) =>
    id.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Modal
      wide
      title={
        catalog
          ? `选择模型 · ${catalog.name}`
          : service
            ? `管理模型 · ${service.name}`
            : personal
              ? "自定义配置 · 仅自己可用"
              : "自定义配置 · 模型连接"
      }
      close={() => {
        if (busy !== "save") close();
      }}
    >
      <form
        className="model-service-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy("save");
          setError("");
          void api(
            catalog
              ? `/company-model-catalogs/${catalog.id}/selection`
              : endpoint,
            catalog
              ? { models: selected }
              : {
                  ...settings(),
                  ...(personal ? {} : { departments: scope }),
                  models: selected,
                },
          )
            .then(async () => {
              await saved();
              if (alive.current) close();
            })
            .catch((e) => {
              if (alive.current) setError((e as Error).message);
            })
            .finally(() => {
              if (alive.current) setBusy("");
            });
        }}
      >
        <fieldset disabled={Boolean(busy)} className="model-service-fields">
          <legend className="sr-only">模型服务配置</legend>
          {!catalog && (
            <>
              <div
                className="provider-picker"
                role="group"
                aria-label="选择服务商"
              >
                {modelProviders.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    aria-pressed={provider === p.id}
                    className={`provider-option ${provider === p.id ? "selected" : ""}`}
                    onClick={() => choose(p.id)}
                  >
                    <strong>
                      {p.name}
                      {p.id === "linoroute" && (
                        <span className="provider-recommended">推荐</span>
                      )}
                    </strong>
                    <small>{p.hint}</small>
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <Field label="连接名称">
                  <input
                    name="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={120}
                  />
                </Field>
                <Field label="API 密钥">
                  <input
                    name="apiKey"
                    type="password"
                    autoComplete="new-password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    required={!service || baseUrl !== service.baseUrl}
                    maxLength={1000}
                    placeholder={
                      service
                        ? "已安全保存，留空保留原密钥"
                        : "输入所选服务商的密钥"
                    }
                  />
                </Field>
              </div>
              <Field label="服务地址（包括 API 前缀）">
                <input
                  name="baseUrl"
                  type="url"
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setStatus("");
                  }}
                  required
                  maxLength={300}
                  placeholder="https://api.example.com/v1"
                />
              </Field>
            </>
          )}
          {catalog && (
            <p className="notice">
              {catalog.name} · {catalog.baseUrl}
              <br />
              使用公司已授权的 LinoRoute
              服务，所选模型仅加入你的账号。公司密钥不会显示或复制到客户端；实际可调用范围以服务商套餐为准。
            </p>
          )}
          <div className="model-catalog-heading">
            <div>
              <strong>{personal ? "选用模型" : "开放模型"}</strong>
              <p className="muted">
                {personal
                  ? "一次选择多个，在你的对话中切换。配置仅自己可用。"
                  : "一次选择多个，员工可在对话中切换。"}
                刷新列表会保留当前选择。
              </p>
            </div>
            <Button onClick={() => void discover()} disabled={Boolean(busy)}>
              <ArrowsClockwise
                size={17}
                className={busy === "discover" ? "spin" : ""}
              />
              {busy === "discover" ? "正在获取…" : "获取 / 刷新模型"}
            </Button>
          </div>
          <Search
            value={query}
            onChange={setQuery}
            placeholder="搜索模型标识"
          />
          {available.length > 0 && (
            <div className="model-catalog-actions">
              <span>已选 {selected.length} 个</span>
              <Button
                onClick={() =>
                  setSelected((items) => [
                    ...items,
                    ...shown
                      .filter((id) => !items.some((m) => m.model === id))
                      .slice(0, 200 - items.length)
                      .map((model) => ({ model, kind: "chat" as const })),
                  ])
                }
                disabled={Boolean(busy) || selected.length >= 200}
              >
                全选搜索结果
              </Button>
              <Button
                onClick={() => setSelected([])}
                disabled={Boolean(busy) || !selected.length}
              >
                清空选择
              </Button>
            </div>
          )}
          <div className="model-catalog" aria-label="可选模型">
            {shown.length ? (
              shown.map((id) => {
                const item = selected.find((m) => m.model === id);
                return (
                  <div key={id} className="model-catalog-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(item)}
                        onChange={() => toggle(id)}
                        disabled={Boolean(busy)}
                      />
                      <span>{id}</span>
                    </label>
                    {item && (
                      <SelectField
                        label={`${id} 的用途`}
                        value={item.kind}
                        options={[
                          { value: "chat", label: "对话" },
                          { value: "image", label: "图片生成技能" },
                        ]}
                        onValueChange={(value) =>
                          setSelected((items) =>
                            items.map((m) =>
                              m.model === id
                                ? { ...m, kind: value as "chat" | "image" }
                                : m,
                            ),
                          )
                        }
                      />
                    )}
                  </div>
                );
              })
            ) : (
              <p className="muted">
                {available.length
                  ? "没有匹配的模型。"
                  : "填写密钥后获取模型列表，或在下方手动添加。"}
              </p>
            )}
          </div>
          {!catalog && (
            <div className="model-manual-row">
              <input
                aria-label="手动添加模型标识"
                value={manual}
                maxLength={120}
                placeholder="手动添加服务实际支持的模型 ID"
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
              <SelectField
                label="手动模型用途"
                value={kind}
                onValueChange={(value) => setKind(value as "chat" | "image")}
                options={[
                  { value: "chat", label: "对话" },
                  { value: "image", label: "图片生成技能" },
                ]}
              />
              <Button
                disabled={!manual.trim() || Boolean(busy)}
                onClick={() => {
                  const model = manual.trim();
                  setAvailable((items) => [...new Set([...items, model])]);
                  setSelected((items) => [
                    ...items.filter((m) => m.model !== model),
                    { model, kind },
                  ]);
                  setManual("");
                  setQuery("");
                }}
              >
                <Plus size={16} />
                添加
              </Button>
            </div>
          )}
          <p className="muted model-service-help">
            官方选项使用各服务商的 OpenAI
            兼容接口。模型列表与可调用权限以所填密钥为准；图片生成技能需要支持
            images/generations 并返回 base64
            图片。配置后自动加入{personal ? "个人" : "公司"}技能，在对话中按需调用。获取列表不会发起内容生成。
          </p>
          {!personal && (
            <Field label="允许使用的部门（不选表示全公司）">
              <div className="source-list">
                {departments
                  .filter((d) => d.enabled)
                  .map((d) => (
                    <label className="checkbox-row" key={d.id}>
                      <input
                        type="checkbox"
                        name="departments"
                        value={d.id}
                        checked={scope.includes(d.id)}
                        onChange={(e) =>
                          setScope((ids) =>
                            e.target.checked
                              ? [...ids, d.id]
                              : ids.filter((id) => id !== d.id),
                          )
                        }
                      />
                      <span>{d.name}</span>
                    </label>
                  ))}
              </div>
            </Field>
          )}
          {personal && (
            <p className="muted">
              仅自己可用。无法分享连接或设置部门授权。
              {!catalog &&
                "个人密钥加密保存在公司服务器，仅用于你的请求；更换服务地址需重新填写密钥。个人服务需使用公网 HTTPS 地址。"}
            </p>
          )}
        </fieldset>
        {status && (
          <p role="status" className="muted">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer>
          <span className="muted">
            {selected.length
              ? `将开放 ${selected.length} 个模型`
              : service
                ? "保存后将停用该服务的全部模型"
                : "请至少选择一个模型"}
          </span>
          <Button onClick={close} disabled={busy === "save"}>
            取消
          </Button>
          <Button
            primary
            type="submit"
            disabled={
              Boolean(busy) ||
              (!service && !selected.length) ||
              selected.length > 200
            }
          >
            {busy === "save" ? "正在保存…" : "保存配置"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

export function ModelServiceCards({
  departments,
  refresh,
  notify,
  revision,
  personal = false,
}: {
  departments: Department[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  revision: unknown;
  personal?: boolean;
}) {
  const [services, setServices] = useState<ModelService[]>([]);
  const [editing, setEditing] = useState<ModelService>();
  const [error, setError] = useState("");
  async function load() {
    try {
      setServices(
        await api<ModelService[]>(
          personal ? "/my-model-services" : "/model-services",
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [revision]);
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
          <Button onClick={() => void load()}>重试</Button>
        </p>
      )}
      <div className="connection-list model-service-list">
        {services.map((s) => (
          <div className="connection-card" key={s.id}>
            <span className="card-icon">
              <Plug size={24} />
            </span>
            <div>
              <h3>
                {s.name}
                {s.provider === "linoroute" && (
                  <span className="provider-recommended">推荐</span>
                )}
                <span className="badge">{s.models.length} 个模型</span>
              </h3>
              <p>{s.baseUrl}</p>
              <div className="service-model-tags">
                {s.models.map((m) => (
                  <span className="badge" key={m.kind + m.model}>
                    {m.kind === "image" ? "图片技能 · " : ""}
                    {m.model}
                  </span>
                ))}
              </div>
              <small>
                {personal
                  ? "仅自己可用"
                  : s.departments.length
                    ? s.departments
                        .map(
                          (id) =>
                            departments.find((d) => d.id === id)?.name ?? id,
                        )
                        .join("、")
                    : "全公司可用"}{" "}
                ·{" "}
                {s.sourceServiceId
                  ? "使用公司服务，无需填写密钥"
                  : "密钥已保护保存"}
              </small>
            </div>
            <span className={`status ${s.models.length ? "good" : ""}`}>
              {s.models.length ? "已启用" : "未开放模型"}
            </span>
            <Button onClick={() => setEditing(s)}>管理模型</Button>
            {personal && (
              <Button
                onClick={() => {
                  void api(`/my-model-services/${s.id}`, {}, "DELETE")
                    .then(async () => {
                      await refresh();
                      await load();
                      notify("已移除个人连接，历史对话保留。");
                    })
                    .catch((e) => notify(e.message));
                }}
              >
                移除连接
              </Button>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <ModelServiceDialog
          service={editing.sourceServiceId ? undefined : editing}
          personal={personal}
          catalog={
            editing.sourceServiceId
              ? { ...editing, id: editing.sourceServiceId }
              : undefined
          }
          departments={departments}
          close={() => setEditing(undefined)}
          saved={async () => {
            await refresh();
            await load();
            notify(personal ? "个人模型已保存，可在对话中选择。" : "模型配置已保存，员工可在对话中选择已授权的模型。");
          }}
        />
      )}
    </>
  );
}

export function EmployeeModelServices({
  refresh,
  notify,
  revision,
}: {
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  revision: unknown;
}) {
  const [creating, setCreating] = useState(false),
    [catalogs, setCatalogs] = useState<ModelService[]>([]),
    [catalog, setCatalog] = useState<ModelService>(),
    [error, setError] = useState("");
  async function load() {
    try {
      setCatalogs(await api<ModelService[]>("/company-model-catalogs"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [revision]);
  const saved = async () => {
    await refresh();
    await load();
    notify(
      "个人模型已保存，可在对话中选择；图片模型会自动成为仅自己可用的图片技能。",
    );
  };
  return (
    <section className="personal-model-services">
      <div className="toolbar">
        <strong>我的模型连接</strong>
        <span className="bar-spacer" />
        <Button primary onClick={() => setCreating(true)}>
          <Plus size={18} />
          自定义配置
        </Button>
      </div>
      <p className="muted">
        自行添加官方 API 或中转服务，仅自己可用。也可从公司授权的 LinoRoute
        模型库选择更多模型。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
          <Button onClick={() => void load()}>重试</Button>
        </p>
      )}
      <ModelServiceCards
        personal
        departments={[]}
        refresh={refresh}
        notify={notify}
        revision={revision}
      />
      {catalogs.map((source) => (
        <div className="connection-card company-model-catalog" key={source.id}>
          <span className="card-icon">
            <Plug size={24} />
          </span>
          <div>
            <h3>
              {source.name}
              <span className="provider-recommended">推荐</span>
            </h3>
            <p>
              公司授权模型库 ·
              浏览服务商返回的完整列表，搜索并多选，仅改变自己的模型选择。
            </p>
          </div>
          <Button onClick={() => setCatalog(source)}>浏览 / 选择模型</Button>
        </div>
      ))}
      {creating && (
        <ModelServiceDialog
          personal
          departments={[]}
          close={() => setCreating(false)}
          saved={saved}
        />
      )}
      {catalog && (
        <ModelServiceDialog
          personal
          catalog={catalog}
          departments={[]}
          close={() => setCatalog(undefined)}
          saved={saved}
        />
      )}
    </section>
  );
}
