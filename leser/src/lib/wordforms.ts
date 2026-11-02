// Verwandte Wortformen (Adjektiv ↔ Nomen), die auf dieselbe Definition verweisen sollen:
// injektiv ↔ Injektivität, symmetrisch ↔ Symmetrie, disjunkt ↔ Disjunktheit, stetig ↔ Stetigkeit …
// Grundsatz: lieber eine Verknüpfung weniger als eine falsche. Regeln greifen deshalb nur für einzelne Wörter
// mit eindeutig fachsprachlicher Endung; Wörter mit anderer Bedeutung stehen in einer Ausschlussliste.

export const WORD_PAIRS_KEY = "mathe-studium.wordPairs";

export type WordPair = [string, string];

/** Sonderfälle, die keine Endungsregel abdeckt (oder bei denen die Regel ein falsches Wort ergäbe). */
const SPECIAL: WordPair[] = [
  ["konvergent", "Konvergenz"],
  ["divergent", "Divergenz"],
  ["monoton", "Monotonie"],
  ["linear", "Linearität"],
  ["stabil", "Stabilität"],
  ["konvex", "Konvexität"],
  ["konkav", "Konkavität"],
  ["regulär", "Regularität"],
  ["singulär", "Singularität"],
  ["orthogonal", "Orthogonalität"],
  ["periodisch", "Periodizität"],
  ["homogen", "Homogenität"],
  ["isomorph", "Isomorphie"],
  ["äquivalent", "Äquivalenz"],
  ["stationär", "Stationarität"],
  ["unkorreliert", "Unkorreliertheit"],
  ["erwartungstreu", "Erwartungstreue"],
];

// Adjektive auf -isch, deren Nomen auf -ie etwas anderes bedeutet (geometrische Reihe ≠ Geometrie)
const NO_ISCH_IE = new Set([
  "geometrisch", "harmonisch", "logisch", "theoretisch", "ökonomisch", "kategorisch", "strategisch", "energisch",
  "analogisch", "technisch", "chemisch", "biologisch", "pädagogisch", "psychologisch", "periodisch", "monotonisch",
  "systematisch", "praktisch", "typisch", "klassisch",
]);
// Alltagswörter, die nie über -heit/-keit verknüpft werden (gleich ↔ Gleichheit, frei ↔ Freiheit …)
const NO_HEIT = new Set([
  "gleich", "frei", "wahr", "sicher", "möglich", "abhängig", "unabhängig", "schön", "klar", "neu", "richtig",
  "gültig", "eigen", "ein", "einzig", "tätig", "flüssig", "wichtig", "schwierig", "gesund", "krank", "einfach",
  "genau", "fähig", "notwendig", "zufällig", "ähnlich", "deutlich", "persönlich", "zuständig", "beliebig",
]);

const INFLECTION = /(?:e|en|em|er|es)$/u;
const lower = (s: string) => s.toLocaleLowerCase("de");

/** Grundform eines (evtl. gebeugten) Adjektivs: "injektive" → "injektiv", "symmetrischen" → "symmetrisch". */
function adjBase(word: string): string {
  const w = lower(word);
  if (/(?:iv|isch|bar|ig|lich|sam|kt|nt|ssen|ert)$/u.test(w)) return w;
  const stripped = w.replace(INFLECTION, "");
  return /(?:iv|isch|bar|ig|lich|sam|kt|nt|ssen|ert)$/u.test(stripped) ? stripped : w;
}

/**
 * Verwandte Formen eines einzelnen Worts nach den Endungsregeln (in Kleinbuchstaben, ohne das Wort selbst):
 *   -iv   ↔ -ivität    (injektiv ↔ Injektivität)
 *   -isch ↔ -ie        (symmetrisch ↔ Symmetrie)
 *   Wort  ↔ Wort-heit/-keit (disjunkt ↔ Disjunktheit, stetig ↔ Stetigkeit, messbar ↔ Messbarkeit)
 */
export function ruleVariants(word: string): string[] {
  if (/\s/.test(word.trim())) return []; // nur einzelne Wörter
  const w = lower(word.trim());
  const out = new Set<string>();
  const a = adjBase(w);

  // Adjektiv → Nomen
  if (/iv$/u.test(a) && a.length >= 6) out.add(a + "ität");
  if (/isch$/u.test(a) && a.length >= 8 && !NO_ISCH_IE.has(a)) out.add(a.slice(0, -4) + "ie");
  if (a.length >= 6 && !NO_HEIT.has(a) && /(?:kt|nt|ssen|ert|bar|ig|lich|sam|haft)$/u.test(a)) {
    out.add(a + (/(?:bar|ig|lich|sam|haft)$/u.test(a) ? "keit" : "heit"));
  }

  // Nomen → Adjektiv
  const n = w.replace(/en$/u, ""); // Mehrzahl ("Symmetrien")
  if (/ivität$/u.test(n) && n.length >= 9) out.add(n.slice(0, -4));
  if (/ie$/u.test(n) && n.length >= 7) {
    const adj = n.slice(0, -2) + "isch";
    if (!NO_ISCH_IE.has(adj) && /(?:metr|morph|gon|top|log)ie$/u.test(n)) out.add(adj);
  }
  const hk = /^(.{4,}?)(heit|keit)$/u.exec(n);
  if (hk) {
    const adj = hk[1];
    const fits = hk[2] === "keit" ? /(?:bar|ig|lich|sam|haft)$/u.test(adj) : /(?:kt|nt|ssen|ert)$/u.test(adj);
    if (fits && !NO_HEIT.has(adj)) out.add(adj);
  }
  out.delete(w);
  out.delete(a);
  return [...out];
}

/** Liest die eigenen Wortpaare aus dem Browser-Speicher. */
export function loadWordPairs(): WordPair[] {
  try {
    const raw = JSON.parse(localStorage.getItem(WORD_PAIRS_KEY) ?? "[]") as unknown;
    return Array.isArray(raw)
      ? raw.filter((p): p is WordPair => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "string" && x.trim()))
      : [];
  } catch {
    return [];
  }
}

export function saveWordPairs(pairs: WordPair[]) {
  try {
    localStorage.setItem(WORD_PAIRS_KEY, JSON.stringify(pairs));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

/** Schlüssel eines Paars unabhängig von Reihenfolge und Groß-/Kleinschreibung (zum Vereinigen). */
export const pairKey = (p: WordPair) => p.map((x) => lower(x.trim())).sort().join("↔");

/**
 * Alle verwandten Formen eines Begriffs: Endungsregeln, Sonderfälle und eigene Wortpaare.
 * Eigene Paare und Sonderfälle wirken auch bei Begriffen aus mehreren Wörtern.
 */
export function relatedForms(term: string, userPairs: WordPair[] = []): string[] {
  const t = lower(term.trim());
  const base = /\s/.test(t) ? t : adjBase(t);
  const out = new Set(ruleVariants(t));
  for (const [x, y] of [...SPECIAL, ...userPairs]) {
    const lx = lower(x.trim());
    const ly = lower(y.trim());
    if (lx === t || lx === base) out.add(ly);
    else if (ly === t || ly === base) out.add(lx);
  }
  out.delete(t);
  return [...out];
}
