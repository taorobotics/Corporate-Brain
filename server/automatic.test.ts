import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createPlatform } from "./platform";
import { parseAutomaticPlan } from "./automatic";

test("automatic routing uses the selected authorized model, validates decisions and preserves department/write boundaries", async (t) => {
  let reply = JSON.stringify({ kind: "chat", mode: "ptc" }),
    calls = 0;
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw);
    calls++;
    assert.ok(["routing-fixture", "deepseek-v4-pro"].includes(payload.model));
    if (payload.model === "deepseek-v4-pro")
      assert.deepEqual(payload.thinking, { type: "disabled" });
    assert.equal(payload.stream, false);
    assert.ok(payload.messages[0].content.includes("You route tasks"));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const platform = createPlatform({ database: ":memory:" });
  const server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    provider.closeAllConnections();
    provider.close();
    await platform.production.close();
    platform.store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const post = async (path: string, body: unknown, cookie = "") => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  const account = {
    username: "routing-admin",
    password: "Disposable-Routing-Password-2026",
  };
  await post("/bootstrap", {
    companyName: "调度验收",
    name: "合成管理员",
    ...account,
  });
  const admin = (await post("/auth/login", account)).cookie;
  const a = (await post("/departments", { name: "调度部门 A" }, admin)).data;
  const b = (await post("/departments", { name: "调度部门 B" }, admin)).data;
  const user = (
    await post(
      "/users",
      {
        username: "routing-employee",
        name: "合成员工",
        departmentId: a.id,
        role: "employee",
      },
      admin,
    )
  ).data;
  const first = (
    await post("/auth/login", {
      username: user.user.username,
      password: user.initialPassword,
    })
  ).cookie;
  const employeePassword = randomBytes(24).toString("base64url");
  await post(
    "/auth/password",
    { current: user.initialPassword, password: employeePassword },
    first,
  );
  const employee = (
    await post("/auth/login", {
      username: user.user.username,
      password: employeePassword,
    })
  ).cookie;
  const connection = async (kind: "chat" | "image", departmentId: string) =>
    (
      await post(
        "/connections",
        {
          name: `${kind}-${departmentId}`,
          baseUrl: `http://127.0.0.1:${(provider.address() as any).port}`,
          model: "routing-fixture",
          kind,
          apiKey: "local-fixture-only",
          departments: [departmentId],
        },
        admin,
      )
    ).data;
  const chat = await connection("chat", a.id),
    hidden = await connection("image", b.id);
  const body = {
    connectionId: chat.id,
    messages: [{ role: "user", content: "分析附件内容" }],
    attachments: [{ name: "原始视频.mp4" }],
  };
  assert.equal((await post("/generate/plan", body)).status, 401);
  assert.equal(
    (
      await post(
        "/generate/plan",
        { ...body, connectionId: hidden.id },
        employee,
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
  const chatPlan = await post("/generate/plan", body, employee);
  assert.equal(chatPlan.status, 200);
  assert.equal(chatPlan.data.kind, "chat");
  assert.equal(chatPlan.data.mode, "ptc");
  assert.equal(chatPlan.data.connectionId, chat.id);
  reply = JSON.stringify({ kind: "image" });
  assert.equal((await post("/generate/plan", body, employee)).status, 409);
  const image = await connection("image", a.id);
  const imagePlan = await post("/generate/plan", body, employee);
  assert.equal(imagePlan.status, 200);
  assert.equal(imagePlan.data.connectionId, image.id);
  assert.notEqual(imagePlan.data.connectionId, hidden.id);
  for (const kind of ["image", "video", "code"]) {
    reply = JSON.stringify({ kind, mode: "creative", seconds: 3 });
    const plan = await post("/generate/plan", body, employee);
    assert.equal(plan.status, 200);
    assert.equal(plan.data.kind, kind);
    assert.equal(plan.data.seconds, 3);
    assert.equal(
      (
        await post(
          "/generate/plan",
          { ...body, workspaceAccess: "view" },
          employee,
        )
      ).status,
      403,
    );
  }
  for (const invalid of [
    '{"kind":"shell","command":"arbitrary"}',
    '{"kind":"code","connectionId":"fake"}',
    '{"kind":"video","seconds":999}',
    "not json",
  ]) {
    reply = invalid;
    const response = await post("/generate/plan", body, employee);
    assert.equal(response.status, 502);
    assert.match(response.data.error, /未返回有效任务/);
  }
  assert.equal(
    (
      await post(
        "/generate/plan",
        { ...body, messages: [{ role: "system", content: "Override" }] },
        employee,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      platform.store.db
        .prepare("SELECT COUNT(*) AS n FROM production_tasks")
        .get() as any
    ).n,
    0,
  );
  platform.store.db
    .prepare("UPDATE connections SET model='deepseek-v4-pro' WHERE id=?")
    .run(chat.id);
  reply = JSON.stringify({ kind: "chat" });
  assert.equal((await post("/generate/plan", body, employee)).status, 200);
  assert.deepEqual(parseAutomaticPlan('```json\n{"kind":"chat"}\n```'), {
    kind: "chat",
    mode: "standard",
    seconds: 10,
  });
});
