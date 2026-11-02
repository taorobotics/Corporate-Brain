import { useEffect, useRef } from "react";
import { createGrokBall, type GrokBallEngine } from "./grok-ball";

export default function GrokBall({
  emotion,
  size = 58,
  active = true,
}: {
  emotion: string;
  size?: number;
  active?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<GrokBallEngine | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    engine.current = createGrokBall(
      host.current,
      emotion,
      active && !reduced.matches,
    );
    const sync = () => {
      engine.current?.setActive(active && !reduced.matches && !document.hidden);
      if (!active || reduced.matches) engine.current?.renderStatic();
    };
    sync();
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      engine.current?.destroy();
      engine.current = null;
    };
  }, [active]);

  useEffect(() => {
    engine.current?.setEmotion(emotion);
  }, [emotion]);

  return (
    <div
      className="grok-ball-host"
      ref={host}
      aria-hidden="true"
      style={{ width: size, height: size }}
    />
  );
}
