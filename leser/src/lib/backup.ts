// Datensicherung: alle Skripte (inkl. PDFs), Index/Verknüpfungen, Notizen, Abfrage-Statistik,
// eigene Farben, eigene Wortpaare und Einstellungen in EINER Datei. Skript-Versionen (Versionsnummer, Verlauf,
// Hinweise zu geänderten Seiten) stecken in den Skript-Einträgen, Notizen ohne Seite in den Notizen.
//
// Format: "MATHESTUDIUM-BACKUP 1\n" + Länge des Kopfes + "\n" + Kopf (JSON) + PDFs als Binärdaten hintereinander.
// Die PDFs werden nicht als Base64-Text eingebettet – das hält auch große Sammlungen auf dem iPad handhabbar.
// Ältere Sicherungen (eine JSON-Datei mit Base64-PDFs) können weiterhin importiert werden.

import { clearStore, del, get, getAll, put, type Lookup, type Script, type ScriptIndex } from "./db";
import type { Annotations } from "./ink";
import { CUSTOM_COLORS_KEY, NOTE_COLORS_KEY, NOTE_PEN_COLOR_KEY, NOTE_PEN_COLORS_KEY } from "./colors";
import { SETTINGS_KEY } from "./settings";
import { pairKey, WORD_PAIRS_KEY, type WordPair } from "./wordforms";

const MAGIC = "MATHESTUDIUM-BACKUP 1\n";
const LOCAL_KEYS = [SETTINGS_KEY, CUSTOM_COLORS_KEY, WORD_PAIRS_KEY, NOTE_COLORS_KEY, NOTE_PEN_COLOR_KEY, NOTE_PEN_COLORS_KEY];

interface FileRef {
  id: string;
  type: string;
  offset: number;
  size: number;
}

interface Header {
  version: 1;
  createdAt: number;
  scripts: Script[];
  indexes: ScriptIndex[];
  annotations: Annotations[];
  lookups: Lookup[];
  files: FileRef[];
  local: Record<string, string>;
}

export interface BackupSummary {
  scripts: number;
  createdAt: number | null;
}

export async function exportBackup(): Promise<File> {
  const files = await getAll<{ id: string; blob: Blob }>("files");
  const refs: FileRef[] = [];
  let offset = 0;
  for (const f of files) {
    refs.push({ id: f.id, type: f.blob.type || "application/pdf", offset, size: f.blob.size });
    offset += f.blob.size;
  }
  const local: Record<string, string> = {};
  for (const k of LOCAL_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) local[k] = v;
  }
  const header: Header = {
    version: 1,
    createdAt: Date.now(),
    scripts: await getAll<Script>("scripts"),
    indexes: await getAll<ScriptIndex>("indexes"),
    annotations: await getAll<Annotations>("annotations"),
    lookups: await getAll<Lookup>("lookups"),
    files: refs,
    local,
  };
  const head = new TextEncoder().encode(JSON.stringify(header));
  const date = new Date().toISOString().slice(0, 10);
  return new File([MAGIC, `${head.byteLength}\n`, head, ...files.map((f) => f.blob)], `mathe-studium-${date}.mathe-backup`, {
    type: "application/octet-stream",
  });
}

/** Liest Kopf und PDFs aus einer Sicherungsdatei (neues oder altes Format). */
async function readBackup(file: File): Promise<{ header: Header; blobs: Map<string, Blob> }> {
  const start = await file.slice(0, 64).text();
  if (start.startsWith(MAGIC)) {
    const lenLine = start.slice(MAGIC.length).split("\n")[0];
    const headLen = Number(lenLine);
    if (!Number.isFinite(headLen) || headLen <= 0) throw new Error("Die Datei ist beschädigt.");
    const headStart = new TextEncoder().encode(MAGIC + lenLine + "\n").byteLength;
    const header = JSON.parse(await file.slice(headStart, headStart + headLen).text()) as Header;
    const dataStart = headStart + headLen;
    const blobs = new Map<string, Blob>();
    for (const r of header.files) {
      // als eigene Kopie ablegen – Safari speichert Ausschnitte einer gewählten Datei nicht immer zuverlässig
      const buf = await file.slice(dataStart + r.offset, dataStart + r.offset + r.size).arrayBuffer();
      blobs.set(r.id, new Blob([buf], { type: r.type }));
    }
    return { header, blobs };
  }
  if (start.trimStart().startsWith("{")) {
    // altes Format (Einstellungen → "Backup exportieren" bis Oktober 2026)
    const old = JSON.parse(await file.text()) as Record<string, Record<string, unknown>[]>;
    const blobs = new Map<string, Blob>();
    for (const r of old.files ?? []) {
      const bin = atob(r.data as string);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blobs.set(r.id as string, new Blob([bytes], { type: "application/pdf" }));
    }
    return {
      header: {
        version: 1,
        createdAt: 0,
        scripts: (old.scripts ?? []) as unknown as Script[],
        indexes: (old.indexes ?? []) as unknown as ScriptIndex[],
        annotations: (old.annotations ?? []) as unknown as Annotations[],
        lookups: (old.lookups ?? []) as unknown as Lookup[],
        files: [],
        local: {},
      },
      blobs,
    };
  }
  throw new Error("Das ist keine Datensicherung der Mathe-Studium-Seite.");
}

export async function inspectBackup(file: File): Promise<BackupSummary> {
  const start = await file.slice(0, 64).text();
  if (start.startsWith(MAGIC)) {
    const { header } = await readBackup(file);
    return { scripts: header.scripts.length, createdAt: header.createdAt };
  }
  if (start.trimStart().startsWith("{")) return { scripts: NaN, createdAt: null };
  throw new Error("Das ist keine Datensicherung der Mathe-Studium-Seite.");
}

const uniq = <T,>(a: T[]) => [...new Set(a)];

/** Index zusammenführen: neuere Erkennung als Basis, eigene Einträge und entfernte Verknüpfungen aus beiden. */
function mergeIndex(local: ScriptIndex, imported: ScriptIndex): ScriptIndex {
  const base = (local.version ?? 1) >= (imported.version ?? 1) ? local : imported;
  const other = base === local ? imported : local;
  const ids = new Set(base.entries.map((e) => e.id));
  return {
    ...base,
    entries: [...base.entries, ...other.entries.filter((e) => e.source !== "auto" && !ids.has(e.id))].sort(
      (a, b) => a.page - b.page || a.y - b.y,
    ),
    disabledTerms: uniq([...base.disabledTerms, ...other.disabledTerms]),
    disabledLinks: uniq([...(base.disabledLinks ?? []), ...(other.disabledLinks ?? [])]),
  };
}

function mergeLookup(a: Lookup, b: Lookup): Lookup {
  const newer = a.lastClick >= b.lastClick ? a : b;
  const seen = new Set<number>();
  const reviews = [...a.reviews, ...b.reviews]
    .filter((r) => !seen.has(r.at) && seen.add(r.at))
    .sort((x, y) => x.at - y.at)
    .slice(-20);
  return { ...newer, clicks: Math.max(a.clicks, b.clicks), sinceReview: Math.max(a.sinceReview, b.sinceReview), reviews };
}

/**
 * Sicherung einlesen.
 *  - "replace": vorhandene Daten werden vollständig durch die Sicherung ersetzt
 *  - "merge":   beides wird zusammengeführt; bei Notizen gewinnt der neuere Stand, eigene Farben werden vereinigt,
 *               die Einstellungen dieses Geräts bleiben
 */
export async function importBackup(file: File, mode: "replace" | "merge", onProgress?: (msg: string) => void): Promise<number> {
  onProgress?.("Datei wird gelesen …");
  const { header, blobs } = await readBackup(file);

  if (mode === "replace") {
    onProgress?.("Vorhandene Daten werden ersetzt …");
    for (const s of ["scripts", "files", "indexes", "annotations", "lookups", "thumbs"] as const) await clearStore(s);
    for (const [k, v] of Object.entries(header.local)) if (LOCAL_KEYS.includes(k)) localStorage.setItem(k, v);
  } else {
    // eigene Farben vereinigen, Einstellungen dieses Geräts behalten
    // eigene Stift- und Notizfarben vereinigen
    for (const key of [CUSTOM_COLORS_KEY, NOTE_COLORS_KEY]) {
      const imported = header.local[key];
      if (!imported) continue;
      const mine = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
      localStorage.setItem(key, JSON.stringify(uniq([...mine, ...(JSON.parse(imported) as string[])])));
    }
    // eigene Wortpaare vereinigen
    const importedPairs = header.local[WORD_PAIRS_KEY];
    if (importedPairs) {
      const all = [...(JSON.parse(localStorage.getItem(WORD_PAIRS_KEY) ?? "[]") as WordPair[]), ...(JSON.parse(importedPairs) as WordPair[])];
      const seen = new Set<string>();
      localStorage.setItem(WORD_PAIRS_KEY, JSON.stringify(all.filter((p) => !seen.has(pairKey(p)) && seen.add(pairKey(p)))));
    }
  }

  // Zusammenführen bei unterschiedlichen PDF-Fassungen desselben Skripts: Die neuere Version gewinnt komplett
  // (Skript, PDF, Index, Notizen) – Seitenzahlen der älteren Fassung passen nicht mehr zur neueren.
  const takeImported = new Set<string>();
  let n = 0;
  for (const s of header.scripts) {
    onProgress?.(`Skript ${++n}/${header.scripts.length}: ${s.title}`);
    const local = mode === "merge" ? await get<Script>("scripts", s.id) : undefined;
    const newer = !!local && (s.version ?? 1) > (local.version ?? 1);
    if (newer) takeImported.add(s.id);
    if (!local || newer) await put("scripts", local && newer ? { ...s, title: local.title, course: local.course } : s);
    else if ((s.version ?? 1) === (local.version ?? 1) && s.changes && local.changes) {
      // gleiche Fassung: bereits geprüfte Seiten / geschlossene Hinweise von beiden Geräten übernehmen
      const review = local.changes.review.filter((p) => s.changes!.review.includes(p));
      await put("scripts", { ...local, changes: { ...local.changes, review, dismissed: local.changes.dismissed || s.changes.dismissed } });
    }
    const blob = blobs.get(s.id);
    if (blob && (!(mode === "merge" && (await get("files", s.id))) || newer)) {
      await put("files", { id: s.id, blob });
      if (newer) await del("thumbs", s.id);
    }
  }
  // weitere Dateien (z. B. die vorige Fassung eines Skripts für die Verbesserungsansicht)
  const scriptIds = new Set(header.scripts.map((x) => x.id));
  for (const [id, blob] of blobs) {
    if (scriptIds.has(id)) continue;
    if (!(mode === "merge" && (await get("files", id)))) await put("files", { id, blob });
  }
  const olderImported = async (scriptId: string) => {
    if (mode !== "merge") return false;
    const local = await get<Script>("scripts", scriptId);
    const imp = header.scripts.find((x) => x.id === scriptId);
    return !!local && !!imp && (imp.version ?? 1) < (local.version ?? 1);
  };
  for (const idx of header.indexes) {
    if (await olderImported(idx.scriptId)) continue;
    const local = mode === "merge" && !takeImported.has(idx.scriptId) ? await get<ScriptIndex>("indexes", idx.scriptId) : undefined;
    await put("indexes", local ? mergeIndex(local, idx) : idx);
  }
  for (const a of header.annotations) {
    if (await olderImported(a.scriptId)) continue;
    const local = mode === "merge" && !takeImported.has(a.scriptId) ? await get<Annotations>("annotations", a.scriptId) : undefined;
    if (!local || (a.updatedAt ?? 0) > (local.updatedAt ?? 0)) await put("annotations", a);
  }
  for (const l of header.lookups) {
    const local = mode === "merge" ? await get<Lookup>("lookups", l.id) : undefined;
    await put("lookups", local ? mergeLookup(local, l) : l);
  }
  return header.scripts.length;
}
