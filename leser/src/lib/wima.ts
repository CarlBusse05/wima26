// Anbindung an Wima: Der Leser läuft unter wima26.de/leser/ und holt seine Skripte aus Wima (gleiche Adresse,
// also gilt die Wima-Anmeldung).
//
// Eine Wima-Quelle ist ein Eintrag samt Fassung (Rolle "original", "verbessert", "lang", "loesung"). Die neueste
// PDF dieser Quelle ist das Skript; kommt in Wima eine neuere dazu, wird sie hier als neue Version übernommen –
// mit allem, was "Neue Version hochladen" kann (Notizen wandern mit, Verbesserungsansicht …).
//
// Gemeinsame Notizen: Zu jeder Quelle gibt es in Wima genau einen Notizstand (Tabelle "notizen"), den alle Nutzer
// sehen und bearbeiten. Er besteht aus den Strichen/Zetteln (JSON), der PDF, auf der sie liegen (basis – nach
// einer neuen Version eine zusammengesetzte PDF, sonst die Wima-Datei selbst), und ggf. der vorigen Fassung für
// die Verbesserungsansicht. Lokal liegt alles wie bisher in der IndexedDB; jede Änderung an den Notizen wird kurz
// danach hochgeladen, fremde Änderungen werden beim Öffnen und regelmäßig geholt. Haben zwei gleichzeitig
// gespeichert, wird zusammengeführt (Striche und Zettel einzeln, über ihre id, gegen den letzten gemeinsamen Stand).
// Index, Anpinnen und Abfrage-Statistik bleiben persönlich.
//
// Jeder Strich und Zettel trägt seinen Autor ("von"). Wessen Notizen zu sehen sind, wählt man in Wima je Eintrag
// („Notizen: Carl Emil“); bearbeiten und radieren kann man nur die eigenen.

import { del, get, getAll, put, writeHooks, type Entry, type Script, type ScriptIndex } from "./db";
import { ingestPdf, INDEX_VERSION, mergeEntries } from "./ingest";
import { prepareNewVersion, describeChanges } from "./versions";
import { closePdf, extractAll, loadPdf } from "./pdf";
import { detectEntries } from "./indexer";
import type { Annotations } from "./ink";

export interface WimaSource {
  item: number;
  rolle: string;
  fileId: number; // Wima-PDF, auf deren Stand das Skript ist
  rev?: number; // zuletzt abgeglichener Notizstand (0/fehlt = noch keiner)
  basisId?: number; // Wima-Datei der PDF, auf der die Notizen liegen
  basisDirty?: boolean; // lokale PDF geändert (neue Version, "Alte Seite behalten") – beim nächsten Abgleich hochladen
  vergleichId?: number; // Wima-Datei der vorigen Fassung (Verbesserungsansicht)
  vergleichLocal?: string; // zugehörige lokale id im Speicher "files"
}

interface WimaFile {
  id: number;
  item_id: number;
  rolle: string;
  owner: string | null;
  name: string;
  mime: string;
  created: string;
}

interface WimaItem {
  id: number;
  course_id: number;
  art: string;
  nummer: string | null;
  titel: string | null;
  datum: string | null;
  files: WimaFile[];
}

interface Stand {
  item_id: number;
  rolle: string;
  rev: number;
  daten_id: number;
  basis_id: number | null;
  vergleich_id: number | null;
  quelle_id: number | null;
  geaendert: string;
  von: string;
}

/** Was gemeinsam gespeichert wird: Notizen ohne lokale ids, dazu der Versionsstand des Skripts. */
interface Shared {
  ann: Pick<Annotations, "pages" | "orphans" | "notes" | "compare">;
  meta: Pick<Script, "version" | "versions" | "changes" | "pageCount">;
}

export interface WimaPdf {
  key: string; // "item:rolle"
  course: string;
  courseId: number;
  item: WimaItem;
  rolle: string;
  label: string; // "Original", "Lang" …
  file: WimaFile; // neueste PDF dieser Quelle
}

// Fassungen, die als ganzes Dokument lesbar sind (Fotos, Lösungsteile, Notizen sind Bausteine, keine Skripte)
const ROLLEN: Record<string, string> = { original: "Original", verbessert: "Verbessert", lang: "Lang", loesung: "Lösung" };
const ARTEN: Record<string, string> = { skript: "Skript", uebung: "Übung", tutorium: "Tutorium", sonstiges: "Sonstiges" };

export const sourceKey = (item: number, rolle: string) => `${item}:${rolle}`;
const isPdf = (f: WimaFile) => f.mime === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  if (r.status === 401) throw new Error("Nicht bei Wima angemeldet – bitte erst auf der Wima-Startseite anmelden.");
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok && r.status !== 409) throw new Error(body.error ?? `Wima antwortet mit ${r.status}`);
  return { status: r.status, body };
}
const getJson = async <T>(path: string) => (await api<T>(path)).body;

async function fileBlob(id: number): Promise<Blob> {
  const r = await fetch(`/files/${id}`, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`Datei ${id} konnte nicht aus Wima geladen werden (${r.status})`);
  return r.blob();
}

export function itemTitle(item: WimaItem): string {
  const art = ARTEN[item.art] ?? item.art;
  const head = item.nummer ? `${art} ${item.nummer}` : art;
  return item.titel ? `${head}: ${item.titel}` : head;
}

/** Alle lesbaren PDFs aus Wima, je Quelle nur die neueste. */
export async function listWimaPdfs(): Promise<WimaPdf[]> {
  const state = await getJson<{ courses: { id: number; name: string }[] }>("/api/state");
  const out: WimaPdf[] = [];
  for (const c of state.courses) {
    const { items } = await getJson<{ items: WimaItem[] }>(`/api/courses/${c.id}/items`);
    for (const item of items) {
      const newest = new Map<string, WimaFile>();
      for (const f of item.files) {
        if (!ROLLEN[f.rolle] || f.owner || !isPdf(f)) continue;
        const k = sourceKey(item.id, f.rolle);
        if (!newest.has(k) || f.id > newest.get(k)!.id) newest.set(k, f);
      }
      for (const [key, f] of newest)
        out.push({ key, course: c.name, courseId: c.id, item, rolle: f.rolle, label: ROLLEN[f.rolle], file: f });
    }
  }
  return out;
}

export async function scriptsBySource(): Promise<Map<string, Script>> {
  const m = new Map<string, Script>();
  for (const s of await getAll<Script>("scripts")) if (s.wima) m.set(sourceKey(s.wima.item, s.wima.rolle), s);
  return m;
}

const stand = async (item: number, rolle: string) =>
  getJson<Stand | Record<string, never>>(`/api/notizen?item=${item}&rolle=${rolle}`).then((s) => ("rev" in s ? (s as Stand) : null));

// ---------- wessen Notizen zu sehen sind ----------

let wer: Promise<{ user: string; users: string[] }> | null = null;
/** Angemeldeter Wima-Nutzer und alle Nutzer. */
export const wimaNutzer = () =>
  (wer ??= getJson<{ user: string; users: string[] }>("/api/state").then((s) => ({ user: s.user, users: s.users })));

// Gleiche Adresse wie Wima, also derselbe localStorage: { <Eintrag>: ["Carl", …] }
const SICHT = "wima.notizenSicht";
const sichtAlle = (): Record<string, string[]> => {
  try {
    return JSON.parse(localStorage.getItem(SICHT) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
export const sichtbar = (item: number): string[] => sichtAlle()[item] ?? [];
export function setSichtbar(item: number, users: string[]) {
  try {
    localStorage.setItem(SICHT, JSON.stringify({ ...sichtAlle(), [item]: users }));
  } catch {
    /* privates Fenster o. Ä. */
  }
  window.dispatchEvent(new CustomEvent("wima-sicht", { detail: item }));
}
/** Meldet Änderungen der Auswahl – auch aus dem Wima-Tab. */
export function onSicht(item: number, cb: (users: string[]) => void): () => void {
  const on = () => cb(sichtbar(item));
  const storage = (e: StorageEvent) => e.key === SICHT && on();
  window.addEventListener("wima-sicht", on);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener("wima-sicht", on);
    window.removeEventListener("storage", storage);
  };
}

// ---------- lokaler Zustand des Abgleichs ----------

let quiet = 0; // > 0: Schreiben kommt vom Abgleich selbst, kein neuer Upload
async function silently<T>(work: () => Promise<T>): Promise<T> {
  quiet++;
  try {
    return await work();
  } finally {
    quiet--;
  }
}

// Letzter gemeinsamer Stand je Skript – Grundlage fürs Zusammenführen und um unveränderte Notizen nicht erneut
// hochzuladen. Liegt neben den Notizen ("<id>#basis"), damit er ein Neuladen der Seite übersteht.
const baseKey = (scriptId: string) => `${scriptId}#basis`;
async function getBase(scriptId: string): Promise<Shared["ann"] | undefined> {
  return (await get<{ scriptId: string; ann: Shared["ann"] }>("annotations", baseKey(scriptId)))?.ann;
}
const setBase = (scriptId: string, ann: Shared["ann"]) => silently(() => put("annotations", { scriptId: baseKey(scriptId), ann }));

const pick = (a: Partial<Annotations> | undefined): Shared["ann"] => ({
  pages: a?.pages ?? {},
  orphans: a?.orphans ?? [],
  notes: a?.notes ?? [],
  compare: a?.compare ?? [],
});
const isEmpty = (a: Shared["ann"]) =>
  !Object.values(a.pages).some((p) => p.length) && !a.notes?.length && !a.orphans?.length && !a.compare?.length;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Dreiwege-Zusammenführung einer Liste mit ids: fremder Stand + eigene Änderungen seit dem gemeinsamen Stand. */
function merge3<T extends { id: string }>(base: T[] = [], mine: T[] = [], theirs: T[] = []): T[] {
  const b = new Map(base.map((x) => [x.id, x]));
  const m = new Map(mine.map((x) => [x.id, x]));
  const out = theirs.filter((x) => !(b.has(x.id) && !m.has(x.id))); // von mir gelöscht
  for (const x of mine) {
    if (b.has(x.id) && same(b.get(x.id), x)) continue; // von mir unverändert → fremder Stand gilt
    const i = out.findIndex((y) => y.id === x.id);
    if (i >= 0) out[i] = x;
    else out.push(x);
  }
  return out;
}

function mergeShared(base: Shared["ann"], mine: Shared["ann"], theirs: Shared["ann"]): Shared["ann"] {
  const pages: Annotations["pages"] = {};
  const nums = new Set([...Object.keys(base.pages), ...Object.keys(mine.pages), ...Object.keys(theirs.pages)].map(Number));
  for (const n of nums) {
    const strokes = merge3(base.pages[n], mine.pages[n], theirs.pages[n]);
    if (strokes.length) pages[n] = strokes;
  }
  return {
    pages,
    notes: merge3(base.notes, mine.notes, theirs.notes),
    orphans: merge3(base.orphans, mine.orphans, theirs.orphans),
    compare: merge3(base.compare, mine.compare, theirs.compare),
  };
}

async function uploadPdf(item: number, rolle: string, blob: Blob, name: string): Promise<number> {
  const { body } = await api<{ id: number }>(
    `/api/upload?item=${item}&rolle=notizbasis&name=${encodeURIComponent(`${rolle}_${name}.pdf`)}`,
    { method: "POST", body: blob },
  );
  return body.id;
}

/** Text der (neuen) PDF lesen und Definitionen erkennen; selbst angepinnte Einträge bleiben. */
async function reindex(scriptId: string, blob: Blob): Promise<number> {
  const doc = await loadPdf(blob);
  try {
    const pages = await extractAll(doc, () => {});
    const old = await get<ScriptIndex>("indexes", scriptId);
    const kept: Entry[] = (old?.entries ?? []).filter((e) => e.source !== "auto" && e.page <= pages.length);
    await put<ScriptIndex>("indexes", {
      scriptId,
      version: INDEX_VERSION,
      pages,
      entries: mergeEntries(detectEntries(pages), kept),
      disabledTerms: old?.disabledTerms ?? [],
      disabledLinks: old?.disabledLinks,
    });
    return doc.numPages;
  } finally {
    await closePdf(doc);
  }
}

// ---------- holen ----------

/** Fremden Notizstand übernehmen, falls neuer als der lokale. Gibt true zurück, wenn sich etwas geändert hat. */
export async function pullShared(scriptId: string, known?: Stand | null): Promise<boolean> {
  const s = await get<Script>("scripts", scriptId);
  if (!s?.wima) return false;
  const st = known === undefined ? await stand(s.wima.item, s.wima.rolle) : known;
  if (!st || st.rev <= (s.wima.rev ?? 0)) return false;
  // ungespeicherte eigene Änderungen: erst hochladen (dabei wird zusammengeführt), nicht überschreiben
  const base = await getBase(scriptId);
  const local = pick(await get<Annotations>("annotations", scriptId));
  if (base ? !same(base, local) : !isEmpty(local)) {
    schedulePush(scriptId);
    return false;
  }
  const shared = (await (await fileBlob(st.daten_id)).text().then(JSON.parse)) as Shared;
  await silently(async () => {
    const wima: WimaSource = { ...s.wima!, rev: st.rev, fileId: st.quelle_id ?? s.wima!.fileId, basisDirty: false };
    let pageCount = s.pageCount;
    if (st.basis_id && st.basis_id !== s.wima!.basisId) {
      const blob = await fileBlob(st.basis_id);
      await put("files", { id: scriptId, blob });
      pageCount = await reindex(scriptId, blob);
      await del("thumbs", scriptId);
      wima.basisId = st.basis_id;
    }
    // vorige Fassung für die Verbesserungsansicht: nur laden, wenn sie nicht schon da ist
    let compareFile: string | undefined;
    if (st.vergleich_id && st.vergleich_id === s.wima!.vergleichId && s.wima!.vergleichLocal) compareFile = s.wima!.vergleichLocal;
    else if (st.vergleich_id) {
      compareFile = `${scriptId}-vergleich`;
      await put("files", { id: compareFile, blob: await fileBlob(st.vergleich_id) });
    }
    wima.vergleichId = st.vergleich_id ?? undefined;
    wima.vergleichLocal = compareFile;
    await put<Annotations>("annotations", { scriptId, ...shared.ann, compareFile, updatedAt: Date.now() });
    await put<Script>("scripts", { ...s, ...shared.meta, pageCount: shared.meta.pageCount ?? pageCount, wima });
  });
  await setBase(scriptId, shared.ann);
  return true;
}

// ---------- hochladen ----------

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<void>>();
export const syncBusy = (scriptId: string) => timers.has(scriptId) || running.has(scriptId);

function schedulePush(scriptId: string) {
  clearTimeout(timers.get(scriptId));
  timers.set(
    scriptId,
    setTimeout(() => {
      timers.delete(scriptId);
      const prev = running.get(scriptId) ?? Promise.resolve();
      const p = prev
        .then(() => pushShared(scriptId))
        .catch((e) => banner(`Notizen konnten nicht in Wima gespeichert werden: ${e instanceof Error ? e.message : e}`, true))
        .finally(() => running.get(scriptId) === p && running.delete(scriptId));
      running.set(scriptId, p);
    }, 1500),
  );
}

/** Lokale Notizen als neuen gemeinsamen Stand speichern (bei gleichzeitiger fremder Änderung: zusammenführen). */
export async function pushShared(scriptId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const s = await get<Script>("scripts", scriptId);
    if (!s?.wima) return;
    const w = { ...s.wima };
    const ann = await get<Annotations>("annotations", scriptId);
    const mine = pick(ann);
    const base = await getBase(scriptId);
    if (!w.basisDirty && (base ? same(base, mine) : isEmpty(mine))) return; // nichts Neues

    if (w.basisDirty || !w.basisId) {
      const f = await get<{ blob: Blob }>("files", scriptId);
      if (!f) return;
      w.basisId = await uploadPdf(w.item, w.rolle, f.blob, `v${s.version ?? 1}`);
    }
    if (ann?.compareFile && (ann.compareFile !== w.vergleichLocal || !w.vergleichId)) {
      const f = await get<{ blob: Blob }>("files", ann.compareFile);
      if (f) w.vergleichId = await uploadPdf(w.item, w.rolle, f.blob, "vorige_fassung");
      w.vergleichLocal = ann.compareFile;
    }
    if (!ann?.compareFile) w.vergleichId = w.vergleichLocal = undefined;

    const body: Shared = { ann: mine, meta: { version: s.version, versions: s.versions, changes: s.changes, pageCount: s.pageCount } };
    const q = new URLSearchParams({ item: String(w.item), rolle: w.rolle, rev: String(w.rev ?? 0), basis: String(w.basisId), quelle: String(w.fileId) });
    if (w.vergleichId) q.set("vergleich", String(w.vergleichId));
    const r = await api<Stand & { stand?: Stand }>(`/api/notizen?${q}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 200) {
      await silently(() => put<Script>("scripts", { ...s, wima: { ...w, rev: r.body.rev, basisDirty: false } }));
      await setBase(scriptId, mine);
      return;
    }
    // 409: jemand anderes hat inzwischen gespeichert
    const theirs = r.body.stand!;
    if (w.basisDirty || (theirs.basis_id !== s.wima.basisId)) {
      // andere PDF-Grundlage (z. B. gleichzeitig neue Version übernommen): fremder Stand gilt
      await pullShared(scriptId, theirs);
      banner(`${theirs.von} hat die Notizen gleichzeitig geändert – sein Stand wurde übernommen.`, true);
      reloadReader(scriptId);
      return;
    }
    const remote = (JSON.parse(await (await fileBlob(theirs.daten_id)).text()) as Shared).ann;
    const merged = mergeShared(base ?? pick(undefined), mine, remote);
    await silently(async () => {
      await put<Annotations>("annotations", { ...(ann ?? { scriptId, updatedAt: 0 }), ...merged, scriptId, updatedAt: Date.now() });
      await put<Script>("scripts", { ...s, wima: { ...w, rev: theirs.rev } });
    });
    await setBase(scriptId, remote);
    reloadReader(scriptId);
    // nächste Runde lädt den zusammengeführten Stand auf Basis von theirs.rev hoch
  }
}

writeHooks.push((name, key) => {
  if (quiet || key.includes("#")) return;
  if (name === "annotations") return void scriptHasWima(key).then((yes) => yes && schedulePush(key));
  if (name === "files")
    // eigene PDF geändert (neue Version, "Alte Seite behalten") → beim nächsten Abgleich mit hochladen
    return void get<Script>("scripts", key).then(async (s) => {
      if (!s?.wima || s.wima.basisDirty) return;
      await silently(() => put<Script>("scripts", { ...s, wima: { ...s.wima!, basisDirty: true } }));
      schedulePush(key);
    });
});
const scriptHasWima = async (id: string) => !!(await get<Script>("scripts", id))?.wima;

// ---------- Leser offen: fremde Änderungen regelmäßig holen ----------

function reloadReader(scriptId: string) {
  window.dispatchEvent(new CustomEvent("wima-reload", { detail: scriptId }));
}

/** Für den Leser: holt alle 20 s (und beim Zurückkehren in den Tab) fremde Änderungen. Gibt das Abmelden zurück. */
export function watchShared(scriptId: string): () => void {
  let stop = false;
  const tick = async () => {
    if (stop || document.hidden || syncBusy(scriptId)) return;
    try {
      if (await pullShared(scriptId)) {
        reloadReader(scriptId);
        banner("Neue Notizen aus Wima übernommen.");
      }
    } catch {
      /* offline o. Ä. – beim nächsten Mal */
    }
  };
  const iv = setInterval(tick, 20000);
  const vis = () => !document.hidden && void tick();
  document.addEventListener("visibilitychange", vis);
  return () => {
    stop = true;
    clearInterval(iv);
    document.removeEventListener("visibilitychange", vis);
  };
}

let bannerEl: HTMLDivElement | null = null;
function banner(msg: string, warn = false) {
  bannerEl?.remove();
  const el = document.createElement("div");
  el.className = "wima-banner" + (warn ? " warn" : "");
  el.textContent = msg;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  bannerEl = el;
  setTimeout(() => el.remove(), warn ? 10000 : 4000);
}

// ---------- öffnen / importieren / neue Fassung ----------

/** Erstes Öffnen auf diesem Gerät: gemeinsamen Stand holen, sonst die Wima-PDF wie ein hochgeladenes Skript. */
export async function importWima(p: WimaPdf, onProgress: (msg: string, frac: number) => void): Promise<Script> {
  const st = await stand(p.item.id, p.rolle);
  const baseFile = st?.basis_id ?? p.file.id;
  const blob = await fileBlob(baseFile);
  const s = await silently(() => ingestPdf(new File([blob], p.file.name, { type: "application/pdf" }), p.course, onProgress));
  const next: Script = {
    ...s,
    title: p.rolle === "original" ? itemTitle(p.item) : `${itemTitle(p.item)} (${p.label})`,
    wima: { item: p.item.id, rolle: p.rolle, fileId: st?.quelle_id ?? p.file.id, basisId: baseFile, rev: 0 },
  };
  await silently(() => put("scripts", next));
  if (st) await pullShared(next.id, { ...st, basis_id: baseFile });
  return next;
}

/**
 * Neuere PDF in Wima: als neue Version übernehmen (die Notizen wandern mit und gehen danach als gemeinsamer Stand
 * nach Wima). Passt sie kaum zur bisherigen Fassung, wird nachgefragt.
 */
export async function updateFromWima(
  s: Script,
  p: WimaPdf,
  onProgress: (msg: string, frac: number) => void,
  ask: (msg: string) => boolean,
): Promise<{ script: Script; lines: string[] } | null> {
  const file = new File([await fileBlob(p.file.id)], p.file.name, { type: "application/pdf" });
  const plan = await prepareNewVersion(s.id, file, onProgress);
  if (
    plan.matchedShare < 0.3 &&
    !ask(`„${file.name}“ hat kaum Seiten mit dem bisherigen „${s.title}“ gemeinsam – trotzdem als neue Version übernehmen?\n\nNotizen ohne passende Seite gehen nicht verloren, sondern werden gesammelt.`)
  ) {
    await silently(() => put("scripts", { ...s, wima: { ...s.wima!, fileId: p.file.id } }));
    return null;
  }
  const oldBasis = s.wima!.basisId;
  const committed = await silently(() => plan.commit());
  const ann = await get<Annotations>("annotations", s.id);
  // die vorige Fassung liegt schon in Wima (bisherige Grundlage) – nicht noch einmal hochladen
  const script: Script = {
    ...committed,
    wima: { ...s.wima!, fileId: p.file.id, basisDirty: true, vergleichId: ann?.compareFile ? oldBasis : undefined, vergleichLocal: ann?.compareFile },
  };
  await silently(() => put("scripts", script));
  await pushShared(s.id);
  return { script: (await get<Script>("scripts", s.id)) ?? script, lines: describeChanges(plan.report, plan.pageCount) };
}

/** Skript zu einer Quelle: holen, fremde Notizen übernehmen, neuere Wima-Fassung als neue Version einspielen. */
export async function syncSource(
  p: WimaPdf,
  existing: Script | undefined,
  onProgress: (msg: string, frac: number) => void,
  ask: (msg: string) => boolean,
): Promise<{ script: Script; lines?: string[] }> {
  if (!existing) existing = await importWima(p, onProgress);
  else await pullShared(existing.id);
  existing = (await get<Script>("scripts", existing.id))!;
  if (existing.wima!.fileId !== p.file.id && p.file.id > existing.wima!.fileId) {
    const r = await updateFromWima(existing, p, onProgress, ask);
    if (r) return r;
  }
  return { script: (await get<Script>("scripts", existing.id))! };
}

/** Wima-Datei-ID (aus Wima, Schalter „Notizen“) → passendes Skript, bei Bedarf importieren oder aktualisieren. */
export async function openWimaFile(fileId: number, onProgress: (msg: string, frac: number) => void): Promise<Script> {
  const all = await listWimaPdfs();
  let p = all.find((x) => x.file.id === fileId);
  if (!p) {
    // ältere Fassung angeklickt: dieselbe Quelle, neueste Datei
    for (const x of all) if (x.item.files.some((f) => f.id === fileId && f.rolle === x.rolle)) p = x;
  }
  if (!p) throw new Error("Diese Datei gibt es in Wima nicht (mehr) oder sie ist keine lesbare PDF.");
  const existing = (await scriptsBySource()).get(p.key);
  return (await syncSource(p, existing, onProgress, (m) => confirm(m))).script;
}
