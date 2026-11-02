// Neue Version eines Skripts: Die neue PDF ersetzt die alte, das Skript (Kachel, Titel, Fach) bleibt dasselbe.
// Notizen, selbst angelegte Einträge, entfernte Verknüpfungen und die Leseposition werden über den TEXT der Seiten
// auf die neue Fassung übertragen – nicht über die Seitennummer, damit sie auch bei verschobenen Seiten passen.

import { del, get, getAll, put, uid, type Entry, type Lookup, type PageText, type Script, type ScriptIndex, type VersionChanges } from "./db";
import { closePdf, extractAll, loadPdf, pageString } from "./pdf";
import { detectEntries, linkKey, termPattern } from "./indexer";
import { INDEX_VERSION, mergeEntries } from "./ingest";
import { DATE_SCAN_VERSION, findDocDate } from "./docdate";
import type { Annotations, CompareItem, OrphanInk, PageInk, StickyNote, Stroke } from "./ink";
import { PDFDocument } from "pdf-lib";

const NEW_BADGE_DAYS = 14;
const MATCH_MIN = 0.35; // ab dieser Ähnlichkeit gelten zwei Seiten als dieselbe
const FALLBACK_MIN = 0.5; // Zuordnung außerhalb der Reihenfolge (verschobene Seiten) nur bei klarer Ähnlichkeit

// ---------- Seiten vergleichen ----------

/** Wörter einer Seite (klein, ohne Silbentrennung und Satzzeichen). */
export function pageWords(p: PageText): string[] {
  const { text } = pageString(p);
  return text
    .replace(/-\n(\p{Ll})/gu, "$1")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2);
}

/** Menge der Wortpaare – robust gegen kleine Korrekturen, empfindlich für die Reihenfolge. */
function shingles(words: string[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < words.length; i++) s.add(i + 1 < words.length ? words[i] + " " + words[i + 1] : words[i]);
  return s;
}

/** Dice-Ähnlichkeit zweier Seiten (0 … 1). */
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) common++;
  return (2 * common) / (a.size + b.size);
}

export interface PageMatch {
  map: (number | null)[]; // alte Seite (Index) → neue Seitennummer
  sim: number[]; // Ähnlichkeit der Zuordnung
}

/**
 * Ordnet alte Seiten den neuen zu. Hauptweg: Ausrichtung in Reihenfolge (wie ein Text-Diff), die die Summe der
 * Ähnlichkeiten maximiert – neue Kapitel und eingeschobene Seiten werden dabei übersprungen. Danach: verschobene
 * Seiten außerhalb der Reihenfolge und Seiten ohne Text (Bilder) anhand ihrer Nachbarn.
 */
export function matchPages(oldPages: PageText[], newPages: PageText[]): PageMatch {
  const A = oldPages.map((p) => shingles(pageWords(p)));
  const B = newPages.map((p) => shingles(pageWords(p)));
  const n = A.length;
  const m = B.length;
  const S = A.map((a) => B.map((b) => similarity(a, b)));

  // Ausrichtung (dynamische Programmierung)
  const score: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = S[i - 1][j - 1];
      score[i][j] = Math.max(score[i - 1][j], score[i][j - 1], s >= MATCH_MIN ? score[i - 1][j - 1] + s : -Infinity);
    }
  }
  const map: (number | null)[] = new Array(n).fill(null);
  const sim: number[] = new Array(n).fill(0);
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const s = S[i - 1][j - 1];
    if (s >= MATCH_MIN && score[i][j] === score[i - 1][j - 1] + s) {
      map[i - 1] = j;
      sim[i - 1] = s;
      i--;
      j--;
    } else if (score[i][j] === score[i - 1][j]) i--;
    else j--;
  }

  const used = new Set(map.filter((x): x is number => x !== null));
  // Verschobene Seiten (außerhalb der Reihenfolge)
  for (let i = 0; i < n; i++) {
    if (map[i] !== null) continue;
    let best = -1;
    for (let j = 0; j < m; j++) if (!used.has(j + 1) && S[i][j] >= FALLBACK_MIN && (best < 0 || S[i][j] > S[i][best])) best = j;
    if (best >= 0) {
      map[i] = best + 1;
      sim[i] = S[i][best];
      used.add(best + 1);
    }
  }
  // Seiten (fast) ohne Text, z. B. Abbildungen: zwischen zwei zugeordneten Nachbarn mit passendem Abstand
  for (let i = 0; i < n; i++) {
    if (map[i] !== null || A[i].size > 8) continue;
    const prev = i > 0 ? map[i - 1] : 0;
    const next = i + 1 < n ? map[i + 1] : m + 1;
    if (prev === null || next === null) continue;
    const cand = prev + 1;
    if (cand <= m && !used.has(cand) && (next === cand + 1 || i + 1 === n) && B[cand - 1].size <= 8) {
      map[i] = cand;
      sim[i] = A[i].size === B[cand - 1].size && similarity(A[i], B[cand - 1]) === 1 ? 1 : 0.5;
      used.add(cand);
    }
  }
  return { map, sim };
}

// ---------- Position auf der Seite ----------

/** Zeilen einer Seite: normalisierter Text → Höhe. Nur eindeutige, ausreichend lange Zeilen. */
function lineYs(p: PageText): Map<string, number> {
  const out = new Map<string, number>();
  const dup = new Set<string>();
  let text = "";
  let y: number | null = null;
  const flush = () => {
    const key = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (key.length >= 6 && y !== null) {
      if (out.has(key)) dup.add(key);
      else out.set(key, y);
    }
    text = "";
    y = null;
  };
  for (const it of p.items) {
    if (it.s.trim() && y === null) y = it.y;
    text += it.s;
    if (it.eol) flush();
  }
  flush();
  for (const k of dup) out.delete(k);
  return out;
}

/** Senkrechte Verschiebung des Inhalts zwischen alter und neuer Seite (Median über gleiche Zeilen). */
export function verticalShift(oldPage: PageText, newPage: PageText): number {
  const a = lineYs(oldPage);
  const b = lineYs(newPage);
  const d: number[] = [];
  for (const [k, y] of a) {
    const y2 = b.get(k);
    if (y2 !== undefined) d.push(y2 - y);
  }
  if (d.length < 2) return 0;
  d.sort((x, y) => x - y);
  const med = d[Math.floor(d.length / 2)];
  return Math.abs(med) < 0.5 ? 0 : med;
}

const shiftStroke = (s: Stroke, dy: number): Stroke =>
  dy ? { ...s, points: s.points.map((v, i) => (i % 3 === 1 ? v + dy : v)) } : s;

/** Fundstelle eines Begriffs auf der neuen Seite wiederfinden – über den Text davor und danach. */
function relocateOffset(oldText: string, start: number, term: string, newText: string): number | null {
  const re = new RegExp(`(?<![\\p{L}\\d])(?:${termPattern(term)})(?![\\p{L}])`, "giu");
  const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
  const ctxBefore = norm(oldText.slice(Math.max(0, start - 40), start));
  const ctxAfter = norm(oldText.slice(start, start + 60));
  const score = (a: string, b: string, fromEnd: boolean) => {
    let k = 0;
    while (k < a.length && k < b.length && (fromEnd ? a[a.length - 1 - k] === b[b.length - 1 - k] : a[k] === b[k])) k++;
    return k;
  };
  let best: { at: number; s: number } | null = null;
  for (const m of newText.matchAll(re)) {
    const at = m.index!;
    const s = score(ctxBefore, norm(newText.slice(Math.max(0, at - 40), at)), true) + score(ctxAfter, norm(newText.slice(at, at + 60)), false);
    if (!best || s > best.s) best = { at, s };
  }
  return best && best.s >= 12 ? best.at : null;
}

/** Gleicher Text (Wort für Wort)? Dann bleibt die Seite der bisherigen Fassung im Skript. */
// völlig gleich (auch Zahlen und Satzzeichen) – dann kann die Seite aus der bisherigen PDF bleiben
const flatText = (p: PageText) => pageString(p).text.replace(/\s+/g, " ").trim();
const sameText = (a: PageText, b: PageText) => flatText(a) === flatText(b);

/** Text ohne Zahlen in Kopf- und Fußzeile – Seitenzahlen („Seite 15 von 40“) und Stand-Datum ändern sich auch auf
 *  Seiten, deren Inhalt gleich geblieben ist. */
function bodyText(p: PageText): string {
  const band = p.height * 0.09;
  const items = p.items.map((it) => (it.y < band || it.y + it.h > p.height - band ? { ...it, s: it.s.replace(/\d+/g, " ") } : it));
  return pageWords({ ...p, items }).join(" ");
}
const sameBody = (a: PageText, b: PageText) => bodyText(a) === bodyText(b);

/**
 * Setzt das Skript aus Seiten der alten und der neuen PDF zusammen (in der Reihenfolge der neuen Fassung).
 * Liefert null, wenn eine der Dateien nicht bearbeitet werden kann (z. B. verschlüsselt) – dann gilt die neue PDF.
 */
export async function composePdf(oldBlob: Blob, newBlob: Blob, sources: { from: "old" | "new"; page: number }[]): Promise<Uint8Array | null> {
  try {
    const [oldPdf, newPdf] = await Promise.all([
      PDFDocument.load(await oldBlob.arrayBuffer(), { ignoreEncryption: true }),
      PDFDocument.load(await newBlob.arrayBuffer(), { ignoreEncryption: true }),
    ]);
    const out = await PDFDocument.create();
    const pick = async (src: PDFDocument, which: "old" | "new") => {
      const idx = sources.map((s, i) => (s.from === which ? i : -1)).filter((i) => i >= 0);
      const copied = await out.copyPages(src, idx.map((i) => sources[i].page - 1));
      return new Map(idx.map((i, k) => [i, copied[k]]));
    };
    const fromOld = await pick(oldPdf, "old");
    const fromNew = await pick(newPdf, "new");
    sources.forEach((_, i) => out.addPage(fromOld.get(i) ?? fromNew.get(i)!));
    return await out.save();
  } catch {
    return null;
  }
}

// ---------- Neue Version vorbereiten und übernehmen ----------

export interface VersionPlan {
  script: Script;
  file: File;
  pageCount: number;
  oldPageCount: number;
  matchedShare: number; // Anteil der alten Textseiten, die wiedergefunden wurden
  report: VersionChanges;
  commit: () => Promise<Script>;
}

/**
 * Liest die neue PDF und berechnet die Zuordnung. Gespeichert wird erst mit plan.commit() – so kann vorher
 * nachgefragt werden, falls die Datei offenbar ein ganz anderes Skript ist.
 */
export async function prepareNewVersion(
  scriptId: string,
  file: File,
  onProgress: (msg: string, frac: number) => void,
): Promise<VersionPlan> {
  const script = await get<Script>("scripts", scriptId);
  const oldIndex = await get<ScriptIndex>("indexes", scriptId);
  if (!script || !oldIndex) throw new Error("Skript nicht gefunden.");
  const ann = await get<Annotations>("annotations", scriptId);

  onProgress("Neue PDF wird geladen …", 0);
  const doc = await loadPdf(file);
  let pages: PageText[];
  try {
    pages = await extractAll(doc, (d, t) => onProgress(`Text wird gelesen: Seite ${d}/${t}`, (d / t) * 0.85));
  } finally {
    await closePdf(doc);
  }
  onProgress("Seiten werden verglichen …", 0.88);
  const oldPages = oldIndex.pages;
  const { map } = matchPages(oldPages, pages);
  const shift = oldPages.map((p, i) => (map[i] ? verticalShift(p, pages[map[i]! - 1]) : 0));
  const textPages = oldPages.filter((p) => pageWords(p).length > 8).length;
  const matchedShare = textPages ? oldPages.filter((p, i) => map[i] !== null && pageWords(p).length > 8).length / textPages : 1;

  // Unveränderte Seiten (gleicher Inhalt; Seitenzahl/Datum in Kopf- und Fußzeile zählen nicht): Notizen gehen ohne
  // Vergleich mit. Ist die Seite ganz gleich, bleibt sie aus der bisherigen Fassung, sonst kommt die neue (mit der
  // richtigen Seitenzahl).
  const version = (script.version ?? 1) + 1;
  const same = oldPages.map((p, i) => !!map[i] && sameBody(p, pages[map[i]! - 1]));
  const oldOf = new Map<number, number>(); // neue Seite → alte Seite (nur völlig gleich)
  oldPages.forEach((p, i) => same[i] && sameText(p, pages[map[i]! - 1]) && oldOf.set(map[i]!, i));
  const sources = pages.map((p) => (oldOf.has(p.page) ? { from: "old" as const, page: oldOf.get(p.page)! + 1 } : { from: "new" as const, page: p.page }));
  const mergedPages = pages.map((p) => (oldOf.has(p.page) ? { ...oldPages[oldOf.get(p.page)!], page: p.page } : p));
  onProgress("Skript wird zusammengesetzt …", 0.9);
  const oldFile = await get<{ id: string; blob: Blob }>("files", scriptId);
  const composed = oldFile && oldOf.size ? await composePdf(oldFile.blob, file, sources) : null;
  const merged: Blob = composed ? new Blob([composed as BlobPart], { type: "application/pdf" }) : file;
  const unchanged = same.filter(Boolean).length;

  // Noch offene Vergleiche der vorigen Version: deren Notizen gelten als auf der damaligen neuen Seite stehend
  const oldInk: PageInk = { ...(ann?.pages ?? {}) };
  let oldNotes: StickyNote[] = [...(ann?.notes ?? [])];
  for (const c of ann?.compare ?? []) {
    if (c.done) continue;
    oldInk[c.newPage] = [...(oldInk[c.newPage] ?? []), ...c.strokes.map((st) => shiftStroke(st, c.dy))];
    oldNotes = [...oldNotes, ...c.notes.map((n) => ({ ...n, page: c.newPage, y: Math.max(0, n.y + c.dy) }))];
  }

  // Notizen: unveränderte Seiten → mit; geänderte Seiten mit Notizen → Verbesserungsansicht (alt links, neu rechts);
  // Seiten ohne Gegenstück → „Notizen ohne Seite“
  const ink: PageInk = {};
  const orphans: OrphanInk[] = [...(ann?.orphans ?? [])];
  const compareByOld = new Map<number, CompareItem>();
  const compareFor = (i: number): CompareItem => {
    let c = compareByOld.get(i);
    if (!c) {
      c = { id: uid(), oldPage: i + 1, newPage: map[i]!, dy: shift[i], oldText: oldPages[i], strokes: [], notes: [] };
      compareByOld.set(i, c);
    }
    return c;
  };
  let movedPages = 0;
  let orphaned = 0;
  for (const [k, strokes] of Object.entries(oldInk)) {
    const i = Number(k) - 1;
    if (!strokes?.length || !oldPages[i]) continue;
    const j = map[i];
    if (j && same[i]) {
      ink[j] = [...(ink[j] ?? []), ...(oldOf.get(j) === i ? strokes : strokes.map((st) => shiftStroke(st, shift[i])))];
      movedPages++;
    } else if (j) {
      compareFor(i).strokes.push(...strokes);
    } else {
      orphans.push({
        id: uid(),
        fromVersion: version - 1,
        oldPage: i + 1,
        width: oldPages[i].width,
        height: oldPages[i].height,
        snippet: pageString(oldPages[i]).text.replace(/\s+/g, " ").trim().slice(0, 140),
        strokes,
      });
      orphaned++;
    }
  }

  // Notiz-Zettel: unverändert → mit; geändert → Verbesserungsansicht; ohne Gegenstück an den Anfang der nächsten
  // früheren Seite, die es noch gibt – Notizen gehen nie verloren
  const notes: StickyNote[] = [];
  for (const n of oldNotes) {
    const i = n.page - 1;
    if (map[i] && same[i]) notes.push({ ...n, page: map[i]!, y: oldOf.get(map[i]!) === i ? n.y : Math.max(0, n.y + shift[i]) });
    else if (map[i]) compareFor(i).notes.push(n);
    else {
      let k = Math.min(i, oldPages.length - 1);
      while (k >= 0 && !map[k]) k--;
      notes.push({ ...n, page: k >= 0 ? map[k]! : 1, x: 20, y: 20 });
    }
  }
  const compare = [...compareByOld.values()].sort((x, y) => x.newPage - y.newPage);
  const review = new Set(compare.map((c) => c.newPage));

  // Selbst angelegte Einträge (Anpinnen, eigene Definitionen) übertragen
  let droppedEntries = 0;
  const kept: Entry[] = [];
  for (const e of oldIndex.entries) {
    if (e.source === "auto") continue;
    const j = map[e.page - 1];
    if (!j) {
      droppedEntries++;
      continue;
    }
    const dy = shift[e.page - 1];
    kept.push({ ...e, page: j, y: Math.max(0, e.y + dy), yEnd: e.yEnd + dy });
  }

  // Einzeln entfernte Verknüpfungen: Fundstelle auf der neuen Seite wiederfinden
  const disabledLinks: string[] = [];
  for (const key of oldIndex.disabledLinks ?? []) {
    const [pg, st, ...rest] = key.split(":");
    const term = rest.join(":");
    const i = Number(pg) - 1;
    const j = map[i];
    if (!j || !oldPages[i]) continue;
    const at = relocateOffset(pageString(oldPages[i]).text, Number(st), term, pageString(pages[j - 1]).text);
    if (at !== null) disabledLinks.push(linkKey(j, at, term));
  }

  onProgress("Verknüpfungen werden neu erkannt …", 0.93);
  const entries = mergeEntries(detectEntries(mergedPages), kept);
  const index: ScriptIndex = {
    scriptId,
    version: INDEX_VERSION,
    pages: mergedPages,
    entries,
    disabledTerms: oldIndex.disabledTerms, // komplett entfernte Begriffe bleiben entfernt
    disabledLinks,
  };

  const usedNew = new Set(map.filter((x): x is number => x !== null));
  const newPages = pages.map((p) => p.page).filter((pg) => !usedNew.has(pg));
  const report: VersionChanges = {
    version,
    at: Date.now(),
    fromPages: oldPages.length,
    newPages,
    newUntil: Date.now() + NEW_BADGE_DAYS * 86400000,
    review: [...review].sort((a, b) => a - b),
    movedPages,
    unchanged,
    orphaned,
    droppedEntries,
  };

  // Leseposition: dieselbe Stelle, sonst die nächste frühere Seite, die es noch gibt
  let lastPage = script.lastPage;
  if (lastPage) {
    let i = Math.min(lastPage, oldPages.length) - 1;
    while (i >= 0 && !map[i]) i--;
    lastPage = i >= 0 ? map[i]! : 1;
  }

  const next: Script = {
    ...script,
    pageCount: pages.length,
    size: merged.size,
    lastPage,
    version,
    docDate: findDocDate(pages, Date.now()),
    dateScan: DATE_SCAN_VERSION,
    versions: [
      ...(script.versions ?? [{ n: script.version ?? 1, uploadedAt: script.createdAt, fileName: script.title + ".pdf", pageCount: script.pageCount }]),
      { n: version, uploadedAt: Date.now(), fileName: file.name, pageCount: pages.length },
    ],
    changes: report,
  };

  return {
    script: next,
    file,
    pageCount: pages.length,
    oldPageCount: oldPages.length,
    matchedShare,
    report,
    async commit() {
      onProgress("Wird gespeichert …", 0.97);
      // vorige Fassung aufheben, solange Vergleiche offen sind (alte Seite links / „Alte Seite behalten“)
      const compareFile = compare.length && oldFile ? `${scriptId}@v${version - 1}` : undefined;
      if (compareFile && oldFile) await put("files", { id: compareFile, blob: oldFile.blob });
      if (ann?.compareFile && ann.compareFile !== compareFile) await del("files", ann.compareFile);
      await put("files", { id: scriptId, blob: merged });
      await put("indexes", index);
      await put<Annotations>("annotations", { scriptId, pages: ink, orphans, notes, compare, compareFile, updatedAt: Date.now() });
      // Abfrage-Statistik: gespeicherte Stelle der Definition mitnehmen
      for (const l of await getAll<Lookup>("lookups")) {
        if (l.scriptId !== scriptId) continue;
        const j = map[l.target.page - 1];
        if (j) await put<Lookup>("lookups", { ...l, target: { ...l.target, page: j, y: l.target.y + shift[l.target.page - 1], yEnd: l.target.yEnd + shift[l.target.page - 1] } });
      }
      await put("scripts", next);
      await del("thumbs", scriptId); // Vorschaubild wird neu erzeugt
      onProgress("Fertig", 1);
      return next;
    },
  };
}

/** Text für die Zusammenfassung nach dem Hochladen. */
export function describeChanges(c: VersionChanges, pageCount: number): string[] {
  const out = [`Version ${c.version}: ${c.fromPages} → ${pageCount} Seiten`];
  if (c.newPages.length) out.push(`${c.newPages.length} neue ${c.newPages.length === 1 ? "Seite" : "Seiten"} (${pageRanges(c.newPages)})`);
  if (c.unchanged) out.push(`${c.unchanged} unveränderte ${c.unchanged === 1 ? "Seite" : "Seiten"} – Notizen direkt übernommen, ohne Vergleich`);
  if (c.movedPages) out.push(`Notizen von ${c.movedPages} ${c.movedPages === 1 ? "Seite" : "Seiten"} übernommen`);
  if (c.review.length) out.push(`${c.review.length} ${c.review.length === 1 ? "Seite" : "Seiten"} mit Notizen geändert – in der Verbesserungsansicht vergleichen (${pageRanges(c.review)})`);
  if (c.orphaned) out.push(`Notizen von ${c.orphaned} ${c.orphaned === 1 ? "alter Seite" : "alten Seiten"} ohne Gegenstück – gesammelt unter „Notizen ohne Seite“`);
  if (c.droppedEntries) out.push(`${c.droppedEntries} selbst angelegte ${c.droppedEntries === 1 ? "Verknüpfung" : "Verknüpfungen"} ließ sich keiner Seite zuordnen`);
  return out;
}

/** [3,4,5,9] → "S. 3–5, 9" */
export function pageRanges(pages: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`);
    i = j;
  }
  return "S. " + parts.join(", ");
}
