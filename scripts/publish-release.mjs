// Run only after all native builds and the server archive have passed verification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const tag = `v${version}`;
assert.equal(process.env.RELEASE_TAG, tag);
const repo = process.env.GH_REPO;
assert.ok(repo);
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const expected = [`Corporate-Brain-Setup-${version}-x64.exe`, `Corporate-Brain-${version}-macOS-arm64.dmg`, `Corporate-Brain-${version}-macOS-x64.dmg`, `Corporate-Brain-Server-${version}.zip`];
const directory = resolve('release-assets');
const files = (await readdir(directory)).sort();
const checksumLines = [];
for (const file of files.filter(file => /^SHA256SUMS-.+\.txt$/.test(file))) {
  checksumLines.push(...(await readFile(resolve(directory, file), 'utf8')).trim().split('\n'));
}
const manifest = new Map(checksumLines.map(line => { const match = line.match(/^([0-9a-f]{64})  ([^/\\]+)$/); assert.ok(match); return [match[2], match[1]]; }));
assert.equal(manifest.size, expected.length);
for (const file of expected) {
  assert.ok(files.includes(file), `Missing release artifact ${file}`);
  assert.equal(createHash('sha256').update(await readFile(resolve(directory, file))).digest('hex'), manifest.get(file));
}
await writeFile(resolve(directory, 'SHA256SUMS.txt'), expected.map(file => `${manifest.get(file)}  ${file}`).join('\n') + '\n');
const notes = `docs/releases/${tag}.md`;
const lookup = spawnSync('gh', ['api', `repos/${repo}/releases/tags/${tag}`], { encoding: 'utf8' });
let release;
if (lookup.status === 0) release = JSON.parse(lookup.stdout);
else {
  assert.match(lookup.stderr, /404/, 'Release lookup failed; do not publish on an unknown API error');
  gh('release', 'create', tag, '--repo', repo, '--draft', '--verify-tag', '--title', `${tag} 公司大脑 · Windows / macOS 测试版`, '--notes-file', notes);
  release = JSON.parse(gh('api', `repos/${repo}/releases/tags/${tag}`));
}
const uploads = [...files, 'SHA256SUMS.txt'];
if (!release.draft) {
  for (const file of uploads) assert.equal(release.assets.find(asset => asset.name === file)?.digest, 'sha256:' + createHash('sha256').update(await readFile(resolve(directory, file))).digest('hex'), 'Published assets cannot be changed; increment the version');
} else {
  gh('release', 'upload', tag, '--repo', repo, '--clobber', ...uploads.map(file => resolve(directory, file)));
  const uploaded = JSON.parse(gh('api', `repos/${repo}/releases/tags/${tag}`));
  for (const file of uploads) assert.equal(uploaded.assets.find(asset => asset.name === file)?.digest, 'sha256:' + createHash('sha256').update(await readFile(resolve(directory, file))).digest('hex'), `Uploaded digest differs for ${file}`);
  gh('release', 'edit', tag, '--repo', repo, '--draft=false', '--latest', '--notes-file', notes);
}
console.log(`Published and verified https://github.com/${repo}/releases/tag/${tag}`);
