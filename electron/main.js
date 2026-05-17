import { app, BrowserWindow, ipcMain, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const execFileAsync = promisify(execFile);
let omniRouteProcess = null;

// Pinned OmniRoute version: 3.7.9 ships with a broken "Settings" launch button.
// At startup we read the installed version and silently downgrade if needed so
// non-technical users don't have to touch npm.
const REQUIRED_OMNIROUTE_VERSION = "3.7.7";

// Persistent log file at %APPDATA%/Axon/axon-main.log so we can debug white-screen /
// crash issues post-install without running from a console.
function appendLog(message) {
  try {
    const dir = app.getPath("userData");
    const line = `[${new Date().toISOString()}] ${message}\n`;
    require("node:fs").appendFileSync(path.join(dir, "axon-main.log"), line, "utf8");
  } catch {
    // logging must never crash the app
  }
}

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    backgroundColor: "#0f1117",
    // Frameless: kill the native title bar and the default min/max/close overlay.
    // We render our own controls in the top bar (`.window-controls` in App.jsx).
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = win;
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });

  // Forward maximize/unmaximize events to the renderer so the maximize button can
  // swap its icon between Square ↔ Restore without polling.
  const sendMaxState = () => {
    if (!win.isDestroyed()) win.webContents.send("window:maximized", win.isMaximized());
  };
  win.on("maximize", sendMaxState);
  win.on("unmaximize", sendMaxState);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // ── Renderer diagnostics ───────────────────────────────────────────────────
  // White-screen-of-death almost always means the bundled JS failed to load.
  // Log every renderer failure so a packaged user can attach axon-main.log
  // (in %APPDATA%/Axon) when reporting a crash.
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    appendLog(`did-fail-load: ${code} ${desc} ${url}`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    appendLog(`render-process-gone: ${JSON.stringify(details)}`);
  });
  win.webContents.on("preload-error", (_e, preloadPath, error) => {
    appendLog(`preload-error: ${preloadPath} ${error?.stack || error}`);
  });
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 2) {
      // Only log warnings and errors; debug spam would bloat the file.
      appendLog(`console[${level}]: ${message} (${sourceId}:${line})`);
    }
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    appendLog(`loading file: ${indexPath}`);
    win.loadFile(indexPath).catch((err) => appendLog(`loadFile error: ${err.message}`));
  }
}

app.whenReady().then(async () => {
  // Create window first so the user sees the UI immediately. The OmniRoute
  // version check + downgrade can take 30–60s on slow npm registries; running
  // it in the background avoids a blank-screen startup.
  createWindow();

  // Defer the version check until the renderer has subscribed to app:toast,
  // otherwise the first "Обновляю OmniRoute…" toast would be sent before
  // anyone is listening and we'd silently lose it.
  const runBackgroundBootstrap = async () => {
    await ensureOmniRouteVersion();
    await startLocalOmniRoute();
  };
  if (mainWindow) {
    mainWindow.webContents.once("did-finish-load", () => {
      // 600ms buffer: covers React mount + useEffect registration of app:toast.
      setTimeout(runBackgroundBootstrap, 600);
    });
  } else {
    runBackgroundBootstrap();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Push a toast to the renderer UI. Used for background events the user should
// see (e.g. "Обновляю OmniRoute…") without polling state from the renderer side.
function emitAppToast(type, text) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.send("app:toast", { type, text }); }
  catch { /* renderer not ready, drop silently */ }
}

// Read the installed OmniRoute CLI version. Returns a semver string ("3.7.9")
// or null if not installed / not parseable. We run via shell because `omniroute`
// on Windows is a .cmd shim and execFile on a .cmd needs special handling.
async function getOmniRouteVersion() {
  try {
    const shell = process.platform === "win32" ? "cmd.exe" : "sh";
    const args  = process.platform === "win32"
      ? ["/d", "/s", "/c", "omniroute --version"]
      : ["-lc", "omniroute --version"];
    const { stdout } = await execFileAsync(shell, args, {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 256
    });
    const m = /(\d+\.\d+\.\d+)/.exec(stdout || "");
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// If a non-pinned OmniRoute is installed, replace it with REQUIRED_OMNIROUTE_VERSION.
// Best-effort: no-ops cleanly when omniroute isn't installed at all (the bootstrap
// modal will offer to install it). Emits toasts so the user sees what's happening.
async function ensureOmniRouteVersion() {
  await refreshPathFromRegistry();
  const current = await getOmniRouteVersion();
  if (!current) {
    // Not installed → leave for the bootstrap modal / setup wizard to handle.
    return { ok: false, reason: "not-installed" };
  }
  if (current === REQUIRED_OMNIROUTE_VERSION) {
    return { ok: true, changed: false, version: current };
  }

  appendLog(`OmniRoute version mismatch: installed=${current}, required=${REQUIRED_OMNIROUTE_VERSION}`);
  emitAppToast("info", `Обновляю OmniRoute ${current} → ${REQUIRED_OMNIROUTE_VERSION}…`);

  // npm can't overwrite files held by a running CLI on Windows. Stop the one we
  // started ourselves and best-effort kill anything else still holding the bin.
  if (omniRouteProcess) {
    try { omniRouteProcess.kill(); } catch { /* ignore */ }
    omniRouteProcess = null;
  }
  if (process.platform === "win32") {
    // omniroute v3 ships an .exe wrapper alongside the .cmd shim — kill that.
    await execFileAsync("taskkill.exe", ["/F", "/IM", "omniroute.exe", "/T"], { windowsHide: true })
      .catch(() => {});
  }
  // Brief pause to let Windows release the file handles.
  await new Promise((r) => setTimeout(r, 600));

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = await runShellCommand(npmCommand, [
    "install", "-g", `omniroute@${REQUIRED_OMNIROUTE_VERSION}`,
    "--legacy-peer-deps", "--no-fund", "--no-audit"
  ]);

  await refreshPathFromRegistry();
  const after = await getOmniRouteVersion();
  if (after === REQUIRED_OMNIROUTE_VERSION) {
    emitAppToast("success", `OmniRoute обновлён до ${REQUIRED_OMNIROUTE_VERSION}`);
    appendLog(`OmniRoute updated to ${after}`);
    return { ok: true, changed: true, before: current, after };
  }
  const hint = result.output ? result.output.slice(0, 300) : "";
  emitAppToast(
    "error",
    `Не удалось обновить OmniRoute (сейчас ${after || "?"}). Запустите вручную: npm install -g omniroute@${REQUIRED_OMNIROUTE_VERSION}`
  );
  appendLog(`OmniRoute update failed. now=${after} npm-output=${hint}`);
  return { ok: false, reason: "install-failed", before: current, after };
}

async function isLocalOmniRouteReady() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);

  try {
    const response = await fetch("http://localhost:20128/v1/models", {
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function startLocalOmniRoute() {
  if (await isLocalOmniRouteReady()) return;

  try {
    omniRouteProcess = spawn("omniroute", {
      detached: false,
      shell: true,
      stdio: "ignore",
      windowsHide: true
    });
    omniRouteProcess.unref();
  } catch (error) {
    console.warn("Failed to start OmniRoute:", error);
  }
}

async function commandExists(command) {
  const lookup = process.platform === "win32" ? "where" : "which";

  try {
    await execFileAsync(lookup, [command], {
      windowsHide: true,
      timeout: 4000
    });
    return true;
  } catch {
    return false;
  }
}

// Refresh PATH from registry so CLIs installed during this session (node, npm, omniroute,
// claude) become visible to subsequent child_process calls without restarting the app.
async function refreshPathFromRegistry() {
  if (process.platform !== "win32") return;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$m=[Environment]::GetEnvironmentVariable('Path','Machine');$u=[Environment]::GetEnvironmentVariable('Path','User');Write-Output ($m + ';' + $u)"
      ],
      { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 }
    );
    const fresh = (stdout || "").trim();
    if (fresh) {
      process.env.Path = fresh + ";" + (process.env.Path || "");
      process.env.PATH = process.env.Path;
    }
  } catch {
    // Best-effort; on failure keep existing PATH.
  }
}

async function runShellCommand(command, args = [], timeout = 300000) {
  const shell = process.platform === "win32" ? "powershell.exe" : "sh";
  const script =
    process.platform === "win32"
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", [command, ...args].join(" ")]
      : ["-lc", [command, ...args].join(" ")];

  try {
    const { stdout, stderr } = await execFileAsync(shell, script, {
      windowsHide: true,
      timeout,
      maxBuffer: 1024 * 1024 * 8
    });
    return { ok: true, output: `${stdout || ""}${stderr || ""}`.trim() };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout || ""}${error.stderr || error.message || ""}`.trim()
    };
  }
}

async function getBootstrapStatus() {
  const [localReady, nodeAvailable, npmAvailable, omniRouteAvailable] = await Promise.all([
    isLocalOmniRouteReady(),
    commandExists("node"),
    commandExists(process.platform === "win32" ? "npm.cmd" : "npm"),
    commandExists("omniroute")
  ]);

  return {
    localReady,
    nodeAvailable,
    npmAvailable,
    omniRouteAvailable
  };
}

function normalizeBaseUrl(baseUrl) {
  const clean = String(baseUrl || "http://localhost:20128/v1").replace(/\/+$/, "");
  return clean.endsWith("/v1") ? clean : `${clean}/v1`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text || response.statusText } };
  }
}

ipcMain.handle("omni:list-models", async (_event, settings) => {
  const baseUrl = normalizeBaseUrl(settings?.baseUrl);
  const headers = {};
  if (settings?.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const response = await fetch(`${baseUrl}/models`, { headers });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Models request failed: ${response.status}`);
  }

  return Array.isArray(payload?.data) ? payload.data : [];
});

ipcMain.handle("omni:chat", async (_event, request) => {
  const baseUrl = normalizeBaseUrl(request?.settings?.baseUrl);
  const headers = { "Content-Type": "application/json" };
  if (request?.settings?.apiKey) headers.Authorization = `Bearer ${request.settings.apiKey}`;

  const body = {
    model: request?.model || "auto",
    messages: request?.messages || [],
    temperature: Number(request?.temperature ?? 0.6),
    max_tokens: Number(request?.maxTokens ?? 1600),
    stream: false
  };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Chat request failed: ${response.status}`);
  }

  return payload;
});

ipcMain.handle("bootstrap:status", async () => getBootstrapStatus());

ipcMain.handle("bootstrap:start-omniroute", async () => {
  await startLocalOmniRoute();
  await new Promise((resolve) => setTimeout(resolve, 1600));
  return getBootstrapStatus();
});

ipcMain.handle("bootstrap:install-omniroute", async () => {
  await refreshPathFromRegistry();

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmAvailable = await commandExists(npmCommand);

  if (!npmAvailable) {
    throw new Error("npm не найден. Сначала установите Node.js LTS.");
  }

  // Pinned to 3.7.7 — 3.7.9 ships with a broken "Settings" launch button.
  // omniroute has a React peer-dep conflict (react@19 vs sub-deps wanting ^16-18).
  // --legacy-peer-deps lets npm proceed instead of failing on ERESOLVE.
  const result = await runShellCommand(npmCommand, [
    "install",
    "-g",
    "omniroute@3.7.7",
    "--legacy-peer-deps",
    "--no-fund",
    "--no-audit"
  ]);

  await refreshPathFromRegistry();

  const installed = await commandExists("omniroute");
  if (!installed) {
    throw new Error(result.output || "Не удалось установить OmniRoute через npm.");
  }

  await startLocalOmniRoute();
  await new Promise((resolve) => setTimeout(resolve, 1800));
  return { ...(await getBootstrapStatus()), output: result.output };
});

ipcMain.handle("bootstrap:install-node", async () => {
  if (process.platform !== "win32") {
    throw new Error("Автоустановка Node.js сейчас настроена только для Windows через winget.");
  }

  if (!(await commandExists("winget"))) {
    throw new Error("winget не найден. Установите Node.js LTS вручную с nodejs.org.");
  }

  const result = await runShellCommand("winget", [
    "install",
    "--id",
    "OpenJS.NodeJS.LTS",
    "-e",
    "--source",
    "winget",
    "--accept-package-agreements",
    "--accept-source-agreements"
  ]);

  // winget may exit non-zero even on success (e.g. when package already installed).
  // Trust the actual presence of `node` on PATH instead of the exit code.
  await refreshPathFromRegistry();
  const nodeAvailable = await commandExists("node");

  if (!nodeAvailable) {
    throw new Error(result.output || "Не удалось установить Node.js через winget.");
  }

  return { ...(await getBootstrapStatus()), output: result.output };
});

// ── Claude Code launch ───────────────────────────────────────────────────────
// Opens a new terminal running `claude` with the env wired to the selected model
// via OmniRoute. ANTHROPIC_BASE_URL points Claude Code at OmniRoute's Anthropic-
// compatible endpoint; ANTHROPIC_MODEL forces the chosen model id.
// ── Custom window controls ──────────────────────────────────────────────────
// We dropped the native min/max/close overlay (frame: false above) and now
// render our own buttons in the top bar. These IPC channels back them.
ipcMain.on("window:minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.on("window:toggle-maximize", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("window:close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});
ipcMain.handle("window:is-maximized", () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle("claude:check", async () => {
  await refreshPathFromRegistry();
  const present = await commandExists(process.platform === "win32" ? "claude.cmd" : "claude")
    || await commandExists("claude");
  return { available: present };
});

ipcMain.handle("claude:launch", async (_event, payload) => {
  await refreshPathFromRegistry();

  const settings = payload?.settings || {};
  const model = payload?.model || settings.model || "auto";
  const baseUrl = String(settings.baseUrl || "http://localhost:20128/v1").replace(/\/+$/, "");
  // OmniRoute exposes both OpenAI- and Anthropic-format endpoints under the same host.
  // Claude Code expects the Anthropic root (no /v1 suffix).
  const anthropicBase = baseUrl.replace(/\/v1$/, "");
  const apiKey = settings.apiKey || "omniroute";

  const hasClaude = await commandExists(process.platform === "win32" ? "claude.cmd" : "claude");
  if (!hasClaude) {
    throw new Error(
      "Claude Code CLI не найден. Установите через 'npm install -g @anthropic-ai/claude-code', затем повторите."
    );
  }

  const childEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: anthropicBase,
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_MODEL: model
  };

  if (process.platform === "win32") {
    // `start "title" cmd.exe /K claude` — start consumes the first quoted arg as the window title.
    // The new cmd window inherits our augmented env, so claude sees ANTHROPIC_* set correctly.
    spawn(
      "cmd.exe",
      ["/c", "start", `Claude Code — ${model}`, "cmd.exe", "/K", "claude"],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        env: childEnv
      }
    ).unref();
  } else {
    spawn("claude", [], { detached: true, stdio: "ignore", env: childEnv }).unref();
  }

  return { ok: true, model, baseUrl: anthropicBase };
});
