import test from "node:test";
import assert from "node:assert/strict";
import { modelGroups } from "./model-groups";
import type { Connection } from "./types";
const model = (id: string, extra: Partial<Connection> = {}): Connection => ({
  id,
  name: id,
  model: id,
  baseUrl: "https://example.invalid/v1",
  kind: "chat",
  departments: [],
  hasKey: true,
  enabled: 1,
  ...extra,
});
test("Model picker groups provider connections without losing personal selection IDs; legacy, custom, disabled and image entries stay distinct", () => {
  const list = [
    model("official"),
    model("a", {
      serviceProvider: "linoroute",
      serviceId: "company",
      serviceName: "Company",
    }),
    model("b", {
      serviceProvider: "linoroute",
      serviceId: "personal",
      personal: true,
    }),
    model("old", { baseUrl: "https://linoroute.com/v1" }),
    model("disabled", { enabled: 0 }),
    model("image", { kind: "image" }),
    model("custom", {
      serviceId: "c",
      serviceName: "My service",
      serviceProvider: "custom",
    }),
  ];
  const groups = modelGroups(list);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].submenu, false);
  assert.equal(groups[1].label, "LinoRoute");
  assert.deepEqual(
    groups[1].models.map((c) => c.id),
    ["a", "b", "old"],
  );
  assert.equal(groups[2].label, "My service");
  assert.ok(groups[1].models[1].personal);
  assert.equal(
    modelGroups([model("bad-url", { baseUrl: "bad" })])[0].label,
    "bad-url",
  );
});
