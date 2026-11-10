// Runs inside the existing disposable Electron + HTTP verification session.
const assert = require("node:assert/strict");
const { clipboard } = require("electron");
module.exports = async ({
  js,
  click,
  fill,
  waitFor,
  request,
  selectOption,
  capture,
  checks,
}) => {
  assert.deepEqual(
    await js(
      `Array.from(document.querySelectorAll('.message-actions .message-action'), button => button.getAttribute('aria-label'))`,
    ),
    ["复制回答", "有帮助", "没有帮助", "分享回答", "回答详情"],
  );
  await click("回答详情");
  await waitFor(
    () => js(`!!document.querySelector('.answer-details .message-meta')`),
    "answer details retain actual token metadata",
  );
  await js(`document.querySelector('.modal [aria-label="关闭弹窗"]').click()`);
  await click("复制回答");
  await waitFor(
    () => js(`document.body.innerText.includes('已复制')`),
    "copy success acknowledgement",
  );
  await waitFor(
    async () =>
      (await clipboard.readText()) === "这是隔离验收回复，未调用真实模型。",
    "answer copied to native clipboard",
  );
  await click("有帮助");
  await waitFor(
    () =>
      js(
        `document.querySelector('.message-action[aria-label="有帮助"]')?.getAttribute('aria-pressed') === 'true'`,
      ),
    "positive feedback acknowledged",
  );
  assert.equal((await request("/admin/feedback")).total, 1);
  await click("没有帮助");
  await waitFor(
    () => js(`!!document.querySelector('.feedback-consent input')`),
    "feedback dialog",
  );
  assert.equal(
    await js(`document.querySelector('.feedback-consent input').checked`),
    false,
  );
  await selectOption("问题类型", "内容不准确");
  await fill(
    '[aria-label="反馈说明"]',
    "隔离验收反馈：希望补充依据 <img src=x onerror=alert(1)>",
  );
  await js(`document.querySelector('.feedback-consent input').click()`);
  await capture("answer-feedback.png");
  await click("提交反馈");
  await waitFor(
    () => js(`!document.querySelector('.modal')`),
    "feedback saved",
  );
  const list = await request("/admin/feedback");
  assert.equal(list.total, 1);
  assert.equal(list.rows[0].rating, "unhelpful");
  const detail = await request(`/admin/feedback/${list.rows[0].id}`);
  assert.equal(detail.context.question, "加载项验收：等待完成后再回复");
  assert.equal(detail.context.answer, "这是隔离验收回复，未调用真实模型。");
  assert.ok(!JSON.stringify(detail).includes("先比较平台功能"));
  await click("分享回答");
  await waitFor(() => js(`!!document.querySelector('.modal')`), "share dialog");
  await click("复制分享内容");
  await waitFor(
    async () =>
      (await clipboard.readText()) === "这是隔离验收回复，未调用真实模型。",
    "share copied to native clipboard",
  );
  await js(`document.querySelector('.modal [aria-label="关闭弹窗"]').click()`);
  // Return to the same conversation via existing navigation after reviewing admin UI.
  await js(`location.hash='admin-feedback'`);
  await waitFor(
    () =>
      js(
        `document.querySelector('.feedback-table tbody')?.textContent.includes('隔离验收反馈')`,
      ),
    "feedback table receives actual submission",
  );
  assert.equal(
    await js(`!!document.querySelector('.feedback-table img')`),
    false,
  );
  await capture("admin-answer-feedback.png");
  await click("查看反馈");
  await waitFor(
    () => js(`!!document.querySelector('[aria-label="内部处理备注"]')`),
    "feedback details",
  );
  await selectOption("处理状态", "已处理");
  await fill('[aria-label="内部处理备注"]', "隔离验收：已核对显示与反馈链路");
  await click("保存处理结果");
  await waitFor(
    () =>
      js(
        `!document.querySelector('.modal') && document.querySelector('.feedback-status')?.textContent === '已处理'`,
      ),
    "handling state persisted",
  );
  await selectOption("反馈状态", "待处理");
  await waitFor(
    () =>
      js(
        `document.querySelector('.feedback-admin')?.textContent.includes('暂无符合条件')`,
      ),
    "status filter excludes resolved feedback",
  );
  await js(`location.hash='chat'`);
  await waitFor(
    () => js(`!!document.querySelector('[aria-label="任务输入"]')`),
    "return to chat",
  );
  await click("加载项验收：等待完成后再回复");
  await waitFor(
    () =>
      js(
        `document.querySelector('.message-action[aria-label="没有帮助"]')?.getAttribute('aria-pressed') === 'true'`,
      ),
    "feedback selection survives page navigation",
  );
  // Issue feedback remains editable through the single thumbs-down entry.
  await click("没有帮助");
  await selectOption("评价", "问题反馈");
  await click("提交反馈");
  await waitFor(() => js(`!document.querySelector('.modal')`), "issue saved");
  assert.equal((await request("/admin/feedback")).rows[0].rating, "issue");
  assert.equal(
    await js(
      `document.querySelector('.message-action[aria-label="没有帮助"]').getAttribute('aria-pressed')`,
    ),
    "true",
  );
  await click("没有帮助");
  await waitFor(
    () =>
      js(`document.querySelector('.modal')?.textContent.includes('问题反馈')`),
    "issue rating retained when reopened through thumbs down",
  );
  await capture("answer-feedback-single-entry.png");
  await js(`document.querySelector('.modal [aria-label="关闭弹窗"]').click()`);
  await capture("answer-actions-single-feedback.png");
  checks.push(
    "Five answer actions including actual model/token details and a single thumbs-down feedback entry; native copy/share, helpful/unhelpful and issue feedback editing, opt-in question/answer snapshot without reasoning, deduplicated real feedback API, escaped admin table, filters and persisted handling status",
  );
};
