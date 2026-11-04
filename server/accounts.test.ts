import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createPlatform } from "./platform";
import { createStore, passwordMatches } from "./database";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("managed department accounts, credentials and employee login changes", async (t) => {
  const platform = createPlatform({ database: ":memory:" });
  const server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    platform.store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`,
    password = "Synthetic-Accounts-2026";
  async function req(
    path: string,
    body?: unknown,
    cookie = "",
    method = body ? "POST" : "GET",
    origin?: string,
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(origin ? { Origin: origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  await req("/bootstrap", {
    companyName: "Fixture A",
    name: "Admin",
    username: "accounts-admin",
    password,
  });
  const admin = await req("/auth/login", {
    username: "accounts-admin",
    password,
  });
  const other = await req("/departments", { name: "Fixture B" }, admin.cookie);
  const departmentIds = [admin.data.departmentId, other.data.id];
  const batch = {
    requestId: randomUUID(),
    departmentIds,
    count: 20,
    adminPassword: password,
  };
  const { db } = platform.store;
  await t.test(
    "creation requires company admin authentication, valid departments and permitted origin",
    async () => {
      assert.equal((await req("/admin/accounts/generate", batch)).status, 401);
      assert.equal(
        (
          await req(
            "/admin/accounts/generate",
            batch,
            admin.cookie,
            "POST",
            "https://evil.invalid",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/admin/accounts/generate",
            { ...batch, adminPassword: "incorrect" },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await req(
            "/admin/accounts/generate",
            { ...batch, count: 21 },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await req(
            "/admin/accounts/generate",
            { ...batch, departmentIds: [randomUUID()] },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal(db.prepare("SELECT count(*) AS n FROM users").get()!.n, 1);
    },
  );
  await t.test(
    "each department gets 20 random employees atomically; retries reuse the batch",
    async () => {
      const result = await req("/admin/accounts/generate", batch, admin.cookie);
      assert.equal(result.status, 201);
      assert.equal(result.data.created, 40);
      assert.equal(result.data.password, undefined);
      const rows = db
        .prepare("SELECT * FROM users WHERE role='employee'")
        .all();
      assert.equal(rows.length, 40);
      assert.equal(new Set(rows.map((r) => r.username)).size, 40);
      assert.equal(new Set(rows.map((r) => r.name)).size, 40);
      for (const id of departmentIds)
        assert.equal(rows.filter((r) => r.department_id === id).length, 20);
      const secrets = db.prepare("SELECT * FROM managed_credentials").all();
      assert.equal(secrets.length, 40);
      assert.equal(new Set(secrets.map((r) => r.secret)).size, 40);
      for (const row of rows) {
        assert.equal(row.role, "employee");
        assert.equal(row.must_change, 1);
        assert.ok(
          Number(row.initial_expires_at) > Date.now() + 29 * 24 * 3600_000,
        );
        const credential = secrets.find((s) => s.user_id === row.id)!;
        const decoded = JSON.parse(
          platform.store.decrypt(credential.secret as string),
        );
        assert.equal(decoded.userId, row.id);
        assert.ok(
          passwordMatches(decoded.password, row.password_hash as string),
        );
        assert.ok(!JSON.stringify(row).includes(decoded.password));
        assert.ok(!JSON.stringify(credential).includes(decoded.password));
      }
      const repeat = await req("/admin/accounts/generate", batch, admin.cookie);
      assert.equal(repeat.data.reused, true);
      assert.equal(repeat.data.created, 40);
      assert.equal(
        (
          await req(
            "/admin/accounts/generate",
            { ...batch, count: 19 },
            admin.cookie,
          )
        ).status,
        409,
      );
      assert.equal(db.prepare("SELECT count(*) AS n FROM users").get()!.n, 41);
    },
  );
  const employee = db
    .prepare("SELECT * FROM users WHERE role='employee' LIMIT 1")
    .get()!;
  const viewBody = { userId: employee.id, adminPassword: password };
  const initial = await req("/admin/accounts/password", viewBody, admin.cookie);
  let login = await req("/auth/login", {
    username: employee.username,
    password: initial.data.password,
  });
  await t.test(
    "first login requires password change; updated password is encrypted, current and audited",
    async () => {
      assert.equal(login.status, 200);
      assert.equal(
        (
          await req(
            "/auth/username",
            { username: "too-soon", currentPassword: initial.data.password },
            login.cookie,
          )
        ).status,
        403,
      );
      assert.equal((await req("/users", undefined, login.cookie)).status, 403);
      assert.equal(
        (
          await req(
            "/auth/password",
            { current: initial.data.password, password },
            login.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await req("/auth/me", undefined, login.cookie)).status,
        401,
      );
      const revealed = await req(
        "/admin/accounts/password",
        viewBody,
        admin.cookie,
      );
      assert.equal(revealed.data.password, password);
      assert.notEqual(revealed.data.password, initial.data.password);
      login = await req("/auth/login", {
        username: employee.username,
        password,
      });
      assert.equal(login.data.mustChange, 0);
      assert.equal(
        (await req("/admin/accounts/password", viewBody, login.cookie)).status,
        403,
      );
      assert.equal(
        (await req("/admin/accounts/generate", batch, login.cookie)).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/admin/accounts/password",
            { ...viewBody, userId: admin.data.id },
            admin.cookie,
          )
        ).status,
        403,
      );
      const users = await req("/users", undefined, admin.cookie);
      assert.ok(!JSON.stringify(users.data).includes(password));
      assert.ok(
        users.data.every(
          (u: any) => u.secret === undefined && u.password_hash === undefined,
        ),
      );
      const audit = db
        .prepare("SELECT * FROM audit WHERE action='account.password_viewed'")
        .all();
      assert.equal(audit.length, 2);
      assert.ok(
        audit.every(
          (r) => r.actor_id === admin.data.id && r.resource_id === employee.id,
        ),
      );
      assert.ok(
        !JSON.stringify(db.prepare("SELECT * FROM audit").all()).includes(
          password,
        ),
      );
    },
  );
  await t.test(
    "admin notes are bounded, scoped and private; editing does not revoke employee sessions",
    async () => {
      const path = `/users/${employee.id}/note`,
        note = "分配给：验收员工\n工号 QA-01";
      assert.equal((await req(path, { note }, "", "PATCH")).status, 401);
      assert.equal(
        (await req(path, { note }, login.cookie, "PATCH")).status,
        403,
      );
      assert.equal(
        (
          await req(
            path,
            { note },
            admin.cookie,
            "PATCH",
            "https://evil.invalid",
          )
        ).status,
        403,
      );
      assert.equal(
        (await req(path, { note: "x".repeat(501) }, admin.cookie, "PATCH"))
          .status,
        400,
      );
      assert.equal(
        (
          await req(
            path,
            { note, role: "company_admin" },
            admin.cookie,
            "PATCH",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await req(
            `/users/${randomUUID()}/note`,
            { note },
            admin.cookie,
            "PATCH",
          )
        ).status,
        404,
      );
      const before = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(employee.id)!;
      assert.equal(
        (await req(path, { note: `  ${note}  ` }, admin.cookie, "PATCH"))
          .status,
        200,
      );
      const me = await req("/auth/me", undefined, login.cookie);
      assert.equal(me.status, 200);
      assert.equal(me.data.accountNote, undefined);
      const after = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(employee.id)!;
      assert.equal(after.account_note, note);
      for (const key of [
        "username",
        "name",
        "department_id",
        "role",
        "auth_version",
        "password_hash",
      ])
        assert.equal(after[key], before[key]);
      assert.equal(
        (await req("/users", undefined, admin.cookie)).data.find(
          (u: any) => u.id === employee.id,
        ).accountNote,
        note,
      );
      assert.equal(
        (
          await req(
            "/auth/profile",
            { name: "New display name", accountNote: "employee overwrite" },
            login.cookie,
            "PATCH",
          )
        ).status,
        400,
      );
      const audit = db
        .prepare("SELECT * FROM audit WHERE action='account.note_updated'")
        .all();
      assert.equal(audit.length, 1);
      assert.equal(audit[0].actor_id, admin.data.id);
      assert.equal(audit[0].resource_id, employee.id);
      assert.ok(!JSON.stringify(audit).includes(note));
      assert.equal(
        (await req(path, { note: "   " }, admin.cookie, "PATCH")).status,
        200,
      );
      assert.equal(
        db
          .prepare("SELECT account_note FROM users WHERE id=?")
          .get(employee.id)!.account_note,
        "",
      );
      await req(path, { note }, admin.cookie, "PATCH");
    },
  );
  await t.test(
    "renaming verifies password, keeps identity and department, revokes other sessions and prevents conflicts",
    async () => {
      const second = await req("/auth/login", {
        username: employee.username,
        password,
      });
      assert.equal(
        (
          await req(
            "/auth/username",
            { username: "new-name", currentPassword: "wrong" },
            login.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await req(
            "/auth/username",
            { username: "ACCOUNTS-ADMIN", currentPassword: password },
            login.cookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await req(
            "/auth/username",
            {
              username: "new-name",
              currentPassword: password,
              role: "company_admin",
            },
            login.cookie,
          )
        ).status,
        400,
      );
      const renamed = await req(
        "/auth/username",
        { username: "new-name", currentPassword: password },
        login.cookie,
      );
      assert.equal(renamed.status, 200);
      assert.equal(renamed.data.username, "new-name");
      assert.equal(renamed.data.id, employee.id);
      assert.equal(renamed.data.role, "employee");
      assert.equal(renamed.data.departmentId, employee.department_id);
      assert.equal(renamed.data.accountNote, undefined);
      assert.equal(
        db
          .prepare("SELECT account_note FROM users WHERE id=?")
          .get(employee.id)!.account_note,
        "分配给：验收员工\n工号 QA-01",
      );
      assert.equal(
        (await req("/auth/me", undefined, login.cookie)).status,
        200,
      );
      assert.equal(
        (await req("/auth/me", undefined, second.cookie)).status,
        401,
      );
      assert.equal(
        (await req("/auth/login", { username: employee.username, password }))
          .status,
        401,
      );
      assert.equal(
        (await req("/auth/login", { username: "NEW-NAME", password })).status,
        200,
      );
      assert.equal(
        (await req("/admin/accounts/password", viewBody, admin.cookie)).data
          .password,
        password,
      );
    },
  );
  await t.test(
    "single creation, reset and promotion maintain correct encrypted records; legacy and admins are never invented",
    async () => {
      const created = await req(
        "/users",
        {
          username: "single-employee",
          name: "Fixture",
          departmentId: other.data.id,
        },
        admin.cookie,
      );
      assert.equal(
        (
          await req(
            "/admin/accounts/password",
            { ...viewBody, userId: created.data.user.id },
            admin.cookie,
          )
        ).data.password,
        created.data.initialPassword,
      );
      const reset = await req(`/users/${employee.id}/reset`, {}, admin.cookie);
      assert.equal(
        (await req("/admin/accounts/password", viewBody, admin.cookie)).data
          .password,
        reset.data.initialPassword,
      );
      db.prepare("DELETE FROM managed_credentials WHERE user_id=?").run(
        created.data.user.id,
      );
      assert.equal(
        (
          await req(
            "/admin/accounts/password",
            { ...viewBody, userId: created.data.user.id },
            admin.cookie,
          )
        ).status,
        409,
      );
      await req(
        `/users/${employee.id}`,
        {
          name: "Promoted",
          departmentId: employee.department_id,
          role: "company_admin",
          enabled: true,
        },
        admin.cookie,
        "PATCH",
      );
      assert.equal(
        db
          .prepare("SELECT * FROM managed_credentials WHERE user_id=?")
          .get(employee.id),
        undefined,
      );
      assert.equal(
        (await req("/admin/accounts/password", viewBody, admin.cookie)).status,
        403,
      );
      assert.equal(
        db
          .prepare("SELECT * FROM managed_credentials WHERE user_id=?")
          .get(admin.data.id),
        undefined,
      );
    },
  );
  await t.test(
    "department admins see only their department and cannot reveal or generate managed credentials",
    async () => {
      const created = await req(
        "/users",
        {
          username: "dept-admin",
          name: "Manager",
          departmentId: other.data.id,
          role: "department_admin",
        },
        admin.cookie,
      );
      let manager = await req("/auth/login", {
        username: "dept-admin",
        password: created.data.initialPassword,
      });
      await req(
        "/auth/password",
        { current: created.data.initialPassword, password },
        manager.cookie,
      );
      manager = await req("/auth/login", { username: "dept-admin", password });
      const users = await req("/users", undefined, manager.cookie);
      assert.ok(users.data.every((u: any) => u.departmentId === other.data.id));
      assert.equal(
        (await req("/admin/accounts/password", viewBody, manager.cookie))
          .status,
        403,
      );
      assert.equal(
        (await req("/admin/accounts/generate", batch, manager.cookie)).status,
        403,
      );
      assert.equal(
        (await req(`/users/${employee.id}/reset`, {}, manager.cookie)).status,
        403,
      );
      const ownEmployee = users.data.find((u: any) => u.role === "employee");
      assert.equal(
        (
          await req(
            `/users/${ownEmployee.id}/note`,
            { note: "分配给本部门员工" },
            manager.cookie,
            "PATCH",
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await req(
            `/users/${employee.id}/note`,
            { note: "越权修改" },
            manager.cookie,
            "PATCH",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            `/users/${created.data.user.id}/note`,
            { note: "越权修改管理角色" },
            manager.cookie,
            "PATCH",
          )
        ).status,
        403,
      );
      const foreignEmployee = db
        .prepare(
          "SELECT id FROM users WHERE department_id<>? AND role='employee' LIMIT 1",
        )
        .get(other.data.id)!;
      assert.equal(
        (
          await req(
            `/users/${foreignEmployee.id}/note`,
            { note: "跨部门修改" },
            manager.cookie,
            "PATCH",
          )
        ).status,
        403,
      );
      assert.ok(
        !(await req("/users", undefined, manager.cookie)).data.some(
          (u: any) => u.id === foreignEmployee.id,
        ),
      );
    },
  );
  await t.test(
    "credential verification is rate limited and never stores failed passwords in audit",
    async () => {
      for (let i = 0; i < 5; i++)
        assert.equal(
          (
            await req(
              "/admin/accounts/password",
              { ...viewBody, adminPassword: "wrong-again" },
              admin.cookie,
            )
          ).status,
          400,
        );
      assert.equal(
        (
          await req(
            "/admin/accounts/password",
            { ...viewBody, adminPassword: "wrong-again" },
            admin.cookie,
          )
        ).status,
        429,
      );
      assert.ok(
        !JSON.stringify(db.prepare("SELECT * FROM audit").all()).includes(
          "wrong-again",
        ),
      );
    },
  );
});

test("account notes migrate existing databases and survive restart without changing identities", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "brain-account-note-")),
    file = join(directory, "accounts.sqlite"),
    departmentId = randomUUID(),
    userId = randomUUID();
  t.after(() => {
    assert.ok(directory.startsWith(join(tmpdir(), "brain-account-note-")));
    rmSync(directory, { recursive: true, force: true });
  });
  let store = createStore(file);
  try {
    store.db
      .prepare("INSERT INTO departments(id,name) VALUES(?,?)")
      .run(departmentId, "Legacy fixture");
    store.db
      .prepare(
        "INSERT INTO users(id,username,name,department_id,role,password_hash) VALUES(?,?,?,?,?,?)",
      )
      .run(
        userId,
        "legacy-fixture",
        "Fixture",
        departmentId,
        "employee",
        "unchanged-synthetic-hash",
      );
    store.db.exec("ALTER TABLE users DROP COLUMN account_note");
  } finally {
    store.close();
  }
  store = createStore(file);
  try {
    const user = store.db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(userId)!;
    assert.equal(user.account_note, "");
    assert.equal(user.password_hash, "unchanged-synthetic-hash");
    assert.equal(user.department_id, departmentId);
    store.db
      .prepare("UPDATE users SET account_note=? WHERE id=?")
      .run("分配给验收同事", userId);
  } finally {
    store.close();
  }
  store = createStore(file);
  try {
    assert.equal(
      store.db.prepare("SELECT account_note FROM users WHERE id=?").get(userId)!
        .account_note,
      "分配给验收同事",
    );
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM users").get()!.n,
      1,
    );
  } finally {
    store.close();
  }
});
