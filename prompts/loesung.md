## Aufgabe: saubere Lösung erstellen („Lösung“, für alle)

Aus allem, was zu „{{TITEL}}“ (Kurs {{KURS}}) an Lösungen und Notizen hochgeladen wurde,
entsteht **eine** saubere, getippte Lösung in LaTeX. Es gibt immer nur diese eine Lösung.
Jeder Lauf baut sie aus allen aktuellen Uploads neu.

Eingaben:
- `input/aufgabe/`: das Blatt mit den Aufgabenstellungen (kann fehlen)
- `input/teile/`: die Uploads. Meist Fotos von handschriftlichen Lösungen, aber auch PDFs,
  Scans oder Text. Oft nur Teile: eine einzelne Aufgabe, ein halber Rechenweg, eine
  Randnotiz aus dem Tutorium. Die Zahl im Dateinamen steigt mit dem Upload-Zeitpunkt.
  **Beginnt der Name mit `prio_`, ist der Teil priorisiert**, z. B. weil es die Lösung des
  Tutors ist.
- `input/vorherige_version/`: die bisherige Lösung als `.tex`, falls vorhanden

### Schritt 1: Bestandsaufnahme → `work/bestand.md`
Sieh dir jeden Teil vollständig an (PDFs und Bilder mit dem Read-Tool). Halte pro Teil fest,
zu welchen Aufgaben und Teilaufgaben er etwas enthält und ob es eine Lösung oder eine Notiz
ist. Ordne dabei auch Teile zu, bei denen die Aufgabennummer fehlt, anhand des Inhalts.
Unleserliches notierst du, statt zu raten.

### Schritt 2: Auswahl pro Teilaufgabe
- Gibt es zu einer Teilaufgabe einen **priorisierten** Teil, nimm dessen Lösung, bei
  mehreren den neuesten.
- Sonst gibt es oft mehrere Versionen. Nimm die **beste**: korrekt, vollständig, sauber
  argumentiert. Fehlt in der besten Version ein Schritt, den eine andere hat, darfst du ihn
  von dort übernehmen.
- **Notizen werden übernommen.** Ein Hinweis aus dem Tutorium, eine Alternative, eine
  Bemerkung zur Schreibweise: Bau den Inhalt knapp an der Stelle ein, an die er gehört.
  Ohne Hinweis auf die Quelle.
- Eine Teilaufgabe, zu der es gar nichts gibt, fehlt im Dokument, auch ihre Stellung.
  Bricht eine Lösung mittendrin ab, führe sie zu Ende.

### Schritt 3: Prüfen und korrigieren
Prüfe jede ausgewählte Lösung mathematisch Schritt für Schritt, auch priorisierte. Fehler
(Rechenfehler, falsche Folgerungen, vergessene Fälle, fehlende Voraussetzungen, falsche
Notation) korrigierst du **direkt im Text**. Im Dokument steht nur das Richtige. Es gibt
keine Markierung und keinen Hinweis darauf, was korrigiert wurde. Halte jede Korrektur in
`work/korrekturen.md` fest.

### Schritt 4: Schreiben → `output/`
Kopiere `{{TOOLS}}/vorlage_ausarbeitung.tex` nach `work/loesung.tex` und ersetze:
- TITEL: „{{TITEL}}“
- KURS: „{{KURS}}“
- STAND: „Stand {{DATUM}}“

Aufbau, nach Aufgabennummer sortiert:
- `\aufgabe{Nummer}{Punkte}`, Punkte nur, wenn sie auf dem Blatt stehen, sonst `{}`
- pro Teilaufgabe `\teil{a)}`, dann die Aufgabenstellung **wörtlich** vom Blatt in
  `\begin{stellung} … \end{stellung}` und die Lösung in `\begin{loesung} … \end{loesung}`.
  Aufgaben ohne Teilaufgaben haben kein `\teil`. Fehlt das Blatt, schreib die Stellung so,
  wie sie aus den Teilen hervorgeht.

Die Lösung ist wie eine gute Musterlösung: vollständig und lückenlos, aber knapp. **Keine
Erklärungen**, keine Ideen-Absätze, keine Lernhinweise, keine Kommentare zu den Uploads.
Gerechnet und argumentiert wird nur, was zur Lösung gehört. Halte dich an den Weg und die
Notation der gewählten Version, solange sie richtig sind.

Gibt es eine vorherige Version, nutze sie, um Handschrift schneller zu lesen und Form und
Formulierungen beizubehalten, wo sich nichts geändert hat. Inhaltlich zählt nur, was in den
aktuellen Teilen steht: Eine Aufgabe, zu der kein Teil mehr existiert, fällt weg.

Kompiliere in `work/` mit `tectonic loesung.tex` und behebe Fehler, bis es baut. Sieh dir
jede Seite des PDFs an.

Lege genau drei Dateien in `output/`:
- `{{DATEINAME}}.pdf` und `{{DATEINAME}}.tex`
- `korrekturen.md`: erscheint in der App neben der Lösung. Eine knappe Liste, was
  gegenüber den Uploads grob verändert wurde, pro Aufgabe ein Punkt, Mathe als `$…$`. Gemeint
  sind Korrekturen, zu Ende geführte Lösungen und, wo es mehrere Versionen gab, welche
  genommen wurde (z. B. „priorisierte Version“, „Version vom zweiten Upload“). Sie gilt für
  das ganze aktuelle Dokument, nicht nur für die Änderungen seit dem letzten Lauf. Gab es
  nichts zu ändern: `Keine Korrekturen.` Ohne Überschrift.

### Schritt 5: Gegenlesen
- Ist jede Lösung mathematisch korrekt und vollständig?
- Steht vor jeder Lösung die Aufgabenstellung?
- Steht nirgends eine Erklärung, ein Meta-Kommentar oder eine Korrekturmarkierung?
- Stimmt `korrekturen.md` mit dem Dokument überein?

In der Zusammenfassung: welche Aufgaben die Lösung jetzt enthält und was unleserlich oder
unsicher war.
