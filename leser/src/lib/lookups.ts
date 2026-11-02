import { get, getAll, put, type Entry, type Lookup } from "./db";
import { entryLabel } from "./indexer";

/**
 * Stufen danach, wie oft ein Begriff seit der letzten Abfrage nachgeschlagen wurde.
 * Schon 1 Klick heißt "noch nicht sicher"; mit jedem weiteren Nachschlagen steigt die Stufe.
 */
export const LEVELS = [
  { min: 0, label: "sicher", cls: "lvl0" },
  { min: 1, label: "noch nicht sicher", cls: "lvl1" },
  { min: 2, label: "unsicher", cls: "lvl2" },
  { min: 4, label: "sehr unsicher", cls: "lvl3" },
  { min: 7, label: "kritisch", cls: "lvl4" },
] as const;

const keyOf = (scriptId: string, term: string) => `${scriptId}:${term.toLowerCase()}`;

/** Stufe 0–4 aus den Klicks seit der letzten Abfrage und dem letzten Abfrageergebnis. */
export function level(l: Lookup): number {
  let lv = 0;
  for (let i = LEVELS.length - 1; i > 0; i--) {
    if (l.sinceReview >= LEVELS[i].min) {
      lv = i;
      break;
    }
  }
  const last = l.reviews.at(-1)?.grade;
  if (last === 0) lv = Math.min(LEVELS.length - 1, Math.max(lv + 1, 2)); // nicht gewusst → mindestens "unsicher"
  else if (last === 1) lv = Math.max(lv, 1); // teilweise → bleibt vorgemerkt
  return lv;
}

export const levelInfo = (l: Lookup) => LEVELS[level(l)];

/** Zählt einen Klick auf einen Begriff. Liefert den alten und den neuen Stand. */
export async function recordLookup(scriptId: string, term: string, entry: Entry): Promise<{ before: Lookup | undefined; after: Lookup }> {
  const id = keyOf(scriptId, term);
  const old = await get<Lookup>("lookups", id);
  const next: Lookup = {
    id,
    scriptId,
    term,
    label: entry.kind === "Begriff" ? `Erstes Vorkommen: ${term}` : entryLabel(entry),
    target: { page: entry.page, y: entry.y, yEnd: entry.yEnd, text: entry.text },
    clicks: (old?.clicks ?? 0) + 1,
    sinceReview: (old?.sinceReview ?? 0) + 1,
    lastClick: Date.now(),
    reviews: old?.reviews ?? [],
  };
  await put("lookups", next);
  return { before: old, after: next };
}

export const isWeak = (l: Lookup) => level(l) > 0;

/** Reihenfolge fürs Abfragen: höchste Stufe zuerst, dann am häufigsten nachgeschlagen. */
export const byUrgency = (a: Lookup, b: Lookup) =>
  level(b) - level(a) || b.sinceReview - a.sinceReview || b.clicks - a.clicks || b.lastClick - a.lastClick;

/** Definitionen, die abgefragt werden sollten – dringendste zuerst. */
export async function weakLookups(scriptId?: string): Promise<Lookup[]> {
  const all = await getAll<Lookup>("lookups");
  return all.filter((l) => (!scriptId || l.scriptId === scriptId) && isWeak(l)).sort(byUrgency);
}

/** Ergebnis einer Abfrage speichern. "Gewusst" setzt den Klickzähler zurück, "teilweise" halbiert ihn. */
export async function gradeLookup(l: Lookup, grade: 0 | 1 | 2): Promise<Lookup> {
  const next: Lookup = {
    ...l,
    sinceReview: grade === 2 ? 0 : grade === 1 ? Math.max(1, Math.floor(l.sinceReview / 2)) : l.sinceReview,
    reviews: [...l.reviews, { at: Date.now(), grade }].slice(-20),
  };
  await put("lookups", next);
  return next;
}
