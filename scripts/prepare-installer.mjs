import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

// Keep upstream installation/upgrade primitives; fail closed if their integration points change.
export async function prepareInstaller() {
  assert.equal(process.platform, 'win32', 'Build the Windows installer on a native Windows runner');
  const target = resolve('build/windows/generated');
  await mkdir(target, { recursive: true });
  const assisted = await readFile('node_modules/app-builder-lib/templates/nsis/assistedInstaller.nsh', 'utf8');
  assert.ok(assisted.includes('!macro initMultiUser'));
  await writeFile(resolve(target, 'init-mode.nsh'), assisted.slice(assisted.indexOf('!macro initMultiUser')));
  await writeFile(resolve(target, 'spinner-files.nsh'), Array.from({ length: 16 }, (_, index) => `File /oname=$PLUGINSDIR\\brain-spinner-${index}.bmp "\u0024{BUILD_RESOURCES_DIR}\\windows\\generated\\spinner-${index}.bmp"`).join('\n') + '\n');
  const replace = (text, from, to) => {
    assert.equal(text.split(from).length, 2, `Upstream NSIS integration changed: ${from}`);
    return text.replace(from, to);
  };
  const primitives = await readFile('node_modules/app-builder-lib/templates/nsis/include/installer.nsh', 'utf8');
  let script = replace(primitives, '  File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"', '  WriteUninstaller "$OUTDIR\\${UNINSTALL_FILENAME}"');
  const extraction = await readFile('node_modules/app-builder-lib/templates/nsis/include/extractAppPackage.nsh', 'utf8');
  const extractionMacro = extraction.match(/^!macro extractUsing7za FILE\r?\n[\s\S]*?^!macroend/gm);
  assert.equal(extractionMacro?.length, 1, 'Upstream extraction integration changed');
  await writeFile(resolve(target, 'extract-app-package.nsh'), extraction.replace(extractionMacro[0], '!include "${BUILD_RESOURCES_DIR}\\windows\\extract.nsh"'));
  script = replace(script, '!include "extractAppPackage.nsh"', '!include "${BUILD_RESOURCES_DIR}\\windows\\generated\\extract-app-package.nsh"');
  await writeFile(resolve(target, 'installer-primitives.nsh'), script);
  const locator = resolve(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe');
  const visualStudio = execFileSync(locator, ['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'], {encoding:'utf8',windowsHide:true}).trim();
  assert.ok(visualStudio, 'Windows installer UI requires the Visual C++ x86 build tools');
  const compilerSetup = resolve(visualStudio, 'VC/Auxiliary/Build/vcvars32.bat');
  const command = `call "${compilerSetup}" >nul && cl.exe /nologo /utf-8 /LD /O2 /W4 /WX /GS- /GR- /EHs-c- /Fo"${resolve(target,'BrainWizard.obj')}" "${resolve('build/windows/BrainWizard.cpp')}" /link /NODEFAULTLIB /ENTRY:DllMain /DEF:"${resolve('build/windows/BrainWizard.def')}" /OUT:"${resolve(target,'BrainWizard.dll')}" /IMPLIB:"${resolve(target,'BrainWizard.lib')}" user32.lib gdi32.lib comctl32.lib kernel32.lib`;
  execFileSync('cmd.exe', ['/d','/s','/c',command], {stdio:'inherit',windowsHide:true,windowsVerbatimArguments:true});
  const plugin = await readFile(resolve(target,'BrainWizard.dll'));
  assert.equal(plugin.readUInt16LE(plugin.readUInt32LE(0x3c)+4), 0x14c, 'NSIS UI plug-in must be x86');
  await new Promise((done, reject) => {
    const child = spawn(resolve('node_modules/electron/dist/electron.exe'), [resolve('scripts/installer-assets.cjs'), target], {
      stdio: 'inherit', windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? done() : reject(new Error(`Installer artwork failed (${code})`)));
  });
}
