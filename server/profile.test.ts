import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createPlatform } from "./platform";
import { createStore } from "./database";
import { normalizeAvatar } from "./profile";
import provenance from "../docs/assets/ipas-avatar-sources.json";
import {
  AVATAR_PRESETS,
  defaultAvatar,
  isAvatarPreset,
} from "../shared/avatars";

test("all 100 IPAS presets are distinct local images matching preserved upstream hashes", async () => {
  assert.equal(AVATAR_PRESETS.length, 100);
  assert.equal(provenance.assets.length, 100);
  assert.equal(
    new Set(provenance.assets.map((item) => item.sourceId)).size,
    100,
  );
  assert.equal(new Set(provenance.assets.map((item) => item.sha256)).size, 100);
  assert.equal(
    (await readdir("public/avatars/ipas-v1")).filter((name) =>
      name.endsWith(".webp"),
    ).length,
    100,
  );
  for (const preset of AVATAR_PRESETS) {
    const source = provenance.assets.find((item) => item.id === preset.id)!;
    const bytes = await readFile("public" + preset.src);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      source.sha256,
    );
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.equal(metadata.format, "webp");
  }
});

test("profile migration preserves existing accounts and stable default avatars", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-profile-migrate-"));
  const file = join(dir, "test.sqlite");
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(
      "CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT, name TEXT, department_id TEXT, role TEXT, password_hash TEXT, enabled INTEGER, must_change INTEGER, auth_version INTEGER, distributed INTEGER, initial_expires_at INTEGER); INSERT INTO users VALUES('legacy-id','legacy','原来的名称','dept','employee','unchanged',1,0,1,0,0)",
    );
    legacy.close();
    const store = createStore(file);
    const row = store.db
      .prepare("SELECT * FROM users WHERE id='legacy-id'")
      .get()!;
    assert.equal(row.name, "原来的名称");
    assert.equal(row.password_hash, "unchanged");
    assert.equal(row.avatar, "");
    store.close();
    assert.equal(new Set(AVATAR_PRESETS.map((x) => x.id)).size, 100);
    assert.ok(isAvatarPreset(defaultAvatar("legacy-id")));
    assert.equal(defaultAvatar("legacy-id"), defaultAvatar("legacy-id"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("avatar decoder strips metadata, bounds images and rejects SVG, URLs and fake formats", async () => {
  const png = await sharp({
    create: { width: 320, height: 180, channels: 3, background: "#fac620" },
  })
    .png()
    .withMetadata()
    .toBuffer();
  const value = await normalizeAvatar(
    `data:image/png;base64,${png.toString("base64")}`,
  );
  const meta = await sharp(
    Buffer.from(value.split(",")[1], "base64"),
  ).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
  assert.equal(meta.exif, undefined);
  for (const input of [
    "ipas-101",
    "https://example.com/avatar.png",
    "../../secret",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,aGVsbG8=",
    `data:image/jpeg;base64,${png.toString("base64")}`,
  ])
    await assert.rejects(normalizeAvatar(input));
  const huge = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    normalizeAvatar(`data:image/png;base64,${huge.toString("base64")}`),
  );
});

test("employees update only their own profile; changes persist across sessions without altering login or permissions", async (t) => {
  const platform = createPlatform({ database: ":memory:" });
  const server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    platform.store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  async function req(
    path: string,
    body?: unknown,
    cookie = "",
    method = body ? "POST" : "GET",
    origin?: string,
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(origin ? { Origin: origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  const password = "Profile-verification-2026";
  await req("/bootstrap", {
    companyName: "验收部",
    username: "profile-admin",
    name: "管理员",
    password,
  });
  const admin = await req("/auth/login", {
    username: "profile-admin",
    password,
  });
  assert.ok(isAvatarPreset(admin.data.avatar));
  const created = await req(
    "/users",
    {
      username: "profile-employee",
      name: "员工原名",
      departmentId: admin.data.departmentId,
    },
    admin.cookie,
  );
  assert.equal(created.status, 201);
  assert.ok(isAvatarPreset(created.data.user.avatar));
  const id = created.data.user.id;
  let employee = await req("/auth/login", {
    username: "profile-employee",
    password: created.data.initialPassword,
  });
  assert.equal(
    (
      await req(
        "/auth/profile",
        { name: "必须先改密码" },
        employee.cookie,
        "PATCH",
      )
    ).status,
    403,
  );
  await req(
    "/auth/password",
    { current: created.data.initialPassword, password },
    employee.cookie,
  );
  employee = await req("/auth/login", {
    username: "profile-employee",
    password,
  });
  assert.equal(
    (await req("/auth/profile", { name: "匿名" }, "", "PATCH")).status,
    401,
  );
  assert.equal(
    (
      await req(
        "/auth/profile",
        { name: "跨站" },
        employee.cookie,
        "PATCH",
        "https://untrusted.invalid",
      )
    ).status,
    403,
  );
  for (const data of [
    { name: " " },
    { name: "a".repeat(101) },
    { role: "company_admin" },
    { id: admin.data.id, name: "越权" },
    { username: "renamed" },
    { avatar: "ipas-101" },
  ]) {
    assert.equal(
      (await req("/auth/profile", data, employee.cookie, "PATCH")).status,
      400,
    );
  }
  const updated = await req(
    "/auth/profile",
    { name: "  元气员工  ", avatar: "ipas-017" },
    employee.cookie,
    "PATCH",
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.data.name, "元气员工");
  assert.equal(updated.data.avatar, "ipas-017");
  assert.equal(updated.data.role, "employee");
  assert.equal(updated.data.id, id);
  assert.equal(updated.data.username, "profile-employee");
  assert.equal(
    (await req("/auth/me", undefined, admin.cookie)).data.name,
    "管理员",
  );
  const secondSession = await req("/auth/login", {
    username: "profile-employee",
    password,
  });
  assert.equal(secondSession.data.avatar, "ipas-017");
  assert.equal(secondSession.data.name, "元气员工");
  const jpeg = await sharp({
    create: { width: 500, height: 400, channels: 3, background: "#fdbd13" },
  })
    .jpeg()
    .toBuffer();
  const custom = await req(
    "/auth/profile",
    { avatar: `data:image/jpeg;base64,${jpeg.toString("base64")}` },
    employee.cookie,
    "PATCH",
  );
  assert.equal(custom.status, 200);
  assert.match(custom.data.avatar, /^data:image\/webp;base64,/);
  assert.equal(
    (await req("/auth/me", undefined, secondSession.cookie)).data.avatar,
    custom.data.avatar,
  );
  assert.equal(custom.data.name, "元气员工");
  assert.equal(
    (
      await req(
        "/auth/profile",
        { avatar: "ipas-001" },
        employee.cookie,
        "PATCH",
      )
    ).data.avatar,
    "ipas-001",
  );
  const audit = platform.store.db
    .prepare("SELECT * FROM audit WHERE action='account.profile_updated'")
    .all();
  assert.equal(audit.length, 3);
  assert.ok(
    audit.every((row) => row.actor_id === id && row.resource_id === id),
  );
  platform.store.db.prepare("UPDATE users SET enabled=0 WHERE id=?").run(id);
  assert.equal(
    (await req("/auth/profile", { name: "停用" }, employee.cookie, "PATCH"))
      .status,
    401,
  );
});
