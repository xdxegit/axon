import { app, BrowserWindow, ipcMain, screen, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Smoke mode (CI): load the built bundle from disk, confirm the renderer paints,
// then exit deterministically — a cross-OS "does it boot?" check. Forces the
// production load path even though the app is unpackaged under `electron .`.
const isSmoke = process.env.AXON_SMOKE === "1";
const isDev = !app.isPackaged && !isSmoke;
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
    // Make sure the userData dir exists — Electron creates it lazily on first
    // use, and appendFileSync would fail if we ran before any other access.
    fs.mkdirSync(dir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(path.join(dir, "axon-main.log"), line, "utf8");
  } catch (err) {
    // logging must never crash the app — but at least surface it in the
    // attached DevTools console so we don't get another silent black hole.
    // eslint-disable-next-line no-console
    console.error("appendLog failed:", err);
  }
}

let mainWindow = null;

function createWindow() {
  const isMac = process.platform === "win32" ? false : process.platform === "darwin";

  // Window chrome differs per platform:
  //  • Windows / Linux — fully frameless; we draw our own min/max/close cluster.
  //  • macOS — keep the native traffic-light buttons (users expect them on the
  //    left) via `hiddenInset`; our custom cluster is hidden in the renderer and
  //    the top bar is padded so content clears the lights.
  const chrome = isMac
    ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 20 } }
    : { frame: false, titleBarStyle: "hidden" };

  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 880,
    minHeight: 600,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    backgroundColor: "#0f1117",
    show: false,
    ...chrome,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Avoid a white flash on slower machines / high-DPI displays: only paint once
  // the renderer is ready. Maximize on very small screens so the fixed-width
  // columns aren't cramped on, e.g., a 1366×768 laptop.
  win.once("ready-to-show", () => {
    try {
      const { workAreaSize } = screen.getPrimaryDisplay();
      if (workAreaSize.width <= 1366 || workAreaSize.height <= 800) win.maximize();
    } catch { /* screen API unavailable in headless CI — ignore */ }
    win.show();
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

  // Only ever hand http(s) URLs to the OS. Without this scheme allowlist a
  // window.open() with file:, javascript:, or a custom protocol handler could be
  // abused (e.g. via an XSS payload in a model response) to launch arbitrary
  // local handlers. Everything else is denied outright.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Lock the main frame to the app bundle / dev server. A stray navigation
  // (malicious link, redirect) must never replace the app with remote content,
  // which would run with the preload bridge attached.
  win.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev ? "http://127.0.0.1:5173" : "file://";
    if (!url.startsWith(allowed)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // ── Renderer diagnostics ───────────────────────────────────────────────────
  // White-screen-of-death almost always means the bundled JS failed to load.
  // Log every renderer failure so a packaged user can attach axon-main.log
  // (in %APPDATA%/Axon) when reporting a crash.
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    appendLog(`did-fail-load: ${code} ${desc} ${url}`);
    if (isSmoke && isMainFrame) {
      appendLog("SMOKE: main frame failed to load");
      app.exit(1);
    }
  });

  if (isSmoke) {
    // Pass once the renderer reports a finished paint; fail-safe timeout in case
    // it never does (e.g. a bundle that throws before mount on this platform).
    win.webContents.on("did-finish-load", () => {
      appendLog("SMOKE: renderer loaded OK");
      setTimeout(() => app.exit(0), 800);
    });
    setTimeout(() => { appendLog("SMOKE: timeout"); app.exit(1); }, 30000);
  }
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
  // Always seed the log file with a startup banner so the user has *something*
  // to look at when they open "Папка с логами" before sending any chat. Prior
  // versions only wrote on errors / chat events, leading to confused "а где?"
  // when the folder showed no .log/.json at all.
  appendLog(`=== Axon ${app.getVersion()} start === platform=${process.platform} isDev=${isDev} userData=${app.getPath("userData")}`);

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
  // Skip the OmniRoute install/start side-effects entirely in smoke mode — we're
  // only checking that the window boots, not provisioning the environment.
  if (isSmoke) return;

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

// Strip base64 data URIs out of a deep-cloned payload before logging. The result
// keeps the structure (so we can verify image_url parts WERE in the request) but
// drops the multi-MB blobs — the log file stays small enough to share.
function redactDataUris(node) {
  if (Array.isArray(node)) {
    node.forEach(redactDataUris);
  } else if (node && typeof node === "object") {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (k === "url" && typeof v === "string" && v.startsWith("data:")) {
        node[k] = `[data URI length=${v.length}, head=${v.slice(0, 64)}...]`;
      } else {
        redactDataUris(v);
      }
    }
  }
  return node;
}

// Dump the most recent chat exchange to %APPDATA%/Axon/last-chat-*.json so users
// can attach them when reporting bugs (e.g. "image came through as
// (unavailable)" — the dump shows whether our request actually contained
// image_url parts and what OmniRoute sent back).
function writeChatDump(name, payload) {
  try {
    const dir = app.getPath("userData");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    // structuredClone may not exist on older Electrons; fall back to JSON round-trip.
    const clone = typeof structuredClone === "function"
      ? structuredClone(payload)
      : JSON.parse(JSON.stringify(payload));
    fs.writeFileSync(file, JSON.stringify(redactDataUris(clone), null, 2), "utf8");
  } catch (e) {
    appendLog(`writeChatDump(${name}) failed: ${e.message}`);
  }
}

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

  // Count parts for the summary line in axon-main.log. Lets us quickly check
  // "did the image even reach main process" without parsing the full dump.
  let imagePartCount = 0;
  let textPartCount = 0;
  for (const m of body.messages) {
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part?.type === "image_url") imagePartCount++;
        else if (part?.type === "text") textPartCount++;
      }
    } else if (typeof m.content === "string") {
      textPartCount++;
    }
  }
  appendLog(`omni:chat → model=${body.model} messages=${body.messages.length} textParts=${textPartCount} imageParts=${imagePartCount}`);
  writeChatDump("last-chat-request.json", { url: `${baseUrl}/chat/completions`, body });

  const startedAt = Date.now();
  let response, payload;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    payload = await readJsonResponse(response);
  } catch (err) {
    appendLog(`omni:chat fetch error: ${err.message}`);
    writeChatDump("last-chat-response.json", { error: err.message, durationMs: Date.now() - startedAt });
    throw err;
  }

  appendLog(`omni:chat ← status=${response.status} durationMs=${Date.now() - startedAt}`);
  writeChatDump("last-chat-response.json", {
    status: response.status,
    statusText: response.statusText,
    durationMs: Date.now() - startedAt,
    body: payload
  });

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Chat request failed: ${response.status}`);
  }

  return payload;
});

// Opens %APPDATA%/Axon in Explorer so the user can grab axon-main.log,
// last-chat-request.json, last-chat-response.json for bug reports.
ipcMain.handle("logs:open", async () => {
  try {
    const dir = app.getPath("userData");
    await shell.openPath(dir);
    return { ok: true, path: dir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Just returns the userData path so the renderer can render it next to the
// "Open logs folder" button. Lets users copy it into a file manager directly.
ipcMain.handle("logs:path", async () => {
  try { return { ok: true, path: app.getPath("userData") }; }
  catch (err) { return { ok: false, error: err.message }; }
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

// Model ids reach us from the renderer's free-text "Модель" field AND from the
// OmniRoute /v1/models response — neither is trustworthy. Before a model id is
// allowed anywhere near a spawned process (env or, historically, a cmd title) we
// constrain it to the characters real OmniRoute ids actually use. This blocks
// shell-metacharacter injection (e.g. a hostile endpoint returning `x" & calc`).
const MODEL_ID_RE = /^[A-Za-z0-9._:\/-]{1,128}$/;
function assertSafeModel(model) {
  if (!MODEL_ID_RE.test(model)) {
    throw new Error("Недопустимый идентификатор модели — отменено в целях безопасности.");
  }
  return model;
}

ipcMain.handle("claude:launch", async (_event, payload) => {
  await refreshPathFromRegistry();

  const settings = payload?.settings || {};
  const model = assertSafeModel(payload?.model || settings.model || "auto");
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
    // `start "title" cmd.exe /K claude` — start consumes the first quoted arg as
    // the window title. The title is a STATIC string on purpose: never splice the
    // model id (or any renderer-supplied value) into the cmd command line, where
    // cmd.exe's own re-parsing of quotes/`&`/`|` makes injection hard to escape.
    // The model is passed safely via the child env (ANTHROPIC_MODEL) instead.
    spawn(
      "cmd.exe",
      ["/c", "start", "Claude Code", "cmd.exe", "/K", "claude"],
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
