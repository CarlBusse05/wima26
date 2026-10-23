# Plan: Automatische Optimierung („Verbessert“ und „Für Carl/Emil“)

Stand 22.10.2026, Entwurf zur Diskussion.

## Ziel

Für jede Vorlesung soll Claude zwei Dinge erzeugen:

1. **Verbessert** (für alle gleich): das Skript, ergänzt um das, was fehlt. Dazu gehören
   Fehler, Lücken, Randfälle, Intuition und Verweise auf die Übungen.
2. **Für Carl / Für Emil** (persönlich): eine kleine Ergänzung zu „Verbessert“. Sie ist auf
   die typischen Fehler der Person zugeschnitten, die sich aus ihren Abgaben ergeben.

Jeder Lauf ist ein neuer `claude -p` ohne Gedächtnis. Gut wird es nur, wenn das Wissen,
das sich ansammelt, **außerhalb von Claude** liegt: als Dateien im Repo, die jeder Lauf
liest und die gezielt fortgeschrieben werden. Darin besteht der Lerneffekt. Das Modell
ändert sich nicht, aber seine Anweisungen und sein Kontext werden mit jedem Lauf besser.

## 1. Die Wissensbasis (`wissen/`)

Sie wird versioniert in git abgelegt. Jeder Job bekommt sie als Eingabe.

| Datei | Inhalt | Wer schreibt |
|---|---|---|
| `wissen/didaktik.md` | Das didaktische Konzept, siehe Abschnitt 4. Was ergänzt wird, was bewusst nicht, in welcher Form. | Carl (Claude schlägt vor) |
| `wissen/pruefkatalog.md` | Wonach jedes Skript abgesucht wird, z. B. Randfälle wie die leere Menge, gleiche Elemente, n = 0, Quantoren-Reihenfolge, „verschieden“ vs. „beliebig“. Die Liste wächst. | Claude schlägt vor, Carl übernimmt |
| `wissen/kurse/<kurs>/stoff.md` | Das Kursgedächtnis: Begriffe und Sätze bis jetzt, die Notation des Dozenten, was in welchen Übungen gebraucht wurde, gefundene Lücken und bis zu welchem Abschnitt schon bearbeitet wurde. | Claude, automatisch |
| `wissen/personen/<name>.md` | Fehlerprofil, abstrahiert und mit Belegen. Beispiel: „Nimmt bei Aussagen über mehrere Variablen stillschweigend an, dass sie verschieden sind (Blatt 1, A2: Transitivität).“ | Claude aus den Vergleichen, die Person bestätigt |

Dein Transitivitäts-Fehler würde so an **zwei** Stellen landen. Im Prüfkatalog steht er als
allgemeine Regel: „Bei Definitionen mit mehreren Variablen prüfen, was passiert, wenn
Variablen gleich sind.“ Damit findet Claude das bei jedem künftigen Skript. In deinem
Profil steht er als persönliches Muster.

## 2. Job „verbessern“ (Ebene Verbessert)

Ein Knopf im Abschnitt „Verbessert“ startet ihn: **„Verbesserte Version erstellen“**.
Später läuft er auch automatisch, siehe Abschnitt 5. Der Worker gibt Claude:

- den Skriptteil (Original)
- `wissen/didaktik.md`, `wissen/pruefkatalog.md`, `wissen/kurse/<kurs>/stoff.md`
- alle Übungs- und Tutoriumsblätter des Kurses, später auch Altklausuren
- die vorherige verbesserte Version, falls vorhanden

Claude arbeitet in festen Schritten. Jeder Schritt schreibt eine Datei, damit man
nachvollziehen kann, warum etwas ergänzt wurde.

1. **Analyse → `work/befunde.json`.** Claude geht das Skript Abschnitt für Abschnitt durch,
   mit Fachwissen und dem Prüfkatalog. Jeder Befund hat diese Felder:
   - Typ: Fehler, Lücke, Randfall, fehlende Intuition, Notation, fehlendes Beispiel
   - Stelle im Skript
   - Begründung
   - Priorität
   - didaktische Entscheidung: *ergänzen*, *als Denkanstoß* oder *weglassen*, mit Grund
2. **Abgleich mit den Blättern.** Für jede Aufgabe auf den Übungs- und Tutoriumsblättern:
   Welche Begriffe und Techniken braucht sie, und stehen die im Skript? Was fehlt, wird
   als weiterer Befund aufgenommen, z. B. „Ü1 A3 braucht X, Skript erwähnt X nicht“.
   Das deckt Lücken auf, die Claude allein nicht gesehen hätte.
3. **Schreiben → `output/verbessert.md`.** Die Gliederung des Originals bleibt erhalten.
   Ergänzungen stehen als markierte Kästen im Text, damit klar ist, was vom Dozenten stammt:
   - 💡 **Intuition**
   - ⚠️ **Randfall** (z. B. x = y = z bei Transitivität)
   - ❌ **Korrektur**
   - 🔍 **Selbst prüfen**: eine Frage, die Antwort ist aufklappbar
   - 🔗 **Gebraucht in** Ü1 A3
4. **Gegenlesen.** Ein zweiter, kurzer Claude-Lauf liest das Ergebnis gegen `didaktik.md`:
   Ist alles mathematisch korrekt? Wird zu viel vorweggenommen? Sind die Markierungen
   vollständig? Er korrigiert, was nötig ist.
5. **Lernen → `output/vorschlaege.md`.** Claude schlägt vor:
   - neue Einträge für den Prüfkatalog
   - Updates für `stoff.md`
   - Änderungen an `didaktik.md`

   `stoff.md` wird direkt übernommen. Prüfkatalog und Didaktik zeigt die App als
   Vorschlag mit „Übernehmen“ / „Verwerfen“. Damit bleibt die Wissensbasis sauber und
   wird nicht mit jedem Lauf beliebiger.

Ins Ergebnis kommt ein Kopf mit Prompt-Version, Wissensstand (git-Commit) und Eingaben.
So lässt sich später sagen, warum zwei Versionen verschieden sind.

**Wachsendes Skript:** Analysis_I.pdf wird als ein PDF immer länger (v4). `stoff.md`
merkt sich, bis zu welchem Abschnitt bearbeitet wurde. Ein neuer Lauf bearbeitet nur neue
Abschnitte vollständig und prüft alte nur auf Änderungen. Das spart Zeit und hält
die Version stabil.

## 3. Job „personalisieren“ (Ebene Für Carl / Für Emil)

Er hat zwei Eingaben.

1. **Fehlerprofil aktualisieren.** Nach jedem `vergleich`-Job, also eigene Lösung gegen
   Musterlösung, abstrahiert Claude die Fehler zu Mustern. Es heißt dann nicht „A2 falsch“,
   sondern „Gleichheitsfälle übersehen“. Diese Muster landen in
   `wissen/personen/<name>.md`, jeweils mit Beleg. Ein Muster gilt erst als gesichert,
   wenn es zweimal auftaucht oder die Person es bestätigt.
2. **`output/fuer_<name>.md` erzeugen.** Das ist keine Kopie von „Verbessert“, sondern
   nur der Unterschied dazu:
   - wo im aktuellen Stoff die eigenen Muster zuschlagen können
   - 1–3 gezielte Übungsfragen dazu
   - die eigenen Notizen eingearbeitet

Der bisherige Job `skript_verbessern` (Begleitskript) geht darin auf. `herde` fällt weg,
weil „Verbessert“ diese Rolle übernimmt.

**Datenschutz unter euch:** Das Fehlerprofil ist persönlich. Vorschlag: Jeder sieht nur
sein eigenes.

## 4. Didaktisches Konzept (Entwurf für `wissen/didaktik.md`)

Die Spannung ist: Ein gutes Skript spart Zeit, aber wer nie ins kalte Wasser muss, lernt
das Beweisen nicht. Vorschlag für die Grundregel:

> **Das verbesserte Skript erklärt Begriffe vollständig, löst aber keine Aufgaben vor.**

| Ergänzen (ja) | Nur als Denkanstoß | Nicht |
|---|---|---|
| Randfälle von Definitionen (gleiche Elemente, leere Menge) | Beweisideen zu Sätzen, die das Skript ohne Beweis lässt | Lösungen oder Lösungswege zu Übungsaufgaben |
| Intuition, Skizzen in Worten, Beispiele und Gegenbeispiele | „Versuch zuerst selbst: …“ mit gestaffelten, aufklappbaren Hinweisen | Beweise ausformulieren, die Übungsstoff sind |
| Fehler und Unklarheiten im Skript | Querverbindungen, die man selbst entdecken kann | |
| Fehlende Voraussetzungen und Zwischenschritte in Beweisen | | |

Randfälle sind genau dein Transitivitäts-Beispiel. Sie zu kennen öffnet das Auge, nimmt
aber keinen Beweis vorweg. Darum gehören sie ins Skript. Die Kästen „Selbst prüfen“
sorgen dafür, dass man beim Lesen aktiv bleibt.

**Altklausuren** sind später die Gewichtung: Was dort oft vorkommt, bekommt in den Befunden
eine höhere Priorität. Typische Aufgabenformate werden im Kursgedächtnis notiert.

## 5. Auslöser

| Ereignis | Folge |
|---|---|
| Knopf „Verbesserte Version erstellen“ | Job `verbessern` |
| Neues Original in einer Vorlesung (neue Skriptversion) | Job `verbessern` automatisch |
| Neues Übungs- oder Tutoriumsblatt | Abgleich gegen die bisherigen Vorlesungen (Schritt 2), bei neuen Befunden `verbessern` |
| `vergleich` fertig | Fehlerprofil aktualisieren, danach `personalisieren` für die Person |
| Später: Moodle-Sync | Lädt neue Dateien, der Rest folgt aus den Zeilen oben |

Das bleibt beim jetzigen Aufbau: Die Website legt Jobs an, der eigene Worker holt sie und
startet das lokale `claude -p` mit dem eigenen Abo. Den gemeinsamen Job `verbessern` sollte
nur ein Worker übernehmen, damit er nicht doppelt läuft. Vorschlag: Carls Worker.

**Skill oder Prompt?** Ein Claude-Code-Skill bringt hier wenig. Der Worker baut den Prompt
sowieso fest zusammen, aus `prompts/` und `wissen/`. Das ist deterministischer als ein
Skill, den Claude selbst laden muss. Die Prompts bekommen eine Versionsnummer.

## 6. Reihenfolge der Umsetzung

1. **Grundgerüst:**
   - `wissen/` mit Didaktik-Entwurf und Start-Prüfkatalog anlegen
   - Job `verbessern` in einem Lauf (Analyse, Abgleich, Schreiben) mit Knopf in der App
   - Test an Analysis Vorlesung 1 mit Blatt 1 und Tut 1
2. **Qualität:** Gegenlese-Lauf, Lernvorschläge mit „Übernehmen“ in der App, Versionskopf
3. **Persönlich:** Fehlerprofil aus `vergleich`, Job `personalisieren`. Voraussetzung sind
   echte Abgaben und Musterlösungen.
4. **Automatik:** Auslöser aus Abschnitt 5, Altklausuren, Moodle-Sync

## Entscheidungen (22.10.)

1. Prüfkatalog und Kursgedächtnis wachsen **automatisch**. `didaktik.md` ändert nur Carl.
2. Pro Eintrag gibt es genau **drei Dateien**: „Original“, „Verbessert“ und „Für Carl“ bzw.
   „Für Emil“, je nach Login. Alles Weitere (Uploads, Abgaben, Aufträge) steht unter „Mehr“.
3. „Verbessert“ und „Für …“ sind **vollständige PDFs**, gebaut mit LaTeX
   (`tools/vorlage_verbessert.tex`). Sie ersetzen beim Lernen das Original. Ergänzungen
   stehen in farbigen Kästen.
4. Jeder sieht nur seine eigene Datei und sein eigenes Fehlerprofil. Die Profile liegen in
   `wissen/personen/` und sind nicht im Repo.

Umgesetzt sind Phase 1, das Gegenlesen als Schritt im selben Lauf und die Auslöser
„neues Original“, „verbessern fertig“ und „vergleich fertig“. Offen sind der Abgleich alter
Vorlesungen bei einem neuen Blatt, Altklausuren und der Moodle-Sync.
