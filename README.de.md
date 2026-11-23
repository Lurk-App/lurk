# Lurk

Twitch schauen ohne Konto und ohne Tracking – auf macOS, Windows und Linux.

[English](README.md)

> **Stand: frühe Entwicklung.** Dieses Repository ist die Neufassung von Lurk für alle drei
> Systeme. Version 0.1, die erste Vorschau, entsteht gerade: Twitch entdecken, der Player mit
> Chat, Abos, Verlauf und der Werbeblocker. Sie ist noch nicht für den Alltag gedacht. Bis
> Version 1.0 bleibt die native Mac-App die aktuelle Fassung.

Lurk ist ein unabhängiges, inoffizielles Projekt. Es gehört nicht zu Twitch, Kick oder YouTube
und wird von ihnen nicht unterstützt.

## Wofür Lurk da ist

- **Kein Konto, kein Tracking.** Abos, Verlauf und Einstellungen bleiben auf deinem Rechner.
- **Ein Stream im Mittelpunkt.** Großes Bild, der Chat daneben, Qualität und Vollbild griffbereit.
- **Ein eingebauter Blocker** für Tracker und Werbung, mit Filterregeln, die du lesen und ändern
  kannst.
- **Später:** Replay und Clips, Kick und YouTube im selben Fenster, mehrere Streams gleichzeitig.

## Entwicklung

Nötig ist [Node.js](https://nodejs.org/) 22.12 oder neuer.

```bash
npm ci
```

```bash
npm run dev
```

| Befehl            | Was er tut                                                                      |
| ----------------- | ------------------------------------------------------------------------------- |
| `npm run dev`     | Startet die App, Änderungen erscheinen sofort.                                  |
| `npm test`        | Prüfungen ohne Netz (Vitest).                                                   |
| `npm run tour`    | Baut die App und klickt sie durch (Playwright), Bildschirmfotos in `tour/out/`. |
| `npm run check`   | Typen, Lint, Formatierung und Prüfungen – das, was die CI zuerst prüft.         |
| `npm run package` | Baut das Installationspaket für das System, auf dem du bist, nach `release/`.   |

Code, Kommentare und die Doku für Mitwirkende sind englisch, damit alle mitarbeiten können. Alles
Weitere steht in [CONTRIBUTING.md](CONTRIBUTING.md).

## Lizenz

[GPL-3.0-or-later](LICENSE). Du darfst Lurk nutzen, ändern und weitergeben. Wer eine veränderte
Fassung weitergibt, muss deren Quellcode ebenfalls offenlegen.
