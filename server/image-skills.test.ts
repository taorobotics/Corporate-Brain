import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createPlatform } from "./platform";
import { generatedImage } from "./image-skills";
import { streamChat } from "../src/chat-stream";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
test("image APIs are company skills; chat and image execute in one authorized response", async (t) => {
  const oldDsh = process.env.BRAIN_DSH_ENABLED;
  process.env.BRAIN_DSH_ENABLED = "0";
  let decision: any = { kind: "image", skillIds: [] };
  let images = 0,
    chats = 0,
    imageStatus = 200,
    imageBody = png;
  let lastChatMessages: any[] = [];
  let releaseChat: (() => void) | undefined,
    chatGate: Promise<void> | undefined;
  let onChat: (() => void) | undefined;
  let holdImage = false,
    onImage: (() => void) | undefined,
    onImageClosed: (() => void) | undefined;
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    assert.ok(!raw.includes("synthetic-image-api-key"));
    if (req.url === "/v1/images/generations") {
      images++;
      assert.equal(body.model, "synthetic-image");
      assert.equal(req.headers.authorization, "Bearer synthetic-image-api-key");
      assert.ok(body.prompt.includes("Synthetic written answer"));
      if (holdImage) {
        res.once("close", () => onImageClosed?.());
        onImage?.();
        return;
      }
      res.statusCode = imageStatus;
      res.end(
        JSON.stringify(
          imageStatus === 200
            ? { data: [{ b64_json: imageBody }] }
            : { error: "private-upstream-diagnostic" },
        ),
      );
      return;
    }
    assert.equal(req.headers.authorization, "Bearer synthetic-chat-api-key");
    if (body.messages[0].content.includes("You route tasks")) {
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(decision) } }],
        }),
      );
      return;
    }
    chats++;
    lastChatMessages = body.messages;
    onChat?.();
    if (chatGate) await chatGate;
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Synthetic written answer with product context.",
            },
          },
        ],
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const platform = createPlatform({ database: ":memory:" });
  const server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    upstream.closeAllConnections();
    upstream.close();
    await platform.production.close();
    platform.store.close();
    if (oldDsh === undefined) delete process.env.BRAIN_DSH_ENABLED;
    else process.env.BRAIN_DSH_ENABLED = oldDsh;
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  async function req(
    path: string,
    body?: unknown,
    cookie = "",
    method = body ? "POST" : "GET",
    stream = false,
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(stream ? { Accept: "application/x-ndjson" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: stream
        ? (await r.text())
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  const password = "Synthetic-Image-Skills-2026";
  await req("/bootstrap", {
    companyName: "Fixture",
    name: "Admin",
    username: "image-admin",
    password,
  });
  const admin = await req("/auth/login", { username: "image-admin", password });
  const other = await req(
    "/departments",
    { name: "Other fixture" },
    admin.cookie,
  );
  async function staff(username: string, departmentId: string) {
    const created = await req(
      "/users",
      { username, name: username, departmentId, role: "employee" },
      admin.cookie,
    );
    const login = await req("/auth/login", {
      username,
      password: created.data.initialPassword,
    });
    await req(
      "/auth/password",
      { current: created.data.initialPassword, password },
      login.cookie,
    );
    return (await req("/auth/login", { username, password })).cookie;
  }
  const employee = await staff("image-staff-a", admin.data.departmentId),
    outsider = await staff("image-staff-b", other.data.id);
  const url = `http://127.0.0.1:${(upstream.address() as any).port}/v1`;
  const chat = (
    await req(
      "/connections",
      {
        name: "Synthetic chat",
        baseUrl: url,
        model: "synthetic-chat",
        kind: "chat",
        apiKey: "synthetic-chat-api-key",
        departments: [],
      },
      admin.cookie,
    )
  ).data;
  const imageConfig = {
    provider: "custom",
    name: "Synthetic illustration",
    baseUrl: url,
    apiKey: "synthetic-image-api-key",
    departments: [admin.data.departmentId],
    models: [{ model: "synthetic-image", kind: "image" }],
  };
  const service = (await req("/model-services", imageConfig, admin.cookie))
    .data;
  const image = (await req("/connections", undefined, employee)).data.find(
    (c: any) => c.kind === "image",
  );
  const skills = (await req("/skills", undefined, employee)).data;
  const skill = skills.find((s: any) => s.capability?.kind === "image");
  const body = {
    connectionId: chat.id,
    skillIds: [skill.id],
    imageSkillId: skill.id,
    messages: [
      {
        role: "user",
        content: "Write a product introduction and generate an illustration.",
      },
    ],
  };
  const planBody = {
    connectionId: chat.id,
    skillMode: "auto",
    skillIds: [skill.id],
    imageSkills: true,
    messages: body.messages,
  };
  await t.test(
    "image skill is automatically available without a downloaded key or published skill record",
    async () => {
      assert.equal(skill.id, image.id);
      assert.equal(skill.capability.connectionId, image.id);
      assert.equal(skill.status, "published");
      assert.deepEqual(skill.requiredTools, []);
      assert.ok(!JSON.stringify(skills).includes("synthetic-image-api-key"));
      assert.equal(
        platform.store.db.prepare("SELECT count(*) n FROM skills").get()!.n,
        0,
      );
      assert.equal(
        (await req(`/skills/${skill.id}/download`, undefined, employee)).status,
        200,
      );
      assert.equal(
        (await req("/skills", undefined, outsider)).data.some(
          (s: any) => s.id === skill.id,
        ),
        false,
      );
    },
  );
  await t.test(
    "mixed task retains selected chat model and routes the image skill separately",
    async () => {
      decision = { kind: "image", skillIds: [skill.id] };
      const plan = await req("/generate/plan", planBody, employee);
      assert.equal(plan.status, 200);
      assert.equal(plan.data.kind, "chat");
      assert.equal(plan.data.connectionId, chat.id);
      assert.equal(plan.data.imageSkillId, image.id);
      assert.deepEqual(plan.data.skillIds, [skill.id]);
      const result = await req("/generate/chat", body, employee);
      assert.equal(result.status, 200);
      assert.match(result.data.content, /Synthetic written answer/);
      assert.equal(result.data.image, "data:image/png;base64," + png);
      assert.equal(images, 1);
      assert.equal(chats, 1);
    },
  );
  await t.test(
    "ordinary chat does not generate an image even with that skill selected",
    async () => {
      decision = { kind: "chat", skillIds: [skill.id] };
      const plan = await req(
        "/generate/plan",
        {
          ...planBody,
          messages: [{ role: "user", content: "Explain the available tools." }],
        },
        employee,
      );
      assert.equal(plan.data.imageSkillId, undefined);
      assert.equal(plan.data.kind, "chat");
      const { imageSkillId: _, ...plain } = body;
      const result = await req("/generate/chat", plain, employee);
      assert.equal(result.status, 200);
      assert.equal(result.data.image, undefined);
      assert.equal(images, 1);
    },
  );
  await t.test(
    "streamed text appears before image tool, and a large image survives the client stream parser",
    async () => {
      imageBody = Buffer.concat([
        Buffer.from(png, "base64"),
        Buffer.alloc(900000),
      ]).toString("base64");
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = ((input: any, init: any) =>
        input === "/api/generate/chat"
          ? nativeFetch(base + "/generate/chat", {
              ...init,
              headers: { ...init.headers, Cookie: employee },
            })
          : nativeFetch(input, init)) as typeof fetch;
      try {
        const events: any[] = [];
        const result = await streamChat(
          body,
          new AbortController().signal,
          (event) => events.push(event),
        );
        assert.match(result.content, /Synthetic written answer/);
        assert.ok(result.image!.length > 1_000_000);
        assert.equal(result.image, "data:image/png;base64," + imageBody);
        const text = events.findIndex((e) => e.type === "text"),
          tool = events.findIndex(
            (e) => e.type === "tool" && e.status === "running",
          );
        assert.ok(text >= 0 && tool > text);
        assert.equal(events.at(-1).type, "done");
        assert.ok(events.some((e) => e.type === "tool" && e.status === "done"));
      } finally {
        globalThis.fetch = nativeFetch;
        imageBody = png;
      }
    },
  );
  await t.test(
    "image capability composes with an ordinary approved skill",
    async () => {
      const ordinary = await req(
        "/skills",
        {
          name: "Synthetic layout",
          description: "Synthetic layout instructions",
          version: "1.0.0",
          instructions: "synthetic-layout-marker: organize the written answer",
          examples: "Fixture",
          testSummary: "Fixture only",
          requiredTools: [],
          audience: "company",
          targetDepartments: [],
        },
        admin.cookie,
      );
      assert.equal(ordinary.status, 201);
      assert.equal(
        (
          await req(
            `/skills/${ordinary.data.id}/review`,
            { approve: true, note: "Fixture" },
            admin.cookie,
          )
        ).status,
        200,
      );
      decision = { kind: "image", skillIds: [ordinary.data.id, skill.id] };
      const plan = await req(
        "/generate/plan",
        { ...planBody, skillIds: [ordinary.data.id, skill.id] },
        employee,
      );
      assert.deepEqual(plan.data.skillIds, [ordinary.data.id, skill.id]);
      const result = await req(
        "/generate/chat",
        { ...body, skillIds: plan.data.skillIds },
        employee,
      );
      assert.equal(result.status, 200);
      assert.ok(result.data.image);
      assert.ok(
        lastChatMessages.some((message) =>
          message.content.includes("synthetic-layout-marker"),
        ),
      );
    },
  );
  await t.test(
    "missing, forged, cross-department, view-only and manually excluded image capabilities are rejected before generation",
    async () => {
      const before = images;
      for (const [input, cookie, expectedStatus] of [
        [{ ...body, imageSkillId: randomUUID() }, employee, 403],
        [{ ...body, skillIds: [] }, employee, 403],
        [body, outsider, 404],
        [{ ...body, workspaceAccess: "view" }, employee, 403],
      ] as const)
        assert.equal(
          (await req("/generate/chat", input, cookie)).status,
          expectedStatus,
        );
      decision = { kind: "image", skillIds: [] };
      assert.equal(
        (
          await req(
            "/generate/plan",
            { ...planBody, skillMode: "manual", skillIds: [] },
            employee,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await req(
            "/generate/plan",
            { ...planBody, workspaceAccess: "view" },
            employee,
          )
        ).status,
        403,
      );
      assert.equal(images, before);
    },
  );
  await t.test(
    "generation failure keeps streamed text, marks the tool failed and excludes private provider diagnostics",
    async () => {
      imageStatus = 503;
      const result = await req("/generate/chat", body, employee, "POST", true);
      assert.equal(result.status, 200);
      assert.ok(
        result.data.some(
          (e: any) =>
            e.type === "text" && e.text.includes("Synthetic written answer"),
        ),
      );
      assert.ok(
        result.data.some((e: any) => e.type === "tool" && e.status === "error"),
      );
      assert.equal(result.data.at(-1).type, "error");
      assert.ok(
        !JSON.stringify(result.data).includes("private-upstream-diagnostic"),
      );
      assert.equal(
        result.data.some((e: any) => e.image),
        false,
      );
      imageStatus = 200;
    },
  );
  await t.test(
    "stopping the chat cancels the in-flight image API request",
    async () => {
      holdImage = true;
      const started = new Promise<void>((resolve) => {
        onImage = resolve;
      });
      const closed = new Promise<void>((resolve) => {
        onImageClosed = resolve;
      });
      const controller = new AbortController();
      const pending = fetch(base + "/generate/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: employee,
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).then((r) => r.text());
      const rejected = assert.rejects(pending, { name: "AbortError" });
      await started;
      controller.abort();
      await rejected;
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(Error("Image request was not cancelled")),
            3000,
          );
          timer.unref();
        }),
      ]);
      holdImage = false;
      onImage = undefined;
      onImageClosed = undefined;
    },
  );
  await t.test(
    "revoked image authorization is rechecked after the chat answer, then restored with the same skill ID",
    async () => {
      chatGate = new Promise<void>((resolve) => {
        releaseChat = resolve;
      });
      const started = new Promise<void>((resolve) => {
        onChat = resolve;
      });
      const pending = req("/generate/chat", body, employee);
      await started;
      const before = images;
      assert.equal(
        (
          await req(
            "/model-services",
            {
              ...imageConfig,
              serviceId: service.id,
              departments: [other.data.id],
            },
            admin.cookie,
          )
        ).status,
        200,
      );
      releaseChat!();
      chatGate = undefined;
      onChat = undefined;
      assert.equal((await pending).status, 403);
      assert.equal(images, before);
      await req(
        "/model-services",
        { ...imageConfig, serviceId: service.id },
        admin.cookie,
      );
      assert.equal(
        (await req("/skills", undefined, employee)).data.find(
          (s: any) => s.capability,
        )?.id,
        skill.id,
      );
      await req(`/connections/${image.id}`, {}, admin.cookie, "DELETE");
      assert.equal(
        (await req("/skills", undefined, employee)).data.some(
          (s: any) => s.capability,
        ),
        false,
      );
    },
  );
});

test("generated image transport validates data type, format and bounded size", () => {
  assert.equal(
    generatedImage({ data: [{ b64_json: png }] }),
    "data:image/png;base64," + png,
  );
  for (const data of [
    undefined,
    { data: [{ url: "https://untrusted.invalid/image" }] },
    {
      data: [
        { b64_json: Buffer.from("<svg onload=alert(1)>").toString("base64") },
      ],
    },
    { data: [{ b64_json: "!invalid!" }] },
  ])
    assert.throws(() => generatedImage(data));
});
