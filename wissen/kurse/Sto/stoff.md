# Stochastik (Sto) – Kursgedächtnis

Vorlesungsnotizen zur Stochastik, Prof. Dr. Franz Merkl („Beginn einer sehr vorläufigen Version 1“,
22.10.2026). Das Skript wird fortlaufend erweitert.

## Bearbeiteter Stand
- `18_Stochastik_Skript.pdf` (Version 22.10.2026, 39 S.) **vollständig bis Def. 2.27 (Quantil)**,
  Ende von 2.4. Verbessert-Fassung vom 23.10.2026.
- Lang-Fassung vom 23.10.2026 (43 S., Verbessert 32 S., Original 39 S.): jeder Beweis mit „Zu zeigen“ + Beweisidee,
  Landkarte Kap. 2, Zusammenfassung nach 2.1–2.4.
- Blätter: beim ersten Lauf **keine** Übungs- oder Tutoriumsblätter vorhanden (`input/kontext/` fehlte)
  → Abgleich nachholen, sobald Blätter kommen.

## Begriffe und Sätze (Nummer im Skript)
**1 Einführung:** Wahrscheinlichkeitstheorie und Statistik; Modellierungsschema.
**2.1.1 Ergebnisraum:** Ω nichtleer; Bsp. Würfel (3 Modelle), n-facher Münzwurf, Urne 3a mit und 3b ohne
Zurücklegen ($[m]^{[n]}$, injektiv), Glücksrad $S^1$ bzw. $[0,1[$, Pegelstand $C[t_0,t_1]$; diskret vs. kontinuierlich.
**2.1.2 σ-Algebra:** 2.1 σ-Algebra, Ereignisraum, sicheres/unmögliches Ereignis; Bsp. $\mathcal P(\Omega)$, trivial;
2.2 Abschluss unter ∪, ∩, ∖, △, abzählbarem ∩; erzeugte σ-Algebra σ(M) (1); Ü 2.3; Partition (abzählbares Ω);
$\mathcal B(\mathbb R)$ und Erzeuger (2)–(6); $\mathcal B(M)$ für metrische Räume; Filtration $\mathcal F_m$ beim Münzwurf.
**2.1.3 W-Maß:** 2.4 Kolmogoroff-Axiome, W-Raum, W-Modell; 2.5 Maß, Maßraum; Bem. P(∅)=0;
2.6 endl. Additivität, Einschluss–Ausschluss für 2 Mengen, Komplement, Monotonie, σ-Stetigkeit unten/oben;
Bsp.: Zähldichte, Zählmaß, diskrete Gleichverteilung, Dirac, Lebesguemaß $\lambda,\lambda_n$, unif[a,b], Gleichverteilung
auf $S^1$ und auf $B\subseteq\mathbb R^n$; 2.7 Nullmenge, fast sicher; Interpretationen (objektiv, von Mises,
subjektiv, Glückspiel, Minimal, Signifikanzniveau).
**2.2 Verteilungsfunktion:** 2.8 VF; Bsp. unif, Dirac, Münze, Indikatorfunktion $1_A$; 2.9 Eigenschaften der VF
(4 = Übung); Ü 2.10; 2.11 Eindeutigkeit VF; 2.12 ∩-stabil, ∩-stabiler Erzeuger; 2.13 Eindeutigkeitssatz;
2.14 Dynkin-System; 2.15 Übereinstimmungsbereich ist Dynkin; 2.16 Dynkin-Lemma (Beweis 2.2.1);
Ü 2.17; 2.18 Rotationsinvarianz (Skizze); 2.19 keine rotationsinvariante W auf $\mathcal P(S^1)$ (Vitali).
**2.3 Dichten:** 2.20 Borel-messbar ($\overline{\mathbb R}$-wertig); Integral (68)/(69), monotone Konvergenz, Linearität,
Nullmengen, Monotonie; 2.21 W-Dichten; Bsp. Dichte unif, Zähldichte, Dirac ohne Dichte, Exp(a), Standardnormal,
Gamma(a,s); Dichte = F′.
**2.4 Zufallsvariablen:** 2.22 $\mathcal A$-$\mathcal A'$-messbar; 2.23 Erzeuger-Kriterium; 2.24 Bildmaß $f[\mu]=\mu f^{-1}$;
2.25 Zufallsvariable, Verteilung $\mathcal L_P(X)$; Kurznotation $P[X\in A']$; Bsp. Münzwurf $X_i$, $S$ (Binomial),
endlich viele Werte, Randverteilung; 2.26 Charakterisierung VF über Quasi-Inverse $G$; Simulation $-\log(1-\omega)$;
2.27 Quantil, Quantilsfunktion.

## Notation des Dozenten
- $\mathbb N=\{1,2,\dots\}$ (vgl. $A_0=\varnothing$ in Lemma 2.6), $\mathbb N_0$ mit 0; $[n]=\{1,\dots,n\}$.
- Intervalle französisch: $]a,b[$, $]a,b]$; $\subseteq$ für Teilmenge.
- Komplement $A^c=\Omega\setminus A$; $A\triangle B$; $x\wedge y=\min$.
- Urbild mit **eckigen** Klammern $f^{-1}[A]$, Umkehrfunktion mit runden $f^{-1}(y)$.
- σ(A,B) := σ({A,B}); σ(M, Ω).
- $\mathcal P$ Potenzmenge, $P$ Maß; $Q$ auch als Maß neben $\mathbb Q$.
- Summen von Maßen mengenweise ($\sum p_\omega\delta_\omega$, $\tfrac12(\delta_0+\delta_1)$).
- $\operatorname{unif}[a,b]$, $\mathrm{Gamma}(a,s)$ mit $a$ als „Skalenparameter“ (eigentlich Rate).
- $1_A$ Indikator; $\int_A f\,d\mu=\int f1_A\,d\mu$; $\mu(dx)$-Schreibweise.
- $X[P]=PX^{-1}=\mathcal L_P(X)$; $P[X\le a]$ mit eckigen Klammern; „abzählbar“ = höchstens abzählbar.
- Konvention $0\cdot\infty=0$ (Fußnote 8).

## Welche Blätter was brauchen
- Noch keine Blätter vorhanden. Übungen im Skript (nicht vorlösen!): Lemma 2.2(2) Rest, Ü 2.3,
  Bsp. 3b „in den Übungen“, Lemma 2.9(4), Ü 2.10, Ü 2.17 (Dynkin, nicht σ-Algebra, nicht ∩-stabil).
  Deshalb **kein** 4-Punkte-Gegenbeispiel zu Satz 2.13 ohne ∩-Stabilität ins Skript schreiben.

## Zusammenhänge und Schwierigkeiten (beim Erklären für „Lang“ aufgefallen)
- **Ein Beweismuster trägt Kapitel 2:** „Prinzip der guten Mengen“ – gute Mengen sammeln, zeigen, dass sie ein
  Dynkin-System bzw. eine σ-Algebra bilden, Erzeuger enthalten → ganze σ-Algebra. Vorkommen: Satz 2.13 (mit 2.15/2.16),
  Lemma 2.18, Dynkin-Beweis Schritte 3–6 (zweimal), Lemma 2.23. Wer das Muster einmal sieht, versteht alle diese Beweise.
- Zweites Muster: in disjunkte Stücke zerlegen, dann σ-Additivität (Lemma 2.6 alle Teile, Satz 2.21, Dynkin Schritt 7: $B_n$).
- „Konstante Reihe ist 0 oder ∞“ steckt in Bem. (9) **und** im Vitali-Beweis (66) **und** in „keine Gleichverteilung auf ℕ“ –
  dasselbe Argument dreimal; in Lang verknüpft.
- Satz 2.26: Schwer ist, dass 1'./2'. den Punkt $q=F(s)$ offenlassen; Schlüssel: ein Punkt hat unter unif Maß 0.
  Gutes Rechenbeispiel: Münzwurf (44) → $G=0$ auf $]0,\frac12[$, $G=1$ auf $[\frac12,1[$.
- Beweis von Satz 2.11 wird im Original nie explizit zusammengesetzt (2.13 + Erzeuger (55)); in Lang ergänzt.
- Carl (Rückmeldung): bei Beweisen fehlte ihm „was genau gezeigt wird“; Bem. P(∅)=0 war die verwirrendste Stelle.
- Achtung beim Ergänzen: Ein 4-Punkte-Dynkin-System, das keine σ-Algebra ist, nimmt Ü 2.17 vorweg – nicht verwenden.

## Gefundene Lücken / Fehler (im Verbessert-Skript behandelt)
- Filtration: $\mathcal F_m=\{\dots\}=\{(\omega_1..\omega_n):\dots\in A\}$ – rechte Seite ist Menge statt Mengensystem.
- $\mathcal F_0$ benutzt, Fall $m=0$ nicht erklärt ($\{0,1\}^0=\{()\}$, triviale σ-Algebra).
- Beweis 2.6.6: „Teilen 4. (Komplemente)“ → 3.
- Satz 2.19, (65): $x\in S^2$ → $S^1$; Partitionseigenschaft und Widerspruch in (66) nicht begründet.
- Def. 2.27: „also falls F nicht injektiv“ falsch (unif[0,1]); richtig: F auf Intervall konstant = q.
- σ-Stetigkeit von oben für Maße nur bei $\mu(A_1)<\infty$ (Zählmaß auf ℕ).
- Bem. (9): Schritt „konstante Reihe ist 0 oder ∞“ fehlte; $\mu\equiv\infty$ zeigt Nötigkeit von μ(∅)=0.
- Lemma 2.9.3: nur entlang Folgen gezeigt, Funktionsgrenzwert braucht Monotonie.
- Satz 2.21: $P(A)\le1$ nicht gezeigt; Monotonie der Partialsummen.
- Dichte = F′: Schluss braucht Satz 2.11.
- (126): $\{x_i\}\in\mathcal A'$ stillschweigend vorausgesetzt.
- Satz 2.26: „messbar, da monoton“ ohne Grund.
- Summe von Maßen nie definiert; Konvention 0·∞ erst nach (69).
- Tippfehler: „um den Rückschluß“, „manche“, „Kursverlaufs“, „einen positiven“, „russischen“, „besprochenen“,
  „σ-Additivität“, „Wahrscheinlichkeitsmaße“, „stückweise“, „$(N,d_N)$“, „Sind“, „messbaren“, „Wahrscheinlichkeit“.
