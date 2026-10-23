## Aufgabe: persönliche Version erstellen („Für {{USER}}“)

Erstelle die persönliche Fassung von „{{TITEL}}“ (Kurs {{KURS}}) für {{USER}}. Sie ist die
verbesserte Fassung, zugeschnitten auf {{USER}}s typische Fehler und eigene Notizen.
`wissen/didaktik.md` gilt auch hier.

Eingaben:
- `input/{{ORDNER}}/`: das Original
- `input/verbessert/`: die ausführlichste Fassung für alle („Lang“, sonst „Verbessert“,
  jeweils `.tex` und `.pdf`). Fehlt sie, arbeite direkt mit dem Original.
- `input/notizen/`, `input/vergleich/`, `input/fotos/`: {{USER}}s eigene Notizen,
  Vergleiche mit der Musterlösung und Lösungen, soweit vorhanden
- `input/vorherige_version/`: die bisherige persönliche Fassung, falls vorhanden
- `wissen/personen/{{USER}}.md`: {{USER}}s Fehlerprofil (fehlt am Anfang)

Vorgehen:
1. Gibt es Vergleiche oder Lösungen, die im Fehlerprofil noch nicht berücksichtigt sind,
   aktualisiere zuerst `wissen/personen/{{USER}}.md`. Schreib keine einzelnen Fehler auf
   („A2 falsch“), sondern abstrahierte Muster („übersieht Fälle, in denen Variablen gleich
   sind“), jeweils mit Beleg. Ein Muster gilt als **gesichert**, wenn es mindestens zweimal
   belegt ist. Davor ist es **Verdacht**.
2. Nimm `input/verbessert/*.tex` als Grundlage. Ohne verbesserte Fassung nimmst du die Vorlage
   `{{TOOLS}}/vorlage_verbessert.tex`. Setze EBENE auf „Für {{USER}}“ und STAND auf
   „Stand {{DATUM}}“.
3. Baue persönliche Ergänzungen genauso nahtlos ein wie in „Verbessert“, aber in Magenta:
   `\fuer{…}` bzw. `\begin{fuertext} … \end{fuertext}`. Das ist der Fall
   - wo im Stoff {{USER}}s Muster zuschlagen können: ein Satz, der genau darauf aufmerksam
     macht, ohne Meta-Kommentar
   - wo {{USER}}s Notizen etwas ergänzen oder anders erklären

   Türkise Stellen aus „Verbessert“ bleiben unverändert. Ohne Profil und ohne Notizen lässt
   du das Dokument bis auf EBENE unverändert und schreibst das in die Zusammenfassung.
4. Kompiliere mit `tectonic` in `work/` und kontrolliere das PDF.
5. Lege genau zwei Dateien in `output/`: `{{DATEINAME}}.pdf` und `{{DATEINAME}}.tex`.

In der Zusammenfassung: welche Muster berücksichtigt wurden und was neu im Profil ist.
