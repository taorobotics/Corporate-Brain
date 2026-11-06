export type ChatSource = { url: string; title: string };
export type TraceItem =
  | { type: "reasoning"; id: string; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      status: "running" | "done" | "error" | "stopped";
      detail?: string;
      sources?: ChatSource[];
    };
export type ChatTrace = {
  items: TraceItem[];
  status: "done" | "stopped" | "error";
  elapsed: number;
};
export type ChatUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};
export type ChatProgress =
  | { type: "reasoning"; id: string; text: string; append?: boolean }
  | Extract<TraceItem, { type: "tool" }>
  | { type: "text"; text: string }
  | {
      type: "done";
      content: string;
      image?: string;
      usage?: ChatUsage;
      productionTaskId?: string;
    }
  | { type: "error"; message: string };

export function safeSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return [];
  const found = new Set<string>();
  return value.slice(0, 50).flatMap((source) => {
    try {
      if (!source || typeof source.url !== "string") return [];
      const url = new URL(source.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.href.length > 2048 ||
        found.has(url.href)
      )
        return [];
      found.add(url.href);
      return [
        {
          url: url.href,
          title:
            typeof source.title === "string"
              ? source.title.slice(0, 200)
              : url.hostname,
        },
      ];
    } catch {
      return [];
    }
  });
}

// Bounds also apply to imported local backups and untrusted provider output.
export function updateTrace(
  items: TraceItem[],
  event: ChatProgress,
): TraceItem[] {
  if (event.type !== "reasoning" && event.type !== "tool") return items;
  if (typeof event.id !== "string" || event.id.length > 200) return items;
  const index = items.findIndex((item) => item.id === event.id);
  if (index < 0 && items.length >= 200) return items;
  const previous = items[index];
  let item: TraceItem;
  if (event.type === "reasoning") {
    if (typeof event.text !== "string") return items;
    const available = Math.max(
      0,
      160_000 -
        items.reduce(
          (n, entry, i) =>
            n +
            (i !== index && entry.type === "reasoning" ? entry.text.length : 0),
          0,
        ),
    );
    item = {
      type: "reasoning",
      id: event.id,
      text: (
        (event.append && previous?.type === "reasoning" ? previous.text : "") +
        event.text
      ).slice(0, available),
    };
  } else {
    if (
      typeof event.name !== "string" ||
      !["running", "done", "error", "stopped"].includes(event.status)
    )
      return items;
    item = {
      type: "tool",
      id: event.id,
      name: event.name.slice(0, 100),
      status: event.status,
      ...(typeof event.detail === "string"
        ? { detail: event.detail.slice(0, 3000) }
        : {}),
      sources: safeSources(event.sources),
    };
  }
  return index < 0
    ? [...items, item]
    : items.map((entry, i) => (i === index ? item : entry));
}

export function normalizeTrace(value: unknown): ChatTrace | undefined {
  const input = value as Partial<ChatTrace> | undefined;
  if (!input || !Array.isArray(input.items)) return undefined;
  let items: TraceItem[] = [];
  for (const item of input.items.slice(0, 200))
    if (item && typeof item === "object") items = updateTrace(items, item);
  return {
    items: items.map((item) =>
      item.type === "tool" && item.status === "running"
        ? { ...item, status: "stopped" }
        : item,
    ),
    status:
      input.status === "error" || input.status === "stopped"
        ? input.status
        : "done",
    elapsed: Number.isFinite(input.elapsed)
      ? Math.max(0, Math.min(input.elapsed!, 86400))
      : 0,
  };
}
