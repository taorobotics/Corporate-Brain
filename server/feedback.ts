import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "./database";
import type { User } from "../shared/types";

// Mounted after the platform's session, password-change and origin checks.
export function mountFeedback(
  app: Express,
  store: Store,
  actorOf: (req: Request) => User,
  fail: (status: number, message: string) => never,
) {
  const { db } = store;
  const uuid = z.string().uuid();
  const schema = z
    .object({
      conversationId: uuid,
      messageId: uuid,
      connectionId: uuid.nullable().default(null),
      rating: z.enum(["helpful", "unhelpful", "issue"]),
      category: z
        .enum(["accuracy", "incomplete", "relevance", "format", "other"])
        .default("other"),
      description: z.string().trim().max(2000).default(""),
      includeContext: z.boolean().default(false),
      context: z
        .object({
          question: z.string().max(20000),
          answer: z.string().max(50000),
        })
        .strict()
        .optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.includeContext !== !!value.context)
        ctx.addIssue({ code: "custom", message: "请明确选择是否附上当前问答" });
    });
  const admin = (req: Request) => {
    const actor = actorOf(req);
    if (actor.role !== "company_admin") fail(403, "需要公司管理员权限");
    return actor;
  };
  const receipt = (row: any) => ({
    id: row.id,
    rating: row.rating,
    category: row.category,
    description: row.description,
    hasContext:
      row.has_context !== undefined
        ? !!row.has_context
        : row.context_json !== null,
  });
  const view = (row: any) => ({
    ...receipt(row),
    userName: row.user_name,
    username: row.username,
    departmentName: row.department_name,
    modelName: row.model_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  const attempts = new Map<string, { count: number; until: number }>();
  app.put("/api/feedback", (req, res) => {
    const actor = actorOf(req),
      data = schema.parse(req.body),
      now = Date.now();
    for (const [key, value] of attempts)
      if (value.until <= now) attempts.delete(key);
    const budget = attempts.get(actor.id) ?? { count: 0, until: now + 60000 };
    attempts.set(actor.id, budget);
    if (++budget.count > 30) fail(429, "反馈提交频繁，请稍后重试");
    const existing = db
      .prepare(
        "SELECT * FROM feedback WHERE user_id=? AND conversation_id=? AND message_id=?",
      )
      .get(actor.id, data.conversationId, data.messageId) as any;
    const context = data.includeContext ? JSON.stringify(data.context) : null;
    if (
      existing &&
      existing.rating === data.rating &&
      existing.category === data.category &&
      existing.description === data.description &&
      existing.context_json === context
    ) {
      res.json(receipt(existing));
      return;
    }
    let modelName = existing?.model_name ?? "历史回答（未记录模型）";
    if (data.connectionId) {
      const connection = db
        .prepare("SELECT name,departments FROM connections WHERE id=?")
        .get(data.connectionId) as any;
      if (
        connection &&
        (actor.role === "company_admin" ||
          JSON.parse(connection.departments).includes(actor.departmentId))
      )
        modelName = connection.name;
    }
    const timestamp = new Date(
      Math.max(now, existing ? Date.parse(existing.updated_at) + 1 : 0),
    ).toISOString();
    const feedbackId = existing?.id ?? randomUUID();
    if (!existing) {
      const count = db
        .prepare(
          "SELECT COUNT(*) AS total FROM feedback WHERE user_id=? AND created_at>=?",
        )
        .get(actor.id, new Date(now - 86400000).toISOString()) as {
        total: number;
      };
      if (count.total >= 100) fail(429, "今日反馈已达上限，请明天再试");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `INSERT INTO feedback(id,user_id,user_name,username,department_name,conversation_id,message_id,model_name,rating,category,description,context_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,conversation_id,message_id) DO UPDATE SET
        rating=excluded.rating,category=excluded.category,description=excluded.description,context_json=excluded.context_json,
        updated_at=excluded.updated_at,status='pending',admin_note='',handled_by='',handled_at=NULL`,
      ).run(
        feedbackId,
        actor.id,
        actor.name,
        actor.username,
        actor.departmentName,
        data.conversationId,
        data.messageId,
        modelName,
        data.rating,
        data.category,
        data.description,
        context,
        timestamp,
        timestamp,
      );
      store.audit(
        actor.id,
        existing ? "feedback.updated" : "feedback.submitted",
        feedbackId,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res
      .status(existing ? 200 : 201)
      .json(
        receipt(
          db.prepare("SELECT * FROM feedback WHERE id=?").get(feedbackId),
        ),
      );
  });
  app.get("/api/admin/feedback", (req, res) => {
    admin(req);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        status: z
          .enum(["pending", "processing", "resolved", "dismissed"])
          .optional(),
        rating: z.enum(["helpful", "unhelpful", "issue"]).optional(),
        search: z.string().trim().max(100).default(""),
      })
      .strict()
      .parse(req.query);
    const clauses: string[] = [],
      values: string[] = [];
    if (query.status) {
      clauses.push("status=?");
      values.push(query.status);
    }
    if (query.rating) {
      clauses.push("rating=?");
      values.push(query.rating);
    }
    if (query.search) {
      clauses.push(
        "instr(lower(user_name||' '||username||' '||department_name||' '||model_name||' '||description),lower(?))>0",
      );
      values.push(query.search);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM feedback ${where}`)
      .get(...values) as { total: number };
    const pageSize = 20,
      page = Math.min(query.page, Math.max(1, Math.ceil(total / pageSize)));
    const rows = db
      .prepare(
        `SELECT id,rating,category,description,user_name,username,department_name,model_name,status,created_at,updated_at,context_json IS NOT NULL AS has_context FROM feedback ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, pageSize, (page - 1) * pageSize);
    res.json({ rows: rows.map(view), total, page, pageSize });
  });
  app.get("/api/admin/feedback/:id", (req, res) => {
    admin(req);
    const row = db
      .prepare("SELECT * FROM feedback WHERE id=?")
      .get(uuid.parse(req.params.id)) as any;
    if (!row) fail(404, "反馈不存在");
    res.json({
      ...view(row),
      context: row.context_json ? JSON.parse(row.context_json) : null,
      adminNote: row.admin_note,
      handledBy: row.handled_by,
      handledAt: row.handled_at,
    });
  });
  app.patch("/api/admin/feedback/:id", (req, res) => {
    const actor = admin(req),
      feedbackId = uuid.parse(req.params.id);
    const data = z
      .object({
        status: z.enum(["pending", "processing", "resolved", "dismissed"]),
        adminNote: z.string().trim().max(2000),
        updatedAt: z.string().datetime(),
      })
      .strict()
      .parse(req.body);
    const row = db
      .prepare("SELECT * FROM feedback WHERE id=?")
      .get(feedbackId) as any;
    if (!row) fail(404, "反馈不存在");
    if (row.updated_at !== data.updatedAt)
      fail(409, "反馈已被更新，请重新打开后处理");
    const now = new Date(
      Math.max(Date.now(), Date.parse(row.updated_at) + 1),
    ).toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE feedback SET status=?,admin_note=?,handled_by=?,handled_at=?,updated_at=? WHERE id=?",
      ).run(data.status, data.adminNote, actor.name, now, now, feedbackId);
      store.audit(actor.id, `feedback.${data.status}`, feedbackId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json({ ok: true });
  });
}
