import type { Express, Request } from "express";
import { randomBytes, randomUUID, randomInt } from "node:crypto";
import { z } from "zod";
import type { User } from "../shared/types";
import {
  passwordHashAsync,
  passwordMatches,
  tokenHash,
  type Store,
} from "./database";

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_.@-]{2,64}$/, "账号使用 2–64 位字母、数字或 . _ @ -");
export function saveManagedPassword(
  store: Store,
  userId: string,
  role: string,
  password: string,
) {
  if (role === "company_admin") {
    store.db
      .prepare("DELETE FROM managed_credentials WHERE user_id=?")
      .run(userId);
    return;
  }
  store.db
    .prepare(
      "INSERT INTO managed_credentials(user_id,secret,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,updated_at=excluded.updated_at",
    )
    .run(
      userId,
      store.encrypt(JSON.stringify({ userId, password })),
      new Date().toISOString(),
    );
}

export function mountAccounts(
  app: Express,
  store: Store,
  actor: (req: Request) => User,
  fail: (status: number, message: string) => never,
  userView: (id: string) => User,
) {
  const { db } = store;
  const attempts = new Map<string, { count: number; until: number }>();
  const generating = new Set<string>();
  function verifyPassword(user: User, password: string) {
    const now = Date.now();
    for (const [id, item] of attempts)
      if (item.until <= now) attempts.delete(id);
    const rate = attempts.get(user.id) ?? {
      count: 0,
      until: now + 10 * 60_000,
    };
    if (rate.count >= 5) fail(429, "验证过于频繁，请 10 分钟后重试");
    const row = db
      .prepare("SELECT password_hash FROM users WHERE id=?")
      .get(user.id)!;
    if (!passwordMatches(password, row.password_hash as string)) {
      rate.count++;
      attempts.set(user.id, rate);
      fail(400, "当前密码不正确");
    }
    attempts.delete(user.id);
  }
  function companyAdmin(req: Request, password: string) {
    const user = actor(req);
    if (user.role !== "company_admin") fail(403, "需要公司管理员权限");
    verifyPassword(user, password);
    return user;
  }
  app.post("/api/auth/username", (req, res) => {
    const user = actor(req);
    const data = z
      .object({
        username: usernameSchema,
        currentPassword: z.string().max(128),
      })
      .strict()
      .parse(req.body);
    verifyPassword(user, data.currentPassword);
    const existing = db
      .prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE")
      .get(data.username);
    if (existing && existing.id !== user.id)
      fail(409, "登录账号已被使用，请换一个名称");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE users SET username=?,auth_version=auth_version+1 WHERE id=?",
      ).run(data.username, user.id);
      const session = tokenHash(req.cookies.brain_session);
      db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").run(
        user.id,
        session,
      );
      db.prepare(
        "UPDATE sessions SET auth_version=(SELECT auth_version FROM users WHERE id=?) WHERE token_hash=?",
      ).run(user.id, session);
      store.audit(user.id, "account.username_changed", user.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json(userView(user.id));
  });
  app.post("/api/admin/accounts/password", (req, res) => {
    const data = z
      .object({ userId: z.string().uuid(), adminPassword: z.string().max(128) })
      .strict()
      .parse(req.body);
    const admin = companyAdmin(req, data.adminPassword);
    const row = db
      .prepare(
        "SELECT u.role,c.secret,c.updated_at FROM users u LEFT JOIN managed_credentials c ON c.user_id=u.id WHERE u.id=?",
      )
      .get(data.userId);
    if (!row) fail(404, "账号不存在");
    if (row.role === "company_admin")
      fail(403, "公司管理员密码不提供查看，请使用重置功能");
    if (!row.secret)
      fail(
        409,
        "这个旧账号尚无可查看的密码，员工下次改密或管理员重置后即可查看",
      );
    const value = JSON.parse(store.decrypt(row.secret as string));
    if (value.userId !== data.userId || typeof value.password !== "string")
      fail(500, "密码记录无法读取，请重置该账号");
    store.audit(admin.id, "account.password_viewed", data.userId);
    res.json({ password: value.password, updatedAt: row.updated_at });
  });
  app.post("/api/admin/accounts/generate", async (req, res) => {
    const data = z
      .object({
        requestId: z.string().uuid(),
        departmentIds: z.array(z.string().uuid()).min(1).max(25),
        count: z.number().int().min(1).max(20).default(20),
        adminPassword: z.string().max(128),
      })
      .strict()
      .parse(req.body);
    const admin = companyAdmin(req, data.adminPassword);
    const departmentIds = [...new Set(data.departmentIds)].sort();
    const configuration = JSON.stringify({ departmentIds, count: data.count });
    const previous = db
      .prepare("SELECT * FROM account_batches WHERE id=?")
      .get(data.requestId);
    if (previous) {
      if (
        previous.actor_id !== admin.id ||
        previous.configuration !== configuration
      )
        fail(409, "批次编号已被使用，请重新打开开通窗口");
      res.json({
        batchId: data.requestId,
        created: JSON.parse(previous.user_ids as string).length,
        departmentCount: departmentIds.length,
        reused: true,
      });
      return;
    }
    if (generating.size) fail(409, "正在开通另一批账号，请稍后重试");
    function checkDepartments() {
      for (const id of departmentIds)
        if (
          !db
            .prepare("SELECT id FROM departments WHERE id=? AND enabled=1")
            .get(id)
        )
          fail(400, "部门不存在或已停用");
    }
    checkDepartments();
    generating.add(data.requestId);
    try {
      const rows = [];
      const adjectives = [
        "晴朗",
        "清新",
        "开朗",
        "沉稳",
        "敏捷",
        "专注",
        "好奇",
        "勇敢",
        "温和",
        "灵动",
      ];
      const nouns = [
        "星河",
        "松果",
        "海豚",
        "山雀",
        "青竹",
        "飞鸟",
        "晨光",
        "白帆",
        "溪流",
        "云杉",
      ];
      for (const departmentId of departmentIds)
        for (let index = 0; index < data.count; index++) {
          const password = `Cb-${randomBytes(15).toString("base64url")}`;
          const id = randomUUID(),
            suffix = randomBytes(5).toString("hex");
          rows.push({
            id,
            departmentId,
            username: `staff.${suffix}`,
            name: `${adjectives[randomInt(adjectives.length)]}${nouns[randomInt(nouns.length)]}·${suffix.slice(0, 4)}`,
            password,
            hash: await passwordHashAsync(password),
          });
        }
      // Hashing yields to other requests; permission and department changes must take effect before insertion.
      const valid = db
        .prepare(
          "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN departments d ON d.id=u.department_id WHERE s.token_hash=? AND u.id=? AND s.auth_version=u.auth_version AND u.enabled=1 AND u.must_change=0 AND u.role='company_admin' AND d.enabled=1 AND s.expires_at>?",
        )
        .get(tokenHash(req.cookies.brain_session), admin.id, Date.now());
      if (!valid) fail(401, "登录或权限已变更，请重新登录");
      checkDepartments();
      db.exec("BEGIN IMMEDIATE");
      try {
        const insert = db.prepare(
          "INSERT INTO users(id,username,name,department_id,role,password_hash,initial_expires_at) VALUES(?,?,?,?,'employee',?,?)",
        );
        for (const row of rows) {
          insert.run(
            row.id,
            row.username,
            row.name,
            row.departmentId,
            row.hash,
            Date.now() + 30 * 24 * 3600_000,
          );
          saveManagedPassword(store, row.id, "employee", row.password);
          store.audit(admin.id, "account.created", row.id);
        }
        db.prepare("INSERT INTO account_batches VALUES(?,?,?,?,?)").run(
          data.requestId,
          admin.id,
          configuration,
          JSON.stringify(rows.map((row) => row.id)),
          new Date().toISOString(),
        );
        store.audit(admin.id, "account.batch_generated", data.requestId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      res
        .status(201)
        .json({
          batchId: data.requestId,
          created: rows.length,
          departmentCount: departmentIds.length,
          reused: false,
        });
    } finally {
      generating.delete(data.requestId);
    }
  });
}
