import assert from "node:assert/strict";
import { test } from "node:test";
import { readChatResponse } from "./chat-stream";
import { dshProgress } from "./dsh-progress";
import {
  normalizeTrace,
  updateTrace,
  type ChatProgress,
  type TraceItem,
} from "../shared/chat-progress";
import { createServer } from "node:http";
import { once } from "node:events";
import { createPlatform } from "./platform";

test("authenticated chat endpoint streams reasoning before completion and keeps JSON compatibility", async (t) => {
  let release!: () => void;
  let providerCalls = 0;
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw);
    providerCalls++;
    if (!payload.stream) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "legacy-answer" } }],
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "先核对来源。" } }] })}\n\n`,
    );
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "stream-answer" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
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
    release?.();
    server.closeAllConnections();
    server.close();
    provider.closeAllConnections();
    provider.close();
    platform.store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  let cookie = "";
  const post = (path: string, body: any, accept = "application/json") =>
    fetch(`${base}/api${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: accept,
        Cookie: cookie,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  await post("/bootstrap", {
    companyName: "测试公司",
    username: "stream-test",
    name: "验收",
    password: "Disposable-Password-2026",
  });
  const login = await post("/auth/login", {
    username: "stream-test",
    password: "Disposable-Password-2026",
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const connection = await (
    await post("/connections", {
      name: "stream-test",
      kind: "chat",
      baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
      model: "test",
      apiKey: "isolated-provider-secret",
      departments: [],
    })
  ).json();
  const body = {
    connectionId: connection.id,
    messages: [{ role: "user", content: "private-context-not-audit" }],
  };
  const authorized = cookie;
  cookie = "";
  const denied = await post("/generate/chat", body, "application/x-ndjson");
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("content-type")!, /application\/json/);
  assert.equal(providerCalls, 0);
  cookie = authorized;
  const response = await post("/generate/chat", body, "application/x-ndjson");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const first = decoder.decode((await reader.read()).value);
  assert.match(first, /先核对来源/);
  assert.doesNotMatch(first, /stream-answer/);
  release();
  let all = first;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    all += decoder.decode(part.value);
  }
  assert.match(all, /"type":"done"/);
  assert.match(all, /stream-answer/);
  assert.doesNotMatch(all, /isolated-provider-secret/);
  assert.equal(
    (await (await post("/generate/chat", body)).json()).content,
    "legacy-answer",
  );
  assert.doesNotMatch(
    JSON.stringify(platform.store.db.prepare("SELECT * FROM audit").all()),
    /private-context-not-audit|先核对来源/,
  );
});

test("provider stream handles split UTF-8, CRLF, reasoning, text and usage", async () => {
  const source =
    [
      { choices: [{ delta: { reasoning_content: "先比较。" } }] },
      {
        choices: [
          { delta: { reasoning_content: "再检查。", content: "结果" } },
        ],
      },
      {
        choices: [{ delta: { content: "正确。" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      },
    ]
      .map((data) => `data: ${JSON.stringify(data)}\r\n\r\n`)
      .join("") + "data: [DONE]\r\n\r\n";
  const bytes = new TextEncoder().encode(source);
  const events: ChatProgress[] = [];
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  const result = await readChatResponse(
    new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    (event) => events.push(event),
  );
  assert.equal(result.content, "结果正确。");
  assert.equal(result.usage?.totalTokens, 20);
  const items = events.reduce<TraceItem[]>(updateTrace, []);
  assert.deepEqual(items, [
    { type: "reasoning", id: "direct-reasoning", text: "先比较。再检查。" },
  ]);
});

test("provider JSON fallback and truncated/error streams are explicit", async () => {
  const events: ChatProgress[] = [];
  const result = await readChatResponse(
    Response.json({ choices: [{ message: { content: "正常回答" } }] }),
    (event) => events.push(event),
  );
  assert.equal(result.content, "正常回答");
  assert.equal(
    events.some((event) => event.type === "reasoning"),
    false,
  );
  await assert.rejects(
    readChatResponse(
      new Response('data: {"choices":[{"delta":{"content":"一半"}}]}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      }),
      () => {},
    ),
    /中断/,
  );
  await assert.rejects(
    readChatResponse(
      Response.json({ error: { message: "private-provider-detail" } }),
      () => {},
    ),
    /模型响应中断/,
  );
});

test("DSH trace is scoped, deduplicates settled reasoning and exposes only safe tool sources", () => {
  let items: TraceItem[] = [];
  const emit = dshProgress("one", (event) => {
    items = updateTrace(items, event);
  });
  const notify = (method: string, event: any, sessionId = "one") =>
    emit({ method, params: { sessionId, event } });
  notify("corporate.assistant", { type: "start", turn: 1, step: 0 });
  notify("corporate.assistant", {
    type: "reasoning-delta",
    index: 0,
    text: "检查来源。",
  });
  notify("session.event", {
    type: "assistant/message",
    data: {
      turn: 1,
      step: 0,
      message: { content: [{ type: "reasoning", text: "检查来源。" }] },
    },
  });
  notify("session.event", {
    type: "tool/call",
    data: { callId: "search", name: "web_search", arguments: "DO-NOT-EXPOSE" },
  });
  notify("session.event", {
    type: "tool/result",
    data: {
      message: {
        source: { callId: "search" },
        content: [{ text: "PRIVATE-RAW-OUTPUT" }],
      },
      meta: {
        sources: [
          { url: "https://example.com", title: "Example" },
          { url: "javascript:alert(1)" },
          { url: "https://secret:pass@example.com" },
        ],
      },
    },
  });
  notify(
    "session.event",
    { type: "tool/call", data: { callId: "other", name: "wrong-user" } },
    "two",
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].type === "reasoning" && items[0].text, "检查来源。");
  assert.equal(items[1].type === "tool" && items[1].sources?.length, 1);
  assert.doesNotMatch(
    JSON.stringify(items),
    /DO-NOT-EXPOSE|PRIVATE-RAW-OUTPUT|wrong-user/,
  );
  const restored = normalizeTrace({
    items: [
      {
        type: "tool",
        id: "t",
        name: "search",
        status: "running",
        sources: [{ url: "data:text/html,hi" }],
      },
    ],
    elapsed: Infinity,
  });
  assert.equal(
    restored?.items[0].type === "tool" && restored.items[0].status,
    "stopped",
  );
  assert.equal(restored?.elapsed, 0);
});
