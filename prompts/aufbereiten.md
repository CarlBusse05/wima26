## Aufgabe: handschriftliche Lösung aufbereiten

In `input/fotos/` liegen Fotos von {{USER}}s handschriftlicher Lösung zu „{{TITEL}}“.
In `input/aufgabe/` liegt eventuell das Aufgabenblatt. Daraus soll ein sauberes PDF
entstehen, das abgegeben werden kann. **Die Handschrift bleibt erhalten**, weil manche
Kurse eine handschriftliche Abgabe verlangen. Tippe die Lösung also NICHT ab.

Werkzeug: `uv run {{TOOLS}}/handschrift.py` (`--help` zeigt alle Befehle).

1. **Reihenfolge:** Schau dir jedes Foto an und lege die richtige Seitenreihenfolge fest,
   z. B. nach Aufgabennummern.
2. **Bereinigen:** Für jedes Foto:
   `uv run {{TOOLS}}/handschrift.py saeubern input/fotos/X.jpg work/seiteN.png`
   Das entfernt das karierte bzw. linierte Papier, macht den Hintergrund weiß und
   verstärkt die Tinte. Bei schiefen oder schlecht belichteten Fotos kannst du `--staerke`
   anpassen oder mit `zuschneiden` arbeiten.
3. **Durchgestrichenes entfernen:**
   `uv run {{TOOLS}}/handschrift.py raster work/seiteN.png work/seiteN_raster.png`
   Sieh dir das Rasterbild an und bestimme die Pixel-Rechtecke aller durchgestrichenen
   oder ausgekritzelten Stellen. Entferne sie dann mit
   `uv run {{TOOLS}}/handschrift.py weiss work/seiteN.png work/seiteN.png --boxen "x1,y1,x2,y2;..."`.
   Kontrolliere das Ergebnis mit Read. Sei vorsichtig: Lieber eine durchgestrichene Stelle
   stehen lassen als gültige Rechnung löschen. Lösch nur, was eindeutig durchgestrichen ist.
4. **Leerraum:** Ist durch das Löschen eine große Lücke entstanden oder hat die Seite viel
   leeren Rand, schneide mit `zuschneiden` zu.
5. **PDF bauen:** Kopiere `{{TOOLS}}/vorlage_loesung.tex` nach `work/loesung.tex` und fülle
   die Platzhalter aus:
   - Titel „{{TITEL}}“
   - Kurs „{{KURS}}“
   - Name {{USER}}
   - Datum {{DATUM}}
   - Bilder in Seitenreihenfolge

   Steht auf dem Aufgabenblatt eine Abgabegruppe oder Ähnliches, lass sie weg. Nur, was
   wirklich bekannt ist. Kompiliere im Ordner `work/` mit `tectonic loesung.tex`.
   Ist `tectonic` nicht installiert, versuch es mit `pdflatex`. Fehlt beides, brich mit
   einer klaren Fehlermeldung ab.
6. Kopiere das fertige PDF als `output/{{ART}}_{{NUMMER}}_{{USER}}.pdf` (Leerzeichen durch
   `_` ersetzen). Sieh dir die erste Seite des PDFs zur Kontrolle an.

In der Zusammenfassung: Wie viele Seiten? Was hast du entfernt? Gab es Stellen, bei denen
du unsicher warst?
