import { useState, type FormEvent } from "react";
import { ArrowRight, LockKey } from "@phosphor-icons/react";
import { api } from "./api";
import { Brand, Button, Field, Busy } from "./components";
import type { User } from "../shared/types";
export default function Auth({
  bootstrap,
  onLogin,
  onLegal,
}: {
  bootstrap: boolean;
  onLogin: (user: User) => void;
  onLegal: () => void;
}) {
  const [setup, setSetup] = useState(bootstrap),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (setup) {
        await api("/bootstrap", data);
        setSetup(false);
      }
      onLogin(
        await api("/auth/login", {
          username: data.username,
          password: data.password,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <Brand />
      <div className="auth-card">
        <div className="eyebrow">
          <LockKey size={16} /> 公司工作空间
        </div>
        <h1>{setup ? "建立你的公司大脑" : "欢迎回来"}</h1>
        <p>
          {setup
            ? "创建首位管理员，随后按部门开通员工账号。"
            : "登录公司账号，继续你的工作。"}
        </p>
        <form onSubmit={submit}>
          {setup && (
            <>
              <Field label="初始管理部门">
                <input
                  name="companyName"
                  placeholder="例如：管理部"
                  required
                  maxLength={100}
                />
              </Field>
              <Field label="管理员姓名">
                <input name="name" autoComplete="name" required />
              </Field>
            </>
          )}
          <Field label="登录账号">
            <input
              name="username"
              autoComplete="username"
              required
              pattern={"[a-zA-Z0-9_.@\\-]{2,64}"}
            />
          </Field>
          <Field label={setup ? "设置密码（至少 12 位）" : "密码"}>
            <input
              name="password"
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              minLength={setup ? 12 : 1}
              maxLength={128}
              required
            />
          </Field>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <Button type="submit" primary disabled={busy}>
            {busy ? (
              <Busy />
            ) : (
              <>
                {setup ? "创建并进入" : "登录"}
                <ArrowRight size={18} />
              </>
            )}
          </Button>
        </form>
      </div>
      <p className="auth-foot">
        对话与个人草稿保存在这台设备 · 公司技能按部门共享
        <button className="auth-legal" onClick={onLegal}>
          隐私与许可
        </button>
      </p>
    </main>
  );
}
