; Corporate Brain MIT. Uses the MIT-licensed electron-builder NSIS lifecycle primitives.
Var newStartMenuLink
Var oldStartMenuLink
Var newDesktopLink
Var oldDesktopLink
Var oldShortcutName
Var oldMenuDirectory
Var appExe
Var launchLink
!include common.nsh
!include MUI2.nsh
!include multiUser.nsh
!include allowOnlyOneInstallerInstance.nsh
RequestExecutionLevel user
!include "${BUILD_RESOURCES_DIR}\windows\pages.nsh"
!insertmacro addLangs

Function .onInit
  Call setInstallSectionSpaceRequired
  SetOutPath $TEMP
  !insertmacro check64BitAndSetRegView
  !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
  !insertmacro initMultiUser
  !insertmacro customInit
FunctionEnd

!include installUtil.nsh
Section "install" INSTALL_SECTION_ID
  ; Existing per-machine installs retain their mode, and require explicit UAC elevation.
  ${If} $installMode == "all"
  ${AndIfNot} ${UAC_IsAdmin}
    MessageBox MB_OK|MB_ICONEXCLAMATION "原安装属于所有用户，请由管理员运行安装程序。个人记录会保留。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  !include "${BUILD_RESOURCES_DIR}\windows\install.nsh"
SectionEnd
Function setInstallSectionSpaceRequired
  !insertmacro setSpaceRequired ${INSTALL_SECTION_ID}
FunctionEnd
!include uninstaller.nsh
