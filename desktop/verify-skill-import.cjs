const assert = require("node:assert/strict");
const { zipSync, strToU8 } = require("fflate");
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
  await click("导入技能");
  await waitFor(
    () => js(`!!document.querySelector('[aria-label="GitHub 技能链接"]')`),
    "import form",
  );
  await fill(
    '[aria-label="GitHub 技能链接"]',
    "https://github.com/corporate-qa/import-fixture",
  );
  await click("解析并预览");
  await waitFor(
    () =>
      js(
        `document.querySelector('.skill-import-summary')?.textContent.includes('解析完成')`,
      ),
    "GitHub preview",
  );
  assert.equal(
    await js(
      `document.querySelector('[aria-label="确认技能来源与授权"]').checked`,
    ),
    false,
  );
  assert.equal(
    await js(
      `[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='导入并上架').disabled`,
    ),
    true,
  );
  await js(`document.querySelectorAll('.skill-import details')[0].open=true`);
  assert.equal(
    await js(
      `document.querySelector('.skill-resource-preview').textContent.includes('references/guide.md')`,
    ),
    true,
  );
  await capture("skill-import-github-preview.png");
  win.setContentSize(900, 720);
  await capture("skill-import-narrow-light.png");
  assert.equal(
    await js(
      `document.documentElement.scrollWidth<=innerWidth && document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth`,
    ),
    true,
  );
  win.setContentSize(1586, 992);
  await js(
    `(()=>{const s=document.querySelector('[aria-label="导入技能发布范围"]');s.value='company';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[aria-label="确认技能来源与授权"]').click()})()`,
  );
  await click("导入并上架");
  await waitFor(
    () =>
      js(
        `!document.querySelector('.modal') && [...document.querySelectorAll('.skill-card')].some(c=>c.textContent.includes('GitHub 导入验收'))`,
      ),
    "published imported skill",
  );
  const imported = (await request("/skills")).find(
    (s) => s.name === "GitHub 导入验收",
  );
  assert.equal(imported.imported.commit, "a".repeat(40));
  assert.equal(imported.imported.fileCount, 3);
  await js(
    `(()=>{const c=[...document.querySelectorAll('.skill-card')].find(c=>c.textContent.includes('GitHub 导入验收'));c.querySelector('.card-main').click()})()`,
  );
  await click("查看 LICENSE");
  await waitFor(
    () =>
      js(
        `document.querySelector('.skill-source-details pre')?.textContent.includes('MIT License')`,
      ),
    "preserved license",
  );
  await click("关闭弹窗").catch(() =>
    js(`document.querySelector('.modal .icon-button').click()`),
  );
  await js(`location.hash='settings'`);
  await waitFor(
    () => js(`document.body.innerText.includes('本地记录与备份')`),
    "appearance settings",
  );
  await selectOption("外观", "深色");
  await js(`location.hash='skills'`);
  await waitFor(
    () => js(`document.body.innerText.includes('导入技能')`),
    "skill center",
  );
  await click("导入技能");
  await click("上传 ZIP");
  const bytes = Buffer.from(
    zipSync({
      "nested/SKILL.md": strToU8(
        "---\nname: ZIP 导入验收\ndescription: ZIP 技能上传测试\n---\n这是测试技能的正文，用于检查真实上传、解析和审核流程。",
      ),
      "nested/LICENSE": strToU8(
        "MIT License\nPermission is hereby granted, free of charge.",
      ),
    }),
  ).toString("base64");
  await js(
    `(()=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))],'fixture.zip',{type:'application/zip'}));const input=document.querySelector('[aria-label="技能 ZIP 文件"]');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  );
  await click("解析并预览");
  await waitFor(
    () =>
      js(
        `document.querySelector('.skill-import-summary')?.textContent.includes('解析完成')`,
      ),
    "ZIP preview",
  );
  win.setContentSize(900, 720);
  await capture("skill-import-narrow-dark.png");
  assert.equal(await js(`document.documentElement.dataset.theme`), "dark");
  assert.notEqual(
    await js(
      `getComputedStyle(document.querySelector('.modal')).backgroundColor`,
    ),
    "rgb(255, 255, 255)",
  );
  win.setContentSize(1586, 992);
  await js(
    `document.querySelector('.skill-import-consent input').click();document.querySelector('[aria-label="确认技能来源与授权"]').click()`,
  );
  await click("导入并提交审核");
  await waitFor(() => js(`!document.querySelector('.modal')`), "ZIP submitted");
  assert.equal(
    (await request("/reviews")).find((s) => s.name === "ZIP 导入验收").status,
    "pending",
  );
  await js(`location.hash='settings'`);
  await waitFor(
    () => js(`document.body.innerText.includes('本地记录与备份')`),
    "restore settings",
  );
  await selectOption("外观", "默认（浅色）");
  await js(`location.hash='skills'`);
  await waitFor(
    () => js(`document.body.innerText.includes('导入技能')`),
    "restored skill center",
  );
  await click("全公司");
  await capture("skill-center-imported.png");
  checks.push(
    "GitHub and actual ZIP upload previews preserve references/license, require acknowledgement, publish or submit for review, install locally and fit a dark narrow window",
  );
};
