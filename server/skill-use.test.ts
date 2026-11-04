import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Skill } from "../shared/types";
import type { SkillResources } from "./skill-library";
import {
  resolveSkillList,
  skillInstructions,
  pickRoutedSkills,
  skillReferences,
} from "./skill-use";

const a = {
  id: randomUUID(),
  name: "文案",
  instructions: "先整理受众，再撰写正文。",
  requiredTools: [],
  status: "published",
} as unknown as Skill;
const b = {
  ...a,
  id: randomUUID(),
  name: "排版",
  instructions: "为正文制作清晰的标题层级。",
};
const hidden = { ...a, id: randomUUID(), name: "其他部门资料" };
const disabled = { ...a, id: randomUUID(), status: "disabled" } as Skill;
const unavailable = {
  ...a,
  id: randomUUID(),
  requiredTools: ["unconfigured-tool"],
};
const all = [a, b, hidden, disabled, unavailable];
const resolve = (ids: string[], strict = true) =>
  resolveSkillList(ids, all, (skill) => skill.id !== hidden.id, strict);

test("multi-skill resolution preserves user order, deduplicates and never widens authorization", () => {
  assert.deepEqual(
    resolve([b.id, a.id, b.id]).map((s) => s.id),
    [b.id, a.id],
  );
  for (const value of [hidden.id, disabled.id, randomUUID()])
    assert.throws(() => resolve([a.id, value]), /无权|停用/);
  assert.throws(() => resolve([unavailable.id]), /工具/);
  assert.deepEqual(
    resolve(
      [a.id, hidden.id, disabled.id, unavailable.id, randomUUID()],
      false,
    ).map((s) => s.id),
    [a.id],
  );
  assert.deepEqual(resolve([]), []);
  assert.throws(() => resolve(Array.from({ length: 17 }, randomUUID)), /最多/);
});
test("verified skill references stay within the total budget and exclude entry, binary and executable files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "brain-skill-references-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contents = {
    "SKILL.md": "ALREADY IN INSTRUCTIONS",
    "guide.md": "Reference text ".repeat(2000),
    "bad.txt": "binary\0data",
    "setup.js": "EXECUTABLE",
    "large.txt": "x".repeat(200001),
  };
  const files = [];
  for (const [path, value] of Object.entries(contents)) {
    const bytes = Buffer.from(value);
    await writeFile(join(root, path), bytes);
    files.push({
      path,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const resource = {
    root,
    files,
    source: { label: "Reference fixture", entry: "SKILL.md" },
  } as SkillResources;
  const full = await skillReferences([resource], 18000);
  assert.ok(full.includes("Reference text"));
  for (const excluded of [
    "ALREADY IN INSTRUCTIONS",
    "binary",
    "EXECUTABLE",
    "large.txt",
  ])
    assert.ok(!full.includes(excluded));
  for (const budget of [0, -5, 30, 101, 300, 12001]) {
    const text = await skillReferences(
      [{ ...resource, source: { ...resource.source, label: "L".repeat(400) } }],
      budget,
    );
    assert.ok(
      text.length <= Math.max(0, budget),
      `budget ${budget} exceeded by ${text.length}`,
    );
  }
  await writeFile(join(root, "guide.md"), "tampered");
  await assert.rejects(skillReferences([resource], 18000), /被修改/);
});
test("automatic skill selection admits only supplied installed candidates and combines multiple skills", () => {
  assert.deepEqual(pickRoutedSkills([a.id, b.id, a.id], [a, b]), [a.id, b.id]);
  assert.deepEqual(pickRoutedSkills(undefined, [a, b]), []);
  assert.throws(() => pickRoutedSkills([hidden.id], [a, b]), /未安装|无权/);
  assert.throws(
    () => pickRoutedSkills(Array.from({ length: 17 }, randomUUID), []),
    /最多/,
  );
});
test("all selected instructions reach the model with permission boundaries and an explicit size limit", () => {
  const text = skillInstructions([a, b]);
  for (const skill of [a, b])
    assert.ok(text.includes(skill.name) && text.includes(skill.instructions));
  assert.match(text, /不能扩大/);
  assert.equal(skillInstructions([]), "");
  assert.throws(
    () => skillInstructions([{ ...a, instructions: "x".repeat(80001) }]),
    /过长/,
  );
});
