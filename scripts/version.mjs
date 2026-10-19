import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const paths = ['package.json', 'package-lock.json', 'desktop/package.json'];
const files = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))));
const version = files[0].version;
assert.match(version, /^\d+\.\d+\.\d+$/);
assert.ok(files.every(file => file.version === version) && files[1].packages[''].version === version, 'Package versions must match before building or bumping');
const [action = 'check', tag] = process.argv.slice(2);
if (action === 'check') {
  if (tag) {
    assert.equal(tag, `v${version}`, 'Release tag and package version differ');
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
    assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', `refs/tags/${tag}^{commit}`), 'Build the exact tagged commit');
    const notes = await readFile(`docs/releases/${tag}.md`, 'utf8');
    assert.ok(notes.trim().length > 100 && !notes.includes('待填写'), 'Write complete release notes before publishing');
  }
  console.log(`Version checked: ${version}`);
} else {
  assert.ok(['patch', 'minor', 'major'].includes(action), 'Use patch, minor, major or check');
  let [major, minor, patch] = version.split('.').map(Number);
  if (action === 'major') { major++; minor = 0; patch = 0; }
  if (action === 'minor') { minor++; patch = 0; }
  if (action === 'patch') patch++;
  const next = `${major}.${minor}.${patch}`;
  files.forEach(file => { file.version = next; });
  files[1].packages[''].version = next;
  await Promise.all(paths.map((path, index) => writeFile(path, JSON.stringify(files[index], null, 2) + '\n')));
  console.log(`${version} -> ${next}; write docs/releases/v${next}.md before tagging`);
}
