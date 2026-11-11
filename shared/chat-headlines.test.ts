import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_HEADLINES, pickChatHeadline } from "./chat-headlines";

test("new-chat copy contains exactly the ten approved comma-free titles", () => {
  assert.equal(CHAT_HEADLINES.length, 10);
  assert.equal(new Set(CHAT_HEADLINES).size, 10);
  for (const text of CHAT_HEADLINES) {
    assert.ok(text.endsWith("？"));
    assert.doesNotMatch(text, /[,，]/);
  }
  assert.deepEqual(
    new Set(CHAT_HEADLINES.map((_, i) => pickChatHeadline(null, () => i / 10))),
    new Set(CHAT_HEADLINES),
  );
});

test("every approved title can follow every other one without immediately repeating", () => {
  for (const previous of CHAT_HEADLINES) {
    const available = Array.from({ length: 9 }, (_, i) =>
      pickChatHeadline(previous, () => i / 9),
    );
    assert.equal(new Set(available).size, 9);
    assert.ok(available.every((text) => text !== previous));
  }
  assert.equal(
    pickChatHeadline("outdated copy", () => 0),
    CHAT_HEADLINES[0],
  );
  assert.equal(
    pickChatHeadline(null, () => 0.999999),
    CHAT_HEADLINES[9],
  );
});
