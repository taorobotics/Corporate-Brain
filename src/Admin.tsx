import { useEffect, useState } from "react";
import {
  Plus,
  UsersThree,
  Buildings,
  DownloadSimple,
  Key,
  PaperPlaneTilt,
  CheckCircle,
  XCircle,
  Sparkle,
  Plug,
  BookOpen,
  ShieldCheck,
  ArrowRight,
  PencilSimple,
  Copy,
} from "@phosphor-icons/react";
import type { WorkspaceProps } from "./App";
import type {
  User,
  Role,
  Skill,
  Department,
  Connection,
} from "../shared/types";
import { roleNames } from "../shared/types";
import { api, download } from "./api";
import { Button, Empty, Field, Modal, Search, Busy } from "./components";
import { SelectField } from "./Dropdown";
import { SkillSourceDetails } from "./SkillImport";
import FeedbackAdmin from "./FeedbackAdmin";
import { KnowledgeAdmin } from "./Knowledge";
import { GenerateAccounts, AccountPassword, AccountNote } from "./AccountTools";
import { ModelServiceCards, ModelServiceDialog } from "./ModelServices";
const statusNames = {
  pending: "待审核",
  published: "已发布",
  rejected: "退回修改",
  disabled: "已停用",
};
export default function Admin(props: WorkspaceProps) {
  const { user, departments, connections, refresh, notify, page } = props;
  const [users, setUsers] = useState<User[]>([]),
    [reviews, setReviews] = useState<Skill[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("users"),
    [search, setSearch] = useState(""),
    [departmentFilter, setDepartmentFilter] = useState(""),
    [statusFilter, setStatusFilter] = useState("");
  const [dialog, setDialog] = useState(""),
    [targetUser, setTargetUser] = useState<User | null>(null),
    [targetDepartment, setTargetDepartment] = useState<Department | null>(null),
    [targetSkill, setTargetSkill] = useState<Skill | null>(null);
  const [credentials, setCredentials] = useState<
      { user: User; initialPassword: string }[]
    >([]),
    [batchText, setBatchText] = useState(""),
    [batchDepartment, setBatchDepartment] = useState(user.departmentId);
  const companyAdmin = user.role === "company_admin";
  const accountAdmin = companyAdmin || user.role === "department_admin";
  async function load() {
    setError("");
    try {
      await refresh();
      if (page === "admin-users" && accountAdmin) setUsers(await api("/users"));
      if (page === "admin-skills") setReviews(await api("/reviews"));
      if (page === "admin-audit" && companyAdmin) setAudit(await api("/audit"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setSearch("");
    setDepartmentFilter("");
    setStatusFilter("");
    void load();
  }, [page]);
  useEffect(() => {
    if (dialog !== "connection") return;
    // The dialog may be opened after another administrator changed the
    // department list. Pull the latest authorization choices before render.
    void refresh().catch((e) => setError((e as Error).message));
  }, [dialog]);
  const filteredUsers = users.filter(
    (u) =>
      `${u.name} ${u.username} ${u.accountNote ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!departmentFilter || u.departmentId === departmentFilter) &&
      (!statusFilter || String(u.enabled) === statusFilter),
  );
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const newUser = () => {
    setTargetUser(null);
    setDialog("user");
  };
  const openDepartment = (d?: Department) => {
    setTargetDepartment(d ?? null);
    setDialog("department");
  };
  const batchRows = batchText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [username, name] = line.split(/[,，\t]/).map((s) => s.trim());
      return {
        username: username ?? "",
        name: name ?? "",
        departmentId: batchDepartment,
        role: "employee" as Role,
      };
    });
  function exportUsers() {
    download(
      "员工账号清单.csv",
      "\uFEFF姓名,登录账号,部门,角色,状态,分发状态,备注\r\n" +
        filteredUsers
          .map((u) =>
            [
              u.name,
              u.username,
              u.departmentName,
              roleNames[u.role],
              u.enabled ? "启用" : "停用",
              u.distributed ? "已分发" : "待分发",
              u.accountNote ?? "",
            ]
              .map(
                (x) =>
                  `"${String(x)
                    .replace(/"/g, '""')
                    .replace(/^\s*[=+\-@]/, "'$&")}"`,
              )
              .join(","),
          )
          .join("\r\n"),
      "text/csv;charset=utf-8",
    );
  }
  const headers: Record<string, [string, string]> = {
    "admin-users": [
      "部门与员工账号",
      "按部门建立员工账号，管理成员、角色与访问范围。",
    ],
    "admin-models": ["模型与服务", "配置公司提供的模型连接，按部门授权使用。"],
    "admin-knowledge": ["公司知识", "维护公司资料来源、NAS 接入与部门权限。"],
    "admin-skills": ["技能发布", "审核可复用流程，按部门或公司范围发布。"],
    "admin-audit": ["操作记录", "查看账号、部门与技能的操作元数据。"],
    "admin-feedback": ["用户反馈", "汇总界面、对话与回答反馈，跟踪处理进展。"],
  };
  return (
    <div className="page admin-page">
      <header className="page-header">
        <div>
          <h1>{headers[page]?.[0] ?? "管理后台"}</h1>
          <p>{headers[page]?.[1]}</p>
        </div>
        {page === "admin-users" && accountAdmin && (
          <div className="inline-actions">
            {companyAdmin && (
              <GenerateAccounts
                departments={departments}
                refresh={load}
                notify={notify}
              />
            )}
            <Button onClick={() => setDialog("batch")}>批量开通</Button>
            <Button
              primary
              onClick={tab === "departments" ? () => openDepartment() : newUser}
            >
              <Plus size={19} />
              {tab === "departments" ? "建立部门" : "添加员工"}
            </Button>
          </div>
        )}
        {page === "admin-models" && companyAdmin && (
          <Button primary onClick={() => setDialog("connection")}>
            <Plus size={19} />
            自定义配置
          </Button>
        )}
      </header>
      {error && (
        <div role="alert" className="error notice">
          {error}
          <Button onClick={() => void load()}>重试</Button>
        </div>
      )}
      {page === "admin-feedback" &&
        (companyAdmin ? (
          <FeedbackAdmin notify={notify} />
        ) : (
          <p>需要公司管理员权限。</p>
        ))}
      {page === "admin-users" &&
        (accountAdmin ? (
          <>
            <div className="tabs">
              <button
                className={tab === "users" ? "active" : ""}
                onClick={() => setTab("users")}
              >
                员工
              </button>
              <button
                className={tab === "departments" ? "active" : ""}
                onClick={() => setTab("departments")}
              >
                部门
              </button>
              <span className="tab-note">
                {companyAdmin
                  ? "公司管理范围"
                  : `${user.departmentName}管理范围`}
              </span>
            </div>
            {tab === "users" ? (
              <>
                <div className="toolbar">
                  <Search
                    value={search}
                    onChange={setSearch}
                    placeholder="姓名、登录账号或备注"
                  />
                  <SelectField
                    label="筛选部门"
                    icon={<Buildings size={17} />}
                    value={departmentFilter}
                    onValueChange={setDepartmentFilter}
                    options={[
                      { value: "", label: "全部获准部门" },
                      ...departments
                        .filter(
                          (d) => companyAdmin || d.id === user.departmentId,
                        )
                        .map((d) => ({ value: d.id, label: d.name })),
                    ]}
                  />
                  <SelectField
                    label="筛选状态"
                    value={statusFilter}
                    onValueChange={setStatusFilter}
                    options={[
                      { value: "", label: "全部状态" },
                      {
                        value: "1",
                        label: "已启用",
                        icon: <CheckCircle size={17} />,
                      },
                      {
                        value: "0",
                        label: "已停用",
                        icon: <XCircle size={17} />,
                      },
                    ]}
                  />
                  <Button onClick={exportUsers}>
                    <DownloadSimple size={17} />
                    导出清单
                  </Button>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>姓名</th>
                        <th>登录账号</th>
                        <th>部门</th>
                        <th>备注</th>
                        <th>角色</th>
                        <th>状态</th>
                        <th>分发</th>
                        {companyAdmin && <th>当前密码</th>}
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <strong>{u.name}</strong>
                          </td>
                          <td className="muted">{u.username}</td>
                          <td>{u.departmentName}</td>
                          <td>
                            <AccountNote
                              user={u}
                              canEdit={companyAdmin || u.role === "employee"}
                              refresh={load}
                              notify={notify}
                            />
                          </td>
                          <td>
                            <span className="badge">{roleNames[u.role]}</span>
                          </td>
                          <td>
                            <span
                              className={`status ${u.enabled ? "good" : ""}`}
                            >
                              {u.enabled ? "已启用" : "已停用"}
                            </span>
                          </td>
                          <td className="muted">
                            {u.distributed ? "已分发" : "待分发"}
                          </td>
                          {companyAdmin && (
                            <td>
                              <AccountPassword user={u} />
                            </td>
                          )}
                          <td>
                            <div className="table-actions">
                              <button
                                onClick={() => {
                                  setTargetUser(u);
                                  setDialog("user");
                                }}
                              >
                                编辑
                              </button>
                              {(companyAdmin || u.role === "employee") && (
                                <button
                                  onClick={() => {
                                    setTargetUser(u);
                                    setDialog("reset");
                                  }}
                                >
                                  重置
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredUsers.length && (
                    <Empty
                      icon={<UsersThree size={32} />}
                      title="没有符合条件的员工"
                      detail="调整筛选条件，或按部门开通员工账号。"
                    />
                  )}
                </div>
                <div className="table-footer">
                  共 {filteredUsers.length} 位成员{" "}
                  <span>
                    每人独立账号 · 清单导出不含密码 ·
                    公司管理员可验证身份后查看员工密码
                  </span>
                </div>
              </>
            ) : (
              <div className="department-grid">
                {departments
                  .filter((d) => companyAdmin || d.id === user.departmentId)
                  .map((d) => (
                    <article key={d.id} className="department-card">
                      <Buildings size={28} />
                      <h3>{d.name}</h3>
                      <span className={`status ${d.enabled ? "good" : ""}`}>
                        {d.enabled ? "已启用" : "已停用"}
                      </span>
                      <p>
                        {users.filter((u) => u.departmentId === d.id).length}{" "}
                        位成员
                      </p>
                      <div className="inline-actions">
                        <Button
                          onClick={() => {
                            setDepartmentFilter(d.id);
                            setTab("users");
                          }}
                        >
                          查看成员
                        </Button>
                        {companyAdmin && (
                          <Button onClick={() => openDepartment(d)}>
                            编辑部门
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
              </div>
            )}
          </>
        ) : (
          <Empty
            icon={<ShieldCheck size={34} />}
            title="此账号没有员工管理权限"
            detail="请使用部门管理员或公司管理员账号。"
          />
        ))}
      {page === "admin-models" && (
        <>
          <div className="tabs">
            <button className="active">公司连接</button>
            <span className="tab-note">
              密钥仅保存在服务器，员工端按权限使用
            </span>
          </div>
          {companyAdmin && (
            <ModelServiceCards
              departments={departments}
              refresh={refresh}
              notify={notify}
              revision={connections}
            />
          )}
          {connections.length ? (
            <div className="connection-list">
              {connections
                .filter((c) => !c.serviceId)
                .map((c) => (
                  <div key={c.id} className="connection-card">
                    <span className="card-icon">
                      <Plug size={24} />
                    </span>
                    <div>
                      <h3>
                        {c.name}{" "}
                        <span className="badge">
                          {c.kind === "chat" ? "对话" : "图片生成技能"}
                        </span>
                      </h3>
                      <p>
                        {c.model} · {c.baseUrl}
                      </p>
                      <small>
                        {c.departments.length
                          ? c.departments
                              .map(
                                (id) =>
                                  departments.find((d) => d.id === id)?.name ??
                                  id,
                              )
                              .join("、")
                          : "全公司可用"}{" "}
                        · 密钥已保护保存
                      </small>
                    </div>
                    <span className={`status ${c.enabled ? "good" : ""}`}>
                      {c.enabled ? "已启用" : "已停用"}
                    </span>
                    {companyAdmin && c.enabled === 1 && (
                      <Button
                        onClick={() =>
                          void action(async () => {
                            if (c.kind !== "chat") {
                              notify(
                                "图片连接请通过真实图片任务验证，当前没有发起生成或扣费。",
                              );
                              return;
                            }
                            const result = await api("/generate/chat", {
                              connectionId: c.id,
                              messages: [
                                {
                                  role: "user",
                                  content: "连接测试，请仅回复 OK。",
                                },
                              ],
                            });
                            notify(
                              `实际调用成功：${result.content.slice(0, 80)}`,
                            );
                          })
                        }
                      >
                        测试连接
                      </Button>
                    )}
                    {companyAdmin && c.enabled === 1 && (
                      <Button
                        onClick={() =>
                          void action(async () => {
                            await api(`/connections/${c.id}`, {}, "DELETE");
                            await load();
                          })
                        }
                      >
                        停用
                      </Button>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <Empty
              icon={<Plug size={36} />}
              title="配置第一个模型连接"
              detail="支持自定义服务地址、模型标识和密钥，先接通实际对话能力。"
              action={
                companyAdmin ? (
                  <Button primary onClick={() => setDialog("connection")}>
                    添加连接
                  </Button>
                ) : undefined
              }
            />
          )}
        </>
      )}
      {page === "admin-knowledge" &&
        (companyAdmin ? (
          <KnowledgeAdmin departments={departments} notify={notify} />
        ) : (
          <p>需要公司管理员权限。</p>
        ))}
      {page === "admin-skills" && (
        <>
          <div className="tabs">
            {[
              ["", "全部提交"],
              ["pending", "待审核"],
              ["published", "已发布"],
              ["rejected", "退回修改"],
              ["disabled", "已停用"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={statusFilter === id ? "active" : ""}
                onClick={() => setStatusFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="toolbar">
            <Search
              value={search}
              onChange={setSearch}
              placeholder="搜索技能或作者"
            />
            <SelectField
              label="筛选归属部门"
              icon={<Buildings size={17} />}
              value={departmentFilter}
              onValueChange={setDepartmentFilter}
              options={[
                { value: "", label: "全部获准部门" },
                ...departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
            <Button onClick={() => void load()}>刷新</Button>
          </div>
          {reviews.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>技能</th>
                    <th>作者</th>
                    <th>归属部门</th>
                    <th>发布范围</th>
                    <th>版本</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews
                    .filter(
                      (s) =>
                        (!statusFilter || s.status === statusFilter) &&
                        (!departmentFilter ||
                          s.ownerDepartmentId === departmentFilter) &&
                        `${s.name} ${s.authorName}`.includes(search),
                    )
                    .map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.name}</strong>
                        </td>
                        <td>{s.authorName}</td>
                        <td>{s.ownerDepartmentName}</td>
                        <td>
                          {s.audience === "company"
                            ? "全公司"
                            : s.targetDepartments
                                .map(
                                  (id) =>
                                    departments.find((d) => d.id === id)
                                      ?.name ?? "",
                                )
                                .join("、")}
                        </td>
                        <td>{s.version}</td>
                        <td>
                          <span
                            className={`badge ${s.status === "published" ? "green" : ""}`}
                          >
                            {statusNames[s.status]}
                          </span>
                        </td>
                        <td>
                          <button
                            className="text-button accent-text"
                            onClick={() => {
                              setTargetSkill(s);
                              setDialog("review");
                            }}
                          >
                            查看与审核 <ArrowRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={<Sparkle size={36} />}
              title="暂无获准处理的技能提交"
              detail="员工主动提交后，待审包会进入对应部门或公司审核队列。"
            />
          )}
        </>
      )}
      {page === "admin-audit" &&
        (companyAdmin ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作者</th>
                  <th>动作</th>
                  <th>资源编号</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.at).toLocaleString()}</td>
                    <td>{a.actor_name ?? "系统"}</td>
                    <td>{a.action}</td>
                    <td className="mono small">{a.resource_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={<ShieldCheck size={34} />}
            title="需要公司管理员权限"
            detail="操作记录按管理权限开放。"
          />
        ))}
      {dialog === "department" && (
        <Modal
          title={targetDepartment ? "编辑部门" : "建立部门"}
          close={() => setDialog("")}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void action(async () => {
                if (targetDepartment)
                  await api(
                    `/departments/${targetDepartment.id}`,
                    {
                      name: String(data.get("name")),
                      enabled: data.get("enabled") === "1",
                    },
                    "PATCH",
                  );
                else
                  await api("/departments", { name: String(data.get("name")) });
                setDialog("");
                await load();
                notify("部门已保存。");
              });
            }}
          >
            <Field label="部门名称">
              <input
                name="name"
                defaultValue={targetDepartment?.name ?? ""}
                maxLength={100}
                required
              />
            </Field>
            {targetDepartment && (
              <Field label="状态">
                <SelectField
                  label="部门状态"
                  name="enabled"
                  defaultValue={String(targetDepartment.enabled)}
                  options={[
                    {
                      value: "1",
                      label: "启用",
                      icon: <CheckCircle size={17} />,
                    },
                    { value: "0", label: "停用", icon: <XCircle size={17} /> },
                  ]}
                />
              </Field>
            )}
            <p className="muted small">
              有启用成员或待审、已发布技能时，需要先处理归属再停用。
            </p>
            <footer>
              <Button type="submit" primary disabled={busy}>
                保存部门
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {dialog === "user" && (
        <Modal
          title={targetUser ? "编辑员工账号" : "添加员工"}
          close={() => setDialog("")}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              void action(async () => {
                if (targetUser) {
                  await api(
                    `/users/${targetUser.id}`,
                    {
                      name: data.name,
                      departmentId: data.departmentId,
                      role: data.role,
                      enabled: data.enabled === "1",
                    },
                    "PATCH",
                  );
                  setDialog("");
                  notify("账号已更新，后续请求将重新校验权限。");
                } else {
                  const result = await api("/users", data);
                  setCredentials([result]);
                  setDialog("credentials");
                }
                await load();
              });
            }}
          >
            <Field label="员工姓名">
              <input
                name="name"
                defaultValue={targetUser?.name ?? ""}
                required
                maxLength={100}
              />
            </Field>
            {!targetUser && (
              <Field label="登录账号">
                <input
                  name="username"
                  pattern={"[a-zA-Z0-9_.@\\-]{2,64}"}
                  required
                  autoComplete="off"
                  placeholder="例如：xiaolin"
                />
              </Field>
            )}
            <Field label="所属部门">
              <SelectField
                label="所属部门"
                name="departmentId"
                defaultValue={targetUser?.departmentId ?? user.departmentId}
                options={departments
                  .filter(
                    (d) =>
                      d.enabled && (companyAdmin || d.id === user.departmentId),
                  )
                  .map((d) => ({
                    value: d.id,
                    label: d.name,
                    icon: <Buildings size={17} />,
                  }))}
              />
            </Field>
            <Field label="角色">
              <SelectField
                label="角色"
                name="role"
                defaultValue={targetUser?.role ?? "employee"}
                options={(Object.entries(roleNames) as [Role, string][])
                  .filter(
                    ([role]) =>
                      companyAdmin ||
                      role === "employee" ||
                      role === targetUser?.role,
                  )
                  .map(([role, label]) => ({
                    value: role,
                    label,
                    icon: <ShieldCheck size={17} />,
                  }))}
              />
            </Field>
            {targetUser && (
              <Field label="状态">
                <SelectField
                  label="账号状态"
                  name="enabled"
                  defaultValue={String(targetUser.enabled)}
                  options={[
                    {
                      value: "1",
                      label: "启用",
                      icon: <CheckCircle size={17} />,
                    },
                    { value: "0", label: "停用", icon: <XCircle size={17} /> },
                  ]}
                />
              </Field>
            )}
            <footer>
              <Button primary type="submit" disabled={busy}>
                {busy ? (
                  <Busy />
                ) : targetUser ? (
                  "保存修改"
                ) : (
                  "创建并生成初始密码"
                )}
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {dialog === "batch" && (
        <Modal wide title="按部门批量开通员工账号" close={() => setDialog("")}>
          <Field label="统一所属部门">
            <SelectField
              label="统一所属部门"
              value={batchDepartment}
              onValueChange={setBatchDepartment}
              options={departments
                .filter(
                  (d) =>
                    d.enabled && (companyAdmin || d.id === user.departmentId),
                )
                .map((d) => ({
                  value: d.id,
                  label: d.name,
                  icon: <Buildings size={17} />,
                }))}
            />
          </Field>
          <Field label="每行填写：登录账号,员工姓名">
            <textarea
              rows={6}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder={"xiaolin,小林\nxiaozhou,小周"}
            />
          </Field>
          <h3>创建预览 · {batchRows.length} 位员工</h3>
          <div className="source-list">
            {batchRows.map((row, i) => (
              <p key={i}>
                {i + 1}. {row.username || "缺少账号"} · {row.name || "缺少姓名"}{" "}
                · {departments.find((d) => d.id === batchDepartment)?.name}
              </p>
            ))}
          </div>
          <p className="muted small">
            批量开通统一使用员工角色；每人独立临时密码。已有账号不会被覆盖。
          </p>
          <footer>
            <Button
              primary
              disabled={
                busy ||
                !batchRows.length ||
                batchRows.length > 100 ||
                batchRows.some(
                  (r) => !/^[a-zA-Z0-9_.@-]{2,64}$/.test(r.username) || !r.name,
                )
              }
              onClick={() =>
                void action(async () => {
                  const result = await api<any[]>("/users/batch", {
                    rows: batchRows,
                  });
                  const errors = result.filter((r) => r.error);
                  setCredentials(result.filter((r) => r.user));
                  setDialog("credentials");
                  await load();
                  if (errors.length)
                    notify(
                      errors
                        .map((r) => `第 ${r.row} 行：${r.error}`)
                        .join("；"),
                    );
                })
              }
            >
              确认开通 {batchRows.length} 个账号
            </Button>
          </footer>
        </Modal>
      )}
      {dialog === "reset" && targetUser && (
        <Modal title="重置员工密码" close={() => setDialog("")}>
          <p>
            为 {targetUser.name}（{targetUser.username}
            ）生成新的初始密码，并撤销其现有登录。员工首次使用新密码须再次改密。
          </p>
          <footer>
            <Button onClick={() => setDialog("")}>取消</Button>
            <Button
              primary
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await api(`/users/${targetUser.id}/reset`, {});
                  setCredentials([
                    {
                      user: targetUser,
                      initialPassword: result.initialPassword,
                    },
                  ]);
                  setDialog("credentials");
                  await load();
                })
              }
            >
              确认重置
            </Button>
          </footer>
        </Modal>
      )}
      {dialog === "credentials" && (
        <Modal
          wide
          title="初始密码与账号分发"
          close={() => {
            setCredentials([]);
            setDialog("");
          }}
        >
          <div className="notice">
            <Key size={24} />
            <div>
              <strong>请逐人分发初始密码</strong>
              <p>
                初始密码 24
                小时内有效，首次登录必须改密。公司管理员可在账号表格验证身份后查看员工当前密码；管理员账号的密码只显示这一次。
              </p>
            </div>
          </div>
          <div className="credential-list">
            {credentials.map((c) => (
              <div className="credential-card" key={c.user.id}>
                <h3>
                  {c.user.name}{" "}
                  <span className="badge">{c.user.departmentName}</span>
                </h3>
                <div className="credential-content">
                  <span>账号：{c.user.username}</span>
                  <code>{c.initialPassword}</code>
                </div>
                <div className="inline-actions">
                  <Button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(
                          `账号：${c.user.username}\n初始密码：${c.initialPassword}`,
                        )
                        .then(() => notify("已复制该员工的账号与初始密码。"))
                        .catch(() => notify("复制失败，请手动选取。"))
                    }
                  >
                    <Copy size={16} />
                    复制给该员工
                  </Button>
                  <Button
                    onClick={() =>
                      void action(async () => {
                        await api(`/users/${c.user.id}/distributed`, {});
                        notify("已记录分发状态。");
                        await load();
                      })
                    }
                  >
                    <CheckCircle size={16} />
                    标记已分发
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <footer>
            <Button
              primary
              onClick={() => {
                setCredentials([]);
                setDialog("");
              }}
            >
              完成并关闭
            </Button>
          </footer>
        </Modal>
      )}
      {dialog === "connection" && (
        <ModelServiceDialog
          departments={departments}
          close={() => setDialog("")}
          saved={async () => {
            await load();
            notify("模型配置已保存，员工可在对话中选择已授权的模型。");
          }}
        />
      )}
      {dialog === "review" && targetSkill && (
        <Modal
          wide
          title={`技能审核 · ${targetSkill.name}`}
          close={() => setDialog("")}
        >
          <div className="skill-detail">
            <div className="inline-actions">
              <span className="badge">{targetSkill.ownerDepartmentName}</span>
              <span className="badge">
                {targetSkill.audience === "company"
                  ? "全公司发布"
                  : targetSkill.audience === "departments"
                    ? "指定部门共享"
                    : "本部门发布"}
              </span>
              <span className="badge">v{targetSkill.version}</span>
            </div>
            <p>{targetSkill.description}</p>
            <SkillSourceDetails skill={targetSkill} />
            <h3>提交的可复用流程</h3>
            <pre>{targetSkill.instructions}</pre>
            <h3>测试摘要</h3>
            <p>{targetSkill.testSummary}</p>
            <h3>作者提交的来源摘录</h3>
            <pre>
              {targetSkill.examples ||
                "作者未附来源摘录；完整聊天保存在作者本机。"}
            </pre>
            {targetSkill.reviewNote && (
              <p>审核意见：{targetSkill.reviewNote}</p>
            )}
          </div>
          {targetSkill.status === "pending" ? (
            <form onSubmit={(e) => e.preventDefault()}>
              <Field label="审核意见">
                <textarea
                  id="review-note"
                  rows={3}
                  placeholder="填写通过依据，或需要作者修改的内容…"
                />
              </Field>
              <footer>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const note = (
                        document.getElementById(
                          "review-note",
                        ) as HTMLTextAreaElement
                      ).value;
                      await api(`/skills/${targetSkill.id}/review`, {
                        approve: false,
                        note,
                      });
                      setDialog("");
                      await load();
                    })
                  }
                >
                  <XCircle size={17} />
                  退回修改
                </Button>
                <Button
                  primary
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const note = (
                        document.getElementById(
                          "review-note",
                        ) as HTMLTextAreaElement
                      ).value;
                      await api(`/skills/${targetSkill.id}/review`, {
                        approve: true,
                        note,
                      });
                      setDialog("");
                      await load();
                      notify("已按批准范围发布。");
                    })
                  }
                >
                  <CheckCircle size={17} />
                  批准并发布
                </Button>
              </footer>
            </form>
          ) : (
            targetSkill.status === "published" && (
              <footer>
                <Button
                  onClick={() =>
                    void action(async () => {
                      await api(`/skills/${targetSkill.id}/disable`, {});
                      setDialog("");
                      await load();
                    })
                  }
                >
                  停用这个版本
                </Button>
              </footer>
            )
          )}
        </Modal>
      )}
    </div>
  );
}
