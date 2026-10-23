## Aufgabe: verbesserte Version erstellen („Verbessert“, für alle)

Erstelle die verbesserte Fassung von „{{TITEL}}“ (Kurs {{KURS}}). Sie ist für alle Nutzer
gleich und ersetzt beim Lernen das Original. Lies zuerst `wissen/didaktik.md`. Das Konzept
ist verbindlich.

Eingaben:
- `input/{{ORDNER}}/`: das Original
- `input/kontext/`: die anderen Originale des Kurses (Vorlesungen, Übungs- und
  Tutoriumsblätter). Der Dateiname beginnt mit der Art.
- `input/vorherige_version/`: die bisherige verbesserte Fassung (`.tex` und `.pdf`), falls
  vorhanden
- `wissen/pruefkatalog.md`, `wissen/kurse/{{KUERZEL}}/stoff.md` (fehlt beim ersten Lauf)

### Schritt 1: Analyse → `work/befunde.md`
Geh das Original Abschnitt für Abschnitt durch, mit deinem Fachwissen und **jedem Punkt
des Prüfkatalogs**. Halte pro Befund fest:
- Stelle
- Typ: Fehler, Lücke, Randfall, Intuition, Notation, Beispiel
- Begründung
- Entscheidung nach `didaktik.md`: ergänzen, Denkanstoß oder weglassen, mit Grund

### Schritt 2: Abgleich mit den Blättern → ebenfalls `work/befunde.md`
{{ABGLEICH}}

### Schritt 3: Schreiben → `output/`
{{SCHREIBEN}}

Kopiere `{{TOOLS}}/vorlage_verbessert.tex` nach `work/verbessert.tex` und ersetze die Platzhalter:
- TITEL: „{{TITEL}}“
- KURS: „{{KURS}}“
- EBENE: „Verbessert“
- STAND: „Stand {{DATUM}}“

So wird ergänzt (siehe auch `didaktik.md`, Abschnitt „Form“):
- Jede Ergänzung steht genau an der Stelle, an der man sie beim Lesen braucht, und ist in
  den Satz oder Absatz eingebaut, sodass sich alles wie ein Dokument liest. Es gibt keine
  Kästen, keine Anhänge hinter einem Abschnitt, keine Überschriften wie „Ergänzung“ und
  keine Begründungen, warum etwas ergänzt wurde.
- Neuer oder ersetzter Text kommt in `\neu{…}`, längere Stellen kommen in
  `\begin{neutext} … \end{neutext}`. Eine Korrektur ist einfach der richtige Text in
  `\neu{…}` statt des falschen.
- Lässt du etwas aus dem Original weg, steht an der Stelle `\weg`.
- Alles andere bleibt wörtlich das Original, in Schwarz.

Kompiliere in `work/` mit `tectonic verbessert.tex` und behebe Fehler, bis es baut. Sieh dir
das PDF stichprobenartig an, mindestens die erste Seite und zwei Seiten mit Ergänzungen.
Prüfe, ob es sich flüssig liest.

Gibt es eine vorherige Version, baue darauf auf: Übernimm Bewährtes, bearbeite neue
Abschnitte vollständig und alte nur dort, wo sich das Original geändert hat oder du einen
neuen Befund hast.

Lege genau zwei Dateien in `output/`: `{{DATEINAME}}.pdf` und `{{DATEINAME}}.tex`.

### Schritt 4: Gegenlesen
Lies dein Ergebnis noch einmal kritisch gegen `didaktik.md`:
- Ist alles mathematisch korrekt?
- Wird eine Übungsaufgabe vorweggenommen?
- Ist alles Neue türkis und alles Schwarze wörtlich das Original?
- Liest es sich flüssig, ohne Meta-Kommentare?

Korrigiere und baue neu.

### Schritt 5: Wissensbasis fortschreiben
- `wissen/kurse/{{KUERZEL}}/stoff.md` anlegen bzw. aktualisieren, knapp und nach Abschnitten:
  - Begriffe und Sätze bisher, mit Nummer im Skript
  - Notation des Dozenten
  - welche Blätter was brauchen
  - gefundene Lücken
  - bearbeiteter Stand, z. B. „Analysis_I.pdf bis 2.4“
- `wissen/pruefkatalog.md`: Hast du eine Art von Problem gefunden, die allgemein nützlich ist
  und noch nicht drinsteht? Dann ergänze sie kurz, mit Beispiel und ohne Dopplungen.

In der Zusammenfassung: die wichtigsten 3 Ergänzungen bzw. Korrekturen und was im Prüfkatalog neu ist.
