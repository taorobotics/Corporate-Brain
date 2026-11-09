import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { zipSync, unzipSync, strToU8 } from "fflate";
import {
  prepareGithub,
  prepareZip,
  parseGithubUrl,
  safePackagePath,
  prepareUrl,
  publicSkillUrl,
} from "./skill-import";
import { createPlatform } from "./platform";
import { materializeSkill } from "./skill-library";

const skill =
  "---\nname: import-fixture\ndescription: Import fixture with references\nmetadata:\n  version: 1.2.3\n---\nRead references/guide.md to help with the user's task.\n";
const license =
  "MIT License\nCopyright (c) Test author\nPermission is hereby granted, free of charge, to any person obtaining a copy.\n";
const archive = (extra: Record<string, string> = {}) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries({
          "pack/SKILL.md": skill,
          "pack/LICENSE": license,
          "pack/references/guide.md": "Useful guide, preserved verbatim.",
          ...extra,
        }).map(([p, value]) => [p, strToU8(value)]),
      ),
    ),
  );

test("ZIP skills preserve references and license, reject unsafe paths, duplicates and damaged payloads", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "brain-import-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = async () => mkdtemp(join(root, "stage-"));
  const result = await prepareZip(archive(), await stage(), "fixture.zip");
  assert.equal(result.candidates[0].version, "1.2.3");
  assert.equal(result.candidates[0].entry, "SKILL.md");
  assert.equal(result.source.fileCount, 3);
  assert.match(result.source.license, /MIT/);
  for (const path of [
    "../escape",
    "a/../../escape",
    "C:/x",
    "a\\x",
    "a//b",
    "a/NUL.txt",
    "a/b.",
    ".env",
    "nested/private.key",
    "node_modules/pkg/index.js",
    ".corporate-manifest.json",
  ])
    assert.throws(() => safePackagePath(path));
  for (const extra of [
    { "pack/../escape.txt": "No" },
    { "pack/skill.md": skill },
    { "pack/reference": "file", "pack/reference/file.md": "collision" },
    { "pack/.env": "SECRET=anything" },
  ] as Record<string, string>[])
    await assert.rejects(() =>
      stage().then((dir) => prepareZip(archive(extra), dir, "bad.zip")),
    );
  const corrupt = archive();
  const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupt.writeUInt32LE(0, central + 16);
  await assert.rejects(
    () => stage().then((dir) => prepareZip(corrupt, dir, "crc.zip")),
    /校验/,
  );
  const symlink = archive();
  const centralLink = symlink.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  symlink.writeUInt32LE(0xa1ff0000, centralLink + 38);
  await assert.rejects(
    () => stage().then((dir) => prepareZip(symlink, dir, "link.zip")),
    /链接/,
  );
  await assert.rejects(
    () =>
      stage().then((dir) =>
        prepareZip(
          archive({ "pack/bomb.txt": "a".repeat(2_000_000) }),
          dir,
          "bomb.zip",
        ),
      ),
    /压缩比/,
  );
  await assert.rejects(
    () =>
      stage().then((dir) =>
        prepareZip(Buffer.from("not zip"), dir, "broken.zip"),
      ),
    /ZIP/,
  );
  await assert.rejects(
    () =>
      stage().then((dir) =>
        prepareZip(
          archive({
            "pack/SKILL.md":
              "---\nname: [not-a-string]\ndescription: bad\n---\nLong enough content",
          }),
          dir,
          "invalid.zip",
        ),
      ),
    /名称/,
  );
});

test("public skill links validate redirects, block private egress, bound downloads and support ZIP or Markdown", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "brain-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = () => mkdtemp(join(root, "stage-"));
  for (const url of [
    "http://public.example/x.zip",
    "https://127.0.0.1/x",
    "https://192.168.20.21/x",
    "https://[::1]/x",
    "https://localhost/x",
    "https://nas.local/x",
    "https://user:pass@example.com/x",
    "https://example.com/x?token=private",
    "file:///x",
    "https://example.com:8443/x",
  ])
    assert.throws(() => publicSkillUrl(url));
  let calls = 0;
  const result = await prepareUrl(
    "https://skills.example/pack.zip",
    await stage(),
    async (input, init) => {
      assert.equal(init?.redirect, "manual");
      assert.ok((init as any).dispatcher, "socket uses public-DNS guard");
      calls++;
      if (calls === 1)
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://cdn.example/pack.zip?signature=transient",
          },
        });
      assert.match(String(input), /signature=/);
      return new Response(Uint8Array.from(archive()));
    },
  );
  assert.equal(result.source.kind, "url");
  assert.equal(
    result.source.url,
    "https://skills.example/pack.zip",
    "redirect credentials are not stored",
  );
  assert.equal(result.files.length, 3);
  await assert.rejects(
    () =>
      stage().then((dir) =>
        prepareUrl(
          "https://skills.example/pack.zip",
          dir,
          async () =>
            new Response(null, {
              status: 302,
              headers: { location: "https://127.0.0.1/secret" },
            }),
        ),
      ),
    /公网|公开/,
  );
  const md = await prepareUrl(
    "https://skills.example/SKILL.md",
    await stage(),
    async () => new Response(skill),
  );
  assert.equal(md.candidates[0].name, "import-fixture");
  assert.equal(md.source.licenseFiles.length, 0);
  for (const response of [
    new Response("<html>Login</html>", {
      headers: { "Content-Type": "text/html" },
    }),
    new Response("x", {
      headers: { "Content-Length": String(33 * 1024 * 1024) },
    }),
    new Response("not found", { status: 404 }),
  ])
    await assert.rejects(() =>
      stage().then((dir) =>
        prepareUrl("https://skills.example/file", dir, async () => response),
      ),
    );
  await assert.rejects(
    () =>
      stage().then((dir) =>
        prepareUrl(
          "https://skills.example/loop",
          dir,
          async () =>
            new Response(null, { status: 302, headers: { location: "/loop" } }),
        ),
      ),
    /重定向/,
  );
});

test("ordinary projects produce an untested editable skill scaffold and preserve README, code and license", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "brain-project-skill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from(
    zipSync({
      "demo/README.md": strToU8("# Demo\n\nRead assets and run the renderer."),
      "demo/renderer.mjs": strToU8(
        "throw Error('must not execute during import')",
      ),
      "demo/LICENSE": strToU8(license),
    }),
  );
  const result = await prepareZip(bytes, root, "demo.zip");
  assert.equal(result.candidates[0].entry, "SKILL.md");
  assert.match(result.candidates[0].instructions, /README.md/);
  assert.match(result.candidates[0].instructions, /尚未试运行/);
  assert.equal(
    await readFile(join(root, "renderer.mjs"), "utf8"),
    "throw Error('must not execute during import')",
  );
  assert.equal(result.source.hasScripts, true);
  assert.equal(result.source.fileCount, 4);
});

test("GitHub imports pin commits, verify blobs, restrict URLs and preserve directory licenses", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "brain-github-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const commit = "a".repeat(40),
    blobs = {
      "skills/example/SKILL.md": skill,
      "skills/example/references/guide.md": "A guide",
      LICENSE: license,
    };
  const tree = Object.entries(blobs).map(([path, text]) => ({
    type: "blob",
    mode: "100644",
    path,
    size: Buffer.byteLength(text),
    sha: createHash("sha1")
      .update(`blob ${Buffer.byteLength(text)}\0`)
      .update(text)
      .digest("hex"),
  }));
  const urls: string[] = [];
  const mock: typeof fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    assert.equal(init?.redirect, "error");
    if (url.endsWith("/repos/example/repo"))
      return Response.json({ default_branch: "main" });
    if (url.endsWith("/commits/main")) return Response.json({ sha: commit });
    if (url.includes("/git/trees/")) return Response.json({ tree });
    const name = url.split(`/${commit}/`)[1];
    return new Response(blobs[name as keyof typeof blobs]);
  };
  const result = await prepareGithub(
    "https://github.com/example/repo/tree/main/skills/example",
    root,
    mock,
  );
  assert.equal(result.source.commit, commit);
  assert.ok(result.source.licenseFiles.includes("REPOSITORY-LICENSE"));
  assert.equal(
    await readFile(join(root, "references/guide.md"), "utf8"),
    "A guide",
  );
  assert.ok(
    urls
      .filter((u) => u.includes("raw.githubusercontent"))
      .every((u) => u.includes(commit)),
  );
  for (const url of [
    "http://github.com/a/b",
    "https://evil.test/a/b",
    "https://github.com:8443/a/b",
    "https://user:pass@github.com/a/b",
    "https://github.com/a/b?token=bad",
    "https://github.com/a/b/tree/main/%2e%2e/escape",
    "https://github.com/a/b/blob/main/SKILL.md",
  ])
    assert.throws(() => parseGithubUrl(url));
  const second = await mkdtemp(join(tmpdir(), "brain-corrupt-"));
  t.after(() => rm(second, { recursive: true, force: true }));
  await assert.rejects(
    () =>
      prepareGithub(
        "https://github.com/example/repo",
        second,
        async (input, init) =>
          String(input).includes("raw.githubusercontent")
            ? new Response("tampered")
            : mock(input, init),
      ),
    /完整性/,
  );
});

test("visual import API enforces authentication, preview ownership, review scope, resource integrity and revoked use", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "brain-library-"));
  const platform = createPlatform({
    database: ":memory:",
    skillLibrary: { root },
    origins: ["https://company.example"],
  });
  const server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await platform.library.close();
    platform.store.close();
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const request = async (
    path: string,
    body?: any,
    cookie = "",
    method = body === undefined ? "GET" : "POST",
    origin?: string,
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined
          ? {}
          : {
              "Content-Type": Buffer.isBuffer(body)
                ? "application/zip"
                : "application/json",
            }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body:
        body === undefined
          ? undefined
          : Buffer.isBuffer(body)
            ? Uint8Array.from(body).buffer
            : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: response.headers.get("content-type")?.includes("application/zip")
        ? Buffer.from(await response.arrayBuffer())
        : await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  const password = "Skill-Import-QA-Password";
  await request("/bootstrap", {
    companyName: "Admin",
    username: "admin",
    name: "Admin",
    password,
  });
  const admin = (await request("/auth/login", { username: "admin", password }))
    .cookie;
  const dep = (await request("/departments", { name: "Design" }, admin)).data;
  const create = await request(
    "/users",
    { username: "employee", name: "Employee", departmentId: dep.id },
    admin,
  );
  let employee = (
    await request("/auth/login", {
      username: "employee",
      password: create.data.initialPassword,
    })
  ).cookie;
  await request(
    "/auth/password",
    { current: create.data.initialPassword, password },
    employee,
  );
  employee = (await request("/auth/login", { username: "employee", password }))
    .cookie;
  assert.equal((await request("/skill-imports/zip", archive())).status, 401);
  assert.equal(
    (
      await request(
        "/skill-imports/zip",
        archive(),
        admin,
        "POST",
        "https://evil.test",
      )
    ).status,
    403,
  );
  const preview = await request(
    "/skill-imports/zip?name=fixture.zip",
    archive(),
    admin,
  );
  assert.equal(preview.status, 200);
  const id = preview.data.id;
  assert.equal(
    (
      await request(
        `/skill-imports/${id}/file?path=LICENSE`,
        undefined,
        employee,
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(`/skill-imports/${id}`, {}, employee, "DELETE")).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/skill-imports/${id}/file?path=..%2Fsecret`,
        undefined,
        admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request(`/skill-imports/${id}/file?path=LICENSE`, undefined, admin))
      .data.content,
    license,
  );
  const selection = {
    entry: "SKILL.md",
    audience: "department",
    publish: true,
    acknowledge: true,
  };
  const edits = {
    name: "Edited import fixture",
    description: "Edited description",
    version: "2.0.0",
    instructions:
      "Read references/guide.md, then explain the verified steps to the user.",
    examples: "A deliberately selected example.",
    testSummary: "API fixture validation only; no rendering performed.",
    requiredTools: ["node"],
  };
  assert.equal(
    (
      await request(
        `/skill-imports/${id}/export`,
        { entry: "SKILL.md", edits },
        employee,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/skill-imports/${id}/export`,
        { entry: "../secret", edits },
        admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/skill-imports/${id}/export`,
        {
          entry: "SKILL.md",
          edits: {
            ...edits,
            instructions: "api_key=private-value-should-not-export",
          },
        },
        admin,
      )
    ).status,
    400,
  );
  const exported = await request(
    `/skill-imports/${id}/export`,
    { entry: "SKILL.md", edits },
    admin,
  );
  assert.equal(exported.status, 200);
  const packed = unzipSync(exported.data);
  assert.equal(Buffer.from(packed.LICENSE).toString(), license);
  assert.equal(
    Buffer.from(packed["references/guide.md"]).toString(),
    "Useful guide, preserved verbatim.",
  );
  assert.match(
    Buffer.from(packed["SKILL.md"]).toString(),
    /Edited import fixture/,
  );
  assert.match(
    Buffer.from(packed["SKILL.md"]).toString(),
    /A deliberately selected example/,
  );
  assert.equal(Object.keys(packed).length, 3);
  assert.equal(
    (await request(`/skill-imports/${id}/file?path=SKILL.md`, undefined, admin))
      .data.content,
    skill,
    "export leaves original preview intact",
  );
  const manual = await request("/skill-packages/export", edits, employee);
  assert.equal(manual.status, 200);
  const manualZip = unzipSync(manual.data);
  assert.ok(manualZip["LICENSE.txt"]);
  assert.ok(manualZip["SKILL.md"]);
  assert.equal((await request("/skill-packages/export", edits)).status, 401);
  assert.equal(
    (
      await request(
        `/skill-imports/${id}/commit`,
        { ...selection, acknowledge: false },
        admin,
      )
    ).status,
    400,
  );
  const imported = await request(
    `/skill-imports/${id}/commit`,
    selection,
    admin,
  );
  assert.equal(imported.status, 201);
  const item = imported.data;
  assert.equal(item.status, "published");
  assert.equal(item.imported.fileCount, 3);
  assert.equal(
    (await request(`/skills/${item.id}/download`, undefined, employee)).status,
    404,
  );
  assert.equal(
    (await request(`/skills/${item.id}/resources`, undefined, employee)).status,
    404,
  );
  const resource = await platform.library.resources(item.imported);
  const workspace = join(root, "test-workspace");
  await mkdir(workspace);
  const materialized = await materializeSkill(resource, workspace);
  assert.equal(
    await readFile(join(materialized, "references/guide.md"), "utf8"),
    "Useful guide, preserved verbatim.",
  );
  const duplicate = await request("/skill-imports/zip", archive(), admin);
  assert.equal(
    (
      await request(
        `/skill-imports/${duplicate.data.id}/commit`,
        selection,
        admin,
      )
    ).status,
    409,
  );
  await request(`/skill-imports/${duplicate.data.id}`, {}, admin, "DELETE");
  const empPreview = await request("/skill-imports/zip", archive(), employee);
  assert.equal(
    (
      await request(
        `/skill-imports/${empPreview.data.id}/commit`,
        selection,
        employee,
      )
    ).status,
    403,
  );
  const submitted = await request(
    `/skill-imports/${empPreview.data.id}/commit`,
    { ...selection, publish: false, edits },
    employee,
  );
  assert.equal(submitted.status, 201);
  assert.equal(submitted.data.status, "pending");
  assert.equal(submitted.data.name, edits.name);
  assert.equal(submitted.data.version, edits.version);
  assert.equal(submitted.data.testSummary, edits.testSummary);
  assert.equal(submitted.data.imported.fileCount, 3);
  const editedResources = await platform.library.resources(
    submitted.data.imported,
  );
  const editedManifest = await readFile(
    join(editedResources.root, "SKILL.md"),
    "utf8",
  );
  assert.match(editedManifest, /version: 2.0.0/);
  assert.equal(
    await readFile(join(editedResources.root, "LICENSE"), "utf8"),
    license,
  );
  assert.equal(
    (
      await request(
        `/skills/${submitted.data.id}/download`,
        undefined,
        employee,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/skills/${submitted.data.id}/review`,
        { approve: true, note: "QA review" },
        admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/skills/${submitted.data.id}/download`,
        undefined,
        employee,
      )
    ).status,
    200,
  );
  const connection = await request(
    "/connections",
    {
      name: "QA",
      baseUrl: "https://example.invalid/v1",
      model: "fixture",
      kind: "chat",
      apiKey: "fixture-placeholder",
      departments: [],
    },
    admin,
  );
  assert.equal(connection.status, 201);
  await request(`/skills/${submitted.data.id}/disable`, {}, admin);
  assert.equal(
    (
      await request(
        "/generate/chat",
        {
          connectionId: connection.data.id,
          skillId: submitted.data.id,
          messages: [{ role: "user", content: "Use skill" }],
        },
        employee,
      )
    ).status,
    404,
  );
  await writeFile(join(resource.root, "references/guide.md"), "tampered");
  await assert.rejects(() => materializeSkill(resource, workspace), /被修改/);
});
