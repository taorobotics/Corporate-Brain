; Uses electron-builder's MIT-licensed installation primitives; UI and staging are project-owned.
!include "${BUILD_RESOURCES_DIR}\windows\generated\installer-primitives.nsh"
InitPluginsDir
Call BrainValidateTarget
StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!insertmacro setLinkVars
!insertmacro customCheckAppRunning

; Prepare the complete package BEFORE uninstalling an old version. Cancellation here is safe.
StrCpy $BrainStage 2
Call BrainUpdateStage
BrainWizard::Prepare /NOUNLOAD $BrainStatus
BrainWizard::Refresh /NOUNLOAD
; NSIS disables Cancel when the install section starts; staging is safe to cancel.
EnableWindow $BrainCancel 1
SetOutPath "$PLUGINSDIR\prepared-app"
!insertmacro installApplicationFiles
${IfNot} ${FileExists} "$PLUGINSDIR\prepared-app\${APP_EXECUTABLE_FILENAME}"
${OrIfNot} ${FileExists} "$PLUGINSDIR\prepared-app\resources\app.asar"
  MessageBox MB_OK|MB_ICONSTOP "安装文件准备失败。原安装尚未更改，请检查临时磁盘空间后重试。" /SD IDOK
  SetErrorLevel 2
  Quit
${EndIf}
!ifdef UNINSTALLER_ICON
  File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
!endif
; Keep the brief commit phase non-cancellable. Never strand a half-upgrade on user cancellation.
StrCpy $BrainCritical 1
; Native atomics coordinate the UI and worker without concurrent NSIS callbacks.
BrainWizard::Commit /NOUNLOAD
Pop $0
${If} $0 != 1
  SetErrorLevel 1
  Quit
${EndIf}
StrCpy $BrainStage 3
Call BrainUpdateStage
BrainWizard::Refresh /NOUNLOAD
Var /GLOBAL keepShortcuts
StrCpy $keepShortcuts "false"
!insertmacro setIsTryToKeepShortcuts
${If} $isTryToKeepShortcuts == "true"
  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts
  ${If} $0 == "true"
  ${AndIf} ${FileExists} "$appExe"
    StrCpy $keepShortcuts "true"
  ${EndIf}
${EndIf}
!insertmacro uninstallOldVersion SHELL_CONTEXT
!insertmacro handleUninstallResult SHELL_CONTEXT
${If} $installMode == "all"
  !insertmacro uninstallOldVersion HKEY_CURRENT_USER
  !insertmacro handleUninstallResult HKEY_CURRENT_USER
${EndIf}
SetOutPath "$INSTDIR"
${Do}
  ClearErrors
  CopyFiles /SILENT "$PLUGINSDIR\prepared-app\*" "$INSTDIR"
  ${IfNot} ${Errors}
    ${ExitDo}
  ${EndIf}
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "安装未完成$\r$\n部分应用文件未能写入。请检查磁盘空间与文件占用后重试。个人对话与草稿不会被清除。" /SD IDCANCEL IDRETRY +3
  SetErrorLevel 2
  Quit
${Loop}

StrCpy $BrainStage 4
Call BrainUpdateStage
BrainWizard::Refresh /NOUNLOAD
!insertmacro registryAddInstallInfo
!insertmacro addStartMenuLink $keepShortcuts
${If} $BrainShortcutValue == ${BST_CHECKED}
  !insertmacro addDesktopLink $keepShortcuts
${EndIf}
${If} ${FileExists} "$newStartMenuLink"
  StrCpy $launchLink "$newStartMenuLink"
${Else}
  StrCpy $launchLink "$appExe"
${EndIf}
StrCpy $BrainStage 5
Call BrainUpdateStage
BrainWizard::Refresh /NOUNLOAD
${IfNot} ${FileExists} "$appExe"
${OrIfNot} ${FileExists} "$INSTDIR\resources\app.asar"
  MessageBox MB_OK|MB_ICONSTOP "安装检查失败，请重新运行安装程序。个人对话和草稿保留在本机。" /SD IDOK
  SetErrorLevel 2
  Quit
${EndIf}
!ifmacrodef registerFileAssociations
  !insertmacro registerFileAssociations
!endif
StrCpy $BrainDone 1
StrCpy $BrainCritical 0
BrainWizard::Complete /NOUNLOAD
EnableWindow $BrainCancel 1
