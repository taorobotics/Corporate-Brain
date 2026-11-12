import { useRef, type ReactNode } from "react";
import "./entry.css";
import { WindowTitleBar } from "./WindowControls";
import StartupAnimation from "./StartupAnimation";

export type EntryPhase =
  "connecting" | "auth" | "verifying" | "profile" | "ready" | "error";
export default function EntryExperience({
  phase,
  theme,
  headline,
  detail,
  children,
  action,
  onEntered,
}: {
  phase: EntryPhase;
  theme: string;
  headline?: string;
  detail: string;
  children?: ReactNode;
  action?: { label: string; run(): void };
  onEntered?(): void;
}) {
  const exit = useRef(onEntered);
  exit.current = onEntered;
  const title = headline || (phase === "error"
    ? "暂时无法连接公司服务器"
    : phase === "connecting"
      ? "正在连接公司工作空间"
      : "正在读取你的个人空间");
  return (
    <section
      className="entry-experience"
      data-theme={theme}
      data-phase={phase}
      data-intro-done="true"
      data-auth-surface={!!children}
    >
      <WindowTitleBar />
      {children ? (
        <div className="entry-form-stage">{children}</div>
      ) : phase === "ready" ? (
        <StartupAnimation theme={theme} onFinished={() => exit.current?.()} />
      ) : (
        <div className="entry-connection" role="status" aria-live="polite">
          <h1>{title}</h1>
          <p>{detail}</p>
          {action && (
            <button onClick={action.run}>{action.label}</button>
          )}
        </div>
      )}
    </section>
  );
}
