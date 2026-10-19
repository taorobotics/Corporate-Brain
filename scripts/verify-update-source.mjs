// Post-publication smoke check against the real private release. Never installs.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createPlatform } from '../server/platform.ts';
const require = createRequire(import.meta.url);
const { DesktopUpdates } = require('../desktop/updates.cjs');
const token = process.env.GH_TOKEN || process.env.BRAIN_GITHUB_TOKEN;
assert.ok(token, 'Set a server-side read token for this verification');
assert.match(process.env.RELEASE_TAG || '', /^v\d+\.\d+\.\d+$/);
const platform = createPlatform({ database: ':memory:', updates: { token } });
const server = createServer(platform.app).listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const directory = await mkdtemp(join(tmpdir(), 'brain-release-smoke-'));
try {
  const password = randomBytes(20).toString('hex');
  const setup = await fetch(origin + '/api/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyName: 'Isolated update verification', name: 'Update QA', username: 'update-qa', password }) });
  assert.equal(setup.status, 201);
  const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'update-qa', password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const updater = new DesktopUpdates({ version: '0.0.0', platform: 'win32', arch: 'x64', directory,
    request: (path, options) => fetch(origin + path, { ...options, headers: { Cookie: cookie }, redirect: 'error' }), notify: () => {} });
  const available = await updater.check();
  assert.equal(available.status, 'available', available.error);
  assert.equal(available.release.version, process.env.RELEASE_TAG.slice(1));
  const downloaded = await updater.download();
  assert.equal(downloaded.status, 'ready', downloaded.error);
  await updater.verify();
  const report = { verifiedAt: new Date().toISOString(), releaseVersion: downloaded.release.version, repository: 'taorobotics/Corporate-Brain', runtime: 'Native updater module on Node, authenticated disposable company HTTP service, real private GitHub API and complete release asset', workflow: process.env.GITHUB_RUN_ID ? `https://github.com/taorobotics/Corporate-Brain/actions/runs/${process.env.GITHUB_RUN_ID}` : null, emulatedClientVersion: '0.0.0', target: downloaded.target, bytes: downloaded.release.asset.bytes, sha256: downloaded.release.asset.sha256, metadataRead: true, packageDownloadedAndVerified: true, installerExecuted: false, database: 'disposable in-memory', credentialBundled: false, employeeDeviceInstallTested: false };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/update-source-verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.close(); platform.store.close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('brain-release-smoke-'));
  await rm(directory, { recursive: true, force: true });
}
