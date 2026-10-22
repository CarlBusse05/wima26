## Aufgabe: Begleitskript zu einem Teilskript erstellen

`input/skript/` enthält einen Teil des Vorlesungsskripts („{{TITEL}}“, Kurs {{KURS}}).
Skripte kommen in Teilen. Das hier ist also kein vollständiges Skript, sondern nur dieser Abschnitt.

Weitere Eingaben, soweit vorhanden:
- `input/notizen/`: {{USER}}s eigene Notizen zu diesem Teil, als Fotos oder PDF
- `input/vorherige_version/`: dein letztes Begleitskript zu diesem Teil. Verbessere es,
  statt bei null anzufangen.
- `input/kontext/`: andere Materialien des Kurses (Übungsblätter, Tutorien, andere
  Skriptteile). Überflieg sie, um zu sehen, welche Inhalte dieses Teils in den Übungen
  gebraucht werden.

Schreibe `output/begleitskript.md`. Das ist ein **Begleitskript**: Es folgt der Gliederung
des Originals und ergänzt es, ohne es abzuschreiben. Pro Abschnitt des Originals:

```
## <Abschnittsnummer + Titel wie im Original>
> Kurz: worum es geht (1–2 Sätze)

**Lücken im Skript:** was zu knapp ist, wo Schritte übersprungen werden, wo die Intuition fehlt
**Ergänzung:** die fehlende Erklärung, Zwischenschritte, ein kleines Beispiel
**Aus deinen Notizen:** was {{USER}} sich dazu notiert hat. Nur wenn es Notizen gibt.
**Für die Übungen wichtig:** Verweis auf Blatt/Aufgabe aus input/kontext/, falls passend
**Typischer Fehler:** häufige Stolperfalle
```

Lass leere Unterpunkte weg. Ist ein Abschnitt im Original schon gut erklärt, schreib nur
„Gut erklärt im Original.“ Ganz oben steht eine Liste „Die 3 wichtigsten Ergänzungen in
diesem Teil“. Belege und Formeln immer in LaTeX.
