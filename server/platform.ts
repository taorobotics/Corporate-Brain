import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createStore,
  passwordHash,
  passwordMatches,
  tokenHash,
} from "./database";
import type { User, Skill, Connection } from "../shared/types";
import { mountUpdates } from "./updates";
import { DshManager, DshUnavailableError } from "./dsh";
import { syncDeepSeekConnections } from "./deepseek-sync";
import rootPackage from "../package.json";

const id = z.string().uuid();
const shortText = z.string().trim().min(1).max(100);
const attachment = z
  .object({
    name: z.string().trim().min(1).max(200),
    content: z.string().max(2_000_000).default(""),
    image: z.string().max(12_000_000).optional(),
  })
  .strict();
const password = z.string().min(12, "密码至少 12 位").max(128);
const roles = z.enum([
  "company_admin",
  "department_admin",
  "department_reviewer",
  "company_reviewer",
  "employee",
]);
const account = z
  .object({
    username: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_.@-]{2,64}$/, "账号使用 2–64 位字母、数字或 . _ @ -"),
    name: shortText,
    departmentId: id,
    role: roles.default("employee"),
  })
  .strict();
const packageSchema = z
  .object({
    name: shortText,
    description: z.string().trim().min(1).max(1000),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    instructions: z.string().trim().min(10).max(60000),
    examples: z.string().max(12000).default(""),
    testSummary: z.string().trim().min(1).max(4000),
    requiredTools: z.array(z.string().max(60)).max(12).default([]),
    audience: z.enum(["department", "departments", "company"]),
    targetDepartments: z.array(id).max(100).default([]),
    previousId: id.optional(),
  })
  .strict();
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}
type Row = Record<string, any>;
type AuthRequest = Request & { actor?: User };
const queryUser = `SELECT u.*, d.name AS department_name, d.enabled AS department_enabled FROM users u JOIN departments d ON d.id=u.department_id`;
function userView(row: Row): User {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    role: row.role,
    enabled: row.enabled,
    mustChange: row.must_change,
    distributed: row.distributed,
  };
}
function skillView(row: Row): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    instructions: row.instructions,
    examples: row.examples,
    testSummary: row.test_summary,
    requiredTools: JSON.parse(row.required_tools),
    authorId: row.author_id,
    authorName: row.author_name,
    ownerDepartmentId: row.owner_department_id,
    ownerDepartmentName: row.department_name,
    audience: row.audience,
    targetDepartments: JSON.parse(row.targets),
    status: row.status,
    reviewNote: row.review_note,
    createdAt: row.created_at,
  };
}
export function visible(skill: Skill, actor: User) {
  return (
    actor.role === "company_admin" ||
    (skill.status === "published" &&
      (skill.audience === "company" ||
        skill.targetDepartments.includes(actor.departmentId)))
  );
}
export function reviewable(skill: Skill, actor: User) {
  return (
    actor.role === "company_admin" ||
    actor.role === "company_reviewer" ||
    (actor.role === "department_reviewer" &&
      skill.ownerDepartmentId === actor.departmentId &&
      skill.audience === "department")
  );
}
function connectionView(row: Row): Connection {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    kind: row.kind,
    departments: JSON.parse(row.departments),
    hasKey: !!row.secret,
    enabled: row.enabled,
  };
}
export function createPlatform(
  options: {
    database?: string;
    origins?: string[];
    secureCookies?: boolean;
    updates?: import("./updates").UpdateOptions;
  } = {},
) {
  const store = createStore(options.database ?? ".data/platform.sqlite");
  syncDeepSeekConnections(store);
  const dsh = process.env.BRAIN_DSH_ENABLED === "0" ? null : new DshManager();
  const { db } = store;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16mb" }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (["POST", "PATCH", "DELETE", "PUT"].includes(req.method)) {
      const origin = req.get("origin");
      const allowed = options.origins ?? [
        "http://127.0.0.1:4173",
        "http://localhost:4173",
        "http://127.0.0.1:4310",
      ];
      if (origin && !allowed.includes(origin))
        return res.status(403).json({ error: "请求来源未授权" });
      if (!req.is("application/json"))
        return res.status(415).json({ error: "需要 JSON 请求" });
    }
    next();
  });
  const userById = (value: string) =>
    db.prepare(`${queryUser} WHERE u.id=?`).get(value) as Row | undefined;
  const skillById = (value: string) => {
    const row = db
      .prepare(
        "SELECT s.*,u.name AS author_name,d.name AS department_name FROM skills s JOIN users u ON u.id=s.author_id JOIN departments d ON d.id=s.owner_department_id WHERE s.id=?",
      )
      .get(value) as Row | undefined;
    return row ? skillView(row) : fail(404, "技能不存在或无权访问");
  };
  function admin(actor: User) {
    if (actor.role !== "company_admin") fail(403, "需要公司管理员权限");
  }
  function manage(actor: User, departmentId: string, targetRole = "employee") {
    if (
      actor.role !== "company_admin" &&
      !(
        actor.role === "department_admin" &&
        actor.departmentId === departmentId &&
        targetRole === "employee"
      )
    )
      fail(403, "无权管理这个部门或角色");
  }
  function activeDepartment(departmentId: string) {
    const row = db
      .prepare("SELECT * FROM departments WHERE id=? AND enabled=1")
      .get(departmentId);
    if (!row) fail(400, "部门不存在或已停用");
  }
  const getActor = (req: Request) => (req as AuthRequest).actor!;
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      version: rootPackage.version,
      chatStorage: "device-only",
    }),
  );
  app.get("/api/bootstrap", (_req, res) =>
    res.json({ required: !db.prepare("SELECT id FROM users LIMIT 1").get() }),
  );
  app.post("/api/bootstrap", (req, res) => {
    if (db.prepare("SELECT id FROM users LIMIT 1").get())
      fail(409, "平台已初始化");
    const data = z
      .object({
        companyName: shortText,
        name: shortText,
        username: account.shape.username,
        password,
      })
      .strict()
      .parse(req.body);
    const departmentId = randomUUID();
    const userId = randomUUID();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO departments(id,name) VALUES(?,?)").run(
        departmentId,
        data.companyName,
      );
      db.prepare(
        "INSERT INTO users(id,username,name,department_id,role,password_hash,must_change,distributed) VALUES(?,?,?,?,?,?,0,1)",
      ).run(
        userId,
        data.username,
        data.name,
        departmentId,
        "company_admin",
        passwordHash(data.password),
      );
      store.audit(userId, "platform.initialized", departmentId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.status(201).json({ initialized: true });
  });
  app.post("/api/auth/login", (req, res) => {
    const data = z
      .object({ username: z.string().max(64), password: z.string().max(128) })
      .strict()
      .parse(req.body);
    const key = req.ip ?? "local";
    const now = Date.now();
    let attempts = loginAttempts.get(key);
    if (!attempts || attempts.resetAt < now) {
      attempts = { count: 0, resetAt: now + 10 * 60_000 };
      loginAttempts.set(key, attempts);
    }
    if (attempts.count >= 12) fail(429, "尝试次数过多，请稍后再试");
    const row = db
      .prepare(`${queryUser} WHERE u.username=? COLLATE NOCASE`)
      .get(data.username) as Row | undefined;
    const valid = row
      ? passwordMatches(data.password, row.password_hash)
      : (passwordMatches(
          data.password,
          passwordHash(randomBytes(16).toString("hex")),
        ),
        false);
    if (!valid || !row?.enabled || !row.department_enabled) {
      attempts.count++;
      fail(401, "账号、密码或账号状态不正确");
    }
    if (row.must_change && row.initial_expires_at < now)
      fail(401, "初始密码已过期，请联系管理员重置");
    loginAttempts.delete(key);
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires_at<?").run(now);
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      tokenHash(token),
      row.id,
      row.auth_version,
      now + 8 * 3600_000,
    );
    res.cookie("brain_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: options.secureCookies ?? false,
      maxAge: 8 * 3600_000,
      path: "/",
    });
    store.audit(row.id, "account.login", row.id);
    res.json(userView(row));
  });
  app.use("/api", (req: AuthRequest, _res, next) => {
    const token = req.cookies?.brain_session;
    const session =
      typeof token === "string"
        ? (db
            .prepare(
              "SELECT * FROM sessions WHERE token_hash=? AND expires_at>?",
            )
            .get(tokenHash(token), Date.now()) as Row | undefined)
        : undefined;
    const row = session ? userById(session.user_id) : undefined;
    if (
      !row ||
      !row.enabled ||
      !row.department_enabled ||
      row.auth_version !== session!.auth_version
    )
      fail(401, "请重新登录");
    req.actor = userView(row);
    if (
      row.must_change &&
      !["/auth/me", "/auth/password", "/auth/logout"].includes(req.path)
    )
      fail(403, "请先修改初始密码");
    next();
  });
  app.get("/api/auth/me", (req, res) => res.json(getActor(req)));
  mountUpdates(app, options.updates);
  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
      tokenHash(req.cookies.brain_session),
    );
    res.clearCookie("brain_session", { path: "/" });
    res.json({ ok: true });
  });
  app.post("/api/auth/password", (req, res) => {
    const actor = getActor(req);
    const data = z
      .object({ current: z.string().max(128), password })
      .strict()
      .parse(req.body);
    const row = userById(actor.id)!;
    if (!passwordMatches(data.current, row.password_hash))
      fail(400, "当前密码不正确");
    db.prepare(
      "UPDATE users SET password_hash=?,must_change=0,initial_expires_at=0,auth_version=auth_version+1 WHERE id=?",
    ).run(passwordHash(data.password), actor.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(actor.id);
    store.audit(actor.id, "account.password_changed", actor.id);
    res.clearCookie("brain_session", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/departments", (req, res) => {
    const actor = getActor(req);
    res.json(
      actor.role === "company_admin"
        ? db.prepare("SELECT * FROM departments ORDER BY name").all()
        : db
            .prepare("SELECT * FROM departments WHERE enabled=1 ORDER BY name")
            .all(),
    );
  });
  app.post("/api/departments", (req, res) => {
    const actor = getActor(req);
    admin(actor);
    const data = z.object({ name: shortText }).strict().parse(req.body);
    const departmentId = randomUUID();
    db.prepare("INSERT INTO departments(id,name) VALUES(?,?)").run(
      departmentId,
      data.name,
    );
    store.audit(actor.id, "department.created", departmentId);
    res.status(201).json({ id: departmentId, name: data.name, enabled: 1 });
  });
  app.patch("/api/departments/:id", (req, res) => {
    const actor = getActor(req);
    admin(actor);
    const departmentId = id.parse(req.params.id);
    const data = z
      .object({ name: shortText, enabled: z.boolean() })
      .strict()
      .parse(req.body);
    if (
      !data.enabled &&
      (db
        .prepare(
          "SELECT id FROM users WHERE department_id=? AND enabled=1 LIMIT 1",
        )
        .get(departmentId) ||
        db
          .prepare(
            "SELECT id FROM skills WHERE owner_department_id=? AND status IN ('pending','published') LIMIT 1",
          )
          .get(departmentId))
    )
      fail(409, "请先转移或停用部门成员，并处理待审和已发布技能");
    const result = db
      .prepare("UPDATE departments SET name=?,enabled=? WHERE id=?")
      .run(data.name, Number(data.enabled), departmentId);
    if (!result.changes) fail(404, "部门不存在");
    store.audit(actor.id, "department.updated", departmentId);
    res.json({ ok: true });
  });
  app.get("/api/users", (req, res) => {
    const actor = getActor(req);
    if (!["company_admin", "department_admin"].includes(actor.role))
      fail(403, "无账号管理权限");
    const rows =
      actor.role === "company_admin"
        ? db.prepare(`${queryUser} ORDER BY u.name`).all()
        : db
            .prepare(`${queryUser} WHERE u.department_id=? ORDER BY u.name`)
            .all(actor.departmentId);
    res.json((rows as Row[]).map(userView));
  });
  function createAccount(data: z.infer<typeof account>, actor: User) {
    manage(actor, data.departmentId, data.role);
    activeDepartment(data.departmentId);
    if (
      db
        .prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE")
        .get(data.username)
    )
      fail(409, "登录账号已存在");
    const userId = randomUUID();
    const initialPassword = `Cb-${randomBytes(15).toString("base64url")}`;
    db.prepare(
      "INSERT INTO users(id,username,name,department_id,role,password_hash,initial_expires_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      userId,
      data.username,
      data.name,
      data.departmentId,
      data.role,
      passwordHash(initialPassword),
      Date.now() + 24 * 3600_000,
    );
    store.audit(actor.id, "account.created", userId);
    return { user: userView(userById(userId)!), initialPassword };
  }
  app.post("/api/users", (req, res) =>
    res.status(201).json(createAccount(account.parse(req.body), getActor(req))),
  );
  app.post("/api/users/batch", (req, res) => {
    const actor = getActor(req);
    if (!["company_admin", "department_admin"].includes(actor.role))
      fail(403, "无账号管理权限");
    const data = z
      .object({ rows: z.array(account).min(1).max(100) })
      .strict()
      .parse(req.body);
    const results = data.rows.map((row, index) => {
      try {
        return { row: index + 1, ...createAccount(row, actor) };
      } catch (error) {
        if (error instanceof ApiError)
          return { row: index + 1, error: error.message };
        throw error;
      }
    });
    res.status(201).json(results);
  });
  app.patch("/api/users/:id", (req, res) => {
    const actor = getActor(req);
    const target = userById(id.parse(req.params.id));
    if (!target) fail(404, "员工不存在");
    const data = z
      .object({
        departmentId: id,
        role: roles,
        enabled: z.boolean(),
        name: shortText,
      })
      .strict()
      .parse(req.body);
    manage(actor, target.department_id, target.role);
    manage(actor, data.departmentId, data.role);
    activeDepartment(data.departmentId);
    if (
      target.id === actor.id &&
      (!data.enabled ||
        data.role !== actor.role ||
        data.departmentId !== actor.departmentId)
    )
      fail(409, "不能在此变更自己的管理角色、所属部门或停用自己");
    if (
      target.role === "company_admin" &&
      (!data.enabled || data.role !== "company_admin") &&
      Number(
        (
          db
            .prepare(
              "SELECT count(*) AS n FROM users WHERE role='company_admin' AND enabled=1",
            )
            .get() as Row
        ).n,
      ) <= 1
    )
      fail(409, "必须保留至少一位公司管理员");
    db.prepare(
      "UPDATE users SET name=?,department_id=?,role=?,enabled=?,auth_version=auth_version+1 WHERE id=?",
    ).run(
      data.name,
      data.departmentId,
      data.role,
      Number(data.enabled),
      target.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
    store.audit(actor.id, "account.updated", target.id);
    res.json(userView(userById(target.id)!));
  });
  app.post("/api/users/:id/reset", (req, res) => {
    const actor = getActor(req);
    const target = userById(id.parse(req.params.id));
    if (!target) fail(404, "员工不存在");
    manage(actor, target.department_id, target.role);
    const initialPassword = `Cb-${randomBytes(15).toString("base64url")}`;
    db.prepare(
      "UPDATE users SET password_hash=?,must_change=1,initial_expires_at=?,distributed=0,auth_version=auth_version+1 WHERE id=?",
    ).run(passwordHash(initialPassword), Date.now() + 24 * 3600_000, target.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
    store.audit(actor.id, "account.password_reset", target.id);
    res.json({ username: target.username, initialPassword });
  });
  app.post("/api/users/:id/distributed", (req, res) => {
    const actor = getActor(req);
    const target = userById(id.parse(req.params.id));
    if (!target) fail(404, "员工不存在");
    manage(actor, target.department_id, target.role);
    db.prepare("UPDATE users SET distributed=1 WHERE id=?").run(target.id);
    store.audit(actor.id, "account.distributed", target.id);
    res.json({ ok: true });
  });

  const allSkills = () =>
    (
      db
        .prepare(
          "SELECT s.*,u.name AS author_name,d.name AS department_name FROM skills s JOIN users u ON u.id=s.author_id JOIN departments d ON d.id=s.owner_department_id ORDER BY s.created_at DESC",
        )
        .all() as Row[]
    ).map(skillView);
  app.get("/api/skills", (req, res) => {
    const actor = getActor(req);
    const mine = req.query.mine === "1";
    res.json(
      allSkills().filter((skill) =>
        mine
          ? skill.authorId === actor.id &&
            (skill.ownerDepartmentId === actor.departmentId ||
              visible(skill, actor))
          : skill.status === "published" && visible(skill, actor),
      ),
    );
  });
  app.get("/api/reviews", (req, res) => {
    const actor = getActor(req);
    if (
      !["company_admin", "company_reviewer", "department_reviewer"].includes(
        actor.role,
      )
    )
      fail(403, "无技能审核权限");
    res.json(allSkills().filter((skill) => reviewable(skill, actor)));
  });
  app.post("/api/skills", (req, res) => {
    const actor = getActor(req);
    const data = packageSchema.parse(req.body);
    const prohibited =
      /(?:[A-Z]:[\\/](?:Users|Open_Source_Project)|\/(?:Users|home)\/[^\s/]+|sk-[A-Za-z0-9_-]{16,}|(?:api[_-]?key|password|token)\s*[:=]\s*["']?[^\s"']{8,})/i;
    if (
      prohibited.test(
        [data.instructions, data.examples, data.testSummary].join("\n"),
      )
    )
      fail(400, "提交内容疑似包含个人路径或凭据，请检查后再提交");
    const targets =
      data.audience === "department"
        ? [actor.departmentId]
        : data.audience === "company"
          ? []
          : [...new Set(data.targetDepartments)];
    if (data.audience === "departments" && !targets.length)
      fail(400, "请选择共享部门");
    targets.forEach(activeDepartment);
    if (
      db
        .prepare(
          "SELECT id FROM skills WHERE owner_department_id=? AND name=? AND version=?",
        )
        .get(actor.departmentId, data.name, data.version)
    )
      fail(409, "这个技能版本已存在，请递增版本号");
    if (data.previousId) {
      const previous = skillById(data.previousId);
      if (
        previous.ownerDepartmentId !== actor.departmentId ||
        (previous.authorId !== actor.id && actor.role !== "company_admin")
      )
        fail(403, "无权提交这个部门技能的新版本");
      if (
        allSkills().some(
          (skill) =>
            skill.name === data.name &&
            skill.ownerDepartmentId === actor.departmentId &&
            skill.version === data.version,
        )
      )
        fail(409, "该版本已存在，请递增版本号");
    }
    const skillId = randomUUID();
    db.prepare(
      "INSERT INTO skills(id,name,description,version,instructions,examples,test_summary,required_tools,author_id,owner_department_id,audience,targets,status,created_at,previous_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      skillId,
      data.name,
      data.description,
      data.version,
      data.instructions,
      data.examples,
      data.testSummary,
      JSON.stringify(data.requiredTools),
      actor.id,
      actor.departmentId,
      data.audience,
      JSON.stringify(targets),
      "pending",
      new Date().toISOString(),
      data.previousId ?? null,
    );
    store.audit(actor.id, "skill.submitted", skillId);
    res.status(201).json(skillById(skillId));
  });
  app.post("/api/skills/:id/review", (req, res) => {
    const actor = getActor(req);
    const skill = skillById(id.parse(req.params.id));
    if (!reviewable(skill, actor)) fail(403, "无权审核该技能或发布范围");
    if (skill.status !== "pending") fail(409, "该提交已经处理");
    const data = z
      .object({
        approve: z.boolean(),
        note: z.string().trim().min(1).max(2000),
      })
      .strict()
      .parse(req.body);
    db.prepare("UPDATE skills SET status=?,review_note=? WHERE id=?").run(
      data.approve ? "published" : "rejected",
      data.note,
      skill.id,
    );
    store.audit(
      actor.id,
      data.approve ? "skill.published" : "skill.rejected",
      skill.id,
    );
    res.json(skillById(skill.id));
  });
  app.get("/api/skills/:id/download", (req, res) => {
    const actor = getActor(req);
    const skill = skillById(id.parse(req.params.id));
    if (skill.status !== "published" || !visible(skill, actor))
      fail(404, "技能不存在或无权下载");
    store.audit(actor.id, "skill.downloaded", skill.id);
    res.json(skill);
  });
  app.post("/api/skills/:id/disable", (req, res) => {
    const actor = getActor(req);
    const skill = skillById(id.parse(req.params.id));
    if (!reviewable(skill, actor)) fail(403, "无权停用");
    db.prepare("UPDATE skills SET status='disabled' WHERE id=?").run(skill.id);
    store.audit(actor.id, "skill.disabled", skill.id);
    res.json({ ok: true });
  });

  app.get("/api/connections", (req, res) => {
    const actor = getActor(req);
    const rows = (
      db.prepare("SELECT * FROM connections ORDER BY name").all() as Row[]
    ).map(connectionView);
    res.json(
      rows.filter(
        (row) =>
          actor.role === "company_admin" ||
          (row.enabled &&
            (!row.departments.length ||
              row.departments.includes(actor.departmentId))),
      ),
    );
  });
  app.post("/api/connections", (req, res) => {
    const actor = getActor(req);
    admin(actor);
    const data = z
      .object({
        name: shortText,
        baseUrl: z.url().max(300),
        model: shortText,
        kind: z.enum(["chat", "image"]),
        apiKey: z.string().min(1).max(300),
        departments: z.array(id).default([]),
      })
      .strict()
      .parse(req.body);
    const url = new URL(data.baseUrl);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      fail(400, "外部服务需要 HTTPS，本机服务可用 HTTP");
    if (url.username || url.password || url.search || url.hash)
      fail(400, "服务地址不能包含账号、查询参数或片段");
    data.departments.forEach(activeDepartment);
    const connectionId = randomUUID();
    db.prepare("INSERT INTO connections VALUES(?,?,?,?,?,?,?,1)").run(
      connectionId,
      data.name,
      data.baseUrl.replace(/\/$/, ""),
      data.model,
      data.kind,
      JSON.stringify(data.departments),
      store.encrypt(data.apiKey),
    );
    store.audit(actor.id, "connection.created", connectionId);
    res
      .status(201)
      .json(
        connectionView(
          db
            .prepare("SELECT * FROM connections WHERE id=?")
            .get(connectionId) as Row,
        ),
      );
  });
  app.delete("/api/connections/:id", (req, res) => {
    const actor = getActor(req);
    admin(actor);
    db.prepare("UPDATE connections SET enabled=0 WHERE id=?").run(
      id.parse(req.params.id),
    );
    store.audit(actor.id, "connection.disabled", String(req.params.id));
    res.json({ ok: true });
  });
  function getConnection(connectionId: string, actor: User, kind: string) {
    const row = db
      .prepare("SELECT * FROM connections WHERE id=? AND enabled=1")
      .get(connectionId) as Row | undefined;
    if (
      !row ||
      row.kind !== kind ||
      (actor.role !== "company_admin" &&
        JSON.parse(row.departments).length &&
        !JSON.parse(row.departments).includes(actor.departmentId))
    )
      fail(403, "模型未配置、已停用或无权使用");
    return row;
  }
  async function invoke(row: Row, endpoint: string, payload: unknown) {
    let response: globalThis.Response;
    try {
      response = await fetch(`${row.base_url}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${store.decrypt(row.secret)}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
        redirect: "error",
      });
    } catch {
      fail(502, "模型服务连接失败或超时，请检查连接配置");
    }
    if (!response!.ok)
      fail(502, `模型服务返回 ${response!.status}，请检查模型标识、余额和权限`);
    return response!.json() as Promise<Row>;
  }
  app.post("/api/generate/chat", async (req, res) => {
    const actor = getActor(req);
    const data = z
      .object({
        connectionId: id,
        sessionId: id.optional(),
        messages: z
          .array(
            z
              .object({
                role: z.enum(["user", "assistant", "system"]),
                content: z.string().max(80000),
              })
              .strict(),
          )
          .min(1)
          .max(60),
        attachments: z.array(attachment).max(8).default([]),
        mode: z.enum(["standard", "ptc", "minimal", "creative"]).default("standard"),
        workspaceAccess: z.enum(["view", "edit", "full"]).default("edit"),
      })
      .strict()
      .parse(req.body);
    const row = getConnection(data.connectionId, actor, "chat");
    let content: string | undefined;
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
    const hasImageAttachment = data.attachments.some((item) => item.image);
    try {
      if (!dsh) throw new DshUnavailableError("DSH 已由管理员停用");
      const result = await dsh.runDetailed({
        connectionId: row.id,
        baseUrl: row.base_url,
        model: row.model,
        apiKey: store.decrypt(row.secret),
        userId: actor.id,
        sessionId: data.sessionId ?? randomUUID(),
        messages: data.messages,
        attachments: data.attachments,
        mode: data.mode,
        workspaceAccess: data.workspaceAccess,
      });
      content = result.content;
      usage = result.usage;
    } catch (error) {
      // Visual requests can be accepted by the OpenAI-compatible provider even
      // when a DSH preset rejects the image block. Retry those requests through
      // the direct chat endpoint so an uploaded image is still sent to the model.
      if (!(error instanceof DshUnavailableError) && !hasImageAttachment)
        fail(502, (error as Error).message.slice(0, 500));
    }
    if (typeof content !== "string") {
      const lastUserIndex = data.messages.findLastIndex(
        (message) => message.role === "user",
      );
      const textAttachments = data.attachments
        .filter((item) => item.content)
        .map((item) => `\n\n文件附件：${item.name}\n${item.content}`)
        .join("");
      const directMessages = data.messages.map((message, index) => {
        if (
          index !== lastUserIndex ||
          (!data.attachments.length && !textAttachments)
        )
          return message;
        return {
          ...message,
          content: [
            { type: "text", text: `${message.content}${textAttachments}` },
            ...data.attachments
              .filter((item) => item.image)
              .map((item) => ({
                type: "image_url",
                image_url: { url: item.image },
              })),
          ],
        };
      });
      const result = await invoke(row, "/chat/completions", {
        model: row.model,
        messages: directMessages,
        stream: false,
      });
      content = result.choices?.[0]?.message?.content;
      usage = result.usage;
      if (typeof content !== "string" || !content.trim())
        fail(502, "模型未返回可显示的文本");
    }
    store.audit(actor.id, "model.chat_completed", row.id);
    res.json({ content, usage });
  });
  app.post("/api/generate/image", async (req, res) => {
    const actor = getActor(req);
    const data = z
      .object({ connectionId: id, prompt: z.string().min(1).max(12000) })
      .strict()
      .parse(req.body);
    const row = getConnection(data.connectionId, actor, "image");
    const result = await invoke(row, "/images/generations", {
      model: row.model,
      prompt: data.prompt,
      n: 1,
    });
    const item = result.data?.[0];
    if (!item?.b64_json)
      fail(502, "当前连接需返回 b64_json 图片，暂不接收远程图片链接");
    store.audit(actor.id, "model.image_completed", row.id);
    res.json({ image: `data:image/png;base64,${item.b64_json}` });
  });
  app.get("/api/audit", (req, res) => {
    admin(getActor(req));
    res.json(
      db
        .prepare(
          "SELECT a.*,u.name AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200",
        )
        .all(),
    );
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof z.ZodError)
        return res.status(400).json({
          error: error.issues.map((issue) => issue.message).join("；"),
        });
      if (error instanceof ApiError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof Error && error.message.includes("UNIQUE constraint"))
        return res.status(409).json({ error: "名称或账号已存在" });
      if ((error as any)?.type === "entity.too.large")
        return res
          .status(413)
          .json({ error: "请求内容过大，请减少素材或记录数量" });
      // Never log request bodies, provider responses, passwords, or conversation context.
      res.status(500).json({ error: "服务暂时无法处理，请重试" });
    },
  );
  return { app, store };
}
