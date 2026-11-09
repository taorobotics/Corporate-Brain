const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { dialog } = require("electron");
const { unzipSync, zipSync, strToU8 } = require("fflate");

module.exports = async ({
  js,
  click,
  fill,
  waitFor,
  request,
  capture,
  checks,
  win,
  selectOption,
}) => {
  const field = async (label, value) => {
    const selector = await js(
      `(()=>{const l=[...document.querySelectorAll('.modal .field')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(label)});const i=l?.querySelector('input,textarea');if(!i)throw Error('Missing editor field');i.id='qa-skill-edit';return '#qa-skill-edit'})()`,
    );
    await fill(selector, value);
    await js(`document.querySelector('#qa-skill-edit').removeAttribute('id')`);
  };
  await click("创建技能");
  await click("GitHub / 其他链接");
  await fill(
    '[aria-label="GitHub 技能链接"]',
    "https://github.com/corporate-qa/import-fixture",
  );
  await click("解析并预览");
  await waitFor(
    () => js(`!!document.querySelector('.skill-import-summary')`),
    "editor GitHub preview",
  );
  await click("使用此来源制作技能");
  await waitFor(
    () => js(`!!document.querySelector('.skill-source-attached')`),
    "external source attached",
  );
  assert.equal(
    await js(`!!document.querySelector('.source-list')`),
    false,
    "external import does not select conversations",
  );
  await field("技能名称", "外部技能编辑验收");
  await field("版本", "2.3.4");
  await field(
    "可复用流程（Markdown，可编辑）",
    "先阅读 references/guide.md，再根据用户的目标整理输入、执行步骤和质量检查。此次编辑用于验证完整技能打包与资源保留。",
  );
  await capture("skill-editor-external-source.png");
  const dir = await fs.mkdtemp(join(tmpdir(), "brain-skill-export-"));
  const file = join(dir, "skill.zip"),
    original = dialog.showSaveDialog;
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  try {
    await click("导出 ZIP");
    await waitFor(
      () =>
        fs
          .stat(file)
          .then(() => true)
          .catch(() => false),
      "actual native ZIP save",
    );
    const files = unzipSync(await fs.readFile(file));
    const text = Buffer.from(files["SKILL.md"]).toString();
    assert.match(text, /外部技能编辑验收/);
    assert.match(text, /version: 2.3.4/);
    assert.ok(files["references/guide.md"]);
    assert.match(Buffer.from(files.LICENSE).toString(), /MIT License/);
    assert.equal(Object.keys(files).length, 3);
  } finally {
    dialog.showSaveDialog = original;
    await fs.rm(dir, { recursive: true, force: true });
  }
  await click("保存草稿");
  await click("关闭弹窗");
  await js("location.reload()");
  await waitFor(
    () => js(`document.body.innerText.includes('创建技能')`),
    "reload skills",
  );
  await click("我创建的");
  await js(
    `[...document.querySelectorAll('.skill-card')].find(c=>c.querySelector('h3')?.textContent==='外部技能编辑验收').click()`,
  );
  await waitFor(
    () => js(`!!document.querySelector('.skill-source-attached')`),
    "external draft restores source",
  );
  await click("下一步");
  await field(
    "测试摘要（说明真实测试输入、结果与局限）",
    "隔离验收：实际解析、编辑、导出 ZIP、检查原许可与参考资料保留；未调用付费模型或执行项目脚本。",
  );
  await click("下一步");
  assert.equal(
    await js(
      `[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='提交审核').disabled`,
    ),
    true,
  );
  await js(
    `document.querySelector('.upload-manifest input[type=checkbox]').click()`,
  );
  await click("提交审核");
  await waitFor(
    () => js(`!document.querySelector('.modal')`),
    "edited external skill submitted",
  );
  const submitted = (await request("/reviews")).find(
    (s) => s.name === "外部技能编辑验收",
  );
  assert.equal(submitted.status, "pending");
  assert.equal(submitted.version, "2.3.4");
  assert.equal(submitted.imported.fileCount, 3);
  assert.match(
    (await request(`/skills/${submitted.id}/resources?path=SKILL.md`)).content,
    /version: 2.3.4/,
  );
  checks.push(
    "Skill creation imports GitHub into an editable draft, saves and restores provenance, exports a real local ZIP with references/license, and requires authorization before submitting edited content for review",
  );

  await click("创建技能");
  await click("上传 ZIP");
  const bytes = Buffer.from(
    zipSync({
      "project/README.md": strToU8(
        "# Renderer\n\nRead the guide, validate input and produce a local animation with renderer.mjs.",
      ),
      "project/renderer.mjs": strToU8(
        "throw Error('this script must not run during import')",
      ),
      "project/LICENSE": strToU8(
        "MIT License\nPermission is hereby granted, free of charge.",
      ),
    }),
  ).toString("base64");
  await js(
    `(()=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))],'project.zip',{type:'application/zip'}));const i=document.querySelector('[aria-label="技能 ZIP 文件"]');i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  );
  await click("解析并预览");
  await waitFor(
    () => js(`!!document.querySelector('.skill-import-summary')`),
    "ordinary project ZIP preview",
  );
  await click("使用此来源制作技能");
  await waitFor(
    () => js(`!!document.querySelector('.skill-source-attached')`),
    "ordinary project draft",
  );
  assert.equal(
    await js(
      `document.querySelector('.skill-source-attached').textContent.includes('SKILL.md')`,
    ),
    true,
  );
  assert.equal(
    await js(
      `document.querySelector('.skill-editor textarea[rows="10"]').value.includes('尚未试运行')`,
    ),
    true,
  );
  await click("保存草稿");
  await click("关闭弹窗");
  await js("location.hash='settings'");
  await waitFor(
    () => js(`document.body.innerText.includes('本地记录与备份')`),
    "theme settings",
  );
  await selectOption("外观", "深色");
  await js("location.hash='skills'");
  await waitFor(
    () => js(`document.body.innerText.includes('创建技能')`),
    "dark skill center",
  );
  await click("我创建的");
  await js(
    `[...document.querySelectorAll('.skill-card')].find(c=>c.querySelector('h3')?.textContent==='project').click()`,
  );
  await waitFor(
    () => js(`!!document.querySelector('.skill-source-attached')`),
    "dark restored ZIP draft",
  );
  win.setContentSize(900, 720);
  assert.equal(
    await js(
      `document.documentElement.scrollWidth<=innerWidth && document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth`,
    ),
    true,
  );
  await capture("skill-editor-external-dark-narrow.png");
  win.setContentSize(1586, 992);
  await click("关闭弹窗");
  await js("location.hash='settings'");
  await waitFor(
    () => js(`document.body.innerText.includes('本地记录与备份')`),
    "restore appearance",
  );
  await selectOption("外观", "默认（浅色）");
  await js("location.hash='skills'");
  checks.push(
    "Ordinary project ZIP creates an explicitly untested editable skill scaffold without executing scripts; saved resources restore in a dark narrow editor without overflow",
  );
};
