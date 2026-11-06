const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  symlink,
  stat,
} = require("node:fs/promises");
const { tmpdir } = require("node:os"),
  { join } = require("node:path"),
  { randomUUID, createHash } = require("node:crypto");
const {
  ProductionLocal,
  safePath,
  checkedDirectory,
} = require("./production.cjs");
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "brain-local-production-"));
  const output = join(dir, "employee");
  await mkdir(output);
  let acks = 0,
    downloads = 0,
    corrupt = false,
    offline = false,
    loseAck = false;
  const content = [
    Buffer.from("original material"),
    Buffer.from("source code"),
    Buffer.from("synthetic video data"),
  ];
  const files = content.map((c, i) => ({
    path: ["materials/素材.txt", "code/main.js", "output/video.mp4"][i],
    size: c.length,
    sha256: createHash("sha256").update(c).digest("hex"),
  }));
  const id = randomUUID(),
    token = "a".repeat(64);
  const file = join(dir, "profile/production.json");
  const options = {
    file,
    origin: "https://company.example",
    verify: async () => {
      if (offline) throw Error("offline");
    },
    fetch: async (url, request) => {
      if (url.endsWith("/manifest"))
        return Response.json({
          task: { id, deviceId: (await local.state()).deviceId },
          files,
          token,
        });
      if (url.endsWith("/ack")) {
        acks++;
        const body = JSON.parse(request.body);
        assert.deepEqual(body.files, files);
        assert.equal(body.token, token);
        if (loseAck) throw Error("lost response");
        return Response.json({ status: "saved" });
      }
      const i = Number(url.split("/").at(-1));
      downloads++;
      return new Response(corrupt && i === 1 ? "corrupt" : content[i]);
    },
  };
  const local = new ProductionLocal(options);
  await local.choose(output);
  t.after(async () => await rm(dir, { recursive: true, force: true }));
  return {
    dir,
    output,
    local,
    options,
    id,
    files,
    state: () => ({ acks, downloads }),
    corrupt: (value) => {
      corrupt = value;
    },
    offline: (value) => {
      offline = value;
    },
    loseAck: (value) => {
      loseAck = value;
    },
  };
}
test("native collector persists all files before ACK and recovers interrupted transfers without re-downloading valid files", async (t) => {
  const f = await fixture(t);
  f.corrupt(true);
  await assert.rejects(f.local.collect(f.id), /校验/);
  assert.equal(f.state().acks, 0);
  f.corrupt(false);
  const restarted = new ProductionLocal(f.options),
    receipt = await restarted.collect(f.id);
  assert.equal(f.state().acks, 1);
  assert.equal(f.state().downloads, 4);
  for (const file of f.files)
    assert.equal(
      createHash("sha256")
        .update(await readFile(join(receipt.directory, file.path)))
        .digest("hex"),
      file.sha256,
    );
  assert.equal((await restarted.state()).receipts.length, 1);
});
test("lost ACK responses recover from durable receipts and offline identity never acknowledges deletion", async (t) => {
  const f = await fixture(t);
  f.loseAck(true);
  await assert.rejects(f.local.collect(f.id), /lost response/);
  assert.equal((await f.local.state()).receipts.length, 1);
  f.loseAck(false);
  f.offline(true);
  await assert.rejects(new ProductionLocal(f.options).collect(f.id), /offline/);
  assert.equal(f.state().acks, 1);
  f.offline(false);
  await new ProductionLocal(f.options).collect(f.id);
  assert.equal(f.state().acks, 2);
  assert.equal(f.state().downloads, 3);
});
test("modified local results never get overwritten or authorize server deletion", async (t) => {
  const f = await fixture(t);
  f.corrupt(true);
  await assert.rejects(f.local.collect(f.id));
  const config = JSON.parse(await readFile(f.options.file, "utf8"));
  await writeFile(
    join(config.pending[f.id].directory, "materials/素材.txt"),
    "employee edits",
  );
  f.corrupt(false);
  await assert.rejects(f.local.collect(f.id), /修改/);
  assert.equal(f.state().acks, 0);
});
test("unsafe manifest paths and junction escapes are rejected", async (t) => {
  for (const path of [
    "../a",
    "/etc/a",
    "a\\b",
    "a:stream",
    "aux",
    "lpt1.txt",
    "a/./b",
  ])
    assert.throws(() => safePath(path));
  const f = await fixture(t),
    outside = join(f.dir, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    join(f.output, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(checkedDirectory(f.output, "link/sub"), /链接/);
  await assert.rejects(stat(join(outside, "sub")), { code: "ENOENT" });
});

test("preview reads only verified saved output from this profile and never executes source", async (t) => {
  const f = await fixture(t);
  await f.local.collect(f.id);
  const source = await f.local.preview(f.id, "code/main.js");
  assert.equal(source.mime, "text/plain");
  assert.equal(source.content, "source code");
  const video = await f.local.preview(f.id, "output/video.mp4");
  assert.equal(Buffer.from(video.bytes).toString(), "synthetic video data");
  await assert.rejects(
    f.local.preview(randomUUID(), "code/main.js"),
    /只能预览/,
  );
  await assert.rejects(f.local.preview(f.id, "../outside"), /不安全/);
  await assert.rejects(f.local.preview(f.id, "materials/素材.txt"), /只能预览/);
  const receipt = (await f.local.state()).receipts[0];
  await writeFile(join(receipt.directory, "code/main.js"), "employee edit");
  await assert.rejects(f.local.preview(f.id, "code/main.js"), /变化|修改/);
});

test("saved chat GIF files preview as images while HTML source remains inert text", async (t) => {
  const f = await fixture(t);
  const receipt = await f.local.collect(f.id);
  const config = JSON.parse(await readFile(f.options.file, "utf8"));
  const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    ),
    html = Buffer.from("<script>throw Error('must not execute')</script>");
  await mkdir(join(receipt.directory, "files"));
  for (const [name, bytes] of [
    ["sticker.gif", gif],
    ["index.html", html],
  ]) {
    await writeFile(join(receipt.directory, "files", name), bytes);
    config.receipts[0].files.push({
      path: "files/" + name,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await writeFile(f.options.file, JSON.stringify(config));
  const image = await f.local.preview(f.id, "files/sticker.gif");
  assert.equal(image.mime, "image/gif");
  assert.deepEqual(Buffer.from(image.bytes), gif);
  const text = await f.local.preview(f.id, "files/index.html");
  assert.equal(text.mime, "text/plain");
  assert.equal(text.content, html.toString());
  await writeFile(
    join(receipt.directory, "files/sticker.gif"),
    Buffer.alloc(gif.length),
  );
  await assert.rejects(f.local.preview(f.id, "files/sticker.gif"), /变化|修改/);
});
