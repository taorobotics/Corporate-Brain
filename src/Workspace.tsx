import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Plus,
  ArrowUp,
  Sparkle,
  Folder,
  BookOpen,
  Images,
  SlidersHorizontal,
  Paperclip,
  X,
  ArrowsOutSimple,
  SidebarSimple,
  DownloadSimple,
  ArrowLeft,
  Check,
  FileText,
  CircleNotch,
  UserCircle,
  GearSix,
  HardDrives,
  Trash,
  ArrowRight,
  Plug,
  MagnifyingGlass,
  ChatCircle,
  VideoCamera,
  Lightning,
  ShieldCheck,
  Sun,
  Moon,
} from "@phosphor-icons/react";
import { SelectField } from "./Dropdown";
import type { WorkspaceProps } from "./App";
import type {
  Draft,
  Skill,
  Conversation,
  Message,
  Connection,
  DshMode,
  WorkspaceAccess,
} from "../shared/types";
import {
  DSH_MODE_OPTIONS,
  WORKSPACE_ACCESS_OPTIONS,
  estimateTokens,
} from "../shared/workspaces";
import { roleNames } from "../shared/types";
import { api, download } from "./api";
import {
  Brand,
  Button,
  IconButton,
  Modal,
  Empty,
  Search,
  Field,
} from "./components";
import SkillEditor from "./SkillEditor";
import GrokBall from "./GrokBall";

type ThinkingStep = {
  label: string;
  detail: string;
  emotion: string;
};
type ThinkingState = {
  steps: ThinkingStep[];
  active: number;
  done?: boolean;
  error?: boolean;
};
export default function Workspace(props: WorkspaceProps) {
  const {
    user,
    state,
    setState,
    page,
    navigate,
    conversationId,
    setConversationId,
    skills,
    connections,
    refresh,
    notify,
  } = props;
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("department");
  const [preview, setPreview] = useState<string | null>(null),
    [previewWidth, setPreviewWidth] = useState(42),
    [zoom, setZoom] = useState(100),
    [skillDraft, setSkillDraft] = useState<Draft | null>(null),
    [detail, setDetail] = useState<Skill | null>(null);
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null),
    [attachments, setAttachments] = useState<
      { name: string; content: string; image?: string }[]
    >([]),
    [projectDialog, setProjectDialog] = useState(false),
    [selectedProject, setSelectedProject] = useState<string | null>(null),
    [workspaceDialog, setWorkspaceDialog] = useState(false),
    [thinking, setThinking] = useState<ThinkingState | null>(null),
    [lastUsage, setLastUsage] = useState<
      { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null
    >(null);
  const [taskKind, setTaskKind] = useState<"chat" | "image" | "video">("chat"),
    [taskError, setTaskError] = useState("");
  const filesRef = useRef<HTMLInputElement>(null),
    messagesRef = useRef<HTMLDivElement>(null),
    thinkingTimer = useRef<ReturnType<typeof setInterval> | null>(null),
    thinkingClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversation = state.conversations.find((c) => c.id === conversationId);
  const taskModels = connections.filter(
    (c) => c.enabled && c.kind === taskKind,
  );
  const model =
    taskModels.find((c) => c.id === state.settings.model) ?? taskModels[0];
  const workspace =
    state.workspaces.find((item) => item.id === state.activeWorkspaceId) ??
    state.workspaces[0];
  const draftTokenEstimate = estimateTokens(
    `${text}\n${attachments.map((attachment) => attachment.content).join("\n")}`,
  );
  useEffect(() => {
    setPreview(null);
    setSearch("");
  }, [page, conversationId]);
  useEffect(() => {
    if (page !== "models") return;
    // Connections can be added while an employee keeps the client open.
    // Refresh on entry and when the window regains focus so the model list
    // reflects the current server-side department authorization.
    const reload = () => {
      void refresh().catch((error) => notify((error as Error).message));
    };
    reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [page]);
  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [conversation?.messages.length, busy]);
  useEffect(
    () => () => {
      if (thinkingTimer.current) clearInterval(thinkingTimer.current);
      if (thinkingClearTimer.current) clearTimeout(thinkingClearTimer.current);
    },
  );
  function patchSettings(value: Partial<typeof state.settings>) {
    setState((s) => ({ ...s, settings: { ...s.settings, ...value } }));
  }
  function patchWorkspace(value: Partial<NonNullable<typeof workspace>>) {
    if (!workspace) return;
    setState((s) => ({
      ...s,
      workspaces: s.workspaces.map((item) =>
        item.id === workspace.id ? { ...item, ...value } : item,
      ),
    }));
  }
  function thinkingSteps(): ThinkingStep[] {
    const mode =
      DSH_MODE_OPTIONS.find((option) => option.value === state.settings.mode) ??
      DSH_MODE_OPTIONS[0];
    return [
      {
        label: "接收任务",
        detail: "整理当前问题和对话上下文",
        emotion: "31",
      },
      {
        label: "分析任务",
        detail: `使用${mode.label}规划本轮处理方式`,
        emotion: "30",
      },
      {
        label: attachments.length ? "读取附件" : "检查工具",
        detail: attachments.length
          ? `准备 ${attachments.length} 个附件`
          : "准备文件、联网和模型能力",
        emotion: attachments.length ? "40" : "36",
      },
      {
        label: "整理回复",
        detail: "生成结果并返回给你",
        emotion: "39",
      },
    ];
  }
  function startThinking() {
    if (thinkingTimer.current) clearInterval(thinkingTimer.current);
    if (thinkingClearTimer.current) clearTimeout(thinkingClearTimer.current);
    const steps = thinkingSteps();
    setThinking({ steps, active: 0 });
    thinkingTimer.current = setInterval(() => {
      setThinking((current) => {
        if (!current || current.done || current.error) return current;
        return {
          ...current,
          active: Math.min(current.active + 1, current.steps.length - 1),
        };
      });
    }, 1400);
  }
  function finishThinking(error = false) {
    if (thinkingTimer.current) {
      clearInterval(thinkingTimer.current);
      thinkingTimer.current = null;
    }
    setThinking((current) =>
      current
        ? {
            ...current,
            active: error ? current.active : current.steps.length - 1,
            done: !error,
            error,
          }
        : current,
    );
    if (thinkingClearTimer.current) clearTimeout(thinkingClearTimer.current);
    thinkingClearTimer.current = setTimeout(
      () => setThinking(null),
      error ? 1600 : 700,
    );
  }
  async function chooseWorkspaceFolder() {
    if (!window.brainDesktop) {
      notify("网页端无法读取本地目录，请使用桌面客户端选择工作区。");
      return;
    }
    const selected = await window.brainDesktop.selectDirectory();
    if (selected) patchWorkspace({ folder: selected });
  }
  async function chooseFiles(files?: FileList | null) {
    try {
      let selected: typeof attachments;
      if (window.brainDesktop && !files)
        selected = await window.brainDesktop.selectFiles();
      else {
        selected = [];
        for (const file of Array.from(files ?? [])) {
          if (file.size > 2 * 1024 * 1024)
            throw new Error("首版单个附件限制 2MB，请使用较小文件");
          if (file.type.startsWith("image/")) {
            const image = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("图片读取失败"));
              reader.readAsDataURL(file);
            });
            selected.push({ name: file.name, content: "", image });
          } else if (/\.(txt|md|csv|json)$/i.test(file.name))
            selected.push({ name: file.name, content: await file.text() });
          else
            throw new Error(
              "当前可读取 TXT、Markdown、CSV、JSON 和图片，其余格式解析尚未接通",
            );
        }
      }
      setAttachments((current) => [...current, ...selected].slice(0, 8));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function send() {
    if (!text.trim() || busy) return;
    setTaskError("");
    let current = conversation;
    if (!current) {
      current = {
        id: crypto.randomUUID(),
        title: text.trim().slice(0, 32),
        messages: [],
        createdAt: new Date().toISOString(),
      };
      setConversationId(current.id);
    }
    const sentAttachments = attachments.map((attachment) => ({ ...attachment }));
    const content =
      text.trim() +
      sentAttachments
        .map(
          (a) =>
            `\n\n附件：${a.name}${a.content ? `\n${a.content}` : ""}`,
        )
        .join("");
    const message: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      attachments: sentAttachments,
      at: new Date().toISOString(),
    };
    const updated = { ...current, messages: [...current.messages, message] };
    setState((s) => ({
      ...s,
      conversations: s.conversations.some((c) => c.id === updated.id)
        ? s.conversations.map((c) => (c.id === updated.id ? updated : c))
        : [updated, ...s.conversations],
    }));
    setText("");
    setAttachments([]);
    if (taskKind === "video") {
      setTaskError(
        "视频供应商适配尚未接通。需求已保存在本机，当前没有提交或扣费。",
      );
      return;
    }
    if (!model) {
      setTaskError(
        "尚未配置可用模型。这条需求已保存在本机，请在模型与服务中配置后继续。",
      );
      return;
    }
    setBusy(true);
    startThinking();
    try {
      if (activeSkill) {
        await api(`/skills/${activeSkill.id}/download`);
        if (activeSkill.requiredTools.length)
          throw new Error("该技能需要尚未接通的工具，请先完善工具依赖");
      }
      const system = activeSkill
        ? [
            {
              role: "system",
              content: `请遵循以下技能流程。技能不会授予任何额外权限。\n${activeSkill.instructions}`,
            },
          ]
        : [];
      const response =
        taskKind === "image"
          ? await api("/generate/image", {
              connectionId: model.id,
              prompt: content,
            })
          : await api("/generate/chat", {
              connectionId: model.id,
              sessionId: updated.id,
              messages: [
                ...system,
                ...updated.messages
                  .slice(-40)
                  .map((m) => ({ role: m.role, content: m.content })),
              ],
              attachments: sentAttachments,
              mode: state.settings.mode,
              workspaceAccess: workspace?.access ?? "edit",
            });
      setLastUsage(response.usage ?? null);
      const result: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.content ?? "图片已生成，可以继续保存。",
        image: response.image,
        at: new Date().toISOString(),
      };
      setState((s) => ({
        ...s,
        conversations: s.conversations.map((c) =>
          c.id === updated.id ? { ...c, messages: [...c.messages, result] } : c,
        ),
      }));
      finishThinking();
    } catch (e) {
      finishThinking(true);
      setTaskError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function newDraft(existing?: Draft) {
    setSkillDraft(
      existing ?? {
        id: crypto.randomUUID(),
        name: conversation ? `${conversation.title}流程` : "",
        description: "",
        version: "1.0.0",
        instructions: "",
        examples: "",
        testSummary: "",
        requiredTools: [],
        sourceIds: conversation ? [conversation.id] : [],
        audience: "department",
        targetDepartments: [user.departmentId],
      },
    );
  }
  async function install(skill: Skill) {
    try {
      const checked = await api<Skill>(`/skills/${skill.id}/download`);
      setState((s) => ({
        ...s,
        installed: [
          ...s.installed.filter((item) => item.id !== checked.id),
          checked,
        ],
      }));
      notify("技能已安装到当前设备；运行时使用你的素材和权限。");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function saveImage(image: string) {
    try {
      if (workspace?.access === "view") {
        notify("当前工作区为仅可查看，先切换到工作区内修改或完全权限。");
        return;
      }
      const name = `公司大脑-${Date.now()}.png`;
      if (window.brainDesktop) {
        if (await window.brainDesktop.saveFile(name, image.split(",")[1], true))
          notify("已保存图片。");
      } else {
        const link = document.createElement("a");
        link.href = image;
        link.download = name;
        link.click();
      }
    } catch {
      notify("保存失败，请检查输出目录和磁盘空间。");
    }
  }
  const titles: Record<string, [string, string]> = {
    projects: ["项目", "将任务、参考资料与可复用的工作流程整理在一起。"],
    knowledge: ["公司知识", "连接公司的资料，让每次创作都有依据。"],
    skills: ["技能中心", "把好的工作方法沉淀下来，与同事一起使用。"],
    works: ["我的作品", "在这台设备上生成和保存的创作成果。"],
    settings: ["个人设置", "管理你的账号、工作习惯与本地记录。"],
    models: ["模型与服务", "为不同任务选择合适的模型。"],
  };
  function PageHeader({ action }: { action?: React.ReactNode }) {
    const title = titles[page] ?? ["", ""];
    return (
      <header className="page-header">
        <div>
          <h1>{title[0]}</h1>
          <p>{title[1]}</p>
        </div>
        {action}
      </header>
    );
  }
  const filteredSkills = (
    filter === "installed" ? state.installed : skills
  ).filter(
    (skill) =>
      (filter === "installed" ||
        filter === "all" ||
        (filter === "department"
          ? skill.audience === "department" &&
            skill.ownerDepartmentId === user.departmentId
          : filter === "company"
            ? skill.audience === "company"
            : skill.audience === "departments")) &&
      `${skill.name} ${skill.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      {page === "chat" && (
        <div className={`chat-layout ${preview ? "has-preview" : ""}`}>
          <section className="chat">
            <header className="chat-header">
              <strong>{conversation?.title ?? "新建任务"}</strong>
              <span className="header-divider" />
              <div className="workspace-controls">
                <SelectField
                  label="工作区"
                  variant="quiet"
                  side="bottom"
                  value={workspace?.id ?? null}
                  onValueChange={(value) =>
                    setState((current) => ({
                      ...current,
                      activeWorkspaceId: value,
                    }))
                  }
                  icon={<Folder size={17} />}
                  options={state.workspaces.map((item) => ({
                    value: item.id,
                    label: item.name,
                    description: item.description || "个人工作区",
                  }))}
                  action={{
                    label: "添加工作区",
                    onClick: () => setWorkspaceDialog(true),
                  }}
                />
                <IconButton
                  label="选择工作区目录"
                  onClick={() => void chooseWorkspaceFolder()}
                >
                  <Folder size={16} />
                </IconButton>
              </div>
              <span className="bar-spacer" />
              <Button onClick={() => newDraft()}>
                <Sparkle size={18} />
                制作成技能
              </Button>
              <IconButton
                label="展开成果预览"
                disabled={!conversation?.messages.some((m) => m.image)}
                onClick={() => {
                  const image = conversation?.messages.findLast(
                    (m) => m.image,
                  )?.image;
                  if (image) setPreview(preview ? null : image);
                }}
              >
                <SidebarSimple size={21} />
              </IconButton>
            </header>
            <div className="messages" ref={messagesRef}>
              {!conversation?.messages.length && (
                <div className="chat-welcome">
                  <Sparkle size={38} weight="duotone" />
                  <h1>今天，一起完成些什么？</h1>
                  <p>从一个想法开始，让公司的知识与技能帮你推进工作。</p>
                  <div className="suggestions">
                    {[
                      { text: "制作一张产品海报", icon: Images },
                      { text: "整理视频脚本和分镜", icon: FileText },
                      { text: "把成功经验整理成技能", icon: Sparkle },
                    ].map(({ text: suggestion, icon: Icon }) => (
                      <button
                        key={suggestion}
                        onClick={() => setText(suggestion)}
                      >
                        <Icon size={19} />
                        {suggestion}
                        <ArrowRight size={16} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {conversation?.messages.map((message) => (
                <div key={message.id} className={`message ${message.role}`}>
                  <span className="message-avatar">
                    {message.role === "user" ? (
                      <UserCircle size={26} />
                    ) : (
                      <Sparkle size={25} weight="fill" />
                    )}
                  </span>
                  <div className="message-body">
                    <div className="message-text">{message.content}</div>
                    {message.attachments?.some((a) => a.image) && (
                      <div className="message-attachments">
                        {message.attachments
                          .filter((a) => a.image)
                          .map((a, index) => (
                            <button
                              key={index}
                              onClick={() => setPreview(a.image!)}
                              title={a.name}
                            >
                              <img src={a.image} alt={a.name} />
                              <span>{a.name}</span>
                            </button>
                          ))}
                      </div>
                    )}
                    {message.image && (
                      <>
                        <button
                          className="generated-image"
                          onClick={() => setPreview(message.image!)}
                        >
                          <img
                            src={message.image}
                            alt="生成成果，点击展开预览"
                          />
                          <ArrowsOutSimple size={20} />
                        </button>
                        <div className="image-actions">
                          <Button
                            onClick={() => void saveImage(message.image!)}
                          >
                            <DownloadSimple size={16} />
                            保存到本地
                          </Button>
                          <Button disabled title="NAS 归档服务尚未接通">
                            <Folder size={16} />
                            归档 NAS
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {thinking && (
                <div
                  className={`working-thoughts ${thinking.error ? "is-error" : ""}`}
                  aria-live="polite"
                >
                  <GrokBall
                    emotion={
                      thinking.error
                        ? "34"
                        : thinking.done
                          ? "33"
                          : thinking.steps[thinking.active].emotion
                    }
                    size={58}
                  />
                  <div className="working-thoughts-body">
                    <div className="working-thoughts-heading">
                      <strong>
                        {thinking.error
                          ? "处理遇到问题"
                          : thinking.done
                            ? "任务完成"
                            : thinking.steps[thinking.active].label}
                      </strong>
                      <span>DSH 工作状态</span>
                    </div>
                    <div className="thinking-steps">
                      {thinking.steps.map((step, index) => {
                        const status =
                          thinking.error && index === thinking.active
                            ? "error"
                            : thinking.done || index < thinking.active
                              ? "done"
                              : index === thinking.active
                                ? "active"
                                : "pending";
                        return (
                          <div className={`thinking-step ${status}`} key={step.label}>
                            <span className="thinking-step-mark">
                              {status === "done" ? <Check size={12} /> : ""}
                            </span>
                            <span>
                              <b>{step.label}</b>
                              <small>{step.detail}</small>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <small className="thinking-disclaimer">
                      这里显示任务阶段，不展示模型的隐性思维内容。
                    </small>
                  </div>
                </div>
              )}
              {taskError && (
                <div className="task-error" role="alert">
                  {taskError}
                  <button onClick={() => navigate("models")}>
                    模型与服务 <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <div className="composer-wrap">
              <div className="composer">
                {(attachments.length > 0 || activeSkill) && (
                  <div className="attachment-row">
                    {attachments.map((a, index) => (
                      <span className="chip" key={index}>
                        <Paperclip size={15} />
                        {a.name}
                        <IconButton
                          label={`移除 ${a.name}`}
                          onClick={() =>
                            setAttachments((v) =>
                              v.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <X size={12} />
                        </IconButton>
                      </span>
                    ))}
                    {activeSkill && (
                      <span className="chip accent">
                        <Sparkle size={15} />
                        {activeSkill.name}
                        <IconButton
                          label="移除所选技能"
                          onClick={() => setActiveSkill(null)}
                        >
                          <X size={12} />
                        </IconButton>
                      </span>
                    )}
                  </div>
                )}
                <textarea
                  aria-label="任务输入"
                  placeholder="描述你想完成的工作，添加文件，或选择技能"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="composer-tools">
                  <IconButton
                    label="添加文件"
                    onClick={() => {
                      if (window.brainDesktop) void chooseFiles();
                      else filesRef.current?.click();
                    }}
                  >
                    <Plus size={23} />
                  </IconButton>
                  <button
                    className="text-button"
                    onClick={() => navigate("skills")}
                  >
                    <Sparkle size={19} />
                    技能
                  </button>
                  <SelectField
                    label="任务类型"
                    variant="quiet"
                    side="top"
                    value={taskKind}
                    onValueChange={(value) =>
                      setTaskKind(value as typeof taskKind)
                    }
                    options={[
                      {
                        value: "chat",
                        label: "对话",
                        description: "讨论想法、撰写内容与日常问答",
                        icon: <ChatCircle size={18} />,
                      },
                      {
                        value: "image",
                        label: "图片",
                        description: "使用已配置的图片服务创作",
                        icon: <Images size={18} />,
                      },
                      {
                        value: "video",
                        label: "视频",
                        description: "视频服务仍在接入，需求可先保存",
                        icon: <VideoCamera size={18} />,
                        badge: "接入中",
                      },
                    ]}
                  />
                  <span className="bar-spacer" />
                  <SelectField
                    label="选择模型"
                    variant="quiet"
                    side="top"
                    align="end"
                    value={model?.id ?? null}
                    placeholder="未配置模型"
                    onValueChange={(value) => patchSettings({ model: value })}
                    options={taskModels.map((c) => ({
                      value: c.id,
                      label: c.name,
                      description: c.model,
                      icon: <Plug size={18} />,
                    }))}
                    emptyText="尚未配置可用模型"
                    emptyDescription="添加服务连接后，即可在这里切换获准使用的模型。"
                    action={{
                      label: "前往模型与服务",
                      onClick: () => navigate("models"),
                    }}
                  />
                  <span
                    className="usage-indicator"
                    title="本轮模型 Token 使用量；额度上限由服务端模型配置提供"
                  >
                    {lastUsage?.totalTokens ?? draftTokenEstimate} tokens
                    <span>{lastUsage ? "本轮" : "估算"}</span>
                    <span>额度待配置</span>
                  </span>
                  <SelectField
                    label="DSH 模式"
                    variant="quiet"
                    side="top"
                    align="end"
                    value={state.settings.mode}
                    onValueChange={(value) =>
                      patchSettings({ mode: value as DshMode })
                    }
                    options={DSH_MODE_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                      description: option.description,
                      icon:
                        option.value === "ptc" ? (
                          <Lightning size={18} />
                        ) : option.value === "minimal" ? (
                          <SlidersHorizontal size={18} />
                        ) : option.value === "creative" ? (
                          <Sparkle size={18} />
                        ) : (
                          <ChatCircle size={18} />
                        ),
                    }))}
                  />
                  <SelectField
                    label="工作区权限"
                    variant="quiet"
                    side="top"
                    align="end"
                    value={workspace?.access ?? "edit"}
                    onValueChange={(value) =>
                      patchWorkspace({ access: value as WorkspaceAccess })
                    }
                    options={WORKSPACE_ACCESS_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                      description: option.description,
                      icon: <ShieldCheck size={18} />,
                    }))}
                  />
                  <button
                    className="send"
                    aria-label="发送任务"
                    disabled={!text.trim() || busy}
                    onClick={() => void send()}
                  >
                    {busy ? (
                      <CircleNotch className="spin" size={21} />
                    ) : (
                      <ArrowUp size={22} />
                    )}
                  </button>
                </div>
              </div>
              <div className="composer-note">
                <HardDrives size={12} />
                记录保存在本机 · 调用时向所选服务发送必要内容
              </div>
            </div>
          </section>
          {preview && (
            <aside className="preview" style={{ width: `${previewWidth}%` }}>
              <div
                className="preview-resize"
                role="separator"
                aria-label="调整预览宽度"
                aria-orientation="vertical"
                aria-valuenow={previewWidth}
                aria-valuemin={25}
                aria-valuemax={60}
                tabIndex={0}
                onPointerDown={(e) =>
                  e.currentTarget.setPointerCapture(e.pointerId)
                }
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const layout =
                    e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
                  if (layout)
                    setPreviewWidth(
                      Math.min(
                        60,
                        Math.max(
                          25,
                          (100 * (layout.right - e.clientX)) / layout.width,
                        ),
                      ),
                    );
                }}
                onPointerUp={(e) =>
                  e.currentTarget.releasePointerCapture(e.pointerId)
                }
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    setPreviewWidth((v) =>
                      Math.min(
                        60,
                        Math.max(25, v + (e.key === "ArrowLeft" ? 2 : -2)),
                      ),
                    );
                  }
                }}
              />
              <header>
                <strong>成果预览</strong>
                <span className="bar-spacer" />
                <IconButton
                  label="全屏预览"
                  onClick={() => {
                    const pane =
                      document.querySelector<HTMLElement>(".preview");
                    const action = document.fullscreenElement
                      ? document.exitFullscreen()
                      : pane?.requestFullscreen();
                    void action?.catch(() =>
                      notify("无法进入全屏，请使用视图菜单的全屏功能。"),
                    );
                  }}
                >
                  <ArrowsOutSimple size={20} />
                </IconButton>
                <IconButton label="关闭预览" onClick={() => setPreview(null)}>
                  <X size={22} />
                </IconButton>
              </header>
              <div className="preview-tab">
                <Images size={18} />
                生成成果.png
              </div>
              <div className="preview-image">
                <img
                  src={preview}
                  alt="生成成果预览"
                  style={{ width: `${zoom}%` }}
                />
              </div>
              <div className="preview-controls">
                <Button onClick={() => setZoom((v) => Math.max(25, v - 25))}>
                  缩小
                </Button>
                <span>{zoom}%</span>
                <Button onClick={() => setZoom((v) => Math.min(200, v + 25))}>
                  放大
                </Button>
                <Button onClick={() => setZoom(100)}>适应窗口</Button>
              </div>
              <footer>
                <Button onClick={() => void saveImage(preview)}>
                  <DownloadSimple size={18} />
                  保存到本地
                </Button>
              </footer>
            </aside>
          )}
        </div>
      )}
      {page === "projects" && (
        <div className="page">
          <PageHeader
            action={
              <Button primary onClick={() => setProjectDialog(true)}>
                <Plus size={18} />
                新建项目
              </Button>
            }
          />
          {selectedProject ? (
            <>
              <Button onClick={() => setSelectedProject(null)}>
                <ArrowLeft size={17} />
                全部项目
              </Button>
              <div className="project-detail">
                <h2>
                  {state.projects.find((p) => p.id === selectedProject)?.name}
                </h2>
                <p>
                  {
                    state.projects.find((p) => p.id === selectedProject)
                      ?.description
                  }
                </p>
                <p className="muted">
                  个人项目保存在这台设备。共享项目服务与成员协作正在接入。
                </p>
                <Button
                  primary
                  onClick={() => {
                    setConversationId(null);
                    navigate("chat");
                  }}
                >
                  开始新任务
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="tabs">
                <button className="active">我的项目</button>
                <span className="tab-note">仅保存在本机</span>
              </div>
              <Search
                value={search}
                onChange={setSearch}
                placeholder="搜索项目"
              />
              {!state.projects.length ? (
                <Empty
                  icon={<Folder size={36} />}
                  title="把工作整理成项目"
                  detail="为一项长期工作建立独立空间，从个人项目开始。"
                  action={
                    <Button onClick={() => setProjectDialog(true)}>
                      新建第一个项目
                    </Button>
                  }
                />
              ) : (
                <div className="card-grid">
                  {state.projects
                    .filter((p) => p.name.includes(search))
                    .map((p) => (
                      <button
                        className="project-card"
                        key={p.id}
                        onClick={() => setSelectedProject(p.id)}
                      >
                        <Folder size={25} />
                        <h3>{p.name}</h3>
                        <p>{p.description || "暂无说明"}</p>
                        <small>个人项目 · 本机保存</small>
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {page === "knowledge" && (
        <div className="page">
          <PageHeader />
          <div className="tabs">
            <button className="active">公司资料</button>
            <span className="tab-note">按部门与资料权限开放</span>
          </div>
          <Empty
            icon={<BookOpen size={36} />}
            title="公司知识尚未连接"
            detail="NAS 地址、目录与访问账号配置后，会在这里展示你有权使用的资料。"
            action={
              user.role === "company_admin" ? (
                <Button onClick={() => navigate("admin-knowledge")}>
                  查看接入状态
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
      {page === "skills" && (
        <div className="page">
          <PageHeader
            action={
              <Button primary onClick={() => newDraft()}>
                <Plus size={18} />
                创建技能
              </Button>
            }
          />
          <div className="tabs">
            {[
              ["department", "本部门"],
              ["shared", "跨部门共享"],
              ["company", "全公司"],
              ["drafts", "我创建的"],
              ["installed", "已安装"],
            ].map(([id, label]) => (
              <button
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
                key={id}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="toolbar">
            <Search
              value={search}
              onChange={setSearch}
              placeholder="搜索技能名称或用途"
            />
            <span className="muted">{user.departmentName}</span>
            <Button
              onClick={() =>
                void props.refresh().catch((e) => notify(e.message))
              }
            >
              刷新
            </Button>
          </div>
          {filter === "drafts" ? (
            <>
              {!state.drafts.length ? (
                <Empty
                  icon={<Sparkle size={36} />}
                  title="把一次好成果变成可复用技能"
                  detail="选择自己的成功对话，提炼流程、测试，再主动提交到公司平台。"
                  action={
                    <Button onClick={() => newDraft()}>从对话创建</Button>
                  }
                />
              ) : (
                <div className="card-grid">
                  {state.drafts
                    .filter((d) => d.name.includes(search))
                    .map((d) => (
                      <button
                        className="skill-card"
                        key={d.id}
                        onClick={() => newDraft(d)}
                      >
                        <span className="card-icon">
                          <Sparkle size={23} />
                        </span>
                        <span className="badge">仅本机草稿</span>
                        <h3>{d.name || "未命名技能"}</h3>
                        <p>{d.description || "继续完善工作流程"}</p>
                        <small>v{d.version}</small>
                      </button>
                    ))}
                </div>
              )}
            </>
          ) : (
            <>
              {!filteredSkills.length ? (
                <Empty
                  icon={<Sparkle size={36} />}
                  title={
                    filter === "installed"
                      ? "还没有安装技能"
                      : "这里还没有可用技能"
                  }
                  detail="已批准且向你开放的技能会显示在这里，个人草稿保存在本机。"
                  action={
                    <Button onClick={() => newDraft()}>制作一个技能</Button>
                  }
                />
              ) : (
                <div className="card-grid">
                  {filteredSkills.map((skill) => (
                    <article className="skill-card" key={skill.id}>
                      <button
                        className="card-main"
                        onClick={() => setDetail(skill)}
                      >
                        <span className="card-icon">
                          <Sparkle size={23} />
                        </span>
                        <span className="badge">
                          {skill.ownerDepartmentName}
                        </span>
                        <h3>{skill.name}</h3>
                        <p>{skill.description}</p>
                      </button>
                      <footer>
                        <small>
                          {skill.authorName} · v{skill.version}
                        </small>
                        {state.installed.some((s) => s.id === skill.id) ? (
                          <Button
                            onClick={() => {
                              setActiveSkill(skill);
                              setConversationId(null);
                              navigate("chat");
                            }}
                          >
                            使用 <ArrowRight size={15} />
                          </Button>
                        ) : (
                          <Button onClick={() => void install(skill)}>
                            <DownloadSimple size={15} />
                            安装
                          </Button>
                        )}
                      </footer>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {page === "works" && (
        <div className="page">
          <PageHeader />
          {state.conversations.some((c) => c.messages.some((m) => m.image)) ? (
            <div className="card-grid">
              {state.conversations.flatMap((c) =>
                c.messages
                  .filter((m) => m.image)
                  .map((m) => (
                    <article className="work-card" key={m.id}>
                      <img src={m.image} alt={c.title} />
                      <h3>{c.title}</h3>
                      <Button onClick={() => void saveImage(m.image!)}>
                        保存到本地
                      </Button>
                      <Button
                        onClick={() => {
                          setConversationId(c.id);
                          navigate("chat");
                        }}
                      >
                        进入对话
                      </Button>
                    </article>
                  )),
              )}
            </div>
          ) : (
            <Empty
              icon={<Images size={36} />}
              title="你的创作会留在这里"
              detail="配置图片模型后，生成的成果会保存在当前设备的对话中。"
              action={
                <Button onClick={() => navigate("chat")}>开始创作</Button>
              }
            />
          )}
        </div>
      )}
      {page === "settings" && (
        <div className="settings-page">
          <nav className="settings-nav">
            <h2>设置</h2>
            <button className="active">
              <UserCircle size={18} />
              账号与偏好
            </button>
            <button onClick={() => navigate("models")}>
              <GearSix size={18} />
              模型与服务
            </button>
            <button onClick={props.exportRecords}>
              <HardDrives size={18} />
              导出本地记录
            </button>
          </nav>
          <section className="settings-content">
            <PageHeader />
            <h2>账号信息</h2>
            <div className="profile-heading">
              <UserCircle size={52} weight="duotone" />
              <div>
                <strong>{user.name}</strong>
                <small>
                  {user.departmentName} · {roleNames[user.role]}
                </small>
              </div>
              <Button onClick={props.openPassword}>修改密码</Button>
            </div>
            <div className="setting-row">
              <span>登录账号</span>
              <span>{user.username}</span>
            </div>
            <h2>工作偏好</h2>
            <div className="setting-row">
              <span>外观</span>
              <SelectField
                label="外观"
                value={state.settings.theme}
                onValueChange={(value) => patchSettings({ theme: value })}
                options={[
                  {
                    value: "light",
                    label: "浅色",
                    description: "明亮、温和的工作空间",
                    icon: <Sun size={18} />,
                  },
                  {
                    value: "dark",
                    label: "深色",
                    description: "适合低光环境的深色界面",
                    icon: <Moon size={18} />,
                  },
                ]}
              />
            </div>
            <div className="setting-row">
              <div>
                <span>本地文件</span>
                <small>
                  {window.brainDesktop
                    ? "已接通系统文件选择与目录选择；Agent 文件工具仍在接入"
                    : "可上传选定文件，本地目录助手尚未接通"}
                </small>
              </div>
              <Button
                onClick={() => {
                  if (window.brainDesktop) void chooseFiles();
                  else filesRef.current?.click();
                }}
              >
                选择文件
              </Button>
            </div>
            <h2>本地记录与备份</h2>
            <p className="muted">
              完整聊天和个人草稿保存在
              {window.brainDesktop ? "此电脑的应用数据目录" : "此浏览器本地"}
              ，按公司和员工账号隔离。换设备不自动同步。
              {!window.brainDesktop &&
                "清除站点数据或使用隐私模式可能丢失记录，请主动备份。"}
            </p>
            <div className="setting-row">
              <span>
                {state.conversations.length} 个对话 · {state.drafts.length}{" "}
                个草稿
              </span>
              <div className="inline-actions">
                <Button onClick={props.exportRecords}>导出备份</Button>
                <Button onClick={props.importRecords}>导入记录</Button>
              </div>
            </div>
            <small className="muted">
              备份包含已保存的对话、文本附件与内嵌图片；不包含公司密钥或本地路径所指向的外部文件。导入后需重新安装公司技能以校验权限。
            </small>
          </section>
        </div>
      )}
      {page === "models" && (
        <div className="page">
          <PageHeader
            action={
              user.role === "company_admin" ? (
                <Button onClick={() => navigate("admin-models")}>
                  管理公司连接
                </Button>
              ) : undefined
            }
          />
          <div className="tabs">
            <button className="active">公司提供</button>
            <span className="tab-note">
              当前接通 OpenAI 兼容的对话与图片接口
            </span>
          </div>
          {!connections.length ? (
            <Empty
              icon={<Plug size={36} />}
              title="还没有可用的模型连接"
              detail="管理员可自定义服务地址、密钥和模型标识，并按部门授权使用。"
              action={
                user.role === "company_admin" ? (
                  <Button primary onClick={() => navigate("admin-models")}>
                    添加模型连接
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="connection-list">
              {connections.map((c) => (
                <div className="connection-card" key={c.id}>
                  <span className="card-icon">
                    <Plug size={24} />
                  </span>
                  <div>
                    <h3>{c.name}</h3>
                    <p>
                      {c.model} · {c.kind === "chat" ? "对话" : "图片"}
                    </p>
                    <small>{c.baseUrl}</small>
                  </div>
                  <span className="badge">公司连接</span>
                  <Button
                    onClick={() => {
                      patchSettings({ model: c.id });
                      notify("已设置为所选用途的模型。");
                    }}
                  >
                    选用
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="notice">
            <SlidersHorizontal size={20} />
            <div>
              <strong>个人连接与更多服务协议</strong>
              <p>
                个人密钥的系统安全存储、Anthropic、视频及 MCP
                适配仍在接入；当前不保存个人明文密钥。
              </p>
            </div>
          </div>
        </div>
      )}
      <input
        hidden
        ref={filesRef}
        type="file"
        multiple
        onChange={(e) => {
          void chooseFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {skillDraft && (
        <SkillEditor
          {...props}
          initial={skillDraft}
          close={() => setSkillDraft(null)}
        />
      )}
      {detail && (
        <Modal wide title={detail.name} close={() => setDetail(null)}>
          <div className="skill-detail">
            <div className="inline-actions">
              <span className="badge">{detail.ownerDepartmentName}</span>
              <span className="badge">v{detail.version}</span>
            </div>
            <p>{detail.description}</p>
            <h3>工作流程</h3>
            <pre>{detail.instructions}</pre>
            <h3>测试摘要</h3>
            <p>{detail.testSummary}</p>
            {detail.examples && (
              <>
                <h3>作者提交的示例摘录</h3>
                <pre>{detail.examples}</pre>
              </>
            )}
            <p className="muted">
              {detail.requiredTools.length
                ? `依赖工具：${detail.requiredTools.join("、")}`
                : "此版本未声明外部工具依赖。"}
            </p>
            <footer>
              <Button
                onClick={() => {
                  download(
                    "SKILL.md",
                    `# ${detail.name}\n\n${detail.description}\n\n${detail.instructions}`,
                    "text/markdown",
                  );
                }}
              >
                导出 SKILL.md
              </Button>
              <Button primary onClick={() => void install(detail)}>
                安装到本机
              </Button>
            </footer>
          </div>
        </Modal>
      )}
      {projectDialog && (
        <Modal title="新建个人项目" close={() => setProjectDialog(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setState((s) => ({
                ...s,
                projects: [
                  {
                    id: crypto.randomUUID(),
                    name: String(data.get("name")),
                    description: String(data.get("description")),
                  },
                  ...s.projects,
                ],
              }));
              setProjectDialog(false);
              notify("项目已保存在本机。");
            }}
          >
            <Field label="项目名称">
              <input name="name" required maxLength={100} />
            </Field>
            <Field label="说明">
              <textarea name="description" rows={3} />
            </Field>
            <footer>
              <Button primary type="submit">
                创建项目
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {workspaceDialog && (
        <Modal title="添加工作区" close={() => setWorkspaceDialog(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const item = {
                id: crypto.randomUUID(),
                name: String(data.get("name")).trim(),
                description: String(data.get("description") ?? "").trim(),
                folder: null,
                access: "edit" as const,
              };
              setState((current) => ({
                ...current,
                workspaces: [item, ...current.workspaces],
                activeWorkspaceId: item.id,
              }));
              setWorkspaceDialog(false);
              notify("工作区已添加到本机。");
            }}
          >
            <Field label="工作区名称">
              <input
                name="name"
                required
                maxLength={100}
                placeholder="例如：safeChat"
              />
            </Field>
            <Field label="说明">
              <textarea
                name="description"
                rows={3}
                maxLength={500}
                placeholder="这个工作区用于什么任务？"
              />
            </Field>
            <footer>
              <Button primary type="submit">
                添加工作区
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
