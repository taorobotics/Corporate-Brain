// Real company login and original animation against disposable data only.
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { resolve, join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
process.env.BRAIN_VERIFY = '1';
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-webgl');
const checks = [], errors = [], external = [], layouts = [];
let server, win, expectedFailure = false;
const delay = ms => new Promise(done => setTimeout(done, ms));
async function until(test, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await test()) return; await delay(60); }
  throw Error('Timed out: ' + label);
}
(async () => {
  app.setPath('userData', await fs.mkdtemp(join(tmpdir(), 'brain-startup-animation-')));
  server = spawn('node', ['--import', 'tsx', 'server/qa.ts'], {
    cwd: resolve(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, BRAIN_DSH_ENABLED: '0' },
  });
  const port = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(Error('Disposable server did not start')), 15000);
    server.once('message', message => { clearTimeout(timer); done(message.port); });
    server.once('exit', code => reject(Error('Disposable server exited ' + code)));
  });
  const origin = `http://127.0.0.1:${port}`, password = randomBytes(24).toString('hex');
  assert.equal((await fetch(origin + '/api/bootstrap', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ companyName: '动画隔离验收', name: '验收成员', username: 'animation-qa', password }),
  })).status, 201);
  for (const [url, expected] of [['/', "frame-ancestors 'none'"], ['/startup/index.html', "frame-ancestors 'self'"]])
    assert.ok((await fetch(origin + url)).headers.get('content-security-policy').includes(expected));
  checks.push('Actual production static headers prohibit embedding the app and allow only the bundled animation document on the same origin');
  process.env.BRAIN_APP_URL = origin;
  require('./main.cjs'); await app.whenReady();
  await until(() => BrowserWindow.getAllWindows().length, 'real desktop window');
  win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1440, 900); win.showInactive();
  const web = win.webContents, js = code => web.executeJavaScript(code, true);
  web.on('console-message', event => {
    if (event.level === 'error' && !event.message.includes('Electron Security Warning') &&
      !(expectedFailure && event.message.includes('ERR_BLOCKED_BY_CLIENT'))) errors.push(event.message);
  });
  web.session.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/.test(details.url) && new URL(details.url).origin !== origin) external.push(details.url);
    callback({ cancel: expectedFailure && details.url === origin + '/startup/runtime.js' });
  });
  await until(() => js(`!!document.querySelector('.login-submit')`), 'logged-out login');
  await until(() => !win.contentView.children.some(view => view.webContents?.getURL().includes('startup.html')), 'initial native connection released');
  assert.equal(await js(`!!document.querySelector('.startup-animation')`), false);
  const fill = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await fill('input[name=username]', 'animation-qa'); await fill('input[name=password]', 'incorrect-disposable-password');
  await js(`document.querySelector('.login-submit').click()`);
  await until(() => js(`!!document.querySelector('.login-error')`), 'incorrect password rejected');
  assert.equal(await js(`!!document.querySelector('.startup-animation')`), false);
  checks.push('Unauthenticated launch and an incorrect real password remain on login and never start the decorative confirmation sequence');
  web.debugger.attach('1.3');
  await web.debugger.sendCommand('Page.enable');
  await web.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await web.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__animationQA={phases:[],clicks:0,keys:0};
    document.addEventListener('click',e=>{if(e.target.closest?.('.dsu-btn,.dsu-action'))window.__animationQA.clicks++},true);
    document.addEventListener('keydown',()=>window.__animationQA.keys++,true);
    new MutationObserver(()=>{const text=document.querySelector('.dsu-status-zh')?.textContent.replace(/\u00a0/g,' ');
      if(['需要访问许可','身份资料确认','接收访问需求','开始读取权限','读取完毕 · 核验通过'].includes(text)&&!window.__animationQA.phases.includes(text))window.__animationQA.phases.push(text);
    }).observe(document,{childList:true,subtree:true,characterData:true});
  `});
  const child = () => web.mainFrame.frames.find(frame => frame.url.startsWith(origin + '/startup/index.html'));
  async function automatic(theme) {
    await until(() => !!child(), theme + ' animation document');
    await until(() => child()?.executeJavaScript(`!!window.__DSH_STARTUP_API__`), theme + ' original runtime');
    const frame = child();
    assert.equal(await js(`!!document.querySelector('.startup-animation-skip')`), false, 'Automatic startup has no skip button');
    assert.equal(await frame.executeJavaScript('typeof window.brainDesktop'), 'undefined', 'Animation has no native file or account IPC bridge');
    assert.equal(await frame.executeJavaScript('window.__DSH_STARTUP_API__.config.requireInteraction'), false);
    assert.equal(await frame.executeJavaScript('window.__DSH_STARTUP_API__.config.theme'), theme);
    await js(`window.postMessage({type:'brain:startup',token:new URL(document.querySelector('.startup-animation iframe').src).searchParams.get('token'),state:'finished'},location.origin)`);
    await frame.executeJavaScript(`parent.postMessage({type:'brain:startup',token:'incorrect-token',state:'finished'},location.origin)`);
    await delay(120); assert.equal(await js(`!!document.querySelector('.startup-animation')`), true);
    await until(() => frame.executeJavaScript(`document.querySelector('.dsu-status-zh')?.textContent==='需要访问许可'`), theme + ' automatic permission stage');
    assert.equal(await frame.executeJavaScript(`document.querySelector('.dsu-btn').disabled`), true);
    await fs.mkdir(resolve('artifacts/screenshots'), { recursive: true });
    await fs.writeFile(resolve(`artifacts/screenshots/startup-automatic-${theme}.png`), (await web.capturePage()).toPNG());
    await until(() => frame.executeJavaScript('window.__DSH_STARTUP_FINISHED__===true'), theme + ' all phases completed');
    const audit = await frame.executeJavaScript('window.__animationQA');
    assert.deepEqual(audit.phases, ['需要访问许可','身份资料确认','接收访问需求','开始读取权限','读取完毕 · 核验通过']);
    assert.equal(audit.clicks, 0); assert.equal(audit.keys, 0);
    layouts.push({ theme, ...audit });
    await until(() => js(`!document.querySelector('.startup-animation')&&!document.querySelector('.application').inert`), theme + ' automatic workspace handoff');
    checks.push(theme + ': genuine authenticated startup traverses both confirmations and all original stages with zero clicks/keys, rejects forged completion messages, then removes the animation and restores workspace input');
  }
  await fill('input[name=password]', password); await js(`document.querySelector('.login-submit').click()`);
  await automatic('light');
  await js(`(async()=>{const u=await fetch('/api/auth/me').then(r=>r.json());const s=await window.brainDesktop.readState(u.id);s.settings.theme='dark';await window.brainDesktop.writeState(u.id,s)})()`);
  await web.loadURL(origin); await automatic('dark');
  await js(`location.hash='settings'`);
  await until(() => js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='预览启动动画')`), 'settings preview');
  const preview = () => js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='预览启动动画').click()`);
  await preview(); await until(() => !!child(), 'preview animation');
  await until(() => js(`!document.querySelector('.startup-animation')`), 'preview automatically returns');
  assert.equal(await js(`location.hash`), '#settings');
  await preview(); await until(() => !!child(), 'preview keyboard exit');
  assert.equal(await js(`!!document.querySelector('.startup-animation-skip')`), false, 'Settings preview has no skip button');
  web.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  web.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await until(() => js(`!document.querySelector('.startup-animation')`), 'keyboard returns');
  checks.push('Settings uses the same original automatic animation without a skip button, returns without navigation or reload, and retains the accessible Escape exit');
  expectedFailure = true;
  await preview();
  await until(() => js(`!document.querySelector('.startup-animation')`), 'failed runtime releases preview', 5000);
  await delay(150); expectedFailure = false;
  checks.push('A real blocked runtime resource releases the decorative overlay automatically and leaves the authenticated settings usable');
  await web.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await preview(); await delay(150);
  assert.equal(await js(`!!document.querySelector('.startup-animation')`), false);
  checks.push('System reduced-motion preference bypasses the decorative sequence without waiting');
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  const report = { version: require('../package.json').version, result: 'passed', platform: process.platform, checkedAt: new Date().toISOString(), checks, layouts, consoleErrors: errors, externalRequests: external, productionModelsCalled: false, systemPermissionsRequested: false };
  await fs.writeFile(resolve('artifacts/startup-animation-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); server.kill(); app.exit(0);
})().catch(async error => {
  console.error(error.stack);
  if (win && !win.isDestroyed()) await fs.writeFile(resolve('artifacts/startup-animation-failure.png'), (await win.webContents.capturePage()).toPNG()).catch(() => {});
  server?.kill(); app.exit(1);
});
