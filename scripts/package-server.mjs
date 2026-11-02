import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const stage = await mkdtemp(join(tmpdir(), 'corporate-brain-server-'));
const artifact = `Corporate-Brain-Server-${version}.zip`;
const output = resolve('release', artifact);
await mkdir('release', { recursive: true });
try {
  for (const path of ['dist', 'server', 'shared', 'package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'SECURITY.md']) {
    await cp(path, join(stage, path), { recursive: true, filter: source => !/[/\\](?:qa|[^/\\]+\.test)\.ts$/.test(source) });
  }
  await mkdir(join(stage, 'docs/releases'), { recursive: true });
  for (const path of ['docs/DEPLOYMENT.md', 'docs/RELEASE-POLICY.md', 'docs/UPDATE-DISTRIBUTION.md', 'docs/PRIVACY.md', 'docs/CODE_SIGNING_POLICY.md', 'docs/dependency-licenses.json', `docs/releases/v${version}.md`]) await cp(path, join(stage, path));
  await mkdir(join(stage, 'scripts'), { recursive: true });
  await cp('scripts/setup-update-publisher.sh', join(stage, 'scripts/setup-update-publisher.sh'));
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$ErrorActionPreference = "Stop"; Compress-Archive -Path (Join-Path $env:CB_STAGE "*") -DestinationPath $env:CB_OUTPUT -Force',
      ],
      { stdio: 'inherit', env: { ...process.env, CB_STAGE: stage, CB_OUTPUT: output } },
    );
  } else {
    execFileSync('zip', ['-q', '-r', output, '.'], { cwd: stage });
  }
  const entries = execFileSync(
    process.platform === 'win32' ? 'tar' : 'unzip',
    process.platform === 'win32' ? ['-tf', output] : ['-Z1', output],
    { encoding: 'utf8' },
  )
    .trim()
    .split(/\r?\n/)
    .map((entry) => entry.replace(/^\.\//, ''));
  assert.ok(entries.includes('dist/index.html') && entries.includes('server/index.ts') && entries.includes('package-lock.json'));
  assert.ok(!entries.some(path => /(^|\/)(?:\.data|\.env|node_modules|\.cache|profiles)(\/|$)/.test(path)));
  const bytes = await readFile(output);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile('release/SHA256SUMS-Server.txt', `${sha256}  ${artifact}\n`);
  await writeFile('release/server-verification.json', JSON.stringify({ version, artifact, sha256, bytes: bytes.length, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), files: entries, companyDataIncluded: false, dependenciesIncluded: false, frontendBuilt: true, archiveIntegrity: 'passed' }, null, 2) + '\n');
  console.log(JSON.stringify({ artifact, sha256, bytes: bytes.length }));
} finally {
  await rm(stage, { recursive: true, force: true });
}
