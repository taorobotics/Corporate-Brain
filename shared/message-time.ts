export function messageTime(value: unknown, now = new Date()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const prefix =
    day(date) === day(now)
      ? "今天"
      : day(date) === day(yesterday)
        ? "昨天"
        : `${date.getFullYear() === now.getFullYear() ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`;
  return {
    clock,
    label: `${prefix} ${clock}`,
    title: `本机时间：${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock}:${pad(date.getSeconds())}`,
    iso: date.toISOString(),
  };
}
