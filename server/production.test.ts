import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProductionQueue, safeProductionPath } from "./production";
import { createPlatform } from "./platform";
import { createServer } from "node:http";
import { once } from "node:events";

async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  generate?: (...args: any[]) => Promise<string>,
) {
  const root = await mkdtemp(join(tmpdir(), "brain-production-")),
    db = new DatabaseSync(":memory:");
  const owner = randomUUID(),
    other = randomUUID(),
    deviceId = randomUUID(),
    connectionId = randomUUID();
  const queue = new ProductionQueue(db, {
    root,
    authorize: () => {},
    generate:
      generate ??
      (async () =>
        JSON.stringify({
          files: [
            { path: "README.md", content: "合成验收源码" },
            { path: "src/main.js", content: "console.log('example')" },
          ],
        })),
  });
  await queue.initialized;
  t.after(async () => {
    await queue.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  const create = (data = {}) =>
    queue.create(owner, {
      kind: "code",
      prompt: "生成代码",
      connectionId,
      deviceId,
      ...data,
    });
  const done = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const task = queue.list(owner).find((j) => j.id === id)!;
      if (["ready", "failed"].includes(task.status)) return task;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("Timed out waiting for generation");
  };
  return {
    queue,
    root,
    db,
    owner,
    other,
    deviceId,
    connectionId,
    create,
    done,
  };
}
test("source and materials stay until complete matching receipt; owner/device isolation and idempotent deletion", async (t) => {
  const { queue, owner, other, deviceId, create, done, root, db } =
    await fixture(t);
  const task = await create();
  await queue.start(owner, task.id);
  assert.equal((await done(task.id)).status, "ready");
  assert.equal(
    await readFile(join(root, owner, task.id, "code/src/main.js"), "utf8"),
    "console.log('example')",
  );
  assert.throws(() => queue.manifest(other, task.id, deviceId), /无权/);
  await assert.rejects(queue.cancel(other, task.id), /无权/);
  await assert.rejects(queue.download(other, task.id, deviceId, 0), /无权/);
  assert.throws(
    () => queue.manifest(owner, task.id, randomUUID()),
    /提交任务的电脑/,
  );
  const manifest = queue.manifest(owner, task.id, deviceId);
  await assert.rejects(
    queue.acknowledge(owner, task.id, {
      deviceId,
      token: manifest.token,
      files: manifest.files.slice(1),
    }),
    /不匹配/,
  );
  await stat(join(root, owner, task.id));
  await assert.rejects(
    queue.acknowledge(other, task.id, {
      deviceId,
      token: manifest.token,
      files: manifest.files,
    }),
    /无权/,
  );
  await queue.acknowledge(owner, task.id, {
    deviceId,
    token: manifest.token,
    files: manifest.files,
  });
  await assert.rejects(stat(join(root, owner, task.id)), { code: "ENOENT" });
  assert.equal(
    db.prepare("SELECT data FROM production_tasks WHERE id=?").get(task.id)!
      .data,
    "",
  );
  assert.equal(
    (
      await queue.acknowledge(owner, task.id, {
        deviceId,
        token: manifest.token,
        files: manifest.files,
      })
    ).status,
    "saved",
  );
});
test("rejects traversal, reserved paths, duplicate filenames and excess jobs", async (t) => {
  const { create, queue, owner } = await fixture(t);
  for (const name of [
    "../escape",
    "C:/Windows/a",
    "a\\b",
    "CON.txt",
    "/absolute",
    "a/../b",
    "trailing. ",
    "a\u0000b",
  ])
    assert.throws(() => safeProductionPath(name));
  await assert.rejects(create({ inputs: [{ name: "../escape", size: 10 }] }));
  await assert.rejects(
    create({
      inputs: [
        { name: "a.txt", size: 2 },
        { name: "A.txt", size: 2 },
      ],
    }),
  );
  const a = await create();
  await create();
  await create();
  await assert.rejects(create(), /最多/);
  await queue.cancel(owner, a.id);
  await create();
});
test("model source with unsafe paths is not executed or written outside its task", async (t) => {
  const { queue, owner, create, done } = await fixture(t, async () =>
    JSON.stringify({
      files: [{ path: "../../outside.txt", content: "unsafe" }],
    }),
  );
  const task = await create();
  await queue.start(owner, task.id);
  assert.equal((await done(task.id)).status, "failed");
});
test("cancellation aborts generation before removing all task files", async (t) => {
  let started = false;
  const { queue, owner, create, root } = await fixture(
    t,
    async (_owner, _connection, _messages, signal: AbortSignal) => {
      started = true;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(Error("cancelled")), {
          once: true,
        }),
      );
    },
  );
  const task = await create();
  await queue.start(owner, task.id);
  while (!started) await new Promise((r) => setTimeout(r, 5));
  assert.equal((await queue.cancel(owner, task.id)).status, "cancelled");
  await assert.rejects(stat(join(root, owner, task.id)), { code: "ENOENT" });
});
test("server restart preserves ready output and marks interrupted tasks retryable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "brain-production-restart-")),
    db = new DatabaseSync(join(root, "test.sqlite"));
  const owner = randomUUID(),
    deviceId = randomUUID(),
    connectionId = randomUUID();
  const options = {
    root: join(root, "tasks"),
    authorize: () => {},
    generate: async () =>
      JSON.stringify({ files: [{ path: "a.txt", content: "preserved" }] }),
  };
  const first = new ProductionQueue(db, options);
  await first.initialized;
  const task = await first.create(owner, {
    kind: "code",
    deviceId,
    connectionId,
    prompt: "test",
  });
  await first.start(owner, task.id);
  while (first.list(owner)[0].status !== "ready")
    await new Promise((r) => setTimeout(r, 10));
  await first.close();
  const second = new ProductionQueue(db, options);
  await second.initialized;
  assert.equal(
    second.manifest(owner, task.id, deviceId).files[0].path,
    "code/a.txt",
  );
  await second.close();
  db.close();
  await rm(root, { recursive: true, force: true });
});
test("production HTTP endpoints enforce login, Origin, declared uploads and model access", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "brain-production-http-"));
  const p = createPlatform({ database: join(root, "test.sqlite") }),
    server = createServer(p.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  t.after(async () => {
    await p.production.close();
    await p.library.close();
    server.close();
    p.store.close();
    await rm(root, { recursive: true, force: true });
  });
  const request = (path: string, body?: unknown, cookie = "", headers = {}) =>
    fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  assert.equal((await request("/production")).status, 401);
  const password = "Synthetic-Production-Verification-2026";
  await request("/bootstrap", {
    companyName: "验收部",
    username: "production-qa",
    name: "验收",
    password,
  });
  const login = await request("/auth/login", {
    username: "production-qa",
    password,
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const owner = (await login.json()).id;
  const connection = await request(
    "/connections",
    {
      name: "合成模型",
      baseUrl: "http://127.0.0.1:1",
      model: "fixture",
      kind: "chat",
      apiKey: "synthetic-placeholder",
    },
    cookie,
  );
  const connectionId = (await connection.json()).id,
    deviceId = randomUUID();
  const payload = {
    kind: "code",
    connectionId,
    deviceId,
    prompt: "test",
    inputs: [{ name: "example.txt", size: 4 }],
  };
  assert.equal(
    (
      await request("/production", payload, cookie, {
        Origin: "https://untrusted.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/production",
        { ...payload, connectionId: randomUUID() },
        cookie,
      )
    ).status,
    403,
  );
  const task = await (await request("/production", payload, cookie)).json();
  const upload = await fetch(base + `/api/production/${task.id}/materials/0`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", Cookie: cookie },
    body: "test",
  });
  assert.equal(upload.status, 200);
  assert.equal(
    await readFile(
      join(root, "production", owner, task.id, "materials/example.txt"),
      "utf8",
    ),
    "test",
  );
  const badUpload = await fetch(
    base + `/api/production/${task.id}/materials/0`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", Cookie: cookie },
      body: "123",
    },
  );
  assert.equal(badUpload.status, 400);
  await request(`/production/${task.id}/cancel`, {}, cookie);
});
