# OmniRoute Studio

Desktop GUI for working with neural networks connected through an OmniRoute account.

## Run

```powershell
npm.cmd install
npm.cmd start
```

## Package to EXE

Portable EXE:

```powershell
npm.cmd run portable
```

Installer EXE:

```powershell
npm.cmd run dist
```

Build artifacts are created in `release/`.

The NSIS installer includes a bootstrap step before the finish page:

- Checks for Node.js.
- Installs Node.js LTS through `winget` when Node.js is missing.
- Checks for npm.
- Installs OmniRoute CLI through `npm install -g omniroute` when the CLI is missing.
- Starts local OmniRoute before the app is launched from the finish page.

When the desktop app starts, it checks `http://localhost:20128/v1/models`. If local OmniRoute is not already running, it starts the system `omniroute` command in the background.

If local setup is missing, the app shows a first-run setup modal:

- Checks Node.js, npm, OmniRoute CLI, and the local OmniRoute API.
- Installs Node.js LTS through `winget` when npm is unavailable.
- Installs OmniRoute through `npm install -g omniroute`.
- Starts the local `omniroute` command and rechecks the API.

The app defaults to the local OmniRoute OpenAI-compatible API:

```text
http://localhost:20128/v1
```

For OmniRoute Cloud, set the endpoint in the app settings:

```text
https://cloud.omniroute.online/v1
```

## Current Features

- Electron desktop shell with a React interface.
- Chat UI with local history in app storage.
- OmniRoute endpoint, API key, model, temperature, max tokens, and system prompt settings.
- Model refresh through `/v1/models`.
- Chat requests through `/v1/chat/completions`.
- Automatic replacement of `auto` with the first available text model from OmniRoute.
- Separate controls for clearing the visible chat and clearing only the model context.
- Light and dark liquid-glass themes with an in-app theme switcher.
- NSIS installer bootstrap for Node.js, npm, and OmniRoute CLI.
- Provider onboarding guide, including Kiro/AWS sign-in notes.
