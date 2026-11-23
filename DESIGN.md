# Design

Mode: **Operate**. Lurk is a tool for watching. Precision and restraint beat show. Each system keeps
its familiar patterns: menus, shortcuts (⌘ on macOS, Ctrl on Windows and Linux), title bars.

This file is the design system for macOS, Windows and Linux. It started from the native macOS app
(`lurk-macos`); where the two differ, this file wins for the cross-platform app. Sections marked
**planned** describe parts that are not built yet and follow the macOS app until they are.

## Scene → appearance

Evening, a computer in front of the TV chair or at the desk, one stream fills the screen. Light
around the picture would distract, so Lurk starts **dark**.

"Lurk anpassen" also offers light mode or following the system, three background tones (Graphit,
Neutral, Nachtblau) and seven accent presets or a custom accent. The video stage always stays dark.

## Colour (restrained)

Neutral graphite with a slight violet tint, plus one accent. Live red is reserved for live status.
All colours live in `src/shared/theme.ts` and reach the interface as CSS variables
(`src/renderer/src/theme/applyTheme.ts`). Pages use the variables only, never a literal colour.

| Token         | CSS variable                             | Graphit dark (light)                | Use                                   |
| ------------- | ---------------------------------------- | ----------------------------------- | ------------------------------------- |
| canvas        | `--canvas`                               | #121016 (#F6F5F9)                   | content background                    |
| sidebar       | `--sidebar`                              | = canvas                            | sidebar, set off by a hairline        |
| surface       | `--surface`                              | #1B1820 (#FFFFFF)                   | panels, chat, info strip, form groups |
| raised        | `--raised`                               | #24202B (#FFFFFF)                   | suggestion panel, popovers, pills     |
| hairline      | `--hairline`                             | white 8 % (black 9 %)               | dividers, borders                     |
| fieldFill     | `--field-fill`                           | white 6 % (black 5 %)               | fields, hover backgrounds             |
| quietFill     | `--quiet-fill`                           | white 14 % (black 10 %)             | "on" without accent                   |
| text          | `--text`                                 | #FFFFFF (#000000)                   | primary text                          |
| textSecondary | `--text-secondary`                       | #ABA4BA (#524B61)                   | secondary text                        |
| textTertiary  | `--text-tertiary`                        | #8C859B (#746D84)                   | small meta text                       |
| accent        | `--accent`                               | #9B6BFF (#7A45F0)                   | selection, primary buttons, focus     |
| live          | `--live`                                 | #FF3B5C                             | LIVE, recording, viewer dot           |
| destructive   | `--destructive`                          | #FF6B6B (#C8282E)                   | reset, delete – never live red        |
| online        | `--online`                               | #30D158 (#1E8E3E)                   | the chat's connected dot              |
| provider      | `--provider-twitch`, `-kick`, `-youtube` | #9146FF, #53FC18 (#2E8B10), #FF0033 | only the 6 px dot in a provider mark  |

- **Tints of the accent:** selection 20 % (`--accent-selected`), highlighted suggestion 28 %
  (`--accent-highlight`), focus ring and focused field border 80 % (`--accent-focus`).
- **Contrast, tested for every tone in light and dark** (`tests/theme.test.ts`): secondary text
  ≥ 7 : 1 and tertiary text ≥ 4.5 : 1 on the canvas and the sidebar; every accent preset ≥ 3 : 1 on
  the canvas and against white button text. A custom accent is darkened until white text on it
  reaches 3 : 1, and is 18 % darker still on light surfaces.
- **Sidebar (decided 2026-11-23):** the sidebar has the canvas colour and a hairline on its right
  edge. A tint like the macOS sidebar material pushed small text below the contrast rules above.

## Typography

- **Font:** the system's own (`system-ui`: SF Pro on macOS, Segoe UI on Windows, the desktop's font
  on Linux). SF Pro may not be shipped or used outside Apple systems.
- **Sizes:** page title 28 px bold, tracking −0.4; section 17 px semibold (count 15 px in
  `--text-tertiary`); body 13 px; callout 12 px (context lines, suggestion titles); caption 11 px
  (meta text – DESIGN.md of the macOS app asks for 11–12, so not the 10 pt of macOS captions);
  10 px only for badges and pills on pictures (LIVE, length, viewers, the live count).
- **Numbers:** always with tabular digits, formatted in the interface language.

## Icons

Lucide (ISC licence) instead of SF Symbols, which are licensed for Apple systems only. Icons are
decorative (hidden from screen readers) unless they are the only label of a control.

## Layout

- **Window:** sidebar | content. The sidebar is 260 px wide at first and can be dragged between
  230 and 340 px (also with the arrow keys on its edge). Window at most 1360 × 860 at first,
  never larger than the screen, at least 980 × 620.
- **Title bar:**
  - **macOS:** no title. The traffic lights sit inset in a 52 px row; the sidebar toggle sits
    beside them, the back button at the start of the content column.
  - **Windows and Linux:** the system's own title bar. The same row (40 px) sits below it with the
    sidebar toggle and the back button. The menu bar is hidden and shows with Alt.
- **Sidebar:** the search field at the top, then the navigation, then "Live aus deinen Abos",
  "Einstellungen" at the bottom above a hairline.
- **Page header:** title, one line of context and controls on the right (`PageHeader`). No
  toolbar items per page, so nothing collides with the search.
- **Spacing:** page edge 24 px (8 px above the header), 22 px between sections, grids of 14 px.
  The macOS app has no single spacing base; these are its named measures (`tokens.css`).
- **Radii:** 8 px rows and fields, 10 px cards and stages, 12 px floating panels, 16 px sheets,
  6 px bordered controls.

## Components

Built (stage 1, part 2):

- **Navigation:** a `<nav>` landmark with buttons; the selected one carries `aria-current="page"`.
  Rows are 30 px, radius 8, a 14 px icon in a 20 px box (`--text-secondary`, accent when
  selected), label 13 px (semibold when selected). Selected: `--accent-selected`; hover:
  `--field-fill`, 0.15 s. A second click on the selected row returns to its root.
- **Search field** (`SearchInput`, decided 2026-11-23: one shared piece): the sidebar search, the
  tag search of Entdecken and the history filter. `--field-fill`, hairline border, accent 80 % and
  an accent symbol while focused, radius 8, height 30 (in a page header 26 and radius 6, as the
  header's buttons); a mini spinner or a clear button at the end.
- **Suggestion panel** (`SuggestionPanel`, decided 2026-11-23: one shared piece): the floating
  panel under the sidebar search and the tag search; it fades in and out (0.18 s) and, faded out,
  leaves the accessibility tree.
- **Search:** a combobox in the sidebar on the shared search field. Suggestions open in a floating panel as a listbox:
  - The order is a pasted twitch.tv link first, then channels (exact match, subscribed, live by
    viewers, viewing time, followers), up to three categories, then "Alle Ergebnisse für „…“".
  - Twitch is asked after a 220 ms pause in typing; answers are cached per term.
  - ↑/↓ move the highlight with wrap-around, Return opens it (or "Alle Ergebnisse"), Esc clears,
    then leaves. ⌘F / Ctrl+F shows the sidebar and focuses the field.
- **Page pieces** (`src/renderer/src/components/`): `Page`, `PageHeader` (title as `<h1>`),
  `HeaderIconButton`, `SectionTitle` (`<h2>`), `EmptyState` (with an optional slot between its
  text and its buttons), `Intro` (a settings tab's first row and a small window's head: icon 20 in
  the accent, title `<h1>` 13 bold, text 12 secondary), `Avatar` (red ring while live), `BoxArt`,
  `FloatingPanel`, `Popover` (a floating panel at its button: below it, right edges aligned, 8
  apart, inside the window; a named `dialog`; Esc, a click outside or Tab past its edge close it),
  `Toast` (a short notice: a capsule on the floating surface with a symbol and the text, at most
  two lines, maybe one action; it rises in, goes after 6 s – 7 for an error – and is read out
  through a live region), `Spinner`, `Icon`. `.fade-toggle` fades a panel in and out (shown with `.is-visible`; hidden, it
  leaves the Tab order and takes no clicks): the suggestion panel, the player's control bar, the
  popover, the toast. `.message-area` centres a message in an area (the player's stage message, the import
  window's phases). `.switch` is the one switch (settings rows, the shield's popover).
- **Pages not built yet** show their header and an `EmptyState` ("Noch nicht da"). Channels,
  videos and clips offer "Auf twitch.tv öffnen" meanwhile.
- **Settings window** (decided 2026-11-23: its own window on all three systems): 600 × 560, tabs
  on top (`tablist`), one grouped form per tab: sections on `--surface`, radius 10, hairlines
  between rows, titles 13 px semibold in `--text-secondary`, explanations 11 px below their control.
  - **Anpassen:** appearance as a segmented radio group; seven round accent swatches (24 px, the
    selected with a ring and a check); "Eigene Farbe"; three tone previews (left light, right
    dark); "Auf Standard zurücksetzen …" with a system confirmation dialog. Every change applies
    at once in all windows.
  - **Replay & Werbung** (part 7c, `RotateCcw`, between Wiedergabe and Werbeblocker; replay joins
    in stage 2): "Werbepausen" with the switch "Bei Werbepausen auf einen anderen Abo-Kanal
    wechseln" and its note; "Rangfolge nach Sehzeit": the eight subscriptions watched longest, one
    row each – the place ("1.", 22 wide, right-aligned, secondary), the avatar 22 (red ring while
    live), the name, the watch time right ("unter 1 min", "12 min", "1 h 5 min", tabular,
    secondary); "Noch keine Sehzeit gesammelt …" while none has any; "Sehzeit zurücksetzen …"
    (destructive, off while nothing was counted) with a system confirmation. `.form-empty` is the
    line of a section without entries (here and in the blocker's log).
  - **Werbeblocker** (part 7a, between Replay & Werbung and Datenschutz): the intro, the switch and
    "Während der Werbung Clips des Kanals zeigen" (part 7b; off while the blocker is off),
    "Statistik" (values right, tabular, secondary; reset with a system confirmation),
    "Filterlisten" (the built-in list's rule count, its rules in a disclosure), "Eigene Filter" (a
    monospaced field, 120 high, "Übernehmen" / "Änderungen verwerfen", each problem with its line
    number), "Protokoll" (the newest 50 entries: a symbol, the detail and the rule in one line
    each, shortened in the middle, the time on the right; requests, removed segments, skipped
    breaks and breaks avoided through the second source).
  - Other tabs (Daten) arrive with their parts.
- **Menus:** translated. macOS: Lurk (Über, Einstellungen ⌘,, Lurk anpassen ⌥⌘,), Bearbeiten
  (Suchen ⌘F), Darstellung (Seitenleiste ⌃⌘S, Zurück ⌘[, Vollbild), Fenster. Windows and Linux:
  Datei (Einstellungen Ctrl+,, Lurk anpassen Ctrl+Alt+,, Beenden), Bearbeiten, Darstellung
  (Seitenleiste Ctrl+Shift+S, Zurück Alt+←, Aktualisieren, Vollbild), Hilfe. "Aktualisieren"
  (⌘R / Ctrl+R) reloads the list of the page in front, not the window; no developer tools.

- **Player** (stage 1, part 3): a black stage over the info strip; it stays dark in light mode
  (`.dark-scope`: every role takes its dark version; the stage's own values are the `--stage-*`
  tokens).
  - The browser's own video controls at the bottom take the place of AVKit's; their fullscreen and
    download buttons are off.
  - Lurk's bar at the top right, 14 px in: a translucent dark capsule with quality (the system's
    own menu: "Automatisch" and every variant), the chat switch (live), the ad blocker's shield,
    "…" (Link kopieren, Auf twitch.tv öffnen; live also "Bei Werbepausen Kanal wechseln" with a
    check mark, at once) and fullscreen. It shows on mouse movement and hides
    2.5 s later (0.8 s after the pointer leaves), never while one of its menus or the shield's
    popover is open.
  - Fullscreen is the cinema layout: no sidebar, no title-bar row, no info strip; the channel badge
    top left while the bar shows. Escape leaves it.
  - While ads are skipped (part 7b): a popular clip of the channel (with the player's own controls;
    volume and mute are the stream's), or the preview image dimmed with a spinner, and the banner "Vorab-Werbung wird übersprungen" / "Werbung ausgeblendet"
    bottom left (16 px in, 74 px up) with what plays meanwhile and the time left. A mid-roll is
    hidden from the moment playback reaches it; the stream then continues at the live edge.
  - The second source (part 7b): a second Twitch session of the channel; when it is ad-free
    while the first shows ads, the stream continues from it, with the toast "Werbepause umgangen –
    derselbe Stream läuft aus einer zweiten Quelle weiter" (bottom centre, 74 px up).
  - Info strip: avatar 42, title 15 semibold, channel and category as links, viewers and "live
    seit" (VODs: length, date, views). Offline: avatar 80, "ist gerade offline", "Vergangene
    Übertragungen ansehen". Failures: the shared empty state with "Erneut versuchen".
- **Chat** (part 4): 340 px beside the player (also in fullscreen), on `--surface` with a hairline
  on its left. Header "Chat", `#login` in `--text-tertiary` and the `--online` dot; rows 13 px with
  the name bold in the user's colour (lifted on dark, darkened on light); emotes of Twitch, BTTV,
  7TV and FFZ as 24 px images 7 px below the baseline, their name until loaded, still without
  animation or with reduced motion; paused while the pointer is over it or keyboard focus is in it
  (not after a mouse click), and the pill says which; footer "Nur lesen ·
  anonym, ohne Konto". The bar's chat button and "Wiedergabe → Chat anzeigen" (⇧⌘K) switch it.
- **Banners** bottom left (16 px in, 74 px up), 10 apart, top to bottom as on macOS: ads skipped,
  raid, the ad-break switch. The raid and the switch banner share `.action-banner` (the banner look
  with buttons).
- **Raid banner**: the group symbol in accent, the target's avatar, "Hierbleiben" and the prominent
  "Jetzt mitgehen" (`.button-primary`: accent fill, white label).
- **The ad-break switch** (part 7c, live only): during a break Lurk shows the subscribed channel
  watched longest that is ad-free live right now (three are read in the background) and comes back
  once the channel's last 20 s are ad-free. Order at a break: the second source, then the switch,
  then hiding. The banner: `ArrowLeftRight` 18 in accent, "Werbepause bei A – du siehst solange B"
  (13 semibold), "Automatisch zurück in ca. 23 s" (12, secondary), "Zurück" (back at once; Lurk
  then does not switch again in that break – unlike macOS, which switches again) and the prominent
  "Bei B bleiben" (B opens in the player). With no clear channel and nothing skipped: `Megaphone`,
  "Werbepause bei A", "Kein Abo-Kanal ist gerade werbefrei live · noch ca. 23 s", no buttons. Info
  strip, chat and history stay A's; only the picture changes.
- **Watch time**: 5 s for every 5 s the picture actually plays (the channel on screen; never a clip,
  a hidden break, a pause, a stall or a preview), live and videos; kept in library.json.
- **Settings "Wiedergabe"**: sections "Entdecken & Kategorien" (live preview), "Raids" and "Chat"
  with switches (label left, switch right, note below). An off switch has an edge in
  `--text-tertiary`, so its track stands out from the group.
- **List pages** (part 5a: Entdecken, Kategorien, a category, the search's "Alle Ergebnisse"):
  - Header controls: sort and language as a name with a button that opens a system menu (the
    macOS menu picker: "⇅ Sortierung [Viele Zuschauer ⌃⌄]"), then refresh. Filters are kept in
    settings.json; the language is shared by Entdecken and every category.
  - Filter bar under the header: the content type as a segmented radio group on the left; on
    Entdecken the tag search on the right (a combobox like the sidebar search, 210 px, suggestions
    from Twitch after 250 ms); a chosen tag becomes a capsule in `--accent-selected` with ×.
  - Stream grid: columns from 270 px, 14 px apart, rows 22 px apart. Category grid: from 140 px,
    rows 20 px apart. Channels in the search: from 300 px, 10 / 4 px apart.
  - Stream tile (a button, no card frame): 16 : 9 picture, radius 10; under the pointer the picture
    scales to 1.03, a shadow appears and a play symbol in a dark 46 px circle. LIVE badge top left
    (`--live`, white 10 px heavy, radius 4); viewers (person icon) bottom left and uptime bottom
    right as dark pills (white 10 px semibold, tabular, radius 5), 8 px from the edges. Below:
    avatar 32, title 13 px semibold on two lines (space kept), channel 12 px secondary, category
    12 px tertiary. Tooltip: the title. Right click: system menu "Ansehen", "Kanal öffnen",
    "Kategorie „…“ öffnen", "Link kopieren", "Auf twitch.tv öffnen".
  - Category tile: 3 : 4 box art with the same lift (no play symbol), name 13 px semibold on one
    line, viewers 12 px secondary. A category's page puts its box art (84 px, radius 8) beside the
    header.
  - Channel row: avatar 42 (red ring while live), name 13 px semibold with LIVE, the live line or
    followers 12 px secondary; padding 8, `--field-fill` under the pointer. A click plays a live
    channel and opens an offline one's page.
  - Loading: a spinner in a 240 px area; failure: the empty state "Laden fehlgeschlagen" with
    "Erneut versuchen"; empty: "Niemand live" / "Keine Kategorie passt zu dieser Auswahl.".
  - Live preview: after 0.65 s on a stream tile it plays the stream muted in a small variant
    (360p or the next above) under the badges and fades in once frames arrive; one at a time,
    stopped by leaving the tile or any page change. Off with the setting or reduced motion.
  - Going back shows the page as it was: the pages of the stack stay mounted, hidden; a player
    another page covers stops.
  - A failed refresh keeps the list, with the failure and "Erneut versuchen" above it until a load
    succeeds.
- **Channel page** (part 5b): avatar 84 (red ring while live) beside the shared page header
  (name, "… Follower · live", the description in up to 3 lines, 620 wide at most) and "Auf
  twitch.tv öffnen". While live a `--surface` card (radius 14 `--radius-banner`, 14 in): the
  picture (440 wide at most) with LIVE, title 17 semibold, the category as a link, viewers and
  uptime, "Jetzt ansehen" (large prominent button); offline the same card with "Offline · zuletzt
  live …". Below "Videos" with a segmented control (Vergangene Übertragungen, Highlights, Uploads)
  and the stream grid of video tiles. ⌘R / Ctrl+R reloads.
- **Video tile:** like the stream tile; the length as a pill bottom right, a progress strip (4 px,
  accent on dark, `--thumb-track`) once a position is remembered; "vor 3 Tagen · … Aufrufe ·
  Kategorie" below the two-line title.
- **History** (part 5b): grouped by day ("Heute", "Gestern", the date) with the count; rows with a
  112 × 63 picture (radius 8; live: the avatar), progress strip, title, "Kanal · Kategorie", LIVE
  (9 px heavy) or a film symbol with the time (11 px); "×" under the pointer or keyboard focus. The
  header has the filter field (200 wide) and the trash button with a system confirmation.
- **Subscriptions** (part 6a, no account): "Abonnieren" with a heart, prominent in the accent;
  "Abonniert" with a filled heart as a plain button (channel page head, the player's info strip);
  the heart alone at the end of a search result row; "Abonnieren / Abo beenden" in the right-click
  menus. The Abos page: live subscriptions as stream tiles, then "Offline" as channel rows (last
  live first), "Import/Export" as a system menu and the refresh button in the header; empty, two
  ways on ("Streams entdecken", "Abos importieren …"). Import and export use the system's file
  dialogs and tell the result in a system message.
- **Sidebar live section:** "Live aus deinen Abos" (caption semibold, tertiary) with at most 20
  rows: avatar 26, name, category, a red dot and the viewers; the row that plays in
  `--accent-selected`. "Abos" carries the number of live subscriptions as a red capsule.
- **Warnings** in a page use `--warning` (orange; readable on canvas and surface).
- **Notifications** (off by default): "… ist jetzt live", with title and category, when a
  subscribed channel goes live; Lurk asks every two minutes while it runs.
- **Dates** read in numbers, as the macOS app writes them: "vor 1 Tag", not "gestern".
- **Settings "Datenschutz"** (part 5b, a raised hand as its tab symbol): the intro row "Kein Konto, keine Cookies", "Speichern"
  (Wiedergabeverlauf speichern, Position in Videos merken) and "Löschen" (both destructive, off while
  there is nothing to delete).
- **Menus in pages** are the system's own (opened by the main process at the button), like the
  macOS app's.
- **"Von Twitch übernehmen"** (part 6b; first in the Abos page's "Import/Export" while Lurk's
  Twitch client id is set): its own window, 480 × 460, not resizable, the system's title bar. On
  top the `Intro` on `--surface` (padding 16, a `--hairline-soft` line below); below it, centred
  like the player's stage message, one phase at a time: preparing and reading (large spinner and a
  line), the code (`EmptyState` with the code in the monospaced font at 28 px bold, "Twitch im
  Browser öffnen" and "Code kopieren", a waiting line in caption tertiary), the question "Follows
  von @… übernehmen?" (Übernehmen / Abbrechen), done ("Fertig") and failed ("Erneut versuchen").
  Return is the default action of the question and of done. The sign-in runs in the user's
  browser (device code) – unlike the macOS app, which embeds twitch.tv's login.
- **The shield** (part 7a) sits in the player's bar after the chat switch: `ShieldHalf` in the
  accent while the ad blocker is on, `ShieldOff` in `--text-tertiary` while off; this stream's
  skipped breaks as a small accent capsule on it. It opens a dark `Popover` (340 wide): the
  shield, "Werbeblocker" with one line, the switch; a table "Dieser Stream" / "Insgesamt"
  (Werbepausen, Ausgeblendet, Gesperrte Anfragen); "Filter und Protokoll …" opens the tab. The
  switch restarts the stream in place – bar and popover stay.

Planned (follow the macOS app until built): provider switcher and marks, hiding, scheduled tiles, the genre search on Kategorien and the
tag search on a category's page, the rest of the player bar (replay, clip, recording),
replay, logo and launch splash, onboarding, first-steps card, clip
tiles and player, "Für dich" and "Clip-Feed", multiview, "Dein Geschmack", sidebar
recommendations, clip download.

## Motion

- Hover 0.15 s ease-out (`--hover`), overlays and the suggestion panel fade in 0.18 s
  (`--fade`), the "Für dich" push 0.35 s (`--push`, planned).
- With "reduce motion" (`prefers-reduced-motion`), hover changes are instant and fades shorter.
- Nothing moves without a reason.
