// Verbesserungsansicht: Vergleiche (alte ↔ neue Fassung einer geänderten Seite) abschließen oder die alte Seite im
// Skript behalten. Die Notizen der alten Seite stehen im Vergleich (Annotations.compare), bis sie übernommen werden.

import { PDFDocument } from "pdf-lib";
import { del, get, getAll, put, type Lookup, type Script, type ScriptIndex } from "./db";
import { detectEntries } from "./indexer";
import { mergeEntries } from "./ingest";
import type { Annotations, PageInk } from "./ink";

/** Offene Vergleiche → Seiten, die markiert werden (für Hinweisleiste und Seiten-Markierung). */
export const pendingPages = (ann: Pick<Annotations, "compare">) =>
  (ann.compare ?? []).filter((c) => !c.done).map((c) => c.newPage).sort((a, b) => a - b);

/** Sind alle Vergleiche erledigt, wird die aufgehobene alte PDF nicht mehr gebraucht. */
async function cleanupIfDone(ann: Annotations): Promise<Annotations> {
  if (ann.compareFile && !(ann.compare ?? []).some((c) => !c.done)) {
    await del("files", ann.compareFile);
    return { ...ann, compareFile: undefined, compare: [] };
  }
  return ann;
}

/** Vergleich als geprüft markieren (nicht übernommene Notizen der alten Seite entfallen). */
export async function finishCompare(scriptId: string, ann: Annotations, itemId: string): Promise<Annotations> {
  const next = await cleanupIfDone({
    ...ann,
    compare: (ann.compare ?? []).map((c) => (c.id === itemId ? { ...c, done: true, strokes: [], notes: [] } : c)),
    updatedAt: Date.now(),
  });
  await put<Annotations>("annotations", next);
  await syncReview(scriptId, next);
  return next;
}

async function syncReview(scriptId: string, ann: Annotations) {
  const s = await get<Script>("scripts", scriptId);
  if (s?.changes) await put<Script>("scripts", { ...s, changes: { ...s.changes, review: pendingPages(ann) } });
}

/**
 * Alte Seite im Skript behalten: Sie wird direkt vor der neuen Fassung eingefügt – mit ihren Zeichnungen und
 * Notiz-Zettel. Alle folgenden Seiten rücken um eins nach hinten (Notizen, Verknüpfungen, Leseposition …).
 * ann: aktueller Stand der Notizen (aus dem Leser, damit nichts Ungespeichertes verloren geht).
 */
export async function keepOldPage(scriptId: string, ann: Annotations, itemId: string): Promise<void> {
  const item = (ann.compare ?? []).find((c) => c.id === itemId);
  const script = await get<Script>("scripts", scriptId);
  const index = await get<ScriptIndex>("indexes", scriptId);
  const file = await get<{ id: string; blob: Blob }>("files", scriptId);
  const oldFile = ann.compareFile ? await get<{ id: string; blob: Blob }>("files", ann.compareFile) : undefined;
  if (!item || !script || !index || !file || !oldFile) throw new Error("Die alte Fassung ist nicht mehr vorhanden.");
  const at = item.newPage; // alte Seite bekommt diese Nummer, die neue rückt eins weiter
  const shift = (p: number) => (p >= at ? p + 1 : p);

  // PDF: alte Seite einfügen
  const cur = await PDFDocument.load(await file.blob.arrayBuffer(), { ignoreEncryption: true });
  const old = await PDFDocument.load(await oldFile.blob.arrayBuffer(), { ignoreEncryption: true });
  const [pg] = await cur.copyPages(old, [item.oldPage - 1]);
  cur.insertPage(at - 1, pg);
  const bytes = await cur.save();

  // Text und Verknüpfungen
  const pages = [...index.pages.slice(0, at - 1), item.oldText, ...index.pages.slice(at - 1)].map((p, i) => ({ ...p, page: i + 1 }));
  const manual = index.entries.filter((e) => e.source !== "auto").map((e) => ({ ...e, page: shift(e.page) }));
  const disabledLinks = (index.disabledLinks ?? []).map((k) => {
    const [pgNo, ...rest] = k.split(":");
    return [String(shift(Number(pgNo))), ...rest].join(":");
  });

  // Notizen: alles ab der Stelle eins weiter, die alte Seite bekommt ihre Zeichnungen und Zettel zurück
  const ink: PageInk = {};
  for (const [k, v] of Object.entries(ann.pages)) ink[shift(Number(k))] = v;
  ink[at] = [...(ink[at] ?? []), ...item.strokes];
  const notes = [...(ann.notes ?? []).map((n) => ({ ...n, page: shift(n.page) })), ...item.notes.map((n) => ({ ...n, page: at }))];
  const compare = (ann.compare ?? []).map((c) =>
    c.id === itemId ? { ...c, done: true, kept: true, strokes: [], notes: [], newPage: at + 1 } : { ...c, newPage: shift(c.newPage) },
  );
  const nextAnn = await cleanupIfDone({ ...ann, pages: ink, notes, compare, updatedAt: Date.now() });

  await put("files", { id: scriptId, blob: new Blob([bytes as BlobPart], { type: "application/pdf" }) });
  await put<ScriptIndex>("indexes", { ...index, pages, entries: mergeEntries(detectEntries(pages), manual), disabledLinks });
  await put<Annotations>("annotations", nextAnn);
  for (const l of await getAll<Lookup>("lookups")) {
    if (l.scriptId === scriptId && l.target.page >= at) await put<Lookup>("lookups", { ...l, target: { ...l.target, page: l.target.page + 1 } });
  }
  await put<Script>("scripts", {
    ...script,
    pageCount: pages.length,
    size: bytes.byteLength,
    lastPage: script.lastPage ? shift(script.lastPage) : script.lastPage,
    changes: script.changes && {
      ...script.changes,
      newPages: script.changes.newPages.map(shift),
      review: pendingPages(nextAnn),
    },
  });
  if (at === 1) await del("thumbs", scriptId);
}
