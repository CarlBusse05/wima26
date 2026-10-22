# Wima: Wirtschaftsmathe-Plattform (lokal)

Kurse als Buttons, pro Kurs eine Timeline aus Skriptteilen, Übungsblättern und
Tutorien mit allen Dateien. Agentische Aufgaben erledigt **die lokale Claude-Installation
jedes Nutzers** über `claude -p`. Dafür braucht es keinen API-Key.

## Starten

    ./start.sh Carl              # Server (http://127.0.0.1:8790) + Carls Worker
    python3 server.py --lan      # nur Server, auch im WLAN (Handy-Upload, Emil)
    python3 worker.py --user Emil --server http://<Carls-IP>:8790   # Emil, auf seinem Mac

Voraussetzungen: Python 3.9+, `claude` (Claude Code, eingeloggt), `uv` und `tectonic`
(`brew install uv tectonic`).

## Aufbau

| Datei | Zweck |
|---|---|
| `server.py` | stdlib-HTTP-Server, SQLite (`data/wima.db`), Dateien in `data/files/`, Job-Queue |
| `public/index.html` | gesamte Oberfläche |
| `worker.py` | holt Jobs des Nutzers, startet `claude -p` in `arbeit/job<N>/`, lädt `output/` hoch |
| `prompts/*.md` | Anweisungen pro Job-Typ (`_basis.md` + Typ) |
| `tools/handschrift.py` | Kariertes Papier zu weißem Hintergrund, Durchgestrichenes entfernen, zuschneiden |
| `tools/vorlage_loesung.tex` | LaTeX-Kopf für die aufbereitete Abgabe |

## Drei Ebenen pro Eintrag

- **Original:** Blatt, Skriptteil, Musterlösung (für alle gleich)
- **Mein Bereich:** eigene Fotos, Notizen, aufbereitete Lösung, Vergleich, Begleitskript
- **Herde:** Beiträge aller, Herden-Skript (Original + alle Notizen + alle Begleitskripte)

## Job-Typen

| Typ | Eingaben | Ergebnis |
|---|---|---|
| `aufbereiten` | Fotos + Blatt | PDF: LaTeX-Kopf + bereinigte Handschrift |
| `vergleich` | eigene Lösung + Musterlösung + Blatt | `vergleich.md` pro Aufgabe |
| `skript_verbessern` | Skriptteil + eigene Notizen + Kursmaterial | `begleitskript.md` |
| `herde` | Skriptteil + Notizen/Begleitskripte aller | `herdenskript.md` |

Keine Authentifizierung. Nur lokal oder im vertrauenswürdigen Netz betreiben.
Später: Moodle-Sync als weiterer Job-Typ, Umstieg auf die API, indem nur `worker.py` ersetzt wird.
