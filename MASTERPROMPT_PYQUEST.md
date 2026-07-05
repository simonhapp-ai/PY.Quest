# MASTERPROMPT — PY.QUEST Desktop (macOS)

> **Anweisung an Claude Code:** Baue in diesem (leeren) Ordner die unten spezifizierte App
> vollständig von Null auf. Arbeite die Spezifikation Abschnitt für Abschnitt ab, halte dich
> exakt an Architektur, Design-Tokens und Content-Schema. Bei Zielkonflikten gilt:
> **Offline-Fähigkeit > echte Python-Semantik > Design > alles andere.**

---

## 0 · Was gebaut wird

**PY.QUEST Desktop** — eine interaktive Python-Lern-App als natives macOS-Programm
(Electron, ausgeliefert als `.dmg`). Der Nutzer lernt Python in nummerierten **Teilen**
(Teil 1: Basics, Teil 2: Datenstrukturen & Robustheit, Teil 3+: kommen später als
Content-Plugins dazu). Kernphilosophie: **Selber bauen schlägt Quiz.** Das Herzstück ist
ein eingebautes, echtes Python-Terminal (Pyodide), in dem der Nutzer Code schreibt und
ausführt — nicht simuliert, nicht gemustert, sondern echt.

**Harte Anforderungen:**
1. Läuft zu 100 % offline. Kein CDN, kein localhost, kein Dev-Server zur Laufzeit,
   keine Netzwerk-Requests. Alle Assets (Pyodide, Fonts, Libraries) werden beim Build
   lokal gebündelt.
2. Ein Download, dann für immer nutzbar: `npm run dist` erzeugt eine `.dmg` für
   Apple Silicon **und** Intel (universal oder zwei Targets).
3. Erweiterbar ohne Kern-Änderung: Ein neuer Teil = eine neue Content-Datei +
   ein Registry-Eintrag. Nichts anderes wird angefasst.
4. Fortschritt bleibt über App-Neustarts und Updates erhalten (JSON im userData-Pfad).

---

## 1 · Tech-Stack (verbindlich)

| Baustein | Wahl | Begründung |
|---|---|---|
| Shell | **Electron** (aktuelles LTS) + **electron-builder** | .dmg-Packaging, Mac-nativ |
| Python | **Pyodide**, via npm installiert, ins App-Bundle **kopiert** und per relativem Pfad geladen — niemals vom CDN | echtes CPython (WASM), offline |
| Terminal-UI | **xterm.js** (npm, lokal gebündelt) | authentisches Terminal-Gefühl |
| Editor | **CodeMirror 6** (npm, lokal) mit Python-Highlighting, oder — falls Bundle-Komplexität zu hoch — ein sauber gestyltes `<textarea>` mit Tab-Unterstützung, Zeilennummern und Monospace. Editor-Komfort ist nice-to-have, Offline-Robustheit ist Pflicht. |
| Frontend | Vanilla JS mit ES-Modulen, kein Framework, kein Bundler-Zwang. Falls ein Bundler nötig wird (z. B. für CodeMirror): **Vite** nur als Build-Schritt, Output ist rein statisch. | wenig bewegliche Teile |
| Persistenz | JSON-Datei `progress.json` in `app.getPath("userData")`, gelesen/geschrieben über IPC (main process). localStorage nur als Fallback. | update-sicher |
| Fonts | **Syne** (500/700/800) + **IBM Plex Mono** (400/500/600/700) als lokale WOFF2-Dateien in `assets/fonts/` (z. B. via `@fontsource/*` npm-Pakete kopieren). Kein Google-Fonts-Link. | offline |

Sicherheits-Basics: `contextIsolation: true`, `nodeIntegration: false`, Preload-Script
mit minimaler IPC-API (`loadProgress`, `saveProgress`, `getAppVersion`).

---

## 2 · Projektstruktur

```
pyquest/
├── package.json
├── electron/
│   ├── main.js            # BrowserWindow, IPC, Menü
│   └── preload.js         # sichere Bridge
├── app/                   # Renderer (rein statisch)
│   ├── index.html
│   ├── styles/
│   │   ├── tokens.css     # Design-Tokens (Abschnitt 3)
│   │   └── app.css
│   ├── js/
│   │   ├── main.js        # Bootstrap, Router
│   │   ├── registry.js    # Teil-Registry (Abschnitt 4)
│   │   ├── state.js       # Fortschritt, XP, Weak-Tracking
│   │   ├── engine/
│   │   │   ├── home.js        # Homescreen (Teil-Menü)
│   │   │   ├── path.js        # Lernpfad eines Teils
│   │   │   ├── lesson.js      # Slides → Aufgaben → Lern-Log
│   │   │   ├── tasks.js       # Quiz-/Tipp-Aufgaben
│   │   │   ├── builder.js     # Bau-Aufgaben (Editor + Terminal + Checks)
│   │   │   ├── revision.js    # Revisionsmodus
│   │   │   └── werkstatt.js   # Projekt-Werkstatt (Endmodus)
│   │   └── python/
│   │       ├── runtime.js     # Pyodide laden, Code ausführen, stdin/stdout
│   │       └── checker.js     # Output- & Test-Validierung
│   ├── content/
│   │   ├── teil1.js
│   │   └── teil2.js
│   └── vendor/            # pyodide/, xterm/, codemirror/ (beim Build kopiert)
├── assets/
│   ├── fonts/             # WOFF2 lokal
│   └── icon.icns
└── scripts/
    └── copy-vendor.js     # kopiert node_modules-Assets nach app/vendor/
```

---

## 3 · Design-System (aus PY.QUEST Teil 1 übernehmen)

Dark Theme, Grid-Hintergrund, Neon-Akzente. Diese Tokens sind verbindlich:

```css
--bg:#07090f;  --panel:#0d1220;  --panel2:#111830;  --line:#1c2740;
--text:#dbe4f5; --dim:#7889a8;
--cyan:#4fd8eb; --magenta:#ff5fa8; --lime:#b8f04a; --orange:#ffb347;
--violet:#a78bfa; --red:#ff6b5e; --teal:#34e0b0; --gold:#ffd75e; --blue:#6ea8ff;
--ok:#34e0b0;  --err:#ff6b5e;
```

- Hintergrund: `#07090f` mit dezentem Grid (36 px, `rgba(110,168,255,0.045)` Linien).
- Typo: **Syne** für Headlines/Logo (fett, leicht gesperrt), **IBM Plex Mono** für
  alles andere inkl. UI-Text. Code immer Plex Mono.
- Jede Lektion hat eine Akzentfarbe (rotierend aus der Palette); Panels `--panel` mit
  1 px `--line`-Border, Border-Radius 10–12 px, Akzent-Glow bei aktiven Elementen.
- Signature-Element: der **Lernpfad als Circuit-Node-Map** — vertikale Knotenlinie,
  abgeschlossene Knoten leuchten in ihrer Akzentfarbe, die Verbindungslinie „füllt sich"
  mit Fortschritt. Dieses Element hat Wiedererkennungswert und bleibt in jedem Teil gleich.
- XP-Leiste + Level im Header (10 XP pro richtiger Aufgabe, 20 XP pro Bau-Aufgabe,
  50 XP Lektions-Bonus, 150 XP pro Werkstatt-Projekt). Level = floor(XP/300)+1.
- `prefers-reduced-motion` respektieren. Fenster-Mindestgröße 1000×700.

---

## 4 · Content-Architektur (Plugin-System — Herzstück der Erweiterbarkeit)

Jeder Teil ist **eine** Datei in `app/content/`, die ein Objekt nach diesem Schema
default-exportiert. `registry.js` importiert alle Teile und exportiert sie sortiert.
**Der gesamte Engine-Code ist content-agnostisch** — er rendert, was das Schema liefert.

```js
export default {
  id: "teil2",              // eindeutig, stabil (Persistenz-Schlüssel!)
  nummer: 2,
  titel: "Datenstrukturen & Robustheit",
  untertitel: "Programme, die echte Daten überleben",
  farbe: "var(--violet)",
  voraussetzung: "teil1",   // id des Teils, der abgeschlossen sein muss (null bei Teil 1)
  lektionen: [
    {
      id: "t2l1", titel: "Dictionaries", icon: "🗝", farbe: "var(--cyan)",
      kurz: "Daten mit Namen statt Nummern.",
      slides: [
        { h: "Überschrift", p: "HTML-erlaubter Erklärtext …", code: "python-code als string" },
        // exakt 3 Slides pro Lektion
      ],
      aufgaben: [
        // exakt 10 pro Lektion: Positionen 1–5 Quiz/Tipp, Positionen 6–10 Bau-Aufgaben
        { t: "mc",   q: "…", code: "…?", opts: ["…","…","…","…"], a: 1, ex: "Erklärung" },
        { t: "out",  q: "…", code: "…", accept: ["…"], ex: "…" },   // Ausgabe vorhersagen
        { t: "fill", q: "…", code: "… ___ …", accept: ["…"], ex: "…" },
        { t: "build",                                  // ← der neue Kern-Typ
          q: "Baue: …",                                // Bau-Auftrag in 1–3 Sätzen
          starter: "# Vorgabe-Code oder leer\n",
          check: {
            stdout: ["erwartete", "zeilen"],           // optional: erwartete Ausgabe (normalisiert)
            tests: "assert quadrat(3) == 9\nassert quadrat(0) == 0",  // optional: Python-Asserts,
                                                       // laufen NACH dem Nutzercode im selben Namespace
            stdin: ["Simon"]                           // optional: vorbereitete input()-Antworten für den Check-Lauf
          },
          hints: ["dezenter Schubs", "konkreter Hinweis", "fast die Lösung"],
          loesung: "musterlösung als code-string",
          ex: "Erklärung nach dem Lösen: was hier der Kernpunkt war"
        }
      ],
      lernlog: [                                       // Abschluss-Feld „Das hast du neu gelernt"
        "print() gibt Werte aus",
        "…"                                            // 4–7 Punkte, präzise, als abhakbare Liste gerendert
      ]
    }
  ],
  werkstatt: [                                         // Projekt-Werkstatt (Abschnitt 7)
    {
      id: "t2p1", titel: "…", farbe: "…", schwierigkeit: 1..3,
      brief: "Projektbeschreibung wie ein kleines Ticket: Was soll das Programm können? 3–6 Anforderungen als Liste.",
      transfer: ["t2l1","t2l4","teil1"],               // welche Lektionen/Teile es kombiniert (wird in der UI angezeigt)
      starter: "",                                     // bewusst leer oder minimal — Werkstatt heißt selber strukturieren
      check: { stdout: [...], tests: "...", stdin: [...] },
      hints: ["…","…","…"],
      loesung: "…"
    }
  ]
};
```

**Regeln für die Engine:**
- Homescreen = Grid-Karten aller Teile aus der Registry: Nummer, Titel, Fortschrittsring,
  Status (offen / 🔒 Voraussetzung fehlt / ✔). Ein gesperrter Teil zeigt an, welcher Teil
  zuerst fertig sein muss. Neue Content-Datei ⇒ erscheint automatisch.
- Lernpfad innerhalb eines Teils: Lektionen schalten sich sequenziell frei (Node-Map).
- Persistenz-Schlüssel immer `teilId → lektionId → aufgabenIndex`, damit Content-Updates
  den Fortschritt nicht zerstören.

---

## 5 · Das Python-Terminal (wichtigstes Feature — hier keine Abkürzungen)

Bau-Aufgaben und Werkstatt-Projekte nutzen eine zweigeteilte Ansicht:

```
┌─────────────────────────────┬────────────────────────────┐
│  EDITOR (CodeMirror/Area)   │  TERMINAL (xterm.js)       │
│  Python-Highlighting        │  schwarz, Plex Mono        │
│  Zeilennummern, Tab=4       │  verhält sich wie          │
│                             │  `python3 mein_code.py`    │
│  [▶ Ausführen]  [↺ Reset]   │                            │
│  [💡 Hinweis]  [✓ Abgeben]  │                            │
└─────────────────────────────┴────────────────────────────┘
```

- **▶ Ausführen** führt den Editor-Inhalt in Pyodide aus. stdout/stderr streamen live ins
  Terminal, Tracebacks erscheinen roh und echt (SyntaxError, NameError, ValueError … —
  Fehler lesen lernen ist Teil des Lernens). Vor jedem Lauf: frischer Namespace.
- **`input()` funktioniert echt:** Pyodides stdin wird auf das Terminal umgeleitet — der
  Prompt erscheint im Terminal, der Nutzer tippt dort, Enter übergibt den Wert an Python.
  (Implementierung: Pyodide `setStdin` mit einer Callback-Queue, die auf xterm-Eingabe
  wartet; Ausführung dafür in einem async-Wrapper. Wenn nötig, Web Worker + SharedArrayBuffer
  oder ein promised-basierter stdin-Shim — Hauptsache, es fühlt sich wie ein Terminal an.)
- **Endlosschleifen-Schutz:** Ausführung in einem Worker mit Kill-Button und 10-s-Soft-Warnung
  („Läuft noch … [■ Stoppen]"). Die App darf nie einfrieren.
- **✓ Abgeben** führt den Code im Prüfmodus aus: `check.stdin` wird als vorbereitete
  Eingaben injiziert, stdout wird normalisiert (trim, Whitespace-Kollaps, `'`≙`"`) gegen
  `check.stdout` verglichen, danach laufen `check.tests` (Asserts) im selben Namespace.
  Ergebnis-Panel: ✔ grün mit `ex`-Erklärung +20 XP, oder ✘ rot mit **konkretem Befund**
  („Zeile 2 deiner Ausgabe: `5` erwartet, `5.0` erhalten" / erste fehlgeschlagene Assert-Zeile).
- **💡 Hinweis** deckt die 3 Hints nacheinander auf. Nach 3 Fehlversuchen wird zusätzlich
  **„Musterlösung ansehen"** freigeschaltet (Aufgabe zählt dann als gelöst, aber ohne XP —
  ehrlich bleiben).
- Zusätzlich global im Header: **freier REPL-Modus** („🐍 Playground") — ein reines
  Terminal mit `>>>`-Prompt zum Experimentieren, jederzeit erreichbar, ohne Aufgabe.
- Pyodide einmalig beim App-Start im Hintergrund laden (Ladeindikator im Header:
  „Python startet …" → „Python bereit ✔").

---

## 6 · Lektions-Ablauf (verbindliche Dramaturgie)

1. **3 Slides** Stoff — kompakt, jede mit Code-Beispiel, Stil wie bisher (Überschrift,
   2–4 Sätze, Codebox mit Kommentar-Annotationen).
2. **10 Aufgaben** in fester Reihenfolge:
   - Aufgabe 1–5: Quiz-Mix (`mc`, `out`, `fill`) — schnelles Verständnis-Check-in.
   - Aufgabe 6–10: `build` — im Terminal selber bauen, aufsteigende Schwierigkeit.
     Aufgabe 6 ist eine Fingerübung (2–3 Zeilen), Aufgabe 10 kombiniert die Lektion
     mit Stoff aus **früheren** Lektionen (expliziter Rückgriff — im Aufgabentext
     kennzeichnen: „🔗 nutzt auch: Schleifen aus Modul 8").
3. **Lern-Log:** Abschluss-Screen „Das hast du neu gelernt" — die `lernlog`-Punkte als
   Liste mit Häkchen-Animation, plus Statistik (richtig/falsch, XP) und Buttons
   (Nächste Lektion / Wiederholen / Lernpfad).

---

## 7 · Die drei Modi pro Teil

**① Lernpfad** — wie beschrieben, Node-Map, sequenzielle Freischaltung.

**② Revision** — bleibt wie im Original-Konzept: 10 zufällige Aufgaben aus allen
abgeschlossenen Lektionen (teilübergreifend!), falsch beantwortete Fragen bekommen bis zu
4-faches Gewicht, bis sie zweimal in Folge richtig gelöst wurden. Neu: Auch `build`-Aufgaben
sind im Revisions-Pool (max. 3 pro Runde, sie dauern länger). Dashboard mit Trefferquote,
schwachen Themen (gruppiert nach Lektion) und XP.

**③ Projekt-Werkstatt** (ersetzt das Quiz-Turnier) — **erst freigeschaltet, wenn ALLE
Lektionen des jeweiligen Teils abgeschlossen sind.** Keine Zeitlimits, keine Gegner,
kein Quiz: 4 Mini-Projekte pro Teil, die **Transferleistung** verlangen — Aufgaben, die
anders aussehen als alles aus den Lektionen und mehrere Lektionen (ab Teil 2 auch frühere
Teile) kombinieren. Jedes Projekt: Brief wie ein kleines Ticket, leerer Editor, 3 Hints,
Checks, 150 XP, Trophäen-Screen. Fortschrittsanzeige „🏗 2/4 Projekte gebaut".

---

## 8 · Content: TEIL 1 — „Die Basics" (neu aufbauen, Themen fix)

9 Lektionen, Themenfolge wie gehabt — Slides dürfen inhaltlich vom HTML-Original
inspiriert sein, alle Aufgaben werden fürs neue 5+5-Format neu geschrieben:

1. **print() & Kommentare** · 2. **Variablen & Datentypen** · 3. **Zahlen & Operatoren**
(inkl. `//`, `%`, `**`, `==` vs `=`) · 4. **Strings** (f-Strings!, `.upper()`, `len()`, Index)
· 5. **input() & Typumwandlung** · 6. **if / elif / else** (+ `and`/`or`/`not`)
· 7. **Listen** (Index, `append`, `len`, negativer Index) · 8. **Schleifen**
(`for`, `range`, `while`, `break`) · 9. **Funktionen** (`def`, Parameter, `return` vs `print`)

Beispiel-Kalibrierung für `build`-Aufgaben (Anspruchsniveau):
- L1/A6: „Gib drei Zeilen aus: deinen Namen, dein Studienfach, dein Lernziel."
- L6/A10 (🔗 L3+L5): „Frage nach einer Zahl und gib aus, ob sie gerade oder ungerade ist."
- L8/A10 (🔗 L7): „Summiere alle Zahlen einer Liste mit einer Schleife — ohne `sum()`."
- L9/A10 (🔗 L6+L8): „Schreibe `zaehle_gerade(liste)`, die zurückgibt, wie viele gerade Zahlen enthalten sind."

**Werkstatt Teil 1** (Kalibrierung, gern verfeinern):
1. *Zahlenraten* — Programm denkt sich via Startwert-Logik eine Zahl (ohne `random`, z. B. fest verdrahtet oder aus Eingabe abgeleitet), Nutzer rät mit Hinweisen „größer/kleiner", Versuchszähler. (🔗 L5+L6+L8)
2. *Einkaufslisten-Manager* — Schleifen-Menü: hinzufügen / anzeigen / zählen / beenden. (🔗 L7+L8+L6)
3. *Noten-Rechner* — Punktzahlen erfassen bis „fertig", Durchschnitt + beste/schlechteste per Schleife, Notentext via if/elif. (🔗 alle)
4. *FizzBuzz deluxe* — klassisches FizzBuzz 1–30 als Funktion mit Parameter für die Obergrenze. (🔗 L3+L8+L9)

## 9 · Content: TEIL 2 — „Datenstrukturen & Robustheit" (neu entwerfen)

8 Lektionen, baut durchgängig auf Teil 1 auf (Aufgaben nutzen selbstverständlich
Schleifen, Funktionen, if — ohne es neu zu erklären):

1. **Dictionaries** — key/value, Zugriff, `.get()`, hinzufügen/ändern, `in`
2. **Dictionaries II & Verschachtelung** — über dicts iterieren (`.items()`), dict-Listen (Mini-Datenbanken)
3. **Tuples & Sets** — Unveränderlichkeit, Entpacken, Duplikate entfernen, Mengenlogik
4. **Slicing & String-Werkzeuge** — `[start:stop:step]`, `.split()`, `.join()`, `.strip()`, `.replace()`
5. **List Comprehensions** — Transformieren + Filtern in einer Zeile, wann (nicht) nutzen
6. **Fehlerbehandlung** — `try`/`except` gezielt (ValueError, KeyError, ZeroDivisionError), `else`/`finally`, robuste Eingaben
7. **Dateien** — `open()` mit `with`, lesen/schreiben/anhängen, Zeilen verarbeiten (Pyodide nutzt sein virtuelles Dateisystem — funktioniert offline einwandfrei)
8. **Module & Standardbibliothek** — `import`, `random`, `datetime`, `math`; eigene Funktionen als Werkzeugkasten denken

**Werkstatt Teil 2:**
1. *Vokabel-Trainer* — Wörterbuch-dict, Abfrage-Schleife, Fehlertoleranz bei Eingaben, Punktestand. (🔗 T2L1+L6 + T1)
2. *Kassensystem* — Produkte als dict, Warenkorb als Liste, Bon formatiert ausgeben, ungültige Produkte sauber abfangen. (🔗 T2L1+L4+L6)
3. *Log-Analysator* — mehrzeiligen Text/Datei parsen (`split`/`strip`), Fehlerzeilen zählen, Statistik als dict, Top-Fehler ausgeben. (🔗 T2L4+L5+L7)
4. *Würfel-Duell* — zwei Spieler, `random`, Runden-Historie als Liste von dicts, Endauswertung, alles in Funktionen strukturiert. (🔗 T2L8 + allem)

## 10 · Zukünftige Teile (offenes Ende — nicht jetzt bauen)

Der Homescreen zeigt nach dem letzten Teil eine gedimmte Karte **„Teil 3 — coming soon"**.
Neue Teile entstehen später über Prompts nach diesem Template (Datei anlegen +
Registry-Zeile, sonst nichts):

```
Lies MASTERPROMPT_PYQUEST.md (Abschnitte 4–7 sind verbindlich).
Erstelle app/content/teilN.js nach dem Content-Schema und registriere ihn.
id: "teilN" · nummer: N · titel: "…" · voraussetzung: "teilN-1" · farbe: …
Lektionen (je 3 Slides, 5 Quiz + 5 Build, Lern-Log): [Themenliste]
Werkstatt (4 Projekte mit Transfer zu: …): [Projektliste]
Anspruchsniveau: baut auf Teil 1–(N-1) auf und verwendet deren Konzepte beiläufig.
Ändere keinen Engine-Code.
```

---

## 11 · Arbeitsreihenfolge & Definition of Done

**Reihenfolge:** ① Scaffold + Electron-Shell + Design-Tokens → ② Pyodide-Runtime +
Terminal/Editor (inkl. `input()` + Stop-Button — zuerst isoliert testen!) → ③ Engine
(Home, Pfad, Lektion, Aufgaben-Runner, Checker) → ④ Content Teil 1 → ⑤ Revision +
Werkstatt → ⑥ Content Teil 2 → ⑦ Packaging + Offline-Verifikation.

**Done heißt:**
- [ ] `npm install && npm start` startet die App; `npm run dist` erzeugt eine startbare `.dmg`
- [ ] Netzwerk komplett getrennt: App startet, Python läuft, alle Fonts/Assets laden (im DevTools-Network-Tab: null externe Requests)
- [ ] `input()`, Tracebacks, Endlosschleifen-Stopp funktionieren im Terminal nachweislich
- [ ] Alle 17 Lektionen × 10 Aufgaben vorhanden; jede `build`-Aufgabe und jedes Werkstatt-Projekt wurde mit der eigenen `loesung` gegen die eigenen Checks verifiziert (Skript oder manuell — keine unlösbaren Aufgaben ausliefern!)
- [ ] Werkstatt ist gesperrt bis alle Lektionen des Teils fertig sind; Teil 2 gesperrt bis Teil 1 fertig ist
- [ ] Fortschritt überlebt App-Neustart; „Fortschritt zurücksetzen" existiert in einem Einstellungs-Menü
- [ ] README.md erklärt: Build, Dist, Content-Plugin-System, und wie man die unsignierte App unter macOS öffnet (Rechtsklick → Öffnen)

**Stil der Inhalte:** Deutsch, direkt, motivierend, technisch präzise. Erklärungen nach
Aufgaben („ex") erklären das *Warum*, nicht nur das *Was*. Fehlversuche sind Teil des
Lernens — Feedback ist konkret und niemals herablassend.
