; Corporate Brain native NSIS wizard. Original code: MIT.
!include LogicLib.nsh
!include nsDialogs.nsh
!include FileFunc.nsh
!include WinMessages.nsh
!include Sections.nsh

!define MUI_BGCOLOR "FBFAF8"
!define MUI_TEXTCOLOR "272925"
!define MUI_CUSTOMFUNCTION_GUIINIT BrainGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.BrainGuiInit
!define MUI_CUSTOMFUNCTION_ABORT BrainUserAbort
!addplugindir /x86-unicode "${BUILD_RESOURCES_DIR}\windows\generated"
!define MUI_INSTFILESPAGE_COLORS "272925 FBFAF8"
WindowIcon on
; Advance the completed InstFiles page to our explicit finish page.
AutoCloseWindow true
ShowInstDetails nevershow
ShowUninstDetails nevershow
SetFont "Microsoft YaHei UI" 9

Var BrainDialog
Var BrainNativePage
Var BrainFont
Var BrainFontName
Var BrainTitleFont
Var BrainBrandFont
Var BrainNext
Var BrainCancel
Var BrainBack
Var BrainStatus
Var BrainPercent
Var BrainBar
Var BrainFile
Var BrainRow1
Var BrainRow2
Var BrainRow3
Var BrainRow4
Var BrainRow5
Var BrainSpinner
Var BrainLogoBitmap
Var BrainLogoControl
Var BrainWelcomeIcon
Var BrainPath
Var BrainCapacity
Var BrainShortcut
Var BrainShortcutValue
Var BrainOldPath
Var BrainOldVersion
Var BrainRequiredMB
Var BrainFreeMB
Var BrainTempRequiredMB
Var BrainTempFreeMB
Var BrainCritical
Var BrainDone
Var BrainStage
Var BrainDpi
Var BrainTitle
Var BrainSubTitle
Var BrainNav1
Var BrainNav2
Var BrainNav3
Var BrainNav4
Var BrainPageStep
Var BrainCreatedLabel
Var BrainNativeControls

!macro BrainInvalid TEXT
  MessageBox MB_OK|MB_ICONEXCLAMATION "${TEXT}" /SD IDOK
  SetErrorLevel 2
  ${If} ${Silent}
    Quit
  ${EndIf}
  Abort
!macroend

!macro customInit
  Call BrainInit
!macroend
!macro BrainRejectDataDeletion
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--delete-app-data" $1
  ${IfNot} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "此卸载程序保留个人数据，不支持清除对话。请先在客户端导出备份。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ClearErrors
!macroend
!macro customUnInit
  ; Refuse data-wiping flags: this uninstaller only removes the application.
  !insertmacro BrainRejectDataDeletion
  ${IfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $BrainShortcutValue ${BST_CHECKED}
!macroend
!macro customCheckAppRunning
  ${Do}
    nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
    Pop $0
    ${If} $0 != 0
      ${ExitDo}
    ${EndIf}
    ${If} ${Silent}
      SetErrorLevel 2
      Quit
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "请先关闭公司大脑$\r$\n$\r$\n请保存工作并关闭客户端，再点击“重试”继续。安装程序不会强制结束你的工作。" /SD IDCANCEL IDRETRY +3
    SetErrorLevel 1
    Quit
  ${Loop}
!macroend
