!macro customInstall
  ; When running silently (/S), prerequisites were already handled by
  ; the custom Setup.exe — skip all checks and go straight to the API launch.
  ${If} ${Silent}
    DetailPrint "Silent mode: prerequisites handled by Setup.exe"
    Goto launch_api
  ${EndIf}

  DetailPrint "Axon: checking local runtime..."

  ; ── Windows Package Manager (winget) ──────────────────────────────────────
  nsExec::ExecToStack 'cmd /c where winget 2>nul'
  Pop $0
  Pop $1

  ${If} $0 != 0
    DetailPrint "winget not found — installing Windows Package Manager..."
    nsExec::ExecToLog 'powershell -NonInteractive -ExecutionPolicy Bypass -Command "$$ProgressPreference=''SilentlyContinue''; Invoke-WebRequest -Uri ''https://github.com/microsoft/winget-cli/releases/latest/download/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle'' -OutFile ''$$env:TEMP\winget-setup.msixbundle'' -UseBasicParsing; Add-AppxPackage -Path ''$$env:TEMP\winget-setup.msixbundle''; Remove-Item ''$$env:TEMP\winget-setup.msixbundle'' -Force"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP|MB_OK "Windows Package Manager (winget) could not be installed automatically.$\n$\nInstall it from the Microsoft Store (App Installer) and run this installer again."
      Abort
    ${EndIf}
    nsExec::ExecToStack 'cmd /c where winget 2>nul'
    Pop $0
    Pop $1
    ${If} $0 != 0
      MessageBox MB_ICONSTOP|MB_OK "winget was installed but is not yet on PATH.$\nPlease restart your computer and run this installer again."
      Abort
    ${EndIf}
    DetailPrint "winget installed."
  ${Else}
    DetailPrint "winget found."
  ${EndIf}

  ; ── Node.js LTS ───────────────────────────────────────────────────────────
  nsExec::ExecToStack 'cmd /c where node 2>nul'
  Pop $0
  Pop $1

  ${If} $0 != 0
    DetailPrint "Node.js LTS not found. Installing with winget..."
    nsExec::ExecToLog 'cmd /c winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements --silent'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP|MB_OK "Node.js installation failed.$\nInstall Node.js LTS manually from https://nodejs.org and run this installer again."
      Abort
    ${EndIf}
    DetailPrint "Node.js installed."
  ${Else}
    DetailPrint "Node.js found."
  ${EndIf}

  nsExec::ExecToStack 'cmd /c where npm 2>nul'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "npm was not found after Node.js setup.$\nPlease restart Windows and run this installer again."
    Abort
  ${EndIf}

  ; ── OmniRoute CLI ─────────────────────────────────────────────────────────
  nsExec::ExecToStack 'cmd /c where omniroute 2>nul'
  Pop $0
  Pop $1

  ${If} $0 != 0
    DetailPrint "OmniRoute CLI not found. Installing 3.7.7 with npm..."
    ; Pinned to 3.7.7 — 3.7.9 ships with a broken "Settings" launch button.
    nsExec::ExecToLog 'cmd /c npm install -g omniroute@3.7.7 --legacy-peer-deps --no-fund --no-audit'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP|MB_OK "OmniRoute CLI installation failed.$\nCheck your internet connection and npm permissions, then run this installer again."
      Abort
    ${EndIf}
    DetailPrint "OmniRoute CLI 3.7.7 installed."
  ${Else}
    DetailPrint "OmniRoute CLI found."
  ${EndIf}

  launch_api:
  DetailPrint "Starting local OmniRoute API..."
  nsExec::Exec 'cmd /c start "" /min omniroute'
  Sleep 2500
!macroend
