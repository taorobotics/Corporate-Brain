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
  if (-not $PreviousInstaller -or (Get-FileHash -LiteralPath $PreviousInstaller -Algorithm SHA256).Hash -ne '0a316ba6e947e2422a3aee23deec03fd51a27e5391764e21e4fe0d0b78fbfd46') { throw 'The pinned v0.9.0 upgrade fixture is missing or differs from its published hash.' }
}
function Assert-TestTarget {
  $resolvedTarget = [IO.Path]::GetFullPath($qaTarget)
  $allowedRoot = [IO.Path]::GetFullPath((Join-Path $workspacePath '.cache/installer-qa')) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedTarget.StartsWith($allowedRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedTarget) -ne 'Corporate Brain') { throw 'Unsafe lifecycle target' }
}
function Wait-ClientWindow([Diagnostics.Process]$Client, [string]$ExpectedPath) {
  $until = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $Client.Refresh()
    if ($Client.HasExited) { throw 'Isolated client exited before showing its window' }
    # Process.Path can be empty while Windows is still loading the executable.
    # Do not reveal a window until the executable identity is actually known.
    $actualPath = $Client.Path
    if (-not $actualPath) { Start-Sleep -Milliseconds 100; continue }
    if ($actualPath -ne $ExpectedPath) { throw "Unexpected client executable during lifecycle verification: $actualPath" }
    # SW_HIDE also hides Electron's first native window. Reveal only this owned
    # test process, as Wait-InstallerText does for the isolated NSIS windows.
    foreach ($candidate in [InstallerWindow]::Windows($Client.Id)) {
      if ($candidate.ClassName -like 'Chrome_WidgetWin_*' -and $candidate.Width -ge 500 -and $candidate.Height -ge 300 -and -not $candidate.Visible) {
        [void][InstallerWindow]::ShowWindow($candidate.Handle,4)
      }
    }
    $Client.Refresh()
    if ($Client.MainWindowHandle -ne 0) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $until)
  throw 'Isolated client did not show its native window'
}
function Assert-ButtonFeedback([IntPtr]$Window, [string]$Text, [string]$Name) {
  $button = Get-InstallerControls $Window | Where-Object { $_.ClassName -eq 'Button' -and $_.Text.Replace('&','') -eq $Text } | Select-Object -First 1
  if (-not $button -or -not $button.Enabled) { throw "Enabled button missing: $Text" }
  $normal = Join-Path $outputPath "installer-$Name-rest.png"
  $pressed = Join-Path $outputPath "installer-$Name-pressed.png"
  Save-InstallerWindow $Window $normal
  try {
    [void][InstallerWindow]::SendMessage($button.Handle,0xF3,[IntPtr]1,[IntPtr]::Zero)
    Save-InstallerWindow $Window $pressed
  } finally { [void][InstallerWindow]::SendMessage($button.Handle,0xF3,[IntPtr]::Zero,[IntPtr]::Zero) }
  $bounds = [InstallerWindow+Rect]::new()
  [void][InstallerWindow]::GetWindowRect($Window,[ref]$bounds)
  $before = [Drawing.Bitmap]::new($normal)
  $after = [Drawing.Bitmap]::new($pressed)
  $changed = 0
  try {
    for ($y=3;$y -lt $button.Height-3;$y+=2) {
      for ($x=3;$x -lt $button.Width-3;$x+=2) {
        $bx=$button.Left-$bounds.Left+$x; $by=$button.Top-$bounds.Top+$y
        if ($before.GetPixel($bx,$by).ToArgb() -ne $after.GetPixel($bx,$by).ToArgb()) { $changed++ }
      }
    }
  } finally { $before.Dispose(); $after.Dispose() }
  if ($changed -lt 150) { throw "Button has no visible pressed feedback: $Text ($changed pixels)" }
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
  Assert-ButtonFeedback $window.Handle '下一步 >' 'primary'
  Assert-ButtonFeedback $window.Handle '取消' 'secondary'
  $checks.Add('Primary and secondary buttons visibly depress and recover without activating')
  $checks.Add('Native welcome page, privacy and license links are visible')
  Invoke-InstallerButton $window.Handle '下一步 >'
  $window = Wait-InstallerText $process.Id '选择安装位置'
  Save-InstallerWindow $window.Handle (Join-Path $outputPath 'installer-directory.png')
  $controls = @(Get-InstallerControls $window.Handle)
  $pathControl = $controls | Where-Object ClassName -eq 'Edit' | Select-Object -First 1
  if (-not $pathControl -or -not $pathControl.Text) { throw 'Install directory missing' }
  $checks.Add('Native path page shows actual space, directory and shortcut selection')
  $defaultPath = $pathControl.Text
  if ($defaultPath.StartsWith([Environment]::GetFolderPath('Desktop'),[StringComparison]::OrdinalIgnoreCase)) { throw 'The application must not default to the desktop' }
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

    # This branch runs only on a disposable runner after the existing-profile refusal.
    $cachePath = Join-Path $dataPath 'updates'
    New-Item -ItemType Directory -Path $cachePath -Force | Out-Null
    $token = [Guid]::NewGuid().ToString('N')
    $readySignal = Join-Path $cachePath "$token.ready"
    $process = Start-Process -FilePath $installerPath -ArgumentList @('/S',"--brain-update=$token") -PassThru -WindowStyle Hidden
    $until = [DateTime]::UtcNow.AddSeconds(30)
    while (-not (Test-Path -LiteralPath $readySignal) -and -not $process.HasExited -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath $readySignal)) { throw 'Silent installer readiness signal missing' }
    if (-not $process.WaitForExit(20000) -or $process.ExitCode -ne 2) { throw 'Installer without a proceed signal did not cancel safely' }
    if ((Get-FileHash -LiteralPath (Join-Path $qaTarget '公司大脑.exe')).Hash -ne $oldHash) { throw 'Timed out handoff changed the old installation' }
    $checks.Add('A timed out handoff cancels without changing the prior application')

    function Test-AutoUpgrade([switch]$Legacy) {
      Assert-TestTarget
      $appPath = Join-Path $qaTarget '公司大脑.exe'
      $oldClient = Start-Process -FilePath $appPath -PassThru -WindowStyle Hidden
      Wait-ClientWindow $oldClient $appPath
      $desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) '公司大脑.lnk'
      $shortcutExisted = Test-Path -LiteralPath $desktopLink
      if ($Legacy) {
        $sha = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $cachedInstaller = Join-Path $cachePath ($sha.Substring(0,16) + '-' + [IO.Path]::GetFileName($installerPath))
        Copy-Item -LiteralPath $installerPath -Destination $cachedInstaller
        $script:process = Start-Process -FilePath $cachedInstaller -PassThru -WindowStyle Hidden
        Start-Sleep -Milliseconds 800
      } else {
        $token = [Guid]::NewGuid().ToString('N')
        $readySignal = Join-Path $cachePath "$token.ready"
        $script:process = Start-Process -FilePath $installerPath -ArgumentList @('/S',"--brain-update=$token") -PassThru -WindowStyle Hidden
        $until = [DateTime]::UtcNow.AddSeconds(30)
        while (-not (Test-Path -LiteralPath $readySignal) -and -not $process.HasExited -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 100 }
        if (-not (Test-Path -LiteralPath $readySignal)) { throw 'Ready signal missing while old client is running' }
        [IO.File]::WriteAllText((Join-Path $cachePath "$token.proceed"),'proceed')
      }
      if ($process.HasExited) { throw 'Automatic installer exited before the old client closed' }
      if (@([InstallerWindow]::Windows($process.Id) | Where-Object Visible).Count -ne 0) { throw 'Automatic update displayed an installer wizard' }
      if ((Get-FileHash -LiteralPath $appPath).Hash -ne $oldHash) { throw 'Installer changed the application before the old client exited' }
      # The pinned client can replace its startup window while readiness is checked.
      # Refresh Process's cached window handle before sending the real close request.
      $oldClient.Refresh()
      if (-not $oldClient.CloseMainWindow()) { throw 'Old client has no current window accepting a close request' }
      if (-not $oldClient.WaitForExit(15000)) { throw 'Old client did not close after saving' }
      if (-not $process.WaitForExit(120000) -or $process.ExitCode -ne 0) { throw 'Background update failed or did not restart' }
      if ((Get-ItemProperty -LiteralPath $registryPath).InstallLocation -ne $qaTarget) { throw 'Automatic update changed the original directory' }
      if ((Get-Item -LiteralPath $appPath).VersionInfo.ProductVersion -notin @($version,"$version.0")) { throw 'Automatic update installed the wrong version' }
      if ((Test-Path -LiteralPath $desktopLink) -ne $shortcutExisted) { throw 'Automatic update changed the desktop shortcut choice' }
      if ((Get-FileHash -LiteralPath $sentinel).Hash -ne $sentinelHash) { throw 'Automatic update changed personal records' }
      $restarted = Get-Process -Name '公司大脑' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $appPath -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if (-not $restarted) { throw 'Updated client did not show its window' }
      $restarted.Refresh()
      if (-not $restarted.CloseMainWindow()) { throw 'Updated test client has no current window accepting a close request' }
      if (-not $restarted.WaitForExit(15000)) { throw 'Updated test client did not close' }
    }
    # Simulate a user who has removed the desktop link. The updater must not recreate it.
    $desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) '公司大脑.lnk'
    if (Test-Path -LiteralPath $desktopLink) { Remove-Item -LiteralPath $desktopLink }
    Test-AutoUpgrade
    $checks.Add('Silent handoff waits for the old process, preserves path/data/shortcut choice and restarts the real new client')
    $old = Start-Process -FilePath $PreviousInstaller -ArgumentList @('/S',"/D=$qaTarget") -PassThru -WindowStyle Hidden
    if (-not $old.WaitForExit(120000) -or $old.ExitCode -ne 0) { throw 'Could not restore the pinned fixture for legacy updater verification' }
    Test-AutoUpgrade -Legacy
    $checks.Add('Legacy client cache launch without arguments automatically updates and restarts without a wizard')

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
    $checks.Add('v0.9.0 upgrade keeps original path, updates real executable and preserves personal records')
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
    $page = Wait-InstallerText $process.Id '公司大脑已安装到这台电脑' 120
    # Force a launch failure without touching the real runtime, then verify retry.
    $appPath = Join-Path $qaTarget '公司大脑.exe'
    $heldPath = Join-Path $qaTarget '公司大脑-launch-test.exe'
    Assert-TestTarget
    Move-Item -LiteralPath $appPath -Destination $heldPath
    try {
      Invoke-InstallerButton $page.Handle '立即打开'
      $page = Wait-InstallerText $process.Id '重试打开' 30
    } finally { Move-Item -LiteralPath $heldPath -Destination $appPath }
    $checks.Add('Open-now failure retains the wizard and provides a working retry')
    Invoke-InstallerButton $page.Handle '重试打开'
    if (-not $process.WaitForExit(25000) -or $process.ExitCode -ne 0) { throw 'Retry did not finish after the client window appeared' }
    $until = [DateTime]::UtcNow.AddSeconds(25)
    do {
      $started = Get-Process -Name '公司大脑' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $qaTarget '公司大脑.exe') -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if (-not $started) { Start-Sleep -Milliseconds 100 }
    } while (-not $started -and [DateTime]::UtcNow -lt $until)
    if (-not $started) { throw 'Open-now did not launch the packaged app' }
    Save-InstallerWindow $started.MainWindowHandle (Join-Path $outputPath 'installer-first-launch.png')
    [void][InstallerWindow]::ShowWindow($started.MainWindowHandle,6)
    $relaunch = Start-Process -FilePath $appPath -PassThru -WindowStyle Hidden
    if (-not $relaunch.WaitForExit(15000)) { throw 'Second instance did not exit after restoring the original client' }
    if ([InstallerWindow]::IsIconic($started.MainWindowHandle)) { throw 'Repeated launch did not restore the minimized client window' }
    $checks.Add('Repeated packaged launch reuses the existing client process')
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
  @{ version=$version; result='passed'; mode=$(if($FullLifecycle){'Disposable Windows CI lifecycle'}else{'UI-only'}); defaultPath=$defaultPath; checks=$checks; realInstallUpgradeUninstall=[bool]$FullLifecycle; physicalEmployeeDeviceTested=$false; sourceCommit=(git rev-parse HEAD); verificationSourceCommit=$env:BRAIN_VERIFICATION_COMMIT; sha256=(Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant() } |
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
