import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "./api";
import { Brand, Modal, Button } from "./components";
import LoginArtwork from "./LoginArtwork";
import type { User } from "../shared/types";
import "./auth-surface.css";

function LineIcon({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}
export default function Auth({
  bootstrap,
  onLogin,
  onLegal,
  onBusy,
  theme,
  onTheme,
}: {
  bootstrap: boolean;
  onLogin: (user: User) => void;
  onLegal: () => void;
  onBusy?: (busy: boolean) => void;
  theme: string;
  onTheme: () => void;
}) {
  const desktopEmployee =
    !!window.brainDesktop && window.brainDesktop.allowBootstrap !== true;
  const [setup, setSetup] = useState(bootstrap && !desktopEmployee),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false),
    [help, setHelp] = useState(false),
    [caps, setCaps] = useState(false);
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    onBusy?.(true);
    setError("");
    const form = event.currentTarget,
      data = Object.fromEntries(new FormData(form));
    try {
      if (setup) {
        await api("/bootstrap", data);
        setSetup(false);
      }
      const user = await api<User>("/auth/login", {
        username: data.username,
        password: data.password,
      });
      (form.elements.namedItem("password") as HTMLInputElement).value = "";
      onLogin(user);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <main
      className={`auth login-scene login-surface ${theme === "dark" ? "dsu-dark" : ""} ${setup ? "is-setup" : ""}`}
      onKeyDownCapture={(event) => {
        event.currentTarget.dataset.input = "keyboard";
      }}
      onPointerDownCapture={(event) => {
        event.currentTarget.dataset.input = "pointer";
      }}
    >
      <div className="login-panels" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="login-frame" aria-hidden="true" />
      <header className="dsu-brand">
        <Brand />
      </header>
      <button
        className="theme-toggle"
        type="button"
        onClick={onTheme}
        aria-label={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}
      >
        <LineIcon>
          {theme === "dark" ? (
            <>
              <circle cx="12" cy="12" r="3.6" />
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </>
          ) : (
            <path d="M20.4 14.5A8.4 8.4 0 0 1 9.5 3.6a8.5 8.5 0 1 0 10.9 10.9Z" />
          )}
        </LineIcon>
      </button>
      <div className="login-main">
        <div className="studio-assembly">
          <div className="sheet-underlay" aria-hidden="true" />
          <div className="studio-layout">
            <LoginArtwork theme={theme} />
            <section
              className="login-sheet auth-card"
              aria-labelledby="auth-title"
            >
              <div className="login-content">
                <div className="login-heading">
                  <span className="heading-mark" aria-hidden="true" />
                  <h1 id="auth-title">
                    {setup ? "建立你的公司大脑" : "欢迎回来"}
                  </h1>
                  <p>
                    {setup
                      ? "创建首位管理员 随后按部门开通账号"
                      : "登录公司账号 继续你的工作"}
                  </p>
                </div>
                {desktopEmployee && bootstrap && (
                  <p role="status" className="auth-notice">
                    公司服务尚未初始化，请联系管理员开通账号。
                  </p>
                )}
                <form onSubmit={submit} aria-busy={busy}>
                  {setup && (
                    <>
                      <div className="login-field">
                        <div className="field-heading">
                          <label htmlFor="auth-company">初始管理部门</label>
                        </div>
                        <div className="input-wrap plain-input">
                          <input
                            id="auth-company"
                            name="companyName"
                            placeholder="例如：管理部"
                            required
                            maxLength={100}
                          />
                        </div>
                      </div>
                      <div className="login-field">
                        <div className="field-heading">
                          <label htmlFor="auth-name">管理员姓名</label>
                        </div>
                        <div className="input-wrap plain-input">
                          <input
                            id="auth-name"
                            name="name"
                            autoComplete="name"
                            required
                          />
                        </div>
                      </div>
                    </>
                  )}
                  <div className="login-field">
                    <div className="field-heading">
                      <label htmlFor="auth-username">公司账号</label>
                    </div>
                    <div className="input-wrap">
                      <LineIcon className="field-icon">
                        <circle cx="12" cy="8" r="3.2" />
                        <path d="M5.8 20v-1.8a6.2 6.2 0 0 1 12.4 0V20" />
                      </LineIcon>
                      <input
                        id="auth-username"
                        name="username"
                        placeholder="输入你的账号"
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        required
                        pattern={"[a-zA-Z0-9_.@\\-]{2,64}"}
                      />
                    </div>
                  </div>
                  <div className="login-field password-group">
                    <div className="field-heading">
                      <label htmlFor="auth-password">
                        {setup ? "设置密码（至少 12 位）" : "密码"}
                      </label>
                    </div>
                    <div className="input-wrap password-field">
                      <LineIcon className="field-icon">
                        <rect x="5" y="10" width="14" height="10" rx="1" />
                        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2" />
                      </LineIcon>
                      <input
                        id="auth-password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="输入你的密码"
                        autoComplete={
                          setup ? "new-password" : "current-password"
                        }
                        minLength={setup ? 12 : 1}
                        maxLength={128}
                        required
                        aria-describedby={caps ? "auth-caps" : undefined}
                        onKeyDown={(event) =>
                          setCaps(event.getModifierState("CapsLock"))
                        }
                        onKeyUp={(event) =>
                          setCaps(event.getModifierState("CapsLock"))
                        }
                        onBlur={() => setCaps(false)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={showPassword ? "隐藏密码" : "显示密码"}
                        aria-pressed={showPassword}
                      >
                        <LineIcon>
                          <path d="M2.5 12s3.3-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.3 6.5-9.5 6.5S2.5 12 2.5 12Z" />
                          <circle cx="12" cy="12" r="2.6" />
                          {showPassword && <path d="M4 4l16 16" />}
                        </LineIcon>
                      </button>
                    </div>
                    {!setup && (
                      <button
                        type="button"
                        className="text-button forgot-password"
                        onClick={() => setHelp(true)}
                      >
                        忘记密码
                      </button>
                    )}
                    {caps && (
                      <p className="caps-notice" id="auth-caps">
                        大写锁定已开启
                      </p>
                    )}
                  </div>
                  {error && (
                    <p role="alert" className="error login-error">
                      {error}
                    </p>
                  )}
                  <button
                    type="submit"
                    className="login-submit"
                    disabled={busy}
                  >
                    <strong>
                      {setup ? "创建并进入" : busy ? "正在登录" : "登录"}
                    </strong>
                    {busy ? (
                      <span className="submit-spinner" aria-hidden="true" />
                    ) : (
                      <LineIcon className="submit-arrow">
                        <path d="M4 12h16m-6-6 6 6-6 6" />
                      </LineIcon>
                    )}
                  </button>
                </form>
              </div>
              <div className="sheet-footer">
                <LineIcon>
                  <path d="m12 3 7 3v5c0 4.8-4 8-7 10-3-2-7-5.2-7-10V6l7-3Z" />
                  <path d="m9 12 2 2 4-4" />
                </LineIcon>
                <span>
                  {setup ? "仅管理员可初始化公司服务" : "账号由公司管理员分配"}
                </span>
              </div>
            </section>
          </div>
        </div>
      </div>
      <footer className="login-footer">
        <span>
          <i aria-hidden="true" />
          公司大脑 · 账号登录
        </span>
        <button type="button" className="auth-legal" onClick={onLegal}>
          隐私与许可
        </button>
      </footer>
      {help && (
        <Modal title="联系公司管理员" close={() => setHelp(false)}>
          <p>如需重置密码或开通公司账号，请联系公司管理员。</p>
          <Button primary onClick={() => setHelp(false)}>
            知道了
          </Button>
        </Modal>
      )}
    </main>
  );
}
