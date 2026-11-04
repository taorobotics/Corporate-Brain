import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { parseOffice } from "./documents";
import { createPlatform } from "./platform";
import {
  modelAttachments,
  validateAttachmentBudget,
  visualInputs,
  MAX_ATTACHMENT_REQUEST_TEXT,
} from "../shared/attachments";
import { workspaceAttachments } from "../shared/workspace-context";
const { extractDocument } = createRequire(import.meta.url)(
  "./document-worker.cjs",
);
const zip = (files: Record<string, string>) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
      ),
    ),
  );
const docx = (text: string) =>
  zip({
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格单元格</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
  });

test("Office worker extracts Unicode Word tables, spreadsheet stored values and slide order without executing content", async () => {
  const word = await parseOffice(
    "report.docx",
    docx("销售计划 &amp; 研发进展").toString("base64"),
    new AbortController().signal,
  );
  assert.match(word.content, /销售计划 & 研发进展/);
  assert.match(word.content, /表格单元格/);
  const legacy = await extractDocument(
    "legacy.doc",
    await readFile("artifacts/fixtures/attachment-word.doc"),
  );
  assert.match(legacy.content, /4800/);
  const book = await extractDocument(
    "book.xlsx",
    zip({
      "xl/sharedStrings.xml": "<sst><si><t>产品名称</t></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>',
    }),
  );
  assert.match(book.content, /A1: 产品名称/);
  assert.match(book.content, /B1: 3/);
  assert.doesNotMatch(book.content, /1\+2/);
  const slides = await extractDocument(
    "slides.pptx",
    zip({
      "ppt/slides/slide2.xml": "<s><p><t>第二页</t></p></s>",
      "ppt/slides/slide1.xml": "<s><p><t>第一页</t></p></s>",
    }),
  );
  assert.ok(
    slides.content.indexOf("第一页") < slides.content.indexOf("第二页"),
  );
  const large = await extractDocument("large.docx", docx("字".repeat(130000)));
  assert.equal(large.content.length, 120000);
  assert.ok(large.warnings.some((x: string) => x.includes("120000")));
});

test("Direct chat receives document text and ordered video frames; image URLs cannot fetch arbitrary resources", async (t) => {
  const captured: any[] = [];
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    captured.push(JSON.parse(raw));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "fixture-analyzed" } }],
      }),
    );
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const previous = process.env.BRAIN_DSH_ENABLED;
  process.env.BRAIN_DSH_ENABLED = "0";
  const platform = createPlatform({ database: ":memory:" });
  if (previous === undefined) delete process.env.BRAIN_DSH_ENABLED;
  else process.env.BRAIN_DSH_ENABLED = previous;
  const server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
    provider.closeAllConnections();
    provider.close();
    platform.store.close();
  });
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  let cookie = "";
  const request = (path: string, body: any) =>
    fetch(origin + "/api" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
  const account = {
    username: "visual-fixture",
    password: "Visual-fixture-Password-2026",
  };
  await request("/bootstrap", {
    ...account,
    companyName: "附件验收",
    name: "测试",
  });
  const login = await request("/auth/login", account);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const model = await (
    await request("/connections", {
      name: "fixture",
      model: "fixture",
      kind: "chat",
      baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
      apiKey: "fixture-placeholder",
      departments: [],
    })
  ).json();
  const body = {
    connectionId: model.id,
    messages: [{ role: "user", content: "分析附件" }],
    attachments: [
      { name: "document.docx", content: "Extracted total 4800" },
      {
        name: "video.mp4",
        content: "No audio; sampled frames only",
        images: [
          { label: "00:01", image: "data:image/png;base64,YQ==" },
          { label: "00:03", image: "data:image/png;base64,Yg==" },
        ],
      },
    ],
  };
  assert.equal((await request("/generate/chat", body)).status, 200);
  assert.equal(captured.length, 1);
  const user = captured[0].messages.find((m: any) => m.role === "user");
  assert.match(user.content[0].text, /4800/);
  assert.match(user.content[0].text, /No audio/);
  assert.deepEqual(
    user.content
      .filter((x: any) => x.type === "image_url")
      .map((x: any) => x.image_url.url),
    ["data:image/png;base64,YQ==", "data:image/png;base64,Yg=="],
  );
  assert.match(user.content[1].text, /00:01/);
  assert.match(user.content[3].text, /00:03/);
  assert.equal(
    (
      await request("/generate/chat", {
        ...body,
        attachments: [
          { name: "remote.png", image: "https://private.example/secret" },
        ],
      })
    ).status,
    400,
  );
  assert.equal(captured.length, 1);
  const oversized = {
    name: "workspace-large.md",
    content: "x".repeat(MAX_ATTACHMENT_REQUEST_TEXT + 1),
  };
  assert.throws(() => validateAttachmentBudget([oversized]), /附件文字过多/);
  const rejected = await request("/generate/chat", {
    ...body,
    attachments: [oversized],
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /附件文字过多.*缩小目录/);
  assert.equal(captured.length, 1, "oversized requests never reach a model");
  const prepared = modelAttachments(
    workspaceAttachments({
      root: "large-project",
      files: [
        {
          name: "package-lock.json",
          content: "lock ".repeat(500000),
          size: 2500000,
        },
        {
          name: "README.md",
          content: "LARGE-WORKSPACE-INTEGRATION-FIXTURE",
          size: 35,
        },
      ],
      skipped: 2,
      truncated: true,
    }),
  );
  assert.ok(prepared[0].content.length <= 120000);
  const accepted = await request("/generate/chat", {
    ...body,
    attachments: prepared,
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).content, "fixture-analyzed");
  assert.equal(captured.length, 2);
  const workspaceText = captured[1].messages.find((m: any) => m.role === "user")
    .content[0].text;
  assert.match(workspaceText, /LARGE-WORKSPACE-INTEGRATION-FIXTURE/);
  assert.match(workspaceText, /节选.*未读取/);
  assert.ok(workspaceText.length < 121000);
});

test("Office worker rejects corrupt, encrypted-looking, traversing, oversized XML and external entity inputs", async () => {
  for (const bytes of [
    Buffer.from("not a docx"),
    zip({ "../word/document.xml": "escape" }),
    zip({
      "word/document.xml":
        '<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]><x>&leak;</x>',
    }),
    zip({ "word/document.xml": "x".repeat(6 * 1024 * 1024 + 1) }),
  ]) {
    await assert.rejects(extractDocument("bad.docx", bytes));
  }
  await assert.rejects(extractDocument("bad.doc", Buffer.alloc(100)));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    parseOffice("file.docx", docx("x").toString("base64"), controller.signal),
    /取消/,
  );
});

test("Office HTTP upload requires a live login, checks file type, and returns no server paths", async (t) => {
  const platform = createPlatform({ database: ":memory:" }),
    server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
    platform.store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (path: string, body: any, cookie = "") =>
    fetch(base + "/api" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
  const upload = {
    name: "文档.docx",
    data: docx("HTTP 文档验收").toString("base64"),
  };
  assert.equal((await request("/attachments/document", upload)).status, 401);
  await request("/bootstrap", {
    companyName: "文档测试",
    username: "document-admin",
    name: "测试",
    password: "Document-test-Password-2026",
  });
  const login = await request("/auth/login", {
      username: "document-admin",
      password: "Document-test-Password-2026",
    }),
    cookie = login.headers.get("set-cookie")!.split(";")[0];
  const result = await request("/attachments/document", upload, cookie);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.match(data.content, /HTTP 文档验收/);
  assert.deepEqual(Object.keys(data).sort(), [
    "content",
    "summary",
    "warnings",
  ]);
  assert.equal(
    (
      await request(
        "/attachments/document",
        { ...upload, name: "code.exe" },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/attachments/document",
        { ...upload, data: Buffer.from("corrupt").toString("base64") },
        cookie,
      )
    ).status,
    422,
  );
  await request("/auth/logout", {}, cookie);
  assert.equal(
    (await request("/attachments/document", upload, cookie)).status,
    401,
  );
  assert.ok(
    !platform.store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name LIKE '%document%' OR name LIKE '%attachment%'",
      )
      .get(),
  );
});

test("Visual attachment labels and reading limits survive provider preparation, oversized batches fail explicitly", () => {
  const a = {
    name: "clip.mp4",
    content: "fixture",
    summary: "8 seconds",
    warnings: ["No audio"],
    images: [{ label: "00:01.00", image: "data:image/png;base64,YQ==" }],
  };
  const result = modelAttachments([a]);
  assert.match(result[0].content, /No audio/);
  assert.equal(visualInputs(result[0])[0].label, "clip.mp4 · 00:01.00");
  assert.throws(() => validateAttachmentBudget(Array(9).fill(a)), /8 个文件/);
  assert.throws(
    () =>
      validateAttachmentBudget([{ ...a, images: Array(17).fill(a.images[0]) }]),
    /16 张/,
  );
});
