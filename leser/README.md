# Wima · Leser

Übernommen aus MathFreak26/Math-Website (Stand 9d95f29) und in Wima eingebaut: läuft unter
<https://www.wima26.de/leser/>, die Anmeldung übernimmt Wima (die Vercel-Middleware des Originals entfällt).

- **Aus Wima:** Die Bibliothek listet alle PDFs aus Wima (je Eintrag und Fassung die neueste: Original, Verbessert,
  Lang, Lösung). „Öffnen“ holt sie und analysiert sie wie ein hochgeladenes Skript. Aus Wima: `#/wima/<Datei-ID>`.
- **Neue Fassung in Wima** (z. B. neues Skript-Original vom Moodle-Pull) wird beim nächsten Öffnen der Bibliothek
  bzw. über „Lesen“ automatisch als neue Version übernommen: Notizen wandern mit, Verbesserungsansicht wie unten.
- **Gemeinsame Notizen:** Zu jeder Wima-Quelle (Eintrag + Fassung) gibt es in Wima genau einen Notizstand
  (Tabelle `notizen`, `GET/PUT /api/notizen`), den alle Nutzer sehen und bearbeiten: Striche, Zettel, Verbesserungs-
  ansicht samt der PDF, auf der sie liegen. Jede Änderung geht nach ~1,5 s nach Wima, fremde Änderungen kommen beim
  Öffnen und alle 20 s. Haben zwei gleichzeitig gespeichert, wird über die ids der Striche/Zettel zusammengeführt.
  In Wima schaltet „Notizen“ je Eintrag um: an = Kacheln öffnen den Leser, aus = reine PDF.
- Persönlich (nur IndexedDB, pro Gerät): Index-Ergänzungen, Anpinnen, Abfrage-Statistik und selbst hochgeladene PDFs.
- Bauen: `cd leser && npm install && npm run build` → schreibt nach `public/leser/` (wird mit eingecheckt,
  Vercel baut den Leser nicht selbst).
- Code: `src/lib/wima.ts`, `src/views/WimaOpen.tsx`, Abschnitt „Aus Wima“ in `src/views/Library.tsx`.

---

Ursprüngliche Beschreibung:

## Funktionen

- **Skripte hochladen (PDF)** – die Startseite zeigt die Skripte als Kacheln (Vorschaubild der ersten Seite,
  Name, Fach, „Seite 12 von 23“, Datum), nach Fach filterbar. Als Datum steht der **neueste Aufschrieb**, wenn er im
  Dokument erkennbar ist („Vorlesung 23. Oktober“, „Stand: 23.10.2025“, „VL 7 (30.10.)“ → *Stand 23.10.*), sonst das
  Hochladedatum. Nummern wie „Satz 2.3.“ und Termine in Aufgaben zählen nicht. „⋯“ auf einer Kachel: Umbenennen, Fach ändern,
  **Neue Version hochladen**, Abfragen, Löschen.
- **Neue Version eines Skripts** – Kachel, Name und Fach bleiben. Ausgetauscht werden **nur die geänderten
  Seiten**: Seiten mit unverändertem Inhalt behalten ihre Notizen ohne Vergleich – eine andere Seitenzahl oder ein
  neues Datum in Kopf-/Fußzeile zählt nicht als Änderung (dann kommt die neue Seite mit der richtigen Seitenzahl);
  völlig gleiche Seiten bleiben aus der bisherigen Fassung. Geänderte und neue Seiten kommen aus der neuen PDF. Notizen werden über den **Text der Seiten** zugeordnet
  (auch bei verschobenen Seiten, inkl. senkrechter Verschiebung auf der Seite). Neue Seiten sind 14 Tage „Neu“ (die Markierung lässt sich per ✕ entfernen); Notizen ohne passende Seite landen gesammelt unter „🗂 Notizen ohne Seite“.
  Verknüpfungen werden neu erkannt, entfernte bleiben entfernt, die Leseposition bleibt.
- **Stift-Leiste** – oben unter der Leiste (Stift, Textmarker, Radierer, Lasso, Farben, Stärken, Rückgängig/
  Wiederholen). Dazu, solange der Stift an ist, je ein Halbkreis am linken und rechten Rand: er öffnet eine kleine
  Leiste über dem Skript, die nur zwischen Stift, Textmarker, Radierer und Lasso wechselt. Offen ist höchstens eine
  Seite; die andere lässt sich öffnen, wenn beide zu sind. Entweder Stift oder Notiz: Öffnen einer Notiz beendet
  den Stift, der Stift schließt eine offene Notiz.
- **Lasso** (Werkzeug der Stift-Leiste) – Zeichnungen mit Pencil oder Maus umkreisen (der Finger scrollt weiter),
  dann verschieben – auch auf eine andere Seite, am Rand scrollt die Ansicht mit –, über den Griff unten rechts
  bzw. − / + vergrößern/verkleinern oder löschen. Rückgängig und Wiederholen gelten auch dafür.
- **Verbesserungsansicht** – hatte eine geänderte Seite Notizen, zeigt sie links die alte Fassung mit ihren
  Zeichnungen und Notiz-Zetteln, rechts die neue. Rechts lässt sich zeichnen und notieren; mit dem **Lasso** links
  Striche/Zettel umkreisen und auf die neue Seite ziehen (oder dort antippen), Tippen auf einen alten Zettel kopiert
  ihn – Tippen rechts fügt ein.
  „An gleicher Stelle“ / „Alles übernehmen“ übernimmt alles auf einmal. **„Alte Seite behalten“** fügt die
  alte Seite mit ihren Notizen vor der neuen ins Skript ein (beide bleiben). „Fertig“ schließt den Vergleich.
- **Automatische Verknüpfungen** – erkannt werden
  - nummerierte Umgebungen (`Definition 1.1 (Ordnungsrelation)`, `1.1 Definition`, `Satz 2.3`, …),
  - **fett gedruckte Begriffe** im Text (dort wird ein Begriff meist eingeführt; Überschriften,
    „Beweis.“, „Achtung …“ und lange fette Passagen zählen nicht),
  - kursive Begriffe in Definitionen und „… heißt X, falls …“ / „nennt man X“ im ganzen Skript.

  Jedes spätere Vorkommen (auch gebeugt: *Ordnungsrelationen*, *obere Schranke* → *oberen Schranken*,
  auch über Silbentrennung am Zeilenende) und jeder Verweis wie *nach Satz 1.4* wird anklickbar.
  **Verweise zeigen immer nach oben/zurück – auf die erste Stelle**, an der der Begriff definiert wird.
  Fachbegriffe ohne erkannte Definition (z. B. *Äquivalenzrelation*, *Exponentialfunktion*, *injektiv*)
  verweisen auf ihr **erstes Vorkommen**. Vorkommen vor dieser Stelle bleiben unverlinkt.
  - **Verwandte Wortformen** verweisen auf dieselbe Definition, in beide Richtungen und gebeugt:
    *injektiv ↔ Injektivität*, *symmetrisch ↔ Symmetrie*, *disjunkt ↔ Disjunktheit*, *stetig ↔ Stetigkeit*
    (Regeln für -iv/-ivität, -isch/-ie, -heit/-keit plus feste Liste; Wörter wie *geometrisch*/*Geometrie*
    oder *gleich*/*Gleichheit* sind ausgeschlossen). Eigene Wortpaare unter Einstellungen.
  - Verknüpfungen sind dezent markiert (feine, halbtransparente Unterstreichung); unter Einstellungen
    lässt sich „deutlich“ wählen.
  - Überfahren mit der Maus zeigt die Definition als Vorschau – oft muss man gar nicht springen.
  - Antippen zeigt die Definition als Ausschnitt in der Mitte des Lesebereichs (wie die Vorschau beim Abfragen) –
    ohne zu springen. „Zur Stelle“ springt hin und hebt die Stelle hervor.
  - Unten erscheint **„↩ Zurück zu S. 47 · Satz 3.6“** (auch `Alt+←` oder `B`). Bei mehreren
    Sprüngen hintereinander zeigt `▾` alle Stationen.
  - **Verknüpfung bearbeiten:** langes Drücken (iPad) bzw. Rechtsklick auf eine Verknüpfung – oder „⋯“ in der
    Vorschau bzw. Zurück-Leiste – öffnet ein kleines Popup direkt an der Stelle: Springen, **nur diese
    Verknüpfung entfernen**, **alle zu diesem Begriff entfernen**, Definition bei Google suchen. Mit
    „Rückgängig“; im Index unter „Entfernte Verknüpfungen“ jederzeit wiederherstellbar.
  - Pfeiltasten ↑/↓ scrollen (mit Shift fast eine Bildschirmhöhe); ein Skript öffnet mit 70 % Zoom.
  - **Zoomen mit zwei Fingern** (25–300 %) um den Punkt zwischen den Fingern; nur das Skript wird größer,
    danach wird scharf neu gerendert. Beim Aufsetzen des zweiten Fingers stoppt Safaris eigenes Scrollen; mit zwei
    Fingern lässt sich höchstens eine Seite nach oben/unten verschieben. Auch Trackpad-Pinch und `+`/`−`.
- **📌 Anpinnen** – Wort markieren → „📌 Anpinnen“:
  1. **🔍 Automatisch suchen:** alle früheren Vorkommen des Begriffs, bewertet danach, ob dort die
     Definition steht (fett, „heißt …“, Name in einer Überschrift, innerhalb einer Definition, erstes
     Vorkommen) – mit Vorschaubild; „Hierauf verweisen“ verknüpft.
  2. **✍️ Manuell verweisen:** eine frühere Stelle aus dem Index wählen – oder die markierte Stelle selbst
     als Definition speichern.
  - Einträge lassen sich im Index bearbeiten; Ergänzungen bleiben bei einer Neuanalyse erhalten.
  - Markierter Text lässt sich außerdem mit „🔎 Definition bei Google suchen“ nachschlagen.
- **🧠 Abfragen** – jeder Klick auf eine Verknüpfung wird pro Begriff gezählt. Stufen nach Klicks seit der
  letzten Abfrage: **1× noch nicht sicher**, 2–3× unsicher, 4–6× sehr unsicher, ab 7× kritisch („nicht gewusst“
  hebt die Stufe um eins). Hinweis im Skript, wenn die Stufe steigt; Zähler am Knopf „🧠 Abfragen“; Hinweis auf
  der Startseite. Beim Abfragen stehen Stufe und Anzahl der Klicks dabei; Ablauf: Begriff → selbst formulieren →
  aufdecken (Original-Ausschnitt aus dem Skript) → „Nicht gewusst / Teilweise / Gewusst“. „Gewusst“ setzt den
  Zähler zurück, „Teilweise“ halbiert ihn; höchste Stufe wird zuerst abgefragt.
- **Handschriftliche Notizen (iPad + Apple Pencil)** – **✏️ Stift** (Taste `P`): Stift und Textmarker
  in vorgegebenen und **eigenen Farben** („+“ öffnet einen Farbkreis mit Helligkeitsregler; eigene Farben
  per langem Drücken wieder entfernen; die Farbleiste scrollt, wenn sie voll ist), 3 Stärken
  (druckempfindlich), Radierer. **Nur der Apple Pencil zeichnet** – der Finger scrollt und zoomt. Die Pfeile
  rechts in der Stift-Leiste machen den letzten Strich rückgängig (←) bzw. wiederholen ihn (→), auch `⌘Z` / `⇧⌘Z`. Beendet wird
  das Zeichnen nur durch erneutes Tippen auf **✏️ Stift**. Notizen werden automatisch gespeichert.
  Das **Lesen-Icon** (aufgeschlagenes Buch) blendet die Notizen aus, um nur das Skript zu lesen; erneutes Tippen
  (oder der Stift) zeigt sie wieder.
- **Notiz-Zettel** – Notiz-Icon in der Leiste antippen, dann auf die Stelle im Skript tippen: Dort erscheint ein
  kleines quadratisches Symbol, rechts öffnet sich ein Feld (das Skript bleibt links sichtbar). Darin Text schreiben
  und Bilder einfügen (Bild-Symbol oder Einfügen, z. B. einen Ausschnitt) – Bilder sitzen an der Schreibmarke im
  Textfluss, auch zwischen zwei Absätzen, und reichen über die ganze Breite des Felds. **Bildgröße:** Bild antippen
  (keine Tastatur) → Rahmen mit Griff unten rechts und kleiner Leiste (½, Volle Breite, Löschen); Ziehen am Griff
  verkleinert/vergrößert ohne Verzerrung, die Ecke oben links bleibt. Verkleinerte Bilder stehen bündig am Textrand,
  daneben steht kein Text; der Text darunter rückt bis eine halbe Zeile unter das Bild. Doppeltipp: volle Breite. X oder ein Tipp ins Skript schließt das
  Feld (Getipptes ist gespeichert), Antippen des Symbols öffnet die Notiz wieder; leere Notizen werden nicht gespeichert. Beim Öffnen bleibt in
  der Mitte des Lesebereichs dieselbe Stelle, die Ansicht wird nur passend kleiner gezeichnet (eine gerade nicht
  sichtbare Notiz wird mit ihrer Seite gezeigt); beim Schließen wird sie um die Mitte herum wieder größer. Wurde bei
  offener Notiz nicht gescrollt, ist nach dem Schließen genau die Ansicht von vor dem Öffnen wieder da. Scrollt
  man bei offener Notiz weg, erscheint neben „Notiz · S. x“ ein Ziel-Symbol, das zurück zur Notiz springt.
  Die Kopfzeile der offenen Notiz (Farbe, Marker, Stift, Bild, Löschen, Schließen) sitzt rechts in der Leiste des
  Skripts – das Notizfeld hat so mehr Platz. Beim Öffnen einer Notiz erscheint keine Tastatur: Text beginnt mit einem Tipp auf vorhandenen Text oder den leeren
  Teil der Notiz. Zeichenfelder (Einfügen, Schreiben mit dem Pencil, Antippen) öffnen keine Tastatur und legen keine
  Textzeile an.
  **Handschrift in Notizen:** Das Stift-Symbol im Notizfeld fügt an der Schreibmarke ein Zeichenfeld ein (z. B. für
  Formeln) – zwischen Text und Bildern, über die ganze Breite, halb so hoch wie das sichtbare Notizfeld – und schaltet
  das Zeichnen ein. Darin schreibt nur der Apple Pencil (Finger scrollen). Die Werkzeugleiste ist eine Zeile: Stift
  (mittlere Stärke), Radierer, zwei Farben (antippen: wechseln; die gewählte Farbe antippen oder eine Farbe gedrückt
  halten: über den Farbkreis ändern – beide bleiben gespeichert) und am rechten Rand Rückgängig und Wiederholen. Schreibt man nahe am unteren
  Rand, wächst das Feld (höchstens eine halbe Feldhöhe bleibt leer); Scrollen lässt es unverändert, darunter geht die
  Notiz weiter. Erneutes Antippen des Stift-Symbols beendet das Zeichnen: Das Feld endet dann kurz unter dem tiefsten
  Strich und der Text rückt direkt darunter. Antippen eines vorhandenen Felds (oder Aufsetzen des
  Pencils) öffnet es wieder zum Weiterzeichnen – ohne neues Feld; ein Tipp auf Text oder den leeren Teil der Notiz
  beendet das Zeichnen und verkleinert das Feld sofort. Gespeichert wird die Handschrift als Striche; das Papierkorb-Symbol im Feld löscht es. **Marker:** Text in der
  Notiz markieren und das Marker-Symbol antippen hebt ihn gelb hervor (nochmal: entfernen). Das Notizfeld lässt sich
  immer herunterscrollen, auch wenn es leer ist. Das Farb-Icon oben im Feld gibt der
  Notiz eine Farbe (Symbol und Kopfzeile): zuletzt verwendete Farben, neue über den Farbkreis, einzelne Farben per
  „×“ aus der Liste löschen, „Ohne Farbe“ setzt zurück.
- **Sprünge zu Wörtern** – Suche (Enter: nächste Fundstelle, Shift+Enter: vorige, Zähler „2/5“), Sprünge zu
  Definitionen über den Index und „Zur Stelle“: Das Wort steht danach in der Mitte des Lesebereichs.
- **✂️ Ausschnitt** – Bereich mit Finger, Pencil oder Maus aufziehen: Der Ausschnitt wird scharf aus dem PDF
  gerendert (mit Notizen, auch über Seitengrenzen) und direkt in die Zwischenablage gelegt. Erlaubt der Browser
  das nicht, zeigt ein Fenster das Bild mit „Bild kopieren“, langem Drücken → Kopieren, Teilen/Sichern und Download.
- Das **Haus-Symbol** oben links im Skript führt zurück zum Startbildschirm.
- **PDF-Export mit oder ohne Notizen** – das Download-Icon öffnet ein kleines Menü: **Mit Notizen** erzeugt das
  Original-PDF mit den Notizen als Vektorgrafik an exakt derselben Stelle (auch bei gedrehten/beschnittenen
  Seiten; kopiergeschützte PDFs werden als Bild exportiert), **Ohne Notizen** gibt das unveränderte Original aus.
  Auf dem iPad öffnet sich das Teilen-Menü („In Dateien sichern“, AirDrop, GoodNotes …).

## Starten

```bash
npm install
npm run dev
```

Dann <http://localhost:5173> öffnen und ein Skript hochladen.

## Benutzerkonto (Vercel)

`middleware.ts` schützt die ganze Seite auf dem Server: ohne Anmeldung wird nichts von der App ausgeliefert.
Die Zugangsdaten stehen **nicht im Code**, sondern als Umgebungsvariablen in Vercel
(*Project → Settings → Environment Variables*, für **Production** und **Preview**):

| Variable | Inhalt |
| --- | --- |
| `AUTH_USER` | Benutzername |
| `AUTH_PASSWORD` | Passwort |
| `AUTH_SECRET` | optional: lange Zufallszeichenkette für die Sitzungs-Cookies |

Danach neu deployen. Fehlen die Variablen, bleibt die Seite gesperrt. Die Anmeldung gilt 30 Tage;
„Abmelden“ oben rechts beendet sie, ein Passwortwechsel meldet alle Geräte ab.
Lokal (`npm run dev`) gibt es keine Anmeldung.

## Online stellen (Vercel)

Vercel veröffentlicht `main` automatisch und baut für jeden Pull Request eine Vorschau
(Build-Befehl `npm run build`, Ausgabeordner `dist`). Der GitHub-Workflow `.github/workflows/ci.yml`
baut nur und prüft die Safari-Kompatibilität.

## iPad / Safari

Unterstützt wird Safari bzw. iPadOS ab **16.4**. pdf.js wird im **Legacy-Build** eingebunden, und
`src/lib/polyfills.ts` ergänzt im Hauptthread und im PDF-Worker, was Safari fehlt
(`ReadableStream`-Iteration, `Promise.withResolvers`).

```bash
npm run build && npm run check:safari   # Web-APIs + JS-Funktionen gegen Safari 16.4, ES2022-Syntax im Bundle
npx vite preview --port 4173 &
npm run test:safari                     # Smoke-Test: iPad-Emulation ohne die in Safari fehlenden APIs
npm run test:snip                       # Ausschnitt → Zwischenablage, ←/→ in der Stift-Leiste, Start-Symbol (gegen vite dev)
```

`test:safari` braucht Playwright mit Chromium. Die Erkennung und Verlinkung prüft
`npm run test:linking` (läuft gegen `npx vite --port 5173`) an `tests/linking/definitionen.pdf` samt verwandter
Wortformen; `npm run test:versions` lädt `tests/versions/skript-v1.pdf` und dann `skript-v2.pdf` als neue Version
hoch und prüft die Zuordnung der Notizen, `npm run test:compare` die Verbesserungsansicht, `npm run test:lasso` das Lasso, `npm run test:inkbar` die Stift- und Randleisten, `npm run test:jump` die Sprünge zu Wörtern, `npm run test:notesafari` Notiz öffnen/schließen mit nachgestelltem iPad-Safari-Verhalten, `npm run test:noteimage` die Bildgröße in Notizen. Der Smoke-Test ersetzt keinen Test auf einem echten iPad, deckt
aber fehlende APIs auf – auch im PDF-Worker.

## Datenschutz

Skripte, Index, Notizen und Abfrage-Statistik liegen in der IndexedDB deines Browsers, Einstellungen
und eigene Farben im `localStorage` – nichts davon verlässt das Gerät. Der Speicher ist pro Internetadresse
getrennt (eine Vercel-Vorschau oder eine eigene Domain beginnt leer). Unter **Einstellungen → Daten
exportieren** entsteht eine einzige Datei (`.mathe-backup`) mit allen Skripten samt PDFs, Notizen,
Verknüpfungen, Farben und Einstellungen; auf dem iPad über „Teilen → In Dateien sichern“. **Daten
importieren** liest sie wieder ein und fragt, ob ersetzt oder zusammengeführt werden soll.

## Technik

Vite + React + TypeScript, [pdf.js](https://mozilla.github.io/pdf.js/) für Darstellung und
Textebene, [pdf-lib](https://pdf-lib.js.org/) für den Export.
