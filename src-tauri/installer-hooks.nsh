; "Open in Yamet" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInYamet" "" "Open in Yamet"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInYamet" "Icon" '"$INSTDIR\yamet.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInYamet" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInYamet\command" "" '"$INSTDIR\yamet.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInYamet" "" "Open in Yamet"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInYamet" "Icon" '"$INSTDIR\yamet.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInYamet" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInYamet\command" "" '"$INSTDIR\yamet.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInYamet" "" "Open in Yamet"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInYamet" "Icon" '"$INSTDIR\yamet.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInYamet" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInYamet\command" "" '"$INSTDIR\yamet.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInYamet"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInYamet"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInYamet"
!macroend
