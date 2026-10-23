# Prüfkatalog

Jeder Lauf prüft das Material auf diese Punkte und ergänzt den Katalog, wenn er etwas
Neues findet, das allgemein nützlich ist (kurz, mit Beispiel; keine Dopplungen).

## Definitionen
- Mehrere Variablen in einer Definition: Was passiert, wenn sie gleich sind?
  Beispiel: Transitivität mit x = y oder x = z.
- Leere Menge und leere Relation: Erfüllt sie die Definition? Gilt das „vakuös“?
- Kleinste Fälle: n = 0, n = 1, einelementige Mengen.
- Quantoren: Reihenfolge (∀∃ vs. ∃∀), „es gibt genau ein“ vs. „es gibt ein“.
- „Verschieden“ vs. „beliebig“: Fordert die Definition wirklich Verschiedenheit?
- Wird ein Begriff benutzt, bevor er definiert ist?
- Folgen statt Mengen: Dürfen Folgenglieder gleich sein? „Paarweise disjunkt“ erlaubt
  Wiederholung nur von ∅. Beispiel: Die Folge ∅, ∅, … ist paarweise disjunkt, daraus folgt P(∅) = 0.
- Ist ein Ausdruck nur unter einer stillen Zusatzannahme definiert (Division durch 0,
  Messbarkeit)? Beispiel: $P[X=x_i]$ braucht $\{x_i\}\in\mathcal A'$; $\alpha/\beta=(1-p)/p$ ist für $p\in\{0,1\}$ undefiniert.

## Sätze und Beweise
- Welche Voraussetzung wird wo gebraucht? Gibt es ein Gegenbeispiel ohne sie?
- Übersprungene Schritte („offensichtlich“, „analog“, „leicht zu sehen“).
- Gilt die Umkehrung? Wenn nicht: Gegenbeispiel.
- Nennt der Beweis alle benutzten Axiome? Oft wird nur eines genannt, andere laufen still mit.
  Beispiel: Klassen gleich oder disjunkt – der Beweis zitiert die Transitivität, braucht aber
  auch Reflexivität und Symmetrie.
- Allgemeine Nebenbemerkungen im Text („Für M ≠ M′ gilt …“) mit der leeren Menge testen.
  Beispiel: $\varnothing\times\{1\}=\{1\}\times\varnothing$.
- Negative Behauptungen in Beispielen („ist keine Ordnungsrelation“, „nicht vollständig“):
  Wird gesagt, welche Bedingung verletzt ist? Beispiel: „⊊ ist keine Ordnungsrelation“ –
  Grund: nicht reflexiv.
- Steckt in einer „⇔“-Umformulierung in Klammern ein zusätzliches Axiom?
  Beispiel: „jedes n ≠ 1 hat einen Vorgänger (⇔ ν(ℕ) = ℕ∖{1})“ braucht (P2).
- Präzisierungen mit „also“, „d.h.“ auf Äquivalenz prüfen. Beispiel: „Quantile nicht eindeutig,
  also falls F nicht injektiv“ – falsch, unif[0,1] hat nicht injektives F, aber eindeutige Quantile.
- „Gilt auch für allgemeine Maße/Fälle“: Welche Teile kippen bei unendlichen Werten?
  Beispiel: σ-Stetigkeit von oben scheitert für das Zählmaß auf ℕ mit $A_n=\{n,n+1,\dots\}$.
- Beweis nur entlang einer (monotonen) Folge, Behauptung ist ein Funktionsgrenzwert: Wird der
  Übergang begründet (z. B. durch Monotonie)? Beispiel: $\lim_{x\to\infty}F(x)=1$ in Lemma 2.9 (Sto).

- Wird ein Satz „als Spezialfall“ eines anderen bewiesen, ohne dass die Anwendung hingeschrieben wird? Dann fehlt der
  Beweis faktisch. Beispiel: Satz 2.11 (Sto) folgt aus 2.13 mit dem Erzeuger (55), das wird aber nie zusammengesetzt.
- Beispiele, die man selbst ergänzt, gegen die Übungen prüfen: Ein „naheliegendes“ Gegenbeispiel kann die Lösung
  einer Übung sein. Beispiel: Dynkin-System auf 4 Punkten, das keine σ-Algebra ist (= Ü 2.17, Sto).

## Notation
- Uneinheitliche Notation im Skript oder Abweichungen vom Üblichen.
- Mehrdeutige Symbole, z. B. ⊂ vs. ⊆ oder ℕ mit oder ohne 0.
- Hält sich das Skript an die eigene Definition eines Symbols? Beispiel: ⊂ als „echte
  Teilmenge“ definiert, später aber $\Delta\subset M\times M$ geschrieben (falsch für |M| ≤ 1).
- Doppelrollen: „⇔“ als Verknüpfung (kann falsch sein) vs. als Behauptung „gilt in jeder
  Zeile“; „Wertebereich“ als Bild vs. Zielmenge.
- Typ der Objekte prüfen: Steht auf beiden Seiten einer Gleichung dieselbe Art Objekt
  (Element, Menge, Mengensystem)? Beispiel: $\mathcal F_m=\{\Pi^{-1}[A]:A\subseteq\dots\}=\{\omega:\dots\in A\}$ –
  rechts eine Menge mit freiem $A$ statt eines Mengensystems.

## Abgleich mit den Blättern
- Braucht eine Aufgabe einen Begriff, eine Technik oder einen Satz, der im Skript fehlt
  oder erst später kommt?
