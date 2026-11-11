import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "../desktop/entry-scene.js";
import "../desktop/entry-scene.css";
import "./entry.css";
import { WindowTitleBar } from "./WindowControls";

type Scene = HTMLElement & {
  start(elapsed?: number, skip?: boolean): void;
  skip(): void;
};
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
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<Scene | null>(null);
  const [introDone, setIntroDone] = useState(false),
    [skipped, setSkipped] = useState(false),
    [exiting, setExiting] = useState(false);
  const startedAt = useRef(Date.now());
  const exit = useRef(onEntered);
  exit.current = onEntered;
  useLayoutEffect(() => {
    const node = document.createElement("brain-entry-scene") as Scene;
    scene.current = node;
    host.current!.appendChild(node);
    node.setAttribute("theme", theme);
    const done = () => setIntroDone(true);
    node.addEventListener("entry-intro-end", done);
    let active = true;
    const start = (context?: { startedAt?: number; skipped?: boolean }) => {
      if (!active) return;
      node.start(
        Math.max(0, Date.now() - (context?.startedAt ?? startedAt.current)),
        !!context?.skipped,
      );
    };
    if (window.brainDesktop?.entryContext)
      void window.brainDesktop.entryContext().then(start, () => start());
    else start();
    return () => {
      active = false;
      node.removeEventListener("entry-intro-end", done);
      node.remove();
      scene.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    const node = scene.current;
    if (!node) return;
    node.setAttribute("theme", theme);
    node.setAttribute("phase", phase);
    node.setAttribute("headline", headline || "");
    node.setAttribute("detail", detail);
    if (phase === "error") node.skip();
  }, [phase, theme, headline, detail]);
  useEffect(() => {
    if (phase !== "ready" || !introDone) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reveal = setTimeout(
      () => {
        scene.current?.setAttribute("data-exit", "true");
        setExiting(true);
      },
      skipped || reduced ? 0 : 750,
    );
    const finish = setTimeout(
      () => exit.current?.(),
      skipped || reduced ? 120 : 1950,
    );
    return () => {
      clearTimeout(reveal);
      clearTimeout(finish);
    };
  }, [phase, introDone, skipped]);
  function skip() {
    scene.current?.skip();
    setSkipped(true);
  }
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"]')
      )
        skip();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);
  return (
    <section
      className="entry-experience"
      data-theme={theme}
      data-phase={phase}
      data-intro-done={introDone}
      data-exit={exiting}
      data-auth-surface={!!children}
    >
      <div ref={host} className="entry-scene-host" />
      <WindowTitleBar />
      {!skipped && (
        <button className="entry-skip" onClick={skip} aria-label="跳过动画">
          跳过动画 <span>SKIP ▸</span>
        </button>
      )}
      {children && (
        <div className="entry-form-stage" inert={!introDone}>
          {children}
        </div>
      )}
      {action && (
        <div className="entry-recovery">
          <button aria-label={action.label} onClick={action.run}>
            {action.label} <span>RETRY ↗</span>
          </button>
        </div>
      )}
    </section>
  );
}
