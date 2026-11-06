import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelProduction, submitAutomaticProduction } from "./automatic";
import type { AutomaticPlan } from "../shared/automatic";

const plan: AutomaticPlan = {
  kind: "code",
  mode: "standard",
  seconds: 2,
  connectionId: "fixture",
};
test("stop during task creation still receives and cancels the created ID without starting it", async (t) => {
  const previous = (globalThis as any).window;
  (globalThis as any).window = {
    brainDesktop: {
      production: {
        workspaceFolders: true,
        state: async () => ({ deviceId: "local", directory: "/fixture" }),
      },
    },
  };
  t.after(() => {
    (globalThis as any).window = previous;
  });
  const controller = new AbortController(),
    routes: string[] = [],
    statuses: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    routes.push(url);
    if (url === "/api/production") {
      assert.equal(init.signal?.aborted, false);
      controller.abort();
      return Response.json({ id: "created", status: "uploading" });
    }
    assert.equal(url, "/api/production/created/cancel");
    assert.deepEqual(JSON.parse(String(init.body)), { activeOnly: true });
    assert.equal(init.signal?.aborted, false);
    return Response.json({ id: "created", status: "cancelled" });
  });
  await assert.rejects(
    submitAutomaticProduction(
      "user",
      plan,
      "Synthetic request",
      [],
      controller.signal,
      (task) => statuses.push(task.status),
    ),
    { name: "AbortError" },
  );
  assert.deepEqual(routes, [
    "/api/production",
    "/api/production/created/cancel",
  ]);
  assert.deepEqual(statuses, ["uploading", "cancelled"]);
});
test("stop retries a just-aborted upload lock and reports actual cancellation failures", async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++attempts === 1)
      return Response.json(
        { error: "当前正在传输，请完成后重试" },
        { status: 409 },
      );
    return Response.json({ id: "upload", status: "cancelled" });
  });
  assert.equal((await cancelProduction("upload")).status, "cancelled");
  assert.equal(attempts, 2);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "无权访问" }, { status: 403 }),
  );
  await assert.rejects(cancelProduction("other"), /无权访问/);
});
