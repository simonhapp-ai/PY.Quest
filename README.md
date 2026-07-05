# PY.QUEST Desktop

Eine interaktive Python-Lern-App als natives macOS-Programm. Der Kern ist ein echtes
Python-Terminal (Pyodide/WebAssembly) — kein simulierter Code, echte Ausführung, echte
Tracebacks. Läuft zu 100 % offline. Vollständige Spezifikation: siehe
[MASTERPROMPT_PYQUEST.md](MASTERPROMPT_PYQUEST.md), Architekturüberblick: siehe
[CLAUDE.md](CLAUDE.md).

## Entwicklung

```bash
npm install    # installiert Abhängigkeiten und kopiert Pyodide/xterm/Fonts nach app/vendor + app/assets
npm start      # startet die App im Dev-Modus
```

`npm install` läuft danach `scripts/copy-vendor.js` automatisch (als `postinstall`), das
Pyodide, xterm.js und die benötigten Font-Dateien aus `node_modules` in `app/vendor` bzw.
`app/assets/fonts` kopiert. Diese Kopien werden zur Laufzeit **lokal** geladen — nie von
einem CDN. Solltest du den Vendor-Ordner löschen, reicht `node scripts/copy-vendor.js`.

## Build & Distribution

```bash
npm run dist:mac
```

Erzeugt eine `.dmg` unter `dist/` (universal: Apple Silicon + Intel). Die App ist
unsigniert (kein Apple Developer-Zertifikat hinterlegt).

**Die unsignierte App unter macOS öffnen:** Da die `.dmg` nicht notarisiert ist, blockiert
Gatekeeper den Doppelklick-Start beim ersten Mal. Abhilfe: im Finder **Rechtsklick auf
PY.QUEST.app → Öffnen** wählen (nicht Doppelklick) und im folgenden Dialog erneut
"Öffnen" bestätigen. Das ist nur beim allerersten Start nötig.

## Content-Plugin-System

Ein neuer Teil (Kapitel) besteht aus **einer** Datei in `app/content/` — sonst wird
nichts angefasst. Der gesamte Engine-Code (`app/js/engine/*`, `app/js/python/*`) ist
content-agnostisch und rendert ausschließlich, was das Schema liefert.

1. Neue Datei `app/content/teilN.js` anlegen, die ein Objekt nach folgendem Schema
   default-exportiert (Kurzfassung — vollständig in
   [MASTERPROMPT_PYQUEST.md](MASTERPROMPT_PYQUEST.md#4-content-architektur-plugin-system--herzstück-der-erweiterbarkeit)):

   ```js
   export default {
     id: "teilN",              // eindeutig, stabil — ist der Persistenz-Schlüssel!
     nummer: N,
     titel: "…",
     untertitel: "…",
     farbe: "var(--cyan)",
     voraussetzung: "teilN-1", // id des vorausgesetzten Teils, oder null
     lektionen: [ /* siehe Schema: id, titel, icon, farbe, kurz, slides[3], aufgaben[10], lernlog[4-7] */ ],
     werkstatt: [ /* 4 Projekte: id, titel, farbe, schwierigkeit, brief, transfer, starter, check, hints, loesung */ ],
   };
   ```

2. In `app/js/registry.js` einen Import + Registry-Eintrag hinzufügen:

   ```js
   import teilN from "../content/teilN.js";
   export const registry = [teil1, teil2, teilN].sort((a, b) => a.nummer - b.nummer);
   ```

   Das ist alles — der Homescreen, der Lernpfad, Revision und Werkstatt zeigen den neuen
   Teil automatisch an (gesperrt, bis `voraussetzung` abgeschlossen ist).

3. **Vor dem Ausliefern immer verifizieren:**

   ```bash
   npm run verify-content
   ```

   Dieses Skript führt jede `loesung` jeder `build`-Aufgabe und jedes Werkstatt-Projekts
   headless durch echtes Pyodide (Node) aus und prüft sie gegen ihren eigenen `check` —
   exakt die gleiche Logik wie der ✓-Abgeben-Button in der App. Es dürfen niemals
   unlösbare Aufgaben ausgeliefert werden.

Persistenz-Schlüssel sind immer `teilId → lektionId → aufgabenIndex`, damit
Content-Updates (z. B. eine Aufgabe umformulieren) den Fortschritt bestehender Nutzer
nicht zerstören — nur das Umbenennen einer `id` selbst setzt deren Fortschritt zurück.

### Prompt-Vorlage für neue Teile

```
Lies MASTERPROMPT_PYQUEST.md (Abschnitte 4–7 sind verbindlich).
Erstelle app/content/teilN.js nach dem Content-Schema und registriere ihn.
id: "teilN" · nummer: N · titel: "…" · voraussetzung: "teilN-1" · farbe: …
Lektionen (je 3 Slides, 5 Quiz + 5 Build, Lern-Log): [Themenliste]
Werkstatt (4 Projekte mit Transfer zu: …): [Projektliste]
Anspruchsniveau: baut auf Teil 1–(N-1) auf und verwendet deren Konzepte beiläufig.
Ändere keinen Engine-Code.
```

## Architektur

Siehe [CLAUDE.md](CLAUDE.md) für den vollständigen Überblick. Kurzfassung:

- **Electron** (`electron/main.js`, `electron/preload.js`) — lädt die App über ein
  registriertes `pyquest://`-Protokoll (nicht `file://`), damit `fetch()`,
  `WebAssembly.instantiateStreaming` und Worker-Skripte zuverlässig offline funktionieren.
  Ein striktes `onBeforeRequest`-Netzwerkfilter lässt ausschließlich `pyquest://` und
  `devtools://` zu — jede andere Anfrage wird verworfen.
- **Pyodide läuft in einem Web Worker** (`app/js/python/pyodide.worker.js`), damit eine
  Endlosschleife im Nutzercode niemals die UI einfriert. Der Stop-Button terminiert und
  respawnt den Worker hart (~1 s) — das ist zuverlässiger als ein kooperativer Interrupt.
- **Echtes blockierendes `input()`** ohne `SharedArrayBuffer`: Der Worker blockiert
  synchron auf eine XHR gegen `pyquest://app/__stdin__?id=…`; die Anfrage bleibt im
  Hauptprozess offen, bis das Terminal eine Eingabezeile hat, die dann per IPC übergeben
  wird. (`SharedArrayBuffer`/`Cross-Origin-Embedder-Policy` wurden bewusst vermieden — in
  diesem Electron-Build bricht COEP die Worker-Erzeugung komplett.)
- **Terminal-UI**: xterm.js, lokal gebündelt, mit einem schlanken Zeilen-Eingabepuffer für
  `input()`.
- **Persistenz**: `progress.json` in `app.getPath("userData")`, per IPC gelesen/geschrieben
  (`app/js/state.js`), mit `localStorage`-Fallback.

## Definition of Done

- [x] `npm install && npm start` startet die App
- [x] `npm run dist:mac` erzeugt eine startbare `.dmg`
- [x] Netzwerk komplett getrennt (nur `pyquest://`/`devtools://` erlaubt)
- [x] `input()`, Tracebacks, Endlosschleifen-Stopp funktionieren nachweislich im Terminal
- [x] Alle Lektionen × 10 Aufgaben vorhanden; jede `build`-Aufgabe und jedes
      Werkstatt-Projekt gegen die eigene `loesung` verifiziert (`npm run verify-content`)
- [x] Werkstatt ist gesperrt bis alle Lektionen des Teils fertig sind; Teil 2 gesperrt bis
      Teil 1 fertig ist
- [x] Fortschritt übersteht App-Neustart; „Fortschritt zurücksetzen" im
      Einstellungs-Menü vorhanden
- [x] README erklärt Build, Dist, Content-Plugin-System und den unsignierten Start
