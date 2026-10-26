import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--win')) {
  const { prepareInstaller } = await import('./prepare-installer.mjs');
  await prepareInstaller();
}
const localRuntime = resolve('node_modules/electron/dist');
const options = existsSync(localRuntime) && args.includes('--win') ? [`--config.electronDist=${localRuntime}`] : [];
const child = spawn(process.execPath, [resolve('node_modules/electron-builder/cli.js'), ...args, ...options], { stdio: 'inherit', windowsHide: true, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || resolve('.cache/electron-builder') } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
