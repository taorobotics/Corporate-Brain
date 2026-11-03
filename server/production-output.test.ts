import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseProductionOutput,
  validateAnimation,
  productionCompletionBody,
  productionCompletionText,
} from "./production-output";

test("DeepSeek production requests disable thinking and reject a truncated response even when JSON parses", () => {
  assert.deepEqual(productionCompletionBody("deepseek-flash", []).thinking, {
    type: "disabled",
  });
  assert.deepEqual(productionCompletionBody("deepseek-v4-pro", []).thinking, {
    type: "disabled",
  });
  assert.equal(
    productionCompletionBody("another-provider", []).thinking,
    undefined,
  );
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
