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
}: {
  service?: ModelService;
  departments: Department[];
  close: () => void;
  saved: () => Promise<void>;
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
    service?.models ?? [],
  );
  const [available, setAvailable] = useState<string[]>(
    service?.models.map((m) => m.model) ?? [],
  );
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [kind, setKind] = useState<"chat" | "image">("chat");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
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
      !baseUrl.trim() ||
      (!key.trim() && (!service || service.baseUrl !== baseUrl))
    ) {
      setError("请先填写服务地址和 API 密钥。");
      return;
    }
    setBusy("discover");
    setError("");
    setStatus("");
    try {
      const result = await api<{ models: string[] }>(
        "/model-services/discover",
        settings(),
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
      title={service ? `管理模型 · ${service.name}` : "自定义配置 · 模型连接"}
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
          void api("/model-services", {
            ...settings(),
            departments: scope,
            models: selected,
          })
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
          <div className="provider-picker" role="group" aria-label="选择服务商">
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
          <div className="model-catalog-heading">
            <div>
              <strong>开放模型</strong>
              <p className="muted">
                一次选择多个，员工可在对话中切换。刷新列表会保留当前选择。
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
                          { value: "image", label: "图片" },
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
                { value: "image", label: "图片" },
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
          <p className="muted model-service-help">
            官方选项使用各服务商的 OpenAI
            兼容接口。模型列表与可调用权限以所填密钥为准；图片用途需要支持
            images/generations 的服务。获取列表不会发起内容生成。
          </p>
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
}: {
  departments: Department[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  revision: unknown;
}) {
  const [services, setServices] = useState<ModelService[]>([]);
  const [editing, setEditing] = useState<ModelService>();
  const [error, setError] = useState("");
  async function load() {
    try {
      setServices(await api<ModelService[]>("/model-services"));
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
                    {m.model}
                  </span>
                ))}
              </div>
              <small>
                {s.departments.length
                  ? s.departments
                      .map(
                        (id) =>
                          departments.find((d) => d.id === id)?.name ?? id,
                      )
                      .join("、")
                  : "全公司可用"}{" "}
                · 密钥已保护保存
              </small>
            </div>
            <span className={`status ${s.models.length ? "good" : ""}`}>
              {s.models.length ? "已启用" : "未开放模型"}
            </span>
            <Button onClick={() => setEditing(s)}>管理模型</Button>
          </div>
        ))}
      </div>
      {editing && (
        <ModelServiceDialog
          service={editing}
          departments={departments}
          close={() => setEditing(undefined)}
          saved={async () => {
            await refresh();
            await load();
            notify("模型配置已保存，员工可在对话中选择已授权的模型。");
          }}
        />
      )}
    </>
  );
}
