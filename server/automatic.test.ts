import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createPlatform } from "./platform";
import { parseAutomaticPlan } from "./automatic";
import { isCasualMessage } from "../shared/conversation-request";

test("casual-turn detection excludes substantive requests, approvals and attachments", () => {
  for (const text of [
    "您好",
    "你好呀！",
    "你好👋",
    "Hello!",
    "在吗？",
    "谢谢你。",
    "晚安",
  ])
    assert.equal(isCasualMessage(text), true, text);
  for (const text of [
    "你好，帮我做一个视频",
    "您好，请读项目",
    "谢谢，继续",
    "好的",
    "继续",
    "hi-fi 音响",
    "hello world 网页",
    "分析这个文件",
  ])
    assert.equal(isCasualMessage(text), false, text);
  assert.equal(isCasualMessage("您好", 1), false);
});

test("greetings use one real provider reply without routing, coding-agent startup or output tasks", async (t) => {
  let agentCalls = 0;
  const upstream: any[] = [];
  const platform = createPlatform({
    database: ":memory:",
    dsh: {
      runDetailed: async () => {
        agentCalls++;
        return { content: "Unexpected video-rendering agent" };
      },
      close: async () => {},
    },
    modelTransport: async (_row, _url, init) => {
      const body = JSON.parse(String(init.body));
      upstream.push(body);
      if (body.messages[0]?.content.includes("You route tasks"))
        return Response.json({
          choices: [{ message: { content: '{"kind":"chat"}' } }],
        });
      return Response.json({
        choices: [{ message: { content: "您好！有什么我可以帮您？" } }],
        usage: { prompt_tokens: 8, completion_tokens: 10 },
      });
    },
  });
  const server = createServer(platform.app).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await platform.production.close();
    await platform.library.close();
    platform.store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const post = async (path: string, data: any, cookie = "") => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(data),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  const account = {
    username: "casual-qa",
    password: randomBytes(16).toString("hex"),
  };
  await post("/bootstrap", {
    ...account,
    name: "Casual QA",
    companyName: "Casual QA",
  });
  const cookie = (await post("/auth/login", account)).cookie;
  const connection = (
    await post(
      "/connections",
      {
        name: "Selected chat model",
        model: "deepseek-v4-flash",
        baseUrl: "https://model.example/v1",
        kind: "chat",
        apiKey: "synthetic-provider-key",
        departments: [],
      },
      cookie,
    )
  ).data;
  const data = {
    connectionId: connection.id,
    messages: [{ role: "user", content: "您好" }],
    attachments: [],
  };
  assert.equal((await post("/generate/plan", data)).status, 401);
  const plan = await post(
    "/generate/plan",
    { ...data, skillMode: "auto" },
    cookie,
  );
  assert.equal(plan.status, 200);
  assert.equal(plan.data.kind, "chat");
  assert.deepEqual(plan.data.skillIds, []);
  assert.equal(
    upstream.length,
    0,
    "greetings do not make a planning model call",
  );
  const response = await post("/generate/chat", data, cookie);
  assert.equal(response.status, 200);
  assert.match(response.data.content, /您好/);
  assert.equal(upstream.length, 1);
  assert.equal(agentCalls, 0);
  assert.equal(upstream[0].model, "deepseek-v4-flash");
  assert.deepEqual(upstream[0].thinking, { type: "disabled" });
  assert.equal("tools" in upstream[0], false);
  const greetingAfterWork = await post(
    "/generate/chat",
    {
      ...data,
      messages: [
        { role: "user", content: "OLD_VIDEO_TASK: create an animated video" },
        { role: "assistant", content: "Preparing a renderer" },
        { role: "user", content: "您好" },
      ],
    },
    cookie,
  );
  assert.match(greetingAfterWork.data.content, /您好/);
  assert.equal(
    JSON.stringify(upstream.at(-1)).includes("OLD_VIDEO_TASK"),
    false,
    "social turns do not revive an old task",
  );
  await post(
    "/generate/chat",
    {
      ...data,
      execution: "answer",
      messages: [
        { role: "user", content: "这里的术语是智能体" },
        { role: "assistant", content: "可以从工具调用理解这个术语" },
        { role: "user", content: "它和普通聊天有什么区别？" },
      ],
    },
    cookie,
  );
  assert.equal(
    agentCalls,
    0,
    "contextual text answers do not start the coding runtime",
  );
  assert.match(JSON.stringify(upstream.at(-1).messages), /这里的术语是智能体/);
  assert.equal(
    "thinking" in upstream.at(-1),
    false,
    "normal contextual answers retain provider thinking defaults",
  );
  assert.equal(
    platform.store.db
      .prepare("SELECT count(*) AS n FROM production_tasks")
      .get()!.n,
    0,
  );
  await post(
    "/generate/chat",
    {
      ...data,
      messages: [{ role: "user", content: "您好，请分析附件" }],
      attachments: [{ name: "brief.txt", content: "User provided material" }],
    },
    cookie,
  );
  assert.equal(
    agentCalls,
    1,
    "substantive requests retain the agent and attachment flow",
  );
  await post(
    "/generate/chat",
    {
      ...data,
      messages: [
        {
          role: "system",
          content: "Test the explicitly supplied skill instruction",
        },
        { role: "user", content: "您好" },
      ],
    },
    cookie,
  );
  assert.equal(
    agentCalls,
    2,
    "explicit skill trial instructions are not silently removed",
  );
});

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
  reply = JSON.stringify({
    kind: "chat",
    execution: "answer",
    workspaceContext: false,
    usePreviousAttachments: false,
  });
  const contextual = await post(
    "/generate/plan",
    {
      ...body,
      project: { name: "Video project", hasFolder: true },
      messages: [
        { role: "user", content: "先前讨论了一个视频" },
        { role: "assistant", content: "这是制作思路" },
        { role: "user", content: "换个话题，什么是智能体？" },
      ],
    },
    employee,
  );
  assert.equal(contextual.data.execution, "answer");
  assert.equal(contextual.data.workspaceContext, false);
  assert.equal(contextual.data.usePreviousAttachments, false);
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
