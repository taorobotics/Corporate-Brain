import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createPlatform } from "./platform";
import { parseAutomaticPlan } from "./automatic";
import {
  isCasualMessage,
  isModelIdentityQuestion,
} from "../shared/conversation-request";

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

test("model identity and version follow-ups use only relevant user context", () => {
  const u = (content: string) => ({ role: "user", content });
  for (const text of [
    "您好，我现在用的什么模型呢？",
    "你是什么模型？",
    "当前模型版本是多少？",
    "What model are you?",
    "您好，你是谁？",
    "你是谁呀？",
    "请介绍一下你自己",
    "Hi, who are you?",
  ])
    assert.equal(isModelIdentityQuestion([u(text)]), true, text);
  const identity = [u("您好，我现在用的什么模型呢？")];
  assert.equal(
    isModelIdentityQuestion([...identity, u("版本是多少啊？")]),
    true,
  );
  assert.equal(
    isModelIdentityQuestion([
      ...identity,
      u("版本是多少啊？"),
      u("？？版本号多少啊？"),
    ]),
    true,
  );
  for (const text of [
    "版本号多少？",
    "生成一个模型版本对比视频",
    "你是什么模型？顺便生成图片",
    "这个模型支持什么功能？",
    "分析模型性能",
    "读取项目中的模型配置",
    "公司大脑客户端版本是多少？",
    "您好，你是谁？顺便帮我读取项目文件",
    "你好，帮我介绍一下你自己的技能中心",
  ])
    assert.equal(isModelIdentityQuestion([u(text)]), false, text);
  assert.equal(
    isModelIdentityQuestion([
      ...identity,
      u("说明这个项目"),
      u("版本号多少？"),
    ]),
    false,
  );
  assert.equal(isModelIdentityQuestion(identity, 1), false);
  assert.equal(
    isModelIdentityQuestion([
      { role: "assistant", content: "当前模型是什么？" },
      u("版本多少？"),
    ]),
    false,
  );
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
  const identityHistory = [
    { role: "user", content: "您好，我现在用的什么模型呢？" },
  ];
  for (const content of [
    "您好，你是谁？",
    "您好，我现在用的什么模型呢？",
    "版本是多少啊？",
    "？？版本号多少啊？",
  ]) {
    const messages =
      content === identityHistory[0].content
        ? identityHistory
        : [...identityHistory, { role: "user", content }];
    const identityPlan = await post(
      "/generate/plan",
      {
        ...data,
        messages,
        project: { name: "Brain_Test", hasFolder: true },
        attachments: [{ name: "old-project.txt", source: "history" }],
        skillMode: "auto",
      },
      cookie,
    );
    assert.equal(identityPlan.status, 200);
    assert.equal(identityPlan.data.execution, "answer");
    assert.deepEqual(identityPlan.data.skillIds, []);
    assert.equal(identityPlan.data.workspaceContext, false);
    assert.equal(identityPlan.data.usePreviousAttachments, false);
    const identityResponse = await fetch(base + "/generate/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify({
        ...data,
        messages,
        execution: identityPlan.data.execution,
      }),
    });
    assert.equal(identityResponse.status, 200);
    const events = (await identityResponse.text())
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((v) => JSON.parse(v));
    const done = events.find((e) => e.type === "done");
    assert.match(done.content, /Selected chat model/);
    assert.match(done.content, /deepseek-v4-flash/);
    assert.equal(done.usage.totalTokens, 0);
    assert.equal(
      events.some((e) => ["reasoning", "tool", "error"].includes(e.type)),
      false,
    );
    assert.equal(
      upstream.length,
      0,
      "configuration questions work while the provider is unavailable",
    );
    identityHistory.push({ role: "user", content });
  }
  platform.store.db
    .prepare("UPDATE connections SET model='claude-sonnet-5-5' WHERE id=?")
    .run(connection.id);
  const switchedIdentity = await post(
    "/generate/chat",
    { ...data, messages: identityHistory },
    cookie,
  );
  assert.match(switchedIdentity.data.content, /claude-sonnet-5-5/);
  assert.doesNotMatch(switchedIdentity.data.content, /deepseek-v4-flash/);
  platform.store.db
    .prepare("UPDATE connections SET enabled=0 WHERE id=?")
    .run(connection.id);
  assert.equal(
    (
      await post(
        "/generate/plan",
        { ...data, messages: identityHistory },
        cookie,
      )
    ).status,
    403,
  );
  platform.store.db
    .prepare(
      "UPDATE connections SET enabled=1,model='deepseek-v4-flash' WHERE id=?",
    )
    .run(connection.id);
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
    calls = 0,
    transportCalls = 0,
    format = "json",
    failure = "";
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
    if (format === "unsupported" && payload.response_format) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { param: "response_format", message: "unsupported parameter" },
        }),
      );
      return;
    }
    if (format === "sse") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const content of [reply.slice(0, 10), reply.slice(10)])
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
        );
      res.end("data: [DONE]\n\n");
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const platform = createPlatform({
    database: ":memory:",
    modelTransport: async (_row, url, init) => {
      transportCalls++;
      if (failure.startsWith("reset")) {
        if (failure === "reset-once") failure = "";
        throw new TypeError("synthetic reset", {
          cause: { code: "ECONNRESET" },
        });
      }
      if (failure === "auth")
        return Response.json(
          { error: { message: "private provider detail" } },
          { status: 401 },
        );
      return fetch(url, init);
    },
  });
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
  format = "sse";
  const streamedPlan = await post("/generate/plan", body, employee);
  assert.equal(streamedPlan.status, 200);
  assert.equal(streamedPlan.data.mode, "ptc");
  format = "unsupported";
  let before = transportCalls;
  const compatibilityPlan = await post("/generate/plan", body, employee);
  assert.equal(compatibilityPlan.status, 200);
  assert.equal(compatibilityPlan.data.mode, "ptc");
  assert.equal(
    transportCalls - before,
    2,
    "unsupported JSON formatting negotiates once",
  );
  format = "json";
  failure = "reset-once";
  before = transportCalls;
  assert.equal((await post("/generate/plan", body, employee)).status, 200);
  assert.equal(transportCalls - before, 2);
  failure = "reset-always";
  before = transportCalls;
  const disconnectedPlan = await post("/generate/plan", body, employee);
  assert.equal(disconnectedPlan.status, 200);
  assert.equal(disconnectedPlan.data.routingFallback, true);
  assert.equal(disconnectedPlan.data.execution, "answer");
  assert.deepEqual(disconnectedPlan.data.skillIds, []);
  assert.equal(
    transportCalls - before,
    2,
    "persistent resets cannot create a retry loop",
  );
  failure = "auth";
  before = transportCalls;
  const denied = await post("/generate/plan", body, employee);
  assert.equal(denied.status, 502);
  assert.match(denied.data.error, /401/);
  assert.doesNotMatch(denied.data.error, /private provider detail/);
  assert.equal(transportCalls - before, 1, "credential errors are not retried");
  failure = "";
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
    assert.equal(response.status, 200);
    assert.equal(response.data.kind, "chat");
    assert.equal(response.data.execution, "answer");
    assert.equal(response.data.workspaceContext, false);
    assert.equal(response.data.usePreviousAttachments, false);
    assert.deepEqual(response.data.skillIds, []);
    assert.equal(response.data.connectionId, chat.id);
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

test("routing network and deadline failures allow a real answer while cancellation, configuration errors and partial replies never retry execution", async (t) => {
  let failure = "",
    routingCalls = 0,
    chatCalls = 0,
    agentCalls = 0;
  let lastChat: any;
  let routingStarted = () => {};
  const platform = createPlatform({
    database: ":memory:",
    routingTimeoutMs: 80,
    dsh: {
      runDetailed: async () => {
        agentCalls++;
        throw Error("Must not execute on fallback");
      },
      close: async () => {},
    },
    modelTransport: async (_row, _url, init) => {
      const body = JSON.parse(String(init.body));
      if (!body.messages[0].content.includes("You route tasks")) {
        chatCalls++;
        lastChat = body;
        if (failure === "chat-reset-once") {
          failure = "";
          throw new TypeError("Synthetic connection reset", {
            cause: { code: "ECONNRESET" },
          });
        }
        if (failure === "partial") {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"已收到的部分"}}]}\n\n',
                ),
              );
              controller.close();
            },
          });
          return new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return Response.json({
          choices: [
            {
              message: {
                content: "这是模型结合上下文与当前附件的真实测试回复。",
              },
            },
          ],
        });
      }
      routingCalls++;
      routingStarted();
      if (failure === "deadline" || failure === "cancel") {
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(init.signal!.reason);
          if (init.signal!.aborted) abort();
          else init.signal!.addEventListener("abort", abort, { once: true });
        });
      }
      if (failure === "body-deadline")
        return new Response(
          new ReadableStream({
            start(controller) {
              init.signal!.addEventListener(
                "abort",
                () => controller.error(init.signal!.reason),
                { once: true },
              );
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      if (failure.startsWith("http-"))
        return Response.json(
          { error: { message: "PRIVATE_UPSTREAM_DETAIL" } },
          { status: Number(failure.slice(5)) },
        );
      if (failure === "invalid")
        return Response.json({
          choices: [{ message: { content: "not a routing decision" } }],
        });
      if (failure)
        throw new TypeError("PRIVATE_CONNECTION_DETAIL", {
          cause: { code: failure },
        });
      return Response.json({
        choices: [
          { message: { content: '{"kind":"chat","execution":"answer"}' } },
        ],
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
  const post = async (path: string, body: any, cookie = "") => {
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
    username: "outage-qa",
    password: randomBytes(20).toString("hex"),
  };
  await post("/bootstrap", {
    ...account,
    name: "Outage QA",
    companyName: "Synthetic",
  });
  const cookie = (await post("/auth/login", account)).cookie;
  const connection = (
    await post(
      "/connections",
      {
        name: "Outage model",
        model: "claude-sonnet-5-5",
        baseUrl: "https://model.example/v1",
        kind: "chat",
        apiKey: "synthetic-only",
        departments: [],
      },
      cookie,
    )
  ).data;
  const messages = [
    { role: "user", content: "背景说明：这里讨论的是智能体。" },
    { role: "assistant", content: "可以结合工具理解。" },
    { role: "user", content: "结合这份附件解释一下区别" },
  ];
  const body = {
    connectionId: connection.id,
    messages,
    attachments: [{ name: "current.txt", source: "current" }],
    project: { name: "Old video task", hasFolder: true },
    skillMode: "auto",
  };
  for (const scenario of [
    "UND_ERR_CONNECT_TIMEOUT",
    "ECONNRESET",
    "EAI_AGAIN",
    "deadline",
    "body-deadline",
    "http-408",
    "http-429",
    "http-503",
    "invalid",
  ]) {
    failure = scenario;
    const before = routingCalls;
    const planned = await post("/generate/plan", body, cookie);
    assert.equal(planned.status, 200, scenario);
    assert.equal(planned.data.routingFallback, true, scenario);
    assert.equal(planned.data.execution, "answer");
    assert.equal(planned.data.workspaceContext, false);
    assert.equal(planned.data.usePreviousAttachments, false);
    assert.deepEqual(planned.data.skillIds, []);
    assert.equal(planned.data.connectionId, connection.id);
    assert.equal(
      routingCalls - before,
      ["UND_ERR_CONNECT_TIMEOUT", "ECONNRESET", "EAI_AGAIN"].includes(scenario)
        ? 2
        : 1,
    );
    const answer = await post(
      "/generate/chat",
      {
        connectionId: planned.data.connectionId,
        messages,
        execution: planned.data.execution,
        skillIds: planned.data.skillIds,
        attachments: [
          { name: "current.txt", content: "CURRENT_ATTACHMENT_FIXTURE" },
        ],
      },
      cookie,
    );
    assert.equal(answer.status, 200);
    assert.match(answer.data.content, /真实测试回复/);
    assert.match(JSON.stringify(lastChat.messages), /背景说明/);
    assert.match(
      JSON.stringify(lastChat.messages),
      /CURRENT_ATTACHMENT_FIXTURE/,
    );
    assert.equal(agentCalls, 0);
  }
  for (const status of [400, 401, 403, 404]) {
    failure = "http-" + status;
    const before = routingCalls;
    const denied = await post("/generate/plan", body, cookie);
    assert.equal(denied.status, 502);
    assert.match(denied.data.error, new RegExp(String(status)));
    assert.doesNotMatch(JSON.stringify(denied), /PRIVATE_UPSTREAM_DETAIL/);
    assert.equal(routingCalls - before, 1);
  }
  failure = "chat-reset-once";
  let beforeChat = chatCalls;
  const reply = await post(
    "/generate/chat",
    { connectionId: connection.id, messages, execution: "answer" },
    cookie,
  );
  assert.equal(reply.status, 200);
  assert.equal(
    chatCalls - beforeChat,
    2,
    "plain chat can recover a connection failure before receiving a reply",
  );
  failure = "partial";
  beforeChat = chatCalls;
  const partial = await fetch(base + "/generate/chat", {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify({
      connectionId: connection.id,
      messages,
      execution: "answer",
    }),
  });
  const events = (await partial.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((v) => JSON.parse(v));
  assert.ok(events.some((e) => e.type === "text" && e.text === "已收到的部分"));
  assert.ok(events.some((e) => e.type === "error"));
  assert.equal(
    chatCalls - beforeChat,
    1,
    "partial output is preserved without replaying the request",
  );
  failure = "cancel";
  const started = new Promise<void>((resolve) => {
    routingStarted = resolve;
  });
  const controller = new AbortController();
  const beforeRouting = routingCalls;
  const auditsBefore = (
    platform.store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE action LIKE 'model.task_routing_fallback.%'",
      )
      .get() as any
  ).n;
  const pending = fetch(base + "/generate/plan", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    routingCalls - beforeRouting,
    1,
    "cancelled requests do not retry",
  );
  assert.equal(
    (
      platform.store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit WHERE action LIKE 'model.task_routing_fallback.%'",
        )
        .get() as any
    ).n,
    auditsBefore,
    "cancellation does not become a fallback answer",
  );
  assert.equal(
    (
      platform.store.db
        .prepare("SELECT COUNT(*) AS n FROM production_tasks")
        .get() as any
    ).n,
    0,
  );
});
