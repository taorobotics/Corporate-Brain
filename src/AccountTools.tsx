import { useEffect, useRef, useState } from "react";
import { PencilSimple } from "@phosphor-icons/react";
import type { Department, User } from "../shared/types";
import { api } from "./api";
import { Button, Field, Modal } from "./components";

export function AccountNote({
  user,
  canEdit,
  refresh,
  notify,
}: {
  user: User;
  canEdit: boolean;
  refresh: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  return (
    <>
      <div className="account-note">
        <span
          className={user.accountNote ? "" : "muted"}
          title={user.accountNote}
        >
          {user.accountNote || "未备注"}
        </span>
        {canEdit && (
          <button
            aria-label={`编辑${user.username}的账号备注`}
            title="编辑账号备注"
            onClick={() => {
              setNote(user.accountNote ?? "");
              setError("");
              setOpen(true);
            }}
          >
            <PencilSimple size={16} />
          </button>
        )}
      </div>
      {open && (
        <Modal
          title="账号备注"
          close={() => {
            if (!busy) setOpen(false);
          }}
        >
          <p className="muted">
            {user.username} · {user.departmentName}
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                await api(`/users/${user.id}/note`, { note }, "PATCH");
                await refresh();
                setOpen(false);
                notify("账号备注已保存。");
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="分配给谁／其他备注">
              <textarea
                name="accountNote"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                rows={4}
                autoFocus
                disabled={busy}
                placeholder="例如：分配给张同事，11 月 4 日发放"
              />
            </Field>
            <p className="muted small">
              {note.length}/500 ·
              仅账号管理员可见。员工修改昵称、登录名或密码后仍保留。
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <Button disabled={busy} onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button primary type="submit" disabled={busy}>
                {busy ? "保存中…" : "保存备注"}
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

export function GenerateAccounts({
  departments,
  refresh,
  notify,
}: {
  departments: Department[];
  refresh: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [count, setCount] = useState(20);
  const requestId = useRef(crypto.randomUUID());
  return (
    <>
      <Button
        onClick={() => {
          setSelected(
            departments
              .filter((d) => d.enabled && !/测试/.test(d.name))
              .map((d) => d.id),
          );
          requestId.current = crypto.randomUUID();
          setError("");
          setOpen(true);
        }}
      >
        随机开通账号
      </Button>
      {open && (
        <Modal
          title="按部门随机开通员工账号"
          close={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              const form = event.currentTarget;
              const adminPassword = String(
                new FormData(form).get("adminPassword") ?? "",
              );
              setBusy(true);
              setError("");
              try {
                const result = await api("/admin/accounts/generate", {
                  requestId: requestId.current,
                  departmentIds: selected,
                  count,
                  adminPassword,
                });
                form.reset();
                setOpen(false);
                await refresh();
                notify(
                  `已为 ${result.departmentCount} 个部门开通 ${result.created} 个员工账号，可在账号表格中查看密码。`,
                );
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="muted">
              随机生成独立登录账号、显示名称和密码，权限为所属部门的普通员工。每批初始密码
              30 天内有效，首次登录须改密。重试同一批次不会重复创建。
            </p>
            <Field label="选择部门">
              <div className="account-department-options">
                {departments
                  .filter((d) => d.enabled)
                  .map((d) => (
                    <label key={d.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(d.id)}
                        disabled={busy}
                        onChange={(event) => {
                          setSelected(
                            event.target.checked
                              ? [...selected, d.id]
                              : selected.filter((id) => id !== d.id),
                          );
                          requestId.current = crypto.randomUUID();
                        }}
                      />
                      {d.name}
                    </label>
                  ))}
              </div>
            </Field>
            <Field label="每个部门的账号数（1–20）">
              <input
                type="number"
                min={1}
                max={20}
                value={count}
                disabled={busy}
                required
                onChange={(event) => {
                  setCount(Number(event.target.value));
                  requestId.current = crypto.randomUUID();
                }}
              />
            </Field>
            <Field label="当前管理员密码">
              <input
                name="adminPassword"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                required
                disabled={busy}
              />
            </Field>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <Button disabled={busy} onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button primary type="submit" disabled={busy || !selected.length}>
                {busy ? "正在开通…" : `开通 ${selected.length * count} 个账号`}
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

export function AccountPassword({ user }: { user: User }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<{
    password: string;
    updatedAt: string;
  } | null>(null);
  const sequence = useRef(0);
  function close() {
    sequence.current++;
    setResult(null);
    setOpen(false);
    setError("");
  }
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(close, 30_000);
    const hide = () => {
      if (document.hidden) close();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [result]);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  if (user.role === "company_admin")
    return <span className="muted">管理员密码不展示</span>;
  return (
    <>
      <button
        onClick={() => {
          setError("");
          setResult(null);
          setOpen(true);
        }}
      >
        查看密码
      </button>
      {open && (
        <Modal title={`${user.name}的当前密码`} close={close}>
          <p className="muted">
            登录账号：{user.username} · {user.departmentName}
          </p>
          {result ? (
            <>
              <Field label="当前密码">
                <input
                  readOnly
                  value={result.password}
                  aria-label="员工当前密码"
                  autoComplete="off"
                />
              </Field>
              <p className="muted">
                更新于 {new Date(result.updatedAt).toLocaleString()}。30
                秒后自动关闭。已记录本次查看操作。
              </p>
              <footer>
                <Button onClick={close}>隐藏并关闭</Button>
              </footer>
            </>
          ) : (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                const form = event.currentTarget,
                  task = ++sequence.current;
                const adminPassword = String(
                  new FormData(form).get("adminPassword") ?? "",
                );
                setBusy(true);
                setError("");
                try {
                  const next = await api("/admin/accounts/password", {
                    userId: user.id,
                    adminPassword,
                  });
                  if (task === sequence.current) {
                    form.reset();
                    setResult(next);
                  }
                } catch (error) {
                  if (task === sequence.current)
                    setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p>
                仅公司管理员可查看员工当前密码。请验证当前管理员的登录密码。
              </p>
              <Field label="当前管理员密码">
                <input
                  name="adminPassword"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
              </Field>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <footer>
                <Button onClick={close}>取消</Button>
                <Button primary type="submit" disabled={busy}>
                  {busy ? "验证中…" : "验证并查看"}
                </Button>
              </footer>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
