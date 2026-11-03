// Checks the actual DMG on its native Mac runner, with a disposable local profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { listPackage, extractFile } from '@electron/asar';
import { legalFiles } from './legal-files.mjs';
import { brandFiles } from './brand-files.mjs';

assert.equal(process.platform, 'darwin', 'Run package checks on macOS');
const arch = process.env.TARGET_ARCH || process.arch;
assert.equal(arch, process.arch, 'Use a native runner for each architecture');
const { version } = JSON.parse(await readFile('desktop/package.json', 'utf8'));
const dmg = resolve(`release/Corporate-Brain-${version}-macOS-${arch}.dmg`);
const scratch = await mkdtemp(join(tmpdir(), 'corporate-brain-dmg-'));
const mount = join(scratch, 'volume');
const checks = [];
let mounted = false, child, socket, fixture;
const command = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 60000 });
try {
  command('hdiutil', ['verify', dmg]);
  command('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
  mounted = true;
  const apps = (await readdir(mount)).filter(name => name.endsWith('.app'));
  assert.equal(apps.length, 1);
  const app = join(mount, apps[0]);
  const plist = join(app, 'Contents/Info.plist');
  const plistValue = key => command('plutil', ['-extract', key, 'raw', '-o', '-', plist]).trim();
  assert.equal(plistValue('CFBundleShortVersionString'), version);
  assert.equal(plistValue('CFBundleIdentifier'), 'com.corporatebrain.desktop');
  const bundleIcon = plistValue('CFBundleIconFile');
  assert.equal(basename(bundleIcon), bundleIcon, 'Bundle icon must be a local resource');
  assert.deepEqual(await readFile(join(app, 'Contents/Resources', bundleIcon.endsWith('.icns') ? bundleIcon : `${bundleIcon}.icns`)), await readFile('build/generated/brand/company-brain.icns'), 'macOS application icon matches approved brand artwork');
  const binary = join(app, 'Contents/MacOS', plistValue('CFBundleExecutable'));
  assert.equal(command('lipo', ['-archs', binary]).trim(), arch === 'x64' ? 'x86_64' : arch);
  command('codesign', ['--verify', '--deep', '--strict', app]);
  checks.push('DMG integrity, native architecture, bundle version and ad-hoc code signature');

  const asar = join(app, 'Contents/Resources/app.asar');
  const files = listPackage(asar).map(path => path.replace(/^\//, '')).filter(path => !listPackage(asar).some(other => other.startsWith(`/${path}/`))).sort();
  const allowed = ['fonts.css', 'fonts/NotoSansSC-VF.woff2', 'fonts/OFL.txt', 'fonts/source.json', 'main.cjs', 'updates.cjs', 'production.cjs', 'package.json', 'preload.cjs', 'server-preload.cjs', 'server-setup.html', 'server-setup.js', 'startup.cjs', 'startup.html', 'startup.js', 'appearance.cjs', 'startup-preload.cjs', 'startup.css', 'entry-scene.js', 'entry-scene.css', ...legalFiles].sort();
  assert.deepEqual(files, [...allowed, ...brandFiles].sort());
  assert.equal(JSON.parse(extractFile(asar, 'package.json').toString()).version, version);
  assert.equal(JSON.parse(await readFile(join(app, 'Contents/Resources/company-server.json'), 'utf8')).url, process.env.BRAIN_APP_URL || '', 'Packaged company connection must match the configured release destination');
  for (const file of files) assert.deepEqual(extractFile(asar, file), await readFile(resolve('desktop', file)), `Packaged source differs: ${file}`);
  const chromiumNotices = command('find', [app, '-name', 'LICENSES.chromium.html']).trim().split('\n').filter(Boolean);
  assert.ok(chromiumNotices.length > 0, 'Electron/Chromium license notice must remain in the Mac runtime');
  checks.push('Bundled MIT, privacy and dependency notices match source; Electron/Chromium notices retained');
  checks.push('Client-only ASAR allowlist: no company database, credentials or development dependencies');

  const portServer = createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const env = { ...process.env };
  // Inspect bundled company configuration above. Native interaction is tested
  // against a disposable company page, without depending on production uptime.
  fixture = createHttpServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html><head><title>Package verification</title></head><body>Disposable company page</body></html>');
  }).listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  env.BRAIN_APP_URL = `http://127.0.0.1:${fixture.address().port}`;
  delete env.BRAIN_VERIFY;
  env.BRAIN_ADMIN_SETUP = '1';
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(binary, [`--user-data-dir=${join(scratch, 'profile')}`, `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  let target;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited ${child.exitCode}: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const pages = await response.json();
      target = pages.find(page => page.type === 'page' && page.url.includes('server-setup.html'));
      if (target) break;
      const companyPage = pages.find(page => page.type === 'page' && page.url.startsWith(env.BRAIN_APP_URL + '/'));
      if (companyPage) {
        const setupSocket = new WebSocket(companyPage.webSocketDebuggerUrl);
        await once(setupSocket, 'open');
        try {
          const reply = new Promise((accept, reject) => {
            const timer = setTimeout(() => reject(new Error('Packaged administrator bridge timed out')), 5000);
            setupSocket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.id === 1) { clearTimeout(timer); accept(value); } });
          });
          setupSocket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'window.brainDesktop.changeServer()', awaitPromise: true, returnByValue: true } }));
          const result = await reply;
          assert.ok(!result.error && !result.result?.exceptionDetails, 'Native administrator setup bridge must work');
        } finally { setupSocket.close(); }
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(target, `First-run connection page did not open: ${stderr}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, 'open');
  let nextId = 0;
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    const receive = event => {
      const result = JSON.parse(event.data);
      if (result.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener('message', receive);
      if (result.error || result.exceptionDetails) reject(new Error(JSON.stringify(result)));
      else resolve(result.result);
    };
    socket.addEventListener('message', receive);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const page = await evaluate(`(async () => { await document.fonts.ready; return { title: document.title, heading: document.querySelector('h1')?.textContent, bridge: typeof window.companyConnection?.connect, node: typeof window.require, font: getComputedStyle(document.body).fontFamily }; })()`);
  assert.equal(page.heading, '公司大脑未配置');
  assert.equal(page.bridge, 'function');
  assert.equal(page.node, 'undefined');
  checks.push('Packaged company URL matches release configuration; first launch loads an isolated company fixture and opens administrator connection UI with isolated preload and Chinese fonts');
  await evaluate(`(async () => { document.querySelector('input').value = 'http://insecure.example.com'; document.querySelector('form').requestSubmit(); for (let i = 0; i < 50 && !document.querySelector('.error').textContent; i++) await new Promise(r => setTimeout(r, 100)); return true; })()`);
  assert.match(await evaluate("document.querySelector('.error').textContent"), /HTTPS/);
  checks.push('Packaged client rejects insecure remote company URLs');
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(`release/macos-first-launch-${arch}.png`, Buffer.from(screenshot.data, 'base64'));
  const desktop = JSON.parse(await readFile('artifacts/desktop-verification.json', 'utf8'));
  const sha256 = createHash('sha256').update(await readFile(dmg)).digest('hex');
  const startupVerification = JSON.parse(await readFile('artifacts/startup-verification.json', 'utf8'));
  assert.equal(startupVerification.result, 'passed');
  const report = { version, architecture: arch, platform: process.platform, os: command('sw_vers', ['-productVersion']).trim(), sourceCommit: command('git', ['rev-parse', 'HEAD']).trim(), workflowRun: process.env.GITHUB_RUN_ID || null, createdAt: new Date().toISOString(), artifact: basename(dmg), bytes: (await readFile(dmg)).length, sha256, signing: 'ad-hoc', developerIdSigned: false, notarized: false, physicalEmployeeMacTested: false, files, checks, firstLaunch: page, desktopVerification: desktop, startupVerification };
  await writeFile(`release/macos-verification-${arch}.json`, JSON.stringify(report, null, 2) + '\n');
  await writeFile(`release/SHA256SUMS-macOS-${arch}.txt`, `${sha256}  ${basename(dmg)}\n`);
  console.log(JSON.stringify({ artifact: basename(dmg), sha256, checks, desktopChecks: desktop.checks.length }, null, 2));
} finally {
  socket?.close();
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (mounted) command('hdiutil', ['detach', mount, '-force']);
  fixture?.close();
  await rm(scratch, { recursive: true, force: true });
}
