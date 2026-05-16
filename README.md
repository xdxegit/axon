# Axon

**A liquid-glass desktop workspace for OmniRoute-powered AI.**

Axon is a desktop AI client built for people who want one clean place to talk to every model available through OmniRoute. It wraps OmniRoute aggregators, local providers, cloud routes, and everyday chat workflows into a polished Windows app with a guided setup experience.

The project is currently in **beta**. The core experience works, but Axon is still moving fast: provider onboarding, installer reliability, UI polish, model workflows, and automation features are actively being improved.

## What Axon Does

Axon turns OmniRoute into a friendly desktop workspace:

- Browse and use all available text models exposed by your OmniRoute setup.
- Chat with neural networks from connected aggregators and providers.
- Switch models without rebuilding configs or touching terminal commands.
- Use local OmniRoute by default through an OpenAI-compatible endpoint.
- Keep chat history locally inside the app.
- Clear the visible chat when you want a fresh workspace.
- Clear only the model context when you want the next answer to forget previous messages.
- Configure endpoint, API key, model, temperature, max tokens, and system prompt.
- Use a modern liquid-glass UI with light and dark themes.
- Follow built-in onboarding for provider setup, including Kiro/AWS notes.

## Full Setup Wizard

Axon includes a visual setup wizard designed for a clean Windows machine. The goal is simple: install the boring infrastructure first, then launch Axon only when the local AI route is ready.

The full setup flow can install or prepare:

- **Node.js LTS**
- **npm**
- **OmniRoute CLI**
- **Claude Code CLI**
- **Axon desktop app**

The setup wizard checks what is already installed, skips completed steps, refreshes PATH when needed, and shows progress for each stage. It is built as a separate installer experience so first-time users do not have to guess which terminal command comes next.

## Why Axon

Most AI workflows become scattered quickly: one provider in the browser, another in a CLI, a local route in the background, keys in different places, models with different names, and no comfortable desktop surface.

Axon is meant to make that feel calm:

- one app;
- one model picker;
- one chat surface;
- one place to connect OmniRoute providers;
- one installer that prepares the local stack.

It is not trying to hide power users from the underlying tools. It is trying to make the first mile pleasant, and the daily workflow faster.

## OmniRoute-First

Axon is powered by OmniRoute and expects an OpenAI-compatible API:

```text
http://localhost:20128/v1
```

You can also point it at OmniRoute Cloud:

```text
https://cloud.omniroute.online/v1
```

Once OmniRoute exposes models through `/v1/models`, Axon can discover them and let you select one from the interface.

## Beta Roadmap

Planned improvements include:

- richer provider setup flows;
- better diagnostics for failed local installs;
- packaged icons and signed releases;
- streaming responses;
- attachments and image-capable model workflows;
- model favorites and presets;
- exportable chats;
- deeper OmniRoute provider management from inside Axon.

## For Developers

Development, build, packaging, and endpoint notes live in [docs.md](docs.md).

Quick start:

```powershell
npm.cmd install
npm.cmd start
```

Build the full setup wizard:

```powershell
npm.cmd run dist:setup
```

## Status

**Beta software.** Expect rough edges, fast iteration, and occasional installer quirks on clean Windows machines. The direction is clear: Axon is becoming a beautiful, practical desktop control room for OmniRoute-powered neural networks.
