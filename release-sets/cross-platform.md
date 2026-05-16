# Axon Cross-Platform Release Set

This is an isolated release set for Linux and macOS builds.

It intentionally does **not** modify the existing Windows `dist`, `portable`, or `dist:setup` flows used for the current beta release.

## Build Commands

Linux artifacts:

```powershell
npm.cmd run dist:cross:linux
```

macOS artifacts:

```powershell
npm.cmd run dist:cross:mac
```

Both targets:

```powershell
npm.cmd run dist:cross
```

Artifacts are written to:

```text
releases-cross/<version>/
```

## Platform Notes

- macOS DMG/ZIP builds should be produced on macOS for reliable results.
- Linux AppImage/DEB/TAR builds should be produced on Linux for reliable results.
- Windows can keep using the existing `dist:setup` path.
- The current full visual setup wizard is Windows-first. Cross-platform app packages are separated so the Windows 1.0.3-beta setup flow is not disturbed.

## Runtime Behavior

The Axon app itself is already mostly platform-neutral:

- it loads the same Electron/React interface;
- it uses the same local OmniRoute endpoint;
- it tries to start `omniroute` from the system PATH;
- it can connect to OmniRoute Cloud when configured.

On Linux/macOS, users should currently install Node.js, OmniRoute CLI, and Claude Code CLI through their system package manager or terminal before using the app.
