import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type SetStateAction,
} from "react";
import UserMessageActions, { QuestionTime } from "./UserMessageActions";
import {
  Plus,
  ArrowUp,
  ArrowDown,
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
  FileText,
  CircleNotch,
  UserCircle,
  GearSix,
  HardDrives,
  Trash,
  ArrowRight,
  Plug,
  MagnifyingGlass,
  VideoCamera,
  ShieldCheck,
  Sun,
  Moon,
  Stop,
} from "@phosphor-icons/react";
import { SelectField } from "./Dropdown";
import SkillPicker from "./SkillPicker";
import ModelPicker from "./ModelPicker";
import { EmployeeModelServices } from "./ModelServices";
import {
  ChatProduction,
  ProductionLocation,
  ProductionWorks,
} from "./Production";
import { submitAutomaticProduction } from "./automatic";
import { productionReply } from "../shared/production-reply";
import type { AutomaticPlan } from "../shared/automatic";
import type { WorkspaceProps } from "./App";
import type {
  Draft,
  Skill,
  Conversation,
  Message,
  Connection,
  WorkspaceAccess,
} from "../shared/types";
import { WORKSPACE_ACCESS_OPTIONS } from "../shared/workspaces";
import { api, download } from "./api";
import {
  Brand,
  BrandMark,
  Button,
  IconButton,
  Modal,
  Empty,
  Search,
  Field,
} from "./components";
import SkillEditor from "./SkillEditor";
import SkillImport, { SkillSourceDetails } from "./SkillImport";
import ChatLoading, { ThinkingProcess, type PendingReply } from "./ChatLoading";
import GrokBall from "./GrokBall";
import { streamChat } from "./chat-stream";
import {
  updateTrace,
  type ChatTrace,
  type TraceItem,
} from "../shared/chat-progress";
import MessageContent from "./MessageContent";
import MessageActions from "./MessageActions";
import { getSkin } from "../shared/skins";
import { useChatScroll } from "./useChatScroll";
import Knowledge from "./Knowledge";
import { readAttachment } from "./attachments";
import { workspaceAttachments as prepareWorkspaceAttachments } from "../shared/workspace-context";
import {
  ATTACHMENT_ACCEPT,
  modelAttachments as toModelAttachments,
  visualInputs,
  validateAttachmentBudget,
  unsupportedDeepSeekVision,
  type Attachment,
} from "../shared/attachments";
import "./attachments.css";
import Profile, { Avatar } from "./Profile";

type ComposerDraft = {
  text: string;
  attachments: Attachment[];
  reading: { name: string; status: string } | null;
};
const emptyDraft: ComposerDraft = { text: "", attachments: [], reading: null };
type ChatRun = {
  controller: AbortController;
  done: Promise<void>;
  taskId?: string;
  reply?: Message;
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
  const conversation = state.conversations.find((c) => c.id === conversationId);
  const workspace =
    state.workspaces.find(
      (item) =>
        item.id === (conversation?.workspaceId ?? state.activeWorkspaceId),
    ) ?? state.workspaces[0];
  const draftKey = conversationId ?? `new:${workspace?.id ?? "default"}`;
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft>>({});
  const { text, attachments, reading } = drafts[draftKey] ?? emptyDraft;
  const patchDraft = (value: Partial<ComposerDraft>) =>
    setDrafts((all) => ({
      ...all,
      [draftKey]: { ...(all[draftKey] ?? emptyDraft), ...value },
    }));
  const setText = (text: string) => patchDraft({ text });
  const setReading = (reading: ComposerDraft["reading"]) =>
    patchDraft({ reading });
  const setAttachments = (value: SetStateAction<Attachment[]>) =>
    setDrafts((all) => {
      const draft = all[draftKey] ?? emptyDraft;
      return {
        ...all,
        [draftKey]: {
          ...draft,
          attachments:
            typeof value === "function" ? value(draft.attachments) : value,
        },
      };
    });
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("department");
  const [preview, setPreview] = useState<string | null>(null),
    [previewWidth, setPreviewWidth] = useState(42),
    [zoom, setZoom] = useState(100),
    [skillDraft, setSkillDraft] = useState<Draft | null>(null),
    [detail, setDetail] = useState<Skill | null>(null);
  const [projectDialog, setProjectDialog] = useState(false),
    [importSkill, setImportSkill] = useState(false),
    [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [pendingReplies, setPendingReplies] = useState<
    Record<string, PendingReply>
  >({});
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const pendingReply = pendingReplies[conversationId ?? ""];
  const taskError = taskErrors[conversationId ?? ""];
  const busy = !!pendingReply;
  const originalFiles = useRef(new Map<string, Map<string, File>>());
  function filesFor(key: string) {
    if (!originalFiles.current.has(key))
      originalFiles.current.set(key, new Map());
    return originalFiles.current.get(key)!;
  }
  const filesRef = useRef<HTMLInputElement>(null);
  const fileReads = useRef(new Map<string, AbortController>());
  const [attachmentPreview, setAttachmentPreview] = useState<Attachment | null>(
    null,
  );
  const {
    containerRef: messagesRef,
    contentRef,
    showLatest,
    jumpToLatest,
  } = useChatScroll(page === "chat" ? (conversationId ?? "new") : null);
  const activeRequests = useRef(new Map<string, ChatRun>());
  const stoppingRefs = useRef(new Set<string>());
  const [stoppingIds, setStoppingIds] = useState<Record<string, boolean>>({});
  const stopping = !!stoppingIds[conversationId ?? ""];
  const followUpRefs = useRef(new Set<string>());
  const [followUpIds, setFollowUpIds] = useState<Record<string, boolean>>({});
  const followUp = !!followUpIds[conversationId ?? ""];
  const creatingChat = useRef(false);
  const currentView = useRef({ page, conversationId, draftKey, state });
  currentView.current = { page, conversationId, draftKey, state };
  useEffect(() => {
    creatingChat.current = false;
  }, [conversationId]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const run of activeRequests.current.values()) run.controller.abort();
      for (const controller of fileReads.current.values()) controller.abort();
    };
  }, []);
  useEffect(() => {
    setState((current) => {
      let changed = false;
      const conversations = current.conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => {
          if (!message.productionTaskId) return message;
          const task = props.production.tasks.find(
            (task) => task.id === message.productionTaskId,
          );
          const reply = productionReply(message, task);
          if (
            reply.content === message.content &&
            JSON.stringify(reply.trace) === JSON.stringify(message.trace)
          )
            return message;
          changed = true;
          return reply;
        }),
      }));
      return changed ? { ...current, conversations } : current;
    });
  }, [props.production.tasks, setState]);
  const activeTasks = props.production.tasks.filter(
    (task) =>
      [
        "uploading",
        "queued",
        "planning",
        "generating",
        "rendering",
        "verifying",
      ].includes(task.status) &&
      conversation?.messages.some(
        (message) => message.productionTaskId === task.id,
      ),
  );
  const currentBusy = busy || activeTasks.length > 0;
  async function stopCurrent() {
    if (!conversation || stoppingRefs.current.has(conversation.id))
      return false;
    const id = conversation.id;
    stoppingRefs.current.add(id);
    setStoppingIds((all) => ({ ...all, [id]: true }));
    const run = activeRequests.current.get(id);
    const ids = new Set(activeTasks.map((task) => task.id));
    try {
      run?.controller.abort();
      await run?.done;
      if (!mounted.current) return false;
      if (run?.taskId) ids.add(run.taskId);
      for (const id of ids) {
        if (!(await props.production.action(id, "cancel")))
          throw Error(
            "未能确认任务已中止，请检查连接后重试；补充要求尚未发送。",
          );
      }
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
    } finally {
      stoppingRefs.current.delete(id);
      if (mounted.current) setStoppingIds((all) => ({ ...all, [id]: false }));
    }
  }
  async function submit() {
    if (
      stoppingRefs.current.has(conversationId ?? "") ||
      followUpRefs.current.has(conversationId ?? "") ||
      (!text.trim() && !attachments.length)
    )
      return;
    if (!currentBusy) return send();
    const id = conversation!.id;
    const run = activeRequests.current.get(id);
    followUpRefs.current.add(id);
    setFollowUpIds((all) => ({ ...all, [id]: true }));
    try {
      if (await stopCurrent()) {
        // The captured composer belongs to this conversation even after navigation.
        const next = send(run?.reply);
        followUpRefs.current.delete(id);
        setFollowUpIds((all) => ({ ...all, [id]: false }));
        await next;
      }
    } finally {
      followUpRefs.current.delete(id);
      if (mounted.current) setFollowUpIds((all) => ({ ...all, [id]: false }));
    }
  }
  const taskModels = connections.filter((c) => c.enabled && c.kind === "chat");
  const model =
    taskModels.find((c) => c.id === state.settings.model) ?? taskModels[0];
  const installedSkills = [
    ...skills.filter((skill) => skill.capability?.kind === "image"),
    ...state.installed
      .filter((saved) => !saved.capability)
      .flatMap((saved) => {
        const current = skills.find(
          (skill) => skill.id === saved.id && skill.status === "published",
        );
        return current ? [current] : [];
      }),
  ];
  const skillMode = state.settings.skillMode ?? "auto";
  const selectedSkillIds = (state.settings.skillIds ?? []).filter((id) =>
    installedSkills.some((skill) => skill.id === id),
  );
  const selectedSkills =
    skillMode === "manual"
      ? selectedSkillIds.map((id) =>
          installedSkills.find((skill) => skill.id === id)!,
        )
      : [];
  useEffect(() => {
    setPreview(null);
    setSearch("");
    setAttachmentPreview(null);
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
  function localFolderMention(value: string) {
    const match = value.match(
      /(?:[A-Za-z]:\\|\\\\)[^<>:"/|?*\r\n，。！？,!?]+/,
    );
    return match?.[0].replace(/[\s，。,.!?！？]+$/g, "").trim() || null;
  }
  async function readWorkspaceContext(
    requestText: string,
    existing: Attachment[],
  ) {
    if (!window.brainDesktop) return [];
    const folder = localFolderMention(requestText) ?? workspace?.folder;
    if (!folder) return [];
    const snapshot = await window.brainDesktop.inspectWorkspace(folder);
    return prepareWorkspaceAttachments(snapshot, existing);
  }
  async function chooseFiles(files?: FileList | File[] | null) {
    if (fileReads.current.has(draftKey) || busy || stopping || followUp) {
      notify("请等待当前处理完成后再添加文件。");
      return;
    }
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    if (attachments.length + selected.length > 8) {
      notify("一次最多添加 8 个文件，请分批选择。");
      return;
    }
    const controller = new AbortController();
    fileReads.current.set(draftKey, controller);
    let accepted = [...attachments];
    const errors: string[] = [];
    try {
      for (const file of selected) {
        if (controller.signal.aborted) break;
        setReading({ name: file.name, status: "准备读取…" });
        try {
          const result = await readAttachment(
            file,
            (status) => {
              if (mounted.current && !controller.signal.aborted)
                setReading({ name: file.name, status });
            },
            AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
          );
          controller.signal.throwIfAborted();
          validateAttachmentBudget([...accepted, result]);
          accepted = [...accepted, result];
          filesFor(draftKey).set(result.name, file);
          if (mounted.current) setAttachments(accepted);
        } catch (error) {
          if (!controller.signal.aborted)
            errors.push(`${file.name}：${(error as Error).message}`);
        }
      }
    } finally {
      if (fileReads.current.get(draftKey) === controller)
        fileReads.current.delete(draftKey);
      if (mounted.current) {
        setReading(null);
        if (errors.length) notify(errors.join("\n"));
      }
    }
  }
  async function send(precedingReply?: Message) {
    if (
      (!text.trim() && !attachments.length) ||
      !mounted.current ||
      activeRequests.current.has(conversationId ?? "") ||
      stoppingRefs.current.has(conversationId ?? "") ||
      (!conversationId && creatingChat.current) ||
      fileReads.current.has(draftKey)
    )
      return;
    const requestText =
      text.trim() || "请分析这些附件，说明主要内容和需要注意的问题。";
    const currentAttachments = attachments.length
      ? attachments
      : (conversation?.messages.findLast(
          (m) => m.role === "user" && m.attachments?.length,
        )?.attachments ?? []);
    const materialFiles = currentAttachments.map((attachment) =>
      filesFor(draftKey).get(attachment.name),
    );
    if (
      currentView.current.page === "chat" &&
      currentView.current.draftKey === draftKey
    )
      jumpToLatest();
    let current =
      currentView.current.state.conversations.find(
        (c) => c.id === conversationId,
      ) ?? conversation;
    if (
      current &&
      precedingReply &&
      !current.messages.some((m) => m.id === precedingReply.id)
    )
      current = { ...current, messages: [...current.messages, precedingReply] };
    if (!current) {
      creatingChat.current = true;
      current = {
        id: crypto.randomUUID(),
        workspaceId: workspace?.id,
        title: (text.trim() || attachments[0]?.name || "附件分析").slice(0, 32),
        messages: [],
        createdAt: new Date().toISOString(),
      };
      originalFiles.current.set(current.id, new Map(filesFor(draftKey)));
      originalFiles.current.delete(draftKey);
      setConversationId(current.id);
    }
    const replyId = current.id;
    const setTaskError = (error: string) =>
      setTaskErrors((all) => ({ ...all, [replyId]: error }));
    const setPendingReply = (value: SetStateAction<PendingReply | null>) =>
      setPendingReplies((all) => {
        const pending =
          typeof value === "function" ? value(all[replyId] ?? null) : value;
        const next = { ...all };
        if (pending) next[replyId] = pending;
        else delete next[replyId];
        return next;
      });
    setTaskError("");
    const sentAttachments = attachments.map((attachment) => ({
      ...attachment,
    }));
    const content =
      requestText + sentAttachments.map((a) => `\n\n附件：${a.name}`).join("");
    const message: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      promptText: requestText,
      attachments: sentAttachments,
      at: new Date().toISOString(),
    };
    const updated = { ...current, messages: [...current.messages, message] };
    setState((s) => ({
      ...s,
      conversations: s.conversations.some((c) => c.id === updated.id)
        ? s.conversations.map((c) =>
            c.id === updated.id
              ? { ...c, messages: [...c.messages, message] }
              : c,
          )
        : [updated, ...s.conversations],
    }));
    setText("");
    setAttachments([]);
    if (!model) {
      setTaskError(
        "尚未配置可用模型。这条需求已保存在本机，请在模型与服务中配置后继续。",
      );
      return;
    }
    const controller = new AbortController();
    let complete!: () => void;
    const run: ChatRun = {
      controller,
      done: new Promise<void>((resolve) => {
        complete = resolve;
      }),
      taskId: undefined as string | undefined,
    };
    activeRequests.current.set(updated.id, run);
    const startedAt = Date.now();
    let items: TraceItem[] = [],
      partial = "";
    let responseModel = model,
      productionTaskId: string | undefined;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    const saveReply = (
      content: string,
      status: ChatTrace["status"],
      image?: string,
      usage?: Message["usage"],
    ) => {
      if (!mounted.current) return;
      const result: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        image,
        connectionId: responseModel.id,
        modelName: responseModel.name,
        productionTaskId,
        usage,
        at: new Date().toISOString(),
        trace: {
          items: items.map((item) =>
            item.type === "tool" && item.status === "running"
              ? { ...item, status: "stopped" as const }
              : item,
          ),
          status,
          elapsed: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
        },
      };
      run.reply = result;
      setState((s) => ({
        ...s,
        conversations: s.conversations.map((c) =>
          c.id === updated.id ? { ...c, messages: [...c.messages, result] } : c,
        ),
      }));
    };
    setPendingReply({
      conversationId: updated.id,
      phase: "preparing",
      kind: "chat",
      modelName: model.name,
      startedAt,
      items: [],
      content: "",
    });
    try {
      const history = updated.messages
        .slice(-40)
        .filter((message) => message.content.trim())
        .map((message) => ({
          role: message.role,
          content:
            message.id === updated.messages.at(-1)?.id
              ? requestText
              : message.content.slice(0, 80000),
        }));
      const routingId = crypto.randomUUID();
      const progress = (
        event: import("../shared/chat-progress").ChatProgress,
      ) => {
        if (controller.signal.aborted) return;
        items = updateTrace(items, event);
        if (event.type === "text") partial = event.text;
        if (!progressTimer)
          progressTimer = setTimeout(() => {
            progressTimer = undefined;
            if (mounted.current && !controller.signal.aborted)
              setPendingReply((current) =>
                current?.conversationId === updated.id
                  ? { ...current, items, content: partial }
                  : current,
              );
          }, 50);
      };
      progress({
        type: "tool",
        id: routingId,
        name: "识别需求并选择能力",
        status: "running",
      });
      const plan = await api<AutomaticPlan>(
        "/generate/plan",
        {
          connectionId: model.id,
          messages: history,
          attachments: currentAttachments.map(({ name }) => ({ name })),
          workspaceAccess: workspace?.access ?? "edit",
          skillMode,
          imageSkills: true,
          skillIds:
            skillMode === "auto"
              ? installedSkills.map((skill) => skill.id)
              : selectedSkillIds,
        },
        "POST",
        50000,
        controller.signal,
      );
      progress({
        type: "tool",
        id: routingId,
        name: "识别需求并选择能力",
        status: "done",
      });
      if (plan.skillIds?.length)
        progress({
          type: "tool",
          id: crypto.randomUUID(),
          name:
            "已选用技能：" +
            plan.skillIds
              .map(
                (id) =>
                  installedSkills.find((skill) => skill.id === id)?.name ??
                  "技能",
              )
              .join("、"),
          status: "done",
        });
      responseModel =
        connections.find((connection) => connection.id === plan.connectionId) ??
        model;
      const workspaceAttachments =
        plan.kind !== "image" && currentAttachments.length < 8
          ? await readWorkspaceContext(requestText, currentAttachments)
          : [];
      controller.signal.throwIfAborted();
      if (workspaceAttachments.length)
        progress({
          type: "tool",
          id: crypto.randomUUID(),
          name: `已读取本地目录：${workspaceAttachments[0].summary}${workspaceAttachments[0].warnings?.length ? " 有未读取范围" : ""}`,
          status: "done",
        });
      if (plan.kind === "video" || plan.kind === "code") {
        if (materialFiles.some((file) => !file))
          throw Error(
            "请重新添加原始素材后发送；当前只有历史解析记录，不能代替原文件参与制作。",
          );
        const materials = materialFiles as File[];
        const context = workspaceAttachments.find(
          (attachment) => attachment.content,
        );
        if (context)
          materials.push(
            new File(
              [toModelAttachments([context])[0].content],
              `workspace-context-${crypto.randomUUID().slice(0, 8)}.md`,
              { type: "text/markdown" },
            ),
          );
        const task = await submitAutomaticProduction(
          user.id,
          plan,
          `${requestText}\n\n此前对话供参考：\n${history
            .slice(-5, -1)
            .map(
              (message) => `${message.role}：${message.content.slice(0, 2000)}`,
            )
            .join("\n")}`,
          materials,
          controller.signal,
          (task) => {
            productionTaskId = task.id;
            run.taskId = task.id;
            props.production.track(task);
          },
          workspace?.folder,
        );
        controller.signal.throwIfAborted();
        productionTaskId = task.id;
        saveReply("", "done");
        await props.production.refresh();
        return;
      }
      if (plan.kind === "image") {
        const toolId = crypto.randomUUID();
        progress({
          type: "tool",
          id: toolId,
          name: "图片创作",
          status: "running",
        });
        setPendingReply((current) =>
          current
            ? {
                ...current,
                kind: "image",
                phase: "waiting",
                modelName: responseModel.name,
              }
            : null,
        );
        const response = await api<{ image: string }>(
          "/generate/image",
          {
            connectionId: plan.connectionId,
            skillIds: plan.skillIds ?? [],
            prompt: `${requestText}\n\n对话参考：\n${history
              .slice(-4, -1)
              .map((message) => message.content.slice(0, 1500))
              .join("\n")}`.slice(0, 12000),
          },
          "POST",
          130000,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        progress({
          type: "tool",
          id: toolId,
          name: "图片创作",
          status: "done",
        });
        saveReply("图片已生成。", "done", response.image);
        return;
      }
      const modelAttachments = toModelAttachments([
        ...currentAttachments,
        ...workspaceAttachments.slice(
          0,
          Math.max(0, 8 - currentAttachments.length),
        ),
      ]);
      validateAttachmentBudget(modelAttachments);
      if (
        modelAttachments.some(
          (attachment) => visualInputs(attachment).length,
        ) &&
        unsupportedDeepSeekVision(responseModel.baseUrl, responseModel.model)
      ) {
        const vision = taskModels.find(
          (connection) =>
            !unsupportedDeepSeekVision(connection.baseUrl, connection.model),
        );
        if (!vision)
          throw Error(
            "附件或项目文件夹包含画面，但当前没有可识图的模型，请联系管理员配置。",
          );
        responseModel = vision;
      }
      const outputDevice = window.brainDesktop?.production
        ? await window.brainDesktop.production.state(user.id)
        : undefined;
      setPendingReply((current) =>
        current
          ? { ...current, phase: "waiting", modelName: responseModel.name }
          : null,
      );
      controller.signal.throwIfAborted();
      const response = await streamChat(
        {
          connectionId: responseModel.id,
          ...(outputDevice ? { deviceId: outputDevice.deviceId } : {}),
          ...(plan.imageSkillId ? { imageSkillId: plan.imageSkillId } : {}),
          skillIds: plan.skillIds ?? [],
          sessionId: updated.id,
          messages: [
            ...updated.messages
              .slice(-40)
              .filter((m) => m.content.trim())
              .map((m) => ({
                role: m.role,
                content:
                  m.id === message.id
                    ? requestText
                    : (
                        m.content +
                        (m.role === "user" && m.attachments?.length
                          ? "\n\n此前附件文字：\n" +
                            m.attachments
                              .map((a) => `${a.name}\n${a.content}`)
                              .join("\n")
                              .slice(0, 40000)
                          : "")
                      ).slice(0, 80000),
              })),
          ],
          attachments: modelAttachments,
          mode: plan.mode,
          workspaceAccess: workspace?.access ?? "edit",
        },
        controller.signal,
        progress,
      );
      controller.signal.throwIfAborted();
      productionTaskId = response.productionTaskId;
      if (productionTaskId) await props.production.refresh();
      saveReply(
        response.content ?? "图片已生成，可以继续保存。",
        "done",
        response.image,
        response.usage,
      );
    } catch (e) {
      saveReply(partial, controller.signal.aborted ? "stopped" : "error");
      if (!controller.signal.aborted && mounted.current)
        setTaskError((e as Error).message);
    } finally {
      if (progressTimer) clearTimeout(progressTimer);
      if (activeRequests.current.get(updated.id) === run)
        activeRequests.current.delete(updated.id);
      setPendingReply(null);
      complete();
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
        notify("当前项目为仅可查看，先切换到项目内修改或完全权限。");
        return;
      }
      const extension = image.startsWith("data:image/jpeg;")
        ? "jpg"
        : image.startsWith("data:image/webp;")
          ? "webp"
          : "png";
      const name = `公司大脑-${Date.now()}.${extension}`;
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
    filter === "installed" ? installedSkills : skills
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
            <div
              className="messages"
              ref={messagesRef}
              data-chat-scroll="conversation"
              tabIndex={0}
              role="region"
              aria-label="对话内容"
            >
              <div className="messages-content" ref={contentRef}>
                {!conversation?.messages.length && (
                  <div className="chat-welcome">
                    <BrandMark className="welcome-brand-mark" />
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
                  <Fragment key={message.id}>
                    {message.role === "user" && (
                      <QuestionTime at={message.at} />
                    )}
                    <div className={`message ${message.role}`}>
                      <span className="message-avatar">
                        {message.role === "user" ? (
                          <Avatar user={user} size={30} />
                        ) : message.trace ? (
                          <GrokBall
                            emotion="19"
                            size={36}
                            active={
                              !!message.productionTaskId &&
                              props.production.tasks.some(
                                (task) =>
                                  task.id === message.productionTaskId &&
                                  !["saved", "failed", "cancelled"].includes(
                                    task.status,
                                  ),
                              )
                            }
                          />
                        ) : (
                          <Sparkle size={25} weight="fill" />
                        )}
                      </span>
                      <div className="message-body">
                        {message.trace && !message.productionTaskId && (
                          <ThinkingProcess
                            items={message.trace.items}
                            status={message.trace.status}
                            elapsed={message.trace.elapsed}
                          />
                        )}
                        {!message.productionTaskId && (
                          <MessageContent content={message.content} />
                        )}
                        {message.productionTaskId && (
                          <ChatProduction
                            id={message.productionTaskId}
                            controller={props.production}
                            message={message}
                          />
                        )}
                        {!!message.attachments?.length && (
                          <div className="message-attachments">
                            {message.attachments.map((a, index) => (
                              <button
                                key={index}
                                onClick={() => setAttachmentPreview(a)}
                                title={a.name}
                              >
                                {a.image || a.images?.[0] ? (
                                  <img
                                    src={a.image ?? a.images?.[0].image}
                                    alt={a.name}
                                  />
                                ) : (
                                  <FileText size={26} />
                                )}
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
                        {message.role === "assistant" && (
                          <MessageActions
                            message={message}
                            conversation={conversation}
                            notify={notify}
                            save={(feedback) =>
                              setState((s) => ({
                                ...s,
                                conversations: s.conversations.map((c) =>
                                  c.id === conversation.id
                                    ? {
                                        ...c,
                                        messages: c.messages.map((m) =>
                                          m.id === message.id
                                            ? { ...m, feedback }
                                            : m,
                                        ),
                                      }
                                    : c,
                                ),
                              }))
                            }
                          />
                        )}
                      </div>
                      {message.role === "user" && (
                        <UserMessageActions message={message} notify={notify} />
                      )}
                    </div>
                  </Fragment>
                ))}
                {pendingReply &&
                  pendingReply.conversationId === conversation?.id && (
                    <ChatLoading request={pendingReply} />
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
            </div>
            <div className="composer-wrap">
              {showLatest && (
                <button
                  className="chat-jump-latest"
                  type="button"
                  onClick={jumpToLatest}
                >
                  <ArrowDown size={16} />
                  回到最新内容
                </button>
              )}
              {!conversation?.messages.length && (
                <div className="workspace-start-controls">
                  <SelectField
                    label="工作区"
                    variant="quiet"
                    side="top"
                    value={workspace?.id ?? null}
                    disabled={busy}
                    onValueChange={(value) =>
                      setState((s) => ({ ...s, activeWorkspaceId: value }))
                    }
                    icon={<Folder size={17} />}
                    options={state.workspaces.map((w) => ({
                      value: w.id,
                      label: w.name,
                    }))}
                    action={{
                      label: "新建工作区…",
                      onClick: () => void props.createWorkspace(),
                    }}
                  />
                </div>
              )}
              <div
                className="composer"
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("Files"))
                    e.preventDefault();
                }}
                onDrop={(e) => {
                  if (e.dataTransfer.files.length) {
                    e.preventDefault();
                    void chooseFiles(e.dataTransfer.files);
                  }
                }}
              >
                {(attachments.length > 0 || selectedSkills.length > 0) && (
                  <div className="attachment-row">
                    {attachments.map((a, index) => (
                      <span className="chip attachment-chip" key={index}>
                        <button
                          type="button"
                          onClick={() => setAttachmentPreview(a)}
                          title={`查看 ${a.name}`}
                        >
                          {a.kind === "video" ? (
                            <VideoCamera size={16} />
                          ) : (
                            <Paperclip size={15} />
                          )}
                          <span>
                            {a.name}
                            <small>
                              {a.summary ?? "已读取"}
                              {a.warnings?.length ? " · 有读取范围说明" : ""}
                            </small>
                          </span>
                        </button>
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
                    {selectedSkills.map((skill) => (
                      <span className="chip accent" key={skill.id}>
                        <Sparkle size={15} />
                        {skill.name}
                        <IconButton
                          label={`移除技能 ${skill.name}`}
                          onClick={() =>
                            patchSettings({
                              skillMode: "manual",
                              skillIds: selectedSkillIds.filter(
                                (id) => id !== skill.id,
                              ),
                            })
                          }
                        >
                          <X size={12} />
                        </IconButton>
                      </span>
                    ))}
                  </div>
                )}
                {reading && (
                  <div className="attachment-reading" role="status">
                    <CircleNotch className="spin" size={17} />
                    <span>
                      {reading.name}
                      <small>{reading.status}</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => fileReads.current.get(draftKey)?.abort()}
                    >
                      取消读取
                    </button>
                  </div>
                )}
                <textarea
                  aria-label="任务输入"
                  placeholder={
                    currentBusy
                      ? "补充要求，发送后将中止当前执行并继续"
                      : "直接描述需求，AI 会自动选择所需能力"
                  }
                  disabled={stopping || !!followUp}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={(e) => {
                    if (e.clipboardData.files.length) {
                      e.preventDefault();
                      void chooseFiles(e.clipboardData.files);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                />
                <div className="composer-tools">
                  <IconButton
                    label="添加文件"
                    disabled={!!reading || busy}
                    onClick={() => filesRef.current?.click()}
                  >
                    <Plus size={23} />
                  </IconButton>
                  <SkillPicker
                    skills={installedSkills}
                    mode={skillMode}
                    selected={selectedSkillIds}
                    disabled={busy}
                    change={(skillMode, skillIds) =>
                      patchSettings({ skillMode, skillIds })
                    }
                    manage={() => navigate("skills")}
                  />
                  <span
                    className="composer-automatic"
                    title="按需求自动调用对话、图片、视频和代码能力"
                  >
                    <Sparkle size={18} />
                    AI 自动
                  </span>
                  <span className="bar-spacer" />
                  <ModelPicker
                    connections={taskModels}
                    value={model?.id ?? null}
                    change={(value) => patchSettings({ model: value })}
                    manage={() => navigate("models")}
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
                  <div className="composer-actions">
                    {currentBusy && (
                      <button
                        type="button"
                        className="send stop"
                        aria-label={stopping ? "正在中止" : "中止回复"}
                        title="中止当前执行，保留已收到的内容"
                        disabled={
                          stopping ||
                          activeTasks.some(
                            (task) => props.production.actionBusy[task.id],
                          )
                        }
                        onClick={() => void stopCurrent()}
                      >
                        {stopping ? (
                          <CircleNotch className="spin" size={21} />
                        ) : (
                          <Stop size={19} weight="fill" />
                        )}
                      </button>
                    )}
                    {(!currentBusy ||
                      text.trim() ||
                      attachments.length > 0) && (
                      <button
                        className="send"
                        aria-label={currentBusy ? "发送补充要求" : "发送任务"}
                        title={
                          currentBusy ? "中止当前执行并按补充要求继续" : "发送"
                        }
                        disabled={
                          (!text.trim() && !attachments.length) ||
                          !!reading ||
                          stopping ||
                          !!followUp
                        }
                        onClick={() => void submit()}
                      >
                        <ArrowUp size={22} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="composer-note">
                <HardDrives size={12} />
                支持 Word、PDF、表格、图片与短视频 · Office 由公司服务临时解析
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
          <Knowledge
            admin={user.role === "company_admin"}
            navigate={navigate}
          />
        </div>
      )}
      {page === "skills" && (
        <div className="page">
          <PageHeader
            action={
              <div className="inline-actions">
                <Button onClick={() => setImportSkill(true)}>
                  <DownloadSimple size={18} />
                  导入技能
                </Button>
                <Button primary onClick={() => newDraft()}>
                  <Plus size={18} />
                  创建技能
                </Button>
              </div>
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
                        {skill.imported && (
                          <small className="muted">
                            {skill.imported.kind === "github"
                              ? "GitHub 导入"
                              : skill.imported.kind === "url"
                                ? "链接导入"
                                : "ZIP 导入"}{" "}
                            ·{" "}
                            {skill.imported.hasScripts
                              ? "配套脚本已保存，运行依赖待核对"
                              : "流程与资料已就绪"}
                          </small>
                        )}
                      </button>
                      <footer>
                        <small>
                          {skill.authorName} · v{skill.version}
                        </small>
                        {skill.capability ||
                        state.installed.some((s) => s.id === skill.id) ? (
                          <div className="inline-actions">
                            <Button
                              onClick={() => {
                                patchSettings({
                                  skillMode: "manual",
                                  skillIds: [skill.id],
                                });
                                setConversationId(null);
                                navigate("chat");
                              }}
                            >
                              使用 <ArrowRight size={15} />
                            </Button>
                            {filter === "installed" && !skill.capability && (
                              <Button
                                onClick={() => {
                                  setState((s) => ({
                                    ...s,
                                    installed: s.installed.filter(
                                      (item) => item.id !== skill.id,
                                    ),
                                    settings: {
                                      ...s.settings,
                                      skillIds: (
                                        s.settings.skillIds ?? []
                                      ).filter((id) => id !== skill.id),
                                    },
                                  }));
                                  notify(
                                    "已从本机安装列表移除，公司的共享技能保持可用。",
                                  );
                                }}
                              >
                                移除
                              </Button>
                            )}
                          </div>
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
          <ProductionWorks controller={props.production} />
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
            <button onClick={() => navigate("skins")}>
              <Images size={18} />
              皮肤中心
            </button>
            <button onClick={props.exportRecords}>
              <HardDrives size={18} />
              导出本地记录
            </button>
          </nav>
          <section className="settings-content">
            <PageHeader />
            <h2>账号信息</h2>
            <Profile
              user={user}
              onSaved={props.updateUser}
              openPassword={props.openPassword}
              notify={notify}
            />
            <div className="setting-row">
              <span>登录账号</span>
              <span>{user.username}</span>
            </div>
            <h2>工作偏好</h2>
            <ProductionLocation controller={props.production} />
            <div className="setting-row">
              <div>
                <span>界面皮肤 · {getSkin(state.settings.skin).name}</span>
                <small>62 款可选，默认 Claude，按账号保存在本机</small>
              </div>
              <Button onClick={() => navigate("skins")}>选择皮肤</Button>
            </div>
            <div className="setting-row">
              <div>
                <span>外观</span>
                <small>默认使用暖浅色；深色同时应用于下次启动动画</small>
              </div>
              <SelectField
                label="外观"
                value={state.settings.theme}
                onValueChange={(value) => patchSettings({ theme: value })}
                options={[
                  {
                    value: "default",
                    label: "默认（浅色）",
                    description: "始终使用暖浅色，不跟随系统切换",
                    icon: <Sun size={18} />,
                  },
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
            {window.brainDesktop?.previewStartup && (
              <div className="setting-row">
                <div>
                  <span>启动动画</span>
                  <small>DSH 技术档案风格 · 跟随外观设置 · 可随时跳过</small>
                </div>
                <Button
                  onClick={() =>
                    void window.brainDesktop
                      ?.writeAppearance?.(state.settings.theme)
                      .then(() => window.brainDesktop?.previewStartup?.())
                      .catch(() => notify("启动动画暂时无法预览，请稍后重试。"))
                  }
                >
                  预览启动动画
                </Button>
              </div>
            )}
            <div className="setting-row">
              <div>
                <span>本地文件</span>
                <small>
                  {window.brainDesktop
                    ? "已接通系统文件选择与项目文件夹只读扫描"
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
          <EmployeeModelServices
            refresh={props.refresh}
            notify={notify}
            revision={connections}
          />
          <div className="tabs">
            <button className="active">公司提供</button>
            <span className="tab-note">
              对话模型与图片生成技能由公司统一提供
            </span>
          </div>
          {!connections.filter((c) => !c.personal).length ? (
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
              {connections
                .filter((c) => !c.personal)
                .map((c) => (
                  <div className="connection-card" key={c.id}>
                    <span className="card-icon">
                      <Plug size={24} />
                    </span>
                    <div>
                      <h3>{c.name}</h3>
                      <p>
                        {c.model} ·{" "}
                        {c.kind === "chat" ? "对话" : "图片生成技能"}
                      </p>
                      <small>{c.baseUrl}</small>
                    </div>
                    <span className="badge">公司连接</span>
                    <Button
                      onClick={() => {
                        if (c.kind === "image") {
                          patchSettings({
                            skillMode: "manual",
                            skillIds: [
                              ...new Set([...selectedSkillIds, c.id]),
                            ].slice(-16),
                          });
                          navigate("chat");
                          notify("图片技能已就绪，直接在对话中提出配图需求。");
                        } else {
                          patchSettings({ model: c.id });
                          notify("已设置为对话模型。");
                        }
                      }}
                    >
                      {c.kind === "image" ? "使用图片技能" : "选用"}
                    </Button>
                  </div>
                ))}
            </div>
          )}
          <div className="notice">
            <SlidersHorizontal size={20} />
            <div>
              <strong>对话与图片技能</strong>
              <p>
                对话模型用于聊天。图片服务自动成为公司技能，提出配图需求时由 AI
                按权限调用，密钥只保存在公司服务器。
              </p>
            </div>
          </div>
        </div>
      )}
      <input
        hidden
        ref={filesRef}
        type="file"
        aria-label="选择附件"
        accept={ATTACHMENT_ACCEPT}
        multiple
        onChange={(e) => {
          void chooseFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {attachmentPreview && (
        <Modal
          title={attachmentPreview.name}
          close={() => setAttachmentPreview(null)}
          wide
        >
          <div className="attachment-preview">
            <p>{attachmentPreview.summary ?? "已读取附件"}</p>
            {!!attachmentPreview.warnings?.length && (
              <div className="attachment-notes">
                {attachmentPreview.warnings.map((note, i) => (
                  <p key={i}>{note}</p>
                ))}
              </div>
            )}
            {!!visualInputs(attachmentPreview).length && (
              <div className="attachment-frames">
                {visualInputs(attachmentPreview).map((frame, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setPreview(frame.image);
                      setAttachmentPreview(null);
                    }}
                  >
                    <img src={frame.image} alt={frame.label} />
                    <span>{frame.label}</span>
                  </button>
                ))}
              </div>
            )}
            {attachmentPreview.content && (
              <pre tabIndex={0} aria-label="已读取的附件内容">
                {attachmentPreview.content}
              </pre>
            )}
            <p className="muted">
              Office
              文档由公司服务临时解析，不保存原文件。发送后，提取的文字和画面会交给所选模型分析。
            </p>
          </div>
        </Modal>
      )}
      {skillDraft && (
        <SkillEditor
          {...props}
          initial={skillDraft}
          close={() => setSkillDraft(null)}
        />
      )}
      {importSkill && (
        <SkillImport
          user={user}
          departments={props.departments}
          close={() => setImportSkill(false)}
          onImported={async (skill) => {
            if (skill.status === "published") {
              await install(skill);
              setFilter(
                skill.audience === "company"
                  ? "company"
                  : skill.audience === "departments"
                    ? "shared"
                    : "department",
              );
            }
            notify(
              skill.status === "published"
                ? "技能已上架并加入本机安装列表；配套资源保存在公司服务器。"
                : "技能已提交审核，批准后可安装使用。",
            );
            await refresh().catch(() =>
              notify("导入已保存，列表刷新失败，请稍后点刷新。"),
            );
          }}
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
            <SkillSourceDetails skill={detail} />
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
              {detail.capability
                ? "公司提供的图片技能已就绪，按你的部门权限使用，无需安装或填写密钥。"
                : detail.requiredTools.length
                  ? `依赖工具：${detail.requiredTools.join("、")}`
                  : "此版本未声明外部工具依赖。"}
            </p>
            <footer>
              {!detail.capability && (
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
              )}
              <Button
                primary
                onClick={() => {
                  if (detail.capability) {
                    patchSettings({
                      skillMode: "manual",
                      skillIds: [
                        ...new Set([...selectedSkillIds, detail.id]),
                      ].slice(-16),
                    });
                    setDetail(null);
                    navigate("chat");
                  } else void install(detail);
                }}
              >
                {detail.capability ? "在对话中使用" : "安装到本机"}
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
    </>
  );
}
