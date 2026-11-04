# Runs the real NSIS handoff functions with an inert window and isolated files.
# No production registry key, installation, profile or updater cache is changed.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/installer-ui.ps1"
$workspace = (Resolve-Path "$PSScriptRoot/..").Path
$probe = Join-Path $workspace ('.cache/update-handoff-probe/' + [Guid]::NewGuid().ToString('N'))
$cache = Join-Path $probe 'updates'
$installed = Join-Path $probe 'installed'
New-Item -ItemType Directory -Path $cache,$installed -Force | Out-Null
$builderCache = if ($env:ELECTRON_BUILDER_CACHE) { $env:ELECTRON_BUILDER_CACHE } else { Join-Path $workspace '.cache/electron-builder' }
$compiler = Get-ChildItem -LiteralPath $builderCache -Recurse -Filter makensis.exe | Where-Object { $_.Directory.Name -ne 'Bin' } | Select-Object -First 1
$plugins = Get-ChildItem -LiteralPath $builderCache -Recurse -Filter StdUtils.dll | Where-Object { $_.Directory.Name -eq 'x86-unicode' } | Select-Object -First 1
if (-not $compiler -or -not $plugins) { throw 'Build the Windows installer before running the isolated handoff probe' }
$locator = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $locator -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$setup = Join-Path $vs 'VC/Auxiliary/Build/vcvars32.bat'
$stub = Join-Path $installed 'BrainHandoffProbe.exe'
$cpp = Join-Path $probe 'probe.cpp'
'#include <windows.h>
int WINAPI WinMain(HINSTANCE,HINSTANCE,LPSTR,int) { MessageBoxW(0,L"Isolated company update test",L"Update probe",MB_OK); ExitProcess(0); }' | Set-Content -LiteralPath $cpp -Encoding utf8
& cmd.exe /d /s /c "call `"$setup`" >nul && cl.exe /nologo /utf-8 /O2 /GS- /Fo`"$probe/probe.obj`" `"$cpp`" /link /NODEFAULTLIB /ENTRY:WinMain /SUBSYSTEM:WINDOWS /MANIFEST:EMBED /MANIFESTUAC:`"level='asInvoker' uiAccess='false'`" /OUT:`"$stub`" kernel32.lib user32.lib"
if ($LASTEXITCODE -ne 0) { throw 'Probe window compilation failed' }
New-Item -ItemType Directory -Path (Join-Path $installed 'resources') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $installed 'resources/app.asar'),'Inert isolated handoff fixture')
$pages = Get-Content -LiteralPath (Join-Path $workspace 'build/windows/pages.nsh') -Raw
$theme = Get-Content -LiteralPath (Join-Path $workspace 'build/windows/theme.nsh') -Raw
$functions = foreach ($name in @('BrainDetectUpdate','BrainSignalUpdateReady','BrainRestartAfterUpdate')) {
  $match = [regex]::Match($pages, "(?ms)^Function $name\r?\n.*?^FunctionEnd")
  if (-not $match.Success) { throw "Installer function missing: $name" }
  $match.Value.Replace('$APPDATA\corporate-brain-desktop\updates',$cache)
}
$running = [regex]::Match($theme,'(?ms)^!macro customCheckAppRunning\r?\n.*?^!macroend').Value
$variables = "Var BrainOldVersion`nVar BrainAutoUpdate`nVar BrainUpdateToken`nVar BrainLaunchStarted"
$nsi = @'
Unicode true
RequestExecutionLevel user
Name "Isolated update handoff probe"
OutFile "__PROBE__\probe.exe"
!define VERSION "9.0.1"
!define APP_EXECUTABLE_FILENAME "BrainHandoffProbe.exe"
!addincludedir "__WORKSPACE__\node_modules\app-builder-lib\templates\nsis\include"
!include LogicLib.nsh
!include FileFunc.nsh
!include WordFunc.nsh
!include WinMessages.nsh
!include UAC.nsh
!include StdUtils.nsh
!addplugindir /x86-unicode "__PLUGINS__"
!addplugindir /x86-unicode "__WORKSPACE__\build\windows\generated"
Var appExe
__VARIABLES__
__FUNCTIONS__
__RUNNING__
Function .onInit
  StrCpy $INSTDIR "__INSTALLED__"
  StrCpy $BrainOldVersion "9.0.0"
  StrCpy $BrainAutoUpdate 0
  StrCpy $BrainUpdateToken ""
  Call BrainDetectUpdate
FunctionEnd
Section
  FileOpen $0 "__PROBE__\detected.txt" w
  FileWrite $0 "$BrainAutoUpdate"
  FileClose $0
  ${If} $BrainAutoUpdate != 1
    SetErrorLevel 0
    Quit
  ${EndIf}
  StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  Call BrainSignalUpdateReady
  !insertmacro customCheckAppRunning
  FileOpen $0 "__PROBE__\stage.txt" w
  FileWrite $0 "commit would begin here"
  FileClose $0
  Call BrainRestartAfterUpdate
SectionEnd
'@
$nsi = $nsi.Replace('__PROBE__',$probe).Replace('__PLUGINS__',$plugins.Directory.FullName).Replace('__WORKSPACE__',$workspace).Replace('__INSTALLED__',$installed).Replace('__VARIABLES__',$variables).Replace('__FUNCTIONS__',($functions -join "`n")).Replace('__RUNNING__',$running)
$script = Join-Path $probe 'probe.nsi'
$nsi | Set-Content -LiteralPath $script -Encoding utf8
& $compiler.FullName /V2 /INPUTCHARSET UTF8 $script
if ($LASTEXITCODE -ne 0) { throw 'NSIS probe compilation failed' }
$exe = Join-Path $probe 'probe.exe'
$stage = Join-Path $probe 'stage.txt'
$checks = [Collections.Generic.List[string]]::new()
$owned = [Collections.Generic.List[Diagnostics.Process]]::new()
function Start-Probe([string]$File, [string[]]$Arguments = @()) {
  $settings = @{ FilePath=$File; PassThru=$true; WindowStyle='Hidden' }
  if ($Arguments.Count) { $settings.ArgumentList=$Arguments }
  $p = Start-Process @settings
  $owned.Add($p)
  return $p
}
function Wait-ProbeFile([string]$File) {
  $until = [DateTime]::UtcNow.AddSeconds(15)
  while (-not (Test-Path -LiteralPath $File) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 50 }
  if (-not (Test-Path -LiteralPath $File)) { throw "Probe file missing: $([IO.Path]::GetFileName($File))" }
}
function Close-ProbeWindow([Diagnostics.Process]$Process) {
  # This fixture has no user data. End only this exact inert executable; the
  # actual installer must wait and is never allowed to terminate the client.
  if ($Process.Path -ne $stub) { throw 'Refusing to end a process outside the isolated probe' }
  Stop-Process -Id $Process.Id
  if (-not $Process.WaitForExit(10000)) { throw 'Inert probe process did not exit' }
}
try {
  $manual = Start-Probe $exe
  if (-not $manual.WaitForExit(10000) -or [IO.File]::ReadAllText((Join-Path $probe 'detected.txt')) -ne '0' -or (Test-Path -LiteralPath $stage)) { throw 'Manual installer incorrectly selected automatic mode' }
  $checks.Add('A manually launched installer retains the normal install path')
  $invalid = Start-Probe $exe @('/S','--brain-update=../invalid')
  if (-not $invalid.WaitForExit(10000) -or $invalid.ExitCode -ne 2 -or (Test-Path -LiteralPath $stage)) { throw 'Invalid update token was accepted' }
  $checks.Add('Non-hexadecimal/path-bearing update tokens are rejected')
  $token = [Guid]::NewGuid().ToString('N')
  $cancelled = Start-Probe $exe @('/S',"--brain-update=$token")
  Wait-ProbeFile (Join-Path $cache "$token.ready")
  if (-not $cancelled.WaitForExit(20000) -or $cancelled.ExitCode -ne 2 -or (Test-Path -LiteralPath $stage)) { throw 'A missing proceed signal did not cancel safely' }
  $checks.Add('Real silent installer readiness times out without committing')
  foreach ($legacy in @($false,$true)) {
    $old = Start-Probe $stub
    [void](Wait-InstallerText $old.Id 'Isolated company update test')
    if ($legacy) {
      $cached = Join-Path $cache '0123456789abcdef-Corporate-Brain-Setup-9.0.1-x64.exe'
      Copy-Item -LiteralPath $exe -Destination $cached
      $installer = Start-Probe $cached
    } else {
      $token = [Guid]::NewGuid().ToString('N')
      $installer = Start-Probe $exe @('/S',"--brain-update=$token")
      Wait-ProbeFile (Join-Path $cache "$token.ready")
      [IO.File]::WriteAllText((Join-Path $cache "$token.proceed"),'proceed')
    }
    Start-Sleep -Milliseconds 400
    if ($installer.HasExited -or (Test-Path -LiteralPath $stage) -or $old.HasExited) { throw 'Installer failed to wait for the running application' }
    if (@([InstallerWindow]::Windows($installer.Id) | Where-Object Visible).Count) { throw 'Automatic mode displayed an installer window' }
    Close-ProbeWindow $old
    if (-not $installer.WaitForExit(30000) -or $installer.ExitCode -ne 0) { throw 'Silent handoff did not finish after the application closed' }
    Wait-ProbeFile $stage
    $restarted = Get-Process -Name BrainHandoffProbe | Where-Object Path -eq $stub | Select-Object -First 1
    if (-not $restarted -or -not ([InstallerWindow]::Windows($restarted.Id) | Where-Object Visible)) { throw 'Updated application window did not restart' }
    $owned.Add($restarted)
    Close-ProbeWindow $restarted
    Remove-Item -LiteralPath $stage
    $checks.Add($(if($legacy){'Legacy cache launch has no wizard, waits for the old process and restarts a real window'}else{'Native silent handoff waits for the old process and restarts a real window'}))
  }
  @{result='passed';version=(Get-Content (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json).version;scope='Isolated real NSIS handoff functions with inert executable; no installation or production data';checks=$checks;fullInstallUpgradeUninstall=$false;sourceCommit=(git rev-parse HEAD)} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $workspace 'artifacts/update-handoff-verification.json') -Encoding utf8
  Write-Output "Isolated native updater handoff passed: $($checks.Count) checks"
} finally {
  foreach ($p in $owned) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -ErrorAction SilentlyContinue } }
  Get-Process -Name BrainHandoffProbe -ErrorAction SilentlyContinue | Where-Object Path -eq $stub | Stop-Process -ErrorAction SilentlyContinue
}
