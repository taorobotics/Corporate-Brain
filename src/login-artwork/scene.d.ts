export type PlanetSceneState = {
  mode: "initializing" | "webgl" | "fallback";
  frames: number;
  time: number;
  paused: boolean;
  theme?: string;
  disposed?: boolean;
  error: string | null;
  pointer: { x: number; y: number };
};
export type PlanetSceneController = {
  getState(): PlanetSceneState;
  dispose(): void;
};
export function createPlanetScene(
  host: HTMLElement,
  owner: HTMLElement,
): PlanetSceneController;
