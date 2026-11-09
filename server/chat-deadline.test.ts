import assert from "node:assert/strict";
import { test } from "node:test";
import { createChatDeadline, ChatTimeoutError } from "./chat-deadline";

test("the default chat policy has no total cutoff while real work continues for hours", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const deadline = createChatDeadline();
  t.after(deadline.dispose);
  for (let i = 0; i < 180; i++) {
    t.mock.timers.tick(60_000);
    deadline.observe({
      type: "reasoning",
      id: "long",
      text: "next",
      append: true,
    });
    assert.equal(deadline.signal.aborted, false, `minute ${i + 1}`);
  }
  t.mock.timers.tick(180_000);
  assert.equal(deadline.signal.reason.kind, "idle");
});

test("production may use an idle-only deadline while real output continues", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const deadline = createChatDeadline({ idleMs: 100, maxMs: null });
  t.after(deadline.dispose);
  for (let i = 0; i < 20; i++) {
    t.mock.timers.tick(90);
    deadline.observe({ type: "text", text: "continued output " + i });
    assert.equal(deadline.signal.aborted, false);
  }
  t.mock.timers.tick(100);
  assert.equal(deadline.signal.reason.kind, "idle");
});

test("active image reasoning and tool work continue beyond the old three-minute cutoff", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const deadline = createChatDeadline();
  t.after(deadline.dispose);
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(100_000);
    deadline.observe(
      i % 2
        ? { type: "tool", id: "image-" + i, name: "read_image", status: "done" }
        : {
            type: "reasoning",
            id: "r",
            text: "已读取图片的下一部分。",
            append: true,
          },
    );
    assert.equal(deadline.signal.aborted, false);
  }
  t.mock.timers.tick(179_999);
  assert.equal(deadline.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.ok(deadline.signal.reason instanceof ChatTimeoutError);
  assert.equal(deadline.signal.reason.kind, "idle");
});

test("empty events cannot keep a stalled provider alive, and an explicitly requested maximum is honored", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stalled = createChatDeadline({ idleMs: 100, maxMs: 500 });
  t.mock.timers.tick(80);
  stalled.observe({ type: "text", text: "" });
  stalled.observe({ type: "reasoning", id: "r", text: " " });
  t.mock.timers.tick(20);
  assert.equal(stalled.signal.reason.kind, "idle");
  const active = createChatDeadline({ idleMs: 100, maxMs: 250 });
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(80);
    active.observe({ type: "text", text: "持续输出" + i });
  }
  assert.equal(active.signal.aborted, false);
  t.mock.timers.tick(10);
  assert.equal(active.signal.reason.kind, "duration");
});

test("completion clears timers and explicit cancellation remains immediate and isolated", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const parent = new AbortController();
  const cancelled = createChatDeadline({ parent: parent.signal });
  const complete = createChatDeadline();
  const other = createChatDeadline();
  complete.dispose();
  parent.abort(new Error("test cancellation"));
  assert.equal(cancelled.signal.reason, parent.signal.reason);
  assert.equal(other.signal.aborted, false);
  complete.observe({ type: "text", text: "late event" });
  t.mock.timers.tick(1_000_000);
  assert.equal(complete.signal.aborted, false);
  assert.equal(other.signal.reason.kind, "idle");
});

test("duplicate text snapshots, reasoning snapshots and tool statuses cannot renew an idle request", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const deadline = createChatDeadline({ idleMs: 100, maxMs: 1000 });
  const events = [
    { type: "text", text: "unchanged" },
    { type: "reasoning", id: "r", text: "unchanged" },
    { type: "tool", id: "call", name: "read_image", status: "done" },
  ] as const;
  for (const event of events) deadline.observe(event);
  t.mock.timers.tick(80);
  for (const event of events) deadline.observe(event);
  t.mock.timers.tick(20);
  assert.equal(deadline.signal.reason.kind, "idle");
});
