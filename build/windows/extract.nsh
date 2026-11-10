; The caller uses a private, empty staging directory and validates it before
; removing the installed application. Extract there without a second full copy.
!macro extractUsing7za FILE
  ClearErrors
  Nsis7z::Extract "${FILE}"
!macroend
