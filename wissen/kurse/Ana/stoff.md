# Analysis (Ana) – Kursgedächtnis

Analysis I – Analysis einer Variablen, LMU, WS 2026/27, Prof. Dr. Peter Müller
(Übungen: Dr. Tamás Makai, Margherita Ferrero).

## Bearbeiteter Stand
- `1_Analysis_I.pdf` (Version 20.10.2026) bis **Lemma 2.8**; das Original bricht dort ab.
  Satz 2.7 kündigt drei Lemmata an, nur 2.8 ist vorhanden → beim nächsten Stand ab 2.8 weiter.
- Blätter abgeglichen: Übungsblatt 1 (E1.1–E1.4), Tutorienblatt 1 (T1.1–T1.4).
- Verbessert-Fassung am 23.10.2026 auf die neue Form umgestellt (keine Kästen, kein Anhang,
  keine „Gebraucht“-Verweise, keine Selbst-prüfen-Fragen); Inhalte türkis im Fließtext.

## Begriffe und Sätze (Nummer im Skript)
**1.1 Aussagenlogik:** 1.1 Bivalenz; 1.3 Verneinung; 1.4 ∧, ∨, ⇒, ⇔ (Wahrheitstafeln);
1.6 Lemma (Widerspruch, Tertium non datur, Symmetrie ∧/∨, ⇔ als zwei ⇒, Kontraposition,
doppelte Verneinung); 1.7 Lügner, Beweismethoden (direkt, Kontraposition, Widerspruch).
**1.2 Mengen:** 1.8 naive Menge; 1.9 ∈, ⊆, ⊂, =; 1.11 ∅, ∩, ∪, ∖, Komplement, ×, Potenzmenge;
1.13 Rechenregeln, de Morgan; 1.14 Russell; 1.15 Relation, inverse Relation;
1.17 Äquivalenzrelation, Klasse, Repräsentant, Quotientenmenge; 1.19 Klassen gleich oder
disjunkt; 1.20 beliebige ∪/∩, paarweise disjunkt, $\dot\bigcup$; 1.21 Zerlegung in Klassen;
1.22 Gleichheit von Elementen; 1.24 Ordnungsrelation, teilweise/total geordnet;
1.26 Funktion als Graph, dom, Wertebereich (= Bild), Gleichheit, Restriktion;
1.28 injektiv/surjektiv/bijektiv; 1.29 Umkehrfunktion; 1.30 id; 1.31 Komposition;
1.32 $f^{-1}\circ f=\mathrm{id}$; 1.33 Urbild.
**2.1 ℕ:** 2.1 Peano (P1–P4); 2.3 +, · rekursiv; 2.5 Rechenregeln (nur Komm. von + bewiesen);
2.6 <, ≤; 2.7 Trichotomie (Beweis fehlt noch); 2.8 Vorgänger.

## Notation des Dozenten
- $A\asymp w$ / $A\asymp f$ für Wahrheitswerte; $:\!\iff$ für Definitionen.
- $\subseteq$ Teilmenge, $\subset$ **echte** Teilmenge (aber in 1.18(c) als ⊆ benutzt), auch $\subsetneq$.
- Komplement $M'^{\complement}$ ohne Bezugsmenge im Symbol; $\mathscr P(M)$ bzw. $2^M$.
- Relationen $\mathscr R$, $l\mathscr Rm$; Ordnung mit $\prec$ **reflexiv** (≤-artig).
- Funktion = Graph $\mathscr R_f\subseteq X\times Y$, partiell; $\mathscr D=\operatorname{dom}(f)$;
  „Wertebereich“ = Bild $f(\mathscr D)$; $f\colon X\to Y$ heißt $X=\operatorname{dom}(f)$.
- $\exists_1$ = $\exists!$. Nachfolger $\nu$. **ℕ beginnt bei 1.** $\leqslant$.
- Klassen: $[m]=\{m'\colon m'\sim m\}$; Quotient $M/{\sim}$.

## Welche Blätter was brauchen
- E1.1: Wahrheitstafeln mit 3 Aussagen; (a) = Lemma 1.6(c). E1.2: ¬(A⇒B); de Morgan für Aussagen
  (im Beweis 1.13 benutzt, nicht formuliert).
- E1.3(a): 1.17, 1.20 (Indexmenge, $\dot\bigcup$). E1.3(b): 1.24, Relationen als Mengen.
- E1.4: 1.15, 1.26, 1.28–1.32 (verallgemeinert 1.29/1.32 ohne Bijektivität).
- T1.1: 1.1, 1.7(a), Quantoren-Negation. T1.2: 1.7(b)(3), 1.12(a).
- T1.3: 1.11, 1.12(b), ∈ vs. ⊆. T1.4: 1.15, 1.17, 1.24, „Totalordnung“.

## Gefundene Lücken / Fehler (im Verbessert-Skript behandelt)
- Quantoren-Negation nirgends formuliert (benutzt 1.5(a), 1.12(a)).
- Doppelrolle von ⇔ (Verknüpfung vs. Behauptung „in jeder Zeile gleich“).
- 1.11: „$M\neq M'\Rightarrow M\times M'\neq M'\times M$“ falsch, wenn eine Menge leer.
- 1.18(c): ⊂ statt ⊆. 1.26: $\mathscr R$ statt $\mathscr R_f$. 1.14: „Russel“.
- 1.19-Beweis benutzt Reflexivität und Symmetrie stillschweigend.
- 1.21 für $M=\varnothing$ kollidiert mit $J\neq\varnothing$ aus 1.20.
- 2.5: „· völlig analog“ verschweigt, dass Distributivität und $1\cdot n=n$ vorher nötig sind.
- 2.8: „⇔ ν(ℕ)=ℕ∖{1}“ braucht (P2).
- 1.11: Komplement $M'^{\complement}$ ohne Bezugsmenge im Symbol (in 1.13(e) stillschweigend $M$).
- 1.23: Kette $m_1\Delta m_2\iff[m_1]=[m_2]\iff\{m_1\}=\{m_2\}$ fehlte.
- 1.25: „⊊ keine Ordnungsrelation“ ohne Grund (nicht reflexiv).
- Tutorienblatt 1 trägt das Datum 14.10.2027 (Tippfehler des Blatts).

## Frühere Selbst-prüfen-Fragen (Skript 1)
Seit 23.10.2026 nicht mehr als Fragen, sondern als kurze Sätze im Text: Motivation ⇒ (1.5b),
Symmetrie mit ⇒ genügt (1.17), Beweisidee 1.21, Modell ohne (P4) (nach 2.1),
Induktionsannahme in 2.8 ungenutzt.
