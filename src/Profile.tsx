import { useEffect, useRef, useState } from "react";
import {
  UserCircle,
  UploadSimple,
  PencilSimple,
  Shuffle,
  Check,
} from "@phosphor-icons/react";
import type { User } from "../shared/types";
import { roleNames } from "../shared/types";
import { AVATAR_PRESETS, avatarSource, defaultAvatar } from "../shared/avatars";
import { Button, Modal } from "./components";
import { api } from "./api";
import "./profile.css";

export function Avatar({
  user,
  size = 36,
}: {
  user: Pick<User, "id" | "name" | "avatar">;
  size?: number;
}) {
  const src = avatarSource(user.avatar, user.id);
  const [failed, setFailed] = useState("");
  return (
    <span className="profile-avatar" style={{ width: size, height: size }}>
      {failed === src ? (
        <UserCircle size={size} aria-label={`${user.name}的头像`} />
      ) : (
        <img
          src={src}
          alt={`${user.name}的头像`}
          width={size}
          height={size}
          onError={() => setFailed(src)}
        />
      )}
    </span>
  );
}

export default function Profile({
  user,
  onSaved,
  openPassword,
  notify,
}: {
  user: User;
  onSaved: (user: User) => void;
  openPassword: () => void;
  notify: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false),
    [loginBusy, setLoginBusy] = useState(false),
    [loginError, setLoginError] = useState("");
  return (
    <>
      <div className="profile-heading">
        <button
          className="profile-edit-avatar"
          aria-label="编辑头像和名称"
          onClick={() => setEditing(true)}
        >
          <Avatar user={user} size={64} />
          <span>
            <PencilSimple size={14} />
          </span>
        </button>
        <div>
          <strong>{user.name}</strong>
          <small>
            {user.departmentName} · {roleNames[user.role]}
          </small>
          <small>登录账号：{user.username}</small>
        </div>
        <div className="inline-actions">
          <Button onClick={() => setEditing(true)}>编辑个人资料</Button>
          <Button
            onClick={() => {
              setLoginError("");
              setLoginOpen(true);
            }}
          >
            修改登录账号
          </Button>
          <Button onClick={openPassword}>修改密码</Button>
        </div>
      </div>
      {loginOpen && (
        <Modal
          title="修改登录账号"
          close={() => {
            if (!loginBusy) setLoginOpen(false);
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (loginBusy) return;
              const form = event.currentTarget,
                data = new FormData(form);
              setLoginBusy(true);
              setLoginError("");
              try {
                const next = await api<User>("/auth/username", {
                  username: data.get("loginUsername"),
                  currentPassword: data.get("currentPassword"),
                });
                form.reset();
                onSaved(next);
                setLoginOpen(false);
                notify(
                  "登录账号已修改，其他设备需使用新账号重新登录。对话记录和部门权限保留。",
                );
              } catch (error) {
                setLoginError((error as Error).message);
              } finally {
                setLoginBusy(false);
              }
            }}
          >
            <p className="muted">
              新的登录账号需全公司唯一。修改后当前设备保持登录，其他设备须重新登录。
            </p>
            <label>
              新登录账号
              <input
                name="loginUsername"
                defaultValue={user.username}
                minLength={2}
                maxLength={64}
                pattern="[a-zA-Z0-9_.@\-]{2,64}"
                autoComplete="username"
                required
              />
            </label>
            <p className="muted">使用 2–64 位字母、数字或 . _ @ -。</p>
            <label>
              当前密码
              <input
                name="currentPassword"
                type="password"
                maxLength={128}
                autoComplete="current-password"
                required
              />
            </label>
            {loginError && (
              <p className="error" role="alert">
                {loginError}
              </p>
            )}
            <footer>
              <Button disabled={loginBusy} onClick={() => setLoginOpen(false)}>
                取消
              </Button>
              <Button primary type="submit" disabled={loginBusy}>
                保存登录账号
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {editing && (
        <ProfileEditor
          user={user}
          close={() => setEditing(false)}
          saved={(next) => {
            onSaved(next);
            setEditing(false);
            notify("头像和名称已保存，其他设备下次登录也会使用这份资料。");
          }}
        />
      )}
    </>
  );
}

function ProfileEditor({
  user,
  close,
  saved,
}: {
  user: User;
  close: () => void;
  saved: (user: User) => void;
}) {
  const [name, setName] = useState(user.name),
    [avatar, setAvatar] = useState(user.avatar || defaultAvatar(user.id));
  const [query, setQuery] = useState(""),
    [saving, setSaving] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [cropSource, setCropSource] = useState(""),
    [cropReady, setCropReady] = useState(false);
  const [zoom, setZoom] = useState(1),
    [x, setX] = useState(0),
    [y, setY] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    image = useRef<HTMLImageElement | null>(null);
  const busy = useRef(false),
    request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    setCropReady(false);
    image.current = null;
    if (!cropSource) return;
    const img = new Image();
    let active = true;
    img.onload = () => {
      if (active) {
        image.current = img;
        setCropReady(true);
      }
    };
    img.onerror = () => {
      if (active) {
        setError("无法读取头像，请重新选择图片。");
        setCropSource("");
      }
    };
    img.src = cropSource;
    return () => {
      active = false;
    };
  }, [cropSource]);
  useEffect(() => {
    const img = image.current,
      target = canvas.current;
    if (!cropReady || !img || !target) return;
    const ctx = target.getContext("2d")!;
    const scale = Math.max(256 / img.width, 256 / img.height) * zoom;
    const w = img.width * scale,
      h = img.height * scale;
    ctx.clearRect(0, 0, 256, 256);
    ctx.drawImage(
      img,
      (256 - w) / 2 + (x * (w - 256)) / 2,
      (256 - h) / 2 + (y * (h - 256)) / 2,
      w,
      h,
    );
  }, [cropReady, zoom, x, y]);
  function editCrop(source: string) {
    setZoom(1);
    setX(0);
    setY(0);
    setError("");
    setCropSource(source);
  }
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    const task = ++request.current;
    setLoading(true);
    try {
      if (
        !/\.(png|jpe?g|webp)$/i.test(file.name) ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw Error("请选择 PNG、JPG 或 WebP 静态图片。");
      if (!file.size || file.size > 10 * 1024 * 1024)
        throw Error("图片需小于 10MB。");
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 40_000_000)
          throw Error("图片像素过大，请缩小后上传。");
        if (request.current !== task) return;
        const target = document.createElement("canvas"),
          scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        target.width = Math.max(1, Math.round(bitmap.width * scale));
        target.height = Math.max(1, Math.round(bitmap.height * scale));
        target
          .getContext("2d")!
          .drawImage(bitmap, 0, 0, target.width, target.height);
        editCrop(target.toDataURL("image/png"));
      } finally {
        bitmap.close();
      }
    } catch (e) {
      if (request.current === task)
        setError((e as Error).message || "图片读取失败");
    } finally {
      if (request.current === task) setLoading(false);
    }
  }
  async function submit() {
    if (busy.current || loading || cropSource) return;
    if (!name.trim()) {
      setError("名称不能为空。");
      return;
    }
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      saved(
        await api<User>(
          "/auth/profile",
          { name: name.trim(), avatar },
          "PATCH",
          20000,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  const displayed = AVATAR_PRESETS.filter((item) =>
    `${item.name} ${item.originalName}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <Modal
      title="编辑个人资料"
      wide
      close={() => {
        if (!busy.current) close();
      }}
    >
      <form
        className="profile-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="profile-editor-top">
          <Avatar user={{ ...user, avatar }} size={80} />
          <label className="profile-name">
            显示名称
            <input
              name="displayName"
              value={name}
              maxLength={100}
              required
              autoComplete="nickname"
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
            />
            <small>登录账号：{user.username} · 修改名称不影响登录</small>
          </label>
        </div>
        {cropSource ? (
          <section className="avatar-crop" aria-label="裁剪头像">
            <div className="avatar-crop-preview">
              <canvas
                ref={canvas}
                width={256}
                height={256}
                aria-label="头像裁剪预览"
              />
            </div>
            <div className="avatar-crop-controls">
              <strong>调整头像</strong>
              <small>预览区域就是头像显示范围</small>
              <label>
                放大
                <input
                  aria-label="头像放大"
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
              </label>
              <label>
                左右位置
                <input
                  aria-label="头像左右位置"
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={x}
                  onChange={(e) => setX(Number(e.target.value))}
                />
              </label>
              <label>
                上下位置
                <input
                  aria-label="头像上下位置"
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={y}
                  onChange={(e) => setY(Number(e.target.value))}
                />
              </label>
              <div className="inline-actions">
                <Button onClick={() => setCropSource("")}>取消裁剪</Button>
                <Button
                  primary
                  disabled={!cropReady}
                  onClick={() => {
                    setAvatar(canvas.current!.toDataURL("image/webp", 0.88));
                    setCropSource("");
                  }}
                >
                  使用此裁剪
                </Button>
              </div>
            </div>
          </section>
        ) : (
          <>
            <div className="avatar-library-heading">
              <div>
                <strong>IPAS 头像库</strong>
                <small>100 个不同角色，选一个今天的你</small>
              </div>
              <Button
                disabled={saving || loading}
                onClick={() => {
                  const others = AVATAR_PRESETS.filter(
                    (item) => item.id !== avatar,
                  );
                  setAvatar(
                    others[
                      crypto.getRandomValues(new Uint32Array(1))[0] %
                        others.length
                    ].id,
                  );
                }}
              >
                <Shuffle size={16} />
                随机一个
              </Button>
            </div>
            <input
              className="avatar-search"
              aria-label="搜索头像"
              placeholder="搜索角色，如：猫、狗、水獭"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="avatar-grid" role="group" aria-label="选择默认头像">
              {displayed.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`avatar-option ${avatar === item.id ? "selected" : ""}`}
                  aria-label={item.name}
                  aria-pressed={avatar === item.id}
                  disabled={saving || loading}
                  onClick={() => setAvatar(item.id)}
                >
                  <img
                    src={item.src}
                    alt=""
                    loading="lazy"
                    width={80}
                    height={80}
                  />
                  {avatar === item.id && (
                    <Check className="avatar-check" size={16} weight="bold" />
                  )}
                  <span>{item.name}</span>
                </button>
              ))}
              {!displayed.length && (
                <p className="muted">没有匹配的头像，试试其他关键词。</p>
              )}
            </div>
            <div className="avatar-upload-row">
              <Button
                disabled={saving || loading}
                onClick={() => input.current?.click()}
              >
                <UploadSimple size={17} />
                {loading ? "正在读取…" : "上传自己的图片"}
              </Button>
              <Button
                disabled={saving || loading}
                onClick={() => editCrop(avatarSource(avatar, user.id))}
              >
                调整裁剪
              </Button>
              <small>PNG、JPG、WebP · 最大 10MB</small>
            </div>
          </>
        )}
        <input
          ref={input}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          aria-label="上传头像文件"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {error && (
          <p className="profile-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <small>资料保存在公司服务器，随账号使用</small>
          <Button disabled={saving} onClick={close}>
            取消
          </Button>
          <Button
            primary
            type="submit"
            disabled={saving || loading || !!cropSource || !name.trim()}
          >
            {saving ? "正在保存…" : "保存资料"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
