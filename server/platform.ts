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
import { mountFeedback } from "./feedback";
import { mountNas, type NasOptions } from "./nas";
import { mountDocuments } from "./documents";
import { mountProfile } from "./profile";
import { mountAccounts, saveManagedPassword, usernameSchema } from "./accounts";
import { mountProduction, ProductionError } from "./production";
import { completeProduction, ProductionOutputError } from "./production-output";
import { defaultAvatar } from "../shared/avatars";
import {
  visualInputs,
  validateAttachmentBudget,
  unsupportedDeepSeekVision,
  ATTACHMENT_CONTEXT_RULE,
  MAX_ATTACHMENT_REQUEST_TEXT,
  ATTACHMENT_TEXT_LIMIT_MESSAGE,
} from "../shared/attachments";
import { DshManager, DshUnavailableError } from "./dsh";
import { DshLoopError } from "./dsh-output";
import { syncDeepSeekConnections } from "./deepseek-sync";
import { imageSkills, generatedImage } from "./image-skills";
import {
  chooseImageSkill,
  imageModelProfile,
  imageRequestOptions,
} from "./image-models";
import {
  connectionSelect,
  resolveConnection,
  migrateLinoRoute,
  mountModelServices,
  canUseConnection,
} from "./model-services";
import {
  modelFetch,
  modelConnectionErrorCode,
  retryModelConnection,
  modelUsesCustomDns,
  privateModelProxy,
  type ModelTransport,
} from "./model-transport";
import type { ChatProgress } from "../shared/chat-progress";
import { readChatResponse } from "./chat-stream";
import { createChatDeadline, ChatTimeoutError } from "./chat-deadline";
import rootPackage from "../package.json";
import { dirname, join } from "node:path";
import {
  mountSkillLibrary,
  type SkillLibraryOptions,
  type SkillResources,
} from "./skill-library";
import { SkillImportError } from "./skill-import";
import { mountCommunityPlugins } from "./community-plugins";
import { hasPrivateSkillContent } from "./skill-package";
import {
  AUTOMATIC_ROUTER_INSTRUCTION,
  parseAutomaticPlan,
  preserveNasFilenames,
} from "./automatic";
import { companyLookupSchema, companyContext } from "./company-context";
import {
  isCasualMessage,
  isModelIdentityQuestion,
  CASUAL_REPLY_INSTRUCTION,
  ANSWER_INSTRUCTION,
} from "../shared/conversation-request";
import {
  skillIdsSchema,
  resolveSkillList,
  pickRoutedSkills,
  skillInstructions,
  skillReferences,
  SkillUseError,
} from "./skill-use";

const id = z.string().uuid();
const shortText = z.string().trim().min(1).max(100);
const attachment = z
  .object({
    name: z.string().trim().min(1).max(200),
    content: z
      .string()
      .max(MAX_ATTACHMENT_REQUEST_TEXT, ATTACHMENT_TEXT_LIMIT_MESSAGE)
      .default(""),
    image: z
      .string()
      .max(12_000_000)
      .regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/\r\n]+=*$/)
      .optional(),
    images: z
      .array(
        z
          .object({
            label: z.string().max(200),
            image: z
              .string()
              .max(1_400_000)
              .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/),
          })
          .strict(),
      )
      .max(8)
      .optional(),
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
    username: usernameSchema,
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
    avatar: row.avatar || defaultAvatar(row.id),
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
    ...(row.import_source ? { imported: JSON.parse(row.import_source) } : {}),
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
  if (skill.ownerUserId) return skill.ownerUserId === actor.id;
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
    serviceId: row.service_id ?? undefined,
    serviceName: row.service_name ?? undefined,
    serviceProvider: row.service_provider ?? undefined,
    personal: Boolean(row.owner_user_id),
    sourceServiceId: row.source_service_id ?? undefined,
  };
}
export function createPlatform(
  options: {
    database?: string;
    modelTransport?: ModelTransport;
    origins?: string[];
    secureCookies?: boolean;
    updates?: import("./updates").UpdateOptions;
    chatTimeouts?: { idleMs?: number; maxMs?: number };
    routingTimeoutMs?: number;
    skillLibrary?: SkillLibraryOptions;
    nas?: NasOptions;
    dsh?: Pick<DshManager, "runDetailed" | "close">;
    communityFetch?: typeof fetch;
  } = {},
) {
  const store = createStore(options.database ?? ".data/platform.sqlite");
  syncDeepSeekConnections(store);
  migrateLinoRoute(store);
  const dsh =
    options.dsh ??
    (process.env.BRAIN_DSH_ENABLED === "0" ? null : new DshManager());
  const { db } = store;
  const fetchModel = options.modelTransport ?? modelFetch;
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
      if (
        !req.is("application/json") &&
        !(
          req.method === "PUT" &&
          /^\/api\/production\/[0-9a-f-]{36}\/materials\/\d+$/.test(req.path) &&
          req.is("application/octet-stream")
        ) &&
        !(req.path === "/api/skill-imports/zip" && req.is("application/zip"))
      )
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
  mountProfile(app, store, getActor, fail, (userId) =>
    userView(userById(userId)!),
  );
  mountAccounts(app, store, getActor, fail, (userId) =>
    userView(userById(userId)!),
  );
  mountUpdates(app, options.updates);
  mountFeedback(app, store, getActor, fail);
  const communityPlugins = mountCommunityPlugins(app, store, getActor, fail, options.communityFetch);
  const nas = mountNas(app, store, getActor, fail, options.nas);
  mountDocuments(app, store, getActor, fail);
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
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE users SET password_hash=?,must_change=0,initial_expires_at=0,auth_version=auth_version+1 WHERE id=?",
      ).run(passwordHash(data.password), actor.id);
      saveManagedPassword(store, actor.id, actor.role, data.password);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(actor.id);
      store.audit(actor.id, "account.password_changed", actor.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
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
    res.json(
      (rows as Row[]).map((row) => ({
        ...userView(row),
        accountNote: row.account_note,
      })),
    );
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
    db.exec("BEGIN IMMEDIATE");
    try {
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
      saveManagedPassword(store, userId, data.role, initialPassword);
      store.audit(actor.id, "account.created", userId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
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
    if (data.role === "company_admin")
      db.prepare("DELETE FROM managed_credentials WHERE user_id=?").run(
        target.id,
      );
    store.audit(actor.id, "account.updated", target.id);
    res.json(userView(userById(target.id)!));
  });
  app.patch("/api/users/:id/note", (req, res) => {
    const actor = getActor(req);
    const target = userById(id.parse(req.params.id));
    if (!target) fail(404, "员工不存在");
    manage(actor, target.department_id, target.role);
    const data = z
      .object({ note: z.string().trim().max(500, "备注最多 500 字") })
      .strict()
      .parse(req.body);
    db.prepare("UPDATE users SET account_note=? WHERE id=?").run(
      data.note,
      target.id,
    );
    store.audit(actor.id, "account.note_updated", target.id);
    res.json({ ok: true });
  });
  app.post("/api/users/:id/reset", (req, res) => {
    const actor = getActor(req);
    const target = userById(id.parse(req.params.id));
    if (!target) fail(404, "员工不存在");
    manage(actor, target.department_id, target.role);
    const initialPassword = `Cb-${randomBytes(15).toString("base64url")}`;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE users SET password_hash=?,must_change=1,initial_expires_at=?,distributed=0,auth_version=auth_version+1 WHERE id=?",
      ).run(
        passwordHash(initialPassword),
        Date.now() + 24 * 3600_000,
        target.id,
      );
      saveManagedPassword(store, target.id, target.role, initialPassword);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
      store.audit(actor.id, "account.password_reset", target.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
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
  const library = mountSkillLibrary(
    app,
    store,
    getActor,
    skillById,
    (skill, actor) =>
      (skill.status === "published" && visible(skill, actor)) ||
      reviewable(skill, actor),
    options.skillLibrary ?? {
      root: join(
        dirname(options.database ?? ".data/platform.sqlite"),
        "skill-library",
      ),
    },
  );
  const checkedSkills = (actor: User, ids: string[], strict = true) =>
    resolveSkillList(
      ids,
      [...allSkills(), ...imageSkills(store, actor)],
      (skill) => visible(skill, actor),
      strict,
    );
  const resourcesFor = async (skills: Skill[]) => {
    const resources: SkillResources[] = [];
    for (const skill of skills)
      if (skill.imported)
        resources.push(await library.resources(skill.imported));
    return resources;
  };
  async function modelSkillContext(actor: User, ids: string[], limit = 80000) {
    const skills = checkedSkills(actor, ids);
    const text = skillInstructions(skills);
    if (text.length > limit)
      throw new SkillUseError(413, "所选技能内容过长，请减少本轮技能数量");
    return (
      text +
      (await skillReferences(await resourcesFor(skills), limit - text.length))
    );
  }
  const catalogFor = (actor: User) =>
    [...allSkills(), ...imageSkills(store, actor)].filter(
      (skill) => skill.status === "published" && visible(skill, actor),
    );
  app.get("/api/skills", (req, res) => {
    const actor = getActor(req);
    const mine = req.query.mine === "1";
    res.json(
      [...allSkills(), ...(mine ? [] : imageSkills(store, actor))].filter(
        (skill) =>
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
    if (hasPrivateSkillContent(data))
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
    const builtin = imageSkills(store, actor).find(
      (skill) => skill.id === req.params.id,
    );
    if (builtin) return res.json(builtin);
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
      db.prepare(connectionSelect + " ORDER BY c.name").all() as Row[]
    ).map(resolveConnection);
    res.json(
      rows
        .filter(
          (row) =>
            (!row.owner_user_id && actor.role === "company_admin") ||
            canUseConnection(row, actor),
        )
        .map(connectionView),
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
    db.prepare(
      "INSERT INTO connections(id,name,base_url,model,kind,departments,secret,enabled) VALUES(?,?,?,?,?,?,?,1)",
    ).run(
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
    const target = db
      .prepare(connectionSelect + " WHERE c.id=?")
      .get(id.parse(req.params.id)) as Row | undefined;
    if (target?.owner_user_id)
      fail(403, "个人连接只能由本人通过个人模型配置管理");
    db.prepare("UPDATE connections SET enabled=0 WHERE id=?").run(
      id.parse(req.params.id),
    );
    store.audit(actor.id, "connection.disabled", String(req.params.id));
    res.json({ ok: true });
  });
  mountModelServices(app, store, getActor, fail, fetchModel);
  function getConnection(connectionId: string, actor: User, kind: string) {
    const row = db
      .prepare(connectionSelect + " WHERE c.id=? AND c.enabled=1")
      .get(connectionId) as Row | undefined;
    if (!row || row.kind !== kind || !canUseConnection(row, actor))
      fail(403, "模型未配置、已停用或无权使用");
    return resolveConnection(row);
  }
  async function invoke(
    row: Row,
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
  ) {
    let response: globalThis.Response;
    try {
      response = await fetchModel(row, `${row.base_url}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${store.decrypt(row.secret)}`,
        },
        body: JSON.stringify(payload),
        signal,
        redirect: "error",
      });
    } catch {
      signal?.throwIfAborted();
      fail(502, "模型服务连接失败或超时，请检查连接配置");
    }
    if (!response!.ok)
      fail(502, `模型服务返回 ${response!.status}，请检查模型标识、余额和权限`);
    if (!response!.body) fail(502, "模型服务未返回内容");
    const reader = response!.body!.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.length;
        if (bytes > 32_000_000)
          fail(502, "模型服务返回的图片过大，请降低尺寸后重试");
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Row;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const production = mountProduction(app, db, getActor, {
    root:
      process.env.BRAIN_PRODUCTION_ROOT ||
      join(dirname(options.database ?? ".data/platform.sqlite"), "production"),
    async skillContext(owner, ids) {
      const actor = userById(owner);
      if (
        !actor ||
        !actor.enabled ||
        !actor.department_enabled ||
        actor.must_change
      )
        fail(403, "员工账号当前不可用");
      return modelSkillContext(userView(actor), ids);
    },
    authorize(owner, connectionId) {
      const row = userById(owner);
      if (!row || !row.enabled || !row.department_enabled || row.must_change)
        fail(403, "员工账号当前不可用");
      getConnection(connectionId, userView(row), "chat");
    },
    async generate(owner, connectionId, messages, signal, reasoning, updates) {
      const actor = userById(owner);
      if (
        !actor ||
        !actor.enabled ||
        !actor.department_enabled ||
        actor.must_change
      )
        fail(403, "员工账号当前不可用");
      const row = getConnection(connectionId, userView(actor), "chat");
      const content = await completeProduction({
        model: row.model,
        messages,
        signal,
        reasoning,
        updates,
        request: async (body, requestSignal) => {
          const current = userById(owner);
          if (
            !current ||
            !current.enabled ||
            !current.department_enabled ||
            current.must_change
          )
            throw new ProductionOutputError(
              "员工账号当前不可用，生成草稿已保留",
              false,
            );
          const active = getConnection(connectionId, userView(current), "chat");
          if (active.model !== row.model || active.base_url !== row.base_url)
            throw new ProductionOutputError(
              "模型配置已更改，生成草稿已保留，请重试",
              false,
            );
          return fetchModel(active, `${active.base_url}/chat/completions`, {
            method: "POST",
            redirect: "error",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${store.decrypt(active.secret)}`,
            },
            body: JSON.stringify(body),
            signal: requestSignal,
          });
        },
      });
      store.audit(owner, "production.generated", connectionId);
      return content;
    },
  });
  app.post("/api/generate/plan", async (req, res) => {
    const actor = getActor(req);
    const data = z
      .object({
        connectionId: id,
        skillMode: z.enum(["auto", "manual"]).default("manual"),
        imageSkills: z.boolean().default(false),
        skillIds: z.array(id).max(128).default([]),
        messages: z
          .array(
            z
              .object({
                role: z.enum(["user", "assistant"]),
                content: z.string().max(80000),
              })
              .strict(),
          )
          .min(1)
          .max(40),
        requestedCompanyLookup: companyLookupSchema.optional(),
        previousCompanyLookup: companyLookupSchema.optional(),
        project: z
          .object({ name: z.string().max(100), hasFolder: z.boolean() })
          .strict()
          .optional(),
        attachments: z
          .array(
            z
              .object({
                name: z.string().max(200),
                source: z.enum(["current", "history"]).optional(),
              })
              .strict(),
          )
          .max(8)
          .default([]),
        workspaceAccess: z.enum(["view", "edit", "full"]).default("edit"),
      })
      .strict()
      .parse(req.body);
    const row = getConnection(data.connectionId, actor, "chat");
    if (data.requestedCompanyLookup) {
      const lookup = data.requestedCompanyLookup;
      if (
        [...(lookup.directories ?? []), ...(lookup.documents ?? [])].some(
          (q) => !nas.sources(actor).some((s) => s.id === q.sourceId),
        )
      )
        fail(404, "资料源不存在或无权访问");
      return res.json({
        kind: "chat",
        mode: "standard",
        seconds: 10,
        connectionId: row.id,
        skillIds: [],
        execution: "answer",
        workspaceContext: false,
        usePreviousAttachments: false,
        companyLookup: lookup,
      });
    }
    const answerPlan = {
      kind: "chat",
      mode: "standard",
      seconds: 10,
      connectionId: row.id,
      skillIds: [],
      execution: "answer",
      workspaceContext: false,
      usePreviousAttachments: false,
    };
    if (
      isCasualMessage(
        data.messages.findLast((m) => m.role === "user")?.content ?? "",
        data.attachments.length,
      ) ||
      isModelIdentityQuestion(
        data.messages,
        data.attachments.filter((a) => a.source !== "history").length,
      )
    )
      return res.json(answerPlan);
    const candidates = checkedSkills(
      actor,
      data.skillIds,
      data.skillMode === "manual",
    );
    const controller = new AbortController();
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", disconnected);
    const timeout = AbortSignal.timeout(options.routingTimeoutMs ?? 45000);
    const fallback = (reason: string) => {
      store.audit(actor.id, "model.task_routing_fallback." + reason, row.id);
      return res.json({ ...answerPlan, routingFallback: true });
    };
    try {
      const signal = AbortSignal.any([controller.signal, timeout]);
      let structured = true;
      const request = () =>
        fetchModel(row, `${row.base_url}/chat/completions`, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${store.decrypt(row.secret)}`,
          },
          signal,
          body: JSON.stringify({
            model: row.model,
            stream: false,
            ...(structured ? { response_format: { type: "json_object" } } : {}),
            max_tokens: 4096,
            ...(String(row.model).toLowerCase().startsWith("deepseek")
              ? { thinking: { type: "disabled" } }
              : {}),
            messages: [
              { role: "system", content: AUTOMATIC_ROUTER_INSTRUCTION },
              {
                role: "user",
                content: JSON.stringify({
                  messages: data.messages.slice(-8).map((message) => ({
                    ...message,
                    content: message.content.slice(-12000),
                  })),
                  attachments: data.attachments,
                  project: data.project,
                  previousCompanyLookup: data.previousCompanyLookup,
                  companySources: nas
                    .sources(actor)
                    .map((s) => ({ id: s.id, name: s.name })),
                  skillMode: data.skillMode,
                  explicitSkillIds:
                    data.skillMode === "manual"
                      ? candidates.map((skill) => skill.id)
                      : [],
                  availablePlugins: communityPlugins.active(actor.id).map(p => ({ id: p.id, name: p.name, description: p.description })),
                  availableSkills: candidates.map((skill) => ({
                    id: skill.id,
                    name: skill.name,
                    description: skill.description.slice(0, 500),
                    ...(skill.capability?.kind === "image"
                      ? {
                          capability: {
                            kind: "image",
                            model: skill.capability.model,
                            routing: imageModelProfile(skill.capability.model),
                          },
                        }
                      : {}),
                  })),
                }),
              },
            ],
          }),
        });
      let response = await retryModelConnection(request, signal);
      if ([400, 422].includes(response.status)) {
        const detail = (await response
          .clone()
          .json()
          .catch(() => ({}))) as Row;
        if (
          detail?.error?.param === "response_format" ||
          (/response_format|json_object/i.test(
            String(detail?.error?.message),
          ) &&
            /unsupported|not support|unknown|不支持/i.test(
              String(detail?.error?.message),
            ))
        ) {
          await response.body?.cancel();
          structured = false;
          response = await request();
        }
      }
      if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        return fallback("http_" + response.status);
      }
      if (!response.ok)
        fail(
          502,
          `智能调度服务返回 ${response.status}，请检查模型配置或稍后重试`,
        );
      let plan;
      try {
        const result = await readChatResponse(response, () => {}, {
          allowEmpty: true,
          contentLimit: 16001,
        });
        plan = parseAutomaticPlan(result.content);
      } catch (error) {
        if (signal.aborted) throw error;
        // An invalid decision must never invoke tools or block an ordinary reply.
        return fallback("invalid_response");
      }
      preserveNasFilenames(
        plan,
        data.messages.findLast((m) => m.role === "user")?.content ?? "",
      );
      if (plan.kind !== "chat" && data.workspaceAccess === "view")
        fail(
          403,
          "当前工作区为仅可查看，生成图片、代码或视频前请切换到工作区内修改",
        );
      if (
        [
          ...(plan.companyLookup?.directories ?? []),
          ...(plan.companyLookup?.documents ?? []),
        ].some((q) => !nas.sources(actor).some((s) => s.id === q.sourceId))
      )
        fail(502, "智能调度选择了未授权的公司资料源，请重试");
      const catalogOnly =
        plan.kind === "chat" &&
        plan.execution === "answer" &&
        (plan.companyLookup?.skills || plan.companyLookup?.knowledge) &&
        !plan.skillIds?.length;
      const skillIds = catalogOnly
        ? []
        : data.skillMode === "manual"
          ? candidates.map((skill) => skill.id)
          : pickRoutedSkills(plan.skillIds, candidates);
      if (
        plan.execution === "answer" &&
        (plan.kind === "code" ||
          plan.kind === "video" ||
          plan.mode !== "standard" ||
          candidates.some(
            (skill) => skillIds.includes(skill.id) && skill.imported,
          ))
      )
        plan.execution = "agent";
      let connectionId = row.id;
      const pluginIds = communityPlugins.resolve(actor.id, plan.kind === "chat" ? plan.pluginIds ?? [] : []);
      if (plan.kind !== "chat") delete plan.pluginIds;
      if (pluginIds.length) { plan.execution = "agent"; plan.pluginIds = pluginIds; }
      if (plan.kind === "image" && data.imageSkills) {
        const image = chooseImageSkill(candidates, skillIds);
        if (!image)
          fail(
            409,
            "当前没有可调用的图片生成技能，请选择已授权的图片技能或切换为自动调用；管理员可在模型与服务中配置图片技能",
          );
        const selected = skillIds.filter(
          (id) =>
            id === image.id ||
            !candidates.some(
              (s) => s.id === id && s.capability?.kind === "image",
            ),
        );
        if (!selected.includes(image.id)) selected.splice(15, 1, image.id);
        store.audit(actor.id, "model.image_skill_routed", image.id);
        return res.json({
          ...plan,
          kind: "chat",
          connectionId: row.id,
          imageSkillId: image.id,
          skillIds: selected,
        });
      }
      if (plan.kind === "image") {
        const image = (
          db
            .prepare(
              connectionSelect +
                " WHERE c.enabled=1 AND c.kind='image' ORDER BY c.rowid",
            )
            .all() as Row[]
        ).find((candidate) => canUseConnection(candidate, actor));
        if (!image)
          fail(
            409,
            "已识别为图片创作，但公司尚未为你配置可用的图片服务，请联系管理员",
          );
        connectionId = image.id;
      }
      store.audit(actor.id, "model.task_routed", row.id);
      res.json({ ...plan, connectionId, skillIds });
    } catch (error) {
      if (error instanceof ApiError || error instanceof SkillUseError)
        throw error;
      if (controller.signal.aborted || res.destroyed) return;
      if (timeout.aborted) return fallback("timeout");
      const code = modelConnectionErrorCode(error);
      if (code) return fallback(code);
      if (!res.destroyed)
        fail(502, "智能调度连接失败或超时，请重试；原需求已保存在本机");
    } finally {
      res.off("close", disconnected);
    }
  });
  app.post("/api/generate/chat", async (req, res) => {
    const actor = getActor(req);
    const data = z
      .object({
        connectionId: id,
        skillId: id.optional(),
        imageSkillId: id.optional(),
        deviceId: id.optional(),
        skillIds: skillIdsSchema,
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
        mode: z
          .enum(["standard", "ptc", "minimal", "creative"])
          .default("standard"),
        workspaceAccess: z.enum(["view", "edit", "full"]).default("edit"),
        execution: z.enum(["answer", "agent"]).default("agent"),
        pluginIds: z.array(z.string().max(80)).max(8).default([]),
        companyLookup: companyLookupSchema.optional(),
        installedSkillIds: z.array(id).max(128).default([]),
      })
      .strict()
      .parse(req.body);
    const row = getConnection(data.connectionId, actor, "chat");
    if (
      [
        ...(data.companyLookup?.directories ?? []),
        ...(data.companyLookup?.documents ?? []),
      ].some((q) => !nas.sources(actor).some((s) => s.id === q.sourceId))
    )
      fail(404, "资料源不存在或无权访问");
    if (
      data.companyLookup?.edit &&
      (!data.deviceId || data.workspaceAccess === "view")
    )
      fail(400, "生成修改稿请使用桌面客户端，并选择可保存成果的项目。");
    const casual =
      isCasualMessage(
        data.messages.findLast((m) => m.role === "user")?.content ?? "",
        data.attachments.length,
      ) &&
      !data.messages.some((m) => m.role === "system") &&
      !data.skillId &&
      !data.skillIds.length &&
      !data.pluginIds.length &&
      !data.imageSkillId &&
      !data.companyLookup;
    const modelIdentity =
      isModelIdentityQuestion(data.messages, data.attachments.length) &&
      !data.messages.some((m) => m.role === "system") &&
      !data.skillId &&
      !data.skillIds.length &&
      !data.pluginIds.length &&
      !data.imageSkillId &&
      !data.companyLookup;
    try {
      validateAttachmentBudget(data.attachments);
    } catch (error) {
      fail(413, (error as Error).message);
    }
    const visuals = data.attachments.flatMap(visualInputs);
    if (visuals.length && unsupportedDeepSeekVision(row.base_url, row.model))
      fail(
        400,
        "当前 DeepSeek 模型不支持图像输入。请切换 DeepSeek Flash 后分析图片、PDF 页面或视频画面。",
      );
    if (data.attachments.length)
      data.messages.unshift({
        role: "system",
        content: ATTACHMENT_CONTEXT_RULE,
      });
    const selectedSkills = checkedSkills(actor, [
      ...data.skillIds,
      ...(data.skillId ? [data.skillId] : []),
    ]);
    const imageSkill = data.imageSkillId
      ? selectedSkills.find(
          (skill) =>
            skill.id === data.imageSkillId &&
            skill.capability?.kind === "image",
        )
      : undefined;
    if (data.imageSkillId && !imageSkill)
      fail(403, "图片技能未选择、已停用或无权使用，请重新选择");
    if (imageSkill && data.workspaceAccess === "view")
      fail(403, "当前工作区为仅可查看，不能调用图片生成技能");
    if (imageSkill)
      data.messages.unshift({
        role: "system",
        content:
          "本轮已安排公司图片生成技能。请完成用户要求的完整文字部分；图片调用将在文字输出后由服务执行并附于同一回复。当前尚未生成成功，不要宣称图片已完成，不要编造图片链接或占位图。",
      });
    const skillResources = await resourcesFor(selectedSkills);
    const pluginIds = communityPlugins.resolve(actor.id, data.pluginIds);
    const answerOnly =
      casual ||
      modelIdentity ||
      ((data.companyLookup?.knowledge === "read" || data.execution === "answer") && !skillResources.length && !pluginIds.length);
    if (pluginIds.length) data.messages.unshift({ role: "system", content: "本轮可按需使用已安装的公司大脑开源社区插件：" + communityPlugins.active(actor.id).filter(p => pluginIds.includes(p.id)).map(p => p.name).join("、") + "。根据用户问题调用实际工具；未执行时不要声称已经执行。" });
    if (selectedSkills.length) {
      data.messages.unshift({
        role: "system",
        content: skillInstructions(selectedSkills),
      });
    }
    const streaming = req.get("accept")?.includes("application/x-ndjson");
    const controller = new AbortController();
    const deadline = createChatDeadline({
      ...options.chatTimeouts,
      parent: controller.signal,
    });
    const { signal } = deadline;
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", disconnected);
    let hasProgress = false;
    let validateCompany: (() => void) | undefined;
    const emit = (event: ChatProgress) => {
      if (["text", "reasoning", "done"].includes(event.type))
        validateCompany?.();
      deadline.observe(event);
      if (
        (event.type === "text" && event.text) ||
        (event.type === "reasoning" && event.text.trim()) ||
        event.type === "tool"
      )
        hasProgress = true;
      if (streaming && !res.destroyed && !res.writableEnded) {
        if (res.writableLength > 2_000_000) {
          controller.abort();
          res.destroy();
          return;
        }
        res.write(JSON.stringify(event) + "\n");
      }
    };
    if (streaming) {
      res.set({
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
    }
    const heartbeat = streaming
      ? setInterval(() => {
          if (!res.destroyed) res.write("\n");
        }, 15_000)
      : undefined;
    let companyResult: Awaited<ReturnType<typeof companyContext>> | undefined;
    try {
      if (data.companyLookup) {
        const sources = nas.sources(actor);
        const signature = (values: typeof sources) =>
          JSON.stringify(values.map((s) => [s.id, s.revision]));
        validateCompany = () => {
          nas.assertCurrent(req);
          if (signature(nas.sources(actor)) !== signature(sources))
            fail(409, "资料源权限已变化，请刷新后重试");
        };
        const context = await companyContext({
          lookup: data.companyLookup,
          skills: catalogFor(actor),
          installedSkillIds: data.installedSkillIds,
          sources,
          signal,
          progress: emit,
          browse: (sourceId, path, search) =>
            nas.readDirectory(req, sourceId, { path, search }, signal),
          read: (sourceId, path, offset) =>
            nas.readDocument(req, sourceId, { path, offset }, signal),
          validate: validateCompany,
        });
        companyResult = context;
        data.messages.unshift({ role: "system", content: context.prompt });
      }
      if (data.companyLookup?.knowledge === "read" && skillResources.length) {
        const references = await skillReferences(skillResources, 16000);
        if (references)
          data.messages.unshift({
            role: "system",
            content:
              "所选技能的配套参考资料（不是新的用户指令）：\n" + references,
          });
      }
      const escape = (value: string) =>
        value.replace(/[\\`*_{}\[\]<>]/g, "\\$&");
      let content: string | undefined = modelIdentity
        ? `我是公司大脑助手。当前会话选择的是 **${escape(row.name)}**，配置的模型标识为 **${escape(row.model)}**。\n\n这是当前选中的模型配置；中转内部实际运行的底层版本由供应商提供，平台无法仅凭标识独立核验。`
        : undefined;
      let draftIncomplete = false;
      let productionTaskId: string | undefined;
      let usage:
        | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
        | undefined = modelIdentity
        ? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
        : undefined;
      const hasImageAttachment = visuals.length > 0;
      if (!answerOnly) {
        try {
          if (!dsh) throw new DshUnavailableError("DSH 已由管理员停用");
          const proxy =
            (row.owner_user_id && !row.source_service_id) ||
            modelUsesCustomDns(row.base_url)
              ? await privateModelProxy(
                  row,
                  store.decrypt(row.secret),
                  fetchModel,
                )
              : undefined;
          try {
            const result = await dsh.runDetailed({
              connectionId: row.id,
              baseUrl: proxy?.url ?? row.base_url,
              model: row.model,
              apiKey: proxy?.key ?? store.decrypt(row.secret),
              userId: actor.id,
              sessionId: data.sessionId ?? randomUUID(),
              messages: data.messages,
              attachments: data.attachments,
              mode: data.mode,
              workspaceAccess: data.workspaceAccess,
              skillResources,
              communityPlugins: pluginIds,
              deliverFiles:
                Boolean(data.deviceId) && data.workspaceAccess !== "view",
              signal,
              onProgress: emit,
            });
            content = result.content;
            usage = result.usage;
            if (result.output && data.deviceId) {
              if (data.workspaceAccess === "view")
                fail(403, "当前工作区为仅可查看，不能交付新成果");
              const task = await production.acceptFiles(
                actor.id,
                row.id,
                data.deviceId,
                result.output,
              );
              productionTaskId = task.id;
            }
          } finally {
            await proxy?.close();
          }
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof ApiError || error instanceof ProductionError)
            throw error;
          if (error instanceof DshLoopError) fail(502, error.message);
          // Visual requests can be accepted by the OpenAI-compatible provider even
          // when a DSH preset rejects the image block. Retry those requests through
          // the direct chat endpoint so an uploaded image is still sent to the model.
          if (
            hasProgress ||
            (!(error instanceof DshUnavailableError) && !hasImageAttachment)
          )
            fail(502, "模型处理未完成，已保留收到的内容，请稍后重试");
        }
      }
      if (typeof content !== "string") {
        if (pluginIds.length) fail(503, "已选择的社区插件需要工具运行服务，请稍后重试；本次未执行插件。");
        if (skillResources.length && data.companyLookup?.knowledge !== "read")
          fail(503, "此技能需要文件工具读取配套资料，DSH 暂不可用，请稍后重试");
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
              ...visuals.flatMap((item) => [
                { type: "text", text: `附件画面：${item.label}` },
                { type: "image_url", image_url: { url: item.image } },
              ]),
            ],
          };
        });
        const providerResponse = await retryModelConnection(
          () =>
            fetchModel(row, `${row.base_url}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${store.decrypt(row.secret)}`,
              },
              body: JSON.stringify({
                model: row.model,
                messages: casual
                  ? [
                      { role: "system", content: CASUAL_REPLY_INSTRUCTION },
                      directMessages[lastUserIndex],
                    ]
                  : answerOnly
                    ? [
                        { role: "system", content: ANSWER_INSTRUCTION },
                        ...directMessages,
                      ]
                    : directMessages,
                ...(casual &&
                String(row.model).toLowerCase().startsWith("deepseek")
                  ? { thinking: { type: "disabled" } }
                  : {}),
                stream: Boolean(streaming),
              }),
              signal,
              redirect: "error",
            }),
          signal,
        );
        if (!providerResponse.ok)
          fail(
            502,
            `模型服务返回 ${providerResponse.status}，请检查模型标识、余额和权限`,
          );
        const result = await readChatResponse(providerResponse, emit);
        content = result.content;
        usage = result.usage;
        draftIncomplete =
          result.finishReason === "length" || result.content.length >= 160000;
        if (typeof content !== "string" || !content.trim())
          fail(502, "模型未返回可显示的文本");
      }
      let image: string | undefined;
      if (imageSkill) {
        const toolId = "image-skill-" + imageSkill.id;
        emit({
          type: "tool",
          id: toolId,
          name: imageSkill.name,
          status: "running",
        });
        try {
          const current = userById(actor.id);
          if (!current?.enabled || !current.department_enabled)
            fail(403, "账号或部门已停用，无法继续生成图片");
          const fresh = userView(current);
          if (
            !imageSkills(store, fresh).some(
              (skill) => skill.id === imageSkill.id,
            )
          )
            fail(403, "图片技能已停用或授权发生变更，请重新选择");
          const imageRow = getConnection(
            imageSkill.capability!.connectionId,
            fresh,
            "image",
          );
          signal.throwIfAborted();
          const prompt = [
            "根据本轮用户需求生成一张配图，文字回复仅作为背景参考，不要截图或复述整篇回复。",
            data.messages.findLast((message) => message.role === "user")
              ?.content ?? "",
            "配套文字：",
            content,
          ]
            .join("\n\n")
            .slice(0, 12000);
          // Image APIs can stay silent until the completed image. The employee's
          // cancellation/disconnect signal still owns this stage.
          deadline.dispose();
          const result = await invoke(
            imageRow,
            "/images/generations",
            {
              model: imageRow.model,
              prompt,
              n: 1,
              ...imageRequestOptions(imageRow.model),
            },
            signal,
          );
          try {
            image = generatedImage(result);
          } catch (error) {
            fail(502, (error as Error).message);
          }
          store.audit(actor.id, "model.image_skill_completed", imageRow.id);
          emit({
            type: "tool",
            id: toolId,
            name: imageSkill.name,
            status: "done",
          });
        } catch (error) {
          emit({
            type: "tool",
            id: toolId,
            name: imageSkill.name,
            status: signal.aborted ? "stopped" : "error",
          });
          throw error;
        }
      }
      if (
        data.companyLookup?.edit &&
        companyResult?.documents.some((d) => d.readable) &&
        !productionTaskId
      ) {
        signal.throwIfAborted();
        validateCompany?.();
        const id = randomUUID();
        emit({
          type: "tool",
          id,
          name: "生成本机文档修改稿",
          status: "running",
        });
        const documents = companyResult.documents;
        const partial =
          draftIncomplete ||
          documents.some(
            (d) =>
              d.offset > 0 ||
              d.nextOffset !== null ||
              d.warnings.some((w) =>
                /未读取|未提取|没有可提取|仅解析前/.test(w),
              ),
          );
        const note = documents
          .map(
            (d) =>
              `${d.source}/${d.path}\n源文件 SHA-256：${d.sha256}\n读取字符范围：${d.offset + 1}–${d.offset + d.content.length} / 已解析 ${d.totalCharacters} 字符\n${d.warnings.join("\n")}`,
          )
          .join("\n\n");
        const task = await production.acceptDocumentDraft(
          actor.id,
          row.id,
          data.deviceId!,
          content,
          note,
          partial,
          validateCompany,
        );
        if (signal.aborted) {
          await production.cancel(actor.id, task.id);
          signal.throwIfAborted();
        }
        validateCompany?.();
        productionTaskId = task.id;
        emit({ type: "tool", id, name: "生成本机文档修改稿", status: "done" });
      }
      store.audit(actor.id, "model.chat_completed", row.id);
      if (streaming) {
        emit({
          type: "done",
          content,
          usage,
          ...(image ? { image } : {}),
          ...(productionTaskId ? { productionTaskId } : {}),
          ...(companyResult ? { companyLookup: companyResult.lookup } : {}),
        });
        res.end();
      } else
        res.json({
          content,
          usage,
          ...(image ? { image } : {}),
          ...(productionTaskId ? { productionTaskId } : {}),
          ...(companyResult ? { companyLookup: companyResult.lookup } : {}),
        });
    } catch (error) {
      const timeout =
        signal.aborted && signal.reason instanceof ChatTimeoutError
          ? signal.reason
          : undefined;
      if (!streaming && timeout) fail(504, timeout.message);
      if (!streaming) throw error;
      emit({
        type: "error",
        message: timeout
          ? timeout.message
          : signal.aborted
            ? "请求已停止，已保留收到的内容"
            : error instanceof ApiError || error instanceof ProductionError
              ? error.message
              : "模型响应中断，已保留收到的内容，请稍后重试",
      });
      res.end();
    } finally {
      deadline.dispose();
      if (heartbeat) clearInterval(heartbeat);
      res.off("close", disconnected);
    }
  });
  app.post("/api/generate/image", async (req, res) => {
    const actor = getActor(req);
    const data = z
      .object({
        connectionId: id,
        prompt: z.string().min(1).max(12000),
        skillIds: skillIdsSchema,
      })
      .strict()
      .parse(req.body);
    const row = getConnection(data.connectionId, actor, "image");
    const context = await modelSkillContext(
      actor,
      data.skillIds,
      data.skillIds.length
        ? 11998 - data.prompt.length
        : 12000 - data.prompt.length,
    );
    const controller = new AbortController();
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", disconnected);
    try {
      const result = await invoke(
        row,
        "/images/generations",
        {
          model: row.model,
          prompt: data.prompt + (context ? "\n\n" + context : ""),
          n: 1,
          ...imageRequestOptions(row.model),
        },
        controller.signal,
      );
      const item = result.data?.[0];
      if (!item?.b64_json)
        fail(502, "当前连接需返回 b64_json 图片，暂不接收远程图片链接");
      store.audit(actor.id, "model.image_completed", row.id);
      res.json({ image: `data:image/png;base64,${item.b64_json}` });
    } finally {
      res.off("close", disconnected);
    }
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
      if (error instanceof ProductionError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof SkillImportError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof SkillUseError)
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
  return { app, store, library, production };
}
