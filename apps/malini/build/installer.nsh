!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec '"$INSTDIR\resources\agent-bridge\node_modules\@anthropic-ai\sandbox-runtime\vendor\srt-win\x64\srt-win.exe" acl forget --all'
    Pop $0
    nsExec::Exec '"$INSTDIR\resources\agent-bridge\node_modules\@anthropic-ai\sandbox-runtime\vendor\srt-win\arm64\srt-win.exe" acl forget --all'
    Pop $0
  ${endIf}
!macroend
