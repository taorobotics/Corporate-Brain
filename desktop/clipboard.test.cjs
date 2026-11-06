const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { writeClipboard } = require("./clipboard.cjs");

test("copy writes the original text and accepts OS line-ending normalization", async () => {
  const text = "原文 **Markdown**\n第二行";
  let written;
  await writeClipboard(
    {
      writeText: async (value) => {
        written = value;
      },
      readText: async () => written.replace(/\n/g, "\r\n"),
    },
    text,
  );
  assert.equal(written, text);
});
test("copy recovers from transient clipboard ownership without false success", async () => {
  let writes = 0;
  await writeClipboard(
    {
      writeText: () => {
        writes++;
        if (writes === 1) throw Error("busy");
      },
      readText: () => (writes >= 3 ? "提问" : "old"),
    },
    "提问",
  );
  assert.equal(writes, 3);
});
test("persistent clipboard failure stops after five attempts and rejects", async () => {
  let writes = 0;
  await assert.rejects(
    writeClipboard({ writeText: () => writes++, readText: () => "" }, "提问"),
    /剪贴板暂时不可用/,
  );
  assert.equal(writes, 5);
});
test("invalid or oversized copy input is rejected before clipboard access", async () => {
  const forbidden = {
    writeText: () => assert.fail("invalid input reached clipboard"),
  };
  await assert.rejects(writeClipboard(forbidden, null), /复制内容无效/);
  await assert.rejects(
    writeClipboard(forbidden, "x".repeat(2_000_001)),
    /过大/,
  );
});
