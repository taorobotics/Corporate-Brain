import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { communityCatalog, readCommunityCatalog } from "./community-plugins";
import { createPlatform } from "./platform";
import { DshManager } from "./dsh";
// @ts-expect-error Reviewed server-only upstream module has no TypeScript declarations.
import { evaluate } from "./vendor/calculator.mjs";
// @ts-expect-error Runtime entry is loaded as a Cordis module.
import { paceResult } from "./community-plugin-runtime.mjs";

const fixture = {
  categories: { ui: { zh: "界面增强" } },
  plugins: [
    {
      name: "Community example",
      owner: "sample",
      url: "https://github.com/sample/plugin",
      category: ["ui"],
      description: { zh: "社区目录合成测试" },
      install: "ignore this command",
      version: "1.0.0",
    },
  ],
};

test("community catalog only exposes public repository metadata, never install commands or executable URLs", () => {
  const result = readCommunityCatalog({
    ...fixture,
    plugins: [
      ...fixture.plugins,
      { ...fixture.plugins[0], url: "https://127.0.0.1/private" },
      { ...fixture.plugins[0], url: "https://password@github.com/a/b" },
      { ...fixture.plugins[0], url: "javascript:alert(1)" },
      { ...fixture.plugins[0], url: "https://github.com/SAMPLE/PLUGIN" },
    ],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].availability, "pending");
  assert.equal(result[0].category, "界面增强");
  assert.equal("install" in result[0], false);
  assert.equal(result[0].installed, false);
  assert.throws(() => readCommunityCatalog({ plugins: [] }));
  assert.equal(
    readCommunityCatalog({
      plugins: [
        ...fixture.plugins,
        { ...fixture.plugins[0], name: "Second package in same repository" },
      ],
    }).length,
    2,
  );
});

test("catalog reads share one bounded request, cache successful metadata and fall back only to a fixed source", async (t) => {
  let now = Date.now(),
    unavailable = false;
  t.mock.method(Date, "now", () => now);
  const calls: string[] = [];
  const catalog = communityCatalog(async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.redirect, "error");
    if (calls.length === 1 || unavailable)
      return new Response("down", { status: 503 });
    return Response.json(fixture);
  });
  const [a, b] = await Promise.all([catalog(), catalog()]);
  assert.deepEqual(a, b);
  assert.equal(calls.length, 2);
  await catalog();
  assert.equal(calls.length, 2);
  assert.ok(
    calls[1].startsWith("https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/"),
  );
  unavailable = true;
  now += 70000;
  const stale = await Promise.all([catalog(true), catalog(true)]);
  assert.ok(stale.every((result) => result?.warning?.includes("上次成功")));
  assert.equal(calls.length, 4);
  assert.ok((await catalog())?.warning);
  assert.equal(calls.length, 4);
});

test("community adapters calculate real values and reject code, prototype access, nonfinite and invalid time inputs", () => {
  assert.equal(evaluate("(15+27)*sqrt(9)"), 126);
  assert.equal(evaluate("2**3**2"), 512);
  for (const input of [
    "process.exit()",
    "constructor(1)",
    "__proto__",
    "1/0",
    "sqrt(-1)",
    "1;2",
    "(".repeat(501),
  ])
    assert.throws(() => evaluate(input));
  assert.equal(paceResult({ distance: 5, minutes: 30 }).pace, "6分00秒/公里");
  assert.equal(
    paceResult({ distance: 0.1, minutes: 0, seconds: 30 }).speedKmh,
    12,
  );
  assert.throws(() => paceResult({ distance: 0, minutes: 30 }));
  assert.throws(() => paceResult({ distance: 5, minutes: 0 }));
});

test("plugin installation is per employee, survives repeated install and checks auth, CSRF, enabled state and routing", async (t) => {
  let requests: any[] = [],
    executions: any[] = [],
    catalogRequests = 0;
  const platform = createPlatform({
    database: ":memory:",
    communityFetch: async () => {
      catalogRequests++;
      return Response.json(fixture);
    },
    modelTransport: async (_row, _url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                kind: "chat",
                mode: "standard",
                seconds: 10,
                execution: "answer",
                pluginIds: ["calculator"],
              }),
            },
          },
        ],
      });
    },
    dsh: {
      runDetailed: async (options) => {
        executions.push(options);
        return { content: "工具调用合成回复" };
      },
      close: async () => {},
    },
  });
  const server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    platform.store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  async function request(
    path: string,
    cookie = "",
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    origin?: string,
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Cookie: cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(origin ? { Origin: origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  await request("/bootstrap", "", {
    companyName: "插件验收",
    username: "admin",
    name: "管理员",
    password: "Community-test-password-2026",
  });
  const admin = (
    await request("/auth/login", "", {
      username: "admin",
      password: "Community-test-password-2026",
    })
  ).cookie;
  const department = (await request("/departments", admin, { name: "开发部" }))
    .data;
  async function employee(username: string) {
    const initial = (
      await request("/users", admin, {
        username,
        name: username,
        departmentId: department.id,
        role: "employee",
      })
    ).data;
    let cookie = (
      await request("/auth/login", "", {
        username,
        password: initial.initialPassword,
      })
    ).cookie;
    await request("/auth/password", cookie, {
      current: initial.initialPassword,
      password: "Employee-test-password-2026",
    });
    cookie = (
      await request("/auth/login", "", {
        username,
        password: "Employee-test-password-2026",
      })
    ).cookie;
    return { cookie, id: initial.user.id };
  }
  const a = await employee("employee-a"),
    b = await employee("employee-b");
  assert.equal((await request("/community-plugins")).status, 401);
  assert.equal(
    (await request("/community-plugins?source=http://127.0.0.1", a.cookie))
      .status,
    400,
  );
  assert.equal(
    (await request("/community-plugins", a.cookie)).data.items.length,
    2,
  );
  assert.equal(catalogRequests, 0);
  assert.equal(
    (await request("/community-plugins?scope=community", a.cookie)).data.total,
    3,
  );
  assert.equal(
    (await request("/community-plugins?scope=community&text=合成", a.cookie))
      .data.total,
    1,
  );
  assert.equal(
    (
      await request("/community-plugins/calculator/install", a.cookie, {
        userId: b.id,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/community-plugins/calculator/install",
        a.cookie,
        {},
        "POST",
        "https://wrong.invalid",
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("/community-plugins/unreviewed/install", a.cookie, {}))
      .status,
    409,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await request("/community-plugins/calculator/install", a.cookie, {}))
        .status,
      200,
    );
  assert.equal(
    (await request("/community-plugins?scope=installed", a.cookie)).data.total,
    1,
  );
  assert.equal(
    (await request("/community-plugins?scope=installed", b.cookie)).data.total,
    0,
  );
  const connection = (
    await request("/connections", admin, {
      name: "合成插件模型",
      kind: "chat",
      baseUrl: "https://model.invalid/v1",
      model: "synthetic",
      apiKey: "synthetic-placeholder",
      departments: [department.id],
    })
  ).data;
  const plan = await request("/generate/plan", a.cookie, {
    connectionId: connection.id,
    messages: [{ role: "user", content: "帮我计算15加27" }],
  });
  assert.equal(plan.status, 200);
  assert.equal(plan.data.execution, "agent");
  assert.deepEqual(plan.data.pluginIds, ["calculator"]);
  assert.equal(
    JSON.parse(requests.at(-1).messages[1].content).availablePlugins[0].id,
    "calculator",
  );
  const generate = {
    connectionId: connection.id,
    messages: [{ role: "user", content: "计算15加27" }],
    execution: "answer",
    pluginIds: ["calculator"],
  };
  assert.equal(
    (await request("/generate/chat", a.cookie, generate)).status,
    200,
  );
  assert.deepEqual(executions.at(-1).communityPlugins, ["calculator"]);
  assert.equal(
    (await request("/generate/chat", b.cookie, generate)).status,
    403,
  );
  await request("/community-plugins/calculator/enabled", a.cookie, {
    enabled: false,
  });
  assert.equal(
    (await request("/generate/chat", a.cookie, generate)).status,
    403,
  );
  assert.equal(
    (
      await request("/generate/plan", a.cookie, {
        connectionId: connection.id,
        messages: [{ role: "user", content: "您好" }],
      })
    ).status,
    200,
  );
  const removed = await request(
    "/community-plugins/calculator",
    a.cookie,
    {},
    "DELETE",
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  assert.equal(
    (await request("/community-plugins?scope=installed", a.cookie)).data.total,
    0,
  );
  assert.equal(
    (
      await request("/community-plugins/calculator/enabled", a.cookie, {
        enabled: true,
      })
    ).status,
    404,
  );
});

test(
  "real SDK plugin invocation returns results and removes tools when the same conversation changes its selection",
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "brain-community-sdk-"));
    const manager = new DshManager(root);
    let calls = 0;
    const toolsSeen: string[][] = [];
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const payload = JSON.parse(raw);
      calls++;
      toolsSeen.push((payload.tools ?? []).map((t: any) => t.function?.name));
      const tool = payload.messages.findLast((m: any) => m.role === "tool");
      const delta =
        calls === 1
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "calc-1",
                  type: "function",
                  function: {
                    name: "calculator",
                    arguments: '{"expression":"(15+27)*sqrt(9)"}',
                  },
                },
              ],
            }
          : { role: "assistant", content: tool ? "计算结果126" : "插件已移除" };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: calls === 1 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(async () => {
      await manager.close();
      server.close();
      await rm(root, { recursive: true, force: true });
    });
    const options = {
      connectionId: "proof",
      userId: "proof",
      sessionId: "same",
      baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
      model: "proof",
      apiKey: "synthetic",
      messages: [{ role: "user" as const, content: "计算这个表达式" }],
      attachments: [],
      communityPlugins: ["calculator"],
    };
    assert.equal((await manager.runDetailed(options)).content, "计算结果126");
    assert.ok(toolsSeen[0].includes("calculator"));
    assert.equal(
      (await manager.runDetailed({ ...options, communityPlugins: [] })).content,
      "插件已移除",
    );
    assert.equal(toolsSeen.at(-1)!.includes("calculator"), false);
  },
);
