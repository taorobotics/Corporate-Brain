import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dshOutputFiles, dshRunGuard } from "./dsh-output";
import { createPlatform } from "./platform";
import { createServer } from "node:http";
import { once } from "node:events";

test("DSH tool budget counts actual calls once and never counts duplicate notifications or other employees", () => {
  let stopped = 0;
  const guard = dshRunGuard("mine", () => stopped++, 3);
  const call = (id: string, sessionId = "mine") =>
    guard({
      method: "session.event",
      params: {
        sessionId,
        event: {
          type: "tool/call",
          data: {
            callId: id,
            name: "read_image",
            arguments: '{"path":"preview.png"}',
          },
        },
      },
    });
  call("a");
  call("a");
  call("other", "another-employee");
  call("b");
  call("c");
  assert.equal(stopped, 0);
  call("d");
  assert.equal(stopped, 1);
});

test("DSH export discovery only includes bounded regular turn outputs and rejects links", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "brain-export-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "exports", randomUUID());
  await mkdir(join(output, "nested"), { recursive: true });
  await writeFile(join(output, "nested", "sticker.gif"), "GIF89a");
  await mkdir(join(output, ".venv"));
  await writeFile(join(output, ".venv", "private"), "excluded");
  assert.deepEqual(await dshOutputFiles(output), ["nested/sticker.gif"]);
  if (process.platform !== "win32") {
    await symlink(root, join(output, "outside"));
    await assert.rejects(dshOutputFiles(output), /链接/);
  }
});

test("chat stream hands real files to the submitting device and rejects exports from read-only workspaces", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "brain-export-http-")),
  );
  let seenDelivery = false;
  const platform = createPlatform({
    database: join(root, "platform.sqlite"),
    dsh: {
      close: async () => {},
      runDetailed: async (options) => {
        seenDelivery = Boolean(options.deliverFiles);
        const directory = join(root, randomUUID());
        await mkdir(directory);
        await writeFile(join(directory, "sticker.gif"), "GIF89a-fixture");
        return {
          content: "已生成动图文件。",
          output: { directory, files: ["sticker.gif"] },
        };
      },
    },
  });
  const server = createServer(platform.app).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await platform.production.close();
    platform.store.close();
    await rm(root, { recursive: true, force: true });
  });
  let cookie = "";
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const post = (path: string, body: unknown, stream = false) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(stream ? { Accept: "application/x-ndjson" } : {}),
      },
      body: JSON.stringify(body),
    });
  const account = {
    username: "export-fixture",
    password: "Local-Export-Only-2026",
  };
  await post("/bootstrap", {
    ...account,
    name: "隔离验收",
    companyName: "合成公司",
  });
  const login = await post("/auth/login", account);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const model = await (
    await post("/connections", {
      name: "fixture",
      model: "fixture",
      baseUrl: "https://models.invalid/v1",
      kind: "chat",
      apiKey: "local-fixture-only",
      departments: [],
    })
  ).json();
  const deviceId = randomUUID(),
    body = {
      connectionId: model.id,
      deviceId,
      messages: [{ role: "user", content: "生成 GIF 文件" }],
    };
  const response = await post("/generate/chat", body, true),
    events = (await response.text())
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const done = events.at(-1);
  assert.equal(done.type, "done");
  assert.ok(done.productionTaskId);
  assert.equal(seenDelivery, true);
  const tasks = await (
    await fetch(base + "/production", { headers: { Cookie: cookie } })
  ).json();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].deviceId, deviceId);
  assert.equal(tasks[0].kind, "files");
  assert.equal(tasks[0].status, "ready");
  const refused = await post("/generate/chat", {
    ...body,
    workspaceAccess: "view",
  });
  assert.equal(refused.status, 403);
  assert.equal(seenDelivery, false);
});
