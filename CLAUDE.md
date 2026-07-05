# PY.QUEST Desktop

## Ziel
Interaktive Python-Lern-App als natives macOS-Programm (Electron, `.dmg`). Nutzer lernt
Python in nummerierten **Teilen** über einen Lernpfad aus Lektionen. Kernphilosophie:
**Selber bauen schlägt Quiz.** Herzstück ist ein echtes Python-Terminal (Pyodide/WASM) —
kein simulierter Code, echte Ausführung, echte Tracebacks.

Vollständige Spezifikation: [MASTERPROMPT_PYQUEST.md](MASTERPROMPT_PYQUEST.md). Bei
Zielkonflikten gilt: **Offline-Fähigkeit > echte Python-Semantik > Design > alles andere.**

## Harte Anforderungen
- 100% offline zur Laufzeit: kein CDN, kein Netzwerk-Request. Alles lokal gebündelt.
- Ein Download (`npm run dist` → `.dmg`), dann für immer nutzbar.
- Erweiterbar ohne Kern-Änderung: neuer Teil = neue Datei in `app/content/` + Registry-Eintrag.
- Fortschritt übersteht App-Neustarts (JSON in `app.getPath("userData")`).

## Architektur

```
pyquest/
├── electron/main.js       # BrowserWindow, IPC (loadProgress/saveProgress/getAppVersion), Menü
├── electron/preload.js    # contextIsolation-Bridge, minimale API
├── app/                   # Renderer, rein statisch (Vanilla JS, ES-Module)
│   ├── index.html
│   ├── styles/tokens.css  # Design-Tokens (Dark, Neon, Syne + IBM Plex Mono)
│   ├── styles/app.css
│   ├── js/main.js         # Bootstrap, Router
│   ├── js/registry.js     # importiert alle app/content/teilN.js, sortiert
│   ├── js/state.js        # Fortschritt/XP/Weak-Tracking, IPC-Persistenz
│   ├── js/engine/         # home, path, lesson, tasks, builder, revision, werkstatt
│   │                       # → content-agnostisch, rendert nur was das Schema liefert
│   └── js/python/         # runtime.js (Pyodide+xterm+stdin), checker.js (Output-Diff)
├── app/content/teil1.js, teil2.js   # Content-Plugins nach festem Schema
├── app/vendor/             # pyodide/, xterm/, codemirror/ — beim Build kopiert, nie CDN
├── assets/fonts/           # Syne + IBM Plex Mono als WOFF2 (lokal)
└── scripts/copy-vendor.js  # kopiert node_modules-Assets → app/vendor/
```

Sicherheit: `contextIsolation: true`, `nodeIntegration: false`.

## Content-Schema (verbindlich, siehe MASTERPROMPT Abschnitt 4)
Jeder Teil exportiert `{id, nummer, titel, untertitel, farbe, voraussetzung, lektionen[], werkstatt[]}`.
Jede Lektion: genau 3 `slides`, genau 10 `aufgaben` (1–5 Quiz: `mc`/`out`/`fill`, 6–10 `build`),
`lernlog` (4–7 Punkte). `build`-Aufgaben haben `check.{stdout,tests,stdin}`, `hints[3]`, `loesung`.
Persistenz-Schlüssel: `teilId → lektionId → aufgabenIndex` (Content-Updates zerstören keinen Fortschritt).

## Befehle
- `npm start` — Electron App im Dev-Modus starten
- `npm run build` — Vite-Build des Renderers
- `npm run dist` — `.dmg` bauen (universal, macOS)
- `node scripts/verify-content.js` — prüft alle `build`/`werkstatt`-`loesung`en gegen ihre `check`s

## Releases & Auto-Update
Kein Apple Developer ID vorhanden → kein Squirrel.Mac. Stattdessen ein selbstgebauter
Updater: die App lädt bei Klick auf "Nach Updates suchen" (Einstellungen) das `.zip`-Asset
des neuesten GitHub-Release (`simonhapp-ai/PY.Quest`), prüft dessen `.sha256`-Sidecar,
entpackt via `ditto` und tauscht `/Applications/PY.QUEST.app` aus. Fortschritt liegt in
`app.getPath("userData")` außerhalb des `.app`-Bundles und übersteht das.

Wenn der Nutzer **"GO UPDATE"** schreibt (auch als Teil einer größeren Nachricht) heißt das:
commit + push jeglicher ausstehender Änderungen, Versions-Bump (Standard: patch, außer
explizit anders angegeben, z.B. "GO UPDATE minor" oder eine konkrete Versionsnummer),
`npm run dist:mac`, und Veröffentlichung als GitHub Release mit dmg/zip/sha256-Assets —
alles über `npm run release [patch|minor|major|x.y.z]` (`scripts/release.cjs`).

## Status
Siehe README.md für aktuellen Baufortschritt und Definition-of-Done-Checkliste.
