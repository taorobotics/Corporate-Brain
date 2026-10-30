import { useEffect, useRef } from "react";
import { createGrokBall, type GrokBallEngine } from "./grok-ball";

export default function GrokBall({
  emotion,
  size = 58,
}: {
  emotion: string;
  size?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<GrokBallEngine | null>(null);

  useEffect(() => {
    if (!host.current) return;
    engine.current = createGrokBall(host.current, emotion);
    return () => {
      engine.current?.destroy();
      engine.current = null;
    };
  }, []);

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
