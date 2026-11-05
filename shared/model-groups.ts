import type { Connection } from "./types";
import { modelProviders } from "./model-services";

export type ModelGroup = {
  id: string;
  label: string;
  models: Connection[];
  submenu: boolean;
};

export function modelGroups(connections: Connection[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const connection of connections) {
    if (!connection.enabled || connection.kind !== "chat") continue;
    const provider = modelProviders.find(
      (p) => p.id === connection.serviceProvider && p.id !== "custom",
    );
    // Older company servers may omit provider metadata.
    let linoRoute = provider?.id === "linoroute";
    try {
      linoRoute ||=
        new URL(connection.baseUrl).hostname.toLowerCase() === "linoroute.com";
    } catch {
      /* Keep standalone legacy connections usable. */
    }
    const id = linoRoute
      ? "provider:linoroute"
      : provider
        ? "provider:" + provider.id
        : connection.serviceId
          ? "service:" + connection.serviceId
          : "connection:" + connection.id;
    const label = linoRoute
      ? "LinoRoute"
      : (provider?.name ?? connection.serviceName ?? connection.name);
    const group = groups.get(id) ?? {
      id,
      label,
      models: [],
      submenu: linoRoute || !!connection.serviceId || !!provider,
    };
    group.models.push(connection);
    groups.set(id, group);
  }
  return [...groups.values()];
}
