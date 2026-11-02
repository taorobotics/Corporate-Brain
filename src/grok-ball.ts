// The upstream runtime is a standalone browser script. Keep its MIT source
// in src/vendor and expose only the small contract used by the loading UI.
import "./vendor/grok-ball.js";

export type GrokEmotionId = string;

export type GrokBallEngine = {
  setEmotion(id: GrokEmotionId, options?: { auto?: boolean }): boolean;
  setGaze(nx: number, ny: number): GrokBallEngine;
  destroy(): void;
  setActive(active: boolean): void;
  renderStatic(): void;
};

export type GrokBallStatic = {
  create(
    target: Element,
    options?: {
      emotion?: GrokEmotionId;
      color?: string;
      eyeColor?: string;
      eyeScale?: number;
      autostart?: boolean;
    },
  ): GrokBallEngine;
};

declare global {
  interface Window {
    GrokBall?: GrokBallStatic;
  }
}

export function createGrokBall(
  target: Element,
  emotion: GrokEmotionId,
  active = true,
): GrokBallEngine | null {
  return (
    window.GrokBall?.create(target, {
      emotion,
      color: "#151515",
      eyeColor: "#f7f4ed",
      eyeScale: 1.18,
      autostart: active,
    }) ?? null
  );
}
