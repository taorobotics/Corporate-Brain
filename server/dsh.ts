import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import type { SdkPromptContentBlock } from "@deepseek-ai/dsh-sdk-client";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export type DshAttachment = {
  name: string;
  content?: string;
  image?: string;
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
};

export class DshUnavailableError extends Error {}

type Entry = {
  fingerprint: string;
  harness: DeepSeekHarness;
  workspace: string;
};

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
    mimeType: match[1] as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
  };
}

export class DshManager {
  private readonly root: string;
  private readonly entries = new Map<string, Entry>();

  constructor(root = process.env.BRAIN_DSH_HOME ?? resolve(".cache/dsh-runtime")) {
    this.root = resolve(root);
  }

  private key(options: DshRunOptions) {
    return `${options.connectionId}:${options.userId}:${options.sessionId}`;
  }

  private async create(options: DshRunOptions, workspace: string) {
    const hash = createHash("sha256")
      .update(`${options.connectionId}\0${options.baseUrl}\0${options.model}`)
      .digest("hex")
      .slice(0, 24);
    const runtimeRoot = join(this.root, hash);
    const patch = join(runtimeRoot, "corporate.patch.yml");
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(
      patch,
      `- id: llm-pi-ai\n  config:\n    providers:\n      corporate:\n        displayName: Company model\n        api: openai-completions\n        baseURL: ${yamlString(options.baseUrl)}\n        apiKeyEnv: CORPORATE_BRAIN_DSH_API_KEY\n        defaultInput: [text, image]\n        models:\n          - id: ${yamlString(options.model)}\n            name: ${yamlString(options.model)}\n            input: [text, image]\n- id: agent-default-model\n  config:\n    provider: corporate\n    model: ${yamlString(options.model)}\n`,
      "utf8",
    );
    const harness = new DeepSeekHarness({
      profile: "sdk",
      patches: [patch],
      dshHome: join(runtimeRoot, "home"),
      processCwd: workspace,
      cwd: workspace,
      env: { ...process.env, CORPORATE_BRAIN_DSH_API_KEY: options.apiKey },
      provider: "corporate",
      model: options.model,
      initializeTimeoutMs: 20_000,
      requestTimeoutMs: 120_000,
    });
    try {
      await harness.start();
    } catch (error) {
      await harness.close().catch(() => {});
      throw new DshUnavailableError(
        `DSH 运行时未能启动：${(error as Error).message}`,
      );
    }
    return { harness, workspace };
  }

  async run(options: DshRunOptions) {
    const sessionId = options.sessionId || "default";
    const workspace = join(
      this.root,
      "workspaces",
      safeName(options.userId, "user"),
      safeName(sessionId, "session"),
    );
    await mkdir(workspace, { recursive: true });
    const key = this.key(options);
    const fingerprint = `${options.baseUrl}\0${options.model}\0${options.apiKey}`;
    let entry = this.entries.get(key);
    if (entry && entry.fingerprint !== fingerprint) {
      await entry.harness.close().catch(() => {});
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const created = await this.create(options, workspace);
      entry = { ...created, fingerprint };
      this.entries.set(key, entry);
    }

    const latest = [...options.messages].reverse().find((message) => message.role === "user");
    if (!latest) throw new Error("缺少用户消息");
    const system = options.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content.trim())
      .filter(Boolean)
      .join("\n\n");
    const textParts = [system, latest.content.trim()].filter(Boolean);
    const blocks: SdkPromptContentBlock[] = [
      { type: "text", text: textParts.join("\n\n") },
    ];
    let fileIndex = 0;
    for (const attachment of options.attachments) {
      if (attachment.image) {
        blocks.push(imageBlock(attachment.image));
        blocks.push({ type: "text", text: `图片附件：${attachment.name}` });
        continue;
      }
      const fileName = safeName(attachment.name, `attachment-${fileIndex++}.txt`);
      const path = join(workspace, fileName);
      await writeFile(path, attachment.content ?? "", "utf8");
      blocks.push({
        type: "text",
        text: `文件附件已放入当前工作区：${path}\n请使用文件工具读取它，再回答用户的问题。`,
      });
    }
    const result = await entry.harness.run(blocks, { sessionId });
    if (!result.finalResponse.trim()) {
      const failed = result.events.findLast(
        (event: any) => event.type === "turn/end" && event.data?.reason?.error,
      ) as any;
      throw new Error(
        failed?.data?.reason?.error?.message ?? "DSH 没有返回可显示的文本",
      );
    }
    return result.finalResponse;
  }

  async close() {
    await Promise.all(
      [...this.entries.values()].map((entry) => entry.harness.close().catch(() => {})),
    );
    this.entries.clear();
  }
}
