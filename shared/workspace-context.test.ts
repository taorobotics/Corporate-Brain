import { test } from "node:test";
import assert from "node:assert/strict";
import { modelAttachments, validateAttachmentBudget } from "./attachments";
import {
  workspaceAttachments,
  type WorkspaceSnapshot,
} from "./workspace-context";

const file = (name: string, content: string) => ({
  name,
  content,
  size: Buffer.byteLength(content),
});
const snapshot = (
  files: WorkspaceSnapshot["files"],
  extra: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot => ({
  root: "代码项目",
  files,
  skipped: 0,
  truncated: false,
  ...extra,
});

test("multi-megabyte folders become bounded excerpts with an honest file inventory and key project files first", () => {
  const large = snapshot([
    file("package-lock.json", "LOCK-FIXTURE ".repeat(100000)),
    file("src/generated.ts", "GENERATED-FIXTURE ".repeat(100000)),
    file("README.md", "PROJECT-OVERVIEW-FIXTURE"),
    file("package.json", '{"name":"workspace-regression-fixture"}'),
    file("src/main.ts", "SOURCE-ENTRY-FIXTURE"),
  ]);
  assert.ok(
    large.files.reduce((sum, f) => sum + f.content.length, 0) > 2_000_000,
  );
  const result = workspaceAttachments(large);
  const prepared = modelAttachments(result);
  assert.equal(result.length, 1);
  assert.ok(
    prepared[0].content.length <= 120000,
    "including warnings and summary, the request stays under the shared text budget",
  );
  for (const f of large.files) assert.ok(result[0].content.includes(f.name));
  for (const text of [
    "PROJECT-OVERVIEW-FIXTURE",
    "workspace-regression-fixture",
    "SOURCE-ENTRY-FIXTURE",
  ])
    assert.ok(result[0].content.includes(text));
  assert.ok(
    result[0].content.indexOf("PROJECT-OVERVIEW-FIXTURE") <
      result[0].content.indexOf("LOCK-FIXTURE"),
  );
  assert.match(result[0].warnings!.join(" "), /节选|未读取/);
  assert.match(result[0].content, /不能直接访问|只读/);
  validateAttachmentBudget(prepared);
});

test("file and total excerpt limits never silently claim the whole repository was read", () => {
  const files = Array.from({ length: 48 }, (_, i) =>
    file(`src/file-${i}.ts`, "中".repeat(50000)),
  );
  const result = workspaceAttachments(
    snapshot(files, { skipped: 12, truncated: true }),
  );
  assert.ok(modelAttachments(result)[0].content.length <= 120000);
  assert.match(result[0].warnings!.join(" "), /扫描/);
  assert.match(result[0].warnings!.join(" "), /12/);
  assert.match(result[0].warnings!.join(" "), /未读取/);
  assert.match(result[0].content, /src\/file-47.ts/);
  assert.ok(
    !result[0].content.includes("中".repeat(20001)),
    "single files are excerpted too",
  );
  const small = workspaceAttachments(
    snapshot([file("README.md", "完整小文件")]),
  );
  assert.ok(small[0].content.includes("完整小文件"));
  assert.deepEqual(small[0].warnings, []);
});

test("workspace pictures yield to explicit uploads, file slots and remaining visual budgets", () => {
  const picture = (name: string, image = "data:image/png;base64,YQ==") => ({
    ...file(name, ""),
    image,
  });
  const data = snapshot([
    picture("one.png"),
    picture("two.png"),
    picture("three.png"),
  ]);
  assert.equal(
    workspaceAttachments(data).length,
    3,
    "at most two automatic pictures accompany the manifest",
  );
  const existing = Array.from({ length: 7 }, (_, i) => ({
    name: `upload-${i}.txt`,
    content: "explicit upload",
  }));
  const oneSlot = workspaceAttachments(data, existing);
  assert.equal(oneSlot.length, 1);
  assert.match(oneSlot[0].warnings!.join(" "), /图片/);
  assert.deepEqual(
    workspaceAttachments(data, [
      ...existing,
      { name: "eighth.txt", content: "explicit" },
    ]),
    [],
  );
  const manyFrames = [
    {
      name: "video.mp4",
      content: "",
      images: Array.from({ length: 16 }, () => ({
        label: "frame",
        image: "data:image/png;base64,YQ==",
      })),
    },
  ];
  assert.equal(workspaceAttachments(data, manyFrames).length, 1);
  const fullImage = {
    name: "large.png",
    content: "",
    image: "x".repeat(9_999_990),
  };
  assert.equal(workspaceAttachments(data, [fullImage]).length, 1);
});

test("empty folders and long filenames stay valid and do not invent contents", () => {
  const empty = workspaceAttachments(snapshot([]));
  assert.match(empty[0].summary!, /0/);
  const long = workspaceAttachments(
    snapshot(
      [
        file("src/" + "a".repeat(400) + ".txt", "actual text"),
        {
          ...file("img/" + "b".repeat(400) + ".png", ""),
          image: "data:image/png;base64,YQ==",
        },
      ],
      { root: "项目".repeat(200) },
    ),
  );
  for (const attachment of long) assert.ok(attachment.name.length <= 200);
  assert.ok(modelAttachments(long)[0].content.length <= 120000);
  const imported = workspaceAttachments(
    snapshot(
      Array.from({ length: 200 }, (_, i) =>
        file(`${i}/` + "a".repeat(600), "imported"),
      ),
    ),
  );
  assert.ok(modelAttachments(imported)[0].content.length <= 120000);
  assert.match(imported[0].warnings!.join(" "), /清单仅显示|名称/);
});
