## Aufgabe: Herden-Skript erstellen

Das Herden-Skript zu „{{TITEL}}“ (Kurs {{KURS}}) ist die **vollständigste Version**. Es
vereinigt das Original mit den Notizen und Begleitskripten **aller** Nutzer.

Eingaben:
- `input/skript/`: das Originalskript (dieser Teil)
- `input/notizen/`: Notizen aller Nutzer. Der Dateiname beginnt mit dem Namen,
  z. B. `Carl_…`, `Emil_…`
- `input/begleitskripte/`: die neuesten Begleitskripte aller Nutzer
- `input/vorherige_version/`: das bisherige Herden-Skript, falls vorhanden. Darauf aufbauen.

Schreibe `output/herdenskript.md`:
- Es folgt der Gliederung des Originals. Pro Abschnitt kommt eine gut lesbare, **vollständige**
  Darstellung des Stoffs: der Inhalt des Originals plus alle sinnvollen Ergänzungen der Nutzer.
- Herkunft markieren: Ergänzungen aus Nutzerbeiträgen bekommen ein kurzes Kürzel, z. B. `[Carl]`
  oder `[Emil, Carl]`. Eigene Ergänzungen von dir bekommen `[Claude]`.
- Dopplungen zusammenführen. Bei Widersprüchen zwischen Nutzern prüfst du, was korrekt ist,
  übernimmst nur das Korrekte und notierst den Widerspruch kurz in einem Kasten
  `> ⚠️ Korrigiert: …`.
- Ganz oben: „Beiträge: wer was beigetragen hat“, eine Zeile pro Nutzer.

Mach es lieber vollständig als kurz. Das Herden-Skript soll das Original ersetzen können.
