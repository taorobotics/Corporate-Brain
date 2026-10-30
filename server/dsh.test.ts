import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DshManager,
  dshPermissionMode,
  dshPresetForMode,
} from "./dsh";

test("DSH modes map to the shipped presets and workspace permissions map to sandbox modes", () => {
  assert.equal(dshPresetForMode("standard"), "standard");
  assert.equal(dshPresetForMode("ptc"), "ptc");
  assert.equal(dshPresetForMode("minimal"), "minimal");
  assert.equal(dshPresetForMode("creative"), "cordis");
  assert.equal(dshPermissionMode("view"), "read-only");
  assert.equal(dshPermissionMode("edit"), "workspace-write");
  assert.equal(dshPermissionMode("full"), "danger-full-access");
});

test("DSH routes an OpenAI-compatible turn and admits an image attachment", async (t) => {
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(body);
    res.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "close",
      "cache-control": "no-cache",
    });
    res.write(
      `data: ${JSON.stringify({
        id: "probe",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", content: "DSH probe OK" } }],
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
  const manager = new DshManager(root);
  t.after(async () => {
    await manager.close();
    server.close();
    await rm(root, { recursive: true, force: true });
  });
  const port = (server.address() as any).port;
  const result = await manager.run({
    connectionId: "connection-test",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: "probe-model",
    apiKey: "probe-key",
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
    ],
  });
  assert.equal(result, "DSH probe OK");
  assert.ok(requests.some((body) => body.includes("probe.png")));
  assert.ok(requests.some((body) => body.includes("notes.txt")));
  assert.ok(requests.some((body) => body.includes("image")));
});
