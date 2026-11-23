# Changelog

All notable changes to Lurk are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Foundation of the cross-platform app: Electron with React and TypeScript, served from its own
  `lurk://app` origin.
- Security baseline: sandboxed interface without Node, strict Content-Security-Policy, a typed
  bridge that answers only the app's own pages, no navigation away from the app, Electron fuses.
- German and English translations.
- The playlist parser, ad filter and pre-roll wait, ported from the macOS app with its test cases.
- Checks on macOS, Windows and Linux for every pull request, with a clicked-through tour and
  screenshots.
- The main window: sidebar with search, navigation and settings, page header, title bar per
  system (macOS inset, Windows and Linux with the system's own).
- Search with suggestions from Twitch while typing, keyboard control, and pasted twitch.tv links.
- Appearance: dark, light or like the system, three background tones, seven accent colours or a
  custom one, with a contrast test for every combination.
- The settings window with the tab "Anpassen"; settings are kept in settings.json.
- Translated menus for macOS, Windows and Linux.
- DESIGN.md and PRODUCT.md for all three systems.
- The player for live streams and past broadcasts (VODs): hls.js with Twitch's playlists through
  the main process, the playlist ad filter and the pre-roll wait from the macOS app; quality menu,
  cinema-style fullscreen, info strip, offline and failure views; volume and mute remembered.
- Search opens live channels in the player and plays pasted twitch.tv video links.
- Twitch chat beside the player, anonymous and read-only, with emotes of Twitch, BTTV, 7TV and FFZ;
  switched in the bar, the menu "Wiedergabe" and the settings.
- Raids: a banner while the channel prepares one, and the player goes along when it starts.
- The settings tab "Wiedergabe" (raids and chat).
- Entdecken: live streams by content type (Alle, Spiele, IRL, Musik, Kreativ, E-Sport), sort,
  language and one tag, as tiles with LIVE badge, viewers and uptime.
- Kategorien and a category's page with its live streams; the search's "Alle Ergebnisse" page with
  categories and channels.
- Live preview: a stream tile plays muted after a moment under the pointer (switch in
  "Wiedergabe", off with reduced motion).
- Right-click menus on tiles and channel rows; "Darstellung → Aktualisieren" (⌘R / Ctrl+R).
- Going back shows a list page as it was left.
- A channel's page with its live stream or last broadcast and its videos (past broadcasts,
  highlights, uploads).
- History, grouped by day, with filter and removal; videos continue where they were left, with a
  progress strip on their tiles.
- The settings tab "Datenschutz": keep the history and the positions in videos, or delete them.
- Subscriptions without an account: subscribe on a channel page, in the player, in the search and in
  right-click menus; the Abos page with live and offline channels; "Live aus deinen Abos" and the
  live count in the sidebar; import and export as JSON or text list; notifications when a
  subscribed channel goes live.
- "Von Twitch übernehmen": subscribe to the channels you follow on Twitch. You confirm a code in your
  own browser; Lurk reads only whom you follow, ends the sign-in at Twitch at once and asks before it
  subscribes.
- "Fenster schließen" (⌘W / Ctrl+W) in the menu.
- The ad blocker as on macOS, modelled on uBlock Origin: filters in uBlock syntax (servers,
  exceptions, `$important`, request types, `m3u-prune` for playlists), a network filter for every
  request of the app, own filters, statistics and a log; the settings tab "Werbeblocker" and a
  shield in the player with a popover. Switched off, Lurk asks Twitch for the same session as
  twitch.tv and filters nothing.
- Ad breaks while watching: a mid-roll is hidden from the moment playback reaches it, with the
  time left, and the stream goes on at the live edge; a popular clip of the channel plays instead
  of a waiting picture (switch in "Werbeblocker"); when a second Twitch session of the channel is
  ad-free, the stream simply goes on from there, with a short notice.
- The ad-break switch: Lurk counts how long you watch each channel; during a break it shows the
  subscribed channel you watched longest that is ad-free live right now and comes back by itself,
  with "Zurück" and "Bei B bleiben" in a banner; a switch in the player's "…" menu and the settings
  tab "Replay & Werbung" with the ranking by watch time and its reset.

### Changed

- Meta text is 11 px everywhere (the sidebar's live section and the history's time line were 10);
  10 px stays for badges and pills on pictures.

### Fixed

- Videos (VODs) did not play: the ad filter took their untitled segments for ads and kept only a
  live window, and Twitch's video CDN refuses the app's origin. Videos now pass unfiltered, their
  segments come through the main process, and they start at the beginning.
