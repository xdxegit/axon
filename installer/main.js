import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'
import { exec } from 'child_process'
import fs from 'fs'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Platform switches. The Windows path is the fully-automated, battle-tested one
// (NSIS + winget + Restart-Manager). macOS/Linux take a lighter, best-effort path:
// npm-based CLIs plus opening the bundled native Axon package for the user.
const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

// Cross-platform "is this binary on PATH?" — `where` on Windows, `command -v` elsewhere.
function whichCmd(bin) {
  return IS_WIN ? `where ${bin}` : `command -v ${bin}`
}

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
  setupLog(`=== Axon Glow ${app.getVersion()} starting === platform=${process.platform}`)
  win = new BrowserWindow({
    width: 760,
    height: 560,
    // Frameless + transparent glass card on every OS, with our own min/close
    // controls (no native traffic lights to depend on). Transparency needs a
    // compositor on Linux; the stage paints a solid backdrop as a fallback.
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    center: true,
    show: false,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, IS_WIN ? 'icon.ico' : 'icon.png')
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

// Locate the bundled native Axon package for the current OS. Packaged builds put
// it under resources/payload (see installer/package.json extraResources); dev
// falls back to the repo's release/ folder.
function getPayload(extensions) {
  const dirs = app.isPackaged
    ? [path.join(process.resourcesPath, 'payload')]
    : [path.join(__dirname, '..', 'release')]
  for (const dir of dirs) {
    try {
      const hit = fs.readdirSync(dir).find(f => extensions.some(e => f.toLowerCase().endsWith(e)))
      if (hit) return path.join(dir, hit)
    } catch { /* dir missing — try next */ }
  }
  return null
}

// macOS / Linux app install. Best-effort and tested via CI on real runners; the
// Windows NSIS flow remains the primary, fully-verified path.
async function installAppUnix() {
  if (IS_MAC) {
    const dmg = getPayload(['.dmg'])
    if (!dmg) return { success: false, message: 'Bundled Axon .dmg not found in installer resources.' }
    emitProgress({ stage: 'Mounting Axon.dmg' })
    // Attach, copy Axon.app into the user's ~/Applications (no admin needed), detach.
    const mnt = path.join(os.tmpdir(), `axon-dmg-${Date.now()}`)
    const userApps = path.join(os.homedir(), 'Applications')
    const att = await runCmd(`hdiutil attach "${dmg}" -nobrowse -mountpoint "${mnt}"`, 120000)
    if (!att.success) { await runCmd(`open "${dmg}"`).catch(() => {}); return { success: true, message: 'Opened Axon.dmg — drag Axon to Applications.' } }
    // Remove any previous Axon.app first (quit it if running) so stale files from
    // an older version don't linger — `cp -R` would otherwise merge over them.
    const oldApp = path.join(userApps, 'Axon.app')
    if (fs.existsSync(oldApp)) {
      emitProgress({ stage: 'Removing previous Axon' })
      await runCmd('osascript -e \'quit app "Axon"\'').catch(() => {})
      await runCmd('pkill -f Axon.app').catch(() => {})
      await new Promise(r => setTimeout(r, 800))
      await runCmd(`rm -rf "${oldApp}"`, 60000).catch(() => {})
    }
    emitProgress({ stage: 'Copying Axon to Applications' })
    await runCmd(`mkdir -p "${userApps}" && cp -R "${mnt}/Axon.app" "${userApps}/"`, 120000).catch(() => {})
    await runCmd(`hdiutil detach "${mnt}" -quiet`, 60000).catch(() => {})
    const ok = fs.existsSync(path.join(userApps, 'Axon.app'))
    return ok ? { success: true, message: 'Axon installed to ~/Applications' }
              : { success: false, message: 'Could not copy Axon.app — open the .dmg and drag it manually.' }
  }

  // Linux: prefer the .deb (apt resolves deps); else stage the AppImage.
  const deb = getPayload(['.deb'])
  if (deb && (await runCmd('command -v pkexec')).success && (await runCmd('command -v apt-get')).success) {
    emitProgress({ stage: 'Installing Axon (.deb)', detail: 'pkexec apt-get install' })
    const r = await runCmd(`pkexec apt-get install -y "${deb}"`, 300000)
    if (r.success) return { success: true, message: 'Axon installed' }
    const d = await runCmd(`pkexec dpkg -i "${deb}"`, 300000)
    if (d.success) return { success: true, message: 'Axon installed' }
    return { success: false, message: 'Axon .deb install failed: ' + (r.stderr || d.stderr || '').slice(0, 400) }
  }
  const appImg = getPayload(['.appimage'])
  if (appImg) {
    emitProgress({ stage: 'Installing Axon (AppImage)' })
    const dest = path.join(os.homedir(), '.local', 'bin', 'Axon.AppImage')
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(appImg, dest)
      fs.chmodSync(dest, 0o755)
      return { success: true, message: `Axon installed to ${dest}` }
    } catch (e) {
      return { success: false, message: 'AppImage install failed: ' + e.message }
    }
  }
  return { success: false, message: 'No bundled Axon package (.deb/.AppImage) found in installer resources.' }
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('run-step', async (_e, step) => {
  setupLog(`run-step: ${step}`)
  try {
    return await runStep(step)
  } catch (err) {
    setupLog(`run-step ${step} threw: ${err?.stack || err}`)
    // Inline the tail of axon-setup.log so the user sees concrete output
    // immediately instead of being told to find a temp file that under
    // elevation sometimes lives in a path they don't have access to.
    let tail = ''
    try {
      if (fs.existsSync(SETUP_LOG)) {
        const text = fs.readFileSync(SETUP_LOG, 'utf8')
        tail = text.trim().split(/\r?\n/).slice(-20).join('\n')
      }
    } catch { /* ignore */ }
    return {
      success: false,
      message:
        `Internal setup error: ${err?.message || err}` +
        (tail ? `\n\nSetup log tail (file: ${SETUP_LOG}):\n${tail}` : `\n\nSetup log path: ${SETUP_LOG} (file not yet created)`)
    }
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
      const r = await runCmd(whichCmd('node'))
      return { success: r.success, message: r.success ? 'Node.js found' : 'Node.js not found' }
    }

    case 'install-node': {
      if (IS_WIN) {
        emitProgress({ stage: 'Downloading Node.js LTS via winget', detail: 'This usually takes 30–90 seconds' })
        // winget output: stdout often carries the failure detail (exit code, hash
        // mismatch), not stderr. Surface both so the UI shows something actionable.
        const r = await runCmd(
          'winget install --id OpenJS.NodeJS.LTS -e --source winget ' +
          '--accept-package-agreements --accept-source-agreements --silent',
          300000
        )
        await refreshPath()
        if ((await runCmd(whichCmd('node'))).success) return { success: true, message: 'Node.js installed' }
        const detail = (r.stderr || r.stdout || '').slice(0, 500) || 'unknown error'
        return { success: false, message: 'Node.js install failed: ' + detail }
      }

      if (IS_MAC) {
        // Homebrew is the de-facto macOS package manager and needs no sudo prompt.
        if (!(await runCmd('command -v brew')).success) {
          return { success: false, message: 'Node.js not found. Install it from nodejs.org or run: brew install node' }
        }
        emitProgress({ stage: 'Installing Node.js via Homebrew', detail: 'brew install node' })
        const r = await runCmd('brew install node', 300000)
        if ((await runCmd(whichCmd('node'))).success) return { success: true, message: 'Node.js installed' }
        return { success: false, message: 'Node.js install failed: ' + (r.stderr || r.stdout || '').slice(0, 500) }
      }

      // Linux: use the distro package manager via pkexec (shows a graphical
      // password prompt on most desktops). Falls back to guidance if unavailable.
      const mgr =
        (await runCmd('command -v apt-get')).success ? 'apt-get install -y nodejs npm' :
        (await runCmd('command -v dnf')).success     ? 'dnf install -y nodejs npm' :
        (await runCmd('command -v pacman')).success   ? 'pacman -S --noconfirm nodejs npm' : null
      if (!mgr || !(await runCmd('command -v pkexec')).success) {
        return { success: false, message: 'Node.js not found. Install it via your package manager (e.g. sudo apt install nodejs npm).' }
      }
      emitProgress({ stage: 'Installing Node.js', detail: mgr })
      const r = await runCmd(`pkexec ${mgr}`, 300000)
      if ((await runCmd(whichCmd('node'))).success) return { success: true, message: 'Node.js installed' }
      return { success: false, message: 'Node.js install failed: ' + (r.stderr || r.stdout || '').slice(0, 500) }
    }

    case 'check-omniroute': {
      // 1) Verify the binary is on PATH at all.
      const r = await runCmd(whichCmd('omniroute'))
      if (!r.success) return { success: false, message: 'OmniRoute CLI not found' }
      // 2) Verify the version. 3.7.9 has a broken Settings button, so anything
      //    not matching the pinned 3.7.7 falls through to the install step.
      const v = await runCmd('omniroute --version', 15000)
      const m = /(\d+\.\d+\.\d+)/.exec(`${v.stdout || ''}${v.stderr || ''}`)
      const version = m ? m[1] : null
      if (version === '3.7.7') {
        return { success: true, message: 'OmniRoute CLI 3.7.7 found' }
      }
      return {
        success: false,
        message: version
          ? `OmniRoute ${version} найден — обновляю до 3.7.7…`
          : 'OmniRoute CLI: версия не определена — переустанавливаю на 3.7.7…'
      }
    }

    case 'install-omniroute': {
      // Make sure PATH is fresh in case node/npm was just installed in the previous step.
      await refreshPath()

      emitProgress({ stage: 'Installing OmniRoute CLI 3.7.7 via npm', detail: 'Resolving peer dependencies…' })
      // Pinned to 3.7.7 — 3.7.9 ships with a broken "Settings" launch button.
      // omniroute has a React peer-dep conflict (react@19 vs sub-deps wanting ^16-18).
      // --legacy-peer-deps lets npm proceed instead of failing on ERESOLVE.
      const r = await runCmd('npm install -g omniroute@3.7.7 --legacy-peer-deps --no-fund --no-audit', 300000)

      await refreshPath()

      const present = (await runCmd(whichCmd('omniroute'))).success
      if (present) {
        return { success: true, message: 'OmniRoute CLI 3.7.7 installed' }
      }

      const detail = (r.stderr || r.stdout || '').slice(0, 500) || 'unknown error'
      return { success: false, message: 'Install failed: ' + detail }
    }

    case 'check-claude': {
      const r = await runCmd(whichCmd('claude'))
      return { success: r.success, message: r.success ? 'Claude Code CLI found' : 'Claude Code CLI not found' }
    }

    case 'install-claude': {
      // Same npm-was-just-installed PATH dance as the omniroute step.
      await refreshPath()

      emitProgress({ stage: 'Installing Claude Code CLI via npm', detail: 'Downloading @anthropic-ai/claude-code…' })
      const r = await runCmd('npm install -g @anthropic-ai/claude-code --no-fund --no-audit', 300000)

      await refreshPath()

      const present = (await runCmd(whichCmd('claude'))).success
      if (present) {
        return { success: true, message: 'Claude Code CLI installed' }
      }

      const detail = (r.stderr || r.stdout || '').slice(0, 500) || 'unknown error'
      return { success: false, message: 'Install failed: ' + detail }
    }

    case 'install-app': {
      // macOS/Linux take the lightweight path (open / install the bundled native
      // package). Windows continues with the full NSIS replacement flow below.
      if (!IS_WIN) return await installAppUnix()

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

      // 1) Kill any running Axon.exe AND OmniRoute (which Axon spawns on launch).
      //    DO NOT taskkill "Axon Setup.exe" — that's literally us, and `/T` would
      //    take our entire process tree down with it. /FI PID ne <self> is
      //    defence-in-depth in case a stale wizard ever shares our exe name.
      //    OmniRoute commonly remains running from a previous Axon session and
      //    holds files in %APPDATA%\npm + the install dir, which makes NSIS
      //    abort with "не удалось удалить старые файлы".
      emitProgress({ stage: 'Closing running Axon and OmniRoute instances' })
      const selfPid = process.pid
      const k1 = await runCmd(`taskkill /F /FI "PID ne ${selfPid}" /IM "Axon.exe" /T`, 15000).catch(() => ({ success: false }))
      const k2 = await runCmd('taskkill /F /IM "omniroute.exe" /T', 15000).catch(() => ({ success: false }))
      // omniroute v3 is sometimes shipped purely as a node script: `node omniroute`.
      // We can't blanket-kill node.exe (would nuke other dev tools), so target
      // by command line via WMIC — best-effort, fails harmlessly if WMIC absent.
      const k3 = await runCmd(
        `wmic process where "name='node.exe' and commandline like '%%omniroute%%'" call terminate`,
        15000
      ).catch(() => ({ success: false }))
      setupLog(`install-app: taskkill Axon.exe=${k1.success} omniroute.exe=${k2.success} node-omniroute=${k3.success}`)
      // Give Windows a beat to release the file handles after the processes die.
      await new Promise(r => setTimeout(r, 1000))

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

      // Read the tail of axon-setup.log and inline it into the error message so
      // the user doesn't have to hunt for a file under %TEMP% (which under
      // elevation sometimes ends up in a different path than they expect).
      let setupLogTail = ''
      try {
        if (fs.existsSync(SETUP_LOG)) {
          const text = fs.readFileSync(SETUP_LOG, 'utf8')
          const lines = text.trim().split(/\r?\n/)
          setupLogTail = lines.slice(-30).join('\n')
        }
      } catch { /* ignore */ }

      const detail = [
        reason,
        leftovers.length ? `Leftover files in ${APP_INSTALL_DIR}:\n  ${leftovers.join('\n  ')}` : '',
        lockers.length   ? `Processes holding install files:\n  ${lockers.join('\n  ')}` : '',
        r.stderr || '',
        r.stdout || '',
        setupLogTail
          ? `Setup log tail (file: ${SETUP_LOG}):\n${setupLogTail}`
          : `Setup log path: ${SETUP_LOG} (file not yet created)`
      ].filter(Boolean).join('\n\n')

      return { success: false, message: detail }
    }

    case 'launch-app': {
      if (IS_WIN) {
        const exePath = path.join(APP_INSTALL_DIR, 'Axon.exe')
        if (fs.existsSync(exePath)) shell.openPath(exePath)
        else shell.openExternal('shell:AppsFolder')
        return { success: true }
      }
      if (IS_MAC) {
        await runCmd('open -a Axon').catch(() => {})
        return { success: true }
      }
      // Linux: try the installed binary, else the AppImage we may have placed.
      if ((await runCmd(whichCmd('axon'))).success) { await runCmd('axon &').catch(() => {}) }
      else {
        const appImg = path.join(os.homedir(), '.local', 'bin', 'Axon.AppImage')
        if (fs.existsSync(appImg)) await runCmd(`"${appImg}" &`).catch(() => {})
      }
      return { success: true }
    }

    default:
      return { success: false, message: 'Unknown step: ' + step }
  }
}

ipcMain.on('window-minimize', () => win?.minimize())
ipcMain.on('window-close',    () => { setupLog('window-close'); win?.close(); app.quit() })
