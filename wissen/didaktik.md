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

## Ebene „Lang“ (nur Vorlesungen): das Lernskript

„Lang“ ist **neues Lernmaterial** zum Selbstlernen und keine erweiterte Kopie des Skripts.
Grundlage ist „Verbessert“: Alle Korrekturen und Ergänzungen von dort sind enthalten (nicht
markiert). Die Reihenfolge der Vorlesung bleibt, der Stoff wird aber substanziell neu
aufbereitet. Ziel: Wer nicht in der Vorlesung war, kann sich den Stoff damit selbst
beibringen, ohne sich durch ein dichtes PDF zu kämpfen.

**Aufbau**
- **Kapitel** beginnen mit einer Startseite: Lernziele und eine Begriffskarte als Grafik
  (welcher Begriff baut auf welchem auf). Sie enden mit einem **Spickzettel** (alle
  Definitionen und Sätze kompakt) und den **Lösungen der Kurz-Checks**.
- **Lerneinheiten:** ein Begriff oder ein Satz pro Einheit, jede auf einer neuen Seite,
  meist 1–3 Seiten lang. Immer dasselbe Gerüst:
  1. *Worum geht's?* Die Frage oder das Problem, das der Begriff löst.
     Danach, noch vor dem Kasten, ein **Klartext-Satz**: was die Objekte konkret *sind*
     („$S_n$ ist die Menge aller Umordnungen der Zahlen $1,\dots,n$“). Baut eine Definition
     auf früheren Begriffen auf ($S_n=S(M_n)$), wird sie direkt danach **ausgepackt**: Was
     bedeutet jedes Symbol, und was kommt heraus, wenn man alles einsetzt? Der Leser soll
     nie selbst eine Kette aus drei Definitionen zurückverfolgen müssen. Bei kleinen Fällen
     alle Elemente hinschreiben (z. B. alle 6 Elemente von $S_3$).
  2. Anschauung zuerst: Grafik oder kleines Beispiel, **bevor** die Formel kommt.
  3. Definition bzw. Satz im Kasten, mit Verweis auf die Nummer im Skript.
  4. Durchgerechnetes Beispiel und, wo es hilft, ein Gegenbeispiel (Was passiert ohne
     die Voraussetzung?).
  5. Beweis: „Zu zeigen“, Idee, dann nummerierte Schritte mit der Begründung daneben
     (Definition, Satznummer, Rechenregel). „Offensichtlich“ und „analog“ werden ausgeführt.
  6. Stolperfallen: Randfälle und typische Fehler.
  7. Kurz-Check: 2–3 Verständnisfragen, Lösungen am Kapitelende.
  8. Merke: ein Satz zum Mitnehmen.
- Ganz hinten: Glossar und Symboltabelle.

**Grafiken** (TikZ/pgfplots) nur, wo sie etwas zeigen, das Text schlechter erklärt:
Venn-Diagramme für Mengen und Ereignisse, Mengensysteme, Funktionsgraphen (z. B.
Verteilungsfunktionen mit Sprüngen und flachen Stücken), monotone Mengenfolgen,
Baumdiagramme, Maß als Fläche bzw. Gewicht. Keine Deko.

**Optik und Ton**
- Feste Farben pro Kastenart (siehe `tools/vorlage_lernskript.tex`). Hier sind Kästen das
  Gerüst des Dokuments und kein Anhang.
- Luftig: wenig pro Seite, kurze Absätze, lieber mehr Seiten.
- Du-Ansprache, direkt und einfach („Stell dir vor …“), aber mathematisch exakt.

**Grenzen:** Übungsaufgaben werden nicht vorgelöst, auch nicht in Beispielen oder
Kurz-Checks. Die Kurz-Checks prüfen Verständnis, sie sind keine Übungsaufgaben.
