import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  mkdtemp,
  rm,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { updateTrace, type TraceItem } from "../shared/chat-progress";
import { DshManager, dshPermissionMode, dshPresetForMode } from "./dsh";

test("DSH modes map to the shipped presets and workspace permissions map to sandbox modes", () => {
  assert.equal(dshPresetForMode("standard"), "standard");
  assert.equal(dshPresetForMode("ptc"), "ptc");
  assert.equal(dshPresetForMode("minimal"), "minimal");
  assert.equal(dshPresetForMode("creative"), "cordis");
  assert.equal(dshPermissionMode("view"), "read-only");
  assert.equal(dshPermissionMode("edit"), "workspace-write");
  assert.equal(dshPermissionMode("full"), "danger-full-access");
});

test(
  "a real SDK tool loop stops after the budget and returns existing exported images instead of losing the files",
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "brain-dsh-export-loop-")),
      manager = new DshManager(root);
    let calls = 0,
      output = "";
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const server = createServer(async (req, res) => {
      try {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const payload = JSON.parse(raw);
        if (!output) {
          const text = payload.messages
            .map((m: any) =>
              typeof m.content === "string"
                ? m.content
                : (m.content ?? []).map((b: any) => b.text ?? "").join("\n"),
            )
            .join("\n");
          const match = /本轮成果目录 ([\s\S]+?)。用户/.exec(text);
          assert.ok(match);
          output = match[1];
          await writeFile(join(output, "result.png"), png);
        }
        calls++;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_" + calls, type: "function", function: { name: "read_image", arguments: JSON.stringify({ file_path: join(output, "result.png") }) } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
        );
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(async () => {
      await manager.close();
      server.closeAllConnections();
      server.close();
      await rm(root, { recursive: true, force: true });
    });
    const result = await manager.runDetailed({
      connectionId: "fixture",
      baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
      model: "fixture",
      apiKey: "local-fixture-only",
      userId: "employee",
      sessionId: "loop",
      deliverFiles: true,
      messages: [{ role: "user", content: "创建图片文件" }],
      attachments: [],
    });
    assert.equal(calls, 65);
    assert.deepEqual(result.output?.files, ["result.png"]);
    assert.match(result.content, /重复检查已停止/);
    assert.deepEqual(
      await readFile(join(result.output!.directory, "result.png")),
      png,
    );
  },
);

test("DSH combines independent skill resources, cleans failures and admits visual attachments", async (t) => {
  let resourceObserved = false;
  const requests: string[] = [];
  let signalReasoning!: () => void;
  const sawReasoning = new Promise<void>((resolve) => {
    signalReasoning = resolve;
  });
  const progress: any[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(body);
    const stages = (
      await readdir(join(root, "workspaces", "user-test", "session-test"))
    ).filter((name) => name.startsWith("skill-"));
    assert.equal(stages.length, 2);
    const guides = await Promise.all(
      stages.map((stage) =>
        readFile(
          join(
            root,
            "workspaces",
            "user-test",
            "session-test",
            stage,
            "guide.md",
          ),
          "utf8",
        ),
      ),
    );
    assert.deepEqual(guides.sort(), [
      "Second skill reference fixture",
      "Selected skill reference fixture",
    ]);
    resourceObserved = stages.every((stage) => body.includes(stage));
    res.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "close",
      "cache-control": "no-cache",
    });
    res.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: "先检查图片与附件。" } }] })}\n\n`,
    );
    await Promise.race([
      sawReasoning,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("DSH reasoning was not delivered before completion"),
            ),
          8000,
        ).unref(),
      ),
    ]);
    res.write(
      `data: ${JSON.stringify({
        id: "probe",
        object: "chat.completion.chunk",
        choices: [
          { index: 0, delta: { role: "assistant", content: "DSH probe OK" } },
        ],
      })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({
        id: "probe",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = await mkdtemp(join(tmpdir(), "corporate-brain-dsh-test-"));
  const libraryRoot = join(root, "library");
  await mkdir(libraryRoot);
  const guide = Buffer.from("Selected skill reference fixture");
  await writeFile(join(libraryRoot, "guide.md"), guide);
  const secondRoot = join(root, "second-library");
  await mkdir(secondRoot);
  const secondGuide = Buffer.from("Second skill reference fixture");
  await writeFile(join(secondRoot, "guide.md"), secondGuide);
  const manager = new DshManager(root);
  t.after(async () => {
    await manager.close();
    server.close();
    await rm(root, { recursive: true, force: true });
  });
  const port = (server.address() as any).port;
  const firstResource = {
    root: libraryRoot,
    files: [
      {
        path: "guide.md",
        size: guide.length,
        sha256: createHash("sha256").update(guide).digest("hex"),
      },
    ],
    source: {
      kind: "zip" as const,
      label: "fixture",
      digest: "0".repeat(64),
      entry: "guide.md",
      fileCount: 1,
      bytes: guide.length,
      license: "MIT",
      licenseFiles: [],
      hasScripts: false,
      notes: [],
    },
  };
  const secondResource = {
    ...firstResource,
    root: secondRoot,
    files: [
      {
        path: "guide.md",
        size: secondGuide.length,
        sha256: createHash("sha256").update(secondGuide).digest("hex"),
      },
    ],
  };
  const result = await manager.run({
    connectionId: "connection-test",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: "probe-model",
    apiKey: "probe-key",
    skillResources: [firstResource, secondResource],
    onProgress: (event) => {
      progress.push(event);
      if (event.type === "reasoning" && event.text.includes("先检查"))
        signalReasoning();
    },
    userId: "user-test",
    sessionId: "session-test",
    messages: [{ role: "user", content: "请识别这张图片" }],
    attachments: [
      {
        name: "probe.png",
        image:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
      { name: "notes.txt", content: "file recognition probe" },
      {
        name: "clip.mp4",
        content: "Sampled video frames; no audio",
        images: [
          {
            label: "00:01.00",
            image:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          },
        ],
      },
    ],
  });
  assert.equal(result, "DSH probe OK");
  assert.equal(resourceObserved, true);
  assert.ok(
    !(
      await readdir(join(root, "workspaces", "user-test", "session-test"))
    ).some((name) => name.startsWith("skill-")),
  );
  assert.ok(requests.some((body) => body.includes("probe.png")));
  assert.ok(requests.some((body) => body.includes("notes.txt")));
  assert.ok(requests.some((body) => body.includes("00:01.00")));
  assert.ok(requests.some((body) => body.includes("image")));
  assert.ok(progress.some((event) => event.type === "reasoning"));
  assert.ok(
    progress.some(
      (event) => event.type === "text" && event.text.includes("DSH probe OK"),
    ),
  );
  assert.equal(progress.reduce<TraceItem[]>(updateTrace, []).length, 1);
  await writeFile(join(secondRoot, "guide.md"), "tampered");
  const requestCount = requests.length;
  await assert.rejects(
    manager.run({
      connectionId: "connection-test",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "probe-model",
      apiKey: "probe-key",
      userId: "user-test",
      sessionId: "session-test",
      messages: [
        {
          role: "user",
          content: "Do not invoke provider for damaged resources",
        },
      ],
      attachments: [],
      skillResources: [firstResource, secondResource],
    }),
    /被修改/,
  );
  assert.equal(requests.length, requestCount);
  assert.equal(
    (
      await readdir(join(root, "workspaces", "user-test", "session-test"))
    ).filter((name) => name.startsWith("skill-")).length,
    0,
    "a failure preparing the second skill cleans the first skill too",
  );
});

test("DSH cancellation closes only its request and a stopped session can run again", async (t) => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (body.includes("hold-this-turn")) {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "等待验证取消。" } }] })}\n\n`,
      );
    } else
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "other-session-ok" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = await mkdtemp(join(tmpdir(), "brain-dsh-cancel-"));
  const manager = new DshManager(root);
  t.after(async () => {
    await manager.close();
    server.closeAllConnections();
    server.close();
    await rm(root, { recursive: true, force: true });
  });
  const base = {
    connectionId: "test",
    userId: "test",
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    model: "probe",
    apiKey: "probe",
    attachments: [],
  };
  const abort = new AbortController();
  const pending = manager.run({
    ...base,
    sessionId: "held",
    messages: [{ role: "user", content: "hold-this-turn" }],
    signal: abort.signal,
    onProgress: (event) => {
      if (event.type === "reasoning") ready();
    },
  });
  const rejected = assert.rejects(pending);
  await Promise.race([
    started,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("no live reasoning")), 15000).unref(),
    ),
  ]);
  await assert.rejects(
    manager.run({
      ...base,
      sessionId: "held",
      messages: [{ role: "user", content: "overlap" }],
    }),
    /仍有请求/,
  );
  const other = manager.run({
    ...base,
    sessionId: "other",
    messages: [{ role: "user", content: "finish" }],
  });
  try {
    assert.equal(
      await Promise.race([
        other,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(Error("Other conversation was blocked by the held turn")),
            10000,
          ).unref(),
        ),
      ]),
      "other-session-ok",
    );
    assert.equal(abort.signal.aborted, false);
  } finally {
    abort.abort();
  }
  await rejected;
  // A new turn in the cancelled conversation has a new runtime, not a poisoned lock.
  assert.equal(
    await manager.run({
      ...base,
      sessionId: "held",
      messages: [{ role: "user", content: "finish" }],
    }),
    "other-session-ok",
  );
});
