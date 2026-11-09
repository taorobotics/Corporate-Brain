const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  { join } = require("node:path"),
  { createServer } = require("node:http"),
  { once } = require("node:events");
module.exports = async ({
  js,
  click,
  fill,
  waitFor,
  request,
  capture,
  checks,
  dir,
  win,
}) => {
  const actor = await request("/auth/me"),
    saved = await js(
      `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
    );
  const requestedFolder = join(dir, "company-linked-project");
  await fs.mkdir(requestedFolder);
  const folder = await fs.realpath(requestedFolder);
  await fs.writeFile(join(folder, "README.md"), "LOCAL_PROJECT_IS_NOT_NAS");
  const canonical = await fs.realpath(folder);
  const calls = [];
  let source,
    connection,
    reads = 0;
  const skills = [];
  const originalRead = fs.readFile;
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const b of req) raw += b;
    const body = JSON.parse(raw);
    calls.push(body);
    if (body.messages[0]?.content.includes("You route tasks")) {
      const context = JSON.parse(body.messages[1].content),
        latest = context.messages.at(-1).content;
      const lookup = latest.includes("正文")
        ? {
            knowledge: "read",
            documents: [
              { sourceId: source.id, path: "部门说明.txt", offset: 0 },
            ],
          }
        : latest.includes("技能")
          ? { skills: true }
          : {
              knowledge: "browse",
              directories: [
                {
                  sourceId: source.id,
                  path:
                    latest.includes("打开") || latest.includes("在里面")
                      ? "项目手册"
                      : "",
                  search: latest.includes("找") ? "说明" : "",
                },
              ],
            };
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: "chat",
                  execution: "answer",
                  workspaceContext: false,
                  usePreviousAttachments: false,
                  skillIds: [],
                  companyLookup: lookup,
                }),
              },
            },
          ],
        }),
      );
      return;
    }
    const system = body.messages.find((m) =>
      m.content.startsWith("公司平台实时查询结果"),
    );
    assert.ok(system, "real company context supplied");
    const result = JSON.parse(system.content.split("\n")[1]);
    const content = result.documents?.some((d) => d.content)
      ? result.edit
        ? "# 规范流程修改稿\n\n明确登记需求、分配负责人、验收交付。"
        : "NAS 正文分析：" + result.documents.map((d) => d.content).join("\n")
      : result.skills
        ? "技能中心查询：" +
          result.skills.entries
            .filter((s) => s.name.includes("联动验收"))
            .map((s) => s.name + (s.installed ? "（已安装）" : "（可安装）"))
            .join("、")
        : "公司知识实际目录：" +
          result.directories
            .flatMap((d) => d.entries?.map((e) => e.name) || [])
            .join("、");
    res.setHeader("Content-Type", "text/event-stream");
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
    );
  }).listen(0, "127.0.0.1");
  await once(provider, "listening");
  try {
    source = await request("/admin/knowledge", {
      name: "对话联动验收资料",
      host: "192.168.20.16",
      share: "fixture",
      basePath: "",
      username: "fixture",
      password: "synthetic-nas-fixture",
      departmentIds: [actor.departmentId],
      enabled: true,
    });
    for (const name of ["联动验收写作技能", "联动验收版式技能"]) {
      let s = await request("/skills", {
        name,
        description: "合成联动验收",
        version: "1.0.0",
        instructions: "NEVER_EXECUTE_DURING_CATALOG_QUERY",
        examples: "",
        testSummary: "隔离验收",
        requiredTools: [],
        audience: "company",
        targetDepartments: [],
      });
      s = await request(`/skills/${s.id}/review`, {
        approve: true,
        note: "合成验收",
      });
      skills.push(s);
    }
    connection = await request("/connections", {
      name: "公司能力联动验收模型",
      baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      model: "fixture",
      kind: "chat",
      apiKey: "fixture",
    });
    await js(
      `(async()=>{const s=await window.brainDesktop.readState(${JSON.stringify(actor.id)});s.workspaces.push({id:'company-linked-fixture',name:'联动测试项目',folder:${JSON.stringify(folder)},description:'合成测试',access:'edit'});s.activeWorkspaceId='company-linked-fixture';s.settings.model=${JSON.stringify(connection.id)};s.settings.skillMode='manual';s.settings.skillIds=[${JSON.stringify(skills[0].id)}];s.installed.push(${JSON.stringify(skills[0])});await window.brainDesktop.writeState(${JSON.stringify(actor.id)},s)})()`,
    );
    await js("location.hash='chat';location.reload()");
    await waitFor(
      () =>
        js(
          `document.querySelector('[aria-label="选择模型"]')?.textContent.includes('公司能力联动验收模型')&&!document.querySelector('.entry-experience')`,
        ),
      "company fixture ready",
    );
    fs.readFile = async function (p, ...args) {
      if (String(p).startsWith(canonical)) reads++;
      return originalRead.call(this, p, ...args);
    };
    const send = async (text, marker) => {
      await fill('[aria-label="任务输入"]', text);
      await click("发送任务");
      await waitFor(
        () =>
          js(
            `!document.querySelector('.chat-loading')&&document.body.innerText.includes(${JSON.stringify(marker)})`,
          ),
        marker,
      );
    };
    await send("现在技能中心有哪些技能？", "联动验收版式技能（可安装）");
    assert.equal(calls.length, 2);
    assert.ok(
      !JSON.stringify(calls[1]).includes("NEVER_EXECUTE_DURING_CATALOG_QUERY"),
    );
    assert.equal(reads, 0);
    await capture("company-skills-chat-light.png");
    await send("看看 NAS 里面有什么文件夹？", "公司知识实际目录：");
    assert.equal(calls.length, 4);
    assert.equal(reads, 0);
    assert.ok(!JSON.stringify(calls[3]).includes("LOCAL_PROJECT_IS_NOT_NAS"));
    await capture("company-nas-chat-light.png");
    await send("打开刚才的项目手册", "公司知识实际目录：使用说明.txt");
    assert.equal(calls.length, 6);
    assert.equal(
      JSON.parse(calls[4].messages[1].content).previousCompanyLookup.knowledge,
      "browse",
    );
    await js("location.reload()");
    await waitFor(
      () =>
        js(
          `!document.querySelector('.entry-experience')&&!!document.querySelector('[data-history-title="现在技能中心有哪些技能？"]')`,
        ),
      "company history ready",
    );
    await js(
      `document.querySelector('[data-history-title="现在技能中心有哪些技能？"]').click()`,
    );
    await waitFor(
      () =>
        js(
          `document.body.innerText.includes('公司知识实际目录：使用说明.txt')`,
        ),
      "company history persisted",
    );
    await send("在里面找使用说明", "公司知识实际目录：使用说明.txt");
    await waitFor(() => calls.length === 8, "followup HTTP complete");
    await waitFor(
      () =>
        js(
          `(async()=>{const s=await window.brainDesktop.readState(${JSON.stringify(actor.id)}),c=s.conversations.find(c=>c.workspaceId==='company-linked-fixture');return !document.querySelector('.chat-loading')&&c?.messages.filter(m=>m.role==='assistant').length===4})()`,
        ),
      "followup saved",
    );
    const meta = JSON.parse(calls[6].messages[1].content);
    assert.equal(meta.previousCompanyLookup.directories[0].path, "项目手册");
    const context = JSON.parse(
      calls[7].messages
        .find((m) => m.content.startsWith("公司平台实时查询结果"))
        .content.split("\n")[1],
    );
    assert.equal(context.directories[0].path, "项目手册");
    assert.equal(context.directories[0].search, "说明");
    assert.equal(reads, 0);
    const state = await js(
        `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
      ),
      c = state.conversations.find(
        (c) => c.workspaceId === "company-linked-fixture",
      );
    assert.ok(
      c.messages
        .at(-1)
        .trace.items.some(
          (i) =>
            i.type === "tool" &&
            i.name.startsWith("查询公司知识") &&
            i.status === "done",
        ),
    );
    await send(
      "读取 NAS 部门说明.txt 的正文并分析总结",
      "NAS 正文分析：原始部门流程",
    );
    assert.equal(reads, 0, "NAS body comes from NAS, not the local project");
    assert.equal(calls.length, 10);
    await capture("nas-document-analysis-chat.png");
    fs.readFile = originalRead;
    await js("location.hash='knowledge'");
    await waitFor(
      () =>
        js(
          `document.body.innerText.includes('对话联动验收资料')&&!document.querySelector('.knowledge-loading')`,
        ),
      "NAS source for body preview",
    );
    await js(
      `[...document.querySelectorAll('.knowledge-source')].find(e=>e.textContent.includes('对话联动验收资料')).click()`,
    );
    await waitFor(
      () =>
        js(
          `document.body.innerText.includes('部门说明.txt')&&!document.querySelector('.knowledge-loading')`,
        ),
      "NAS root for document preview",
    );
    await js(
      `[...document.querySelectorAll('.knowledge-entry')].find(e=>e.textContent.includes('部门说明.txt')).click()`,
    );
    await click("读取正文");
    await waitFor(
      () =>
        js(
          `document.querySelector('.knowledge-document pre')?.textContent.includes('原始部门流程')`,
        ),
      "NAS actual body preview",
    );
    await capture("nas-document-preview-light.png");
    const beforeBody = await request(
      "/knowledge/sources/" + source.id + "/document",
      { path: "部门说明.txt" },
    );
    await click("生成修改稿");
    await waitFor(
      () =>
        js(
          `document.querySelector('[aria-label="任务输入"]')?.value.includes('修改稿')&&document.querySelector('.attachment-chip')?.textContent.includes('部门说明.txt')`,
        ),
      "NAS selection reference in new chat",
    );
    await click("发送任务");
    await waitFor(
      () =>
        js(
          `document.querySelector('.chat-production')?.dataset.status==='saved'`,
        ),
      "NAS draft saved to employee workspace",
    );
    const local = await js(
      `window.brainDesktop.production.state(${JSON.stringify(actor.id)})`,
    );
    const receipt = local.receipts.find((r) =>
      r.files.some((f) => f.path.endsWith("修改稿.docx")),
    );
    assert.ok(receipt);
    assert.equal(require("node:path").dirname(receipt.directory), folder);
    for (const file of receipt.files)
      assert.equal(
        require("node:crypto")
          .createHash("sha256")
          .update(await fs.readFile(join(receipt.directory, file.path)))
          .digest("hex"),
        file.sha256,
      );
    assert.match(
      await fs.readFile(join(receipt.directory, "files", "修改稿.md"), "utf8"),
      /明确登记需求/,
    );
    assert.equal(
      (await request("/production")).find((t) => t.id === receipt.id).status,
      "saved",
    );
    const afterBody = await request(
      "/knowledge/sources/" + source.id + "/document",
      { path: "部门说明.txt" },
    );
    assert.equal(afterBody.sha256, beforeBody.sha256);
    await capture("nas-document-draft-saved.png");
    checks.push(
      "NAS body preview, actual streamed analysis, selected-file reference and editable Word/Markdown/provenance drafts: native automatic transfer to the employee project, all receipt hashes match, queue cleaned after acknowledgement and source document hash unchanged; only synthetic NAS and model fixtures",
    );
    checks.push(
      "Company-linked chat queries real authorized skill inventory with installed/available status without executing workflows; NAS root, child-directory and name search use the same protected NAS service; follow-up source/path persists through reload, zero local project scans, real HTTP streams, synthetic data only",
    );
  } finally {
    fs.readFile = originalRead;
    await js(
      `(async()=>{const s=await window.brainDesktop.readState(${JSON.stringify(actor.id)});s.workspaces=${JSON.stringify(saved.workspaces)};s.activeWorkspaceId=${JSON.stringify(saved.activeWorkspaceId)};s.installed=${JSON.stringify(saved.installed)};s.settings=${JSON.stringify(saved.settings)};await window.brainDesktop.writeState(${JSON.stringify(actor.id)},s)})()`,
    );
    if (source)
      await request(
        "/admin/knowledge/" + source.id,
        {
          name: source.name,
          host: source.host,
          share: source.share,
          basePath: source.basePath,
          username: source.username,
          domain: source.domain,
          departmentIds: source.departmentIds,
          enabled: false,
          revision: source.revision,
        },
        "PATCH",
      );
    for (const s of skills) await request(`/skills/${s.id}/disable`, {});
    if (connection)
      await request("/connections/" + connection.id, {}, "DELETE");
    provider.closeAllConnections();
    provider.close();
  }
  await js("location.reload()");
  await waitFor(
    () =>
      js(
        `document.querySelector('[aria-label="选择模型"]')?.textContent.includes('验收模型 B')&&!document.querySelector('.entry-experience')`,
      ),
    "ordinary QA restored",
  );
  await click("新建任务");
};
