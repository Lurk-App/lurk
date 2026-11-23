# Security

Lurk shows content from strangers – chat messages, titles, emotes – to everyone who uses it. We take
reports about vulnerabilities seriously.

## Reporting a vulnerability

Please **do not open a public issue.** Use GitHub's private reporting instead: on the repository
page, open **Security → Report a vulnerability**. Only the maintainers see the report.

Please include what an attacker could do, how to reproduce it, and the Lurk version and system.

We confirm a report within a week, keep you informed, and credit you in the release notes if you
wish.

## Supported versions

Until 1.0, only the latest preview version gets fixes.

## What Lurk does to stay safe

- The interface runs sandboxed, with context isolation and without Node.
- A strict Content-Security-Policy: scripts only from the app itself, no `eval`, no inline code.
- Text from outside is inserted as text, never as HTML (enforced by lint rules).
- The interface talks to the main process only through a small, typed bridge, and the main process
  answers only the app's own pages.
- The app never navigates away from itself and grants no permissions (camera, microphone,
  location) to pages. Web links open in the system browser, and only https links.
- Electron features Lurk does not use are switched off in the packaged app (fuses): running as
  Node, `NODE_OPTIONS`, the inspector, loading code from outside the app archive.
- No client certificate is ever sent.
- The ad blocker's network filter sees every request of the app before it reaches the network
  (the pages' and the main process's alike). Its filter lists live on your computer; none is
  downloaded. Your own filters are a text file in the data folder; Lurk reads them as uBlock
  syntax and never runs them as code.

## "Von Twitch übernehmen" (your Twitch follows)

Lurk never sees your Twitch password, and it keeps nothing of the sign-in.

- You sign in on twitch.tv in your own browser and confirm a code that Lurk shows. Lurk uses Twitch's
  device code flow with its own public client and asks only for the permission to read whom you
  follow (`user:read:follows`). If Twitch asks you for anything else, cancel.
- **Lurk never sends codes by message or email.** A code someone else sends you is not from your
  Lurk: do not confirm it.
- Only the main process holds the token, for the seconds of reading. It is never shown to the
  interface, logged or written to disk. Lurk's requests for the sign-in run in a separate session in
  memory, without cookies, and do not follow redirects.
- Right after reading – before anything is subscribed – Lurk revokes the sign-in at Twitch. It does
  so too when you close the window, start over or quit Lurk.
- The list of channels stays on your computer as your subscriptions. Lurk has no server.
- If Lurk ever still appears at twitch.tv → Settings → Connections (for example after you confirmed
  a code whose window you had already closed), disconnect it there.
- What Lurk cannot reach: the system's swap and crash dumps, and Chromium's shared caches outside a
  session.
