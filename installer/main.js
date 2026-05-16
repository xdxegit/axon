import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'
import { exec } from 'child_process'
import fs from 'fs'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Persistent diagnostic log for every install run. If the wizard exits unexpectedly
// (e.g. NSIS aborts before our UI updates), the trail in this file tells us where.
const SETUP_LOG = path.join(os.tmpdir(), 'axon-setup.log')
function setupLog(message) {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`
    fs.appendFileSync(SETUP_LOG, line, 'utf8')
  } catch { /* logging must never crash */ }
}

let win

process.on('uncaughtException', (err) => {
  setupLog(`uncaughtException: ${err?.stack || err}`)
})
process.on('unhandledRejection', (reason) => {
  setupLog(`unhandledRejection: ${reason?.stack || reason}`)
})

app.whenReady().then(() => {
  setupLog(`=== Axon Setup ${app.getVersion()} starting ===`)
  win = new BrowserWindow({
    width: 720,
    height: 520,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    show: false,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.ico')
      : path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.loadFile(path.join(__dirname, 'index.html'))
  win.once('ready-to-show', () => win.show())
})

app.on('window-all-closed', () => app.quit())

// ── Helpers ──────────────────────────────────────────────────────────────────

function runPS(command, timeout = 180000) {
  return new Promise(resolve => {
    exec(
      `powershell -NonInteractive -ExecutionPolicy Bypass -Command "${command.replace(/"/g, '\\"')}"`,
      { timeout, env: process.env, maxBuffer: 1024 * 1024 * 16 },
      (error, stdout, stderr) => resolve({ success: !error, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() })
    )
  })
}

function runCmd(command, timeout = 180000) {
  return new Promise(resolve => {
    exec(command, { timeout, env: process.env, maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) =>
      resolve({ success: !error, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() })
    )
  })
}

// Push a live progress update to the renderer. The UI uses this to show the current
// stage + a free-form detail line (e.g. "Installed 42.3 MB") next to the elapsed timer.
function emitProgress(payload) {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('install:progress', payload) } catch { /* ignore */ }
  }
}

// List files in a directory (one level). Used to diagnose "install dir won't go away"
// — we surface the leftovers in the failure message so the user can see what's stuck.
function listDirShallow(dir, limit = 20) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    return entries.slice(0, limit).map(e => e.name + (e.isDirectory() ? '/' : ''))
  } catch (e) {
    return [`<readdir failed: ${e.message}>`]
  }
}

// Ask Windows Restart Manager which process is holding any file at the given paths.
// Returns array of "PID | AppName" strings. Empty if nothing holds them or call fails.
async function findFileLockers(paths) {
  // Inline PowerShell — calls rstrtmgr.dll via P/Invoke. Same trick we used in dev.
  const psScript = `
    $sig = @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Rm {
  [StructLayout(LayoutKind.Sequential)] struct UP { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct PI {
    public UP Process; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string strServiceShortName;
    public int ApplicationType; public uint AppStatus; public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint nF, string[] f, uint nA, [In] UP[] a, uint nS, string[] s);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Auto)]    static extern int RmStartSession(out uint h, int flags, string key);
  [DllImport("rstrtmgr.dll")]                          static extern int RmEndSession(uint h);
  [DllImport("rstrtmgr.dll")]                          static extern int RmGetList(uint h, out uint need, ref uint have, [In, Out] PI[] arr, ref uint why);
  public static List<string> Find(string[] paths) {
    var key = Guid.NewGuid().ToString(); uint h; var r = new List<string>();
    if (RmStartSession(out h, 0, key) != 0) return r;
    try {
      if (RmRegisterResources(h, (uint)paths.Length, paths, 0, null, 0, null) != 0) return r;
      uint have=0, why=0, need; RmGetList(h, out need, ref have, null, ref why); if (need==0) return r;
      have = need; var arr = new PI[need]; if (RmGetList(h, out need, ref have, arr, ref why) != 0) return r;
      for (int i = 0; i < have; i++) r.Add(arr[i].Process.dwProcessId + " | " + arr[i].strAppName);
    } finally { RmEndSession(h); }
    return r;
  }
}
'@
    Add-Type -TypeDefinition $sig -Language CSharp -ErrorAction SilentlyContinue
    $paths = @(${paths.map(p => `'${p.replace(/'/g, "''")}'`).join(',')})
    [Rm]::Find($paths) | ForEach-Object { Write-Output $_ }
  `.replace(/\r?\n\s*/g, ' ')
  const r = await runPS(psScript, 15000).catch(() => ({ success: false, stdout: '' }))
  if (!r.success) return []
  return r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
}

// Recursive total file size in bytes. Used to track NSIS extraction progress: we poll
// the install dir while NSIS runs and surface "Installed X MB" as a rough progress hint.
async function dirSize(dir) {
  let total = 0
  let entries
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    try {
      if (entry.isDirectory()) {
        total += await dirSize(full)
      } else if (entry.isFile()) {
        const s = await fs.promises.stat(full)
        total += s.size
      }
    } catch { /* ignore unreadable entries */ }
  }
  return total
}

// Refresh PATH from registry so newly-installed CLIs (node, npm, omniroute) become visible
// to subsequent child_process calls without restarting the installer.
async function refreshPath() {
  const r = await runPS(
    "$m=[Environment]::GetEnvironmentVariable('Path','Machine');" +
    "$u=[Environment]::GetEnvironmentVariable('Path','User');" +
    "Write-Output ($m + ';' + $u)"
  )
  if (r.success && r.stdout) {
    const extra = r.stdout
    const existing = process.env.Path || process.env.PATH || ''
    // Prepend so newly installed tools win over older copies
    process.env.Path = extra + ';' + existing
    process.env.PATH = process.env.Path
  }
}

// Extract the bundled NSIS installer from resources to a temp path.
// In dev mode, fall back to the release folder directly.
function getNsisExe() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'nsis.exe')
  }
  // dev fallback: look for the built NSIS installer
  const releaseDir = path.join(__dirname, '..', 'release')
  try {
    const found = fs.readdirSync(releaseDir)
      .find(f => f.toLowerCase().includes('axon') && f.endsWith('.exe'))
    return found ? path.join(releaseDir, found) : null
  } catch {
    return null
  }
}

const APP_INSTALL_DIR = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Axon')

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('run-step', async (_e, step) => {
  setupLog(`run-step: ${step}`)
  try {
    return await runStep(step)
  } catch (err) {
    setupLog(`run-step ${step} threw: ${err?.stack || err}`)
    return { success: false, message: `Internal setup error: ${err?.message || err}\n\nSee log: ${SETUP_LOG}` }
  }
})

async function runStep(step) {
  switch (step) {

    case 'check-winget': {
      const r = await runCmd('where winget')
      return { success: r.success, message: r.success ? 'winget found' : 'winget not found' }
    }

    case 'install-winget': {
      emitProgress({ stage: 'Downloading Windows Package Manager', detail: 'Fetching MSIX bundle from GitHub…' })
      const r = await runPS(
        '$ProgressPreference="SilentlyContinue";' +
        'Invoke-WebRequest -Uri "https://github.com/microsoft/winget-cli/releases/latest/download/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle" -OutFile "$env:TEMP\\winget-setup.msixbundle" -UseBasicParsing;' +
        'Add-AppxPackage -Path "$env:TEMP\\winget-setup.msixbundle";' +
        'Remove-Item "$env:TEMP\\winget-setup.msixbundle" -Force'
      )
      await refreshPath()
      return { success: r.success, message: r.success ? 'winget installed' : 'winget install failed: ' + r.stderr }
    }

    case 'check-node': {
      const r = await runCmd('where node')
      return { success: r.success, message: r.success ? 'Node.js found' : 'Node.js not found' }
    }

    case 'install-node': {
      emitProgress({ stage: 'Downloading Node.js LTS via winget', detail: 'This usually takes 30–90 seconds' })
      // winget output: stdout often contains the failure detail (exit code, hash mismatch),
      // not stderr. Surface both so the UI shows something actionable.
      const r = await runCmd(
        'winget install --id OpenJS.NodeJS.LTS -e --source winget ' +
        '--accept-package-agreements --accept-source-agreements --silent',
        300000
      )

      // Always refresh PATH — even on partial success node/npm may be on disk but not in env.
      await refreshPath()

      const nodeNowPresent = (await runCmd('where node')).success
      if (nodeNowPresent) {
        return { success: true, message: 'Node.js installed' }
      }

      const detail = (r.stderr || r.stdout || '').slice(0, 500) || 'unknown error'
      return { success: false, message: 'Node.js install failed: ' + detail }
    }

    case 'check-omniroute': {
      const r = await runCmd('where omniroute')
      return { success: r.success, message: r.success ? 'OmniRoute CLI found' : 'OmniRoute CLI not found' }
    }

    case 'install-omniroute': {
      // Make sure PATH is fresh in case node/npm was just installed in the previous step.
      await refreshPath()

      emitProgress({ stage: 'Installing OmniRoute CLI via npm', detail: 'Resolving peer dependencies…' })
      // omniroute has a React peer-dep conflict (react@19 vs sub-deps wanting ^16-18).
      // --legacy-peer-deps lets npm proceed instead of failing on ERESOLVE.
      const r = await runCmd('npm install -g omniroute --legacy-peer-deps --no-fund --no-audit', 300000)

      await refreshPath()

      const present = (await runCmd('where omniroute')).success
      if (present) {
        return { success: true, message: 'OmniRoute CLI installed' }
      }

      const detail = (r.stderr || r.stdout || '').slice(0, 500) || 'unknown error'
      return { success: false, message: 'Install failed: ' + detail }
    }

    case 'check-claude': {
      const r = await runCmd('where claude')
      return { success: r.success, message: r.success ? 'Claude Code CLI found' : 'Claude Code CLI not found' }
    }

    case 'install-claude': {
      // Same npm-was-just-installed PATH dance as the omniroute step.
      await refreshPath()

      emitProgress({ stage: 'Installing Claude Code CLI via npm', detail: 'Downloading @anthropic-ai/claude-code…' })
      const r = await runCmd('npm install -g @anthropic-ai/claude-code --no-fund --no-audit', 300000)

      await refreshPath()

      const present = (await runCmd('where claude')).success
      if (present) {
        return { success: true, message: 'Claude Code CLI installed' }
      }

      const detail = (r.stderr || r.stdout || '').slice(0, 500) || 'unknown error'
      return { success: false, message: 'Install failed: ' + detail }
    }

    case 'install-app': {
      const nsisSource = getNsisExe()
      setupLog(`install-app: nsisSource=${nsisSource}`)
      if (!nsisSource || !fs.existsSync(nsisSource)) {
        return { success: false, message: `Bundled installer not found at:\n${nsisSource}` }
      }

      const targetExe = path.join(APP_INSTALL_DIR, 'Axon.exe')
      const oldUninstaller = path.join(APP_INSTALL_DIR, 'Uninstall Axon.exe')

      // Snapshot the OLD Axon.exe mtime (if any) so we can verify NSIS actually
      // replaced it. Without this, fs.existsSync(targetExe) returns true for the
      // STALE binary too, and we'd incorrectly report "installed".
      let preInstallMtime = 0
      try {
        if (fs.existsSync(targetExe)) preInstallMtime = fs.statSync(targetExe).mtimeMs
      } catch { /* ignore */ }
      setupLog(`install-app: pre-install mtime=${preInstallMtime}`)

      // 1) Kill any running Axon.exe (the installed app — NOT our own setup wizard).
      //    DO NOT taskkill "Axon Setup.exe" — that's literally us, and `/T` would
      //    take our entire process tree down with it. Using /FI PID ne <self> to
      //    exclude ourselves is defence-in-depth in case a stale wizard exists.
      emitProgress({ stage: 'Closing running Axon instances' })
      const selfPid = process.pid
      const killCmd = `taskkill /F /FI "PID ne ${selfPid}" /IM "Axon.exe" /T`
      const k1 = await runCmd(killCmd, 15000).catch(() => ({ success: false }))
      setupLog(`install-app: taskkill Axon.exe (self pid ${selfPid}) success=${k1.success}; stdout=${k1.stdout?.slice(0,200)}`)
      // Give Windows a beat to release the file handles after the processes die.
      await new Promise(r => setTimeout(r, 800))

      // 2) Run the OLD uninstaller silently. NSIS's `_?=<path>` flag stops the
      //    uninstaller from copying itself to %TEMP% before running — and CRITICALLY
      //    the path must be RAW (not quoted, not JSON-escaped). The previous
      //    JSON.stringify wrapped backslashes which broke the call silently.
      if (fs.existsSync(oldUninstaller)) {
        emitProgress({ stage: 'Removing previous Axon installation' })
        const uninstCmd = `"${oldUninstaller}" /S _?=${APP_INSTALL_DIR}`
        setupLog(`install-app: running uninstaller: ${uninstCmd}`)
        const u = await runCmd(uninstCmd, 120000).catch((e) => ({ success: false, stderr: String(e) }))
        setupLog(`install-app: uninstaller exit success=${u.success}; stdout=${u.stdout?.slice(0,200)}; stderr=${u.stderr?.slice(0,200)}`)
        await new Promise(r => setTimeout(r, 1500))

        // Best-effort: nuke any leftovers the uninstaller may have skipped (it does
        // not always remove every file). RMDir on a non-empty dir is OK because we
        // also clear running processes above.
        try {
          if (fs.existsSync(APP_INSTALL_DIR)) {
            await runCmd(`rmdir /S /Q "${APP_INSTALL_DIR}"`, 30000).catch(() => {})
            const stillExists = fs.existsSync(APP_INSTALL_DIR)
            setupLog(`install-app: forced rmdir of ${APP_INSTALL_DIR}, still exists? ${stillExists}`)
            if (stillExists) {
              setupLog(`install-app: leftover entries: ${JSON.stringify(listDirShallow(APP_INSTALL_DIR))}`)
              const lockers = await findFileLockers([
                path.join(APP_INSTALL_DIR, 'Axon.exe'),
                path.join(APP_INSTALL_DIR, 'resources', 'app.asar')
              ])
              if (lockers.length) {
                setupLog(`install-app: file lockers: ${lockers.join('; ')}`)
              } else {
                setupLog('install-app: no Restart-Manager lockers reported')
              }
            }
          }
        } catch (e) { setupLog(`install-app: rmdir block error: ${e.message}`) }
      }

      // 3) Copy bundled NSIS to a temp path with a stable, non-clashing name.
      emitProgress({ stage: 'Extracting bundled installer' })
      const tmpExe = path.join(os.tmpdir(), `axon-nsis-${Date.now()}.exe`)
      try {
        fs.copyFileSync(nsisSource, tmpExe)
        setupLog(`install-app: extracted to ${tmpExe}`)
      } catch (err) {
        setupLog(`install-app: extract failed: ${err.message}`)
        return { success: false, message: `Failed to extract installer: ${err.message}` }
      }

      // 4) Run NSIS silently. /D=<dir> sets the install location (NSIS quirk: no quotes,
      //    must be the LAST switch). /NCRC skips the CRC check (avoids AV interference).
      //    NOTE: /LOG only works in NSIS builds compiled with LogSet=on; electron-builder's
      //    default NSIS ignores it. We keep it for forward-compat but don't rely on the file.
      const nsisLogFile = path.join(os.tmpdir(), `axon-nsis-${Date.now()}.log`)
      const silentCmd = `"${tmpExe}" /S /NCRC /LOG="${nsisLogFile}" /D=${APP_INSTALL_DIR}`
      setupLog(`install-app: running NSIS (silent): ${silentCmd}`)

      emitProgress({ stage: 'Installing Axon', detail: 'Unpacking files…' })

      // Poll the install directory size while NSIS runs and surface progress as
      // "Installed X.X MB" so the user sees the bar isn't frozen.
      let lastReportedMb = 0
      const sizeTimer = setInterval(async () => {
        try {
          const bytes = await dirSize(APP_INSTALL_DIR)
          const mb = bytes / (1024 * 1024)
          if (mb >= lastReportedMb + 0.5) {
            lastReportedMb = mb
            emitProgress({ stage: 'Installing Axon', detail: `Installed ${mb.toFixed(1)} MB` })
          }
        } catch { /* ignore */ }
      }, 1000)

      const r = await runCmd(silentCmd, 300000)
      clearInterval(sizeTimer)
      setupLog(`install-app: NSIS silent exit success=${r.success}; stdout=${r.stdout?.slice(0,500)}; stderr=${r.stderr?.slice(0,500)}`)

      // 5) Verify by mtime.
      const checkInstalled = () => {
        try {
          if (!fs.existsSync(targetExe)) return { ok: false, mtime: 0 }
          const mtime = fs.statSync(targetExe).mtimeMs
          return { ok: mtime > preInstallMtime, mtime }
        } catch { return { ok: false, mtime: 0 } }
      }
      let res = checkInstalled()
      setupLog(`install-app: after silent: post mtime=${res.mtime}, replaced=${res.ok}`)

      // 6) FALLBACK — if silent failed AND there's still no fresh Axon.exe,
      //    re-run NSIS visibly so the user sees the actual error dialog.
      //    electron-builder's NSIS suppresses error messageboxes under /S which
      //    is why silent failures look completely mute.
      if (!res.ok) {
        emitProgress({ stage: 'Retrying installer in visible mode', detail: 'NSIS will open in a new window…' })
        const visibleCmd = `"${tmpExe}" /NCRC /D=${APP_INSTALL_DIR}`
        setupLog(`install-app: running NSIS (visible): ${visibleCmd}`)
        const rv = await runCmd(visibleCmd, 600000).catch((e) => ({ success: false, stderr: String(e), stdout: '' }))
        setupLog(`install-app: NSIS visible exit success=${rv.success}; stdout=${rv.stdout?.slice(0,500)}; stderr=${rv.stderr?.slice(0,500)}`)
        res = checkInstalled()
        setupLog(`install-app: after visible: post mtime=${res.mtime}, replaced=${res.ok}`)
      }

      // 7) Clean up the temp installer copy.
      try { fs.unlinkSync(tmpExe) } catch {}

      if (res.ok) {
        try { fs.unlinkSync(nsisLogFile) } catch {}
        emitProgress({ stage: 'Installation complete', detail: '' })
        return { success: true, message: 'Axon installed' }
      }

      // Failure path: list any leftover files in the install dir and any process
      // holding them, to give the user a precise pointer to what's blocking.
      const leftovers = fs.existsSync(APP_INSTALL_DIR)
        ? listDirShallow(APP_INSTALL_DIR, 20)
        : []
      let lockers = []
      if (leftovers.length) {
        try {
          lockers = await findFileLockers([
            path.join(APP_INSTALL_DIR, 'Axon.exe'),
            path.join(APP_INSTALL_DIR, 'resources', 'app.asar'),
            APP_INSTALL_DIR
          ])
        } catch { /* ignore */ }
      }

      const reason = res.mtime
        ? 'NSIS exited without replacing Axon.exe (the file on disk is the OLD version).'
        : 'NSIS exited without creating Axon.exe.'

      const detail = [
        reason,
        leftovers.length ? `Leftover files in ${APP_INSTALL_DIR}:\n  ${leftovers.join('\n  ')}` : '',
        lockers.length   ? `Processes holding install files:\n  ${lockers.join('\n  ')}` : '',
        r.stderr || '',
        r.stdout || '',
        `Setup log: ${SETUP_LOG}`
      ].filter(Boolean).join('\n\n')

      return { success: false, message: detail }
    }

    case 'launch-app': {
      const exePath = path.join(APP_INSTALL_DIR, 'Axon.exe')
      if (fs.existsSync(exePath)) {
        shell.openPath(exePath)
      } else {
        // Fallback: open start menu shortcut via shell
        shell.openExternal('shell:AppsFolder')
      }
      return { success: true }
    }

    default:
      return { success: false, message: 'Unknown step: ' + step }
  }
}

ipcMain.on('window-minimize', () => win?.minimize())
ipcMain.on('window-close',    () => { setupLog('window-close'); win?.close(); app.quit() })
