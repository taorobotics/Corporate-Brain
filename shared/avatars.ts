import catalog from "./avatar-presets.json";

// Stable identifiers are stored with accounts. Never reorder or reuse them.
export const AVATAR_PRESETS = catalog;
export function isAvatarPreset(value: string) {
  return AVATAR_PRESETS.some((avatar) => avatar.id === value);
}
export function defaultAvatar(userId: string) {
  let hash = 0;
  for (const char of userId)
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return AVATAR_PRESETS[hash % AVATAR_PRESETS.length].id;
}
export function avatarSource(value: string | undefined, userId: string) {
  const preset = AVATAR_PRESETS.find(
    (avatar) => avatar.id === (value || defaultAvatar(userId)),
  );
  if (preset) return preset.src;
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(
    value ?? "",
  )
    ? value!
    : AVATAR_PRESETS[0].src;
}
