const assert = require("node:assert/strict");

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
  const actor = await request("/auth/me");
  const prior = await js(
    `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
  );
  const size = win.getContentSize(),
    minimum = win.getMinimumSize();
  const fixture = structuredClone(prior);
  const a = {
    id: "recent-project-a",
    name: "RecentProjectA",
    description: "Synthetic recent chat check",
    folder: null,
    access: "edit",
  };
  const b = { ...a, id: "recent-project-b", name: "RecentProjectB" };
  fixture.workspaces.push(a, b);
  const chat = (id, title, workspaceId, createdAt, at) => ({
    id,
    title,
    workspaceId,
    createdAt,
    messages: at
      ? [{ id: id + "-message", role: "user", content: title, at }]
      : [],
  });
  const old = chat(
    "recent-old",
    "最近验收：旧对话的新消息",
    a.id,
    "2098-01-01T00:00:00Z",
    "2099-01-04T00:00:00Z",
  );
  const newer = chat(
    "recent-new",
    "最近验收：新建的对话",
    b.id,
    "2099-01-03T00:00:00Z",
    "2099-01-03T00:00:00Z",
  );
  const empty = chat(
    "recent-empty",
    "最近验收：空对话",
    a.id,
    "2099-01-02T00:00:00Z",
  );
  fixture.conversations.push(
    empty,
    newer,
    old,
    ...Array.from({ length: 35 }, (_, i) =>
      chat(
        "recent-long-" + i,
        "最近验收：很长的对话标题 " + i + " <img src=x onerror=alert(1)>",
        a.id,
        "2090-01-01T00:00:00Z",
      ),
    ),
  );
  const reload = async (state) => {
    await js(
      `window.brainDesktop.writeState(${JSON.stringify(actor.id)},${JSON.stringify(state)})`,
    );
    await js(`location.hash='chat';location.reload()`);
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.recent-conversations')&&!document.querySelector('.entry-experience')`,
        ),
      "recent sidebar restored",
    );
  };
  const order = () =>
    js(
      `[...document.querySelectorAll('[data-recent-conversation-id]')].map(e=>e.dataset.recentConversationId)`,
    );
  try {
    await reload(fixture);
    assert.deepEqual((await order()).slice(0, 3), [old.id, newer.id, empty.id]);
    assert.equal((await order()).length, fixture.conversations.length);
    assert.equal(
      await js(`document.querySelectorAll('.recent-conversations img').length`),
      0,
    );
    await js(
      `[...document.querySelectorAll('.workspace-collapse[aria-expanded="true"]')].forEach(e=>e.click())`,
    );
    assert.deepEqual((await order()).slice(0, 3), [old.id, newer.id, empty.id]);
    await capture("recent-chats-light.png");
    await js(`document.querySelector('[aria-controls="sidebar-project-list"]').click()`);
    assert.equal(await js(`getComputedStyle(document.querySelector('#sidebar-project-list')).display==='none'&&!document.querySelector('#sidebar-recent-list').hidden`), true);
    await js(`document.querySelector('[aria-controls="sidebar-recent-list"]').click()`);
    assert.equal(await js(`getComputedStyle(document.querySelector('#sidebar-recent-list')).display==='none'`), true);
    await waitFor(() => js(`window.brainDesktop.readState(${JSON.stringify(actor.id)}).then(s=>s.settings.sidebarProjectsCollapsed===true&&s.settings.sidebarRecentCollapsed===true)`), 'section collapse preferences saved');
    await js(`location.reload()`);
    await waitFor(() => js(`!document.querySelector('.entry-experience')&&document.querySelector('#sidebar-project-list')?.hidden&&document.querySelector('#sidebar-recent-list')?.hidden`), 'both collapsed sections restored');
    await capture('sidebar-sections-collapsed.png');
    win.webContents.focus();
    await js(`document.querySelector('[aria-controls="sidebar-recent-list"]').focus()`);
    assert.equal(await js(`document.activeElement.getAttribute('aria-controls')`), 'sidebar-recent-list');
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(() => js(`document.querySelector('[aria-controls="sidebar-recent-list"]').getAttribute('aria-expanded')==='true'`), 'keyboard expands recent chats');
    assert.equal(await js(`document.querySelector('#sidebar-project-list').hidden`), true);
    await js(`document.querySelector('[aria-controls="sidebar-project-list"]').click()`);
    const beforeCollapse = await js(`document.querySelector('#sidebar-project-list').getBoundingClientRect().height`);
    await js(`document.querySelector('[aria-controls="sidebar-recent-list"]').click()`);
    assert.equal(await js(`document.querySelector('#sidebar-project-list').getBoundingClientRect().height>${beforeCollapse}`), true);
    await js(`document.querySelector('[aria-controls="sidebar-recent-list"]').click()`);
    checks.push('Projects and recent chat sections independently collapse, release unused space, persist per local account across reload, preserve visible search and support native keyboard activation without deleting chats');
    await fill(".history-search", "recentprojectb");
    assert.deepEqual(await order(), [newer.id]);
    await js(
      `document.querySelector('[data-recent-conversation-id="${newer.id}"]').click()`,
    );
    await waitFor(
      () =>
        js(
          `document.querySelector('.chat-project-name')?.textContent===${JSON.stringify(b.name)}`,
        ),
      "recent chat restores owning project",
    );
    assert.equal(
      await js(
        `document.querySelector('[data-recent-conversation-id="${newer.id}"]').getAttribute('aria-current')`,
      ),
      "page",
    );
    await fill(".history-search", "no-recent-chat-matches");
    assert.deepEqual(await order(), []);
    assert.equal(
      await js(
        `document.querySelector('.recent-conversations').innerText.includes('没有匹配的对话')`,
      ),
      true,
    );
    await fill(".history-search", "");
    await js(`location.hash='settings'`);
    await waitFor(
      () => js(`!!document.querySelector('[aria-label="外观"]')`),
      "recent appearance settings",
    );
    await selectOption("外观", "深色");
    await click("对话");
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.recent-conversations')&&document.documentElement.dataset.theme==='dark'`,
        ),
      "actual recent dark theme",
    );
    win.setMinimumSize(600, 600);
    win.setContentSize(700, 760);
    assert.equal(
      await js(
        `(()=>{const s=document.querySelector('.sidebar').getBoundingClientRect(),r=document.querySelector('.recent-conversations').getBoundingClientRect(),p=document.querySelector('.project-conversations').getBoundingClientRect();return r.height>80&&p.height>0&&r.bottom<=s.bottom+1&&document.documentElement.scrollWidth<=innerWidth})()`,
      ),
      true,
    );
    assert.equal(
      await js(
        `document.querySelector('.recent-conversations').scrollHeight>document.querySelector('.recent-conversations').clientHeight`,
      ),
      true,
    );
    await js(`document.querySelector('.recent-conversations').scrollTop=400`);
    assert.equal(
      await js(`document.querySelector('.recent-conversations').scrollTop>0`),
      true,
    );
    await capture("recent-chats-dark-narrow.png");
    fixture.conversations.find((c) => c.id === empty.id).messages = [
      {
        id: "recent-resume",
        role: "user",
        content: "再次继续旧对话",
        at: "2099-02-01T00:00:00Z",
      },
    ];
    await reload(fixture);
    assert.equal((await order())[0], empty.id);
    await reload({ ...fixture, conversations: [] });
    assert.equal(
      await js(
        `document.querySelector('.recent-conversations').innerText.includes('还没有对话')`,
      ),
      true,
    );
    checks.push(
      "Recent chats: all local project conversations sorted by last message across projects, stable creation fallback and reload; collapsed projects do not hide recents, title/project search and no-match/empty states, owning project and selected chat restored, markup remains plain text; separate scrolling and actual dark 700px layout; synthetic records only",
    );
  } finally {
    win.setMinimumSize(...minimum);
    win.setContentSize(...size);
    await reload(prior);
  }
};
