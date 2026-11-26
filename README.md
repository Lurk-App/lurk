# Lurk

Watch Twitch without an account and without tracking – on macOS, Windows and Linux.

[Deutsch](README.de.md)

> **Status: early development.** This repository is the cross-platform rewrite of Lurk. Version
> 0.9, the first preview, is being prepared: everything the native macOS app does – Twitch, Kick
> and YouTube, replay and clips, Multiview – on macOS, Windows and Linux. It is not ready for
> everyday use yet. Until version 1.0, the native macOS app remains the current version.

Lurk is an independent, unofficial project. It is not affiliated with or endorsed by Twitch,
Kick or YouTube.

## What Lurk is for

- **No account, no tracking.** Subscriptions, history and settings stay on your computer.
- **One stream in focus.** A large picture with the chat beside it, quality and fullscreen at hand.
- **A built-in blocker** for trackers and ads, with filter rules you can read and edit.
- **Later:** replay and clips, Kick and YouTube in the same window, several streams at once.

## Development

You need [Node.js](https://nodejs.org/) 22.12 or newer.

```bash
npm ci
```

```bash
npm run dev
```

| Command           | What it does                                                                        |
| ----------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`     | Starts the app with live reload.                                                    |
| `npm test`        | Offline tests (Vitest).                                                             |
| `npm run tour`    | Builds the app and clicks through it (Playwright), with screenshots in `tour/out/`. |
| `npm run check`   | Types, lint, formatting and tests – what CI runs first.                             |
| `npm run package` | Builds the installer for the system you are on, into `release/`.                    |

[CONTRIBUTING.md](CONTRIBUTING.md) explains the rest: how the project is laid out, the rules for
code and security, and how to add a language.

## Layout

```
src/shared/    logic without Electron: playlist parser, ad filter, models
src/main/      main process: window, the lurk:// origin, network, files
src/preload/   the narrow, typed bridge between interface and main process
src/renderer/  the interface (React)
locales/       translations, one folder per language
tests/         offline tests
tour/          the clicked-through tour with screenshots
build/         icons and installer settings
```

## License

[GPL-3.0-or-later](LICENSE). You may use, change and pass on Lurk; if you pass on a changed
version, its source must be open too.
