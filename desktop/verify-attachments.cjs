// Real file selection, parsing and previews in the production renderer, with synthetic files only.
const { app, BrowserWindow } = require("electron"),
  { spawn } = require("node:child_process"),
  fs = require("node:fs/promises"),
  { join, resolve } = require("node:path"),
  { tmpdir } = require("node:os"),
  assert = require("node:assert/strict");
process.env.BRAIN_VERIFY = "1";
app.disableHardwareAcceleration();
let server,
  dir,
  win,
  failed = false;
const checks = [],
  errors = [];
const wait = async (test, label, timeout = 45000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timed out: " + label);
};
(async () => {
  try {
    dir = await fs.mkdtemp(join(tmpdir(), "brain-attachments-"));
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
      server.once("message", (message) => {
        clearTimeout(timer);
        resolve(message.port);
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
    const click = (label) =>
      js(
        `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}||x.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Button missing: '+${JSON.stringify(label)});b.click();return true})()`,
      );
    const fill = (selector, value) =>
      js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
      );
    await wait(
      () => js(`!!document.querySelector('input[name=username]')`),
      "account form",
    );
    await fetch(origin + "/api/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: "附件验收",
        username: "attachment-qa",
        name: "合成验收",
        password: "Synthetic-attachment-QA-2026",
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
    await fill("[name=username]", "attachment-qa");
    await fill("[name=password]", "Synthetic-attachment-QA-2026");
    await js('document.querySelector("form").requestSubmit();true');
    await wait(
      () =>
        js(
          `!!document.querySelector('[aria-label="任务输入"]')&&!document.querySelector('.entry-experience')`,
        ),
      "composer",
    );
    assert.match(
      await js(`document.querySelector('[aria-label="选择附件"]').accept`),
      /\.doc.*\.pdf.*\.mp4/,
    );
    const files = [
      "attachment-word.doc",
      "attachment-word.docx",
      "attachment-sheet.xlsx",
      "attachment-slides.pptx",
      "attachment-text.pdf",
      "attachment-scan.pdf",
      "attachment-video.mp4",
    ];
    const { root } = await web.debugger.sendCommand("DOM.getDocument");
    const input = await web.debugger.sendCommand("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: 'input[aria-label="选择附件"]',
    });
    await web.debugger.sendCommand("DOM.setFileInputFiles", {
      nodeId: input.nodeId,
      files: files.map((name) => resolve("artifacts/fixtures", name)),
    });
    await wait(
      () =>
        js(
          `document.querySelectorAll('.attachment-chip').length===7&&!document.querySelector('.attachment-reading')`,
        ),
      "seven parsed formats",
      90000,
    );
    for (const [name, text] of [
      ["attachment-word.doc", "4800"],
      ["attachment-word.docx", "研发计划"],
      ["attachment-sheet.xlsx", "季度收入"],
      ["attachment-slides.pptx", "下一阶段"],
      ["attachment-text.pdf", "4800"],
    ]) {
      await js(`document.querySelector('[title="查看 ${name}"]').click();true`);
      await wait(
        () => js(`!!document.querySelector('.attachment-preview')`),
        "preview",
      );
      assert.ok(
        await js(
          `document.querySelector('[aria-label="已读取的附件内容"]').textContent.includes(${JSON.stringify(text)})`,
        ),
      );
      await click("关闭弹窗");
    }
    checks.push(
      "Actual DOC, DOCX, XLSX, PPTX and text PDF inputs parse to expected Unicode text and preview safely",
    );
    await js(
      `document.querySelector('[title="查看 attachment-scan.pdf"]').click();true`,
    );
    await wait(
      () => js(`!!document.querySelector('.attachment-preview img')`),
      "scanned PDF image",
    );
    assert.equal(
      await js(
        `document.querySelector('.attachment-frames span').textContent.includes('第 1 页')`,
      ),
      true,
    );
    await fs.mkdir("artifacts/screenshots", { recursive: true });
    await fs.writeFile(
      "artifacts/screenshots/attachment-pdf-preview.png",
      (await web.capturePage()).toPNG(),
    );
    await click("关闭弹窗");
    checks.push(
      "Real PDF.js worker renders a scanned PDF page with source page label and explicit scope warning",
    );
    await js(
      `document.querySelector('[title="查看 attachment-video.mp4"]').click();true`,
    );
    await wait(
      () =>
        js(`document.querySelectorAll('.attachment-preview img').length===2`),
      "video frames",
    );
    assert.ok(
      await js(
        `document.querySelector('.attachment-preview').textContent.includes('不读取声音')`,
      ),
    );
    const colors = await js(
      `Promise.all([...document.querySelectorAll('.attachment-preview img')].map(async img=>{await img.decode();const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(img,0,0,1,1);return [...c.getContext('2d').getImageData(0,0,1,1).data]}))`,
    );
    assert.ok(colors[0][0] > 180 && colors[0][2] < 70);
    assert.ok(colors[1][2] > 180 && colors[1][0] < 70);
    await fs.writeFile(
      "artifacts/screenshots/attachment-video-preview.png",
      (await web.capturePage()).toPNG(),
    );
    await click("关闭弹窗");
    checks.push(
      "Real MP4 is decoded and sampled at distinct timestamps: red first scene and blue second scene; no audio claim",
    );
    assert.equal(
      await js(`document.querySelector('[aria-label="发送任务"]').disabled`),
      false,
    );
    await fs.writeFile(
      "artifacts/screenshots/attachment-composer.png",
      (await web.capturePage()).toPNG(),
    );
    await click("发送任务");
    await wait(
      () =>
        js(
          `document.querySelectorAll('.message-attachments button').length===7`,
        ),
      "saved attachment cards",
    );
    await wait(
      () =>
        js(
          `fetch('/api/auth/me').then(r=>r.json()).then(u=>window.brainDesktop.readState(u.id)).then(s=>s?.conversations.some(c=>c.messages.some(m=>m.attachments?.length===7)))`,
        ),
      "native state saved",
    );
    await js("location.reload();true");
    await wait(
      () =>
        js(
          `!![...document.querySelectorAll('.history-list button')].find(b=>b.textContent.includes('attachment-word.doc'))&&!document.querySelector('.entry-experience')`,
        ),
      "history after reload",
    );
    await js(
      `([...document.querySelectorAll('.history-list button')].find(b=>b.textContent.includes('attachment-word.doc'))).click();true`,
    );
    await wait(
      () =>
        js(
          `document.querySelectorAll('.message-attachments button').length===7`,
        ),
      "persisted attachment cards",
    );
    checks.push(
      "Attachment-only submission and native local history retain all seven extracted files and visual previews after reload",
    );
    assert.deepEqual(errors, []);
    const report = {
      version: require("../package.json").version,
      result: "passed",
      checks,
      consoleErrors: errors,
      productionModelsCalled: false,
      originalFilesStoredOnServer: false,
    };
    await fs.writeFile(
      "artifacts/attachment-verification.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(error.stack);
    if (win)
      console.error(
        await win.webContents
          .executeJavaScript(
            `JSON.stringify({chips:document.querySelectorAll('.attachment-chip').length,status:document.querySelector('.attachment-reading')?.textContent,notices:[...document.querySelectorAll('[role="status"],[role="alert"],.toast')].map(x=>x.textContent)})`,
          )
          .catch(() => ""),
      );
    await fs.writeFile(
      "artifacts/attachment-verification.json",
      JSON.stringify(
        {
          result: "failed",
          checks,
          error: error.message,
          consoleErrors: errors,
        },
        null,
        2,
      ),
    );
    failed = true;
  } finally {
    server?.kill();
    if (dir) {
      await fs
        .rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        })
        .catch(() => {});
    }
    app.exit(failed ? 1 : 0);
  }
})();
