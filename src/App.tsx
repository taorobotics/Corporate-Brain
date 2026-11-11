import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Plus,
  ChatCircle,
  ChatTeardropText,
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
import {
  Brand,
  BrandMark,
  Button,
  IconButton,
  Modal,
  Field,
} from "./components";
import Auth from "./Auth";
import { WindowControls, WindowTitleBar } from "./WindowControls";
import Workspace from "./Workspace";
import Admin from "./Admin";
import Legal from "./Legal";
import { useDesktopUpdates, UpdateButton, UpdateDialog } from "./Updates";
import SkinCenter, { type SkinSelection } from "./Skins";
import { getSkin, skinTokens } from "../shared/skins";
import EntryExperience from "./EntryExperience";
import { Avatar } from "./Profile";
import GeneralFeedback from "./GeneralFeedback";
import { useProduction, type ProductionController } from "./Production";
import { addLocalProject, recentConversations } from "../shared/workspaces";
import ResizableSidebar from "./ResizableSidebar";
import { isSettingsPage } from "./SettingsLayout";
import { pickChatHeadline } from "../shared/chat-headlines";

const lastHeadlineKey = "corporate-brain:last-chat-headline";

const navigation = [
  { id: "chat", label: "对话", icon: ChatCircle },
  { id: "projects", label: "项目", icon: Folder },
  { id: "knowledge", label: "公司知识", icon: BookOpen },
  { id: "skills", label: "技能中心", icon: Sparkle },
  { id: "works", label: "我的作品", icon: Images },
];
export type WorkspaceProps = {
  production: ProductionController;
  user: User;
  updateUser: (user: User) => void;
  state: LocalState;
  setState: React.Dispatch<React.SetStateAction<LocalState>>;
  page: string;
  navigate: (page: string) => void;
  conversationId: string | null;
  chatHeadline: string;
  newConversation: () => void;
  createProject: () => Promise<void>;
  openProject: (id: string) => void;
  setConversationId: (id: string | null) => void;
  departments: Department[];
  skills: Skill[];
  connections: Connection[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  openPassword: () => void;
  exportRecords: () => void;
  importRecords: () => void;
  skins: React.ReactNode;
};
export default function App() {
  const [loading, setLoading] = useState(true),
    [user, setUser] = useState<User | null>(null),
    [bootstrap, setBootstrap] = useState(false),
    [startupError, setStartupError] = useState("");
  const [page, setPage] = useState(
      location.hash.slice(1) === "production"
        ? "works"
        : location.hash.slice(1) || "chat",
    ),
    [conversationId, setConversationId] = useState<string | null>(null),
    [sidebar, setSidebar] = useState(true),
    [accountOpen, setAccountOpen] = useState(false),
    [menu, setMenu] = useState("");
  const [state, setState] = useState<LocalState>(emptyState),
    [ready, setReady] = useState(false),
    [localError, setLocalError] = useState(""),
    [localLoadVersion, setLocalLoadVersion] = useState(0),
    [toast, setToast] = useState(""),
    [passwordOpen, setPasswordOpen] = useState(false),
    [feedbackOpen, setFeedbackOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [chatHeadline, setChatHeadline] = useState(() => {
    let previous: string | null = null;
    try {
      previous = localStorage.getItem(lastHeadlineKey);
    } catch {}
    return pickChatHeadline(previous);
  });
  useEffect(() => {
    try {
      localStorage.setItem(lastHeadlineKey, chatHeadline);
    } catch {}
  }, [chatHeadline]);
  function newConversation() {
    setChatHeadline((previous) => pickChatHeadline(previous));
    setConversationId(null);
    navigate("chat");
  }
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<string[]>([]);
  const creatingWorkspace = useRef(false);
  const [departments, setDepartments] = useState<Department[]>([]),
    [skills, setSkills] = useState<Skill[]>([]),
    [connections, setConnections] = useState<Connection[]>([]);
  const importRef = useRef<HTMLInputElement>(null),
    loadedProfile = useRef<string | null>(null);
  const notify = (message: string) => setToast(message);
  const updates = useDesktopUpdates(!!user && !user.mustChange);
  const production = useProduction(user, state);
  const recent = useMemo(
    () => recentConversations(state.conversations),
    [state.conversations],
  );
  const recentMatches = recent.filter((c) =>
    [c.title, state.workspaces.find((w) => w.id === c.workspaceId)?.name ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(historySearch.toLowerCase()),
  );
  async function createProject() {
    if (creatingWorkspace.current) return;
    if (!window.brainDesktop) {
      notify("请在桌面客户端选择本地文件夹来新建项目。");
      return;
    }
    creatingWorkspace.current = true;
    const owner = loadedProfile.current;
    try {
      const folder = await window.brainDesktop.selectDirectory();
      if (!folder || loadedProfile.current !== owner) return;
      const id = crypto.randomUUID();
      setState((s) => addLocalProject(s, folder, id));
      setCollapsedWorkspaces((ids) => ids.filter((item) => item !== id));
      newConversation();
      setHistorySearch("");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      creatingWorkspace.current = false;
    }
  }
  function openProject(id: string) {
    setState((s) =>
      s.workspaces.some((w) => w.id === id)
        ? { ...s, activeWorkspaceId: id }
        : s,
    );
    newConversation();
    setCollapsedWorkspaces((ids) => ids.filter((item) => item !== id));
    setHistorySearch("");
  }
  useEffect(() => {
    if (!conversationId) return;
    setState((s) => {
      const id = s.conversations.find(
        (c) => c.id === conversationId,
      )?.workspaceId;
      return id &&
        id !== s.activeWorkspaceId &&
        s.workspaces.some((w) => w.id === id)
        ? { ...s, activeWorkspaceId: id }
        : s;
    });
  }, [conversationId]);
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
    if (value === "production") value = "works";
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
    const hash = () =>
      setPage(
        location.hash.slice(1) === "production"
          ? "works"
          : location.hash.slice(1) || "chat",
      );
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
    setHistorySearch("");
    setCollapsedWorkspaces([]);
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
      newConversation();
    } else if (action === "export") exportRecords();
    else if (action === "import") importRef.current?.click();
    else if (action === "sidebar") setSidebar((v) => !v);
    else if (action.startsWith("sidebar:")) {
      const actual = document
        .querySelector(".employee-app .sidebar")
        ?.getBoundingClientRect().width;
      setState((s) => ({
        ...s,
        settings: {
          ...s.settings,
          sidebarWidth:
            action === "sidebar:reset"
              ? undefined
              : Math.max(
                  170,
                  Math.min(
                    420,
                    (actual ?? s.settings.sidebarWidth ?? 198) +
                      (action === "sidebar:widen" ? 24 : -24),
                  ),
                ),
        },
      }));
    } else if (action.startsWith("edit:")) {
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
              theme={appearance.theme}
              onTheme={() => {
                const next = appearance.theme === "dark" ? "light" : "dark";
                setLaunchTheme(next);
                void window.brainDesktop
                  ?.writeAppearance?.(next)
                  .catch(() =>
                    notify("启动外观未能保存，下次启动可能使用浅色。"),
                  );
              }}
            />
          )}
        </EntryExperience>
        {legalOpen && <Legal close={() => setLegalOpen(false)} />}
      </>
    );
  const isAdmin = page.startsWith("admin");
  const accountMenu = (
    <ActionMenu
      open={accountOpen}
      onOpenChange={setAccountOpen}
      side="top"
      className="account-menu-popup"
      header={
        <div className="account-summary">
          <Avatar user={user} size={32} />
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
          label: "设置",
          onSelect: () => navigate("settings"),
          icon: <GearSix size={19} />,
        },
        {
          label: "反馈",
          onSelect: () => {
            setAccountOpen(false);
            setFeedbackOpen(true);
          },
          icon: <ChatTeardropText size={19} />,
        },
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
          className={`account-trigger ${isSettingsPage(page) ? "active" : ""}`}
          title={`${user.name} · 账号菜单`}
          data-settings-active={isSettingsPage(page) ? "page" : undefined}
          aria-label="打开账号菜单"
        >
          <Avatar user={user} size={isAdmin ? 36 : 32} />
          <span>
            <strong>{user.name}</strong>
            <small>{user.departmentName}</small>
          </span>
          <CaretDown size={14} />
        </button>
      }
    />
  );
  const workspaceProps: WorkspaceProps = {
    production,
    user,
    updateUser: setUser,
    state,
    setState,
    page,
    navigate,
    conversationId,
    chatHeadline,
    newConversation,
    createProject,
    openProject,
    setConversationId,
    departments,
    skills,
    connections,
    refresh,
    notify,
    openPassword: () => setPasswordOpen(true),
    exportRecords,
    importRecords: () => importRef.current?.click(),
    skins: (
      <SkinCenter
        current={savedSkin}
        onApply={applySkin}
        onPreview={(value) => setSkinPreview({ ...value, owner: user.id })}
        back={() => navigate("settings")}
      />
    ),
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
        className={`application ${isAdmin ? "admin-app" : "employee-app"}`}
        inert={enteredUser !== user.id}
      >
        {!isAdmin && (
          <div className="desktop-bar">
            <span className="window-caption app-caption">公司大脑</span>
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
                        ["新建对话", "new"],
                        ["导出本地记录", "export"],
                        ["导入本地记录", "import"],
                        ...(window.brainDesktop?.canChangeServer
                          ? [["切换公司服务器", "server"]]
                          : []),
                      ]
                    : label === "视图"
                      ? [
                          ["切换侧栏", "sidebar"],
                          ["加宽对话侧栏", "sidebar:widen"],
                          ["缩窄对话侧栏", "sidebar:narrow"],
                          ["恢复侧栏默认宽度", "sidebar:reset"],
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
              <Avatar user={user} size={30} />
              {user.name}
            </div>
          </header>
        )}
        <div className="app-body">
          {!isAdmin && (
            <nav className="activity-rail main-nav" aria-label="主导航">
              <button
                className="rail-brand"
                aria-label="公司大脑首页"
                onClick={newConversation}
              >
                <BrandMark />
              </button>
              {navigation.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  aria-label={label}
                  className={page === id ? "active" : ""}
                  aria-current={page === id ? "page" : undefined}
                  onClick={() => navigate(id)}
                >
                  <Icon size={20} />
                  <span>{label}</span>
                </button>
              ))}
              <div className="rail-account">
                <UpdateButton model={updates} />
                {accountMenu}
              </div>
            </nav>
          )}
          {(sidebar || isAdmin) && (
            <ResizableSidebar
              key={`${user.id}:${isAdmin}`}
              enabled={!isAdmin}
              width={state.settings.sidebarWidth}
              onResize={(sidebarWidth) =>
                setState((s) => ({
                  ...s,
                  settings: { ...s.settings, sidebarWidth },
                }))
              }
            >
              {!isAdmin && (
                <div className="sidebar-brand">
                  <strong>对话</strong>
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
                            label: "用户反馈",
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
                  <button
                    className="new-conversation"
                    aria-label="新建对话"
                    onClick={newConversation}
                  >
                    <NotePencil size={18} />
                    <span>新建对话</span>
                  </button>
                  <div className="history">
                    <div className="section-label">
                      项目
                      <span>仅本机</span>
                      <IconButton
                        label="新建项目"
                        onClick={() => void createProject()}
                      >
                        <Plus size={16} />
                      </IconButton>
                    </div>
                    <input
                      className="history-search"
                      aria-label="搜索项目或对话"
                      placeholder="搜索项目或对话"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                    />
                    <div
                      className="history-list project-conversations"
                      aria-label="项目对话"
                    >
                      {state.workspaces.map((workspace) => {
                        const numberedName =
                          workspace.name.match(/^(.*) (\(\d+\))$/);
                        const showNumber =
                          numberedName &&
                          state.workspaces.some(
                            (w) => w.name === numberedName[1],
                          );
                        const projectMatches = workspace.name
                          .toLowerCase()
                          .includes(historySearch.toLowerCase());
                        const conversations = state.conversations.filter(
                          (c) =>
                            c.workspaceId === workspace.id &&
                            (projectMatches ||
                              c.title
                                .toLowerCase()
                                .includes(historySearch.toLowerCase())),
                        );
                        if (
                          historySearch &&
                          !conversations.length &&
                          !workspace.name
                            .toLowerCase()
                            .includes(historySearch.toLowerCase())
                        )
                          return null;
                        const expanded =
                          !!historySearch ||
                          !collapsedWorkspaces.includes(workspace.id);
                        return (
                          <section
                            className="workspace-group"
                            data-project-id={workspace.id}
                            data-workspace-id={workspace.id}
                            key={workspace.id}
                          >
                            <div className="workspace-heading">
                              <button
                                className="workspace-collapse"
                                aria-label={`${expanded ? "收起" : "展开"}项目 ${workspace.name}`}
                                aria-expanded={expanded}
                                onClick={() =>
                                  setCollapsedWorkspaces((ids) =>
                                    expanded
                                      ? [...ids, workspace.id]
                                      : ids.filter((id) => id !== workspace.id),
                                  )
                                }
                              >
                                <CaretDown
                                  size={12}
                                  style={{
                                    transform: expanded
                                      ? undefined
                                      : "rotate(-90deg)",
                                  }}
                                />
                              </button>
                              <button
                                className={`workspace-select ${state.activeWorkspaceId === workspace.id ? "active" : ""}`}
                                aria-label={`打开项目 ${workspace.name}`}
                                title={workspace.name}
                                aria-current={
                                  state.activeWorkspaceId === workspace.id
                                    ? "true"
                                    : undefined
                                }
                                onClick={() => openProject(workspace.id)}
                              >
                                <Folder size={17} />
                                <span>
                                  {showNumber
                                    ? numberedName[1]
                                    : workspace.name}
                                </span>
                                {showNumber && (
                                  <small className="workspace-number">
                                    {numberedName[2]}
                                  </small>
                                )}
                              </button>
                              <button
                                className="workspace-new-chat"
                                aria-label={`在${workspace.name}中新建对话`}
                                onClick={() => openProject(workspace.id)}
                              >
                                <Plus size={15} />
                              </button>
                            </div>
                            {expanded && (
                              <div className="workspace-conversations">
                                {conversations.map((c) => (
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
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                    <div className="section-label recent-label">最近</div>
                    <nav
                      className="history-list recent-conversations"
                      aria-label="最近对话"
                    >
                      {recentMatches.map((c) => (
                        <button
                          key={c.id}
                          data-recent-conversation-id={c.id}
                          title={`${c.title}\n${state.workspaces.find((w) => w.id === c.workspaceId)?.name ?? ""}`}
                          aria-current={
                            conversationId === c.id && page === "chat"
                              ? "page"
                              : undefined
                          }
                          className={
                            conversationId === c.id && page === "chat"
                              ? "selected"
                              : ""
                          }
                          onClick={() => {
                            setConversationId(c.id);
                            navigate("chat");
                          }}
                        >
                          {c.title}
                        </button>
                      ))}
                      {!recentMatches.length && (
                        <p className="history-hint">
                          {historySearch
                            ? "没有匹配的对话"
                            : "还没有对话，点击“新建对话”开始"}
                        </p>
                      )}
                    </nav>
                  </div>
                </>
              )}
              {isAdmin && (
                <div className="sidebar-footer account-area">
                  <UpdateButton model={updates} />
                  {accountMenu}
                </div>
              )}
            </ResizableSidebar>
          )}
          <main className="main-content">
            {isAdmin ? (
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
        {feedbackOpen && (
          <GeneralFeedback
            key={user.id}
            close={() => setFeedbackOpen(false)}
            notify={notify}
          />
        )}
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
              {user.role !== "company_admin" && (
                <p className="muted">
                  这是公司管理的内部账号。密码加密保存在公司服务器，公司管理员验证身份后可查看当前密码，查看会留有记录。请使用专属工作密码。
                </p>
              )}
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
