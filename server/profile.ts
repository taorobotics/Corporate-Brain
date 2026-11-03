import type { Express, Request } from "express";
import sharp from "sharp";
import { z } from "zod";
import type { User } from "../shared/types";
import { isAvatarPreset } from "../shared/avatars";
import { tokenHash, type Store } from "./database";

export async function normalizeAvatar(value: string): Promise<string> {
  if (isAvatarPreset(value)) return value;
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4)
    throw new Error("请选择 PNG、JPG 或 WebP 图片");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 512 * 1024)
    throw new Error("头像图片过大，请重新裁剪后上传");
  const input = sharp(buffer, {
    limitInputPixels: 4_000_000,
    failOn: "warning",
  });
  const metadata = await input.metadata();
  if (metadata.format !== match[1] || (metadata.pages ?? 1) !== 1)
    throw new Error("请选择有效的静态图片");
  // Decode and re-encode: never retain uploaded metadata, executable content or remote URLs.
  const output = await input
    .rotate()
    .resize(256, 256, { fit: "cover" })
    .webp({ quality: 85 })
    .timeout({ seconds: 5 })
    .toBuffer();
  return `data:image/webp;base64,${output.toString("base64")}`;
}

export function mountProfile(
  app: Express,
  store: Store,
  getActor: (req: Request) => User,
  fail: (status: number, message: string) => never,
  userView: (id: string) => User,
) {
  const attempts = new Map<string, { count: number; expires: number }>();
  const active = new Set<string>();
  app.patch("/api/auth/profile", async (req, res) => {
    const actor = getActor(req);
    const data = z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .refine((s) => !/[\u0000-\u001f\u007f]/.test(s))
          .optional(),
        avatar: z.string().min(1).max(710_000).optional(),
      })
      .strict()
      .refine((value) => value.name !== undefined || value.avatar !== undefined)
      .parse(req.body);
    const now = Date.now();
    for (const [key, item] of attempts)
      if (item.expires < now) attempts.delete(key);
    const rate = attempts.get(actor.id) ?? { count: 0, expires: now + 60_000 };
    if (++rate.count > 20) fail(429, "修改过于频繁，请稍后重试");
    attempts.set(actor.id, rate);
    if (active.has(actor.id) || active.size >= 2)
      fail(429, "正在保存头像，请稍后重试");
    active.add(actor.id);
    try {
      let avatar: string | undefined;
      if (data.avatar !== undefined) {
        try {
          avatar = await normalizeAvatar(data.avatar);
        } catch {
          fail(
            400,
            "头像无效，请选择头像库中的图片，或重新上传 PNG、JPG、WebP 静态图片",
          );
        }
      }
      // Image decoding is asynchronous: check login/disabled state again before writing.
      const valid = store.db
        .prepare(
          "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN departments d ON d.id=u.department_id WHERE s.token_hash=? AND u.id=? AND s.auth_version=u.auth_version AND u.enabled=1 AND u.must_change=0 AND d.enabled=1 AND s.expires_at>?",
        )
        .get(tokenHash(req.cookies.brain_session), actor.id, Date.now());
      if (!valid) fail(401, "登录或权限已变更，请重新登录");
      store.db
        .prepare(
          "UPDATE users SET name=COALESCE(?,name),avatar=COALESCE(?,avatar) WHERE id=?",
        )
        .run(data.name ?? null, avatar ?? null, actor.id);
      store.audit(actor.id, "account.profile_updated", actor.id);
      res.json(userView(actor.id));
    } finally {
      active.delete(actor.id);
    }
  });
}
