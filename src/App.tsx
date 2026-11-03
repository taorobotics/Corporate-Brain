import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  SidebarSimple,
  X,
  MagnifyingGlass,
  NotePencil,
  Folder,
  BookOpen,
  Sparkle,
  Images,
  GearSix,
  CaretDown,
  SignOut,
  UserCircle,
  ShieldCheck,
  Question,
  CheckCircle,
  DownloadSimple,
  Plug,
  ArrowUUpLeft,
  ArrowUUpRight,
  Scissors,
  Copy,
  ClipboardText,
  SelectionAll,
} from "@phosphor-icons/react";
import { ActionMenu } from "./Dropdown";
import type {
  User,
  LocalState,
  Department,
  Skill,
  Connection,
} from "../shared/types";
import { api, download } from "./api";
import { emptyState, readLocal, writeLocal, validateImport } from "./local";
import { Brand, Button, IconButton, Modal, Field } from "./components";
import Auth from "./Auth";
import { WindowControls, WindowTitleBar } from "./WindowControls";
import Workspace from "./Workspace";
import Admin from "./Admin";
import Legal from "./Legal";
import { useDesktopUpdates, UpdateButton, UpdateDialog } from "./Updates";
import SkinCenter, { type SkinSelection } from "./Skins";
import { getSkin, skinTokens } from "../shared/skins";
import EntryExperience from "./EntryExperience";

const navigation = [
  { id: "chat", label: "新建任务", icon: NotePencil },
  { id: "projects", label: "项目", icon: Folder },
  { id: "knowledge", label: "公司知识", icon: BookOpen },
  { id: "skills", label: "技能中心", icon: Sparkle },
  { id: "works", label: "我的作品", icon: Images },
];
export type WorkspaceProps = {
  user: User;
  state: LocalState;
  setState: React.Dispatch<React.SetStateAction<LocalState>>;
  page: string;
  navigate: (page: string) => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  departments: Department[];
  skills: Skill[];
  connections: Connection[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  openPassword: () => void;
  exportRecords: () => void;
  importRecords: () => void;
};
export default function App() {
  const [loading, setLoading] = useState(true),
    [user, setUser] = useState<User | null>(null),
    [bootstrap, setBootstrap] = useState(false),
    [startupError, setStartupError] = useState("");
  const [page, setPage] = useState(location.hash.slice(1) || "chat"),
    [conversationId, setConversationId] = useState<string | null>(null),
    [sidebar, setSidebar] = useState(true),
    [accountOpen, setAccountOpen] = useState(false),
    [menu, setMenu] = useState("");
  const [state, setState] = useState<LocalState>(emptyState),
    [ready, setReady] = useState(false),
    [localError, setLocalError] = useState(""),
    [localLoadVersion, setLocalLoadVersion] = useState(0),
    [toast, setToast] = useState(""),
    [passwordOpen, setPasswordOpen] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]),
    [skills, setSkills] = useState<Skill[]>([]),
    [connections, setConnections] = useState<Connection[]>([]);
  const importRef = useRef<HTMLInputElement>(null),
    loadedProfile = useRef<string | null>(null);
  const notify = (message: string) => setToast(message);
  const updates = useDesktopUpdates(!!user && !user.mustChange);
  const [legalOpen, setLegalOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false),
    [enteredUser, setEnteredUser] = useState<string | null>(null);
  useEffect(() => {
    if (!user) setEnteredUser(null);
  }, [user?.id]);
  const [launchTheme, setLaunchTheme] = useState("default");
  useEffect(() => {
    void window.brainDesktop
      ?.readAppearance?.()
      .then(setLaunchTheme)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!ready || !user || loadedProfile.current !== user.id) return;
    setLaunchTheme(state.settings.theme);
    void window.brainDesktop
      ?.writeAppearance?.(state.settings.theme)
      .catch(() => notify("启动外观未能保存，下次启动可能使用浅色。"));
  }, [ready, user?.id, state.settings.theme]);
  const [skinPreview, setSkinPreview] = useState<
    (SkinSelection & { owner: string }) | null
  >(null);
  const activePreview = skinPreview?.owner === user?.id ? skinPreview : null;
  const savedSkin: SkinSelection = {
    skin: getSkin(state.settings.skin).id,
    theme:
      (ready ? state.settings.theme : launchTheme) === "dark"
        ? "dark"
        : "light",
  };
  const appearance = activePreview ?? savedSkin;
  const applySkin = (selection: SkinSelection) => {
    setState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        skin: getSkin(selection.skin).id,
        theme: selection.theme,
      },
    }));
    setSkinPreview(null);
    notify(`已使用 ${getSkin(selection.skin).name}，偏好将保存在本机。`);
  };
  const navigate = (value: string) => {
    location.hash = value;
    setPage(value);
    setAccountOpen(false);
    setMenu("");
  };
  async function refresh() {
    const [d, s, c] = await Promise.all([
      api<Department[]>("/departments"),
      api<Skill[]>("/skills"),
      api<Connection[]>("/connections"),
    ]);
    setDepartments(d);
    setSkills(s);
    setConnections(c);
  }
  async function initialize() {
    setLoading(true);
    try {
      const b = await api<{ required: boolean }>("/bootstrap");
      setBootstrap(b.required);
      if (!b.required) {
        try {
          setUser(await api("/auth/me"));
        } catch {
          setUser(null);
        }
      }
      setStartupError("");
    } catch (e) {
      setStartupError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void initialize();
    const hash = () => setPage(location.hash.slice(1) || "chat");
    window.addEventListener("hashchange", hash);
    return () => window.removeEventListener("hashchange", hash);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    loadedProfile.current = null;
    setReady(false);
    setLocalError("");
    setSkinPreview(null);
    setConversationId(null);
    setState(emptyState());
    setDepartments([]);
    setSkills([]);
    setConnections([]);
    if (!user) return;
    let active = true;
    readLocal(user.id)
      .then((value) => {
        if (active) {
          loadedProfile.current = user.id;
          setState(value);
          setReady(true);
        }
      })
      .catch((error) => {
        if (!active) return;
        const message = (error as Error).message || "本机记录读取失败";
        setLocalError(message);
        notify(`${message} 可以点击“重新读取”。`);
      });
    if (user.mustChange) {
      setPasswordOpen(true);
    } else void refresh().catch((e) => notify(e.message));
    return () => {
      active = false;
      loadedProfile.current = null;
    };
  }, [user?.id, user?.mustChange, localLoadVersion]);
  useEffect(() => {
    if (ready && user && loadedProfile.current === user.id)
      void writeLocal(user.id, state).catch(() =>
        notify("记录未能保存，请立即导出备份并检查磁盘或浏览器空间。"),
      );
  }, [state, ready, user?.id]);
  useLayoutEffect(() => {
    const root = document.documentElement,
      skin = getSkin(appearance.skin);
    root.dataset.theme = appearance.theme;
    root.dataset.skin = skin.id;
    root.dataset.skinVariant = skin.variant;
    root.dataset.skinArtwork = String(!!skin.background);
    for (const [name, value] of Object.entries(
      skinTokens(skin, appearance.theme),
    ))
      root.style.setProperty(name, value);
  }, [appearance.skin, appearance.theme]);
  useEffect(() => {
    if (!activePreview) return;
    const cancel = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector(
          '[role="dialog"], [data-overlay-popup][data-open]',
        )
      )
        setSkinPreview(null);
    };
    document.addEventListener("keydown", cancel);
    return () => document.removeEventListener("keydown", cancel);
  }, [!!activePreview]);
  const exportRecords = () =>
    download(
      `公司大脑-本地记录-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        {
          format: "corporate-brain-local-v1",
          exportedAt: new Date().toISOString(),
          state: { ...state, installed: [] },
        },
        null,
        2,
      ),
    );
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024)
        throw new Error("备份超过 50MB，请分批导入");
      const imported = validateImport(JSON.parse(await file.text()));
      setState((current) => {
        const merge = <T extends { id: string }>(a: T[], b: T[]) => [
          ...a,
          ...b.filter((x) => !a.some((y) => y.id === x.id)),
        ];
        return {
          ...current,
          conversations: merge(current.conversations, imported.conversations),
          drafts: merge(current.drafts, imported.drafts),
          projects: merge(current.projects, imported.projects),
          workspaces: merge(current.workspaces, imported.workspaces),
        };
      });
      notify("已导入当前账号的本地空间，重复记录已跳过。");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function logout() {
    try {
      if (user && ready) await writeLocal(user.id, state);
      await api("/auth/logout", {});
      setUser(null);
      setReady(false);
      navigate("chat");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function handleMenu(action: string) {
    setMenu("");
    if (action === "new") {
      setConversationId(null);
      navigate("chat");
    } else if (action === "export") exportRecords();
    else if (action === "import") importRef.current?.click();
    else if (action === "sidebar") setSidebar((v) => !v);
    else if (action.startsWith("edit:")) {
      const command = action.slice(5);
      if (window.brainDesktop) window.brainDesktop.edit(command);
      else if (!document.execCommand(command))
        notify("请使用浏览器的复制、粘贴或撤销快捷键。");
    } else if (action === "server") {
      void window.brainDesktop?.changeServer();
    } else if (action === "settings") navigate("settings");
    else if (action === "updates") updates.show();
    else if (action === "legal") setLegalOpen(true);
    else if (action === "help")
      notify(
        "对话保存在本机；技能中心可从对话创建草稿并提交。公司账号请联系管理员。",
      );
  }
  useEffect(
    () => window.brainDesktop?.onMenu(handleMenu),
    [state, updates.state],
  );
  if (loading || startupError || !user || !ready)
    return (
      <>
        <EntryExperience
          phase={
            loading
              ? "connecting"
              : startupError || localError
                ? "error"
                : !user
                  ? authBusy
                    ? "verifying"
                    : "auth"
                  : !ready
                    ? "profile"
                    : "ready"
          }
          theme={appearance.theme}
          headline={localError ? "本机记录暂时无法读取" : undefined}
          detail={
            startupError ||
            localError ||
            (loading
              ? "正在建立公司连接，完成后进入登录界面。"
              : !user
                ? "使用你的公司账号继续"
                : !ready
                  ? "正在验证账号并读取此设备上的个人空间。"
                  : "账号与本机空间已准备完成。")
          }
          action={
            startupError
              ? { label: "重新连接", run: () => void initialize() }
              : localError
                ? {
                    label: "重新读取",
                    run: () => {
                      setLocalError("");
                      setLocalLoadVersion((v) => v + 1);
                    },
                  }
                : undefined
          }
          onEntered={() => setEnteredUser(user?.id ?? null)}
        >
          {!loading && !startupError && !user && (
            <Auth
              bootstrap={bootstrap}
              onLogin={setUser}
              onLegal={() => setLegalOpen(true)}
              onBusy={setAuthBusy}
            />
          )}
        </EntryExperience>
        {legalOpen && <Legal close={() => setLegalOpen(false)} />}
      </>
    );
  const isAdmin = page.startsWith("admin");
  const workspaceProps: WorkspaceProps = {
    user,
    state,
    setState,
    page,
    navigate,
    conversationId,
    setConversationId,
    departments,
    skills,
    connections,
    refresh,
    notify,
    openPassword: () => setPasswordOpen(true),
    exportRecords,
    importRecords: () => importRef.current?.click(),
  };
  return (
    <>
      {enteredUser !== user.id && (
        <EntryExperience
          phase="ready"
          theme={appearance.theme}
          detail="账号与本机空间已准备完成。"
          onEntered={() => setEnteredUser(user.id)}
        />
      )}
      <div
        className={`application ${isAdmin ? "admin-app" : ""}`}
        inert={enteredUser !== user.id}
      >
        {!isAdmin && (
          <div className="desktop-bar">
            <IconButton label="后退" onClick={() => history.back()}>
              <ArrowLeft size={21} />
            </IconButton>
            <IconButton label="前进" onClick={() => history.forward()}>
              <ArrowRight size={21} />
            </IconButton>
            <IconButton label="切换侧栏" onClick={() => setSidebar((v) => !v)}>
              <SidebarSimple size={21} />
            </IconButton>
            {["文件", "编辑", "视图", "帮助"].map((label) => (
              <div key={label} className="menu-anchor">
                <ActionMenu
                  open={menu === label}
                  onOpenChange={(open) =>
                    setMenu((current) =>
                      open ? label : current === label ? "" : current,
                    )
                  }
                  restoreFocusBeforeAction={label === "编辑"}
                  className="top-menu-popup"
                  trigger={<button className="menu-label">{label}</button>}
                  items={(label === "文件"
                    ? [
                        ["新建任务", "new"],
                        ["导出本地记录", "export"],
                        ["导入本地记录", "import"],
                        ...(window.brainDesktop?.canChangeServer
                          ? [["切换公司服务器", "server"]]
                          : []),
                      ]
                    : label === "视图"
                      ? [
                          ["切换侧栏", "sidebar"],
                          ["个人设置", "settings"],
                        ]
                      : label === "编辑"
                        ? [
                            ["撤销", "edit:undo"],
                            ["重做", "edit:redo"],
                            ["剪切", "edit:cut"],
                            ["复制", "edit:copy"],
                            ["粘贴", "edit:paste"],
                            ["全选", "edit:selectAll"],
                          ]
                        : [
                            ...(window.brainDesktop
                              ? [["检查更新…", "updates"]]
                              : []),
                            ["使用帮助", "help"],
                            ["隐私与许可", "legal"],
                          ]
                  ).map(([text, action]) => {
                    const Icon = {
                      new: NotePencil,
                      export: DownloadSimple,
                      import: ArrowRight,
                      server: Plug,
                      sidebar: SidebarSimple,
                      settings: GearSix,
                      help: Question,
                      legal: ShieldCheck,
                      updates: DownloadSimple,
                      "edit:undo": ArrowUUpLeft,
                      "edit:redo": ArrowUUpRight,
                      "edit:cut": Scissors,
                      "edit:copy": Copy,
                      "edit:paste": ClipboardText,
                      "edit:selectAll": SelectionAll,
                    }[action];
                    return {
                      label: text,
                      onSelect: () => handleMenu(action),
                      icon: Icon ? <Icon size={17} /> : undefined,
                      separatorBefore:
                        action === "server" ||
                        action === "edit:cut" ||
                        action === "edit:selectAll",
                    };
                  })}
                />
              </div>
            ))}
            <span className="bar-spacer" />
            {!window.brainDesktop && (
              <span className="web-indicator">员工网页端</span>
            )}
            <WindowControls />
          </div>
        )}
        {isAdmin && <WindowTitleBar />}
        {isAdmin && (
          <header className="admin-header">
            <Brand />
            <span className="admin-title">管理后台</span>
            <span className="workspace-name">
              公司工作区 <CaretDown size={13} />
            </span>
            <span className="bar-spacer" />
            <Button onClick={() => navigate("chat")}>
              查看员工端 <ArrowRight size={16} />
            </Button>
            <div className="admin-person">
              <UserCircle size={30} />
              {user.name}
            </div>
          </header>
        )}
        <div className="app-body">
          {(sidebar || isAdmin) && (
            <aside className="sidebar">
              {!isAdmin && (
                <div className="sidebar-brand">
                  <Brand />
                  <IconButton
                    label="搜索本地对话"
                    onClick={() => {
                      navigate("chat");
                      document
                        .querySelector<HTMLInputElement>(".history-search")
                        ?.focus();
                    }}
                  >
                    <MagnifyingGlass size={20} />
                  </IconButton>
                </div>
              )}
              {isAdmin ? (
                <nav className="main-nav">
                  {[
                    {
                      id: "admin-users",
                      icon: UserCircle,
                      label: "部门与员工账号",
                    },
                    { id: "admin-models", icon: GearSix, label: "模型与服务" },
                    {
                      id: "admin-knowledge",
                      icon: BookOpen,
                      label: "公司知识",
                    },
                    { id: "admin-skills", icon: Sparkle, label: "技能发布" },
                    ...(user.role === "company_admin"
                      ? [
                          {
                            id: "admin-feedback",
                            icon: NotePencil,
                            label: "回答反馈",
                          },
                        ]
                      : []),
                    { id: "admin-audit", icon: ShieldCheck, label: "操作记录" },
                  ].map(({ id, icon: Icon, label }) => (
                    <button
                      className={page === id ? "active" : ""}
                      key={id}
                      onClick={() => navigate(id)}
                    >
                      <Icon size={23} />
                      {label}
                    </button>
                  ))}
                </nav>
              ) : (
                <>
                  <nav className="main-nav">
                    {navigation.map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        className={page === id && id !== "chat" ? "active" : ""}
                        onClick={() => {
                          if (id === "chat") setConversationId(null);
                          navigate(id);
                        }}
                      >
                        <Icon size={22} />
                        {label}
                      </button>
                    ))}
                  </nav>
                  <div className="history">
                    <div className="section-label">
                      最近 <CaretDown size={12} />
                      <span>仅本机</span>
                    </div>
                    <input
                      className="history-search"
                      aria-label="搜索本地对话"
                      placeholder="搜索对话"
                      onChange={(e) => {
                        for (const item of document.querySelectorAll<HTMLElement>(
                          "[data-history-title]",
                        ))
                          item.hidden = !item.dataset.historyTitle
                            ?.toLowerCase()
                            .includes(e.target.value.toLowerCase());
                      }}
                    />
                    <div className="history-list">
                      {state.conversations.map((c) => (
                        <button
                          data-history-title={c.title}
                          className={
                            conversationId === c.id && page === "chat"
                              ? "selected"
                              : ""
                          }
                          key={c.id}
                          onClick={() => {
                            setConversationId(c.id);
                            navigate("chat");
                          }}
                        >
                          {c.title}
                        </button>
                      ))}
                      {!state.conversations.length && (
                        <p className="history-hint">你的任务会显示在这里</p>
                      )}
                    </div>
                  </div>
                </>
              )}
              <div className="sidebar-footer">
                <div className="account-area">
                  <ActionMenu
                    open={accountOpen}
                    onOpenChange={setAccountOpen}
                    side="top"
                    className="account-menu-popup"
                    header={
                      <div className="account-summary">
                        <UserCircle size={32} />
                        <div>
                          <strong>{user.name}</strong>
                          <small>
                            {user.departmentName} · {user.username}
                          </small>
                        </div>
                      </div>
                    }
                    items={[
                      {
                        label: "个人设置",
                        onSelect: () => navigate("settings"),
                        icon: <UserCircle size={19} />,
                      },
                      {
                        label: "模型与服务",
                        onSelect: () => navigate("models"),
                        icon: <GearSix size={19} />,
                      },
                      ...([
                        "company_admin",
                        "department_admin",
                        "department_reviewer",
                        "company_reviewer",
                      ].includes(user.role)
                        ? [
                            {
                              label: "管理后台",
                              icon: <ShieldCheck size={19} />,
                              onSelect: () =>
                                navigate(
                                  [
                                    "department_reviewer",
                                    "company_reviewer",
                                  ].includes(user.role)
                                    ? "admin-skills"
                                    : "admin-users",
                                ),
                            },
                          ]
                        : []),
                      {
                        label: "导出本地记录",
                        onSelect: () => handleMenu("export"),
                        icon: <DownloadSimple size={19} />,
                      },
                      {
                        label: "帮助",
                        onSelect: () => handleMenu("help"),
                        icon: <Question size={19} />,
                      },
                      ...(window.brainDesktop
                        ? [
                            {
                              label: "检查更新…",
                              onSelect: () => updates.show(),
                              icon: <DownloadSimple size={19} />,
                            },
                          ]
                        : []),
                      {
                        label: "退出登录",
                        onSelect: () => void logout(),
                        icon: <SignOut size={19} />,
                        danger: true,
                        separatorBefore: true,
                      },
                    ]}
                    trigger={
                      <button
                        className="account-trigger"
                        aria-label="打开账号菜单"
                      >
                        <span className="avatar">
                          <UserCircle size={32} weight="duotone" />
                        </span>
                        <span>
                          <strong>{user.name}</strong>
                          <small>{user.departmentName}</small>
                        </span>
                        <CaretDown size={14} />
                      </button>
                    }
                  />
                  <IconButton label="设置" onClick={() => navigate("settings")}>
                    <GearSix size={21} />
                  </IconButton>
                  <UpdateButton model={updates} />
                </div>
              </div>
            </aside>
          )}
          <main className="main-content">
            {page === "skins" ? (
              <SkinCenter
                current={savedSkin}
                onApply={applySkin}
                onPreview={(value) =>
                  setSkinPreview({ ...value, owner: user.id })
                }
                back={() => navigate("settings")}
              />
            ) : isAdmin ? (
              <Admin {...workspaceProps} />
            ) : (
              <Workspace {...workspaceProps} />
            )}
          </main>
        </div>
        {activePreview && (
          <div className="skin-preview-bar" role="region" aria-label="皮肤试用">
            <span>
              正在预览 <strong>{getSkin(activePreview.skin).name}</strong> ·
              尚未保存
            </span>
            <Button
              onClick={() =>
                setSkinPreview({
                  ...activePreview,
                  theme: activePreview.theme === "dark" ? "light" : "dark",
                })
              }
            >
              切换明暗
            </Button>
            <Button onClick={() => setSkinPreview(null)}>取消预览</Button>
            <Button primary onClick={() => applySkin(activePreview)}>
              保存皮肤
            </Button>
          </div>
        )}
        <input
          ref={importRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {toast && (
          <div className="toast" role="status">
            <CheckCircle size={20} />
            {toast}
            <IconButton label="关闭提示" onClick={() => setToast("")}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        <UpdateDialog
          model={updates}
          beforeInstall={async () => {
            if (!ready || loadedProfile.current !== user.id)
              throw new Error("本地记录尚未就绪，请稍后再安装");
            await writeLocal(user.id, state);
          }}
        />
        {legalOpen && <Legal close={() => setLegalOpen(false)} />}
        {passwordOpen && (
          <Modal
            title={user.mustChange ? "首次登录，请修改初始密码" : "修改密码"}
            close={() => {
              if (!user.mustChange) setPasswordOpen(false);
            }}
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const data = Object.fromEntries(new FormData(e.currentTarget));
                try {
                  await api("/auth/password", data);
                  setPasswordOpen(false);
                  setUser(null);
                  notify("密码已修改，请使用新密码登录。");
                } catch (error) {
                  notify((error as Error).message);
                }
              }}
            >
              <p className="muted">
                {user.mustChange
                  ? "完成改密后即可使用公司工作空间。"
                  : "修改后会退出所有设备的公司登录。"}
              </p>
              <Field label="当前密码">
                <input
                  name="current"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Field label="新密码（至少 12 位）">
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </Field>
              <footer>
                <Button primary type="submit">
                  保存并重新登录
                </Button>
              </footer>
            </form>
          </Modal>
        )}
      </div>
    </>
  );
}
