import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createPlatform } from "./platform";

test("department accounts, review scopes, publication and local-history boundary", async (t) => {
  const platform = createPlatform({ database: ":memory:" });
  const server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  t.after(() => {
    server.close();
    platform.store.close();
  });
  async function request(
    path: string,
    body?: unknown,
    cookie = "",
    method = body === undefined ? "GET" : "POST",
    origin?: string,
  ) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    return {
      status: response.status,
      data,
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  const mainPassword = "Integration-only-Password-2026";
  const setup = await request("/bootstrap", {
    companyName: "管理部",
    username: "test-admin",
    name: "验收管理员",
    password: mainPassword,
  });
  assert.equal(setup.status, 201);
  let adminCookie = (
    await request("/auth/login", {
      username: "test-admin",
      password: mainPassword,
    })
  ).cookie;
  const departmentA = (
    await request("/departments", { name: "设计部" }, adminCookie)
  ).data;
  const departmentB = (
    await request("/departments", { name: "运营部" }, adminCookie)
  ).data;
  const departmentC = (
    await request("/departments", { name: "财务部" }, adminCookie)
  ).data;
  const actorA = await request(
    "/users",
    {
      username: "a",
      name: "员工 A",
      departmentId: departmentA.id,
      role: "employee",
    },
    adminCookie,
  );
  // Login names have a two-character minimum.
  assert.equal(actorA.status, 400);
  async function createEmployee(
    username: string,
    departmentId: string,
    role = "employee",
  ) {
    const created = await request(
      "/users",
      { username, name: username, departmentId, role },
      adminCookie,
    );
    assert.equal(created.status, 201);
    const initial = created.data.initialPassword;
    let cookie = (await request("/auth/login", { username, password: initial }))
      .cookie;
    const blocked = await request("/skills", undefined, cookie);
    assert.equal(blocked.status, 403);
    const password = `Changed-${username}-Password-2026`;
    assert.equal(
      (await request("/auth/password", { current: initial, password }, cookie))
        .status,
      200,
    );
    assert.equal((await request("/auth/me", undefined, cookie)).status, 401);
    cookie = (await request("/auth/login", { username, password })).cookie;
    return { ...created.data.user, cookie, password, initial };
  }
  const a = await createEmployee("employee-a", departmentA.id),
    b = await createEmployee("employee-b", departmentB.id),
    c = await createEmployee("employee-c", departmentC.id);
  const deptAdmin = await createEmployee(
    "department-admin",
    departmentA.id,
    "department_admin",
  );
  const reviewerA = await createEmployee(
    "reviewer-a",
    departmentA.id,
    "department_reviewer",
  );
  const companyReviewer = await createEmployee(
    "company-reviewer",
    departmentC.id,
    "company_reviewer",
  );
  await t.test(
    "initial credentials are ephemeral, expire, and are absent from API lists and audit",
    async () => {
      const listed = await request("/users", undefined, adminCookie);
      assert.equal(listed.status, 200);
      assert.ok(!JSON.stringify(listed.data).includes(a.initial));
      assert.ok(!("password_hash" in listed.data[0]));
      const created = (
        await request(
          "/users",
          {
            username: "expired-initial",
            name: "过期初始密码",
            departmentId: departmentA.id,
            role: "employee",
          },
          adminCookie,
        )
      ).data;
      platform.store.db
        .prepare("UPDATE users SET initial_expires_at=? WHERE id=?")
        .run(Date.now() - 1000, created.user.id);
      assert.equal(
        (
          await request("/auth/login", {
            username: created.user.username,
            password: created.initialPassword,
          })
        ).status,
        401,
      );
      assert.ok(
        !JSON.stringify(
          (await request("/audit", undefined, adminCookie)).data,
        ).includes(created.initialPassword),
      );
    },
  );
  await t.test(
    "department administrator cannot see or mutate another department or elevate roles",
    async () => {
      const list = await request("/users", undefined, deptAdmin.cookie);
      assert.ok(list.data.every((u: any) => u.departmentId === departmentA.id));
      assert.equal(
        (await request(`/users/${b.id}/reset`, {}, deptAdmin.cookie)).status,
        403,
      );
      assert.equal(
        (
          await request(
            "/users",
            {
              username: "evil-company-admin",
              name: "越权角色",
              departmentId: departmentA.id,
              role: "company_admin",
            },
            deptAdmin.cookie,
          )
        ).status,
        403,
      );
      const batch = await request(
        "/users/batch",
        {
          rows: [
            {
              username: "batch-ok",
              name: "本部门",
              departmentId: departmentA.id,
            },
            {
              username: "batch-denied",
              name: "他部门",
              departmentId: departmentB.id,
            },
            {
              username: "batch-ok",
              name: "重复账号",
              departmentId: departmentA.id,
            },
          ],
        },
        deptAdmin.cookie,
      );
      assert.equal(batch.data[0].user.departmentId, departmentA.id);
      assert.ok(batch.data[1].error);
      assert.ok(batch.data[2].error);
    },
  );
  const skillBody = {
    name: "可复用测试流程",
    description: "仅用于集成验收的文本流程",
    version: "1.0.0",
    instructions:
      "输入新素材并按用户要求整理为三个可检查的步骤。先确认目标，再生成结果，最后进行质量检查。",
    examples: "",
    testSummary: "集成测试样例；没有调用真实付费模型。",
    requiredTools: [],
    audience: "department",
    targetDepartments: [],
  };
  const skill = (await request("/skills", skillBody, a.cookie)).data;
  await t.test(
    "department skill stays hidden until review, then exposes only approved recipients",
    async () => {
      assert.equal(skill.ownerDepartmentId, departmentA.id);
      assert.equal(
        (await request("/skills", undefined, a.cookie)).data.length,
        0,
      );
      assert.equal(
        (
          await request(
            `/skills/${skill.id}/review`,
            { approve: true, note: "越权审核" },
            b.cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            `/skills/${skill.id}/review`,
            { approve: true, note: "检查内容与部门范围后通过" },
            reviewerA.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await request(`/skills/${skill.id}/download`, undefined, b.cookie))
          .status,
        404,
      );
      assert.equal(
        (await request(`/skills/${skill.id}/download`, undefined, a.cookie))
          .status,
        200,
      );
      assert.equal(
        (
          await request(
            `/skills/${skill.id}/review`,
            { approve: false, note: "重复审核" },
            reviewerA.cookie,
          )
        ).status,
        409,
      );
    },
  );
  const cross = (
    await request(
      "/skills",
      {
        ...skillBody,
        version: "1.1.0",
        audience: "departments",
        targetDepartments: [departmentA.id, departmentB.id],
      },
      a.cookie,
    )
  ).data;
  await t.test(
    "cross-department publication requires company publication authority",
    async () => {
      assert.equal(
        (
          await request(
            `/skills/${cross.id}/review`,
            { approve: true, note: "部门审核试图跨部门发布" },
            reviewerA.cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            `/skills/${cross.id}/review`,
            { approve: true, note: "检查指定两个部门共享范围" },
            companyReviewer.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await request(`/skills/${cross.id}/download`, undefined, b.cookie))
          .status,
        200,
      );
      assert.equal(
        (await request(`/skills/${cross.id}/download`, undefined, c.cookie))
          .status,
        404,
      );
      assert.equal(
        (await request("/skills", undefined, c.cookie)).data.length,
        0,
      );
    },
  );
  await t.test(
    "package rejects transcripts, arbitrary ownership, personal paths and duplicate versions",
    async () => {
      assert.equal(
        (
          await request(
            "/skills",
            {
              ...skillBody,
              messages: [{ role: "user", content: "私有完整对话" }],
            },
            a.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "/skills",
            { ...skillBody, ownerDepartmentId: departmentB.id },
            a.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "/skills",
            {
              ...skillBody,
              instructions:
                "读取 C:\\Users\\private\\secret.txt 并复制用户全部内容",
            },
            a.cookie,
          )
        ).status,
        400,
      );
      assert.equal((await request("/skills", skillBody, a.cookie)).status, 409);
      assert.equal(
        (await request("/conversations", undefined, adminCookie)).status,
        404,
      );
      const tables = platform.store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as any[];
      assert.ok(
        !tables.some((t) =>
          /conversation|message|transcript|draft/.test(t.name),
        ),
      );
    },
  );
  await t.test(
    "moving department revokes old sessions and access while preserving stable identity and skill owner",
    async () => {
      const moved = await request(
        `/users/${a.id}`,
        {
          name: a.name,
          departmentId: departmentB.id,
          role: "employee",
          enabled: true,
        },
        adminCookie,
        "PATCH",
      );
      assert.equal(moved.data.id, a.id);
      assert.equal(
        (await request("/auth/me", undefined, a.cookie)).status,
        401,
      );
      a.cookie = (
        await request("/auth/login", {
          username: a.username,
          password: a.password,
        })
      ).cookie;
      assert.equal(
        (await request(`/skills/${skill.id}/download`, undefined, a.cookie))
          .status,
        404,
      );
      const published = (await request("/skills", undefined, adminCookie)).data;
      assert.equal(
        published.find((s: any) => s.id === skill.id).ownerDepartmentId,
        departmentA.id,
      );
    },
  );
  await t.test(
    "company keys are protected and connection scope is enforced before provider calls",
    async () => {
      const connection = await request(
        "/connections",
        {
          name: "测试未连接服务",
          baseUrl: "https://example.invalid/v1",
          model: "test-only",
          kind: "chat",
          apiKey: "test-only-secret-do-not-log",
          departments: [departmentA.id],
        },
        adminCookie,
      );
      assert.equal(connection.status, 201);
      assert.equal(connection.data.hasKey, true);
      assert.ok(!JSON.stringify(connection.data).includes("test-only-secret"));
      const dbSecret = (
        platform.store.db
          .prepare("SELECT secret FROM connections WHERE id=?")
          .get(connection.data.id) as any
      ).secret;
      assert.ok(!dbSecret.includes("test-only-secret"));
      assert.equal(
        (
          await request(
            "/generate/chat",
            {
              connectionId: connection.data.id,
              messages: [{ role: "user", content: "private-context-sentinel" }],
            },
            b.cookie,
          )
        ).status,
        403,
      );
      assert.ok(
        !JSON.stringify(
          platform.store.db.prepare("SELECT * FROM audit").all(),
        ).includes("private-context-sentinel"),
      );
    },
  );
  await t.test(
    "foreign origin rejected and self-lockout prevented",
    async () => {
      assert.equal(
        (
          await request(
            "/departments",
            { name: "恶意来源部门" },
            adminCookie,
            "POST",
            "https://untrusted.invalid",
          )
        ).status,
        403,
      );
      const me = (await request("/auth/me", undefined, adminCookie)).data;
      assert.equal(
        (
          await request(
            `/users/${me.id}`,
            {
              name: me.name,
              departmentId: me.departmentId,
              role: "employee",
              enabled: false,
            },
            adminCookie,
            "PATCH",
          )
        ).status,
        409,
      );
    },
  );
});
