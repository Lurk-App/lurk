# Contributing to Lurk

Thank you for helping. This page covers setting up, the rules every change follows, and how a
change gets merged.

## Set up

You need Node.js 22.12 or newer (`.nvmrc` names the version CI uses).

```bash
npm ci
```

```bash
npm run dev
```

Electron downloads its own binary the first time it starts. To fetch it beforehand:

```bash
node node_modules/electron/install.js
```

## Before you open a pull request

```bash
npm run check
```

```bash
npm run tour
```

`check` runs types, lint, formatting and the offline tests. `tour` builds the app and clicks
through it; look at the screenshots in `tour/out/<system>/`.

CI runs the same on macOS, Windows and Linux. **A pull request is merged only when all three are
green.**

## Rules

### Code

- Code, comments, commit messages and contributor docs are in **English**. The interface and the
  website are in German and English.
- TypeScript with `strict` on. Prettier formats, ESLint checks; `npm run format` fixes formatting.
- Comments say _why_, not _what_.
- Logic that does not need Electron goes to `src/shared/` and gets a test in `tests/`.

### Security

Chat messages, titles, channel names and emotes come from strangers. One mistake reaches every
user, so these rules are not up for debate:

- **Text is inserted as text, never as HTML.** No `dangerouslySetInnerHTML`, `innerHTML` or
  `insertAdjacentHTML` – ESLint refuses them.
- The interface has **no Node access**: `sandbox` and `contextIsolation` stay on, and
  `nodeIntegration` stays off.
- The interface reaches the main process only through the typed bridge in `src/preload/`. A new
  capability is a new, narrow function in `src/shared/ipc.ts` – never a generic "send anything"
  channel.
- Requests to Twitch, Kick and YouTube run in the main process.
- No `eval`, no inline scripts. The Content-Security-Policy in `src/main/security.ts` blocks them.
  Loosening it needs a good reason in the pull request.

Found a vulnerability? Please do not open an issue – see [SECURITY.md](SECURITY.md).

### The services

Lurk is unofficial. To keep it that way without trouble:

- No code, logos or assets from Twitch, Kick or YouTube.
- Lurk never works around a login or an integrity check.
- YouTube's embedded player stays unchanged, including its ads – YouTube's rules for embedded
  players forbid changes.
- "Von Twitch übernehmen" uses Lurk's own public Twitch client id (`src/shared/twitchClient.ts`).
  **A fork registers its own** at dev.twitch.tv (client type Public): Twitch may suspend a client id
  that several apps share. Development builds take one from `LURK_TWITCH_CLIENT_ID`; the tour uses
  a made-up one and answers Twitch itself.

## Translations

Each language is a folder in `locales/` with the same files and keys as `locales/en/`.

To add a language:

1. Copy `locales/en/` to `locales/<code>/`, for example `locales/fr/`.
2. Translate the values. Keep the keys and the `{{placeholders}}`.
3. Register the files in `src/renderer/src/i18n.ts` (`resources`).
4. Run `npm test`: it checks that every language has the same keys.

## Reporting a change at Twitch, Kick or YouTube

When a service changes something and Lurk breaks (a stream no longer plays, the chat stays empty,
ads come through), use the issue form "A service changed something". Note the time and the
channel – these changes are often short-lived or regional.

## Pull requests

- One topic per pull request. Small is easier to review.
- Say what changes for the user, and how you checked it.
- Screenshots for anything you can see.
- Issues labelled `good first issue` are a good place to start.

By contributing, you agree that your contribution is licensed under GPL-3.0-or-later, like the
rest of Lurk.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
