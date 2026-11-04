import { test } from "node:test";
import assert from "node:assert/strict";
import { readChatResponse } from "./chat-stream";
import {
  parseProductionOutput,
  validateAnimation,
  productionCompletionBody,
  productionCompletionText,
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
