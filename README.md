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
| `tools/vorlage_ausarbeitung.tex` | LaTeX-Vorlage für die getippte „Lösung“ |

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
| `loesung` | alle hochgeladenen Lösungen/Notizen (für alle) + Blatt | „Lösung“: eine saubere LaTeX-Lösung (PDF + .tex), Aufgabenstellung vor jeder Lösung, Fehler still korrigiert; `korrekturen.md` erscheint in der App. Startet nach jedem Upload, Löschen oder Prio-Umschalten |

Gemeinsame Jobs (`verbessern`, `lang`, `loesung`) nimmt zuerst der Worker dessen, der sie
angestoßen hat; läuft der gerade nicht, erledigt sie jeder andere laufende Worker. Persönliche
Jobs (`personalisieren`, `aufbereiten`, `vergleich`) bleiben beim jeweiligen Nutzer. Die Wissensbasis in
`wissen/` wird mit jedem Lauf fortgeschrieben, siehe `wissen/README.md`.

Die Anmeldung trennt Carl und Emil, ist aber kein Schutz für offene Netze. Nur lokal
oder im vertrauenswürdigen WLAN betreiben.
Später: Moodle-Sync als weiterer Job-Typ, Umstieg auf die API, indem nur `worker.py` ersetzt wird.

## Emil verbinden

Emil arbeitet auf wima26.de mit seinem eigenen Login (`emil`) und kann dort alles hochladen.
Damit auch **sein** Claude Aufträge erledigt (z. B. „Lang“, seine „Für Emil“-Version, Lösungen),
startet er auf seinem Mac einmalig den Worker:

1. Carl lädt Emil auf GitHub in das private Repo `CarlBusse05/wima26` ein.
2. Emil installiert Claude Code (und meldet sich an), außerdem `brew install uv tectonic`.
3. `git clone https://github.com/CarlBusse05/wima26.git && cd wima26 && ./start.sh Emil`
   Beim ersten Start fragt der Worker nach Emils Wima-Passwort und merkt sich danach den Login.

Solange das Terminalfenster offen ist, holt sich Emils Worker seine eigenen Aufträge und alle
gemeinsamen, die gerade niemand anders erledigt. Aktualisieren: `git pull`, dann neu starten.

## Vorausplanung

`stundenplan.json` beschreibt, wann welche Blätter erscheinen (Quelle: Kalender auf carlbusse.de).
Beim Öffnen eines Kurses legt der Server die Übungsblätter und Tutorien der nächsten 7 Tage
schon an, mit Abgabe- bzw. Tutoriumstermin im Titel. Ferienwochen und das Semesterende stehen
ebenfalls dort. Jeder Eintrag hat oben rechts „Hochladen“, der Kurs einen eigenen „Hochladen“-Knopf.
