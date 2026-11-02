// Kleine IndexedDB-Schicht. Alles bleibt lokal im Browser.

import type { DocDate } from "./docdate";
import type { WimaSource } from "./wima";

export interface Script {
  id: string;
  title: string;
  course: string;
  createdAt: number;
  pageCount: number;
  size: number;
  lastPage?: number;
  docDate?: DocDate | null; // neuester Aufschrieb laut Dokument (null = keins erkennbar)
  dateScan?: number; // Version der Datumssuche, mit der docDate ermittelt wurde
  version?: number; // 1 = erste hochgeladene Fassung; steigt mit jeder "Neuen Version"
  versions?: VersionInfo[]; // Verlauf der hochgeladenen Fassungen
  changes?: VersionChanges; // Hinweise zur zuletzt hochgeladenen Fassung
  wima?: WimaSource; // stammt aus Wima (Eintrag + Fassung) – neuere PDFs dort werden als neue Version übernommen
}

export interface VersionInfo {
  n: number;
  uploadedAt: number;
  fileName: string;
  pageCount: number;
}

/** Was sich mit der neuesten Fassung geändert hat – für die Hinweise im Skript. */
export interface VersionChanges {
  version: number;
  at: number;
  fromPages: number; // Seitenzahl der vorigen Fassung
  newPages: number[]; // Seiten ohne Gegenstück in der alten Fassung (neue Kapitel …)
  newUntil: number; // so lange werden neue Seiten als "neu" markiert
  review: number[]; // Seiten mit Notizen, deren Text sich geändert hat – in der Verbesserungsansicht zu prüfen
  movedPages: number; // Seiten, deren Notizen übernommen wurden
  unchanged?: number; // Seiten mit unverändertem Inhalt – Notizen ohne Vergleich übernommen
  orphaned: number; // Notizen-Seiten ohne Gegenstück (gesammelt in Annotations.orphans)
  droppedEntries: number; // selbst angelegte Einträge, die keiner Seite mehr zugeordnet werden konnten
  dismissed?: boolean; // Hinweisleiste geschlossen
}

export interface TextItem {
  s: string; // Text
  x: number; // links (PDF-Einheiten, Skala 1)
  y: number; // oben, vom Seitenanfang gemessen
  w: number;
  h: number;
  eol: boolean;
  b?: 1; // fett
  i?: 1; // kursiv (Text, nicht Mathe)
}

export interface PageText {
  page: number; // 1-basiert
  width: number;
  height: number;
  items: TextItem[];
}

export type EntryKind =
  | "Definition"
  | "Satz"
  | "Lemma"
  | "Korollar"
  | "Theorem"
  | "Proposition"
  | "Bemerkung"
  | "Beispiel"
  | "Axiom"
  | "Notation"
  | "Begriff"; // erstes Vorkommen eines Fachbegriffs ohne erkannte Definition

export interface Entry {
  id: string;
  kind: EntryKind;
  number?: string; // "1.1"
  terms: string[]; // Begriffe, die zu diesem Eintrag springen
  page: number;
  y: number; // Oberkante in PDF-Einheiten
  yEnd: number; // Ende des Blocks (gleiche Seite)
  source: "auto" | "ai" | "manual"; // "ai": von der früheren Claude-Analyse gefunden (nur noch in alten Daten)
  hint?: "fett" | "kursiv" | "heißt" | "erstes Vorkommen"; // woran die Stelle erkannt wurde
  text: string; // Auszug für die Vorschau
}

export interface ScriptIndex {
  scriptId: string;
  version: number;
  pages: PageText[];
  entries: Entry[];
  disabledTerms: string[]; // Begriffe, deren Verknüpfungen der Nutzer komplett entfernt hat
  disabledLinks?: string[]; // einzelne entfernte Verknüpfungen: "seite:offset:begriff"
}

/** Wie oft ein Begriff im Skript nachgeschlagen (angeklickt) wurde – Grundlage für "Abfragen". */
export interface Lookup {
  id: string; // `${scriptId}:${begriff in Kleinbuchstaben}`
  scriptId: string;
  term: string;
  label: string; // z. B. "Definition 1.1: Äquivalenzrelation"
  // Stelle der Definition beim letzten Nachschlagen (Einträge können bei einer Neuanalyse neue IDs bekommen)
  target: { page: number; y: number; yEnd: number; text: string };
  clicks: number; // insgesamt
  sinceReview: number; // seit der letzten Abfrage
  lastClick: number;
  reviews: { at: number; grade: 0 | 1 | 2 }[]; // 0 = nicht gewusst, 1 = teilweise, 2 = gewusst
}

const DB_NAME = "mathe-studium";
const DB_VERSION = 4;
// Frühere Versionen hatten zusätzlich "chats", "decks" und "cards" (Claude-Chat, Karteikarten). Diese Tabellen
// bleiben in bestehenden Datenbanken unangetastet liegen, werden aber nicht mehr benutzt.
// "thumbs": Vorschaubilder der ersten Seite (werden bei Bedarf neu erzeugt, deshalb nicht in der Datensicherung)
export const STORES = ["scripts", "files", "indexes", "annotations", "lookups", "thumbs"] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: name === "indexes" || name === "annotations" ? "scriptId" : "id" });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: StoreName, mode: IDBTransactionMode = "readonly") {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function getAll<T>(name: StoreName): Promise<T[]> {
  return wrap((await store(name)).getAll()) as Promise<T[]>;
}

export async function get<T>(name: StoreName, key: string): Promise<T | undefined> {
  return wrap((await store(name)).get(key)) as Promise<T | undefined>;
}

/** Wird nach jedem Schreiben aufgerufen (Abgleich der gemeinsamen Notizen mit Wima, siehe wima.ts). */
export const writeHooks: ((name: StoreName, key: string) => void)[] = [];
const keyOf = (name: StoreName, v: unknown) => String((v as Record<string, unknown>)[name === "indexes" || name === "annotations" ? "scriptId" : "id"]);

export async function put<T>(name: StoreName, value: T): Promise<void> {
  await wrap((await store(name, "readwrite")).put(value));
  for (const h of writeHooks) h(name, keyOf(name, value));
}

export async function putMany<T>(name: StoreName, values: T[]): Promise<void> {
  const db = await open();
  const tx = db.transaction(name, "readwrite");
  const s = tx.objectStore(name);
  for (const v of values) s.put(v);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearStore(name: StoreName): Promise<void> {
  await wrap((await store(name, "readwrite")).clear());
}

export async function del(name: StoreName, key: string): Promise<void> {
  await wrap((await store(name, "readwrite")).delete(key));
}

export function uid(): string {
  return crypto.randomUUID();
}

export async function deleteScript(id: string) {
  // aufgehobene vorige Fassung (Verbesserungsansicht)
  const ann = await get<{ compareFile?: string }>("annotations", id);
  if (ann?.compareFile) await del("files", ann.compareFile);
  await del("scripts", id);
  await del("files", id);
  await del("indexes", id);
  await del("annotations", id);
  await del("thumbs", id);
  for (const l of await getAll<Lookup>("lookups")) if (l.scriptId === id) await del("lookups", l.id);
}
