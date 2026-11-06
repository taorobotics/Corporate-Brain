const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises"),
  { resolve, join, dirname } = require("node:path"),
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
const controls = require("./verify-chat-control.cjs").fixture();
const concurrent = require("./verify-concurrent-chats.cjs").fixture();
const openedFolders = [],
  revealedFiles = [];
shell.openPath = async (path) => {
  openedFolders.push(path);
  return "";
};
shell.showItemInFolder = (path) => {
  revealedFiles.push(path);
};
let failureCalls = 0;
let qaErrors = "";
let releaseGeneration;
const generationGate = new Promise((resolve) => {
  releaseGeneration = resolve;
});
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
    dir = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "brain-production-ui-")),
    );
    app.setPath("userData", join(dir, "profile"));
    const output = join(dir, "employee-output");
    await fs.mkdir(output);
    let workspaceOutput = join(dir, "workspace-project");
    const firstWorkspace = workspaceOutput;
    await fs.mkdir(workspaceOutput);
    const material = join(dir, "brief.txt");
    await fs.writeFile(material, "Synthetic project brief.");
    const originalDialog = dialog.showOpenDialog.bind(dialog);
    dialog.showOpenDialog = async (window, options) =>
      options?.title === "选择成果自动保存位置"
        ? { canceled: false, filePaths: [output] }
        : options?.properties?.join() === "openDirectory"
          ? { canceled: false, filePaths: [workspaceOutput] }
          : originalDialog(window, options);
    provider = createServer(async (req, res) => {
      let input = "";
      for await (const chunk of req) input += chunk;
      const payload = JSON.parse(input);
      if (concurrent.handle(res, payload)) return;
      if (controls.handle(res, payload)) return;
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
            : request.includes("合成 GIF 回传验收")
              ? "chat"
              : request.includes("合成视频验收")
                ? "video"
                : "code",
          mode: "standard",
          seconds: 2,
        });
      }
      if (payload.messages[0].content.startsWith("Plan the production"))
        return send({
          title: "合成任务执行计划",
          brief:
            "先生成完整源代码，再在隔离环境中检查或渲染，校验所有文件并保存到员工电脑。",
        });
      if (
        payload.messages[0].content.includes(
          "You create polished animated videos",
        )
      )
        return send({
          source:
            'async function render(ctx,t,assets){ctx.fillStyle="#f5f3ef";ctx.fillRect(0,0,1280,720);ctx.fillStyle="#b77857";ctx.fillRect(100+t*120,220,160,160);}',
        });
      const isFailure = payload.messages.some((m) =>
        m.content.includes("合成失败验收"),
      );
      if (isFailure && ++failureCalls <= 2) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({ choices: [{ message: { content: '{"files":' } }] }),
        );
      }
      assert.ok(
        JSON.parse(input).messages.some((m) =>
          m.content.includes("Synthetic project brief"),
        ),
      );
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "合成模型正在核对实际文件结构。" } }] })}\n\n`,
      );
      await generationGate;
      await new Promise((r) => setTimeout(r, 300));
      const content = JSON.stringify({
        files: [
          { path: "README.md", content: "Synthetic output instructions." },
          {
            path: "src/index.html",
            content: "<!doctype html><h1>Company Brain</h1>",
          },
        ],
      });
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
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
        BRAIN_QA_EXPORT_ROOT: join(dir, "qa-exports"),
      },
    });
    server.stderr.on("data", (bytes) => {
      qaErrors = (qaErrors + bytes.toString()).slice(-6000);
    });
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
    const capture = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        win.showInactive();
        await new Promise((r) => setTimeout(r, 300));
        try {
          const image = await web.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true,
          });
          assert.equal(image.isEmpty(), false);
          return image;
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
    };
    const click = (label) =>
      js(
        `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}||x.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click();return true;})()`,
      );
    const fill = (selector, value, type = "HTMLInputElement") =>
      js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${type}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))));})()`,
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
    assert.equal(
      await js(
        `!![...document.querySelectorAll('.sidebar button')].find(x=>x.textContent.trim()==='制作中心')`,
      ),
      false,
    );
    assert.equal(
      await js(
        `document.querySelectorAll('[aria-label="任务类型"], [aria-label="DSH 模式"]').length`,
      ),
      0,
    );
    const doc = await web.debugger.sendCommand("DOM.getDocument");
    await js(
      `window.brainDesktop.production.chooseDirectory(${JSON.stringify(user.id)})`,
    );
    await click("新建工作区");
    await wait(
      () =>
        js(
          `document.querySelector('[aria-label="工作区"]')?.textContent.includes('workspace-project')`,
        ),
      "project workspace selected",
    );
    const input = await web.debugger.sendCommand("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: '[aria-label="选择附件"]',
    });
    await web.debugger.sendCommand("DOM.setFileInputFiles", {
      nodeId: input.nodeId,
      files: [material],
    });
    await wait(
      () =>
        js(
          `document.querySelector('.composer')?.textContent.includes('brief.txt')`,
        ),
      "original chat material",
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
          `document.querySelector('.chat-production .reasoning-text')?.textContent.includes('合成模型正在核对实际文件结构')`,
        ),
      "actual generation step",
    );
    assert.equal(
      await js(
        `!!document.querySelector('.chat-production .workflow-plan, .chat-production progress, .chat-production .workflow-heading')`,
      ),
      false,
    );
    assert.equal(
      await js(
        `document.querySelector('.chat-production .message-markdown')?.textContent.includes('合成任务执行计划')`,
      ),
      true,
    );
    assert.equal(
      await js(
        `document.querySelector('.chat-production .thinking-process')?.dataset.status`,
      ),
      "running",
    );
    assert.equal(
      await js(
        `[...document.querySelectorAll('.chat-production .thinking-tool-title')].some(x=>x.textContent.includes('保存到本机'))`,
      ),
      false,
    );
    await fs.writeFile(
      "artifacts/workflow-chat-running.png",
      (await capture()).toPNG(),
    );
    releaseGeneration();
    await wait(
      () =>
        js(
          `document.querySelector('.chat-production')?.dataset.status==='saved'`,
        ),
      "code saved in chat",
      60000,
    );
    assert.equal(
      await js(
        `document.querySelector('.chat-production .thinking-process')?.dataset.status`,
      ),
      "done",
    );
    assert.equal(
      await js(
        `document.querySelector('.message.assistant .message-markdown')?.textContent.includes('合成任务执行计划')`,
      ),
      true,
    );
    const local = await js(
      `window.brainDesktop.production.state(${JSON.stringify(user.id)})`,
    );
    const receipt = local.receipts[0];
    assert.equal(dirname(receipt.directory), firstWorkspace);
    assert.equal(local.directory, output);
    assert.equal(
      await js(
        `window.brainDesktop.production.collect(${JSON.stringify(user.id)},${JSON.stringify(receipt.id)},'default-workspace').then(()=>false,()=>true)`,
      ),
      true,
    );
    assert.ok(receipt.files.some((f) => f.path === "plan.md"));
    assert.ok(receipt.files.some((f) => f.path === "materials/brief.txt"));
    for (const file of receipt.files)
      assert.equal(
        createHash("sha256")
          .update(await fs.readFile(join(receipt.directory, file.path)))
          .digest("hex"),
        file.sha256,
      );
    await assert.rejects(
      fs.stat(join(dir, "server-tasks", user.id, receipt.id)),
      { code: "ENOENT" },
    );
    await js(
      `(()=>{const root=document.querySelector('.chat-production');root.querySelector('.workflow-files').open=true;root.querySelector('[title="预览：code/README.md"]').click();return true;})()`,
    );
    await wait(
      () =>
        js(
          `document.querySelector('.workflow-preview code')?.textContent.includes('Synthetic output instructions')`,
        ),
      "local source preview",
    );
    await fs.writeFile(
      "artifacts/workflow-chat-code.png",
      (await capture()).toPNG(),
    );
    checks.push(
      "Same chat renderer shows real streamed model reasoning and its reply without a stage panel or progress card; completion waits for the native receipt and all files match SHA-256 before server cleanup",
    );
    checks.push(
      "Source preview reads the saved local receipt through the restricted native bridge without executing code",
    );
    await click("设置");
    await wait(
      () => js(`!!document.querySelector('.production-location')`),
      "settings output location",
    );
    await click("我的作品");
    await wait(
      () =>
        js(`!!document.querySelector('.production-saved .chat-production')`),
      "work history",
    );
    assert.equal(
      await js(`!!document.querySelector('.production-compose')`),
      false,
    );
    await js(`document.querySelector('[data-history-title]').click();true`);
    await wait(
      () =>
        js(
          `document.querySelector('.chat-production')?.dataset.status==='saved'`,
        ),
      "original conversation persists result",
    );
    await wait(
      () =>
        js(
          `window.brainDesktop.readState(${JSON.stringify(user.id)}).then(state => state.conversations.some(c => c.messages.some(m => m.content.includes('合成任务执行计划') && m.trace?.items.some(item => item.type==='reasoning' && item.text.includes('合成模型正在核对实际文件结构')))))`,
        ),
      "actual model reply and reasoning persist on employee device",
    );
    web.reload();
    await wait(
      () => js(`!!document.querySelector('[data-history-title]')`),
      "local conversation history after reload",
    );
    await js(`document.querySelector('[data-history-title]').click();true`);
    await wait(
      () =>
        js(
          `document.querySelector('.chat-production .message-markdown')?.textContent.includes('合成任务执行计划') && document.querySelector('.chat-production .reasoning-text')?.textContent.includes('合成模型正在核对实际文件结构')`,
        ),
      "ordinary reply and actual reasoning survive reload",
    );
    checks.push(
      "Settings keep output directory; My Works and original conversation share the same result, actual model reply and reasoning persist on the employee device and survive reload",
    );
    await click("新建任务");
    await fill(
      '[aria-label="任务输入"]',
      "合成失败验收：根据 Synthetic project brief 生成源代码文件",
      "HTMLTextAreaElement",
    );
    await click("发送任务");
    await wait(
      () =>
        js(
          `document.querySelector('.chat-production')?.dataset.status==='failed'`,
        ),
      "bounded repair failure",
      60000,
    );
    assert.equal(
      await js(
        `document.querySelector('.chat-production .thinking-process')?.dataset.status`,
      ),
      "error",
    );
    assert.equal(
      await js(
        `[...document.querySelectorAll('.chat-production .tool-entry')].some(x=>x.dataset.toolStatus==='error')`,
      ),
      true,
    );
    assert.equal(
      await js(
        `[...document.querySelectorAll('.chat-production .thinking-tool-title')].some(x=>x.textContent.includes('检查源文件'))`,
      ),
      false,
    );
    await fs.writeFile(
      "artifacts/workflow-chat-failure.png",
      (await capture()).toPNG(),
    );
    await click("在此重试");
    await wait(
      () =>
        js(
          `document.querySelector('.chat-production')?.dataset.status==='saved'`,
        ),
      "inline retry recovered",
      60000,
    );
    checks.push(
      "Malformed model output triggers one automatic correction, fails at the actual generation step, then inline retry finishes in the same chat",
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
            `document.querySelector('.chat-production')?.dataset.status==='saved'`,
          ),
        "actual chat video rendered",
        120000,
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
      await js(
        `(()=>{const root=document.querySelector('.chat-production');root.querySelector('.workflow-files').open=true;root.querySelector('[title="预览：output/video.mp4"]').click();return true;})()`,
      );
      await wait(
        () =>
          js(
            `document.querySelector('.workflow-preview video')?.readyState>=1`,
          ),
        "video preview loads from local file",
      );
      const metadata = await js(
        `(()=>{const v=document.querySelector('.workflow-preview video');return {width:v.videoWidth,height:v.videoHeight,duration:v.duration};})()`,
      );
      assert.equal(metadata.width, 1280);
      assert.equal(metadata.height, 720);
      assert.ok(Math.abs(metadata.duration - 2) < 0.1);
      await fs.writeFile(
        "artifacts/workflow-chat-video.png",
        (await capture()).toPNG(),
      );
      checks.push(
        "Real Canvas/FFmpeg video renders from chat, all files save and clear on server, local inline video preview decodes at 1280x720 and 2 seconds",
      );
    }
    await click("新建任务");
    workspaceOutput = join(dir, "workspace-gif");
    await fs.mkdir(workspaceOutput);
    await click("新建工作区");
    await wait(
      () =>
        js(
          `document.querySelector('[aria-label="工作区"]')?.textContent.includes('workspace-gif')`,
        ),
      "second workspace selected",
    );
    await fill(
      '[aria-label="任务输入"]',
      "合成 GIF 回传验收：在普通对话中生成 GIF 和说明文件。",
      "HTMLTextAreaElement",
    );
    await click("发送任务");
    await wait(
      async () => {
        const state = await js(
          `({saved:document.querySelector('.chat-production')?.dataset.status==='saved',error:document.querySelector('.task-error')?.innerText})`,
        );
        if (state.error) throw Error("Chat export failed: " + state.error);
        return state.saved;
      },
      "ordinary chat GIF saved",
      60000,
    );
    const gifState = await js(
      `window.brainDesktop.production.state(${JSON.stringify(user.id)})`,
    );
    const gifReceipt = gifState.receipts.find((r) =>
      r.files.some((f) => f.path === "files/sticker.gif"),
    );
    assert.ok(gifReceipt);
    assert.equal(dirname(gifReceipt.directory), workspaceOutput);
    assert.equal(dirname(receipt.directory), firstWorkspace);
    checks.push(
      "Workspace output routing: code saved under workspace A, ordinary chat GIF under workspace B, unchanged default directory, forged cross-workspace IPC rejected, verified files and server cleanup",
    );
    for (const file of gifReceipt.files)
      assert.equal(
        createHash("sha256")
          .update(await fs.readFile(join(gifReceipt.directory, file.path)))
          .digest("hex"),
        file.sha256,
      );
    await assert.rejects(
      fs.stat(join(dir, "server-tasks", user.id, gifReceipt.id)),
      { code: "ENOENT" },
    );
    await wait(
      () =>
        js(
          `document.querySelector('.production-gallery img')?.naturalWidth===1`,
        ),
      "GIF automatically displayed in chat",
    );
    await js(`document.querySelector('.production-folder-link').click();true`);
    await wait(
      async () => openedFolders.includes(gifReceipt.directory),
      "saved path opens its own receipt folder",
    );
    await js(
      `document.querySelector('.production-image .production-file-link').click();true`,
    );
    await wait(
      async () =>
        revealedFiles.includes(join(gifReceipt.directory, "files/sticker.gif")),
      "image quick link reveals its saved file",
    );
    await js(`document.querySelector('.production-thumbnail').click();true`);
    await wait(
      () =>
        js(
          `document.querySelector('.workflow-image-preview')?.naturalWidth===1`,
        ),
      "GIF inline image preview decoded",
    );
    assert.equal(
      await js(`document.querySelectorAll('.workflow-preview video').length`),
      0,
    );
    await js(`document.querySelector('[aria-label="关闭弹窗"]').click();true`);
    await js(
      `document.querySelector('.production-file-shortcuts button').click();true`,
    );
    await wait(
      async () =>
        revealedFiles.includes(join(gifReceipt.directory, "files/README.md")),
      "document quick link reveals the exact saved file",
    );
    await fs.writeFile(
      "artifacts/workflow-chat-gif.png",
      (await capture()).toPNG(),
    );
    win.setContentSize(900, 760);
    await js(`location.hash='settings';true`);
    await wait(
      () => js(`!!document.querySelector('.production-location')`),
      "appearance settings",
    );
    await click("外观");
    await wait(
      () => js(`!!document.querySelector('.select-popup[data-open]')`),
      "appearance picker",
    );
    await js(
      `[...document.querySelectorAll('[role="option"]')].find(x=>x.querySelector('.select-option-label')?.textContent==='深色').click();true`,
    );
    await wait(
      () =>
        js(
          `document.documentElement.dataset.theme==='dark'&&getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()==='#181715'`,
        ),
      "persisted dark colors",
    );
    await js(
      `document.querySelector('[data-history-title^="合成 GIF 回传验收"]').click();true`,
    );
    await wait(
      () =>
        js(
          `document.querySelector('.production-gallery img')?.naturalWidth===1`,
        ),
      "dark narrow gallery stays visible",
    );
    assert.equal(
      await js(`document.documentElement.scrollWidth<=window.innerWidth`),
      true,
    );
    await fs.writeFile(
      "artifacts/screenshots/chat-files-dark-narrow.png",
      (await capture()).toPNG(),
    );
    win.setContentSize(1320, 920);
    web.reload();
    await wait(
      () => js(`!!document.querySelector('[data-history-title]')`),
      "GIF conversation history reload",
    );
    await js(
      `document.querySelector('[data-history-title^="合成 GIF 回传验收"]').click();true`,
    );
    await wait(
      () =>
        js(
          `document.querySelector('.chat-production .message-markdown')?.textContent.includes('合成 GIF 文件')`,
        ),
      "GIF reply and file association retained",
    );
    await wait(
      () =>
        js(
          `document.querySelector('.production-gallery img')?.naturalWidth===1`,
        ),
      "saved GIF automatically reloads from local files",
    );
    checks.push(
      "Ordinary chat exports GIF and README, validates before server cleanup, automatically displays the saved GIF in light/dark narrow layouts and after reload, opens full preview, routes folder/image/document quick links through native receipt checks; shell launch is intercepted in isolated QA",
    );
    await require("./verify-chat-control.cjs").verify({
      js,
      click,
      fill,
      wait,
      capture,
      checks,
      win,
      controls,
    });
    await require("./verify-concurrent-chats.cjs").verify({
      js,
      click,
      fill,
      wait,
      capture,
      checks,
      win,
      concurrent,
      account: {
        username: "production-ui",
        password: "Synthetic-Production-QA-2026",
      },
    });
    const tasks = await js(`fetch('/api/production').then(r=>r.json())`);

    const report = {
      version: require("../package.json").version,
      result: "passed",
      platform: process.platform,
      checks,
      taskStatus: tasks[0].status,
      fileCount: receipt.files.length,
      realProviderCalls: 0,
      syntheticFixtureProvider: true,
      realVideoRendered: process.platform === "darwin",
      serverFilesRemoved: true,
    };
    await fs.writeFile(
      `artifacts/production-ui-${process.platform}.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } catch (error) {
    failed = true;
    await fs.writeFile(
      `artifacts/production-ui-${process.platform}.json`,
      JSON.stringify(
        {
          version: require("../package.json").version,
          result: "failed",
          checks,
          error: String(error),
          syntheticFixtureProvider: true,
        },
        null,
        2,
      ),
    );
    console.error(error.stack);
    console.error(qaErrors);
    if (win && !win.isDestroyed()) {
      console.error(
        "Synthetic QA page: " +
          (await win.webContents
            .executeJavaScript("document.body.innerText.slice(-5000)")
            .catch(() => "unavailable")),
      );
    }
  } finally {
    app.removeAllListeners("window-all-closed");
    server?.send?.("close");
    server?.kill();
    provider?.close();
    for (const w of BrowserWindow.getAllWindows()) w.destroy();
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    app.exit(failed ? 1 : 0);
  }
})();
