// Isolated native UI test using synthetic accounts; no employee records or model calls.
const { app, BrowserWindow } = require("electron"),
  { spawn } = require("node:child_process"),
  fs = require("node:fs/promises"),
  { join, resolve } = require("node:path"),
  { tmpdir } = require("node:os"),
  assert = require("node:assert/strict"),
  sharp = require("sharp");
process.env.BRAIN_VERIFY = "1";
app.disableHardwareAcceleration();
let server,
  dir,
  win,
  failed = false;
const checks = [],
  errors = [];
const wait = async (fn, label, timeout = 45000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timed out: " + label);
};
(async () => {
  try {
    dir = await fs.mkdtemp(join(tmpdir(), "brain-profile-ui-"));
    app.setPath("userData", dir);
    server = spawn("node", ["--import", "tsx", "server/qa.ts"], {
      cwd: resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("QA startup timeout")),
        15000,
      );
      server.once("message", (m) => {
        clearTimeout(timer);
        resolve(m.port);
      });
      server.once("exit", () => reject(Error("QA server exited")));
    });
    const origin = `http://127.0.0.1:${port}`;
    process.env.BRAIN_APP_URL = origin;
    require("./main.cjs");
    await app.whenReady();
    await wait(() => BrowserWindow.getAllWindows().length, "window");
    win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(1280, 900);
    const web = win.webContents;
    web.setBackgroundThrottling(false);
    web.debugger.attach("1.3");
    await web.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
      enabled: true,
    });
    web.on("console-message", (event) => {
      if (
        event.level === "error" &&
        !event.message.includes("Electron Security Warning")
      )
        errors.push(event.message);
    });
    const js = (source) => web.executeJavaScript(source, true);
    const capture = async () => {
      win.showInactive();
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          return await web.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true,
          });
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
    };
    const click = (label) =>
      js(
        `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}||x.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click();return true})()`,
      );
    const fill = (selector, value) =>
      js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
      );
    await wait(
      () => js(`!!document.querySelector('input[name=username]')`),
      "auth",
    );
    await fetch(origin + "/api/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: "头像验收",
        username: "profile-qa",
        name: "资料验收",
        password: "Synthetic-Profile-QA-2026",
      }),
    });
    await js("location.reload();true");
    await wait(
      () =>
        js(
          `!!document.querySelector('input[name=username]')&&!document.querySelector('.entry-form-stage[inert]')`,
        ),
      "login",
    );
    await fill("[name=username]", "profile-qa");
    await fill("[name=password]", "Synthetic-Profile-QA-2026");
    await js('document.querySelector("form").requestSubmit();true');
    await wait(
      () =>
        js(
          `!!document.querySelector('[aria-label="任务输入"]')&&!document.querySelector('.entry-experience')`,
        ),
      "workspace",
    );
    await wait(
      () =>
        js(
          `document.querySelector('.account-trigger img')?.naturalWidth===512`,
        ),
      "default avatar actual asset",
    );
    await js(`location.hash='settings';true`);
    await wait(
      () => js(`!!document.querySelector('.profile-edit-avatar')`),
      "settings",
    );
    await click("编辑个人资料");
    await wait(
      () => js(`document.querySelectorAll('.avatar-option').length===100`),
      "100 choices",
    );
    await fill('[aria-label="搜索头像"]', "柴犬");
    await wait(
      () => js(`document.querySelectorAll('.avatar-option').length===1`),
      "Chinese search",
    );
    await click("柴犬");
    await fill("[name=displayName]", "小柴 · 资料验收");
    await click("保存资料");
    await wait(
      () =>
        js(
          `!document.querySelector('[role=dialog]')&&document.querySelector('.account-trigger strong')?.textContent==='小柴 · 资料验收'`,
        ),
      "saved sidebar",
    );
    assert.equal(
      (await js(`fetch('/api/auth/me').then(r=>r.json())`)).avatar,
      "ipas-054",
    );
    checks.push(
      "New account receives a real local preset; 100 choices, Chinese search and name/avatar save update sidebar and account API",
    );
    await click("编辑个人资料");
    await fill("[name=displayName]", "不应保存");
    await click("随机一个");
    await click("取消");
    assert.equal(
      (await js(`fetch('/api/auth/me').then(r=>r.json())`)).name,
      "小柴 · 资料验收",
    );
    await click("编辑个人资料");
    await fill('[aria-label="搜索头像"]', "Otter");
    await wait(
      () => js(`document.querySelectorAll('.avatar-option').length===4`),
      "English search",
    );
    await fill('[aria-label="搜索头像"]', "");
    const fixture = join(dir, "fixture.png");
    await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#f6b931" },
    })
      .png()
      .toFile(fixture);
    const doc = await web.debugger.sendCommand("DOM.getDocument"),
      node = await web.debugger.sendCommand("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: '[aria-label="上传头像文件"]',
      });
    await web.debugger.sendCommand("DOM.setFileInputFiles", {
      nodeId: node.nodeId,
      files: [fixture],
    });
    await wait(
      () =>
        js(
          `!!document.querySelector('.avatar-crop canvas')&&!([...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='使用此裁剪')?.disabled)`,
        ),
      "crop decoded",
    );
    await fill('[aria-label="头像放大"]', "1.5");
    await fill('[aria-label="头像左右位置"]', "0.3");
    await click("使用此裁剪");
    await click("保存资料");
    await wait(
      () =>
        js(
          `!document.querySelector('[role=dialog]')&&document.querySelector('.account-trigger img')?.src.startsWith('data:image/webp')`,
        ),
      "custom save",
    );
    const user = await js(`fetch('/api/auth/me').then(r=>r.json())`);
    assert.match(user.avatar, /^data:image\/webp;base64,/);
    assert.equal(
      (await sharp(Buffer.from(user.avatar.split(",")[1], "base64")).metadata())
        .width,
      256,
    );
    checks.push(
      "Cancel discards unsaved edits; English search, actual file picker, crop controls and normalized custom avatar persist on server",
    );
    await js("location.reload();true");
    await wait(
      () =>
        js(
          `document.querySelector('.account-trigger strong')?.textContent==='小柴 · 资料验收'&&document.querySelector('.account-trigger img')?.naturalWidth===256&&!document.querySelector('.entry-experience')`,
        ),
      "reload retains profile",
    );
    await js(`location.hash='settings';true`);
    await wait(
      () => js(`!!document.querySelector('.profile-edit-avatar')`),
      "settings reload",
    );
    await click("编辑个人资料");
    await click("柴犬");
    await click("保存资料");
    await wait(
      () =>
        js(
          `!document.querySelector('[role=dialog]')&&document.querySelector('.account-trigger img')?.src.includes('054.webp')`,
        ),
      "restore preset",
    );
    await click("外观");
    await wait(
      () => js(`!!document.querySelector('.select-popup[data-open]')`),
      "theme dropdown",
    );
    await js(
      `Array.from(document.querySelectorAll('[role="option"]')).find(x=>x.querySelector('.select-option-label')?.textContent==='深色').click();true`,
    );
    await wait(
      () =>
        js(
          `document.documentElement.dataset.theme==='dark'&&!document.querySelector('.select-popup[data-open]')`,
        ),
      "actual dark theme",
    );
    win.setMinimumSize(400, 600);
    win.setContentSize(640, 820);
    await click("编辑个人资料");
    await wait(
      () => js(`document.querySelectorAll('.avatar-option').length===100`),
      "narrow gallery",
    );
    await wait(
      () =>
        js(
          `(()=>{const m=document.querySelector('.modal');return m.scrollWidth<=m.clientWidth+2&&document.documentElement.scrollWidth<=innerWidth+2})()`,
        ),
      "narrow layout settles after native window resize",
    );
    await fs.mkdir("artifacts/screenshots", { recursive: true });
    await fs.writeFile(
      "artifacts/screenshots/profile-editor-dark-narrow.png",
      (await capture()).toPNG(),
    );
    await click("取消");
    win.setContentSize(1280, 900);
    await click("外观");
    await wait(
      () => js(`!!document.querySelector('.select-popup[data-open]')`),
      "theme dropdown",
    );
    await js(
      `Array.from(document.querySelectorAll('[role="option"]')).find(x=>x.querySelector('.select-option-label')?.textContent==='浅色').click();true`,
    );
    await wait(
      () =>
        js(
          `document.documentElement.dataset.theme==='light'&&!document.querySelector('.select-popup[data-open]')`,
        ),
      "actual light theme",
    );
    await click("编辑个人资料");
    await fs.writeFile(
      "artifacts/screenshots/profile-editor-light.png",
      (await capture()).toPNG(),
    );
    checks.push(
      "Reload retains server profile; custom avatar can return to preset; 640px dark layout has no horizontal overflow",
    );
    await click("取消");
    await js(
      `fetch('/api/departments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'账号验收二部'})}).then(r=>{if(!r.ok)throw Error('Department creation failed')});true`,
    );
    await js(`location.hash='admin-users';true`);
    await wait(
      () =>
        js(
          `document.querySelector('.admin-page h1')?.textContent==='部门与员工账号'&&document.querySelectorAll('tbody tr').length===1`,
        ),
      "account admin",
    );
    await click("随机开通账号");
    await fill("input[type=number]", "2");
    await fill("[name=adminPassword]", "Synthetic-Profile-QA-2026");
    await js(
      `document.querySelector('[role=dialog] form').requestSubmit();true`,
    );
    await wait(
      () =>
        js(
          `!document.querySelector('[role=dialog]')&&document.querySelectorAll('tbody tr').length===5`,
        ),
      "two random employees per department",
    );
    const employeeUsername = await js(
      `(()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('staff.'));row.querySelectorAll('button')[0].click();return row.cells[1].textContent})()`,
    );
    await wait(
      () => js(`!!document.querySelector('[name=adminPassword]')`),
      "credential reauthentication",
    );
    await fill("[name=adminPassword]", "incorrect-synthetic");
    await click("验证并查看");
    await wait(
      () =>
        js(
          `document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('当前密码不正确')`,
        ),
      "wrong admin password denied",
    );
    assert.equal(
      await js(`!!document.querySelector('[aria-label="员工当前密码"]')`),
      false,
    );
    await fill("[name=adminPassword]", "Synthetic-Profile-QA-2026");
    await click("验证并查看");
    await wait(
      () => js(`!!document.querySelector('[aria-label="员工当前密码"]')`),
      "credential decrypted after verification",
    );
    const initialPassword = await js(
      `document.querySelector('[aria-label="员工当前密码"]').value`,
    );
    await click("隐藏并关闭");
    await fs.writeFile(
      "artifacts/screenshots/accounts-admin-light.png",
      (await capture()).toPNG(),
    );
    checks.push(
      "Account admin randomly creates two employees per department; wrong-password disclosure denied, verified current password revealed and hidden",
    );
    async function logout() {
      await js(
        `fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(()=>{location.hash='chat';location.reload()});true`,
      );
      await wait(
        () =>
          js(
            `!!document.querySelector('input[name=username]')&&!document.querySelector('.entry-form-stage[inert]')`,
          ),
        "signed out",
      );
    }
    async function loginAccount(username, password) {
      await fill("[name=username]", username);
      await fill("[name=password]", password);
      await js('document.querySelector("form").requestSubmit();true');
    }
    await logout();
    await loginAccount(employeeUsername, initialPassword);
    await wait(
      () => js(`!!document.querySelector('[name=current]')`),
      "employee required change",
    );
    assert.ok(
      await js(
        `document.querySelector('[role=dialog]').textContent.includes('公司管理员验证身份后可查看当前密码')`,
      ),
    );
    const changedPassword = "Synthetic-Employee-Changed-2026";
    await fill("[name=current]", initialPassword);
    await fill("[name=password]", changedPassword);
    await js(
      `document.querySelector('[role=dialog] form').requestSubmit();true`,
    );
    await wait(
      () =>
        js(
          `!!document.querySelector('input[name=username]')&&!document.querySelector('.entry-form-stage[inert]')`,
        ),
      "change requires new login",
    );
    await loginAccount(employeeUsername, changedPassword);
    await wait(
      () =>
        js(
          `!!document.querySelector('[aria-label="任务输入"]')&&!document.querySelector('.entry-experience')`,
        ),
      "employee workspace",
    );
    const beforeRename = await js(`fetch('/api/auth/me').then(r=>r.json())`);
    await js(`location.hash='settings';true`);
    await wait(
      () => js(`!!document.querySelector('.profile-edit-avatar')`),
      "employee settings",
    );
    await click("修改登录账号");
    await fill("[name=loginUsername]", "profile-qa");
    await fill("[name=currentPassword]", changedPassword);
    await click("保存登录账号");
    await wait(
      () =>
        js(
          `document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('已被使用')`,
        ),
      "login collision shown",
    );
    await fill("[name=loginUsername]", "employee-renamed");
    await click("保存登录账号");
    await wait(
      () =>
        js(
          `!document.querySelector('[role=dialog]')&&document.querySelector('.profile-heading')?.textContent.includes('employee-renamed')`,
        ),
      "self rename persisted",
    );
    const renamed = await js(`fetch('/api/auth/me').then(r=>r.json())`);
    assert.equal(renamed.id, beforeRename.id);
    assert.equal(renamed.role, "employee");
    assert.equal(renamed.departmentId, beforeRename.departmentId);
    await js(`location.hash='admin-users';true`);
    await wait(
      () => js(`document.body.textContent.includes('此账号没有员工管理权限')`),
      "employee has no admin access",
    );
    await logout();
    await loginAccount("employee-renamed", changedPassword);
    await wait(
      () =>
        js(
          `!!document.querySelector('[aria-label="任务输入"]')&&!document.querySelector('.entry-experience')`,
        ),
      "renamed login works",
    );
    checks.push(
      "Employee changes initial password with company-managed credential notice, renames login with collision handling and keeps identity/department; new login succeeds",
    );
    await logout();
    await loginAccount("profile-qa", "Synthetic-Profile-QA-2026");
    await wait(
      () =>
        js(
          `!!document.querySelector('[aria-label="任务输入"]')&&!document.querySelector('.entry-experience')`,
        ),
      "admin returns",
    );
    await js(`location.hash='admin-users';true`);
    await wait(
      () =>
        js(
          `!!document.querySelector('tbody')&&document.body.textContent.includes('employee-renamed')`,
        ),
      "admin sees new username",
    );
    await js(
      `(()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('employee-renamed'));row.querySelectorAll('button')[0].click();return true})()`,
    );
    await fill("[name=adminPassword]", "Synthetic-Profile-QA-2026");
    await click("验证并查看");
    await wait(
      () => js(`!!document.querySelector('[aria-label="员工当前密码"]')`),
      "admin sees changed password",
    );
    assert.equal(
      await js(`document.querySelector('[aria-label="员工当前密码"]').value`),
      changedPassword,
    );
    await click("隐藏并关闭");
    checks.push(
      "Admin table reflects employee chosen username and current changed password after reauthentication; actual passwords excluded from verification report",
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      "artifacts/profile-verification.json",
      JSON.stringify(
        {
          version: require("../package.json").version,
          result: "passed",
          checks,
          consoleErrors: errors,
          syntheticAccountsOnly: true,
          externalImageRequests: false,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(JSON.stringify({ result: "passed", checks }));
  } catch (e) {
    failed = true;
    console.error(e.stack);
    if (win && !win.isDestroyed()) {
      await fs.mkdir("artifacts/runtime", { recursive: true });
      await fs.writeFile("artifacts/runtime/profile-failure-ui.json", JSON.stringify(await win.webContents.executeJavaScript(`({dialog:document.querySelector('[role=dialog]')?.textContent,rows:document.querySelectorAll('tbody tr').length,fields:[...document.querySelectorAll('[role=dialog] input')].map(x=>({name:x.name,type:x.type,valid:x.checkValidity(),checked:x.checked}))})`), null, 2));
    }
    await fs.mkdir("artifacts", { recursive: true });
    await fs.writeFile(
      "artifacts/profile-verification.json",
      JSON.stringify(
        { result: "failed", error: e.message, checks, consoleErrors: errors },
        null,
        2,
      ),
    );
  } finally {
    if (server) {
      server.send?.("close");
      await new Promise((r) => setTimeout(r, 300));
      server.kill();
    }
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(failed ? 1 : 0);
  }
})();
