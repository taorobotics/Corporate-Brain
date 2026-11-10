import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Drag = {
  id: number;
  startX: number;
  startWidth: number;
  x: number;
  original: string;
};

export default function ResizableSidebar({
  enabled,
  width,
  onResize,
  children,
}: {
  enabled: boolean;
  width?: number;
  onResize: (width: number | undefined) => void;
  children: ReactNode;
}) {
  const aside = useRef<HTMLElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const commit = useRef(onResize);
  const [values, setValues] = useState({ now: 198, max: 420 });
  const bounds = () => {
    const rail =
      aside.current?.parentElement
        ?.querySelector(".activity-rail")
        ?.getBoundingClientRect().width ?? 62;
    return Math.max(
      170,
      Math.min(420, innerWidth - rail - (innerWidth <= 650 ? 24 : 360)),
    );
  };
  const apply = (value: number) => {
    aside.current?.style.setProperty(
      "--sidebar-width",
      `${Math.max(170, Math.min(bounds(), Math.round(value)))}px`,
    );
  };
  function flush() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const current = drag.current;
    if (current) apply(current.startWidth + current.x - current.startX);
  }
  function finish(save: boolean) {
    const current = drag.current;
    if (!current) return;
    if (save) flush();
    else if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    drag.current = null;
    document.documentElement.classList.remove("sidebar-resizing");
    aside.current?.removeAttribute("data-resizing");
    if (!save) {
      if (current.original)
        aside.current?.style.setProperty("--sidebar-width", current.original);
      else aside.current?.style.removeProperty("--sidebar-width");
    }
    if (handle.current?.hasPointerCapture(current.id))
      handle.current.releasePointerCapture(current.id);
    if (save && aside.current)
      commit.current(Math.round(aside.current.getBoundingClientRect().width));
  }
  useLayoutEffect(() => {
    commit.current = onResize;
  });
  useLayoutEffect(() => {
    finish(false);
    if (enabled && typeof width === "number" && Number.isFinite(width))
      aside.current?.style.setProperty("--sidebar-width", `${width}px`);
    else aside.current?.style.removeProperty("--sidebar-width");
  }, [enabled, width]);
  useLayoutEffect(() => {
    if (!enabled || !aside.current) return;
    const update = () => {
      const now = Math.round(aside.current!.getBoundingClientRect().width),
        max = Math.round(bounds());
      setValues((v) => (v.now === now && v.max === max ? v : { now, max }));
    };
    const cancel = () => finish(false);
    const observer = new ResizeObserver(update);
    observer.observe(aside.current);
    window.addEventListener("resize", update);
    window.addEventListener("blur", cancel);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, [enabled]);
  return (
    <aside
      ref={aside}
      className="sidebar"
      id={enabled ? "conversation-sidebar" : undefined}
    >
      {children}
      {enabled && (
        <div
          ref={handle}
          className="sidebar-resize-handle"
          role="separator"
          aria-label="调整对话侧栏宽度"
          aria-controls="conversation-sidebar"
          aria-orientation="vertical"
          aria-valuemin={170}
          aria-valuemax={values.max}
          aria-valuenow={values.now}
          aria-valuetext={`${values.now} 像素`}
          tabIndex={0}
          title="拖动调整宽度；双击恢复默认；方向键微调"
          onPointerDown={(e) => {
            if (!e.isPrimary || e.button !== 0 || drag.current) return;
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              id: e.pointerId,
              startX: e.clientX,
              x: e.clientX,
              startWidth: aside.current!.getBoundingClientRect().width,
              original:
                aside.current!.style.getPropertyValue("--sidebar-width"),
            };
            document.documentElement.classList.add("sidebar-resizing");
            aside.current!.dataset.resizing = "true";
          }}
          onPointerMove={(e) => {
            if (drag.current?.id !== e.pointerId) return;
            drag.current.x = e.clientX;
            if (frame.current === null)
              frame.current = requestAnimationFrame(flush);
          }}
          onPointerUp={(e) => {
            if (drag.current?.id !== e.pointerId) return;
            drag.current.x = e.clientX;
            finish(true);
          }}
          onPointerCancel={(e) => {
            if (drag.current?.id === e.pointerId) finish(false);
          }}
          onLostPointerCapture={(e) => {
            if (drag.current?.id === e.pointerId) finish(false);
          }}
          onDoubleClick={() => {
            finish(false);
            commit.current(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              finish(false);
              return;
            }
            if (
              !["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(
                e.key,
              )
            )
              return;
            e.preventDefault();
            finish(false);
            if (e.key === "Enter") {
              commit.current(undefined);
              return;
            }
            const now = aside.current!.getBoundingClientRect().width;
            apply(
              e.key === "Home"
                ? 170
                : e.key === "End"
                  ? bounds()
                  : now +
                    (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 40 : 10),
            );
            commit.current(
              Math.round(aside.current!.getBoundingClientRect().width),
            );
          }}
        />
      )}
    </aside>
  );
}
