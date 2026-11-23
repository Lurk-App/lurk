# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop (Electron app for macOS, Windows and Linux)

## Users

People who watch Twitch on a computer and do not want an account or tracking for it. The interface
speaks German and English; more languages can come from the community. The main situation is
**one stream in focus**: a big picture with the chat beside it, often in fullscreen. Controls must
not get in the way of the picture.

## Product Purpose

Watch Twitch without an account and without tracking, like FreeTube does for YouTube.
Subscriptions, history, viewing time and clips stay on the user's computer. Success means opening a
stream, watching it undisturbed, replaying moments and keeping clips without ever logging in.

Lurk is open source (GPL-3.0-or-later) and free, so the community can keep improving it. It is an
independent, unofficial project, not affiliated with Twitch, Kick or YouTube.

## Positioning

- **Private by design:** no login, no cookies, no analytics. Everything stays local.
- **One app, three systems:** the same features on macOS, Windows and Linux.
- **Planned, as in the macOS app:** instant replay and local clips without re-encoding; ad-break
  switching to another subscribed channel; "Für dich" and "Clip-Feed"; schedules; Kick and YouTube
  in the same window; multiview; a built-in blocker that reads uBlock Origin filter syntax.

## Operating Context

- Mostly in the evening, often in fullscreen.
- Chat is read-only beside the stream.
- Switching channels happens through subscriptions, search and the live list.
- Clips will land as MP4 in the system's videos folder, subfolder `Lurk`.

## Capabilities and Constraints

- **Data:** settings in `settings.json`, lists as readable files, all in Lurk's data folder.
  Until 1.0 the app uses its own folder ("Lurk Preview"); on a Mac, 1.0 takes over the folder and
  settings of the native app.
- **Network:** requests to Twitch, Kick and YouTube run in the main process, never from the
  interface. Lurk plays only playlists it fetched itself (Twitch starts a new session, with its own
  ad schedule, on every fresh request).
- **No paging:** Twitch allows anonymous paging only with an integrity token. Lurk does not get
  around that.
- **Search:** suggestions come from Twitch's public search; a pasted twitch.tv link (channel,
  video, clip) opens directly.
- **Appearance:** dark by default; light and "like the system" are optional, as are the background
  tone and the accent. Contrast is tested for every tone in both modes.
- **Security:** text from outside (chat, titles, names) is only ever inserted as text. The
  interface runs sandboxed without Node, behind a strict Content-Security-Policy.
- **Not supported:** writing in chat, subscriber-only content, Twitch stories (shown to logged-in
  viewers only).
- The stages from here to 1.0 are in the plan that comes with the macOS app; this file grows with
  them.

## Brand Commitments

- Name **Lurk**; logo and app icon: a violet "L" with sunglasses peeking out of green grass on a
  dark violet ground (the founder's artwork).
- Interface in German and English, with clear verbs.
- No logos or assets of Twitch, Kick or YouTube.

## Evidence on Hand

- Feasibility measurements on macOS and Windows (stage 0 report, with the macOS app).
- There are no testimonials, user numbers or other claims; none may be invented.

## Product Principles

1. **The picture has priority.** Controls show up when you need them and get out of the way
   otherwise.
2. **Local and honest.** Every piece of data stays on the user's computer, and every limitation is
   stated openly in the app.
3. **One click to the stream.** Search, live list and subscriptions lead straight to the picture.
4. **Automatic only where it is predictable.** What runs by itself explains what it does, counts
   it, and can be switched off at any time.
5. **At home on every system.** Shortcuts, menus and title bars follow the system Lurk runs on.
