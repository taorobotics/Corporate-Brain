import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { preserveNasFilenames } from "./automatic";
import { companyLookupSchema } from "./company-context";
import { companyContext } from "./company-context";
import { parseNasDocument } from "./nas-documents";
import { draftDocx } from "./document-draft";
import { parseOffice } from "./documents";
import { createPlatform } from "./platform";
const signal = () => new AbortController().signal;

test("NAS text extraction preserves encoding and bounded reading offsets with source integrity", async () => {
  const bytes = Buffer.from("原始部门文档。".repeat(7000));
  const before = Buffer.from(bytes);
  const first = await parseNasDocument(
    "资料/流程.txt",
    bytes,
    null,
    0,
    signal(),
  );
  assert.equal(first.content.length, 30000);
  assert.equal(first.nextOffset, 30000);
  assert.equal(first.sha256, createHash("sha256").update(bytes).digest("hex"));
  const second = await parseNasDocument(
    "资料/流程.txt",
    bytes,
    null,
    first.nextOffset!,
    signal(),
  );
  assert.equal(first.content + second.content, bytes.toString());
  assert.equal(second.nextOffset, null);
  assert.deepEqual(bytes, before);
  const utf16 = Buffer.concat([
    Buffer.from([255, 254]),
    Buffer.from("中文原文", "utf16le"),
  ]);
  assert.equal(
    (await parseNasDocument("文档.txt", utf16, null, 0, signal())).content,
    "中文原文",
  );
  await assert.rejects(
    parseNasDocument("setup.exe", Buffer.from("binary"), null, 0, signal()),
  );
  await assert.rejects(
    parseNasDocument("fake.txt", Buffer.from([0, 1, 0, 2]), null, 0, signal()),
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    parseNasDocument("a.txt", Buffer.from("text"), null, 0, cancelled.signal),
  );
});

test("NAS Word and spreadsheet documents are extracted without running scripts or formulas", async () => {
  const word = await parseNasDocument(
    "说明.docx",
    await readFile("artifacts/fixtures/attachment-word.docx"),
    null,
    0,
    signal(),
  );
  assert.ok(word.content.length > 20);
  const book = await parseNasDocument(
    "报告.xlsx",
    await readFile("artifacts/fixtures/attachment-sheet.xlsx"),
    null,
    0,
    signal(),
  );
  assert.ok(book.content.length > 5);
  assert.ok(book.warnings.length);
});

test("NAS PDF extracts selectable text and reports unreadable scan pages rather than inventing OCR", async () => {
  const text = await parseNasDocument(
    "正文.pdf",
    await readFile("artifacts/fixtures/attachment-text.pdf"),
    null,
    0,
    signal(),
  );
  assert.ok(text.readable);
  assert.ok(text.content.length > 30);
  assert.ok(text.warnings.some((w) => w.includes("OCR")));
  const scan = await parseNasDocument(
    "扫描件.pdf",
    await readFile("artifacts/fixtures/attachment-scan.pdf"),
    null,
    0,
    signal(),
  );
  assert.equal(scan.readable, false);
  assert.ok(scan.warnings.some((w) => w.includes("没有可提取文字")));
});

test("downloadable Word draft contains revised Unicode text and real tables, with XML escaped and no external relationships", async () => {
  const source =
    "# 修改稿\n\n研发 <正文> & 说明\n\n| 项目 | 数量 |\n|---|---|\n| 表格内容 | 30 |";
  const bytes = draftDocx(source),
    result = await parseOffice(
      "修改稿.docx",
      bytes.toString("base64"),
      signal(),
    );
  assert.match(result.content, /研发 <正文> & 说明/);
  assert.match(result.content, /表格内容/);
  assert.match(result.content, /30/);
});

test("NAS chat reads permitted bodies, preserves original, generates isolated local drafts and rejects revocation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "brain-nas-document-"));
  const original = Buffer.from(
    "原始流程：先接收需求，再分配负责人，最后验收。",
  );
  let reads = 0,
    block: (() => Promise<void>) | undefined;
  let documentBytes = original,
    finishReason = "stop";
  const calls: any[] = [];
  const platform = createPlatform({
    database: join(root, "platform.sqlite"),
    nas: {
      read: async (_s, _p, s) => {
        reads++;
        if (block) await block();
        s.throwIfAborted();
        return {
          data: Buffer.from(documentBytes),
          modified: "2026-11-09T00:00:00Z",
        };
      },
    },
    modelTransport: async (_r, _u, init) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      return Response.json({
        choices: [
          {
            message: {
              content: "# 修改稿\n\n规范流程：登记需求、明确负责人、完成验收。",
            },
            finish_reason: finishReason,
          },
        ],
      });
    },
  });
  const server = createServer(platform.app).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await platform.production.close();
    await platform.library.close();
    platform.store.close();
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`,
    password = randomBytes(20).toString("hex");
  const request = async (path: string, body?: any, cookie = "") => {
    const res = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  await request("/bootstrap", {
    companyName: "合成公司",
    name: "管理员",
    username: "doc-admin",
    password,
  });
  const cookie = (
    await request("/auth/login", { username: "doc-admin", password })
  ).cookie;
  const actor = (await request("/auth/me", undefined, cookie)).data;
  const source = (
    await request(
      "/admin/knowledge",
      {
        name: "合成正文资料",
        host: "192.168.20.16",
        share: "synthetic-share",
        basePath: "",
        username: "synthetic-user",
        password: "synthetic-password",
        departmentIds: [actor.departmentId],
        enabled: true,
      },
      cookie,
    )
  ).data;
  const model = (
    await request(
      "/connections",
      {
        name: "合成模型",
        baseUrl: "https://model.invalid",
        model: "fixture",
        kind: "chat",
        apiKey: "fixture",
        departments: [],
      },
      cookie,
    )
  ).data;
  const lookup = {
    knowledge: "read",
    documents: [{ sourceId: source.id, path: "部门说明.txt", offset: 0 }],
  };
  const chat = (edit = false, extra: any = {}) =>
    request(
      "/generate/chat",
      {
        connectionId: model.id,
        messages: [
          {
            role: "user",
            content: edit ? "润色这份 NAS 文档并生成修改稿" : "分析 NAS 文档",
          },
        ],
        execution: "answer",
        companyLookup: { ...lookup, edit },
        skillIds: [],
        ...(edit ? { deviceId: randomUUID() } : {}),
        ...extra,
      },
      cookie,
    );
  await t.test(
    "body previews and selected-document chat use current authorization, source hash and read range",
    async () => {
      const doc = await request(
        `/knowledge/sources/${source.id}/document`,
        { path: "部门说明.txt" },
        cookie,
      );
      assert.equal(doc.status, 200);
      assert.equal(doc.data.content, original.toString());
      const n = calls.length;
      const plan = await request(
        "/generate/plan",
        {
          connectionId: model.id,
          messages: [{ role: "user", content: "分析所选文档" }],
          requestedCompanyLookup: lookup,
        },
        cookie,
      );
      assert.equal(plan.status, 200);
      assert.equal(
        calls.length,
        n,
        "selected document needs no planning model call",
      );
      const result = await chat();
      assert.equal(result.status, 200);
      assert.ok(
        JSON.stringify(calls.at(-1).messages).includes(original.toString()),
      );
      assert.equal(result.data.companyLookup.documents[0].nextOffset, null);
      for (const value of [
        "synthetic-password",
        "synthetic-user",
        "192.168.20.16",
      ])
        assert.ok(!JSON.stringify(calls.at(-1).messages).includes(value));
    },
  );
  await t.test(
    "editing produces Word, Markdown and provenance without changing the NAS source",
    async () => {
      const result = await chat(true);
      assert.equal(result.status, 200);
      const id = result.data.productionTaskId;
      assert.ok(id);

      // Verify files directly in the isolated server queue; device delivery is tested natively.
      const taskDir = join(platform.production.root, actor.id, id, "files");
      const markdown = await readFile(join(taskDir, "修改稿.md"), "utf8");
      assert.match(markdown, /登记需求/);
      const doc = await parseOffice(
        "修改稿.docx",
        (await readFile(join(taskDir, "修改稿.docx"))).toString("base64"),
        signal(),
      );
      assert.match(doc.content, /规范流程/);
      assert.match(
        await readFile(join(taskDir, "来源说明.txt"), "utf8"),
        /NAS 原件未写入/,
      );
      assert.deepEqual(
        original,
        Buffer.from("原始流程：先接收需求，再分配负责人，最后验收。"),
      );
      await platform.production.cancel(actor.id, id);
      assert.equal((await chat(true, { workspaceAccess: "view" })).status, 400);
    },
  );
  await t.test(
    "unreadable scans do not create fictional local drafts and truncated model output is marked incomplete",
    async () => {
      documentBytes = await readFile("artifacts/fixtures/attachment-scan.pdf");
      lookup.documents[0].path = "scan.pdf";
      const scanned = await chat(true);
      assert.equal(scanned.status, 200);
      assert.ok(!scanned.data.productionTaskId);
      documentBytes = original;
      lookup.documents[0].path = "部门说明.txt";
      finishReason = "length";
      const partial = await chat(true);
      finishReason = "stop";
      assert.equal(partial.status, 200);
      const id = partial.data.productionTaskId;
      assert.ok(id);
      const fs = await import("node:fs/promises");
      const files = await fs.readdir(
        join(platform.production.root, actor.id, id, "files"),
      );
      assert.ok(files.some((f) => f.includes("未完成")));
      await platform.production.cancel(actor.id, id);
    },
  );
  await t.test(
    "unauthorized sources and traversal do not read, and source revocation prevents model disclosure",
    async () => {
      const other = (
        await request("/departments", { name: "其他部门" }, cookie)
      ).data;
      const denied = (
        await request(
          "/admin/knowledge",
          {
            name: "其他部门正文",
            host: "192.168.20.16",
            share: "synthetic-share",
            basePath: "",
            username: "fixture",
            password: "fixture",
            departmentIds: [other.id],
            enabled: true,
          },
          cookie,
        )
      ).data;
      const n = reads;
      assert.equal(
        (
          await request(
            `/knowledge/sources/${denied.id}/document`,
            { path: "a.txt" },
            cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/knowledge/sources/${randomUUID()}/document`,
            { path: "a.txt" },
            cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/knowledge/sources/${source.id}/document`,
            { path: "../a.txt" },
            cookie,
          )
        ).status,
        400,
      );
      assert.equal(reads, n);
      let entered!: () => void, release!: () => void;
      const start = new Promise<void>((r) => (entered = r)),
        wait = new Promise<void>((r) => (release = r));
      block = () => {
        entered();
        return wait;
      };
      const count = calls.length,
        pending = chat();
      await start;
      platform.store.db
        .prepare(
          "UPDATE nas_sources SET enabled=0,revision=revision+1 WHERE id=?",
        )
        .run(source.id);
      release();
      assert.equal((await pending).status, 409);
      assert.equal(calls.length, count);
      block = undefined;
    },
  );
});

test("NAS document discovery searches authorized child folders without auto-reading credential files", async () => {
  const sourceId = randomUUID(),
    paths: string[] = [];
  const source: any = {
    id: sourceId,
    name: "合成知识",
    enabled: true,
    revision: 1,
    status: "connected",
    departmentIds: [],
    lastChecked: null,
    statusMessage: "",
  };
  const entry = (name: string, directory = false) => ({
    name,
    directory,
    blocked: false,
    bytes: 10,
    modified: null,
  });
  const result = await companyContext({
    lookup: {
      knowledge: "read",
      directories: [{ sourceId, path: "", recursive: true, search: "说明" }],
    },
    skills: [],
    installedSkillIds: [],
    sources: [source],
    signal: signal(),
    progress: () => {},
    validate: () => {},
    browse: async (_id, path) => ({
      path,
      entries: path
        ? [entry("使用说明.txt"), entry("密码说明.txt")]
        : [entry("业务资料", true)],
      truncated: false,
    }),
    read: async (_id, path) => {
      paths.push(path);
      return parseNasDocument(
        path,
        Buffer.from("业务说明正文"),
        null,
        0,
        signal(),
      );
    },
  });
  assert.deepEqual(paths, ["业务资料/使用说明.txt"]);
  assert.equal(result.documents.length, 1);
  assert.ok(result.prompt.includes("业务说明正文"));
});

test("NAS lookup normalizes safe recursion aliases and preserves explicit filename or folder scope", () => {
  const id = randomUUID();
  const value = companyLookupSchema.parse({
    knowledge: "read",
    recursive: true,
    directories: [{ sourceId: id, path: "", search: "项目手册" }],
  });
  assert.equal(value.directories![0].recursive, true);
  assert.ok(!("recursive" in value));
  preserveNasFilenames({ companyLookup: value }, "分析项目手册.docx");
  assert.equal(value.directories![0].search, "项目手册.docx");
  const folder = companyLookupSchema.parse({
    knowledge: "read",
    directories: [
      { sourceId: id, path: "", search: "项目手册", recursive: true },
    ],
  });
  preserveNasFilenames(
    { companyLookup: folder },
    "总结 NAS 的“项目手册”文件夹",
  );
  assert.equal(folder.directories![0].directoryOnly, true);
  assert.throws(() =>
    companyLookupSchema.parse({ knowledge: "read", password: "injected" }),
  );
});
