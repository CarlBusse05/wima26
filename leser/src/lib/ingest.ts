import { get, put, uid, type Entry, type Script, type ScriptIndex } from "./db";
import { closePdf, extractAll, loadPdf, type PDFDocumentProxy } from "./pdf";
import { detectEntries } from "./indexer";
import { DATE_SCAN_VERSION, findDocDate } from "./docdate";

// 2: Schriftstil (fett/kursiv) pro Textstück, Verlinkung nur rückwärts
// 3: erstes Vorkommen von Fachbegriffen ohne Definition als Ziel
// 4: verwandte Wortformen (Injektivität ↔ injektiv) bekommen kein eigenes "erstes Vorkommen"
export const INDEX_VERSION = 4;

export async function ingestPdf(
  file: File,
  course: string,
  onProgress: (msg: string, frac: number) => void,
): Promise<Script> {
  onProgress("PDF wird geladen …", 0);
  const doc = await loadPdf(file);
  const id = uid();
  const script: Script = {
    id,
    title: file.name.replace(/\.pdf$/i, ""),
    course: course.trim() || "Allgemein",
    createdAt: Date.now(),
    pageCount: doc.numPages,
    size: file.size,
  };
  await put("files", { id, blob: file });
  const pages = await extractAll(doc, (d, t) => onProgress(`Text wird gelesen: Seite ${d}/${t}`, (d / t) * 0.9));
  // Datum des neuesten Aufschriebs (z. B. "Vorlesung 23. Oktober") für die Kachel
  script.docDate = findDocDate(pages, script.createdAt);
  script.dateScan = DATE_SCAN_VERSION;
  onProgress("Definitionen werden gesucht …", 0.95);
  const entries = detectEntries(pages);
  const index: ScriptIndex = { scriptId: id, version: INDEX_VERSION, pages, entries, disabledTerms: [] };
  await put("indexes", index);
  await put("scripts", script);
  await closePdf(doc);
  onProgress("Fertig", 1);
  return script;
}

export async function reindex(scriptId: string): Promise<ScriptIndex | undefined> {
  const index = await get<ScriptIndex>("indexes", scriptId);
  if (!index) return;
  const manual = index.entries.filter((e) => e.source !== "auto");
  const fresh = detectEntries(index.pages);
  const next = { ...index, entries: mergeEntries(fresh, manual) };
  await put("indexes", next);
  return next;
}

/**
 * Bringt ein älteres Skript auf den aktuellen Stand: Text samt Schriftstil neu lesen und Definitionen neu
 * erkennen. Selbst angelegte (und früher von Claude gefundene) Einträge bleiben erhalten.
 */
export async function upgradeIndex(
  doc: PDFDocumentProxy,
  index: ScriptIndex,
  onProgress: (msg: string, frac: number) => void,
): Promise<ScriptIndex> {
  // Ab Version 2 ist der Schriftstil schon gespeichert – dann genügt es, die Erkennung neu laufen zu lassen
  const pages =
    (index.version ?? 1) >= 2
      ? index.pages
      : await extractAll(doc, (d, t) => onProgress(`Skript wird neu analysiert: Seite ${d}/${t}`, d / t));
  const kept = index.entries.filter((e) => e.source !== "auto");
  const next: ScriptIndex = { ...index, version: INDEX_VERSION, pages, entries: mergeEntries(detectEntries(pages), kept) };
  await put("indexes", next);
  return next;
}

export function mergeEntries(base: Entry[], extra: Entry[]): Entry[] {
  const out = [...base];
  for (const e of extra) {
    // dieselbe Stelle: gleiche Nummer oder (fast) gleiche Höhe auf derselben Seite
    const same = out.find(
      (o) => o.page === e.page && ((!!o.number && o.number === e.number && o.kind === e.kind) || Math.abs(o.y - e.y) < 8),
    );
    if (same) {
      for (const t of e.terms) if (!same.terms.some((x) => x.toLowerCase() === t.toLowerCase())) same.terms.push(t);
      if (!same.number && e.number) same.number = e.number;
      // Herkunft behalten, damit die Ergänzung auch die nächste Neuanalyse übersteht
      if (same.source === "auto") same.source = e.source;
    } else out.push(e);
  }
  return sortEntries(out);
}

export function sortEntries(entries: Entry[]): Entry[] {
  return entries.sort((a, b) => a.page - b.page || a.y - b.y);
}
