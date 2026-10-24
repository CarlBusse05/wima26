## Aufgabe: Lernskript erstellen („Lang“, für alle)

Erstelle aus „{{TITEL}}“ (Kurs {{KURS}}) ein **Lernskript zum Selbstlernen**. Lies zuerst
`wissen/didaktik.md`, vor allem den Abschnitt „Ebene Lang“. Er ist verbindlich und
beschreibt Aufbau, Grafiken, Optik und Ton.

Grundlage ist die verbesserte Fassung: Alle Korrekturen und Ergänzungen von dort gehören
hinein. Du schreibst aber **neues Lernmaterial**, keine Kopie mit Zusätzen. Die Reihenfolge
der Vorlesung bleibt, jede Definition und jeder Satz verweist auf die Nummer im Skript.

Eingaben:
- `input/verbessert/`: die verbesserte Fassung (`.tex` und `.pdf`), deine Hauptquelle
- `input/skript/`: das Original, zum Nachschlagen der Nummern
- `input/kontext/`: andere Originale des Kurses, z. B. Blätter. Daran siehst du, was
  wichtig ist. Nicht vorlösen!
- `input/vorherige_version/`: ein früheres „Lang“, falls vorhanden. Es kann noch im alten
  Format sein, dann übernimmst du davon nur gute Erklärungen.
- `wissen/kurse/{{KUERZEL}}/stoff.md`, `wissen/pruefkatalog.md`. Persönliche Profile spielen
  hier keine Rolle, „Lang“ ist für alle gleich.

### Vorgehen
1. **Plan → `work/plan.md`:** Zerlege den Stoff in Kapitel und Lerneinheiten. Notiere pro
   Einheit: Titel, Skript-Nummern, die Grafik (oder „keine“), das Beispiel, das
   Gegenbeispiel, die Stolperfallen und die Kurz-Check-Fragen. Prüfe, dass jede Definition
   und jeder Satz aus „Verbessert“ in einer Einheit vorkommt.
2. **Vorlage:** Kopiere `{{TOOLS}}/vorlage_lernskript.tex` nach `work/lang.tex`. Ersetze
   TITEL durch „{{TITEL}}“, KURS durch „{{KURS}}“ und STAND durch „Stand {{DATUM}}“. Benutze
   **nur** die Bausteine der Vorlage (siehe Kommentar oben in der Datei).
3. **Schreiben:** Arbeite **Kapitel für Kapitel** und ändere `work/lang.tex` mit Edit, nicht
   in einem einzigen riesigen Write. Halte dich bei jeder Einheit an das Gerüst aus
   `didaktik.md`. Nach jedem Kapitel kommen der Spickzettel und die Lösungen der
   Kurz-Checks. Ganz hinten stehen Glossar und Symboltabelle.
4. **Bauen und ansehen:** Kompiliere nach jedem Kapitel mit `tectonic lang.tex` in `work/`.
   Sieh dir jede Seite mit einer Grafik als Bild an (z. B. mit
   `uvx --from pymupdf python -c "import fitz; d=fitz.open('lang.pdf'); d[N].get_pixmap(dpi=70).save('seite.png')"`
   und Read). Prüfe: Stimmt die Grafik mathematisch? Ist alles beschriftet? Läuft nichts
   über den Rand?
5. **Gegenlesen:**
   - Ist jede Ergänzung mathematisch korrekt?
   - Ist jede Einheit vollständig nach dem Gerüst?
   - Wird keine Übungsaufgabe vorgelöst?
   - Liest es sich leicht und nicht gequetscht?
6. Lege genau zwei Dateien in `output/`: `{{DATEINAME}}.pdf` und `{{DATEINAME}}.tex`.
7. Ergänze `wissen/kurse/{{KUERZEL}}/stoff.md`, wenn dir beim Erklären neue Zusammenhänge
   oder typische Schwierigkeiten aufgefallen sind.

In der Zusammenfassung: Seitenzahl, Anzahl Kapitel, Einheiten und Grafiken, und welche
Stellen am meisten Aufbereitung gebraucht haben.
