import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createPlatform } from "./platform";
import { NasError } from "./nas";

test("conversation uses the real authorized skill center and NAS service, with contextual paths and revocation", async (t) => {
  const modelCalls: any[] = [],
    nasCalls: any[] = [];
  let route: any,
    failNas = false,
    block: (() => Promise<void>) | undefined,
    agentCalls = 0;
  const platform = createPlatform({
    database: ":memory:",
    dsh: {
      close: async () => {},
      runDetailed: async () => {
        agentCalls++;
        return { content: "unexpected agent" };
      },
    },
    modelTransport: async (_row, _url, init) => {
      const body = JSON.parse(String(init.body));
      modelCalls.push(body);
      return Response.json({
        choices: [
          {
            message: {
              content: body.messages[0]?.content.includes("You route tasks")
                ? JSON.stringify(route)
                : "依据真实公司查询结果回复",
            },
          },
        ],
      });
    },
    nas: {
      list: async (source, path, search, signal) => {
        nasCalls.push({ path, search });
        assert.equal(source.password, "synthetic-nas-password");
        if (block) await block();
        signal.throwIfAborted();
        if (failNas) throw new NasError("CONNECTION_FAILED");
        return {
          entries: [
            {
              name: path ? "操作说明.txt" : "研发手册",
              directory: !path,
              blocked: false,
              bytes: 0,
              modified: null,
            },
          ],
          truncated: false,
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
    await platform.library.close();
    platform.store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const request = async (
    path: string,
    body?: any,
    cookie = "",
    method = body === undefined ? "GET" : "POST",
  ) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  const password = randomBytes(20).toString("hex");
  await request("/bootstrap", {
    companyName: "合成公司",
    name: "管理员",
    username: "catalog-admin",
    password,
  });
  const admin = (
    await request("/auth/login", { username: "catalog-admin", password })
  ).cookie;
  const depA = (await request("/departments", { name: "合成研发" }, admin))
      .data,
    depB = (await request("/departments", { name: "合成财务" }, admin)).data;
  async function employee(username: string, departmentId: string) {
    const u = (
      await request("/users", { username, name: username, departmentId }, admin)
    ).data;
    const first = (
      await request("/auth/login", { username, password: u.initialPassword })
    ).cookie;
    await request(
      "/auth/password",
      { current: u.initialPassword, password },
      first,
    );
    return (await request("/auth/login", { username, password })).cookie;
  }
  const a = await employee("catalog-a", depA.id),
    b = await employee("catalog-b", depB.id);
  async function skill(name: string, departments: string[] = []) {
    const s = (
      await request(
        "/skills",
        {
          name,
          description: name + "描述",
          version: "1.0.0",
          instructions: "DO_NOT_EXECUTE_CATALOG_INSTRUCTIONS",
          examples: "",
          testSummary: "合成验收",
          requiredTools: [],
          audience: departments.length ? "departments" : "company",
          targetDepartments: departments,
        },
        admin,
      )
    ).data;
    assert.ok(s.id);
    await request(
      `/skills/${s.id}/review`,
      { approve: true, note: "合成审核" },
      admin,
    );
    return s;
  }
  const common = await skill("公开写作技能"),
    research = await skill("研发技能", [depA.id]),
    finance = await skill("PRIVATE_FINANCE_SKILL", [depB.id]);
  const connection = (
    await request(
      "/connections",
      {
        name: "合成模型",
        baseUrl: "https://model.invalid/v1",
        model: "fixture",
        kind: "chat",
        apiKey: "fixture",
        departments: [],
      },
      admin,
    )
  ).data;
  async function source(name: string, departmentId: string) {
    return (
      await request(
        "/admin/knowledge",
        {
          name,
          host: "192.168.20.16",
          share: "synthetic-share",
          basePath: "",
          username: "synthetic-nas-user",
          password: "synthetic-nas-password",
          departmentIds: [departmentId],
          enabled: true,
        },
        admin,
      )
    ).data;
  }
  const sa = await source("研发资料", depA.id),
    sb = await source("PRIVATE_FINANCE_SOURCE", depB.id);
  const messages = [{ role: "user", content: "现在有哪些技能或者skills？" }];
  route = {
    kind: "chat",
    execution: "answer",
    workspaceContext: false,
    skillIds: [],
    companyLookup: { skills: true },
  };
  const planned = await request(
    "/generate/plan",
    {
      connectionId: connection.id,
      messages,
      skillMode: "manual",
      skillIds: [common.id],
    },
    a,
  );
  assert.equal(planned.status, 200);
  assert.deepEqual(
    planned.data.skillIds,
    [],
    "catalog lookup must not execute manually selected workflows",
  );
  const routedContext = JSON.parse(modelCalls.at(-1).messages[1].content);
  assert.deepEqual(
    routedContext.companySources.map((s: any) => s.id),
    [sa.id],
  );
  const chat = (lookup: any, cookie = a, extra: any = {}) =>
    request(
      "/generate/chat",
      {
        connectionId: connection.id,
        messages,
        skillIds: [],
        execution: "answer",
        companyLookup: lookup,
        installedSkillIds: [common.id],
        ...extra,
      },
      cookie,
    );
  assert.equal((await chat({ skills: true })).status, 200);
  const inventory = JSON.stringify(modelCalls.at(-1).messages);
  assert.ok(
    inventory.includes(common.name) && inventory.includes(research.name),
  );
  assert.ok(
    !inventory.includes(finance.name) &&
      !inventory.includes("DO_NOT_EXECUTE_CATALOG_INSTRUCTIONS"),
  );
  const system = modelCalls
    .at(-1)
    .messages.find((m: any) => m.content.startsWith("公司平台实时查询结果"));
  const result = JSON.parse(system.content.split("\n")[1]);
  assert.equal(
    result.skills.entries.find((s: any) => s.id === common.id).installed,
    true,
  );
  assert.equal(
    result.skills.entries.find((s: any) => s.id === research.id).installed,
    false,
  );
  assert.equal(agentCalls, 0);
  assert.equal(nasCalls.length, 0);

  await t.test(
    "NAS root, child directory and name filter come from NAS, without credential disclosure",
    async () => {
      assert.equal((await chat({ knowledge: "browse" })).status, 200);
      let text = JSON.stringify(modelCalls.at(-1).messages);
      assert.ok(text.includes("研发手册"));
      for (const marker of [
        "PRIVATE_FINANCE_SOURCE",
        "192.168.20.16",
        "synthetic-share",
        "synthetic-nas-user",
        "synthetic-nas-password",
      ])
        assert.ok(!text.includes(marker), marker);
      const previous = {
        knowledge: "browse",
        directories: [{ sourceId: sa.id, path: "", search: "" }],
      };
      route = {
        kind: "chat",
        execution: "answer",
        workspaceContext: false,
        skillIds: [],
        companyLookup: {
          knowledge: "browse",
          directories: [{ sourceId: sa.id, path: "研发手册", search: "说明" }],
        },
      };
      const plan = await request(
        "/generate/plan",
        {
          connectionId: connection.id,
          messages: [{ role: "user", content: "打开刚才那个研发手册，找说明" }],
          previousCompanyLookup: previous,
        },
        a,
      );
      assert.equal(plan.status, 200);
      assert.deepEqual(
        JSON.parse(modelCalls.at(-1).messages[1].content).previousCompanyLookup,
        previous,
      );
      assert.equal((await chat(plan.data.companyLookup)).status, 200);
      assert.deepEqual(nasCalls.at(-1), { path: "研发手册", search: "说明" });
      assert.ok(
        JSON.stringify(modelCalls.at(-1).messages).includes("操作说明.txt"),
      );
      assert.equal(agentCalls, 0);
    },
  );
  await t.test(
    "forged source IDs, invalid paths, unauthorized departments and absent access never query NAS",
    async () => {
      const n = nasCalls.length,
        m = modelCalls.length;
      assert.equal(
        (
          await chat({
            knowledge: "browse",
            directories: [{ sourceId: sb.id, path: "" }],
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await chat({
            knowledge: "browse",
            directories: [{ sourceId: sa.id, path: "../private" }],
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await chat(
            {
              knowledge: "browse",
              directories: [{ sourceId: sa.id, path: "" }],
            },
            b,
          )
        ).status,
        404,
      );
      assert.equal(nasCalls.length, n);
      assert.equal(modelCalls.length, m);
      assert.equal(
        (await chat({ knowledge: "browse" }, admin)).status,
        200,
        "admin does not imply NAS document access",
      );
      assert.equal(nasCalls.length, n);
      route = {
        kind: "chat",
        companyLookup: {
          knowledge: "browse",
          directories: [{ sourceId: sb.id, path: "" }],
        },
      };
      assert.equal(
        (
          await request(
            "/generate/plan",
            { connectionId: connection.id, messages },
            a,
          )
        ).status,
        502,
      );
    },
  );
  await t.test(
    "NAS failure is reported as a failure rather than an empty directory or local-project fallback",
    async () => {
      failNas = true;
      assert.equal((await chat({ knowledge: "browse" })).status, 200);
      failNas = false;
      const text = JSON.stringify(modelCalls.at(-1).messages);
      assert.ok(text.includes("NAS 连接失败"));
      assert.ok(!text.includes("研发手册"));
    },
  );
  await t.test(
    "in-flight source revocation aborts before any company result is sent to the model",
    async () => {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((r) => (entered = r)),
        waiting = new Promise<void>((r) => (release = r));
      block = () => {
        entered();
        return waiting;
      };
      const n = modelCalls.length,
        pending = chat({ knowledge: "browse" });
      await started;
      platform.store.db
        .prepare(
          "UPDATE nas_sources SET enabled=0,revision=revision+1 WHERE id=?",
        )
        .run(sa.id);
      release();
      assert.equal((await pending).status, 409);
      assert.equal(modelCalls.length, n);
      block = undefined;
    },
  );
});
