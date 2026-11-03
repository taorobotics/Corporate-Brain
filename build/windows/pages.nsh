; Native, keyboard-accessible controls. The actual NSIS progress control is retained.
!include UAC.nsh
!include "${BUILD_RESOURCES_DIR}\windows\generated\init-mode.nsh"

!macro BMove HANDLE X Y W H
  Push $0
  Push $1
  Push $2
  Push $3
  Push $R9
  StrCpy $R9 ${HANDLE}
  System::Call 'kernel32::MulDiv(i ${X}, i $BrainDpi, i 96)i.r0'
  System::Call 'kernel32::MulDiv(i ${Y}, i $BrainDpi, i 96)i.r1'
  System::Call 'kernel32::MulDiv(i ${W}, i $BrainDpi, i 96)i.r2'
  System::Call 'kernel32::MulDiv(i ${H}, i $BrainDpi, i 96)i.r3'
  System::Call 'user32::MoveWindow(p $R9, i r0, i r1, i r2, i r3, i 1)'
  Pop $R9
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
!macro BLabel X Y W H TEXT VAR FONT COLOR BACK
  Push $0
  Push $1
  Push $2
  Push $3
  System::Call 'kernel32::MulDiv(i ${X}, i $BrainDpi, i 96)i.r0'
  System::Call 'kernel32::MulDiv(i ${Y}, i $BrainDpi, i 96)i.r1'
  System::Call 'kernel32::MulDiv(i ${W}, i $BrainDpi, i 96)i.r2'
  System::Call 'kernel32::MulDiv(i ${H}, i $BrainDpi, i 96)i.r3'
  ${If} $BrainNativeControls == 1
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "${TEXT}", i 0x50000100, i r0, i r1, i r2, i r3, p $BrainDialog, p 0, p 0, p 0)p.s'
  ${Else}
    ${NSD_CreateLabel} $0 $1 $2 $3 "${TEXT}"
  ${EndIf}
  Pop $BrainCreatedLabel
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  StrCpy ${VAR} $BrainCreatedLabel
  ${NSD_AddStyle} $BrainCreatedLabel ${WS_CLIPSIBLINGS}
  SendMessage ${VAR} ${WM_SETFONT} ${FONT} 1
  SetCtlColors ${VAR} ${COLOR} ${BACK}
!macroend

!macro BLabelCenter X Y W H TEXT VAR FONT COLOR BACK
  Push $0
  Push $1
  Push $2
  Push $3
  System::Call 'kernel32::MulDiv(i ${X}, i $BrainDpi, i 96)i.r0'
  System::Call 'kernel32::MulDiv(i ${Y}, i $BrainDpi, i 96)i.r1'
  System::Call 'kernel32::MulDiv(i ${W}, i $BrainDpi, i 96)i.r2'
  System::Call 'kernel32::MulDiv(i ${H}, i $BrainDpi, i 96)i.r3'
  ${If} $BrainNativeControls == 1
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "${TEXT}", i 0x50000001, i r0, i r1, i r2, i r3, p $BrainDialog, p 0, p 0, p 0)p.s'
  ${Else}
    ${NSD_CreateLabel} $0 $1 $2 $3 "${TEXT}"
  ${EndIf}
  Pop $BrainCreatedLabel
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  StrCpy ${VAR} $BrainCreatedLabel
  ${NSD_AddStyle} $BrainCreatedLabel ${WS_CLIPSIBLINGS}
  ${NSD_AddStyle} $BrainCreatedLabel 0x00000001
  SendMessage ${VAR} ${WM_SETFONT} ${FONT} 1
  SetCtlColors ${VAR} ${COLOR} ${BACK}
!macroend

!macro BrainUiFunctions PREFIX UNINSTALL
Function ${PREFIX}BrainGuiInit
  ; The uninstaller has its own runtime flag; the compiler's AutoCloseWindow
  ; setting alone only advanced the installer in our lifecycle test.
  SetAutoClose true
  StrCpy $BrainDpi 96
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT)i.r0'
  ${If} $0 > 0
    StrCpy $BrainDpi $0
  ${EndIf}
  ; HarmonyOS Sans SC matches the product's compact Chinese typography.
  ; Clean Windows machines use Microsoft YaHei UI without changing layout.
  StrCpy $BrainFontName "Microsoft YaHei UI"
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts" "HarmonyOS Sans SC (TrueType)"
  ${If} $0 != ""
    StrCpy $BrainFontName "HarmonyOS Sans SC"
  ${EndIf}
  CreateFont $BrainFont $BrainFontName 10
  CreateFont $BrainTitleFont $BrainFontName 18 700
  CreateFont $BrainBrandFont $BrainFontName 15 700
  SendMessage $HWNDPARENT ${WM_SETFONT} $BrainFont 1
  GetDlgItem $BrainNext $HWNDPARENT 1
  GetDlgItem $BrainCancel $HWNDPARENT 2
  GetDlgItem $BrainBack $HWNDPARENT 3
  !insertmacro BMove $HWNDPARENT 0 0 920 660
  BrainWizard::Center /NOUNLOAD $HWNDPARENT
  ; Hide the default MUI header/branding; the page owns these surfaces.
  GetDlgItem $0 $HWNDPARENT 1037
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1038
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1028
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1035
  ShowWindow $0 ${SW_HIDE}
  SetCtlColors $HWNDPARENT 272925 F1F0EC
  !insertmacro BMove $BrainBack 535 570 108 36
  !insertmacro BMove $BrainCancel 655 570 108 36
  !insertmacro BMove $BrainNext 775 570 108 36
  SendMessage $BrainNext ${WM_SETFONT} $BrainFont 1
  SendMessage $BrainCancel ${WM_SETFONT} $BrainFont 1
  SendMessage $BrainBack ${WM_SETFONT} $BrainFont 1
  BrainWizard::Style /NOUNLOAD
  InitPluginsDir
  File /oname=$PLUGINSDIR\brain-license.txt "${BUILD_RESOURCES_DIR}\..\LICENSE"
  File /oname=$PLUGINSDIR\brain-privacy.txt "${BUILD_RESOURCES_DIR}\..\docs\PRIVACY.md"
  !include "${BUILD_RESOURCES_DIR}\windows\generated\spinner-files.nsh"
FunctionEnd

!if ${UNINSTALL} == 1
Function un.onGUIEnd
!else
Function .onGUIEnd
!endif
  BrainWizard::Release /NOUNLOAD
FunctionEnd

Function ${PREFIX}BrainPage
  StrCpy $BrainNativeControls 0
  BrainWizard::Style /NOUNLOAD
  nsDialogs::Create 1018
  Pop $BrainDialog
  ${If} $BrainDialog == error
    Abort
  ${EndIf}
  !insertmacro BMove $BrainDialog 0 0 904 550
  SetCtlColors $BrainDialog 272925 FBFAF8
  ; Paint the sidebar on the page itself, without a broad Static overlapping controls.
  BrainWizard::Panel /NOUNLOAD $BrainDialog
  ${NSD_CreateIcon} 28 25 64 64 ""
  Pop $BrainLogoControl
  !insertmacro BMove $BrainLogoControl 28 25 64 64
  ${NSD_SetIconFromInstaller} $BrainLogoControl $BrainLogoBitmap
  !insertmacro BLabel 30 100 150 36 "公司大脑" $0 $BrainBrandFont 272925 F1F0EC
  !insertmacro BLabel 32 145 145 60 "让知识和技能$\r$\n成为工作的助力" $0 $BrainFont 81827C F1F0EC
  !insertmacro BLabel 30 237 155 32 "1   欢迎使用" $BrainNav1 $BrainFont 81827C F1F0EC
  !insertmacro BLabel 30 282 155 32 "2   安装位置" $BrainNav2 $BrainFont 81827C F1F0EC
  !insertmacro BLabel 30 327 155 32 "3   安装中" $BrainNav3 $BrainFont 81827C F1F0EC
  !insertmacro BLabel 30 372 155 32 "4   完成" $BrainNav4 $BrainFont 81827C F1F0EC
  ${If} $BrainPageStep > 1
    SendMessage $BrainNav1 ${WM_SETTEXT} 0 "STR:✓   欢迎使用"
  ${EndIf}
  ${If} $BrainPageStep > 2
    SendMessage $BrainNav2 ${WM_SETTEXT} 0 "STR:✓   安装位置"
  ${EndIf}
  ${If} $BrainPageStep > 3
    SendMessage $BrainNav3 ${WM_SETTEXT} 0 "STR:✓   安装中"
  ${EndIf}
  !if ${UNINSTALL} == 1
    SendMessage $BrainNav1 ${WM_SETTEXT} 0 "STR:1   确认卸载"
    SendMessage $BrainNav2 ${WM_SETTEXT} 0 "STR:2   卸载中"
    SendMessage $BrainNav3 ${WM_SETTEXT} 0 "STR:3   完成"
    ShowWindow $BrainNav4 ${SW_HIDE}
    ${If} $BrainPageStep > 1
      SendMessage $BrainNav1 ${WM_SETTEXT} 0 "STR:✓   确认卸载"
    ${EndIf}
    ${If} $BrainPageStep > 2
      SendMessage $BrainNav2 ${WM_SETTEXT} 0 "STR:✓   卸载中"
    ${EndIf}
  !endif
  !insertmacro BLabel 28 510 160 26 "v${VERSION} · Windows 64 位" $0 $BrainFont 81827C F1F0EC
  !insertmacro BLabel 220 30 650 46 "$BrainTitle" $0 $BrainTitleFont 272925 FBFAF8
  !insertmacro BLabel 222 84 640 40 "$BrainSubTitle" $0 $BrainFont 81827C FBFAF8
  ${NSD_CreateHLine} 0 0 1 1 ""
  Pop $0
  !insertmacro BMove $0 190 124 714 1
  ${NSD_CreateLink} 0 0 1 1 "MIT 许可"
  Pop $0
  !insertmacro BMove $0 449 517 92 25
  SendMessage $0 ${WM_SETFONT} $BrainFont 1
  SetCtlColors $0 B76C4E FBFAF8
  ${NSD_OnClick} $0 ${PREFIX}BrainLicense
  ${NSD_CreateLink} 0 0 1 1 "隐私说明"
  Pop $0
  !insertmacro BMove $0 553 517 92 25
  SendMessage $0 ${WM_SETFONT} $BrainFont 1
  SetCtlColors $0 B76C4E FBFAF8
  ${NSD_OnClick} $0 ${PREFIX}BrainPrivacy
  SendMessage $BrainCancel ${WM_SETTEXT} 0 "STR:取消"
FunctionEnd

Function ${PREFIX}BrainLicense
  Pop $0
  ExecShell "open" "$PLUGINSDIR\brain-license.txt"
FunctionEnd
Function ${PREFIX}BrainPrivacy
  Pop $0
  ExecShell "open" "$PLUGINSDIR\brain-privacy.txt"
FunctionEnd

; InstFiles is owned by NSIS. Decorate that page directly, without installing
; nsDialogs' custom-page navigation procedure over the native lifecycle.
Function ${PREFIX}BrainProgressPage
  BrainWizard::Style /NOUNLOAD
  StrCpy $BrainNativeControls 1
  StrCpy $BrainDialog $BrainNativePage
  BrainWizard::NativePage /NOUNLOAD $BrainDialog
  !insertmacro BMove $BrainDialog 0 0 904 550
  SetCtlColors $BrainDialog 272925 FBFAF8
  BrainWizard::Panel /NOUNLOAD $BrainDialog
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x50000003, i 28, i 25, i 32, i 32, p $BrainDialog, p 0, p 0, p 0)p.r0'
  !insertmacro BMove $0 28 25 32 32
  System::Call 'kernel32::GetModuleHandleW(p 0)p.r1'
  System::Call 'user32::LoadImageW(p r1, p 103, i 1, i 32, i 32, i 0x8000)p.r1'
  SendMessage $0 0x170 $1 0
  !insertmacro BLabel 30 100 150 36 "公司大脑" $0 $BrainBrandFont 272925 F1F0EC
  !insertmacro BLabel 32 145 145 60 "让知识和技能$\r$\n成为工作的助力" $0 $BrainFont 81827C F1F0EC
  !insertmacro BLabel 30 237 155 32 "✓   欢迎使用" $BrainNav1 $BrainFont 81827C F1F0EC
  !insertmacro BLabel 30 282 155 32 "✓   安装位置" $BrainNav2 $BrainFont 81827C F1F0EC
  !insertmacro BLabel 30 327 155 32 "3   安装中" $BrainNav3 $BrainFont B76C4E F1F0EC
  !insertmacro BLabel 30 372 155 32 "4   完成" $BrainNav4 $BrainFont 81827C F1F0EC
  !if ${UNINSTALL} == 1
    SendMessage $BrainNav1 ${WM_SETTEXT} 0 "STR:✓   确认卸载"
    SendMessage $BrainNav2 ${WM_SETTEXT} 0 "STR:2   卸载中"
    SendMessage $BrainNav3 ${WM_SETTEXT} 0 "STR:3   完成"
    ShowWindow $BrainNav4 ${SW_HIDE}
  !endif
  !insertmacro BLabel 28 510 160 26 "v${VERSION} · Windows 64 位" $0 $BrainFont 81827C F1F0EC
  !insertmacro BLabel 220 30 650 46 "$BrainTitle" $0 $BrainTitleFont 272925 FBFAF8
  !insertmacro BLabel 222 84 640 40 "$BrainSubTitle" $0 $BrainFont 81827C FBFAF8
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x50000010, i 0, i 0, i 1, i 1, p $BrainDialog, p 0, p 0, p 0)p.r0'
  !insertmacro BMove $0 190 124 714 1
  SendMessage $BrainCancel ${WM_SETTEXT} 0 "STR:取消"
FunctionEnd

Function ${PREFIX}BrainProgressShow
  FindWindow $BrainNativePage "#32770" "" $HWNDPARENT
  GetDlgItem $BrainBar $BrainNativePage 1004
  GetDlgItem $BrainFile $BrainNativePage 1006
  StrCpy $BrainTitle "正在安装公司大脑"
  StrCpy $BrainPageStep 3
  StrCpy $BrainSubTitle "请稍候，安装程序正在处理以下项目。"
  !if ${UNINSTALL} == 1
    StrCpy $BrainTitle "正在卸载公司大脑"
    StrCpy $BrainPageStep 2
    StrCpy $BrainSubTitle "正在移除程序与快捷方式，保留本机个人记录。"
  !endif
  Call ${PREFIX}BrainProgressPage
  SetCtlColors $BrainNav3 B76C4E F1F0EC
  !if ${UNINSTALL} == 1
    SetCtlColors $BrainNav3 81827C F1F0EC
    SetCtlColors $BrainNav2 B76C4E F1F0EC
  !endif
  !insertmacro BMove $BrainBar 222 151 586 22
  !insertmacro BMove $BrainFile 223 476 642 28
  ShowWindow $BrainBar ${SW_SHOW}
  ShowWindow $BrainFile ${SW_SHOW}
  System::Call 'uxtheme::SetWindowTheme(p $BrainBar, w "", w "")'
  SendMessage $BrainBar 0x409 0 0x004E6CB7
  !insertmacro BLabel 826 148 60 28 "0%" $BrainPercent $BrainFont 272925 FBFAF8
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5000000E, i 222, i 192, i 28, i 28, p $BrainDialog, p 0, p 0, p 0)p.s'
  Pop $BrainSpinner
  !insertmacro BMove $BrainSpinner 222 192 28 28
  !insertmacro BLabel 262 194 600 32 "正在准备安装…" $BrainStatus $BrainFont 272925 FBFAF8
  !insertmacro BLabel 234 252 630 30 "已完成  检查磁盘空间与写入权限" $BrainRow1 $BrainFont 52554F FBFAF8
  !insertmacro BLabel 234 292 630 30 "进行中  解压并准备应用文件" $BrainRow2 $BrainFont B76C4E FBFAF8
  !insertmacro BLabel 234 332 630 30 "等待    替换旧版并写入程序" $BrainRow3 $BrainFont 81827C FBFAF8
  !insertmacro BLabel 234 372 630 30 "等待    注册卸载入口与快捷方式" $BrainRow4 $BrainFont 81827C FBFAF8
  !insertmacro BLabel 234 412 630 30 "等待    完成安装检查" $BrainRow5 $BrainFont 81827C FBFAF8
  ShowWindow $BrainDialog ${SW_SHOW}
  BrainWizard::Progress /NOUNLOAD $BrainBar $BrainPercent $BrainSpinner "$PLUGINSDIR"
  !if ${UNINSTALL} == 1
    SendMessage $BrainStatus ${WM_SETTEXT} 0 "STR:正在移除应用文件…"
    SendMessage $BrainRow1 ${WM_SETTEXT} 0 "STR:个人对话、草稿与设置会保留。"
    ShowWindow $BrainRow2 ${SW_HIDE}
    ShowWindow $BrainRow3 ${SW_HIDE}
    ShowWindow $BrainRow4 ${SW_HIDE}
    ShowWindow $BrainRow5 ${SW_HIDE}
  !endif
FunctionEnd

Function ${PREFIX}BrainProgressLeave
  BrainWizard::Stop /NOUNLOAD
FunctionEnd
!macroend

!insertmacro BrainUiFunctions "" 0
!insertmacro BrainUiFunctions "un." 1

Function BrainInit
  !insertmacro BrainRejectDataDeletion
  StrCpy $BrainShortcutValue ${BST_CHECKED}
  StrCpy $BrainCritical 0
  StrCpy $BrainDone 0
  !ifdef APP_64_UNPACKED_SIZE
    IntOp $BrainRequiredMB ${APP_64_UNPACKED_SIZE} / 1024
    IntOp $BrainRequiredMB $BrainRequiredMB + 64
  !else
    StrCpy $BrainRequiredMB 1024
  !endif
  ReadRegStr $BrainOldPath SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $BrainOldVersion SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ${If} $BrainOldPath != ""
    StrCpy $INSTDIR $BrainOldPath
    Return
  ${EndIf}
  !insertmacro GetDParameter $0
  ${If} $0 != ""
    Return
  ${EndIf}
  System::Call 'kernel32::GetDriveTypeW(w "D:\")i.r0'
  ${If} $0 == 3
    ClearErrors
    CreateDirectory "D:\Applications"
    GetTempFileName $1 "D:\Applications"
    ${IfNot} ${Errors}
      Delete "$1"
      StrCpy $INSTDIR "D:\Applications\Corporate Brain"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function BrainWelcome
  StrCpy $BrainPageStep 1
  StrCpy $BrainTitle "欢迎使用公司大脑安装向导"
  StrCpy $BrainSubTitle "此向导将引导你完成公司大脑的安装。"
  ${If} $BrainOldPath != ""
    StrCpy $BrainTitle "升级公司大脑"
    StrCpy $BrainSubTitle "当前 $BrainOldVersion → 本次 ${VERSION}，沿用原安装位置。"
  ${EndIf}
  Call BrainPage
  SetCtlColors $BrainNav1 B76C4E F1F0EC
  ${NSD_CreateIcon} 515 190 64 64 ""
  Pop $0
  !insertmacro BMove $0 515 190 64 64
  ${NSD_SetIconFromInstaller} $0 $BrainWelcomeIcon
  !insertmacro BLabelCenter 270 280 560 48 "公司大脑" $0 $BrainTitleFont B76C4E FBFAF8
  !insertmacro BLabelCenter 270 340 560 70 "安装完成后，可连接你的公司工作空间。$\r$\n完整对话与个人草稿保存在你的电脑。" $0 $BrainFont 52554F FBFAF8
  SendMessage $BrainNext ${WM_SETTEXT} 0 "STR:下一步 >"
  BrainWizard::Style /NOUNLOAD
  nsDialogs::Show
FunctionEnd

Function BrainDirectory
  StrCpy $BrainPageStep 2
  StrCpy $BrainTitle "选择安装位置"
  StrCpy $BrainSubTitle "选择程序目录。个人数据单独保存，升级不会自动迁移。"
  Call BrainPage
  SetCtlColors $BrainNav2 B76C4E F1F0EC
  !insertmacro BLabel 222 159 620 30 "安装位置" $0 $BrainFont 272925 FBFAF8
  ${NSD_CreateDirRequest} 0 0 1 1 "$INSTDIR"
  Pop $BrainPath
  !insertmacro BMove $BrainPath 222 200 526 36
  SendMessage $BrainPath ${WM_SETFONT} $BrainFont 1
  ${NSD_CreateBrowseButton} 0 0 1 1 "浏览…"
  Pop $0
  !insertmacro BMove $0 760 200 110 36
  SendMessage $0 ${WM_SETFONT} $BrainFont 1
  ${NSD_OnClick} $0 BrainBrowse
  ${If} $BrainOldPath != ""
    EnableWindow $BrainPath 0
    EnableWindow $0 0
  ${EndIf}
  !insertmacro BLabel 222 255 650 36 "首次安装优先使用可写 D 盘；覆盖升级沿用原位置。" $0 $BrainFont 81827C FBFAF8
  !insertmacro BLabel 222 302 650 40 "" $BrainCapacity $BrainFont 52554F FBFAF8
  ${NSD_OnChange} $BrainPath BrainCapacityChange
  ${NSD_CreateCheckBox} 0 0 1 1 "创建桌面快捷方式"
  Pop $BrainShortcut
  !insertmacro BMove $BrainShortcut 222 365 630 32
  SendMessage $BrainShortcut ${WM_SETFONT} $BrainFont 1
  SetCtlColors $BrainShortcut 272925 FBFAF8
  ${NSD_SetState} $BrainShortcut $BrainShortcutValue
  !insertmacro BLabel 222 425 650 48 "安装前将检查目录权限、目标磁盘与临时目录空间。$\r$\n程序与个人记录分开保存。" $0 $BrainFont 81827C FBFAF8
  SendMessage $BrainNext ${WM_SETTEXT} 0 "STR:开始安装"
  Call BrainCapacity
  BrainWizard::Style /NOUNLOAD
  nsDialogs::Show
FunctionEnd
Function BrainBrowse
  Pop $0
  nsDialogs::SelectFolderDialog "选择程序安装目录" "$INSTDIR"
  Pop $0
  ${If} $0 != error
    ${GetFileName} "$0" $1
    ${If} $1 != "Corporate Brain"
    ${AndIf} $1 != "${APP_FILENAME}"
      StrCpy $0 "$0\Corporate Brain"
    ${EndIf}
    ${NSD_SetText} $BrainPath "$0"
  ${EndIf}
FunctionEnd
Function BrainCapacityChange
  Pop $0
  Call BrainCapacity
FunctionEnd
Function BrainCapacity
  Push $INSTDIR
  ${NSD_GetText} $BrainPath $INSTDIR
  Call BrainReadCapacity
  Pop $INSTDIR
  ${If} $BrainFreeMB >= 0
    ${NSD_SetText} $BrainCapacity "所需空间：$BrainRequiredMB MB    可用空间：$BrainFreeMB MB"
  ${Else}
    ${NSD_SetText} $BrainCapacity "所需空间：$BrainRequiredMB MB    请检查所选磁盘。"
  ${EndIf}
FunctionEnd
Function BrainReadCapacity
  ${GetRoot} "$INSTDIR" $1
  System::Call 'kernel32::GetDiskFreeSpaceExW(w "$1\", *l.r2, p 0, p 0)i.r3'
  ${If} $3 != 0
    System::Int64Op $2 / 1048576
    Pop $BrainFreeMB
  ${Else}
    StrCpy $BrainFreeMB -1
  ${EndIf}
FunctionEnd

Function BrainDirectoryLeave
  ${NSD_GetText} $BrainPath $INSTDIR
  ${NSD_GetState} $BrainShortcut $BrainShortcutValue
  Call BrainValidateTarget
FunctionEnd
Function BrainValidateTarget
  SetErrorLevel 0
  ${If} $BrainOldPath != ""
    StrCpy $INSTDIR $BrainOldPath
  ${Else}
    ${GetFileName} "$INSTDIR" $0
    ${If} $0 != "Corporate Brain"
    ${AndIf} $0 != "${APP_FILENAME}"
      StrCpy $INSTDIR "$INSTDIR\Corporate Brain"
      ${NSD_SetText} $BrainPath "$INSTDIR"
    ${EndIf}
  ${EndIf}
  ${GetRoot} "$INSTDIR" $0
  StrLen $1 $0
  ${If} $1 != 2
    !insertmacro BrainInvalid "请选择本机磁盘上的程序子目录，例如 D:\Applications\Corporate Brain。"
  ${EndIf}
  ${If} $BrainOldPath == ""
  ${AndIf} ${FileExists} "$INSTDIR\*.*"
    ; Do not install into an unrelated non-empty directory that an uninstaller could later remove.
    FindFirst $0 $1 "$INSTDIR\*.*"
    ${DoWhile} $1 != ""
      ${If} $1 != "."
      ${AndIf} $1 != ".."
        FindClose $0
        !insertmacro BrainInvalid "该目录已有文件，请选择一个空的公司大脑专用目录。"
      ${EndIf}
      FindNext $0 $1
    ${Loop}
    FindClose $0
  ${EndIf}
  Call BrainReadCapacity
  System::Int64Op $BrainFreeMB < $BrainRequiredMB
  Pop $0
  ${If} $0 != 0
    !insertmacro BrainInvalid "磁盘空间不足或磁盘不可用。所需 $BrainRequiredMB MB，请更换位置或释放空间后重试。"
  ${EndIf}
  ClearErrors
  CreateDirectory "$INSTDIR"
  GetTempFileName $0 "$INSTDIR"
  ${If} ${Errors}
    !insertmacro BrainInvalid "无法使用此安装位置：没有写入权限。请更改位置后重试。"
  ${EndIf}
  Delete "$0"
  ; Reserve the compressed archive, one staged copy and working headroom.
  ${GetRoot} "$TEMP" $0
  System::Call 'kernel32::GetDiskFreeSpaceExW(w "$0\", *l.r1, p 0, p 0)i.r2'
  ${If} $2 == 0
    !insertmacro BrainInvalid "系统临时目录不可用，请检查系统磁盘后重试。"
  ${EndIf}
  System::Int64Op $1 / 1048576
  Pop $BrainTempFreeMB
  IntOp $BrainTempRequiredMB $BrainRequiredMB * 2
  System::Int64Op $BrainTempFreeMB < $BrainTempRequiredMB
  Pop $0
  ${If} $0 != 0
    !insertmacro BrainInvalid "系统临时目录空间不足。当前可用约 $BrainTempFreeMB MB，需要约 $BrainTempRequiredMB MB。请释放系统磁盘空间后再运行安装。"
  ${EndIf}
FunctionEnd

Function BrainUpdateStage
  ${If} ${Silent}
    Return
  ${EndIf}
  ${If} $BrainStage == 2
    SendMessage $BrainStatus ${WM_SETTEXT} 0 "STR:正在解压并准备应用文件…"
  ${ElseIf} $BrainStage == 3
    SendMessage $BrainRow2 ${WM_SETTEXT} 0 "STR:已完成  解压并准备应用文件"
    SendMessage $BrainRow3 ${WM_SETTEXT} 0 "STR:进行中  替换旧版并写入程序"
    SendMessage $BrainStatus ${WM_SETTEXT} 0 "STR:正在替换旧版并写入程序，请等待此步骤完成…"
  ${ElseIf} $BrainStage == 4
    SendMessage $BrainRow3 ${WM_SETTEXT} 0 "STR:已完成  替换旧版并写入程序"
    SendMessage $BrainRow4 ${WM_SETTEXT} 0 "STR:进行中  注册卸载入口与快捷方式"
    SendMessage $BrainStatus ${WM_SETTEXT} 0 "STR:正在注册卸载入口与快捷方式…"
  ${ElseIf} $BrainStage == 5
    SendMessage $BrainRow4 ${WM_SETTEXT} 0 "STR:已完成  注册卸载入口与快捷方式"
    SendMessage $BrainRow5 ${WM_SETTEXT} 0 "STR:进行中  完成安装检查"
  ${EndIf}
FunctionEnd

Function BrainFinish
  StrCpy $BrainLaunching 0
  StrCpy $BrainPageStep 4
  StrCpy $BrainTitle "公司大脑安装完成"
  StrCpy $BrainSubTitle "公司大脑已安装到这台电脑。"
  Call BrainPage
  StrCpy $BrainDone 1
  SetCtlColors $BrainNav4 B76C4E F1F0EC
  !insertmacro BLabelCenter 270 235 570 50 "安装完成" $0 $BrainTitleFont B76C4E FBFAF8
  !insertmacro BLabelCenter 270 312 570 70 "打开后，连接你的公司工作空间。$\r$\n对话、个人草稿与连接设置保留在本机。" $BrainLaunchMessage $BrainFont 52554F FBFAF8
  SendMessage $BrainNext ${WM_SETTEXT} 0 "STR:立即打开"
  SendMessage $BrainCancel ${WM_SETTEXT} 0 "STR:完成"
  EnableWindow $BrainCancel 1
  ShowWindow $BrainBack ${SW_HIDE}
  BrainWizard::Style /NOUNLOAD
  ${NSD_CreateButton} 0 0 1 1 "启动操作"
  Pop $0
  ShowWindow $0 ${SW_HIDE}
  ${NSD_OnClick} $0 BrainLaunch
  BrainWizard::LaunchAction /NOUNLOAD $0
  nsDialogs::Show
FunctionEnd
Function BrainLaunch
  Pop $0
  ${If} $BrainLaunching == 1
    Return
  ${EndIf}
  StrCpy $BrainLaunching 1
  SendMessage $BrainNext ${WM_SETTEXT} 0 "STR:正在打开…"
  SendMessage $BrainLaunchMessage ${WM_SETTEXT} 0 "STR:正在打开公司大脑，请稍候…$\r$\n客户端窗口出现后，此向导会自动关闭。"
  EnableWindow $BrainNext 0
  BrainWizard::Refresh /NOUNLOAD
  SetOutPath "$INSTDIR"
  ${IfNot} ${FileExists} "$appExe"
    Call BrainLaunchFailed
    Return
  ${EndIf}
  ClearErrors
  ; Avoid Explorer/shortcut indirection for normal per-user installs. Preserve
  ; the unelevated launch path when the installer itself is elevated.
  ${If} ${UAC_IsAdmin}
    ${StdUtils.ExecShellAsUser} $0 "$appExe" "open" ""
    ${If} $0 == "error"
      Call BrainLaunchFailed
      Return
    ${EndIf}
  ${Else}
    Exec '"$appExe"'
    ${If} ${Errors}
      Call BrainLaunchFailed
      Return
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetTickCount()i.s'
  Pop $BrainLaunchStarted
  ${NSD_CreateTimer} BrainLaunchPoll 150
FunctionEnd
Function BrainLaunchPoll
  BrainWizard::AppWindow /NOUNLOAD "$appExe"
  Pop $0
  ${If} $0 == 1
    ${NSD_KillTimer} BrainLaunchPoll
    BrainWizard::LaunchAction /NOUNLOAD 0
    EnableWindow $BrainNext 1
    SetErrorLevel 0
    ; Leave through the normal wizard navigation after the timer callback
    ; returns. Quit inside an nsDialogs callback does not end its modal loop.
    System::Call 'user32::PostMessageW(p $HWNDPARENT, i ${WM_COMMAND}, p 1, p 0)'
    Return
  ${EndIf}
  System::Call 'kernel32::GetTickCount()i.r0'
  IntOp $0 $0 - $BrainLaunchStarted
  ${If} $0 > 20000
    ${NSD_KillTimer} BrainLaunchPoll
    Call BrainLaunchFailed
  ${EndIf}
FunctionEnd
Function BrainLaunchFailed
  StrCpy $BrainLaunching 0
  SendMessage $BrainNext ${WM_SETTEXT} 0 "STR:重试打开"
  SendMessage $BrainLaunchMessage ${WM_SETTEXT} 0 "STR:暂未检测到客户端窗口。$\r$\n可重试打开，或点“完成”后从桌面快捷方式进入。"
  EnableWindow $BrainNext 1
  BrainWizard::Refresh /NOUNLOAD
FunctionEnd
Function BrainUserAbort
  ${If} $BrainDone == 1
    ${NSD_KillTimer} BrainLaunchPoll
    SetErrorLevel 0
    Return
  ${EndIf}
  ${If} $BrainCritical == 1
    MessageBox MB_OK|MB_ICONINFORMATION "正在完成程序写入，请等待当前步骤结束。个人记录不会被清除。"
    Abort
  ${EndIf}
  MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONQUESTION "要取消本次安装吗？$\r$\n将等待当前安全步骤结束，清理临时文件，并保留已有对话与草稿。" IDYES brain_cancel_yes IDNO brain_continue_install
  brain_cancel_yes:
  SetErrorLevel 1
  Return
  brain_continue_install:
    Abort
FunctionEnd

Function un.BrainWelcome
  StrCpy $BrainPageStep 1
  StrCpy $BrainTitle "卸载公司大脑？"
  StrCpy $BrainSubTitle "将移除程序与快捷方式，个人数据单独保留。"
  Call un.BrainPage
  SetCtlColors $BrainNav1 B76C4E F1F0EC
  !insertmacro BLabelCenter 245 210 610 80 "保留本机对话、个人草稿与设置。$\r$\n重新安装后，可在原设备继续使用已有记录。" $0 $BrainBrandFont 52554F FBFAF8
  SendMessage $BrainNext ${WM_SETTEXT} 0 "STR:卸载应用"
  nsDialogs::Show
FunctionEnd
Function un.BrainFinish
  StrCpy $BrainPageStep 3
  StrCpy $BrainTitle "卸载完成"
  StrCpy $BrainSubTitle "程序与快捷方式已移除，本机个人记录已保留。"
  Call un.BrainPage
  SetCtlColors $BrainNav3 B76C4E F1F0EC
  !insertmacro BLabelCenter 250 245 600 50 "公司大脑已卸载" $0 $BrainTitleFont 272925 FBFAF8
  SendMessage $BrainNext ${WM_SETTEXT} 0 "STR:关闭"
  ShowWindow $BrainBack ${SW_HIDE}
  ShowWindow $BrainCancel ${SW_HIDE}
  nsDialogs::Show
FunctionEnd

Page custom BrainWelcome
Page custom BrainDirectory BrainDirectoryLeave
!define MUI_PAGE_CUSTOMFUNCTION_SHOW BrainProgressShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE BrainProgressLeave
!insertmacro MUI_PAGE_INSTFILES
Page custom BrainFinish
UninstPage custom un.BrainWelcome
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.BrainProgressShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.BrainProgressLeave
!insertmacro MUI_UNPAGE_INSTFILES
UninstPage custom un.BrainFinish
