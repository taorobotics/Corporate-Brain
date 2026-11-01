import catalog from "./skin-catalog.json";

export type SkinMode = "light" | "dark";
export type Skin = {
  id: string;
  name: string;
  author: string;
  accent: string;
  category: string;
  variant: string;
  edition: string;
  background?: { light: string; dark: string };
};
export const SKINS: readonly Skin[] = catalog;
export const DEFAULT_SKIN = "claude";
export function getSkin(id?: string): Skin {
  return SKINS.find((skin) => skin.id === id) ?? SKINS[0];
}
export function normalizeSkin(id: unknown): string {
  return typeof id === "string" ? getSkin(id).id : DEFAULT_SKIN;
}
function channels(hex: string): number[] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}
function mix(a: string, b: string, amount: number): string {
  const x = channels(a), y = channels(b);
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * amount).toString(16).padStart(2, "0")).join("");
}
function luminance(color: string): number {
  const [r, g, b] = channels(color).map((c) => c / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function readable(color: string, background: string, dark: boolean): string {
  let result = color;
  for (let step = 0; step < 30 && contrast(result, background) < 4.5; step++)
    result = mix(result, dark ? "#ffffff" : "#000000", 0.1);
  return result;
}
export function skinTokens(skin: Skin, mode: SkinMode): Record<string, string> {
  const dark = mode === "dark", accent = skin.accent;
  const bg = mix(dark ? "#101116" : "#ffffff", accent, dark ? 0.05 : 0.035);
  const side = mix(dark ? "#15161c" : "#f5f5f5", accent, 0.08);
  const panel = mix(dark ? "#212229" : "#ffffff", accent, dark ? 0.045 : 0.012);
  const tokens = {
    bg, side, panel,
    line: mix(dark ? "#353741" : "#dedee2", accent, 0.12),
    ink: dark ? "#f0f1f5" : "#20212b",
    muted: dark ? "#b0b1bd" : "#62636e",
    accent: dark ? mix(accent, "#ffffff", 0.28) : accent,
    active: mix(panel, accent, dark ? 0.16 : 0.1),
  };
  if (skin.id === "claude") Object.assign(tokens, dark ? {
    bg: "#181715", side: "#1f1e1b", panel: "#252320", line: "#3b3832", ink: "#faf9f5", muted: "#a09d96", accent: "#e08a6a", active: "#2b2925",
  } : {
    bg: "#faf9f5", side: "#f5f0e8", panel: "#ffffff", line: "#ebe6df", ink: "#141413", muted: "#6c6a64", accent: "#d97757", active: "#efe9de",
  });
  if (skin.id === "catppuccin") Object.assign(tokens, dark ? {
    bg: "#1e1e2e", side: "#181825", panel: "#313244", line: "#45475a", ink: "#cdd6f4", muted: "#bac2de", accent: "#cba6f7", active: "#45475a",
  } : { bg: "#eff1f5", side: "#e6e9ef", panel: "#ffffff", ink: "#4c4f69", muted: "#5c5f77", accent: "#8839ef", active: "#dce0e8" });
  if (skin.id === "mint") Object.assign(tokens, dark ? { bg: "#0f1f19", side: "#12251d", panel: "#152a21", active: "#214033" } : { bg: "#f4faf7", side: "#eef6f2", ink: "#123528", muted: "#3c5a4d" });
  if (skin.id === "cafe-roastery") Object.assign(tokens, dark ? { bg: "#201a16", side: "#261e18", panel: "#32261d", active: "#433222" } : { bg: "#f2e7d0", side: "#e9dbbc", panel: "#fbf4e4", ink: "#3a2a18", muted: "#54422a" });
  const foreground = contrast("#ffffff", tokens.accent) >= contrast("#000000", tokens.accent) ? "#ffffff" : "#000000";
  const variables: Record<string, string> = Object.fromEntries(Object.entries(tokens).map(([key, value]) => [`--${key}`, value]));
  variables["--accent-ink"] = foreground;
  variables["--accent-text"] = readable(tokens.accent, tokens.bg, dark);
  variables["--skin-radius"] = skin.variant === "square" ? "3px" : skin.variant === "technical" ? "6px" : "14px";
  variables["--skin-wallpaper"] = skin.background ? `url("${skin.background[mode]}")` : "none";
  variables["--skin-scrim"] = dark ? "#101116a6" : "#ffffffb5";
  variables["--shadow"] = dark ? "0 8px 30px #00000028" : "0 8px 30px #27231c0a";
  return variables;
}
