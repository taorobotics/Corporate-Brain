import assert from "node:assert/strict";
import { test } from "node:test";
import { messageTime } from "./message-time";

test("question times use the employee's local clock and retain the original instant", () => {
  const sent = new Date(2026, 10, 6, 17, 0, 9);
  const result = messageTime(sent.toISOString(), new Date(2026, 10, 6, 18));
  assert.equal(result?.clock, "17:00");
  assert.equal(result?.label, "今天 17:00");
  assert.equal(result?.iso, sent.toISOString());
  assert.match(result!.title, /17:00:09$/);
});
test("yesterday follows calendar boundaries across months and years", () => {
  assert.equal(
    messageTime(
      new Date(2025, 11, 31, 15, 31).toISOString(),
      new Date(2026, 0, 1, 1),
    )?.label,
    "昨天 15:31",
  );
});
test("older dates retain their date and midnight uses 00 instead of 24", () => {
  assert.equal(
    messageTime(
      new Date(2026, 10, 3, 0, 5).toISOString(),
      new Date(2026, 10, 6),
    )?.label,
    "11月3日 00:05",
  );
  assert.equal(
    messageTime(
      new Date(2025, 10, 3, 8, 9).toISOString(),
      new Date(2026, 10, 6),
    )?.label,
    "2025年11月3日 08:09",
  );
});
test("missing or damaged legacy times do not invent a send time", () => {
  for (const value of [undefined, null, 0, {}, "", " ", "legacy-unknown"])
    assert.equal(messageTime(value), null);
});
