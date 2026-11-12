import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(75); }
  throw new Error('Packaged connection timeout: ' + label);
}

// Test the actual distributed executable with normal, visible WebContents.
// Offscreen views and forced background rendering would conceal this bug.
export async function verifyPackagedConnection(binary) {
  const cases = [];
  for (const minimized of [false, true]) {
    const profile = await mkdtemp(join(tmpdir(), 'brain-visible-package-'));
    const pending = new Set();
    let pageResponse, child, socket, stderr = '', pageRequests = 0;
    const fixture = createServer((req, res) => {
      if (req.url === '/slow-image') { pending.add(res); return; }
      if (req.url !== '/') { res.writeHead(404); res.end(); return; }
      pageRequests++;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.write('<!doctype html><title>Connection handoff verification</title><body><div id="root">');
      pageResponse = res;
    }).listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    const origin = `http://127.0.0.1:${fixture.address().port}`;
    const portServer = createServer().listen(0, '127.0.0.1');
    await once(portServer, 'listening');
    const port = portServer.address().port;
    await new Promise(resolve => portServer.close(resolve));
    const env = { ...process.env, BRAIN_APP_URL: origin };
    delete env.BRAIN_VERIFY; delete env.BRAIN_ADMIN_SETUP; delete env.ELECTRON_RUN_AS_NODE;
    try {
      child = spawn(binary, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], {
        env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      });
      child.stderr.on('data', chunk => { if (stderr.length < 4000) stderr += chunk.toString(); });
      const pages = async () => {
        if (child.exitCode !== null || child.signalCode !== null) throw Error('Packaged client exited: ' + stderr);
        try { return await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json(); }
        catch { return []; }
      };
      await until(() => !!pageResponse, 'company request started');
      let target;
      await until(async () => {
        const list = await pages();
        assert.ok(list.some(page => page.url.includes('startup.html')), 'Native cover must be present while content is incomplete');
        target = list.find(page => page.type === 'page' && page.url.startsWith(origin));
        return !!target;
      }, 'committed company document');
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await once(socket, 'open');
      let nextId = 0;
      const cdp = (method, params) => new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(Error('CDP timeout: ' + method)); }, 4000);
        const receive = event => {
          const value = JSON.parse(event.data);
          if (value.id !== id) return;
          clearTimeout(timer); socket.removeEventListener('message', receive);
          if (value.error) reject(Error(JSON.stringify(value.error))); else resolve(value.result);
        };
        socket.addEventListener('message', receive);
        socket.send(JSON.stringify({ id, method, params }));
      });
      const evaluate = async expression => {
        const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      if (minimized) {
        await until(() => evaluate(`typeof window.brainDesktop?.windowAction === 'function'`), 'native window controls available');
        await evaluate(`window.brainDesktop.windowAction('minimize');true`);
        await until(() => evaluate('document.visibilityState === "hidden"'), 'actual minimized window');
      }
      const visibilityBefore = await evaluate('document.visibilityState');
      const readyAt = Date.now();
      pageResponse.end('<h1 id="company-ready">Ready company page</h1></div><img src="/slow-image"></body>');
      await until(async () => {
        const list = await pages();
        return !list.some(page => page.url.includes('startup.html')) &&
          await evaluate(`document.getElementById('company-ready')?.textContent === 'Ready company page'`);
      }, 'native cover removed without waiting for animation frames', 6000);
      const elapsed = Date.now() - readyAt;
      assert.equal(pageRequests, 1, 'No timeout/retry navigation is needed for an already usable page');
      assert.ok(pending.size > 0, 'Handoff must not wait for the deliberately pending image');
      cases.push({ minimized, visibilityBefore, contentToHandoffMs: elapsed, coverRemoved: true, navigationCount: pageRequests, pendingResourceDidNotBlock: true });
      await cdp('Browser.close', {}).catch(() => {});
    } finally {
      socket?.close();
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill();
        await Promise.race([once(child, 'exit'), delay(3000)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      for (const res of pending) res.destroy();
      pageResponse?.destroy();
      fixture.closeAllConnections(); fixture.close();
    }
  }
  return { result: 'passed', normalPackagedMode: true, offscreen: false, forcedBackgroundRendering: false, cases };
}
