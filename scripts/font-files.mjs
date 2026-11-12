import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const directory = 'fonts/noto-sans-sc/v41';
const manifest = JSON.parse(await readFile(`desktop/${directory}/provenance.json`, 'utf8'));
assert.equal(manifest.family, 'Noto Sans SC');
assert.equal(manifest.provider_version, 'v41');
assert.equal(manifest.weight_range, '100 900');
assert.equal(manifest.files.length, manifest.subset_count);
assert.equal(new Set(manifest.files.map(entry => entry.file)).size, manifest.subset_count);
assert.equal(manifest.files.reduce((bytes, entry) => bytes + entry.bytes, 0), manifest.total_font_bytes);
assert.match(manifest.stylesheet, /^noto-sans-sc\.[a-f0-9]{16}\.css$/);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const fontFiles = ['fonts.css', 'fonts/OFL.txt', 'fonts/Inter-OFL.txt', `${directory}/OFL.txt`, `${directory}/provenance.json`, `${directory}/${manifest.stylesheet}`];
for (const entry of manifest.files) {
  assert.match(entry.file, /^subset\.[a-f0-9]{16}\.woff2$/);
  const bytes = await readFile(`desktop/${directory}/${entry.file}`);
  assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
  assert.equal(bytes.length, entry.bytes);
  assert.equal(hash(bytes), entry.sha256);
  assert.equal(entry.file, `subset.${entry.sha256.slice(0, 16)}.woff2`);
  fontFiles.push(`${directory}/${entry.file}`);
}
const css = await readFile(`desktop/${directory}/${manifest.stylesheet}`);
assert.equal(hash(css), manifest.stylesheet_sha256);
assert.equal(manifest.stylesheet, `noto-sans-sc.${hash(css).slice(0, 16)}.css`);
assert.equal((css.toString().match(/@font-face/g) || []).length, manifest.subset_count);
assert.equal((css.toString().match(/unicode-range:/g) || []).length, manifest.subset_count);
assert.equal((css.toString().match(/font-display: swap/g) || []).length, manifest.subset_count);
for (const entry of manifest.files) assert.ok(css.toString().includes(`./${entry.file}`));
assert.ok(!css.toString().includes('https://'));
assert.equal(hash(await readFile(`desktop/${directory}/OFL.txt`)), manifest.license_sha256);
for (const file of fontFiles) assert.deepEqual(await readFile(`public/${file}`), await readFile(`desktop/${file}`), `Web and offline font assets differ: ${file}`);
