import { test } from "node:test";
import assert from "node:assert/strict";
import { readChatResponse } from "./chat-stream";
import {
  parseProductionOutput,
  validateAnimation,
  productionCompletionBody,
  productionCompletionText,
  completeProduction,
  appendProductionPart,
  ProductionOutputError,
} from "./production-output";

test("production requests stream using provider thinking defaults and reject truncated output even when JSON parses", () => {
  for (const model of [
    "deepseek-flash",
    "deepseek-v4-pro",
    "another-provider",
  ]) {
    const body = productionCompletionBody(model, []);
    assert.equal(body.stream, true);
    assert.equal("thinking" in body, false);
    assert.equal(
      body.max_tokens,
      model.startsWith("deepseek") ? 256000 : undefined,
    );
  }
  assert.throws(
    () =>
      productionCompletionText({
        choices: [
          {
            finish_reason: "length",
            message: { content: '{"source":"partial"}' },
          },
        ],
      }),
    /截断/,
  );
  assert.equal(
    productionCompletionText({
      choices: [{ finish_reason: "stop", message: { content: "complete" } }],
    }),
    "complete",
  );
});

test("truncated JSON continues across escaped source boundaries and checkpoints the complete output", async () => {
  const source =
    'async function render(ctx,t){ctx.fillText("你好\\nworld",0,0);}\n' +
    "// complete animation\n".repeat(1500);
  const expected = JSON.stringify({ source });
  const split = expected.indexOf("\\nworld") + 1;
  const parts = [
    expected.slice(0, split),
    expected.slice(split, split + 12000),
    expected.slice(split + 12000),
  ];
  const bodies: any[] = [],
    saved: string[] = [],
    continuations: number[] = [];
  const value = await completeProduction({
    model: "deepseek-flash",
    messages: [{ role: "user", content: "create a long animation" }],
    signal: new AbortController().signal,
    request: async (body) => {
      bodies.push(body);
      const index = bodies.length - 1;
      return Response.json({
        choices: [
          {
            finish_reason: index < 2 ? "length" : "stop",
            message: { content: parts[index] },
          },
        ],
      });
    },
    updates: {
      checkpoint: async (text) => {
        saved.push(text);
      },
      continuing: (n) => {
        continuations.push(n);
      },
    },
  });
  assert.equal(value, expected);
  assert.equal(validateAnimation(parseProductionOutput(value)), source);
  assert.deepEqual(continuations, [1, 2]);
  assert.equal(saved.at(-1), expected);
  assert.equal(
    bodies[2].messages.filter((m: any) => m.role === "assistant").length,
    1,
  );
  assert.equal(
    bodies[2].messages.find((m: any) => m.role === "assistant").content,
    parts[0] + parts[1],
  );
  assert.equal(
    appendProductionPart(
      "x".repeat(40) + "known-overlap".repeat(5),
      "known-overlap".repeat(5) + "tail",
    ),
    "x".repeat(40) + "known-overlap".repeat(10) + "tail",
  );
});

test("reasoning-only length can continue, but identical unfinished output does not loop forever", async () => {
  let calls = 0;
  const value = await completeProduction({
    model: "deepseek-flash",
    messages: [],
    signal: new AbortController().signal,
    request: async () => {
      calls++;
      return Response.json({
        choices: [
          {
            finish_reason: calls === 1 ? "length" : "stop",
            message: {
              content: calls === 1 ? "" : '{"source":"complete"}',
              reasoning_content: "actual provider reasoning",
            },
          },
        ],
      });
    },
  });
  assert.equal(value, '{"source":"complete"}');
  let repeated = 0;
  const partial = '{"source":"' + "same fragment ".repeat(8);
  await assert.rejects(
    completeProduction({
      model: "fixture",
      messages: [],
      signal: new AbortController().signal,
      request: async () => {
        repeated++;
        return Response.json({
          choices: [{ finish_reason: "length", message: { content: partial } }],
        });
      },
    }),
    (error: any) =>
      error instanceof ProductionOutputError &&
      !error.repairable &&
      /未补充/.test(error.message),
  );
  assert.equal(repeated, 3);
});

test("stream interruption preserves the last draft, and cancellation prevents continuation", async () => {
  const partial = '{"source":"unfinished',
    saved: string[] = [];
  await assert.rejects(
    completeProduction({
      model: "fixture",
      messages: [],
      signal: new AbortController().signal,
      updates: {
        checkpoint: async (text) => {
          saved.push(text);
        },
        continuing: () => {},
      },
      request: async () =>
        new Response(
          "data: " +
            JSON.stringify({ choices: [{ delta: { content: partial } }] }) +
            "\n\n",
          { headers: { "content-type": "text/event-stream" } },
        ),
    }),
    /连接中断/,
  );
  assert.equal(saved.at(-1), partial);
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    completeProduction({
      model: "fixture",
      messages: [],
      signal: controller.signal,
      request: async () => {
        calls++;
        controller.abort(Error("employee stopped"));
        return Response.json({
          choices: [{ finish_reason: "length", message: { content: partial } }],
        });
      },
    }),
    /employee stopped/,
  );
  assert.equal(calls, 1);
});
test("animation validation catches broken JSON and syntax without executing generated source", () => {
  assert.throws(() => parseProductionOutput('{"source":"cut'), /不完整/);
  assert.throws(
    () =>
      validateAnimation({ source: "async function render(ctx,t){ broken( }" }),
    /语法/,
  );
  const source =
    "globalThis.__productionMustNotRun=true;async function render(ctx,t){}";
  assert.equal(
    validateAnimation(
      parseProductionOutput("```json\n" + JSON.stringify({ source }) + "\n```"),
    ),
    source,
  );
  assert.equal((globalThis as any).__productionMustNotRun, undefined);
});

test("streamed reasoning-only truncation reaches production validation and remains retryable", async () => {
  const events: unknown[] = [];
  const result = await readChatResponse(
    Response.json({
      choices: [
        {
          finish_reason: "length",
          message: { reasoning_content: "实际模型思考", content: "" },
        },
      ],
    }),
    (event) => events.push(event),
    { allowEmpty: true },
  );
  assert.deepEqual(events[0], {
    type: "reasoning",
    id: "direct-reasoning",
    text: "实际模型思考",
    append: false,
  });
  assert.throws(
    () =>
      productionCompletionText({
        choices: [
          {
            finish_reason: result.finishReason,
            message: { content: result.content },
          },
        ],
      }),
    /截断/,
  );
});
