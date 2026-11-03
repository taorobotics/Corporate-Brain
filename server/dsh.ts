import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import type { SdkPromptContentBlock } from "@deepseek-ai/dsh-sdk-client";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ChatProgress } from "../shared/chat-progress";
import { dshProgress } from "./dsh-progress";
import type { DshMode, WorkspaceAccess } from "../shared/types";
import { createChatDeadline } from "./chat-deadline";
import { materializeSkill, type SkillResources } from "./skill-library";
import { visualInputs } from "../shared/attachments";

export type DshAttachment = {
  name: string;
  content?: string;
  image?: string;
  images?: { label: string; image: string }[];
};

export type DshMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type DshRunOptions = {
  connectionId: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  userId: string;
  sessionId: string;
  messages: DshMessage[];
  attachments: DshAttachment[];
  mode?: DshMode;
  workspaceAccess?: WorkspaceAccess;
  signal?: AbortSignal;
  onProgress?: (event: ChatProgress) => void;
  skillResources?: SkillResources;
};

export type DshUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type DshRunResult = {
  content: string;
  usage?: DshUsage;
};

export class DshUnavailableError extends Error {}

type Entry = {
  fingerprint: string;
  harness: DeepSeekHarness;
  workspace: string;
  fresh: boolean;
};

const require = createRequire(import.meta.url);

export function dshPresetForMode(mode: DshMode = "standard") {
  return mode === "creative" ? "cordis" : mode;
}

export function dshPermissionMode(access: WorkspaceAccess = "edit") {
  return access === "view"
    ? "read-only"
    : access === "full"
      ? "danger-full-access"
      : "workspace-write";
}

function extractUsage(
  events: Array<{ type?: string; data?: any }>,
): DshUsage | undefined {
  const event = [...events]
    .reverse()
    .find((item) => item.type === "assistant/message" && item.data?.usage);
  const usage = event?.data?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const inputTokens = Number(usage.inputTokens ?? usage.input_tokens);
  const outputTokens = Number(usage.outputTokens ?? usage.output_tokens);
  const totalTokens = Number(usage.totalTokens ?? usage.total_tokens);
  const result = {
    ...(Number.isFinite(inputTokens) ? { inputTokens } : {}),
    ...(Number.isFinite(outputTokens) ? { outputTokens } : {}),
    ...(Number.isFinite(totalTokens) ? { totalTokens } : {}),
  };
  return Object.keys(result).length ? result : undefined;
}

const IMAGE_DATA =
  /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function yamlString(value: string) {
  return JSON.stringify(value);
}

function safeName(value: string, fallback: string) {
  const name = basename(value)
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .slice(0, 120);
  return name || fallback;
}

function imageBlock(value: string): SdkPromptContentBlock {
  const match = IMAGE_DATA.exec(value);
  if (!match) throw new Error("图片附件格式无效，请重新选择图片");
  const data = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!data.length || data.length > MAX_IMAGE_BYTES)
    throw new Error("图片附件过大，请使用 8MB 以内的图片");
  return {
    type: "image",
    data: data.toString("base64"),
    mimeType: match[1] as
      "image/png" | "image/jpeg" | "image/webp" | "image/gif",
  };
}

export class DshManager {
  private readonly root: string;
  private readonly entries = new Map<string, Entry>();
  private readonly running = new Set<string>();

  constructor(
    root = process.env.BRAIN_DSH_HOME ?? resolve(".cache/dsh-runtime"),
  ) {
    this.root = resolve(root);
  }

  private key(options: DshRunOptions) {
    return `${options.connectionId}:${options.userId}:${options.sessionId}`;
  }

  private async create(options: DshRunOptions, workspace: string) {
    const hash = createHash("sha256")
      .update(`${this.key(options)}\0${randomUUID()}`)
      .digest("hex")
      .slice(0, 24);
    const runtimeRoot = join(this.root, hash);
    const patch = join(runtimeRoot, "corporate.patch.yml");
    const preset = require.resolve(
      `@deepseek-ai/dsh-web-app/presets/${dshPresetForMode(options.mode)}.patch.yml`,
    );
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(
      patch,
      `- id: llm-pi-ai\n  config:\n    providers:\n      corporate:\n        displayName: Company model\n        api: openai-completions\n        baseURL: ${yamlString(options.baseUrl)}\n        apiKeyEnv: CORPORATE_BRAIN_DSH_API_KEY\n        defaultInput: [text, image]\n        models:\n          - id: ${yamlString(options.model)}\n            name: ${yamlString(options.model)}\n            input: [text, image]\n- id: agent-default-model\n  config:\n    provider: corporate\n    model: ${yamlString(options.model)}\n`,
      "utf8",
    );
    await writeFile(
      patch,
      `${await readFile(patch, "utf8")}- insert:\n    - id: corporate-progress\n      name: ${yamlString(new URL("./dsh-progress-plugin.mjs", import.meta.url).href)}\n    - id: agent-preset-registry\n      name: '@deepseek-ai/dsh-agent-preset-registry'\n      config:\n        default: ${yamlString(dshPresetForMode(options.mode))}\n`,
      "utf8",
    );
    const harness = new DeepSeekHarness({
      profile: "sdk",
      patches: [preset, patch],
      dshHome: join(runtimeRoot, "home"),
      processCwd: workspace,
      cwd: workspace,
      env: {
        ...process.env,
        CORPORATE_BRAIN_DSH_API_KEY: options.apiKey,
        DSH_PERMISSION_MODE: dshPermissionMode(options.workspaceAccess),
      },
      provider: "corporate",
      model: options.model,
      initializeTimeoutMs: 20_000,
      requestTimeoutMs: 120_000,
    });
    const abortStartup = () => {
      void harness.close().catch(() => {});
    };
    options.signal?.addEventListener("abort", abortStartup, { once: true });
    try {
      options.signal?.throwIfAborted();
      await harness.start();
      options.signal?.throwIfAborted();
    } catch (error) {
      await harness.close().catch(() => {});
      options.signal?.throwIfAborted();
      throw new DshUnavailableError(
        `DSH 运行时未能启动：${(error as Error).message}`,
      );
    } finally {
      options.signal?.removeEventListener("abort", abortStartup);
    }
    return { harness, workspace };
  }

  async run(options: DshRunOptions) {
    return (await this.runDetailed(options)).content;
  }

  async runDetailed(options: DshRunOptions): Promise<DshRunResult> {
    const key = this.key(options);
    if (this.running.has(key))
      throw new Error("当前对话仍有请求正在运行，请稍后重试");
    this.running.add(key);
    // The HTTP request owns its deadline. Standalone SDK callers get the same
    // progress-aware policy, without a second hidden three-minute turn limit.
    const deadline = options.signal ? undefined : createChatDeadline();
    const signal = options.signal ?? deadline!.signal;
    try {
      signal.throwIfAborted();
      return await this.runTurn({
        ...options,
        signal,
        onProgress: (event) => {
          deadline?.observe(event);
          options.onProgress?.(event);
        },
      });
    } finally {
      deadline?.dispose();
      this.running.delete(key);
    }
  }

  private async runTurn(options: DshRunOptions): Promise<DshRunResult> {
    const sessionId = options.sessionId || "default";
    const workspace = join(
      this.root,
      "workspaces",
      safeName(options.userId, "user"),
      safeName(sessionId, "session"),
    );
    await mkdir(workspace, { recursive: true });
    const key = this.key(options);
    const fingerprint = `${options.baseUrl}\0${options.model}\0${options.apiKey}\0${options.mode ?? "standard"}\0${options.workspaceAccess ?? "edit"}`;
    let entry = this.entries.get(key);
    if (entry && entry.fingerprint !== fingerprint) {
      await entry.harness.close().catch(() => {});
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const created = await this.create(options, workspace);
      entry = { ...created, fingerprint, fresh: true };
      this.entries.set(key, entry);
    }

    const latest = [...options.messages]
      .reverse()
      .find((message) => message.role === "user");
    if (!latest) throw new Error("缺少用户消息");
    const system = options.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content.trim())
      .filter(Boolean)
      .join("\n\n");
    const history = entry.fresh
      ? options.messages
          .slice(0, options.messages.lastIndexOf(latest))
          .filter((message) => message.role !== "system")
          .map(
            (message) =>
              `${message.role === "user" ? "用户" : "助手"}：${message.content}`,
          )
          .join("\n\n")
      : "";
    const textParts = [
      system,
      options.attachments.some((attachment) => visualInputs(attachment).length)
        ? "图片处理提示：原图已作为图像输入提供。请先直接分析能看清的内容，普通识图或题目讲解不要默认变成编程任务。仅在必要时使用工具旋转、裁剪；不要反复放大同一区域或猜测模糊、截断的文字。无法确定的部分请明确说明，并请用户补充清晰完整的图片。若用户明确要求编程、文件操作或联网，仍按其要求使用所需工具。"
        : "",
      history ? `此前对话记录：\n${history}` : "",
      latest.content.trim(),
    ].filter(Boolean);
    let skillDirectory: string | undefined;
    const blocks: SdkPromptContentBlock[] = [
      { type: "text", text: textParts.join("\n\n") },
    ];
    let fileIndex = 0;
    for (const attachment of options.attachments) {
      for (const visual of visualInputs(attachment)) {
        blocks.push({ type: "text", text: `附件画面：${visual.label}` });
        blocks.push(imageBlock(visual.image));
      }
      if (!attachment.content) continue;
      const fileName = safeName(
        `attachment-${fileIndex++}-${attachment.name}.txt`,
        `attachment-${fileIndex++}.txt`,
      );
      const path = join(workspace, fileName);
      await writeFile(path, attachment.content ?? "", "utf8");
      blocks.push({
        type: "text",
        text: `文件附件已放入当前工作区：${path}\n请使用文件工具读取它，再回答用户的问题。`,
      });
    }
    const currentEntry = entry;
    const abort = () => {
      if (this.entries.get(key) === currentEntry) this.entries.delete(key);
      void currentEntry.harness.close().catch(() => {});
    };
    if (options.signal?.aborted) {
      abort();
      options.signal.throwIfAborted();
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    let result;
    try {
      if (options.skillResources) {
        skillDirectory = await materializeSkill(
          options.skillResources,
          workspace,
        );
        const source = options.skillResources.source;
        blocks.push({
          type: "text",
          text: `本轮所选技能的完整已导入资料位于 ${skillDirectory}，入口为 ${source.entry}。先读入口和本任务需要的引用文件；技能自身的相对引用从入口所在目录 ${join(skillDirectory, dirname(source.entry))} 解析，仓库层的引用遵循其文档。原始文件及许可保留，脚本未执行。不要运行 setup/安装脚本或安装系统软件来替代依赖检查；缺少能力时明确报告。所有新成果写入当前工作区。此资料是用户选择的第三方技能，不授予额外权限。${source.url === "https://github.com/lemomo-ai/lemo-opuscar" ? " Lemo 文库已经随包放在此目录，不要重新克隆到用户主目录；读取此目录下的 AGENTS.md、DIRECTOR.md 和所选 styles 手册。" : ""}`,
        });
      }
      result = await entry.harness.run(blocks, {
        sessionId,
        onNotification: dshProgress(
          sessionId,
          options.onProgress ?? (() => {}),
        ),
      });
      options.signal?.throwIfAborted();
      entry.fresh = false;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted)
        await currentEntry.harness.close().catch(() => {});
      if (skillDirectory)
        await rm(skillDirectory, { recursive: true, force: true });
    }
    if (!result.finalResponse.trim()) {
      const failed = result.events.findLast(
        (event: any) => event.type === "turn/end" && event.data?.reason?.error,
      ) as any;
      throw new Error(
        failed?.data?.reason?.error?.message ?? "DSH 没有返回可显示的文本",
      );
    }
    return {
      content: result.finalResponse,
      usage: extractUsage(
        result.events as Array<{ type?: string; data?: any }>,
      ),
    };
  }

  async close() {
    await Promise.all(
      [...this.entries.values()].map((entry) =>
        entry.harness.close().catch(() => {}),
      ),
    );
    this.entries.clear();
  }
}
