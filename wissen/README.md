# Wissensbasis

Jeder Claude-Lauf bekommt diesen Ordner als `wissen/` mit und schreibt Änderungen zurück.
So lernt das System über die einzelnen Läufe hinweg.

| Datei | Inhalt | Wer schreibt |
|---|---|---|
| `didaktik.md` | Didaktisches Konzept: was ergänzt wird, was nicht | nur Carl |
| `pruefkatalog.md` | Wonach jedes Material abgesucht wird | Claude, automatisch |
| `kurse/<Kürzel>/stoff.md` | Kursgedächtnis: Begriffe, Notation, Lücken, Stand | Claude, automatisch |
| `personen/<Name>.md` | Fehlerprofil. Wird nur dieser Person und ihren Läufen gezeigt. | Claude, automatisch |

Die Fehlerprofile sind privat und deshalb nicht im Repo (siehe `.gitignore`).
