## Aufgabe: ausführliche Fassung erstellen („Lang“, für alle)

Erstelle die ausführliche Fassung von „{{TITEL}}“ (Kurs {{KURS}}). „Lang“ enthält **alles
aus „Verbessert“** und erklärt so ausführlich, dass man den Stoff ohne die Vorlesung
versteht. Lies zuerst `wissen/didaktik.md`, vor allem den Abschnitt „Ebene Lang“. Er ist
verbindlich.

Eingaben:
- `input/skript/`: das Original
- `input/verbessert/`: die verbesserte Fassung (`.tex` und `.pdf`). Das ist deine Grundlage.
- `input/vorherige_version/`: die bisherige Fassung „Lang“, falls vorhanden. Darauf aufbauen.
- `input/kontext/`: andere Originale des Kurses, z. B. Blätter. Daran siehst du, welche
  Stellen besonders wichtig sind.
- `wissen/kurse/{{KUERZEL}}/stoff.md`, `wissen/pruefkatalog.md`

### Vorgehen
1. Kopiere `input/verbessert/*.tex` nach `work/lang.tex`. Setze EBENE auf „Lang“ und STAND
   auf „Stand {{DATUM}}“. Alle Ergänzungen aus „Verbessert“ bleiben erhalten. Fehlt
   `\alleschwarz` direkt vor `\begin{document}`, füge es dort ein. „Lang“ wird komplett
   schwarz gesetzt (siehe unten).
2. Arbeite das Dokument **Abschnitt für Abschnitt** durch und ergänze nach „Ebene Lang“:
   - vor jedem Beweis „Zu zeigen:“ und die Beweisidee
   - in Beweisen jeden Schritt begründen
   - nach jeder Definition Bedeutung, Motivation und ein kleines durchgerechnetes Beispiel
   - nach jedem Satz eine Einordnung
   - am Kapitelanfang eine Landkarte, am Kapitelende eine Zusammenfassung
   - Erinnerungen an die Notation

   Frag dich an jeder Stelle: Würde jemand, der nicht in der Vorlesung war, hier hängen
   bleiben? Wenn ja, erkläre es.
3. Form: Alles Neue kommt in `\neu{…}` bzw. `neutext` und wird nahtlos in den Text eingebaut.
   Wegen `\alleschwarz` erscheint es schwarz, die Herkunft bleibt aber im `.tex` erkennbar.
   Das Original bleibt wörtlich. Es gibt keine Kästen und keine Meta-Kommentare.
4. Das Dokument wird lang. Bearbeite es deshalb in Teilen: Schreib und ändere `work/lang.tex`
   abschnittsweise mit Edit, nicht in einem einzigen riesigen Write. Kompiliere
   zwischendurch mit `tectonic lang.tex`, damit Fehler früh auffallen.
5. Gegenlesen: Stimmt jede Ergänzung mathematisch? Hat jeder Beweis „Zu zeigen“ und eine
   Beweisidee? Wird keine Übungsaufgabe vorgelöst? Sieh dir mehrere Seiten des PDFs an.
6. Lege genau zwei Dateien in `output/`: `{{DATEINAME}}.pdf` und `{{DATEINAME}}.tex`.
7. Ergänze `wissen/kurse/{{KUERZEL}}/stoff.md`, wenn dir beim Erklären neue Zusammenhänge
   oder Schwierigkeiten aufgefallen sind, und den Prüfkatalog, wenn du eine neue allgemeine
   Prüfregel gefunden hast.

In der Zusammenfassung: Seitenzahl vorher und nachher, und welche Stellen am meisten
Erklärung gebraucht haben.
