# Wima: Wirtschaftsmathe-Plattform (lokal)

Kurse als Buttons, pro Kurs eine Timeline aus Vorlesungen, Übungsblättern und
Tutorien mit allen Dateien. Agentische Aufgaben erledigt **die lokale Claude-Installation
jedes Nutzers** über `claude -p`. Dafür braucht es keinen API-Key.

## Starten

    ./start.sh Carl              # Server (http://127.0.0.1:8790) + Carls Worker
    python3 server.py --lan      # nur Server, auch im WLAN (Handy-Upload, Emil)
    python3 worker.py --user Emil --server http://<Carls-IP>:8790   # Emil, auf seinem Mac (fragt nach seinem Passwort)

Anmeldung mit Nutzername (`carl` / `emil`) und Passwort. Passwörter werden von Hand gesetzt:
`uv run --python 3.12 --with "psycopg[binary]" tools/passwort.py Carl`.

Voraussetzungen: Python 3.9+, `claude` (Claude Code, eingeloggt), `uv` und `tectonic`
(`brew install uv tectonic`).

## Aufbau

| Datei | Zweck |
|---|---|
| `server.py` | stdlib-HTTP-Server, SQLite (`data/wima.db`), Dateien in `data/files/`, Job-Queue |
| `public/index.html` | gesamte Oberfläche |
| `worker.py` | holt Jobs des Nutzers, startet `claude -p` in `arbeit/job<N>/`, lädt `output/` hoch |
| `prompts/*.md` | Anweisungen pro Job-Typ (`_basis.md` + Typ) |
| `wissen/` | Wissensbasis: Didaktik, Prüfkatalog, Kursgedächtnis, Fehlerprofile |
| `tools/vorlage_verbessert.tex` | LaTeX-Vorlage für „Verbessert“ und „Für …“ mit Ergänzungskästen |
| `tools/handschrift.py` | Kariertes Papier zu weißem Hintergrund, Durchgestrichenes entfernen, zuschneiden |
| `tools/vorlage_loesung.tex` | LaTeX-Kopf für die aufbereitete Abgabe |

## Drei Ebenen pro Eintrag

- **Original:** Skript bzw. Blatt, Musterlösung (für alle gleich)
- **Verbessert:** die von Claude verbesserte Version (für alle gleich)
- **Für Carl / Für Emil:** eigene Lösung, Notizen, aufbereitete Lösung, Vergleich, persönliche Version

Wie „Verbessert“ und „Für …“ entstehen sollen: `docs/plan-optimierung.md`.

## Job-Typen

| Typ | Eingaben | Ergebnis |
|---|---|---|
| `verbessern` | Original + andere Originale des Kurses + `wissen/` | „Verbessert“ (PDF + .tex), für alle; startet automatisch bei neuem Original |
| `personalisieren` | Verbessert + eigene Notizen/Vergleiche + Fehlerprofil | „Für <Name>“ (PDF + .tex); startet nach `verbessern` und `vergleich` |
| `aufbereiten` | Fotos + Blatt | PDF: LaTeX-Kopf + bereinigte Handschrift |
| `vergleich` | eigene Lösung + Musterlösung + Blatt | `vergleich.md` pro Aufgabe, Fehlerprofil wird ergänzt |

`verbessern` erledigt der Worker von `WIMA_HAUPT` (Standard: Carl). Die Wissensbasis in
`wissen/` wird mit jedem Lauf fortgeschrieben, siehe `wissen/README.md`.

Die Anmeldung trennt Carl und Emil, ist aber kein Schutz für offene Netze. Nur lokal
oder im vertrauenswürdigen WLAN betreiben.
Später: Moodle-Sync als weiterer Job-Typ, Umstieg auf die API, indem nur `worker.py` ersetzt wird.
