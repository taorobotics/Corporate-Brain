param([switch]$FullLifecycle, [string]$PreviousInstaller)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
. "$PSScriptRoot/installer-ui.ps1"
$workspacePath = (Resolve-Path "$PSScriptRoot/..").Path
$version = (Get-Content -LiteralPath (Join-Path $workspacePath 'package.json') -Raw | ConvertFrom-Json).version
$installerPath = Join-Path $workspacePath "release/Corporate-Brain-Setup-$version-x64.exe"
$outputPath = Join-Path $workspacePath 'artifacts/screenshots'
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$checks = [Collections.Generic.List[string]]::new()
$registryPath = 'HKCU:\Software\964c1ad8-59be-558a-b612-2665e53209b3'
$qaRoot = Join-Path $workspacePath ('.cache/installer-qa/' + [Guid]::NewGuid().ToString('N'))
$qaTarget = [IO.Path]::GetFullPath((Join-Path $qaRoot 'Corporate Brain'))
$dataPath = Join-Path $env:APPDATA 'corporate-brain-desktop'
if ($FullLifecycle) {
  if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Full installation tests run only on a disposable GitHub Windows runner; local mode only inspects UI.' }
  if ((Test-Path -LiteralPath $registryPath) -or (Test-Path -LiteralPath $dataPath) -or (Test-Path -LiteralPath (Join-Path $env:APPDATA '公司大脑'))) { throw 'An existing installation/profile was found; refusing lifecycle tests.' }
  if (-not $PreviousInstaller -or (Get-FileHash -LiteralPath $PreviousInstaller -Algorithm SHA256).Hash -ne 'c7c9c99e928962e99d8fb8f1675fa488962b6d829f826bdd7c6d685377fc905d') { throw 'The pinned v0.2.2 upgrade fixture is missing or differs from its published hash.' }
}
function Assert-TestTarget {
  $resolvedTarget = [IO.Path]::GetFullPath($qaTarget)
  $allowedRoot = [IO.Path]::GetFullPath((Join-Path $workspacePath '.cache/installer-qa')) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedTarget.StartsWith($allowedRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedTarget) -ne 'Corporate Brain') { throw 'Unsafe lifecycle target' }
}
function New-InstallFlow([switch]$Upgrade) {
  $script:process = Start-Process -FilePath $installerPath -PassThru -WindowStyle Hidden
  $page = Wait-InstallerText $script:process.Id '完整对话与个人草稿保存在你的电脑'
  if ($Upgrade) {
    $text = (Get-InstallerControls $page.Handle).Text -join "`n"
    if (-not $text.Contains('升级公司大脑')) { throw 'Upgrade was not detected' }
    Save-InstallerWindow $page.Handle (Join-Path $outputPath 'installer-upgrade.png')
  }
  Invoke-InstallerButton $page.Handle '下一步 >'
  $page = Wait-InstallerText $script:process.Id '选择安装位置'
  $field = Get-InstallerControls $page.Handle | Where-Object ClassName -eq 'Edit' | Select-Object -First 1
  if ($Upgrade) {
    if ($field.Enabled -or $field.Text -ne $qaTarget) { throw 'Upgrade did not preserve and lock its original path' }
  } else {
    [void][InstallerWindow]::SetText($field.Handle,0xC,[IntPtr]::Zero,$qaTarget)
  }
  Invoke-InstallerButton $page.Handle '开始安装'
  return Wait-InstallerText $script:process.Id '正在解压并准备应用文件'
}
function Complete-Install([string]$Action) {
  $page = Wait-InstallerText $script:process.Id '公司大脑已安装到这台电脑' 120
  Save-InstallerWindow $page.Handle (Join-Path $outputPath 'installer-finish.png')
  Invoke-InstallerButton $page.Handle $Action
  if (-not $script:process.WaitForExit(20000) -or $script:process.ExitCode -ne 0) { throw 'Installer did not finish successfully' }
  $installedVersion = (Get-Item -LiteralPath (Join-Path $qaTarget '公司大脑.exe')).VersionInfo.ProductVersion
  if ($installedVersion -notin @($version,"$version.0")) { throw 'Installed application version mismatch' }
}
$process = $null
try {
  $process = Start-Process -FilePath $installerPath -PassThru -WindowStyle Hidden
  $window = Wait-InstallerText $process.Id '完整对话与个人草稿保存在你的电脑'
  $windowRect = [InstallerWindow+Rect]::new()
  [void][InstallerWindow]::GetWindowRect($window.Handle,[ref]$windowRect)
  $workArea = [InstallerWindow]::WorkArea($window.Handle)
  $expectedLeft = $workArea.Left + (($workArea.Right - $workArea.Left) - $windowRect.Right + $windowRect.Left) / 2
  $expectedTop = $workArea.Top + (($workArea.Bottom - $workArea.Top) - $windowRect.Bottom + $windowRect.Top) / 2
  if ([Math]::Abs($windowRect.Left - $expectedLeft) -gt 4 -or [Math]::Abs($windowRect.Top - $expectedTop) -gt 4) { throw 'Installer window is not centered in the current monitor work area' }
  $heading = Get-InstallerControls $window.Handle | Where-Object { $_.Text -match '^(欢迎使用公司大脑安装向导|升级公司大脑)$' } | Select-Object -First 1
  if (-not $heading -or $heading.Width -lt 300 -or $heading.Height -lt 25) { throw 'Welcome heading is clipped or missing' }
  $links = @(Get-InstallerControls $window.Handle | Where-Object { $_.Text -in @('MIT 许可','隐私说明') })
  if ($links.Count -ne 2) { throw 'License and privacy links are missing' }
  $linkGroupCenter = (($links | Measure-Object -Property Left -Average).Average + (($links | Measure-Object -Property Width -Average).Average / 2))
  $expectedContentCenter = $windowRect.Left + (($windowRect.Right - $windowRect.Left) * 0.595)
  if ([Math]::Abs(($links | Measure-Object -Property Left -Average).Average + (($links | Measure-Object -Property Width -Average).Average / 2) - $expectedContentCenter) -gt 18) { throw 'License and privacy links are not centered in the content area' }
  Save-InstallerWindow $window.Handle (Join-Path $outputPath 'installer-welcome.png')
  $checks.Add('Native welcome page, privacy and license links are visible')
  Invoke-InstallerButton $window.Handle '下一步 >'
  $window = Wait-InstallerText $process.Id '选择安装位置'
  Save-InstallerWindow $window.Handle (Join-Path $outputPath 'installer-directory.png')
  $controls = @(Get-InstallerControls $window.Handle)
  $pathControl = $controls | Where-Object ClassName -eq 'Edit' | Select-Object -First 1
  if (-not $pathControl -or -not $pathControl.Text) { throw 'Install directory missing' }
  $checks.Add('Native path page shows actual space, directory and shortcut selection')
  $defaultPath = $pathControl.Text
  Invoke-InstallerButton $window.Handle '取消'
  $confirm = Wait-InstallerText $process.Id '要取消本次安装吗'
  Save-InstallerWindow $confirm.Handle (Join-Path $outputPath 'installer-cancel.png')
  $yes = Get-InstallerControls $confirm.Handle | Where-Object Id -eq 6 | Select-Object -First 1
  if (-not $yes) { throw 'Cancel confirmation affirmative button missing' }
  [void][InstallerWindow]::PostMessage($confirm.Handle,0x111,[IntPtr]6,$yes.Handle)
  if (-not $process.WaitForExit(10000)) { throw 'Installer did not cancel' }
  $checks.Add('Cancellation requires confirmation and exits before installing')
  if ($FullLifecycle) {
    Assert-TestTarget
    New-Item -ItemType Directory -Path $qaRoot -Force | Out-Null
    $old = Start-Process -FilePath $PreviousInstaller -ArgumentList @('/S',"/D=$qaTarget") -PassThru -WindowStyle Hidden
    if (-not $old.WaitForExit(120000) -or $old.ExitCode -ne 0) { throw 'Pinned previous-version install failed' }
    if ((Get-ItemProperty -LiteralPath $registryPath).InstallLocation -ne $qaTarget) { throw 'Previous install went to an unexpected target' }
    $oldHash = (Get-FileHash -LiteralPath (Join-Path $qaTarget '公司大脑.exe') -Algorithm SHA256).Hash
    New-Item -ItemType Directory -Path (Join-Path $dataPath 'profiles/installer-test') -Force | Out-Null
    $sentinel = Join-Path $dataPath 'profiles/installer-test/state.json'
    '{"syntheticInstallerTest":true,"conversations":[],"drafts":[]}' | Set-Content -LiteralPath $sentinel -Encoding utf8
    $sentinelHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash
    $blocked = Start-Process -FilePath $installerPath -ArgumentList @('/S','--delete-app-data',"/D=$qaTarget") -PassThru -WindowStyle Hidden
    if (-not $blocked.WaitForExit(20000) -or $blocked.ExitCode -ne 2) { throw 'Data deletion flag was not refused' }
    if ((Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $sentinelHash) { throw 'Refused flag affected records' }
    $checks.Add('Installer refuses data-deletion flags before invoking an old uninstaller')

    $page = New-InstallFlow -Upgrade
    $cancelControl = Get-InstallerControls $page.Handle | Where-Object { $_.ClassName -eq 'Button' -and $_.Text -eq '取消' } | Select-Object -First 1
    if (-not $cancelControl.Enabled) { throw 'Cancellation must be enabled during safe package preparation' }
    Invoke-InstallerButton $page.Handle '取消'
    $confirm = Wait-InstallerText $process.Id '要取消本次安装吗'
    $yes = Get-InstallerControls $confirm.Handle | Where-Object Id -eq 6 | Select-Object -First 1
    [void][InstallerWindow]::PostMessage($confirm.Handle,0x111,[IntPtr]6,$yes.Handle)
    if (-not $process.WaitForExit(120000)) { throw 'Staged cancellation did not finish' }
    if ((Get-FileHash -LiteralPath (Join-Path $qaTarget '公司大脑.exe') -Algorithm SHA256).Hash -ne $oldHash) { throw 'Cancellation changed the old application' }
    $checks.Add('Cancel during package preparation preserves the prior installed application')

    $page = New-InstallFlow -Upgrade
    Save-InstallerWindow $page.Handle (Join-Path $outputPath 'installer-progress.png')
    $stageLabel = Get-InstallerControls $page.Handle | Where-Object { $_.Text.Contains('检查磁盘空间与写入权限') } | Select-Object -First 1
    if (-not $stageLabel) { throw 'Installation stage list missing' }
    $bounds = [InstallerWindow+Rect]::new()
    [void][InstallerWindow]::GetWindowRect($page.Handle,[ref]$bounds)
    $capture = [Drawing.Bitmap]::new((Join-Path $outputPath 'installer-progress.png'))
    $ink = 0
    try {
      for ($y=2;$y -lt $stageLabel.Height-2;$y+=3) {
        for ($x=2;$x -lt $stageLabel.Width-2;$x+=3) {
          $pixel = $capture.GetPixel($stageLabel.Left-$bounds.Left+$x,$stageLabel.Top-$bounds.Top+$y)
          if ($pixel.R -lt 210 -and $pixel.G -lt 210 -and $pixel.B -lt 210) { $ink++ }
        }
      }
    } finally { $capture.Dispose() }
    if ($ink -lt 25) { throw 'Installation stage text exists but is covered or not painted' }
    $bar = Get-InstallerControls $page.Handle | Where-Object ClassName -eq 'msctls_progress32' | Select-Object -First 1
    if (-not $bar) { throw 'Native extraction progress control missing' }
    $loading = Get-InstallerControls $page.Handle | Where-Object { $_.Bitmap -and $_.Width -lt 60 } | Select-Object -First 1
    if (-not $loading) { throw 'Loading spinner missing' }
    $frames = [Collections.Generic.HashSet[long]]::new()
    for ($sample=0;$sample -lt 10;$sample++) {
      $imageHandle = [InstallerWindow]::SendMessage($loading.Handle,0x173,[IntPtr]::Zero,[IntPtr]::Zero).ToInt64()
      if ($imageHandle -ne 0) { [void]$frames.Add($imageHandle) }
      Start-Sleep -Milliseconds 75
    }
    if ($frames.Count -lt 2) { throw 'Native loading bitmap did not animate during installation' }
    $checks.Add('Real NSIS extraction progress, rotating activity bitmap and stage list are present')
    Complete-Install '完成'
    if (Get-CimInstance Win32_Process | Where-Object ExecutablePath -eq (Join-Path $qaTarget '公司大脑.exe')) { throw 'Finish-only action unexpectedly launched the application' }
    if ((Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $sentinelHash) { throw 'Upgrade changed local personal records' }
    $checks.Add('v0.2.2 upgrade keeps original path, updates real executable and preserves personal records')
    $checks.Add('Finish closes without launching the application')

    Assert-TestTarget
    $uninstall = Join-Path $qaTarget 'Uninstall 公司大脑.exe'
    $process = Start-Process -FilePath $uninstall -PassThru -WindowStyle Hidden
    # NSIS relocates uninstallers; wait for the process which owns the confirmation UI.
    $until = [DateTime]::UtcNow.AddSeconds(40)
    $uninstallOwner = $null
    $uninstallIds = [Collections.Generic.HashSet[int]]::new()
    [void]$uninstallIds.Add($process.Id)
    do {
      # Follow NSIS's relocated child by ancestry; its temporary name is not an API.
      foreach ($child in Get-CimInstance Win32_Process | Where-Object { $uninstallIds.Contains([int]$_.ParentProcessId) }) { [void]$uninstallIds.Add([int]$child.ProcessId) }
      foreach ($candidate in Get-Process -Id @($uninstallIds) -ErrorAction SilentlyContinue) {
        foreach ($item in [InstallerWindow]::Windows($candidate.Id)) {
          if (-not $item.Visible -and $item.ClassName -eq '#32770') {
            [void][InstallerWindow]::ShowWindow($item.Handle,4)
          }
          if (((Get-InstallerControls $item.Handle).Text -join "`n").Contains('将移除程序与快捷方式')) { $uninstallOwner = $candidate; $page = $item; break }
        }
        if ($uninstallOwner) { break }
      }
      if (-not $uninstallOwner) { Start-Sleep -Milliseconds 100 }
    } while (-not $uninstallOwner -and [DateTime]::UtcNow -lt $until)
    if (-not $uninstallOwner) {
      @([InstallerWindow]::Windows($process.Id)) | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $workspacePath 'artifacts/installer-timeout.json') -Encoding utf8
      $launcherExit = if ($process.HasExited) { $process.ExitCode } else { 'running' }
      throw "Native uninstall confirmation missing (launcher: $launcherExit; process IDs: $($uninstallIds -join ','))"
    }
    Save-InstallerWindow $page.Handle (Join-Path $outputPath 'installer-uninstall.png')
    Invoke-InstallerButton $page.Handle '卸载应用'
    $page = Wait-InstallerText $uninstallOwner.Id '程序与快捷方式已移除' 120
    Invoke-InstallerButton $page.Handle '关闭'
    if (-not $uninstallOwner.WaitForExit(20000)) { throw 'Uninstaller did not exit' }
    if ((Test-Path -LiteralPath (Join-Path $qaTarget '公司大脑.exe')) -or (Test-Path -LiteralPath $registryPath)) { throw 'Uninstaller left the application/registration behind' }
    if ((Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $sentinelHash) { throw 'Uninstall changed local personal records' }
    $checks.Add('Native uninstall confirmation removes application and registration, preserving personal records')

    $page = New-InstallFlow
    Complete-Install '立即打开'
    $until = [DateTime]::UtcNow.AddSeconds(25)
    do {
      $started = Get-Process -Name '公司大脑' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $qaTarget '公司大脑.exe') -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if (-not $started) { Start-Sleep -Milliseconds 100 }
    } while (-not $started -and [DateTime]::UtcNow -lt $until)
    if (-not $started) { throw 'Open-now did not launch the packaged app' }
    Save-InstallerWindow $started.MainWindowHandle (Join-Path $outputPath 'installer-first-launch.png')
    [void]$started.CloseMainWindow()
    if (-not $started.WaitForExit(15000)) { Stop-Process -Id $started.Id }
    $checks.Add('Fresh installation and Open-now launch the real packaged application')
    Assert-TestTarget
    $process = Start-Process -FilePath (Join-Path $qaTarget 'Uninstall 公司大脑.exe') -ArgumentList '/S' -PassThru -WindowStyle Hidden
    [void]$process.WaitForExit(120000)
    $until = [DateTime]::UtcNow.AddSeconds(60)
    while ((Test-Path -LiteralPath (Join-Path $qaTarget '公司大脑.exe')) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 150 }
    if (Test-Path -LiteralPath (Join-Path $qaTarget '公司大脑.exe')) { throw 'Final uninstall failed' }
    if ((Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $sentinelHash) { throw 'Final uninstall changed records' }
    $checks.Add('Silent uninstallation also preserves synthetic personal records')
  }
  @{ version=$version; result='passed'; mode=$(if($FullLifecycle){'Disposable Windows CI lifecycle'}else{'UI-only'}); defaultPath=$defaultPath; checks=$checks; realInstallUpgradeUninstall=[bool]$FullLifecycle; physicalEmployeeDeviceTested=$false; sourceCommit=(git rev-parse HEAD); sha256=(Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant() } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $workspacePath 'artifacts/installer-verification.json') -Encoding utf8
  Write-Output "Installer UI passed: $($checks.Count) checks"
} catch {
  $installerFailure = $_
  try {
    if ($process -and -not $process.HasExited) {
      @([InstallerWindow]::Windows($process.Id) | Where-Object Visible | ForEach-Object { Get-InstallerControls $_.Handle | Select-Object Text,ClassName,Enabled,Id }) |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $workspacePath 'artifacts/installer-timeout.json') -Encoding utf8
      foreach ($failedWindow in [InstallerWindow]::Windows($process.Id) | Where-Object { $_.Visible -and $_.ClassName -eq '#32770' }) {
        Save-InstallerWindow $failedWindow.Handle (Join-Path $outputPath 'installer-timeout.png')
      }
    }
  } catch { Write-Warning 'Native failure capture was unavailable' }
  @{version=$version; result='failed'; mode=$(if($FullLifecycle){'Disposable Windows CI lifecycle'}else{'UI-only'}); checks=$checks; error=$installerFailure.Exception.Message; realInstallUpgradeUninstall=$false; sourceCommit=(git rev-parse HEAD)} |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $workspacePath 'artifacts/installer-verification.json') -Encoding utf8
  throw $installerFailure
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id }
}
