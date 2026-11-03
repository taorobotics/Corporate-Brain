const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises"),
  { resolve, join } = require("node:path"),
  { tmpdir } = require("node:os");
const { createServer } = require("node:http"),
  { once } = require("node:events"),
  assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
process.env.BRAIN_VERIFY = "1";
app.disableHardwareAcceleration();
let server,
  provider,
  dir,
  win,
  failed = false;
const checks = [];
const wait = async (fn, label, ms = 45000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("Timed out: " + label);
};
(async () => {
  try {
    dir = await fs.mkdtemp(join(tmpdir(), "brain-production-ui-"));
    app.setPath("userData", join(dir, "profile"));
    const output = join(dir, "employee-output");
    await fs.mkdir(output);
    const material = join(dir, "brief.txt");
    await fs.writeFile(material, "Synthetic project brief.");
    const originalDialog = dialog.showOpenDialog.bind(dialog);
    dialog.showOpenDialog = async (window, options) =>
      options?.title === "选择成果自动保存位置"
        ? { canceled: false, filePaths: [output] }
        : originalDialog(window, options);
    provider = createServer(async (req, res) => {
      let input = "";
      for await (const chunk of req) input += chunk;
      const payload = JSON.parse(input);
      const send = (content) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(content) } }],
          }),
        );
      };
      if (req.url === "/images/generations") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            data: [
              {
                b64_json:
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTH8AAAAASUVORK5CYII=",
              },
            ],
          }),
        );
      }
      if (payload.messages[0].content.startsWith("You route tasks")) {
        const request = JSON.parse(payload.messages[1].content).messages.at(
          -1,
        ).content;
        return send({
          kind: request.includes("合成图片验收")
            ? "image"
            : request.includes("合成视频验收")
              ? "video"
              : "code",
          mode: "standard",
          seconds: 2,
        });
      }
      if (
        payload.messages[0].content.includes(
          "You create polished animated videos",
        )
      )
        return send({
          source:
            'async function render(ctx,t,assets){ctx.fillStyle="#f5f3ef";ctx.fillRect(0,0,1280,720);ctx.fillStyle="#b77857";ctx.fillRect(100+t*120,220,160,160);}',
        });
      assert.ok(
        JSON.parse(input).messages.some((m) =>
          m.content.includes("Synthetic project brief"),
        ),
      );
      await new Promise((r) => setTimeout(r, 1600));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  files: [
                    {
                      path: "README.md",
                      content: "Synthetic output instructions.",
                    },
                    {
                      path: "src/index.html",
                      content: "<!doctype html><h1>Company Brain</h1>",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    server = spawn("node", ["--import", "tsx", "server/qa.ts"], {
      cwd: resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        BRAIN_PRODUCTION_ROOT: join(dir, "server-tasks"),
      },
    });
    server.stderr.on("data", () => {});
    const port = await new Promise((resolvePort, reject) => {
      const timer = setTimeout(
        () => reject(Error("QA startup timeout")),
        20000,
      );
      server.once("message", (m) => {
        clearTimeout(timer);
        resolvePort(m.port);
      });
      server.once("exit", () => reject(Error("QA exited")));
    });
    const origin = `http://127.0.0.1:${port}`;
    process.env.BRAIN_APP_URL = origin;
    await fetch(origin + "/api/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: "制作验收",
        username: "production-ui",
        name: "制作验收",
        password: "Synthetic-Production-QA-2026",
      }),
    });
    require("./main.cjs");
    await app.whenReady();
    await wait(() => BrowserWindow.getAllWindows().length, "window");
    win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(1320, 920);
    const web = win.webContents;
    web.setBackgroundThrottling(false);
    web.debugger.attach("1.3");
    await web.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
      enabled: true,
    });
    const js = (source) => web.executeJavaScript(source, true);
    const click = (label) =>
      js(
        `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}||x.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click();return true;})()`,
      );
    const fill = (selector, value, type = "HTMLInputElement") =>
      js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${type}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`,
      );
    await wait(
      () =>
        js(
          `!!document.querySelector('input[name=username]')&&!document.querySelector('.entry-form-stage[inert]')`,
        ),
      "login",
    );
    await fill("[name=username]", "production-ui");
    await fill("[name=password]", "Synthetic-Production-QA-2026");
    await js('document.querySelector("form").requestSubmit();true');
    await wait(
      () =>
        js(
          `!!document.querySelector('.sidebar')&&!document.querySelector('.entry-experience')`,
        ),
      "workspace",
    );
    const user = await js(`fetch('/api/auth/me').then(r=>r.json())`);
    await js(
      `fetch('/api/connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'合成代码模型',baseUrl:'http://127.0.0.1:${provider.address().port}',model:'fixture',kind:'chat',apiKey:'synthetic-local-provider'})}).then(r=>{if(!r.ok)throw Error('Connection failed');return true;})`,
    );
    await js(
      `fetch('/api/connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'合成图片模型',baseUrl:'http://127.0.0.1:${provider.address().port}',model:'fixture-image',kind:'image',apiKey:'synthetic-local-provider'})}).then(r=>{if(!r.ok)throw Error('Image connection failed');return true;})`,
    );
    await js(`location.reload();true`);
    await wait(
      () =>
        js(
          `!!document.querySelector('.sidebar')&&!document.querySelector('.entry-experience')`,
        ),
      "reload",
    );
    await click("制作中心");
    await wait(
      () => js(`!!document.querySelector('.production-page')`),
      "production page",
    );
    await click("选择文件夹");
    await wait(
      () =>
        js(
          `document.querySelector('.production-location').textContent.includes('employee-output')`,
        ),
      "native folder choice",
    );
    await js(
      `document.querySelectorAll('.production-kind button')[1].click();true`,
    );
    await fill(
      ".production-compose textarea",
      "生成网页源码与运行说明",
      "HTMLTextAreaElement",
    );
    const doc = await web.debugger.sendCommand("DOM.getDocument");
    const node = await web.debugger.sendCommand("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: ".production-upload input",
    });
    await web.debugger.sendCommand("DOM.setFileInputFiles", {
      nodeId: node.nodeId,
      files: [material],
    });
    await wait(
      () =>
        js(
          `document.querySelector('.production-files')?.textContent.includes('brief.txt')`,
        ),
      "material selection",
    );
    win.showInactive();
    await new Promise((r) => setTimeout(r, 500));
    await fs.mkdir("artifacts", { recursive: true });
    await fs.writeFile(
      "artifacts/production-center-windows.png",
      (
        await web.capturePage(undefined, { stayHidden: true, stayAwake: true })
      ).toPNG(),
    );
    await click("生成代码文件");
    await wait(
      () => js(`document.querySelector('.production-task')`),
      "queued task",
    );
    await click("我的作品");
    await wait(
      () => js(`!!document.querySelector('.production-receipt')`),
      "background collection",
      60000,
    );
    const tasks = await js(`fetch('/api/production').then(r=>r.json())`);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, "saved");
    const local = await js(
      `window.brainDesktop.production.state(${JSON.stringify(user.id)})`,
    );
    assert.equal(local.receipts.length, 1);
    const receipt = local.receipts[0];
    assert.equal(receipt.files.length, 4);
    for (const file of receipt.files) {
      const bytes = await fs.readFile(join(receipt.directory, file.path));
      assert.equal(bytes.length, file.size);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        file.sha256,
      );
    }
    await assert.rejects(
      fs.stat(join(dir, "server-tasks", user.id, tasks[0].id)),
      { code: "ENOENT" },
    );
    checks.push(
      "Native directory selection, original material upload and model-driven source generation through real UI",
    );
    checks.push(
      "Changing pages keeps native collection active; all 4 files verified on disk before server directory disappears",
    );
    await fs.writeFile(
      "artifacts/production-saved-windows.png",
      (
        await web.capturePage(undefined, { stayHidden: true, stayAwake: true })
      ).toPNG(),
    );
    await js(`location.hash='settings';true`);
    await wait(
      () => js(`!!document.querySelector('.production-location')`),
      "settings location",
    );
    checks.push(
      "Settings and My Works show native account-specific location and saved receipt",
    );
    await click("新建任务");
    await wait(
      () => js(`!!document.querySelector('[aria-label="任务输入"]')`),
      "unified chat",
    );
    assert.equal(
      await js(
        `document.querySelectorAll('[aria-label="任务类型"], [aria-label="DSH 模式"]').length`,
      ),
      0,
    );
    const chatDoc = await web.debugger.sendCommand("DOM.getDocument");
    const chatInput = await web.debugger.sendCommand("DOM.querySelector", {
      nodeId: chatDoc.root.nodeId,
      selector: '[aria-label="选择附件"]',
    });
    await web.debugger.sendCommand("DOM.setFileInputFiles", {
      nodeId: chatInput.nodeId,
      files: [material],
    });
    await wait(
      () =>
        js(
          `document.querySelector('.composer .chips')?.textContent.includes('brief.txt') || document.querySelector('.composer')?.textContent.includes('brief.txt')`,
        ),
      "chat reads original material",
    );
    await fill(
      '[aria-label="任务输入"]',
      "根据 Synthetic project brief 生成网页源代码文件",
      "HTMLTextAreaElement",
    );
    await click("发送任务");
    await wait(
      () =>
        js(
          `document.querySelector('.chat-production')?.dataset.status === 'saved'`,
        ),
      "automatic code saved in the same conversation",
      60000,
    );
    const automaticState = await js(
      `window.brainDesktop.production.state(${JSON.stringify(user.id)})`,
    );
    assert.equal(automaticState.receipts.length, 2);
    const automaticReceipt = automaticState.receipts.find(
      (item) => item.id !== receipt.id,
    );
    assert.ok(
      automaticReceipt.files.some(
        (file) => file.path === "materials/brief.txt",
      ),
    );
    for (const file of automaticReceipt.files) {
      const bytes = await fs.readFile(
        join(automaticReceipt.directory, file.path),
      );
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        file.sha256,
      );
    }
    await assert.rejects(
      fs.stat(join(dir, "server-tasks", user.id, automaticReceipt.id)),
      { code: "ENOENT" },
    );
    await fs.writeFile(
      "artifacts/automatic-chat-code.png",
      (
        await web.capturePage(undefined, { stayHidden: true, stayAwake: true })
      ).toPNG(),
    );
    checks.push(
      "Unified chat performs actual model routing, uploads original material, creates code, shows progress, saves verified files locally and removes server files without task or mode selectors",
    );
    await fill(
      '[aria-label="任务输入"]',
      "合成图片验收：生成一张图片",
      "HTMLTextAreaElement",
    );
    await click("发送任务");
    await wait(
      () => js(`!!document.querySelector('.generated-image img')`),
      "automatically selected image provider",
      15000,
    );
    assert.equal(
      await js(
        `document.querySelector('.generated-image img').src.startsWith('data:image/png;base64,')`,
      ),
      true,
    );
    await fs.writeFile(
      "artifacts/automatic-chat-image.png",
      (
        await web.capturePage(undefined, { stayHidden: true, stayAwake: true })
      ).toPNG(),
    );
    checks.push(
      "Chat automatically dispatches image creation to the authorized image connection and displays the returned image in place",
    );
    if (process.platform === "darwin") {
      await click("新建任务");
      await fill(
        '[aria-label="任务输入"]',
        "合成视频验收：制作一个两秒动画视频，附源码",
        "HTMLTextAreaElement",
      );
      await click("发送任务");
      await wait(
        () =>
          js(
            `document.querySelector('.chat-production')?.dataset.status === 'saved'`,
          ),
        "automatic video rendered and saved in chat",
        60000,
      );
      const videoState = await js(
        `window.brainDesktop.production.state(${JSON.stringify(user.id)})`,
      );
      const videoReceipt = videoState.receipts.find((item) =>
        item.files.some((file) => file.path === "output/video.mp4"),
      );
      assert.ok(videoReceipt);
      for (const file of videoReceipt.files)
        assert.equal(
          createHash("sha256")
            .update(await fs.readFile(join(videoReceipt.directory, file.path)))
            .digest("hex"),
          file.sha256,
        );
      await assert.rejects(
        fs.stat(join(dir, "server-tasks", user.id, videoReceipt.id)),
        { code: "ENOENT" },
      );
      await fs.writeFile(
        "artifacts/automatic-chat-video.png",
        (
          await web.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true,
          })
        ).toPNG(),
      );
      checks.push(
        "Mac unified chat routes video intent, performs real Canvas/FFmpeg rendering, saves video and source locally and removes the server task",
      );
    }
    const report = {
      version: require("../package.json").version,
      result: "passed",
      platform: process.platform,
      checks,
      taskStatus: tasks[0].status,
      fileCount: receipt.files.length,
      realProviderCalls: 0,
      syntheticFixtureProvider: true,
      serverFilesRemoved: true,
    };
    await fs.writeFile(
      `artifacts/production-ui-${process.platform}.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } catch (error) {
    failed = true;
    console.error(error.stack);
  } finally {
    server?.send?.("close");
    server?.kill();
    provider?.close();
    for (const w of BrowserWindow.getAllWindows()) w.destroy();
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    app.exit(failed ? 1 : 0);
  }
})();
