# Didaktisches Konzept

Leitfrage: Ein gutes Skript spart Zeit. Wer aber nie ins kalte Wasser muss, lernt das
Beweisen nicht. Deshalb gilt:

> **Begriffe werden vollständig erklärt, Aufgaben werden nicht vorgelöst.**

## Ergänzen (ja)
- Randfälle von Definitionen: gleiche statt verschiedener Elemente, die leere Menge, n = 0,
  triviale Strukturen. Beispiel: Bei der Transitivität müssen x, y, z nicht verschieden sein.
  Mit x = z folgt aus xRy und yRx schon xRx. Solche Fälle öffnen das Auge und nehmen keinen
  Beweis vorweg.
- Intuition: worum es geht, warum die Definition so aussieht, ein Bild in Worten.
- Beispiele und vor allem **Gegenbeispiele**: Was passiert, wenn eine Voraussetzung fehlt?
- Korrekturen von Fehlern, Tippfehlern in Formeln und unklaren Stellen im Original.
- Fehlende Zwischenschritte in Beweisen, die im Skript stehen.
- Voraussetzungen, die das Skript stillschweigend benutzt.

## Nur angedeutet
- Beweisideen zu Sätzen, die das Skript ohne Beweis lässt: höchstens ein kurzer Satz
  zur Idee, kein ausgeführter Beweis.

## Nicht
- Lösungen oder Lösungswege zu Aufgaben auf Übungs- oder Tutoriumsblättern, auch nicht
  angedeutet.
- Ausformulierte Beweise, die erkennbar Übungsstoff sind.

## Form
- Das Ergebnis liest sich wie **ein** Dokument. Jede Ergänzung steht genau dort, wo man sie
  beim Lesen braucht, eingebaut in den Satz oder Absatz, im Stil des Skripts. Sie steht
  nicht als Anhang dahinter, nicht in Kästen und ohne Überschriften wie „Ergänzung“.
- Keine Meta-Kommentare wie „Das Skript vergisst hier …“ oder „Wichtig für Blatt 1“. Der
  Text sagt einfach das Richtige.
- Alles, was neu oder ersetzt ist, steht in Türkis (`\neu{…}`, `neutext`). Eine
  Korrektur ist einfach der richtige Text in Türkis an der Stelle des falschen.
  Weggelassenes aus dem Original markiert eine leere türkise Klammer (`\weg`).
- Alles Schwarze ist wörtlich das Original.
- Lieber wenige treffende Ergänzungen als viele. Ist eine Stelle gut, bleibt sie unverändert.

## Ebene „Lang“ (nur Vorlesungen)

„Lang“ enthält alles aus „Verbessert“ und erklärt darüber hinaus so ausführlich, dass man
den Stoff **ohne die Vorlesung** versteht. Auch wer in der Vorlesung war, soll damit beim
ersten Durcharbeiten mitkommen. Das Ziel ist nicht, dass sich alles logisch anhört,
sondern dass man es wirklich versteht.

- **Vor jedem Beweis steht, was genau bewiesen wird.** Zuerst kommt „Zu zeigen:“ mit
  Voraussetzungen und Behauptung, nochmal ausgeschrieben, damit man nicht nach oben
  blättern muss. Danach folgt in ein bis drei Sätzen die **Beweisidee**: welche Strategie
  (direkt, Widerspruch, Induktion, zwei Inklusionen …) und der entscheidende Trick.
- **Jeder Beweisschritt ist begründet:** welche Definition, welcher Satz (mit Nummer),
  welche Rechenregel. Dichte Schritte werden aufgefaltet. „Offensichtlich“, „analog“ und
  „folgt sofort“ werden ausgeführt.
  Beispiel: Die Bemerkung zu P(∅) = 0 im Stochastik-Skript zeigt nur P(∅) = Σ P(∅). Lang
  sagt, warum daraus P(∅) = 0 folgt: Eine unendliche Summe aus lauter gleichen Zahlen
  c ≥ 0 ist nur für c = 0 endlich, und P(∅) ≤ 1 ist endlich.
- **Nach jeder Definition:** was sie anschaulich bedeutet, warum sie so aussieht und ein
  kleines konkretes Beispiel (am besten endlich und durchgerechnet). Bei Bedarf kommt ein
  Nicht-Beispiel dazu.
- **Nach jedem Satz:** in einem Satz, was er aussagt und wofür man ihn braucht.
- **Am Kapitelanfang** steht eine kurze Landkarte: Worum geht es, und wie hängt es mit dem
  Vorherigen zusammen? **Am Kapitelende** folgt eine knappe Zusammenfassung der
  wichtigsten Begriffe und Sätze.
- **Notation:** Taucht ein Symbol lange nach seiner Definition wieder auf, erinnert ein
  Halbsatz daran, was es bedeutet.
- Form: **alles schwarz**. „Lang“ liest sich wie ein eigenes Lehrbuch, Ergänzungen sind
  nicht farbig markiert. Sie stehen nahtlos im Fließtext, ohne Kästen und ohne
  Meta-Kommentare.
- Auch hier gilt: Übungsaufgaben werden nicht vorgelöst.
