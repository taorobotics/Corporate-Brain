import type { Connection } from "./types";
import { modelProviders } from "./model-services";

export type ModelGroup = {
  id: string;
  label: string;
  models: Connection[];
  submenu: boolean;
};

export function modelGroups(connections: Connection[]): ModelGroup[] {
  return connectionGroups(
    connections.filter((c) => c.enabled && c.kind === "chat"),
  );
}

export function connectionGroups(connections: Connection[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const connection of connections) {
    let provider = modelProviders.find(
      (p) => p.id === connection.serviceProvider && p.id !== "custom",
    );
    // Older company servers may omit provider metadata.
    try {
      const hostname = new URL(connection.baseUrl).hostname.toLowerCase();
      if (!provider && connection.serviceProvider !== "custom") {
        provider = modelProviders.find(
          (p) => p.baseUrl && new URL(p.baseUrl).hostname === hostname,
        );
      }
      if (hostname === "linoroute.com") provider = modelProviders[0];
    } catch {
      /* Keep standalone legacy connections usable. */
    }
    const linoRoute = provider?.id === "linoroute";
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
