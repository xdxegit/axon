# Axon Developer Notes

This file keeps the practical development and packaging notes that used to live in the main README.

## Run

```powershell
npm.cmd install
npm.cmd start
```

## Package to EXE

Portable app EXE:

```powershell
npm.cmd run portable
```

NSIS app installer:

```powershell
npm.cmd run dist
```

Full visual setup wizard:

```powershell
npm.cmd run dist:setup
```

Experimental cross-platform app release set:

```powershell
npm.cmd run dist:cross:linux
npm.cmd run dist:cross:mac
```

Build artifacts are created in `release/`, `release-installer-*`, or `releases/` depending on the packaging flow.
Cross-platform artifacts are created in `releases-cross/<version>/`.

## Runtime Bootstrap

The desktop app checks `http://localhost:20128/v1/models` on startup. If local OmniRoute is not already running, it starts the system `omniroute` command in the background.

If local setup is missing, the app shows a first-run setup modal:

- Checks Node.js, npm, OmniRoute CLI, and the local OmniRoute API.
- Installs Node.js LTS through `winget` when npm is unavailable.
- Installs OmniRoute through `npm install -g omniroute`.
- Starts the local `omniroute` command and rechecks the API.

The separate Axon Setup wizard performs a fuller bootstrap:

- Checks or installs Windows Package Manager.
- Checks or installs Node.js LTS.
- Checks npm availability.
- Installs OmniRoute CLI.
- Installs Claude Code CLI.
- Installs Axon itself.

## Endpoints

The app defaults to the local OmniRoute OpenAI-compatible API:

```text
http://localhost:20128/v1
```

For OmniRoute Cloud, set the endpoint in the app settings:

```text
https://cloud.omniroute.online/v1
```

## Current Technical Features

- Electron desktop shell with a React interface.
- Chat UI with local history in app storage.
- OmniRoute endpoint, API key, model, temperature, max tokens, and system prompt settings.
- Model refresh through `/v1/models`.
- Chat requests through `/v1/chat/completions`.
- Automatic replacement of `auto` with the first available text model from OmniRoute.
- Separate controls for clearing the visible chat and clearing only the model context.
- Light and dark liquid-glass themes with an in-app theme switcher.
- Provider onboarding guide, including Kiro/AWS sign-in notes.
