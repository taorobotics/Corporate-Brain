// Runs in a dedicated Electron process. Generated JS only enters a sandboxed,
// unprivileged renderer. No employee session, preload, Node bridge or secrets.
const { app, BrowserWindow, protocol, session } = require("electron");
const fs = require("node:fs/promises");
const { join, extname } = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: "brain-render", privileges: { standard: true, secure: true, supportFetchAPI: false, stream: true } }]);
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=384");
let encoder, win;
process.on("SIGTERM", () => { encoder?.kill("SIGKILL"); app.exit(1); });
app.whenReady().then(async () => {
  const config = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
  const stop = () => { encoder?.kill("SIGKILL"); app.exit(1); };
  setTimeout(stop, 15 * 60_000).unref();
  setInterval(() => { try { process.kill(config.parentPid, 0); } catch { stop(); } }, 1000).unref();
  setInterval(() => { if (app.getAppMetrics().reduce((sum, p) => sum + (p.memory?.workingSetSize || 0), 0) > 1536 * 1024) stop(); }, 1000).unref();
  if (!Number.isInteger(config.seconds) || config.seconds < 1 || config.seconds > 60) throw Error("Invalid duration");
  const dir = config.directory, width = 1280, height = 720, fps = 24;
  app.setPath("userData", join(dir, ".render", "profile"));
  const ses = session.fromPartition("render-" + Date.now());
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", event => event.preventDefault());
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm" };
  const materials = [];
  for (const name of await fs.readdir(join(dir, "materials"))) {
    const stat = await fs.lstat(join(dir, "materials", name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error("Unsafe material");
    if (mime[extname(name).toLowerCase()]) materials.push({ name, type: mime[extname(name).toLowerCase()] });
  }
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-eval'; img-src brain-render: data: blob:; media-src brain-render: blob:; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; form-action 'none'"><canvas width="${width}" height="${height}"></canvas>`;
  ses.protocol.handle("brain-render", async req => {
    const url = new URL(req.url);
    if (url.host !== "task") return new Response(null, { status: 403 });
    if (url.pathname === "/") return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const match = /^\/asset\/(\d+)$/.exec(url.pathname), item = match && materials[Number(match[1])];
    if (!item) return new Response(null, { status: 404 });
    // Only this task's explicitly enumerated media is exposed to generated code.
    const file = join(dir, "materials", item.name), stat = await fs.stat(file);
    let start = 0, end = stat.size - 1, status = 200;
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") || "");
    if (range) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end; status = 206; }
    if (start > end || start < 0) return new Response(null, { status: 416 });
    const headers = { "Content-Type": item.type, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" };
    if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
    const { Readable } = require("node:stream");
    const { createReadStream } = require("node:fs");
    return new Response(Readable.toWeb(createReadStream(file, { start, end })), { status, headers });
  });
  ses.webRequest.onBeforeRequest({ urls: ["*://*/*", "file://*/*"] }, (details, cb) => cb({ cancel: !details.url.startsWith("brain-render://task/") }));
  win = new BrowserWindow({ width, height, show: false, webPreferences: { session: ses, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true, backgroundThrottling: false, devTools: false, offscreen: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", event => event.preventDefault());
  win.webContents.on("will-attach-webview", event => event.preventDefault());
  await win.loadURL("brain-render://task/");
  await win.webContents.executeJavaScript(`(async()=>{
    const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
    const assets=Object.create(null),videos=[];
    for(const [i,item] of ${JSON.stringify(materials)}.entries()) {
      const el=document.createElement(item.type.startsWith('video/')?'video':'img');
      if(el.tagName==='VIDEO'){el.muted=true;el.preload='auto';videos.push(el);}
      await new Promise((resolve,reject)=>{el.addEventListener(el.tagName==='VIDEO'?'loadeddata':'load',resolve,{once:true});el.onerror=()=>reject(Error('素材无法解码'));el.src='brain-render://task/asset/'+i;});
      assets[item.name]=el;
    }
    globalThis.__frame=async(t)=>{
      for(const v of videos){const next=Math.min(t,Math.max(0,v.duration-0.05));if(Math.abs(v.currentTime-next)>0.001)await new Promise((resolve,reject)=>{v.addEventListener('seeked',resolve,{once:true});v.currentTime=next;setTimeout(()=>reject(Error('视频定位超时')),10000);});}
      ctx.reset();await globalThis.__animation(ctx,t,assets);return canvas.toDataURL('image/png').split(',')[1];
    };
  })()`);
  const source = await fs.readFile(join(dir, "code", "animation.js"), "utf8");
  await win.webContents.executeJavaScript(`globalThis.__animation=(new Function(${JSON.stringify(source + "\n;return render;")}))(); if(typeof globalThis.__animation !== 'function') throw Error('Missing render function');`);
  await fs.mkdir(join(dir, "output"), { recursive: true });
  const audio = (await fs.readdir(join(dir, "materials"))).find(name => /\.(mp3|wav|m4a|ogg)$/i.test(name));
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-vcodec", "png", "-i", "pipe:0"];
  if (audio) args.push("-i", join(dir, "materials", audio), "-map", "0:v:0", "-map", "1:a:0", "-af", "apad", "-c:a", "aac");
  args.push("-t", String(config.seconds), "-c:v", "libx264", "-threads", "4", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(dir, "output", "video.mp4"));
  encoder = spawn(config.ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let encodingError = "";
  encoder.stderr.on("data", chunk => { encodingError = (encodingError + chunk).slice(-2000); });
  const done = new Promise((resolve, reject) => { encoder.on("error", reject); encoder.on("close", code => code === 0 ? resolve() : reject(Error("Encoder failed: " + encodingError))); });
  // Attach immediately: an early encoder error must not become unhandled.
  done.catch(() => {});
  encoder.stdin.on("error", () => {});
  for (let frame = 0; frame < config.seconds * fps; frame++) {
    const png = Buffer.from(await win.webContents.executeJavaScript(`globalThis.__frame(${frame / fps})`), "base64");
    if (png.length > 12 * 1024 * 1024 || png.readUInt32BE(0) !== 0x89504e47) throw Error("Invalid frame");
    if (!encoder.stdin.write(png)) await Promise.race([once(encoder.stdin, "drain"), done.then(() => { throw Error("Encoder closed early"); })]);
    if (frame % fps === 0) process.stdout.write(`PROGRESS ${frame / (config.seconds * fps)}\n`);
  }
  encoder.stdin.end(); await done;
  win.destroy(); app.exit(0);
}).catch(error => { process.stderr.write(String(error) + "\n"); encoder?.kill("SIGKILL"); app.exit(1); });
