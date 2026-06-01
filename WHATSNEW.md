# What's new in Axon 2.0.0-beta

A major visual + platform release. Axon gets a full redesign with switchable interface styles, color palettes and layouts; a configurable command-bar workspace; real multi-chat sessions; first-class Windows / macOS / Linux support with CI; a hardening security pass; and a redesigned cross-platform installer, **Axon Glow**.

This release is still beta — feedback and bug reports are welcome.

---

## Highlights

- **Two interface styles, six palettes.** Pick **Aurora Glass** (dense liquid glass) or **Spotlight** (soft warm floating panels) in Settings. Each style ships 3 color gammas — Aurora: Бирюза / Фиолет / Лазурь, Spotlight: Янтарь / Роза / Небо — every one with a dark and light theme. The whole UI is driven by CSS custom properties, so recoloring is instant.
- **Three switchable layouts.** *Классический* (single sidebar), *Классический + список чатов* (adds a sessions column), and *Command Bar* (icon rail + chat list + chat + routing/cost inspector). All adapt to the chosen style and palette.
- **Configurable Command Bar.** Toggle the **chat-list**, **routing** and **cost** panels independently from Settings.
- **Real chat sessions.** New multi-session store with a searchable chat list — create, switch, rename (auto from first message) and delete chats. Legacy single-thread state is migrated automatically.
- **Cross-platform.** Platform-aware window chrome (native traffic lights on macOS, custom controls on Windows/Linux), responsive layout for any screen size, and `electron-builder` targets for Windows (NSIS), macOS (dmg/zip, x64 + arm64) and Linux (AppImage / deb / rpm / tar.gz).
- **GitHub Actions CI/CD.** `ci.yml` builds and headlessly boot-tests the app on all three OSes for every push; `release.yml` builds installers per OS and attaches them to a GitHub Release on tag.
- **Axon Glow installer.** The setup wizard was redesigned (a shimmering iridescent light), renamed from *Axon Setup* to **Axon Glow**, made cross-platform, and clean removal of a previous Axon version now runs on all three OSes.
- **Security hardening.** CSP added, model ids validated before any process launch, `openExternal`/navigation locked to http(s), and a documented review of the IPC surface.

---

## Appearance system

Settings → **Интерфейс** now controls:

| Control | Options |
| --- | --- |
| Стиль | Aurora Glass · Spotlight |
| Цветовая гамма | 3 per style (live swatches) |
| Тема | Тёмная · Светлая |
| Раскладка | Классический · Классический + список чатов · Command Bar |
| Панели Command Bar | Список чатов · Маршрутизация · Стоимость (independent toggles) |

Palettes are defined in `src/theme.js` as a flat set of CSS variables applied to `<html>`; structural style differences (dense glass vs floating cards) come from `[data-ui-style]` rules in `src/styles.css` + `src/appearance.css`.

---

## Cross-platform & CI

- **Window chrome** is platform-aware: macOS keeps native traffic lights (`hiddenInset`), Windows/Linux are frameless with custom min/max/close controls. The window paints only when ready (no white flash) and auto-maximizes on small displays.
- **Responsive layout**: auxiliary columns shrink then hide on narrow windows, the settings drawer becomes an overlay rather than squeezing the chat, and `prefers-reduced-motion` is honored.
- **Build matrix**: run `npm run dist:auto` to build for the host OS, or let `.github/workflows/release.yml` build all three on tag push.
- **Boot smoke test**: `AXON_SMOKE=1` loads the built bundle, confirms the renderer paints, and exits — used by `.github/workflows/ci.yml` on Windows, macOS and Linux (via xvfb).

---

## Axon Glow (installer)

The standalone setup wizard is now **Axon Glow**:

- Redesigned UI — dark glass card with a rotating iridescent "светлечок" (conic-gradient ring + hue-shifting halo + travelling sheen on the logo, button and progress bar).
- Cross-platform: Windows runs the bundled NSIS flow; macOS installs the bundled `.dmg` into `~/Applications`; Linux installs the bundled `.deb` (`pkexec apt-get`/`dpkg`) or stages the `.AppImage`.
- **Old-version removal on every OS** — Windows kills running Axon/OmniRoute, runs the previous uninstaller and force-cleans the directory; macOS quits and removes the old `Axon.app`; Linux upgrades in place via the package manager.

---

## Security hardening

- **Content-Security-Policy** added to the renderer — no remote script origins, so an XSS that slips past React's escaping still can't pull remote code into the `omni`/`winctl` bridges.
- **Model-id validation** (`assertSafeModel`) before Claude Code launch — model ids from the free-text field *and* the OmniRoute `/v1/models` response are constrained to a safe charset, blocking shell-metacharacter injection. The window title is now static (the model is passed only via env).
- **External links / navigation** restricted to `http(s)`; stray navigations can't replace the app frame.

---

# What's new in Axon 1.1.1-beta

The first beta after 1.0.3-beta. It pulls together a long list of small reliability fixes, a brand-new attachment workflow, automatic OmniRoute version management, and the groundwork for cross-platform builds.

This release is still beta — feedback and bug reports are welcome.

---

## Highlights

- **Attach DOCX and images directly in the chat.** Paperclip, Ctrl+V paste (screenshots from Win+Shift+S or Snipping Tool), and drag-and-drop on the composer.
- **OmniRoute is auto-managed.** Axon now pins to OmniRoute `3.7.7` and silently downgrades broken installs (3.7.9 ships with a broken Settings button) the next time you launch the app.
- **First-run welcome with nickname.** Axon asks how you'd like to be addressed and adds your name to the system prompt so models call you by it.
- **Toasts replace the overflowing status pill.** Background errors, OmniRoute auto-updates, and Claude Code launch results show up as dismissable notifications in the bottom-right corner.
- **Cross-platform release set.** Isolated Linux and macOS build commands (`dist:cross:linux`, `dist:cross:mac`) write into `releases-cross/<version>/`, separate from the Windows installer flow.

---

## Attachments

| Type | Limit | How it's sent |
| --- | --- | --- |
| Images (PNG / JPG / GIF / WebP / BMP / SVG) | 4 MB per file | Re-encoded to **JPEG q=0.85** via canvas, max 1600 px on the long edge, white background for transparent PNGs. Sent as OpenAI vision `image_url` with `detail: "auto"`. |
| DOCX | 25 MB per file, 120 000 characters extracted | Extracted to plain text with **mammoth** and inlined into the user message as `--- Прикреплённый документ: <name> --- … --- Конец документа ---` blocks. |

How to attach:

- **Paperclip button** to the left of the textarea opens a multi-file picker accepting `.docx, image/*`.
- **Ctrl+V** while focused on the textarea — drops in any image from the clipboard (great for screenshots).
- **Drag-and-drop** files onto the composer; a teal "Отпустите, чтобы прикрепить" overlay confirms the drop zone.
- Attached files appear as chips above the textarea. Click the X to remove one. They render as thumbnails / file chips inside the message bubble after sending.

Pre-flight check: if you attach an image but the selected model id doesn't look vision-capable (e.g. `-mini`, `-nano`, `o1/o3`, `gpt-3.5`, embedding models), a hint toast suggests switching to Claude / GPT-4o / Gemini / Grok Vision. The send still goes through — it's a warning, not a block.

---

## OmniRoute version pinning

OmniRoute is pinned to `3.7.7`. 3.7.9 ships with a broken "Settings" launch button which made provider onboarding impossible.

The pin is enforced in three places:

- **In-app bootstrap** (`electron/main.js`) — runs `npm install -g omniroute@3.7.7 --legacy-peer-deps` from the missing-OmniRoute modal.
- **Setup Wizard** (`installer/main.js`) — same pinned install during initial setup.
- **NSIS macro** (`build/installer.nsh`) — same pin for the prerequisite checks baked into the standalone NSIS installer.

**Auto-downgrade at startup.** When Axon starts, it reads `omniroute --version`. If you have anything other than 3.7.7 installed, you'll see a toast `Обновляю OmniRoute 3.7.9 → 3.7.7…`, the app kills any running OmniRoute (including raw `node omniroute` invocations via WMIC), reinstalls 3.7.7, and notifies `OmniRoute обновлён до 3.7.7`. No npm knowledge required.

---

## First-run welcome

A new welcome modal asks for a nickname on first launch. The value is stored in `localStorage["axon:nickname"]` and injected into the system prompt of every chat as `Имя пользователя: <name>. Обращайся к нему по имени.`

The textarea placeholder becomes personal too: `<name>, напишите запрос к модели…`.

You can change or clear the nickname later from the About modal.

---

## Toasts

A new toast system stacks dismissable notifications in the bottom-right of the window:

- **Errors** (red) — IPC failures, vision-failed-to-load hints, Claude Code missing CLI, etc. Auto-dismiss after 7 s.
- **Success** (teal) — Claude Code launched, OmniRoute updated. 4 s.
- **Info** (gray) — Non-vision-model warnings, background updates. 4 s.

Click anywhere on a toast to dismiss early.

The previous status pill at the top now stays focused on lightweight operational status (`Готово`, `Запрашиваю модели...`, `Модель думает...`) and isn't truncated by long error text anymore.

---

## Installer wizard reliability

The standalone `Axon-Setup-1.1.1-beta.exe` got a long list of reliability improvements after the 1.0.3-beta cycle exposed several edge cases.

- **Pre-install cleanup kills running Axon, OmniRoute (`omniroute.exe`), and stray `node omniroute` processes** via WMIC command-line filter before NSIS runs. Old-version files no longer block the overwrite.
- **The wizard never kills itself.** Earlier versions ran `taskkill /F /IM "Axon Setup.exe" /T` which took the wizard's entire process tree down mid-install. Now removed.
- **Install verified by mtime, not just file presence.** Reports success only when `Axon.exe` was actually replaced — stops the old "everything looks fine" → broken-binary scenarios.
- **NSIS `_?=` path is raw**, not JSON-escaped. The earlier `JSON.stringify(APP_INSTALL_DIR)` silently broke the uninstaller.
- **Visible-mode NSIS fallback.** If silent NSIS exits without writing `Axon.exe`, the wizard reruns it visibly so you see the actual error dialog instead of a mute failure.
- **NSIS macro now probes `http://localhost:20128/v1/models`** before launching OmniRoute, so the "already running, port in use" stutter is gone.
- **Live status with elapsed timer.** The installer footer shows `[1:34] Installing Axon — Installed 42.3 MB` while NSIS is unpacking, polling the install directory once per second.

Diagnostics:

- The wizard writes a detailed run log to `%TEMP%\axon-setup.log` and **inlines the last 30 lines of it directly into the failure dialog**. No more "see log file" when the file is hard to find under elevation.
- The main Axon app writes startup + chat events to `%APPDATA%\Axon\axon-main.log` plus dumps the most recent chat exchange to `last-chat-request.json` and `last-chat-response.json` (base64 image data is redacted to size+head for readability).

---

## App-side reliability and UX

- **No more white screen of death.** A `vite.config.js` with `base: "./"` makes asset paths relative, so the bundled `dist/index.html` resolves under Electron's `file://` scheme.
- **Custom window controls** (frameless window + min/max/close in the top bar) replace the native Windows overlay.
- **`Новый чат` button is now legible in dark mode** (white ink on teal instead of the prior near-black).
- **Pretty model names everywhere.** `kr/claude-opus-4.7` renders as `Claude Opus 4.7 (Kiro AI)` in the picker, sidebar, and About modal. Raw id is still kept as a tooltip and as a small monospace line under the pretty name in the picker.
- **Open Claude Code from the sidebar.** A new "Открыть в Claude Code" action spawns Claude Code CLI in a terminal with `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL` wired to your current OmniRoute settings. The button is disabled (with a tooltip) when the CLI isn't installed or when `auto` is selected.
- **Claude Code CLI is now part of the Setup Wizard.** A new dedicated step installs `@anthropic-ai/claude-code` globally if it isn't on PATH.
- **About modal** now includes the nickname field, the path to `%APPDATA%\Axon\` for log access, and an `Open logs folder` button.

---

## Cross-platform build set

A new isolated electron-builder config at `build/electron-builder.cross.json` produces Linux and macOS artifacts without touching the Windows `dist:setup` pipeline.

Targets:

- **Linux**: AppImage (x64), deb (x64), tar.gz (x64)
- **macOS**: DMG (x64 + arm64), ZIP (x64 + arm64)

All artifacts land in `releases-cross/<version>/`. The Windows wizard still owns `release-installer-<version>/`.

---

## Building for a GitHub release

The release artifacts go into three folders depending on target. None of them are committed — they're build outputs.

### 1. Windows — Setup Wizard (recommended for users)

```powershell
npm.cmd run dist:setup
```

What it does:

1. `vite build` → `dist/` (renderer bundle).
2. `electron-builder --win nsis --x64` → `release/Axon-x64.exe` (the NSIS installer of the Axon app itself).
3. `cd installer && npm install` (one-time per machine).
4. `installer/scripts/prebuild.ps1` cleans `release-installer-<version>/`.
5. `electron-builder --win portable --x64` (from `installer/`) → wraps the NSIS installer + the visual wizard into one portable EXE.

**Final artifact:** `release-installer-<version>/Axon-Setup-<version>.exe` (~185 MB). This is the file to attach to the GitHub release.

### 2. Windows — Standalone installer / portable

If you don't need the visual wizard around the install:

```powershell
npm.cmd run dist        # → release/Axon-x64.exe         (NSIS installer)
npm.cmd run portable    # → release/Axon-x64.exe         (portable)
```

### 3. Linux

Linux artifacts build reliably **only on Linux**:

```bash
npm install
npm run dist:cross:linux
```

Produces in `releases-cross/<version>/`:

- `Axon-<version>-linux-x64.AppImage`
- `Axon-<version>-linux-x64.deb`
- `Axon-<version>-linux-x64.tar.gz`

### 4. macOS

macOS DMG/ZIP build **must run on macOS** (signing + hdiutil are macOS-only):

```bash
npm install
npm run dist:cross:mac
```

Produces in `releases-cross/<version>/`:

- `Axon-<version>-mac-x64.dmg`, `Axon-<version>-mac-arm64.dmg`
- `Axon-<version>-mac-x64.zip`, `Axon-<version>-mac-arm64.zip`

### 5. Both cross-platform targets at once

```bash
npm run dist:cross
```

Convenient on macOS (it can build Linux too via Electron's downloader); on Linux it produces only the Linux targets without erroring out.

### 6. Publishing to GitHub Releases

1. Pick the artifacts you need from `release-installer-<version>/` and `releases-cross/<version>/`.
2. Recommended starter set for `v1.1.1-beta`:
   - `Axon-Setup-1.1.1-beta.exe` (Windows, full wizard)
   - `Axon-x64.exe` (Windows, plain NSIS — optional)
   - `Axon-1.1.1-beta-linux-x64.AppImage`
   - `Axon-1.1.1-beta-linux-x64.deb`
   - `Axon-1.1.1-beta-mac-arm64.dmg`
   - `Axon-1.1.1-beta-mac-x64.dmg`
3. Create the GitHub release:

   ```bash
   gh release create v1.1.1-beta \
     --prerelease \
     --title "Axon 1.1.1-beta" \
     --notes-file WHATSNEW.md \
     release-installer-1.1.1-beta/Axon-Setup-1.1.1-beta.exe \
     releases-cross/1.1.1-beta/Axon-1.1.1-beta-linux-x64.AppImage \
     releases-cross/1.1.1-beta/Axon-1.1.1-beta-linux-x64.deb \
     releases-cross/1.1.1-beta/Axon-1.1.1-beta-mac-arm64.dmg \
     releases-cross/1.1.1-beta/Axon-1.1.1-beta-mac-x64.dmg
   ```

   Or upload them manually via the GitHub web UI under *Releases → Draft a new release → Attach files*.

---

## Known limitations

- **Vision through OmniRoute → Anthropic backends is unreliable.** Image bytes reach Claude (token usage proves it), but the MIME wrapper sometimes arrives malformed and the model responds "I can't see the image." 1.1.1-beta works around this by always re-encoding images to JPEG via canvas (PNGs are the worst affected). If a model still says it can't see your image, switch to `openai/gpt-4o`, `gemini-2.5-pro`, or another non-Anthropic vision model.
- **Local-only OmniRoute by default.** Cloud OmniRoute works once `baseUrl` is changed in Settings, but the in-app bootstrap and Setup Wizard assume local install at `http://localhost:20128/v1`.
- **The cross-platform builds are not yet covered by an installer wizard.** Linux/macOS users currently need Node.js + OmniRoute CLI + Claude Code CLI installed manually before launching the app.

---

## Diagnostics — where to find the logs

If anything goes wrong, these files explain why:

| File | Path |
| --- | --- |
| App startup, IPC errors, chat summaries | `%APPDATA%\Axon\axon-main.log` |
| Last chat request (image data redacted) | `%APPDATA%\Axon\last-chat-request.json` |
| Last chat response | `%APPDATA%\Axon\last-chat-response.json` |
| Setup Wizard trace | `%TEMP%\axon-setup.log` |
| NSIS internal log (per install run) | `%TEMP%\axon-nsis-<timestamp>.log` |

Easiest path: **About modal → Open logs folder**.

---

## Credits

- Built on Electron, Vite, React 19, lucide-react.
- DOCX text extraction by [mammoth.js](https://github.com/mwilliamson/mammoth.js).
- OmniRoute Studio for the underlying model routing.
- Crafted by [xdxegit](https://github.com/xdxegit).
