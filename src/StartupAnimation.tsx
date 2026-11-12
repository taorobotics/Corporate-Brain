import { useEffect, useRef, useState } from "react";

export default function StartupAnimation({
  theme,
  onFinished,
}: {
  theme: string;
  onFinished(): void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const finish = useRef(onFinished);
  finish.current = onFinished;
  const [token] = useState(() => crypto.randomUUID());
  const [stage, setStage] = useState("intro");
  useEffect(() => {
    let complete = false;
    const done = () => {
      if (complete) return;
      complete = true;
      finish.current();
    };
    const message = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "brain:startup" ||
        event.data.token !== token
      ) return;
      if (event.data.state === "finished") done();
      else if (event.data.state === "plate") setStage("plate");
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") done();
    };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => { if (reduced.matches) done(); };
    window.addEventListener("message", message);
    window.addEventListener("keydown", keyboard);
    reduced.addEventListener("change", motion);
    const timer = window.setTimeout(done, reduced.matches ? 0 : 20000);
    return () => {
      complete = true;
      clearTimeout(timer);
      window.removeEventListener("message", message);
      window.removeEventListener("keydown", keyboard);
      reduced.removeEventListener("change", motion);
    };
  }, [token]);
  return (
    <div className="startup-animation" data-stage={stage} data-theme={theme}>
      <iframe
        ref={frame}
        title="公司大脑启动动画"
        src={`/startup/index.html?theme=${theme === "dark" ? "dark" : "light"}&token=${token}`}
        referrerPolicy="no-referrer"
        onError={() => finish.current()}
      />
    </div>
  );
}
