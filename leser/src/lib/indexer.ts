import type { Entry, EntryKind, PageText } from "./db";
import { itemAt, pageString } from "./pdf";
import { uid } from "./db";
import { relatedForms, type WordPair } from "./wordforms";

// ---------- Erkennung nummerierter Umgebungen ----------

const KIND_WORDS: Record<string, EntryKind> = {
  definition: "Definition",
  def: "Definition",
  satz: "Satz",
  lemma: "Lemma",
  hilfssatz: "Lemma",
  korollar: "Korollar",
  folgerung: "Korollar",
  theorem: "Theorem",
  proposition: "Proposition",
  bemerkung: "Bemerkung",
  beispiel: "Beispiel",
  axiom: "Axiom",
  notation: "Notation",
};
const KIND_ALT =
  "Definition|Def\\.|Satz|Lemma|Hilfssatz|Korollar|Folgerung|Theorem|Proposition|Bemerkung|Beispiel|Axiom|Notation";
const NUM = "(\\d+(?:\\.\\d+)*)";

// "Definition 1.1 (Ordnungsrelation)"  |  "1.1 Definition (Ordnungsrelation)"  |  "Definition 1.1. Ordnungsrelation:"
const HEAD_A = new RegExp(`^\\s*(${KIND_ALT})\\s*${NUM}?\\.?\\s*(?:\\(([^)\\n]{2,80})\\)|\\[([^\\]\\n]{2,80})\\])?`, "u");
const HEAD_B = new RegExp(`^\\s*${NUM}\\.?\\s+(${KIND_ALT})\\b\\.?\\s*(?:\\(([^)\\n]{2,80})\\)|\\[([^\\]\\n]{2,80})\\])?`, "u");

// "... heißt Ordnungsrelation, falls ..." – liefert den Begriff
const DEF_VERB =
  /(?:heißt|heissen|heißen|heisst|nennt man|nennen wir|bezeichnet man als|bezeichnen wir als|wird als|werden als)\s+(?:(?:eine|einen|ein|der|die|das|dann|auch|kurz)\s+)*((?:[\p{L}][\p{L}\-]*)(?:\s+[\p{L}][\p{L}\-]*){0,2})/gu;
// Signalwörter, die nach einem "heißt X" eine echte Definition anzeigen
const DEF_CONDITION = /^[^.]{0,80}?(?:,|\b(?:falls|wenn|sofern|genau dann|gdw|so dass|sodass)\b)/u;
const STOP_AFTER =
  /\s+(?:falls|wenn|genau|sofern|und|oder|bzgl|bezüglich|von|auf|in|über|mit|für|zu|wobei|gdw|bzw|der|die|das|des|dem|den|ist|sind|gilt|ein|eine|einer|einem)\b.*$/u;
const STOPWORDS = new Set([
  "eine", "einen", "einer", "dann", "auch", "kurz", "also", "diese", "dieser", "dieses", "folgende",
  "genau", "man", "wir", "sie", "es", "hier", "noch", "ganz", "falls", "wenn", "abbildung", "menge",
]);
// Fett gedruckte Wörter, die Gliederung sind und keine Begriffe
const LABEL_WORDS = new Set([
  "beweis", "proof", "lösung", "aufgabe", "übung", "übungsaufgabe", "hinweis", "merke", "achtung", "wichtig",
  "zusammenfassung", "kapitel", "abschnitt", "anmerkung", "voraussetzung", "behauptung", "fall", "schritt",
  "induktionsanfang", "induktionsschritt", "induktionsvoraussetzung", "induktionsbehauptung", "ziel", "motivation",
  "idee", "literatur", "inhaltsverzeichnis", "vorlesung", "woche", "teil", "anhang", "erinnerung", "beobachtung",
  "frage", "antwort", "tipp", "vorsicht", "warnung", "fazit", "überblick", "einleitung", "bsp", "bem", "def",
  ...Object.keys(KIND_WORDS), "sätze", "definitionen", "beispiele", "bemerkungen",
]);

function kindOf(word: string): EntryKind {
  return KIND_WORDS[word.toLowerCase().replace(".", "")] ?? "Definition";
}

function cleanTerm(raw: string): string | null {
  let t = raw.replace(STOP_AFTER, "").replace(/[„“"',.;:!?()]+$/u, "").replace(/^[„“"'(]+/u, "").trim();
  t = t.replace(/^(?:eine?[nrms]?|der|die|das|den|dem|des)\s+/iu, "");
  if (t.length < 4 || t.length > 60) return null;
  if (STOPWORDS.has(t.toLowerCase()) || LABEL_WORDS.has(t.toLowerCase())) return null;
  if (!/\p{L}{3,}/u.test(t)) return null;
  if (/[\d=<>≤≥∈∉⊂⊆∪∩∑∫√^_{}\\|]/u.test(t)) return null; // Formeln, Nummern
  if (t.split(/\s+/).length > 4) return null;
  return t;
}

function termsFromBlock(block: string): string[] {
  const out = new Set<string>();
  const flat = block.replace(/-\n(\p{Ll})/gu, "$1").replace(/\n/g, " ");
  for (const m of flat.matchAll(DEF_VERB)) {
    const t = cleanTerm(m[1]);
    if (t) out.add(t);
  }
  return [...out];
}

function splitTerms(raw: string): string[] {
  // "(Ordnungsrelation, partielle Ordnung)", "reflexiv und transitiv" → mehrere Begriffe
  return raw
    .split(/[,;/]|\bbzw\.?|\boder\b|\bund\b/u)
    .map((s) => cleanTerm(s.trim()))
    .filter((s): s is string => !!s);
}

interface Line {
  offset: number;
  y: number;
  h: number;
}

interface Head {
  page: number;
  offset: number;
  line: number; // Index in lines[page]
  item: number;
  kind: EntryKind;
  number?: string;
  name?: string;
}

interface Candidate {
  term: string;
  page: number;
  y: number;
  h: number;
  offset: number;
  via: NonNullable<Entry["hint"]>;
}

/** Median der Schrifthöhe des Fließtexts – dient zum Erkennen von Überschriften. */
function bodyHeight(pages: PageText[]): number {
  const hs: number[] = [];
  for (const p of pages) for (const it of p.items) if (it.s.trim().length > 3) hs.push(it.h);
  hs.sort((a, b) => a - b);
  return hs[Math.floor(hs.length / 2)] ?? 10;
}

/**
 * Heuristische Erkennung von Definitionen, Sätzen, Lemmata, …
 *  1. nummerierte Umgebungen ("Definition 1.1 (Ordnungsrelation)", "1.1 Satz")
 *  2. fett gedruckte Begriffe im Text (oft die Stelle, an der ein Begriff eingeführt wird)
 *  3. kursive Begriffe innerhalb von Definitionen oder in "… heißt X"-Sätzen
 *  4. "… heißt X, falls …" / "nennt man X" im ganzen Skript
 */
export function detectEntries(pages: PageText[]): Entry[] {
  const heads: Head[] = [];
  const strs = pages.map(pageString);
  const bodyH = bodyHeight(pages);
  const sectionLines = new Set<string>(); // "seite:offset" von Überschriften
  const lines: Line[][] = pages.map(() => []);

  pages.forEach((p, pi) => {
    const { text, starts } = strs[pi];
    let lineStart = 0;
    for (const line of text.split("\n")) {
      const first = itemAt(starts, lineStart);
      const lineItems = [];
      for (let k = first; k < p.items.length && starts[k] < lineStart + line.length + 1; k++) {
        if (p.items[k].s.trim()) lineItems.push(p.items[k]);
      }
      const allBold = lineItems.length > 0 && lineItems.every((it) => it.b);
      const maxH = Math.max(0, ...lineItems.map((it) => it.h));
      if (lineItems.length) lines[pi].push({ offset: lineStart, y: Math.min(...lineItems.map((it) => it.y)), h: maxH });
      const a = HEAD_A.exec(line);
      const b = a ? null : HEAD_B.exec(line);
      if (a || b) {
        const kind = kindOf(a ? a[1] : b![2]);
        const number = a ? a[2] : b![1];
        const name = a ? a[3] ?? a[4] : b![3] ?? b![4];
        // "Satz" mitten im Fließtext ohne Nummer ist meist keine Überschrift – außer das Wort ist fett ("Definition.")
        if (number || name || lineItems[0]?.b) {
          heads.push({ page: p.page, offset: lineStart, line: lines[pi].length - 1, item: first, kind, number, name });
        }
      } else if (allBold && (maxH > bodyH * 1.12 || /^\s*\d+(?:\.\d+)*\.?\s+\p{L}/u.test(line)) && line.split(/\s+/).length <= 10) {
        sectionLines.add(`${p.page}:${lineStart}`);
      }
      lineStart += line.length + 1;
    }
  });

  // Ende eines Blocks: nächste Überschrift oder Absatzende (deutlich größerer Zeilenabstand)
  const sectionAt = (page: number, offset: number) => sectionLines.has(`${page}:${offset}`);
  const paragraphEnd = (pi: number, li: number, stopOffset: number): { offset: number; y: number } => {
    const ls = lines[pi];
    for (let j = li + 1; j < ls.length; j++) {
      const prev = ls[j - 1];
      const gap = ls[j].y - prev.y;
      if (ls[j].offset >= stopOffset || gap > prev.h * 1.65 || gap < 0 || sectionAt(pi + 1, ls[j].offset)) {
        return { offset: ls[j].offset, y: prev.y + prev.h + 2 };
      }
    }
    return { offset: Infinity, y: pages[pi].height };
  };

  const entries: Entry[] = [];
  heads.forEach((h, i) => {
    const page = pages[h.page - 1];
    const { text } = strs[h.page - 1];
    const next = heads[i + 1];
    const nextOffset = next && next.page === h.page ? next.offset : text.length;
    const para = paragraphEnd(h.page - 1, h.line, nextOffset);
    const endOffset = Math.min(nextOffset, para.offset);
    let block = text.slice(h.offset, endOffset);
    if (para.offset === Infinity && (!next || next.page !== h.page)) {
      // Block läuft evtl. auf die nächste Seite weiter – für die Begriffssuche etwas mitnehmen
      const following = strs[h.page]?.text ?? "";
      const cut = next && next.page === h.page + 1 ? next.offset : 600;
      block += "\n" + following.slice(0, Math.min(cut, 600));
    }
    const y = page.items[h.item]?.y ?? 0;
    const yEnd = Math.min(para.y, next && next.page === h.page ? page.items[next.item]?.y ?? page.height : page.height);

    let terms: string[] = [];
    if (h.kind === "Definition") {
      terms = h.name ? splitTerms(h.name) : [];
      for (const t of termsFromBlock(block.slice(0, 1500))) if (!terms.includes(t)) terms.push(t);
    } else if (h.name) {
      // Benannte Sätze ("Satz von Bolzano-Weierstraß") ebenfalls verlinken
      terms = splitTerms(h.name).filter((t) => /\p{Lu}/u.test(t[0]) || t.includes(" "));
    }

    entries.push({
      id: uid(),
      kind: h.kind,
      number: h.number,
      terms,
      page: h.page,
      y: Math.max(0, y - 4),
      yEnd,
      source: "auto",
      text: block.slice(0, 1200).trim(),
    });
  });

  // ---------- Begriffe ohne Überschrift: fett, kursiv, "heißt" ----------
  const candidates: Candidate[] = [];
  const blockAt = (page: number, y: number) =>
    entries.find((e) => e.page === page && y >= e.y && y < e.yEnd) ?? null;

  pages.forEach((p, pi) => {
    const { text, starts } = strs[pi];
    const flat = text.replace(/\n/g, " "); // gleiche Länge → gleiche Offsets

    // Zusammenhängende fett/kursiv gesetzte Textstücke ("Runs") sammeln
    for (const style of ["b", "i"] as const) {
      let k = 0;
      while (k < p.items.length) {
        if (!p.items[k][style] || !p.items[k].s.trim()) {
          k++;
          continue;
        }
        const startItem = k;
        let end = k;
        while (end + 1 < p.items.length && (p.items[end + 1][style] || (!p.items[end + 1].s.trim() && p.items[end + 2]?.[style]))) end++;
        k = end + 1;
        const startOff = starts[startItem];
        const endOff = starts[end] + p.items[end].s.length;
        const lineStart = text.lastIndexOf("\n", startOff - 1) + 1;
        if (sectionLines.has(`${p.page}:${lineStart}`)) continue;
        let raw = text.slice(startOff, endOff).replace(/-\n(\p{Ll})/gu, "$1").replace(/\s+/g, " ").trim();
        // "Definition 1.1 Ordnungsrelation." → nur der Name zählt
        const head = HEAD_A.exec(raw) ?? HEAD_B.exec(raw);
        if (head) raw = raw.slice(head[0].length).trim();
        raw = raw.replace(/^[.:)\]]+|[.:]+$/gu, "").trim();
        if (!raw || raw.split(/\s+/).length > 6) continue; // lange fette Passagen sind Betonung, keine Begriffe
        const it = p.items[startItem];
        const inBlock = blockAt(p.page, it.y);
        const sentenceStart = Math.max(flat.lastIndexOf(". ", startOff), flat.lastIndexOf(": ", startOff)) + 1;
        const sentence = flat.slice(sentenceStart, Math.min(flat.length, endOff + 120));
        if (style === "i") {
          // Kursiv wird auch für Betonung benutzt → nur in Definitionen oder "heißt"-Sätzen
          const isDefContext = inBlock?.kind === "Definition" || /\b(?:heißt|heißen|nennt man|nennen wir|bezeichnet man|bezeichnen wir)\b/u.test(sentence);
          if (!isDefContext) continue;
        }
        for (const term of splitTerms(raw)) {
          candidates.push({ term, page: p.page, y: it.y, h: it.h, offset: startOff, via: style === "b" ? "fett" : "kursiv" });
        }
      }
    }

    // "… heißt X, falls …" – im ganzen Skript, aber nur mit Bedingung danach (oder in einer Definition)
    for (const m of flat.matchAll(DEF_VERB)) {
      const t = cleanTerm(m[1]);
      if (!t) continue;
      const off = m.index! + m[0].length - m[1].length;
      const it = p.items[itemAt(starts, off)];
      const inBlock = blockAt(p.page, it?.y ?? 0);
      const after = flat.slice(off + t.length, off + t.length + 100);
      if (inBlock?.kind !== "Definition" && !DEF_CONDITION.test(after)) continue;
      candidates.push({ term: t, page: p.page, y: it?.y ?? 0, h: it?.h ?? bodyH, offset: off, via: "heißt" });
    }
  });

  // Kandidaten einsortieren: in einer Definition → Begriff dort ergänzen, sonst eigener Eintrag
  candidates.sort((a, b) => a.page - b.page || a.y - b.y);
  for (const c of candidates) {
    const inBlock = blockAt(c.page, c.y);
    const has = (e: Entry) => e.terms.some((t) => t.toLowerCase() === c.term.toLowerCase());
    if (inBlock && inBlock.kind === "Definition") {
      if (!has(inBlock)) inBlock.terms.push(c.term);
      continue;
    }
    // gleicher Satz/gleiche Zeile wie ein schon angelegter Eintrag → zusammenfassen
    const near = entries.find((e) => !e.number && e.hint && e.page === c.page && Math.abs(e.y + 4 - c.y) <= c.h * 1.6);
    if (near) {
      if (!has(near)) near.terms.push(c.term);
      continue;
    }
    const p = pages[c.page - 1];
    const { text, starts } = strs[c.page - 1];
    const sStart = Math.max(0, text.lastIndexOf(".", c.offset) + 1);
    // Bereich = der definierende Satz (bis zum nächsten Punkt), damit Erwähnungen direkt danach verlinkt werden
    const dot = text.slice(c.offset).search(/\.(?:\s|$)/u);
    const sentEnd = p.items[itemAt(starts, dot < 0 ? text.length - 1 : c.offset + dot)];
    entries.push({
      id: uid(),
      kind: "Definition",
      terms: [c.term],
      page: c.page,
      y: Math.max(0, c.y - 4),
      yEnd: Math.min(p.height, Math.max(c.y + c.h, (sentEnd?.y ?? c.y) + (sentEnd?.h ?? c.h))),
      source: "auto",
      hint: c.via,
      text: text.slice(sStart, sStart + 600).replace(/\s+/g, " ").trim(),
    });
  }

  // ---------- Fachbegriffe ohne erkannte Definition: erstes Vorkommen ----------
  // auch verwandte Formen gelten als definiert (Injektivität definiert → "injektiv" bekommt kein eigenes Ziel)
  const defined = new Set(entries.flatMap((e) => e.terms.flatMap((t) => [t, ...relatedForms(t)]).map(stemKey)));
  const firstSeen = new Map<string, { word: string; page: number; offset: number; count: number }>();
  pages.forEach((p, pi) => {
    const { text } = strs[pi];
    const flat = text.replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1\u00ad$2"); // Trennung merken, Länge bleibt gleich
    for (const m of flat.matchAll(/(?<![\p{L}\d])[\p{L}\u00ad]{4,}(?![\p{L}])/gu)) {
      const word = m[0].replace(/\u00ad/g, "");
      if (!isMathTerm(word)) continue;
      const key = stemKey(word);
      if (defined.has(key)) continue;
      const f = firstSeen.get(key);
      if (f) f.count++;
      else firstSeen.set(key, { word, page: p.page, offset: m.index!, count: 1 });
    }
  });
  for (const f of firstSeen.values()) {
    if (f.count < 2) continue; // nur Begriffe, auf die später auch verwiesen werden kann
    const p = pages[f.page - 1];
    const { text, starts } = strs[f.page - 1];
    const it = p.items[itemAt(starts, f.offset)];
    // Erstes Vorkommen mitten in einer Definition → Begriff gehört zu dieser Definition
    const inDef = blockAt(f.page, it?.y ?? 0);
    if (inDef?.kind === "Definition" && !inDef.hint) {
      inDef.terms.push(f.word);
      continue;
    }
    const sStart = Math.max(0, text.lastIndexOf(".", f.offset) + 1);
    entries.push({
      id: uid(),
      kind: "Begriff",
      terms: [f.word],
      page: f.page,
      y: Math.max(0, (it?.y ?? 0) - 4),
      yEnd: (it?.y ?? 0) + (it?.h ?? bodyH),
      source: "auto",
      hint: "erstes Vorkommen",
      text: text.slice(sStart, sStart + 400).replace(/\s+/g, " ").trim(),
    });
  }

  return entries.sort((a, b) => a.page - b.page || a.y - b.y);
}

// Typische Endungen deutscher mathematischer Fachbegriffe. Allein stehend sind viele davon Alltagswörter
// ("Funktion", "Folge", "Menge") – sie zählen nur als Teil eines zusammengesetzten Worts ("Äquivalenzrelation",
// "Exponentialfunktion", "Potenzmenge"). Die Wörter in MATH_STANDALONE zählen auch allein.
const MATH_SUFFIX =
  /(relation|abbildung|funktion|menge|raum|räume|folge|reihe|matrix|matrizen|ordnung|gruppe|körper|vektor|norm|integral|ableitung|verteilung|erwartungswert|varianz|kovarianz|schranke|grenzwert|klasse|basis|dimension|determinante|polynom|gleichung|operator|morphismus|topologie|metrik|umgebung|eigenwert|eigenvektor|zufallsvariable|dichte|korrelation|schätzer|algebra|häufungspunkt|nullstelle|extremum|maximum|minimum|supremum|infimum|rendite|barwert|kapitalwert|annuität|nebenbedingung|bijektion|injektion|surjektion|permutation|äquivalenz|partition|zerlegung|abschluss|quantil|hypothese|stichprobe|ereignis|kette)(?:en|n|e|s|es)?$/u;
const MATH_STANDALONE = new Set([
  "supremum", "infimum", "maximum", "minimum", "extremum", "eigenwert", "eigenvektor", "determinante", "polynom",
  "morphismus", "topologie", "metrik", "häufungspunkt", "nullstelle", "bijektion", "injektion", "surjektion",
  "permutation", "partition", "quantil", "varianz", "kovarianz", "erwartungswert", "zufallsvariable", "korrelation",
  "barwert", "kapitalwert", "annuität", "rendite", "nebenbedingung", "halbordnung", "äquivalenz", "grenzwert",
]);
const MATH_ADJ = new Set([
  "reflexiv", "irreflexiv", "symmetrisch", "antisymmetrisch", "asymmetrisch", "transitiv", "injektiv", "surjektiv",
  "bijektiv", "stetig", "differenzierbar", "integrierbar", "konvex", "konkav", "monoton", "beschränkt", "kompakt",
  "abgeschlossen", "invertierbar", "regulär", "singulär", "orthogonal", "orthonormal", "konvergent", "divergent",
  "abzählbar", "überabzählbar", "messbar", "semidefinit", "diagonalisierbar", "nilpotent", "idempotent",
  "kommutativ", "assoziativ", "distributiv", "isomorph", "unkorreliert", "erwartungstreu",
]);

function isMathTerm(word: string): boolean {
  const lower = word.toLowerCase();
  if (/^\p{Lu}/u.test(word) && word.length >= 7) {
    const m = MATH_SUFFIX.exec(lower);
    if (m) {
      const prefix = lower.slice(0, m.index);
      if (prefix.length >= 3 || (prefix === "" && MATH_STANDALONE.has(m[1]))) return true;
    }
  }
  const stem = lower.replace(/(?:en|em|er|es|e)$/u, "");
  return MATH_ADJ.has(lower) || MATH_ADJ.has(stem);
}

/** Vergleichsschlüssel unabhängig von Groß-/Kleinschreibung und Endungen ("Schranken" ~ "Schranke"). */
function stemKey(term: string): string {
  return term
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      const stem = w.replace(/(?:en|em|er|es|e|n|s)$/u, "");
      return stem.length >= 4 ? stem : w;
    })
    .join(" ");
}

// ---------- Verlinkung ----------

export type LinkRange = { start: number; end: number; entryId: string; label: string; term?: string };

const ENDINGS = /(?:en|em|er|es|e|n|s)$/u;

/** Regex-Muster für einen Begriff inkl. deutscher Flexion (Schranke/Schranken, obere/oberen, stetig/stetige). */
export function termPattern(term: string): string {
  return term
    .split(/\s+/)
    .map((w) => {
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const stem = w.replace(ENDINGS, "");
      const base = stem.replace(/[^\p{L}]/gu, "").length >= 4 ? stem : w;
      // Silbentrennung am Zeilenende ("Ordnungs-\nrelation") wird vorher entfernt, siehe dehyphenate()
      return esc(base) + "(?:e|en|em|er|es|n|s|nen)?";
    })
    .join("\\s+");
}

/** Entfernt Trennstriche am Zeilenende und liefert eine Rückabbildung auf die Originaloffsets. */
function dehyphenate(text: string): { t: string; map: number[] } {
  let t = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "-" && text[i + 1] === "\n" && /\p{Ll}/u.test(text[i - 1] ?? "") && /\p{Ll}/u.test(text[i + 2] ?? "")) {
      i++; // "-" und "\n" überspringen
      continue;
    }
    t += text[i];
    map.push(i);
  }
  map.push(text.length);
  return { t, map };
}

const before = (e: Entry, page: number, y: number) => e.page < page || (e.page === page && e.y < y - 1);
const inOwnBlock = (e: Entry, page: number, y: number) => e.page === page && y >= e.y - 2 && y <= e.yEnd;

export interface Linker {
  link(page: PageText, text: string): LinkRange[];
}

/**
 * Verknüpft Begriffe und Verweise ("Satz 2.3") mit ihren Definitionen.
 * Regel: Ein Verweis zeigt immer auf die ERSTE Stelle davor, an der der Begriff definiert wird (bzw. bei
 * Fachbegriffen ohne erkannte Definition: auf sein erstes Vorkommen). Ziel liegt immer auf einer früheren
 * Seite oder weiter oben auf derselben Seite; Vorkommen vor der ersten Definition werden nicht verlinkt.
 */
/** Kennung einer einzelnen Fundstelle – für "Nur diese Verknüpfung entfernen". */
export const linkKey = (page: number, start: number, term: string) => `${page}:${start}:${term.toLowerCase()}`;

export function buildLinker(
  entries: Entry[],
  disabledTerms: string[] = [],
  disabledLinks: string[] = [],
  wordPairs: WordPair[] = [],
): Linker {
  const disabled = new Set(disabledTerms.map((t) => t.toLowerCase()));
  const disabledAt = new Set(disabledLinks);
  const sorted = [...entries].sort((a, b) => a.page - b.page || a.y - b.y);

  // Begriff → alle Stellen, an denen er definiert wird (in Dokumentreihenfolge)
  const defs = new Map<string, { term: string; entries: Entry[] }>();
  for (const e of sorted) {
    for (const t of e.terms) {
      const key = t.toLowerCase();
      if (disabled.has(key)) continue;
      const d = defs.get(key) ?? { term: t, entries: [] };
      if (!d.entries.includes(e)) d.entries.push(e);
      defs.set(key, d);
    }
  }

  // Verwandte Wortformen (injektiv ↔ Injektivität): Begriffe, die Formen voneinander sind, bilden eine Familie
  // mit gemeinsamen Zielen; Formen, die selbst nicht definiert sind, verweisen auf den Begriff, aus dem sie entstehen.
  const keys = [...defs.keys()];
  const parent = new Map(keys.map((k) => [k, k]));
  const root = (k: string): string => (parent.get(k) === k ? k : root(parent.get(k)!));
  const anchored = new Map(keys.map((k) => [k, new RegExp(`^(?:${termPattern(defs.get(k)!.term)})$`, "iu")]));
  const definedKeyOf = (form: string) => keys.find((k) => anchored.get(k)!.test(form));
  const variantOf = new Map<string, string | null>(); // Form → Begriff (null = mehrdeutig, wird nicht verlinkt)
  for (const k of keys) {
    for (const f of relatedForms(defs.get(k)!.term, wordPairs)) {
      if (disabled.has(f)) continue; // entfernte Begriffe nicht über eine andere Form zurückholen
      const other = definedKeyOf(f);
      if (other) {
        if (other !== k) parent.set(root(other), root(k));
      } else if (variantOf.has(f) && variantOf.get(f) !== k) variantOf.set(f, null);
      else variantOf.set(f, k);
    }
  }
  const families = new Map<string, Entry[]>();
  for (const k of keys) families.set(root(k), [...(families.get(root(k)) ?? []), ...defs.get(k)!.entries]);
  const famEntries = new Map<string, Entry[]>();
  for (const [r, list] of families) {
    let all = [...new Set(list)].sort((a, b) => a.page - b.page || a.y - b.y);
    const merged = keys.filter((k) => root(k) === r).length > 1;
    // mehrere Formen mit echter Definition: dorthin verweisen, nicht auf das erste Vorkommen einer der Formen
    if (merged && all.some((e) => e.kind !== "Begriff")) all = all.filter((e) => e.kind !== "Begriff");
    famEntries.set(r, all);
  }

  // Längere Formen zuerst, damit "partielle Ordnung" vor "Ordnung" greift
  const termList = [
    ...keys.map((k) => ({ form: defs.get(k)!.term, term: defs.get(k)!.term, entries: famEntries.get(root(k))! })),
    ...[...variantOf].flatMap(([f, k]) => (k ? [{ form: f, term: defs.get(k)!.term, entries: famEntries.get(root(k))! }] : [])),
  ]
    .sort((a, b) => b.form.length - a.form.length)
    .map((x) => ({ ...x, re: new RegExp(`^(?:${termPattern(x.form)})$`, "iu") }));
  const combined = termList.length
    ? new RegExp(`(?<![\\p{L}\\d])(?:${termList.map((x) => termPattern(x.form)).join("|")})(?![\\p{L}])`, "giu")
    : null;

  const byNumber = new Map<string, Entry[]>();
  for (const e of sorted) {
    if (!e.number) continue;
    byNumber.set(e.number, [...(byNumber.get(e.number) ?? []), e]);
  }
  const refRe = new RegExp(`(${KIND_ALT}|Sätze|Definitionen)\\s*${NUM}`, "gu");

  return {
    link(page, text) {
      const ranges: LinkRange[] = [];
      const { starts } = pageString(page);
      const yAt = (off: number) => page.items[itemAt(starts, off)]?.y ?? 0;

      // 1. Verweise wie "Satz 2.3" / "nach Definition 1.1" – nur auf frühere Stellen
      for (const m of text.matchAll(refRe)) {
        const list = byNumber.get(m[2]);
        if (!list) continue;
        const y = yAt(m.index!);
        const kind = kindOf(m[1].replace(/en$|e$/, "").replace("Sätz", "Satz"));
        const earlier = list.filter((e) => before(e, page.page, y) && !inOwnBlock(e, page.page, y));
        const target = earlier.findLast((e) => e.kind === kind) ?? earlier.at(-1);
        if (!target) continue;
        ranges.push({ start: m.index!, end: m.index! + m[0].length, entryId: target.id, label: `${target.kind} ${target.number}` });
      }

      // 2. Begriffe
      if (combined) {
        const { t, map } = dehyphenate(text);
        for (const m of t.matchAll(combined)) {
          const start = map[m.index!];
          const end = map[m.index! + m[0].length - 1] + 1;
          if (ranges.some((r) => start < r.end && end > r.start)) continue;
          const hit = termList.find((x) => x.re.test(m[0]));
          if (!hit) continue;
          const y = yAt(start);
          if (hit.entries.some((e) => inOwnBlock(e, page.page, y))) continue; // die Definition selbst
          // Ziel: die erste Stelle, an der der Begriff auftritt/definiert wird – sofern sie davor liegt
          const target = hit.entries.find((e) => before(e, page.page, y));
          if (!target) continue; // Begriff wird erst später definiert
          if (disabledAt.has(linkKey(page.page, start, hit.term))) continue; // einzeln entfernt
          ranges.push({
            start,
            end,
            entryId: target.id,
            label: target.kind === "Begriff" ? `Erstes Vorkommen: ${hit.term}` : `${target.kind}${target.number ? " " + target.number : ""}: ${hit.term}`,
            term: hit.term,
          });
        }
      }
      return ranges.sort((a, b) => a.start - b.start);
    },
  };
}

export function entryLabel(e: Entry): string {
  return `${e.kind}${e.number ? " " + e.number : ""}${e.terms[0] ? " – " + e.terms[0] : ""}`;
}

// ---------- Automatische Suche beim Anpinnen ----------

export interface DefCandidate {
  page: number;
  y: number;
  h: number;
  context: string;
  score: number;
  reasons: string[];
  verdict: "wahrscheinlich" | "möglich" | "unwahrscheinlich";
  block: Entry | null; // Definition/Satz, in der die Stelle steht
}

/**
 * Sucht alle früheren Vorkommen eines Begriffs (vor Seite/Höhe `at`) und bewertet,
 * wie wahrscheinlich dort die mathematische Definition steht.
 */
export function findDefinitionCandidates(
  pages: PageText[],
  entries: Entry[],
  term: string,
  at: { page: number; y: number },
): DefCandidate[] {
  const clean = term.replace(/[„“"',.;:!?()]/gu, "").replace(/\s+/g, " ").trim();
  if (clean.length < 2) return [];
  const re = new RegExp(`(?<![\\p{L}\\d])(?:${termPattern(clean)})(?![\\p{L}])`, "giu");
  const out: DefCandidate[] = [];
  let first = true;

  for (const p of pages) {
    if (p.page > at.page) break;
    const { text, starts } = pageString(p);
    const { t, map } = dehyphenate(text);
    for (const m of t.matchAll(re)) {
      const start = map[m.index!];
      const end = map[m.index! + m[0].length - 1] + 1;
      const k0 = itemAt(starts, start);
      const k1 = itemAt(starts, Math.max(start, end - 1));
      const it = p.items[k0];
      if (p.page === at.page && it.y >= at.y - 1) continue; // nur Stellen davor

      const reasons: string[] = [];
      let score = 0;
      const items = p.items.slice(k0, k1 + 1);
      if (items.some((x) => x.b)) {
        score += 5;
        reasons.push("fett");
      } else if (items.some((x) => x.i)) {
        score += 2;
        reasons.push("kursiv");
      }
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const line = text.slice(lineStart, text.indexOf("\n", end) === -1 ? text.length : text.indexOf("\n", end));
      if ((HEAD_A.test(line) || HEAD_B.test(line)) && text[start - 1] === "(") {
        score += 5;
        reasons.push("Name in Überschrift");
      }
      const pre = text.slice(Math.max(0, start - 70), start).replace(/\s+/g, " ");
      if (/(?:heißt|heißen|heisst|nennt man|nennen wir|bezeichnet man als|bezeichnen wir als)\s+(?:\S+\s+){0,3}$/u.test(pre)) {
        score += 4;
        reasons.push("„heißt …“");
      }
      const block = entries.find((e) => inOwnBlock(e, p.page, it.y) && e.number) ?? null;
      if (block?.kind === "Definition") {
        score += 4;
        reasons.push(`in Definition${block.number ? " " + block.number : ""}`);
      } else if (block) {
        score += 1;
        reasons.push(`in ${block.kind} ${block.number ?? ""}`.trim());
      }
      if (entries.some((e) => e.page === p.page && Math.abs(e.y + 4 - it.y) < it.h * 2 && e.terms.some((x) => x.toLowerCase() === clean.toLowerCase()))) {
        score += 2;
        reasons.push("bereits erkannt");
      }
      if (first) {
        score += 1;
        reasons.push("erstes Vorkommen");
        first = false;
      }
      const ctxStart = Math.max(0, text.lastIndexOf("\n", lineStart - 2) + 1);
      out.push({
        page: p.page,
        y: it.y,
        h: it.h,
        context: text.slice(ctxStart, Math.min(text.length, end + 160)).replace(/-\n/g, "").replace(/\s+/g, " ").trim(),
        score,
        reasons,
        verdict: score >= 5 ? "wahrscheinlich" : score >= 2 ? "möglich" : "unwahrscheinlich",
        block,
      });
    }
  }
  // Beste zuerst; bei Gleichstand die frühere Stelle (dort wird ein Begriff meist eingeführt)
  return out.sort((a, b) => b.score - a.score || a.page - b.page || a.y - b.y).slice(0, 12);
}
