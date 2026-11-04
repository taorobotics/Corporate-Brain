import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createPlatform } from "./platform";

test("installed candidates route multiple skills and all execution paths recheck authorization", async (t) => {
  const calls: any[] = [];
  let route: any = { kind: "chat", skillIds: [] };
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    calls.push({ path: req.url, ...body });
    res.setHeader("Content-Type", "application/json");
    const system = body.messages?.[0]?.content ?? "";
    if (req.url?.endsWith("/images/generations"))
      res.end(JSON.stringify({ data: [{ b64_json: "aW5lcnQ=" }] }));
    else {
      const content = system.includes("You route tasks")
        ? JSON.stringify(route)
        : system.includes("Plan the production task")
          ? JSON.stringify({
              title: "合成测试计划",
              brief: "合成的代码生成计划",
            })
          : system.includes('Return ONLY JSON {"files"')
            ? JSON.stringify({
                files: [{ path: "README.md", content: "Fixture only" }],
              })
            : "多技能对话完成";
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const root = await mkdtemp(join(tmpdir(), "brain-multi-skills-"));
  const previousDsh = process.env.BRAIN_DSH_ENABLED;
  process.env.BRAIN_DSH_ENABLED = "0";
  const platform = createPlatform({
    database: join(root, "test.sqlite"),
    skillLibrary: { root: join(root, "skills") },
  });
  t.after(() => {
    if (previousDsh === undefined) delete process.env.BRAIN_DSH_ENABLED;
    else process.env.BRAIN_DSH_ENABLED = previousDsh;
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
    await platform.library.close();
    platform.store.close();
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  let cookie = "";
  const req = async (path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  await req("/bootstrap", {
    companyName: "多技能验收",
    name: "合成管理员",
    username: "multi-admin",
    password: "Disposable-Multi-Skill-2026",
  });
  cookie = (
    await req("/auth/login", {
      username: "multi-admin",
      password: "Disposable-Multi-Skill-2026",
    })
  ).cookie;
  const skill = async (
    name: string,
    audience = "company",
    targetDepartments: string[] = [],
  ) => {
    const value = await req("/skills", {
      name,
      description: name + "的测试流程",
      version: "1.0.0",
      instructions: name + "-instruction: 先分析目标，再输出完整结果。",
      examples: "合成示例",
      testSummary: "合成验收",
      requiredTools: [],
      audience,
      targetDepartments,
    });
    assert.equal(value.status, 201);
    assert.equal(
      (
        await req(`/skills/${value.data.id}/review`, {
          approve: true,
          note: "合成审核",
        })
      ).status,
      200,
    );
    return value.data;
  };
  const a = await skill("写作流程"),
    b = await skill("版式流程"),
    notInstalled = await skill("未安装流程");
  const connection = async (kind: string) =>
    (
      await req("/connections", {
        name: kind,
        baseUrl: `http://127.0.0.1:${(provider.address() as any).port}`,
        model: "fixture",
        kind,
        apiKey: "synthetic-fixture",
        departments: [],
      })
    ).data;
  const chat = await connection("chat"),
    image = await connection("image");
  const messages = [
    { role: "user", content: "结合写作和版式两个流程整理这份内容" },
  ];
  route = { kind: "chat", skillIds: [a.id, b.id] };
  const auto = await req("/generate/plan", {
    connectionId: chat.id,
    messages,
    skillMode: "auto",
    skillIds: [a.id, b.id],
  });
  assert.equal(auto.status, 200);
  assert.deepEqual(auto.data.skillIds, [a.id, b.id]);
  const metadata = JSON.parse(calls.at(-1).messages.at(-1).content);
  assert.deepEqual(
    metadata.availableSkills.map((s: any) => s.id),
    [a.id, b.id],
  );
  assert.ok(!JSON.stringify(metadata).includes(a.instructions));
  route = { kind: "chat", skillIds: [notInstalled.id] };
  assert.equal(
    (
      await req("/generate/plan", {
        connectionId: chat.id,
        messages,
        skillMode: "auto",
        skillIds: [a.id, b.id],
      })
    ).status,
    502,
  );
  route = { kind: "chat", skillIds: [] };
  const manual = await req("/generate/plan", {
    connectionId: chat.id,
    messages,
    skillMode: "manual",
    skillIds: [b.id, a.id, b.id],
  });
  assert.deepEqual(manual.data.skillIds, [b.id, a.id]);
  assert.equal(
    (
      await req("/generate/chat", {
        connectionId: chat.id,
        messages,
        skillIds: manual.data.skillIds,
      })
    ).status,
    200,
  );
  for (const s of [a, b])
    assert.ok(JSON.stringify(calls.at(-1).messages).includes(s.instructions));
  assert.equal(
    (
      await req("/generate/chat", {
        connectionId: chat.id,
        messages,
        skillId: a.id,
      })
    ).status,
    200,
    "old clients keep working",
  );
  assert.equal(
    (
      await req("/generate/image", {
        connectionId: image.id,
        prompt: "绘制宣传海报",
        skillIds: [a.id, b.id],
      })
    ).status,
    200,
  );
  for (const s of [a, b])
    assert.ok(calls.at(-1).prompt.includes(s.instructions));
  assert.equal(
    (
      await req("/generate/image", {
        connectionId: image.id,
        prompt: "x".repeat(12000),
      })
    ).status,
    200,
  );
  assert.equal(calls.at(-1).prompt.length, 12000);
  const imageCalls = calls.length;
  assert.equal(
    (
      await req("/generate/image", {
        connectionId: image.id,
        prompt: "x".repeat(12000),
        skillIds: [a.id],
      })
    ).status,
    413,
  );
  assert.equal(
    calls.length,
    imageCalls,
    "over-budget skills are rejected before the image provider is invoked",
  );
  const created = await req("/production", {
    kind: "code",
    deviceId: randomUUID(),
    connectionId: chat.id,
    prompt: "创建合成代码文档",
    skillIds: [a.id, b.id],
  });
  assert.equal(created.status, 201);
  const before = calls.length;
  await req(`/production/${created.data.id}/start`, {});
  const until = Date.now() + 10000;
  let task: any;
  do {
    task = (await req("/production")).data.find(
      (task: any) => task.id === created.data.id,
    );
    if (["ready", "failed"].includes(task.status)) break;
    await new Promise((r) => setTimeout(r, 30));
  } while (Date.now() < until);
  assert.equal(task.status, "ready");
  for (const call of calls.slice(before))
    for (const s of [a, b])
      assert.ok(JSON.stringify(call.messages).includes(s.instructions));
  await req(`/production/${created.data.id}/cancel`, {});
  await req(`/skills/${b.id}/disable`, {});
  const count = calls.length;
  for (const path of ["/generate/chat", "/generate/image", "/production"]) {
    const body =
      path === "/generate/chat"
        ? { connectionId: chat.id, messages, skillIds: [b.id] }
        : path === "/generate/image"
          ? { connectionId: image.id, prompt: "合成图片", skillIds: [b.id] }
          : {
              kind: "code",
              deviceId: randomUUID(),
              connectionId: chat.id,
              prompt: "合成项目",
              skillIds: [b.id],
            };
    assert.equal((await req(path, body)).status, 404);
  }
  assert.equal(calls.length, count, "revoked skills never reach a provider");
  const staleAuto = await req("/generate/plan", {
    connectionId: chat.id,
    messages,
    skillMode: "auto",
    skillIds: [a.id, b.id],
  });
  assert.equal(staleAuto.status, 200);
  assert.deepEqual(
    JSON.parse(calls.at(-1).messages.at(-1).content).availableSkills.map(
      (s: any) => s.id,
    ),
    [a.id],
  );
  const privateDepartment = (
    await req("/departments", { name: "受限技能部门" })
  ).data;
  const employeeDepartment = (
    await req("/departments", { name: "普通员工部门" })
  ).data;
  const privateSkill = await skill("其他部门私有流程", "departments", [
    privateDepartment.id,
  ]);
  const employee = (
    await req("/users", {
      username: "multi-employee",
      name: "合成员工",
      departmentId: employeeDepartment.id,
      role: "employee",
    })
  ).data;
  cookie = (
    await req("/auth/login", {
      username: "multi-employee",
      password: employee.initialPassword,
    })
  ).cookie;
  await req("/auth/password", {
    current: employee.initialPassword,
    password: "Disposable-Employee-Multi-2026",
  });
  cookie = (
    await req("/auth/login", {
      username: "multi-employee",
      password: "Disposable-Employee-Multi-2026",
    })
  ).cookie;
  const privateCalls = calls.length;
  for (const path of [
    "/generate/plan",
    "/generate/chat",
    "/generate/image",
    "/production",
  ]) {
    const body =
      path === "/generate/plan"
        ? {
            connectionId: chat.id,
            messages,
            skillMode: "manual",
            skillIds: [privateSkill.id],
          }
        : path === "/generate/chat"
          ? { connectionId: chat.id, messages, skillIds: [privateSkill.id] }
          : path === "/generate/image"
            ? {
                connectionId: image.id,
                prompt: "合成图片",
                skillIds: [privateSkill.id],
              }
            : {
                kind: "code",
                deviceId: randomUUID(),
                connectionId: chat.id,
                prompt: "合成项目",
                skillIds: [privateSkill.id],
              };
    assert.equal(
      (await req(path, body)).status,
      404,
      "another department's skill is never usable by guessing its ID",
    );
  }
  assert.equal(calls.length, privateCalls);
  assert.equal(
    (
      await req("/generate/plan", {
        connectionId: chat.id,
        messages,
        skillMode: "auto",
        skillIds: [a.id, privateSkill.id],
      })
    ).status,
    200,
  );
  assert.deepEqual(
    JSON.parse(calls.at(-1).messages.at(-1).content).availableSkills.map(
      (s: any) => s.id,
    ),
    [a.id],
  );
});
